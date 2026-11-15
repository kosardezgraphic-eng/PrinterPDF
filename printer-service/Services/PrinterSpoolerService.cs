using System.IO;
using System.Printing;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Xml;
using PrintStudio.PrinterService.Models;

namespace PrintStudio.PrinterService.Services;

/// <summary>
/// Manages Windows Print Queues, Capabilities (winspool.drv + System.Printing),
/// DEVMODE/PrintTicket profiles, direct spooler printing, and Spooler Job lifecycle.
/// </summary>
public sealed class PrinterSpoolerService
{
    private readonly Dictionary<string, PrinterProfileDto> _profiles = new(StringComparer.OrdinalIgnoreCase);

    public IReadOnlyList<PrinterInfoDto> ListPrinters()
    {
        IReadOnlyList<PrinterInfoDto> native;
        try
        {
            native = ListPrintersWithWin32();
        }
        catch (Exception ex)
        {
            Program.Log($"winspool enumeration failed: {ex}");
            native = Array.Empty<PrinterInfoDto>();
        }
        if (native.Count > 0) return native;

        var queues = ListPrintersWithSystemPrinting();
        if (queues.Count > 0) return queues;

        throw new InvalidOperationException(
            "Windows returned no printer queues. Check that the Print Spooler service is running and that at least one printer is installed for this Windows account.");
    }

    private List<PrinterInfoDto> ListPrintersWithSystemPrinting()
    {
        var result = new List<PrinterInfoDto>();
        try
        {
            using var server = new LocalPrintServer();
            var defaultQueueName = ReadDefaultPrinterName();
            var flags = new[]
            {
                EnumeratedPrintQueueTypes.Local,
                EnumeratedPrintQueueTypes.Connections
            };

            foreach (var queue in server.GetPrintQueues(flags))
            {
                try
                {
                    queue.Refresh();
                    var name = SanitizeDriverText(queue.FullName);
                    if (string.IsNullOrWhiteSpace(name)) continue;
                    var port = SanitizeDriverText(queue.QueuePort?.Name);
                    if (string.IsNullOrWhiteSpace(port)) port = "LOCAL";
                    var driver = SanitizeDriverText(queue.QueueDriver?.Name);
                    if (string.IsNullOrWhiteSpace(driver)) driver = "Generic Driver";
                    var status = MapQueueStatus(queue);
                    var caps = QueryCapabilities(name, port, queue);

                    var profile = _profiles.TryGetValue(name, out var cached)
                        ? cached
                        : ReadActiveProfile(name, port, caps, queue, IntPtr.Zero);
                    _profiles[name] = profile;

                    var location = SanitizeDriverText(queue.Location);
                    result.Add(new PrinterInfoDto(
                        Name: name, DriverName: driver, PortName: port,
                        IsDefault: string.Equals(name, defaultQueueName, StringComparison.OrdinalIgnoreCase),
                        IsNetwork: name.StartsWith(@"\\", StringComparison.Ordinal) || port.StartsWith("IP_", StringComparison.OrdinalIgnoreCase),
                        IsVirtual: IsVirtualPrinter(name), Status: status,
                        JobsInQueue: queue.NumberOfJobs, TonerLevelPercent: null, TotalPageCounter: null,
                        Location: string.IsNullOrWhiteSpace(location) ? null : location,
                        Capabilities: caps, ActiveProfile: profile
                    ));
                }
                catch (Exception ex)
                {
                    Program.Log($"Skipping printer queue '{SafeQueueName(queue)}': {ex.Message}");
                }
            }
        }
        catch (Exception ex)
        {
            Program.Log($"System.Printing enumeration failed: {ex.Message}");
        }

        return result;
    }

    private static string SanitizeDriverText(string? raw)
    {
        if (string.IsNullOrEmpty(raw)) return string.Empty;
        int nullIdx = raw.IndexOf('\0');
        string head = nullIdx >= 0 ? raw[..nullIdx] : raw;
        var sb = new System.Text.StringBuilder(head.Length);
        bool prevSpace = false;
        for (int i = 0; i < head.Length; i++)
        {
            char c = head[i];
            if (char.IsControl(c) || c == '\uFFFD' || (c >= '\uE000' && c <= '\uF8FF'))
                continue;
            if (char.IsHighSurrogate(c))
            {
                if (i + 1 < head.Length && char.IsLowSurrogate(head[i + 1]))
                {
                    sb.Append(c);
                    sb.Append(head[++i]);
                    prevSpace = false;
                }
                continue;
            }
            if (char.IsLowSurrogate(c))
                continue;

            if (char.IsWhiteSpace(c))
            {
                if (!prevSpace && sb.Length > 0)
                {
                    sb.Append(' ');
                    prevSpace = true;
                }
            }
            else
            {
                sb.Append(c);
                prevSpace = false;
            }
        }
        return sb.ToString().Trim();
    }

    private static string ReadDefaultPrinterName()
    {
        uint size = 0;
        WinSpoolInterop.GetDefaultPrinter(null, ref size);
        if (size == 0) return string.Empty;
        var buffer = new System.Text.StringBuilder((int)size);
        if (!WinSpoolInterop.GetDefaultPrinter(buffer, ref size)) return string.Empty;
        return SanitizeDriverText(buffer.ToString());
    }

    private static string SafeQueueName(PrintQueue queue)
    {
        try { return queue.FullName; }
        catch { return "<inaccessible queue>"; }
    }

    private IReadOnlyList<PrinterInfoDto> ListPrintersWithWin32()
    {
        var flags = WinSpoolInterop.PRINTER_ENUM_LOCAL | WinSpoolInterop.PRINTER_ENUM_CONNECTIONS;
        WinSpoolInterop.EnumPrinters(flags, null, 2, IntPtr.Zero, 0, out var needed, out _);
        if (needed == 0)
            return ListPrintersByNameOnly(flags);

        var buffer = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!WinSpoolInterop.EnumPrinters(flags, null, 2, buffer, needed, out _, out var returned) || returned == 0)
                return ListPrintersByNameOnly(flags);

            // Best-effort PrintQueue map so we also enrich System.Printing PrintCapabilities & UserPrintTicket safely
            var queueMap = new Dictionary<string, PrintQueue>(StringComparer.OrdinalIgnoreCase);
            try
            {
                using var server = new LocalPrintServer();
                foreach (var q in server.GetPrintQueues(new[] { EnumeratedPrintQueueTypes.Local, EnumeratedPrintQueueTypes.Connections }))
                {
                    try { queueMap[q.FullName] = q; } catch { /* skip broken queue */ }
                }
            }
            catch
            {
                // System.Printing optional fallback; DEVMODE still gives accurate active settings
            }

            var defaultName = ReadDefaultPrinterName();
            var result = new List<PrinterInfoDto>();
            int stride = Marshal.SizeOf<WinSpoolInterop.PRINTER_INFO_2>();

            for (var i = 0; i < returned; i++)
            {
                var info = Marshal.PtrToStructure<WinSpoolInterop.PRINTER_INFO_2>(IntPtr.Add(buffer, i * stride));
                var name = SanitizeDriverText(Marshal.PtrToStringUni(info.pPrinterName));
                if (string.IsNullOrWhiteSpace(name)) continue;
                var port = SanitizeDriverText(Marshal.PtrToStringUni(info.pPortName));
                var driver = SanitizeDriverText(Marshal.PtrToStringUni(info.pDriverName));
                if (string.IsNullOrWhiteSpace(driver)) driver = "Windows printer driver";
                queueMap.TryGetValue(name, out var queue);

                var caps = QueryCapabilities(name, port, queue);

                if (!_profiles.TryGetValue(name, out var profile))
                {
                    profile = ReadActiveProfile(name, port, caps, queue, info.pDevMode);
                    _profiles[name] = profile;
                }

                string status = (info.Status & 0x00000080) != 0 ? "Offline" :
                    (info.Status & 0x00000002) != 0 ? "Error" :
                    (info.Status & 0x00000008) != 0 ? "PaperJam" :
                    (info.Status & 0x00000010) != 0 ? "OutOfPaper" :
                    (info.Status & 0x00000001) != 0 ? "Paused" : "Ready";

                var location = SanitizeDriverText(Marshal.PtrToStringUni(info.pLocation));
                result.Add(new PrinterInfoDto(
                    Name: name, DriverName: driver, PortName: port,
                    IsDefault: string.Equals(name, defaultName, StringComparison.OrdinalIgnoreCase),
                    IsNetwork: (info.Attributes & 0x10) != 0 || name.StartsWith(@"\\", StringComparison.Ordinal),
                    IsVirtual: IsVirtualPrinter(name), Status: status,
                    JobsInQueue: (int)info.cJobs, TonerLevelPercent: null, TotalPageCounter: null,
                    Location: string.IsNullOrWhiteSpace(location) ? null : location,
                    Capabilities: caps, ActiveProfile: profile));
            }

            foreach (var q in queueMap.Values)
            {
                try { q.Dispose(); } catch { }
            }

            return result;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private IReadOnlyList<PrinterInfoDto> ListPrintersByNameOnly(uint flags)
    {
        WinSpoolInterop.EnumPrinters(flags, null, 4, IntPtr.Zero, 0, out var needed, out _);
        if (needed == 0) return Array.Empty<PrinterInfoDto>();

        var buffer = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!WinSpoolInterop.EnumPrinters(flags, null, 4, buffer, needed, out _, out var returned) || returned == 0)
                return Array.Empty<PrinterInfoDto>();

            var defaultName = ReadDefaultPrinterName();
            var result = new List<PrinterInfoDto>();
            int stride = Marshal.SizeOf<WinSpoolInterop.PRINTER_INFO_4>();
            for (var i = 0; i < returned; i++)
            {
                var info = Marshal.PtrToStructure<WinSpoolInterop.PRINTER_INFO_4>(IntPtr.Add(buffer, i * stride));
                var name = SanitizeDriverText(Marshal.PtrToStringUni(info.pPrinterName));
                if (string.IsNullOrWhiteSpace(name)) continue;

                var caps = QueryCapabilities(name, string.Empty, null);
                var profile = _profiles.TryGetValue(name, out var cached)
                    ? cached
                    : ReadActiveProfile(name, string.Empty, caps, null, IntPtr.Zero);
                _profiles[name] = profile;

                result.Add(new PrinterInfoDto(
                    Name: name,
                    DriverName: "Windows installed printer",
                    PortName: string.Empty,
                    IsDefault: string.Equals(name, defaultName, StringComparison.OrdinalIgnoreCase),
                    IsNetwork: (info.Attributes & 0x10) != 0 || name.StartsWith(@"\\", StringComparison.Ordinal),
                    IsVirtual: IsVirtualPrinter(name),
                    Status: "Ready",
                    JobsInQueue: 0,
                    TonerLevelPercent: null,
                    TotalPageCounter: null,
                    Location: null,
                    Capabilities: caps,
                    ActiveProfile: profile));
            }
            return result;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static bool IsVirtualPrinter(string name) =>
        name.Contains("PDF", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("PrintStudio", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("XPS", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("Virtual", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("OneNote", StringComparison.OrdinalIgnoreCase);

    public PrinterMarginResultDto GetPrinterMargins(PrinterMarginRequestDto request)
    {
        static PrinterMarginResultDto Unavailable(string reason) => new("unavailable", Reason: reason);
        if (string.IsNullOrWhiteSpace(request.PrinterName) ||
            !double.IsFinite(request.WidthMm) || !double.IsFinite(request.HeightMm) ||
            request.WidthMm <= 0 || request.HeightMm <= 0 || request.WidthMm > 2000 || request.HeightMm > 2000 ||
            (request.Orientation != "portrait" && request.Orientation != "landscape"))
            return Unavailable("Invalid printer or paper dimensions");

        try
        {
            using var server = new LocalPrintServer();
            var queue = server.GetPrintQueues(new[] { EnumeratedPrintQueueTypes.Local, EnumeratedPrintQueueTypes.Connections })
                .FirstOrDefault(q => string.Equals(q.FullName, request.PrinterName, StringComparison.OrdinalIgnoreCase));
            if (queue == null) return Unavailable("Printer is not available");
            using (queue)
            {
                if (IsVirtualPrinter(queue.FullName))
                    return new PrinterMarginResultDto("available", "virtual", new PrinterMarginsDto(0, 0, 0, 0));

                const double dipPerMm = 96.0 / 25.4;
                PageMediaSizeName? name = request.PaperSize switch
                {
                    "A0" => PageMediaSizeName.ISOA0, "A1" => PageMediaSizeName.ISOA1,
                    "A2" => PageMediaSizeName.ISOA2, "A3" => PageMediaSizeName.ISOA3,
                    "A4" => PageMediaSizeName.ISOA4, "A5" => PageMediaSizeName.ISOA5,
                    "A6" => PageMediaSizeName.ISOA6, "B4" => PageMediaSizeName.JISB4,
                    "B5" => PageMediaSizeName.JISB5, "Letter" => PageMediaSizeName.NorthAmericaLetter,
                    "Legal" => PageMediaSizeName.NorthAmericaLegal, _ => null
                };
                if (name == null && request.PaperSize != "Custom") return Unavailable("Unsupported paper size");
                var media = name.HasValue ? new PageMediaSize(name.Value) :
                    new PageMediaSize(Math.Min(request.WidthMm, request.HeightMm) * dipPerMm, Math.Max(request.WidthMm, request.HeightMm) * dipPerMm);
                var delta = new PrintTicket
                {
                    PageMediaSize = media,
                    PageOrientation = request.Orientation == "landscape" ? PageOrientation.Landscape : PageOrientation.Portrait
                };
                var baseTicket = queue.UserPrintTicket ?? queue.DefaultPrintTicket ?? new PrintTicket();
                var validated = queue.MergeAndValidatePrintTicket(baseTicket, delta).ValidatedPrintTicket;
                var caps = queue.GetPrintCapabilities(validated);
                var area = caps.PageImageableArea;
                var width = caps.OrientedPageMediaWidth;
                var height = caps.OrientedPageMediaHeight;
                if (area == null || !width.HasValue || !height.HasValue ||
                    !double.IsFinite(width.Value) || !double.IsFinite(height.Value) ||
                    Math.Abs(width.Value / dipPerMm - request.WidthMm) > 2 || Math.Abs(height.Value / dipPerMm - request.HeightMm) > 2)
                    return Unavailable("Driver did not report the requested paper size and imageable area");
                double left = area.OriginWidth, top = area.OriginHeight;
                double right = width.Value - left - area.ExtentWidth, bottom = height.Value - top - area.ExtentHeight;
                if (!double.IsFinite(left) || !double.IsFinite(top) || !double.IsFinite(right) || !double.IsFinite(bottom) ||
                    area.ExtentWidth <= 0 || area.ExtentHeight <= 0 || Math.Min(Math.Min(left, right), Math.Min(top, bottom)) < -0.5)
                    return Unavailable("Driver reported an invalid imageable area");
                double Mm(double dip) => Math.Round(Math.Max(0, dip) / dipPerMm, 3);
                return new PrinterMarginResultDto("available", "hardware", new PrinterMarginsDto(Mm(top), Mm(right), Mm(bottom), Mm(left)));
            }
        }
        catch (Exception ex)
        {
            return Unavailable($"Cannot query printer imageable area: {ex.Message}");
        }
    }

    public PrinterCapabilitiesDto QueryCapabilities(string printerName, string portName, PrintQueue? queue)
    {
        var paperOptions = ReadSupportedPaperOptions(printerName, portName);
        var papers = paperOptions.Select(o => o.Id).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (papers.Count == 0) papers.Add("A4");

        var trays = ReadCapabilityStrings(printerName, portName, WinSpoolInterop.DC_BINNAMES, 24);
        var mediaTypes = ReadCapabilityStrings(printerName, portName, WinSpoolInterop.DC_MEDIATYPENAMES, 64);
        var dpi = ReadSupportedDpi(printerName, portName);
        if (dpi.Count == 0) dpi.Add(600);

        bool supportsDuplex = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_DUPLEX, IntPtr.Zero, IntPtr.Zero) == 1;
        bool supportsColor = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_COLORDEVICE, IntPtr.Zero, IntPtr.Zero) == 1;
        bool supportsCollate = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_COLLATE, IntPtr.Zero, IntPtr.Zero) == 1;
        bool supportsStaple = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_STAPLE, IntPtr.Zero, IntPtr.Zero) == 1;
        int copies = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_COPIES, IntPtr.Zero, IntPtr.Zero);

        List<string> stapleModes = new();
        List<string> holePunchModes = new();
        List<string> foldModes = new();
        List<string> outputBins = new();
        bool supportsBorderless = false;

        if (queue != null)
        {
            try
            {
                using var xmlStream = queue.GetPrintCapabilitiesAsXml();
                var doc = new XmlDocument();
                doc.Load(xmlStream);
                if (mediaTypes.Count == 0) mediaTypes = ExtractCapabilityOptions(doc, "PageMediaType");
                stapleModes = ExtractCapabilityOptions(doc, "Staple");
                holePunchModes = ExtractCapabilityOptions(doc, "HolePunch");
                foldModes = ExtractCapabilityOptions(doc, "Fold");
                outputBins = ExtractCapabilityOptions(doc, "OutputBin");
                var borderlessOpts = ExtractCapabilityOptions(doc, "Borderless");
                supportsBorderless = borderlessOpts.Any(o => o.Contains("Borderless", StringComparison.OrdinalIgnoreCase));
            }
            catch
            {
                // Keep Win32-detected capabilities if PrintCapabilities XML fails
            }
        }

        if (mediaTypes.Count == 0) mediaTypes.Add("Plain Paper");

        return new PrinterCapabilitiesDto(
            SupportedPapers: papers,
            SupportedTrays: trays.Count > 0 ? trays : new List<string> { "Auto Select" },
            SupportedMediaTypes: mediaTypes,
            SupportsDuplex: supportsDuplex,
            SupportsColor: supportsColor,
            SupportedDpi: dpi,
            MaxCopies: copies > 0 ? Math.Min(999, copies) : 999,
            PaperOptions: paperOptions.Count > 0 ? paperOptions : null,
            SupportsCollate: supportsCollate || copies > 1,
            SupportsStaple: supportsStaple || stapleModes.Count > 0,
            SupportedStapleModes: stapleModes.Count > 0 ? stapleModes : null,
            SupportedHolePunchModes: holePunchModes.Count > 0 ? holePunchModes : null,
            SupportedFoldModes: foldModes.Count > 0 ? foldModes : null,
            SupportedOutputBins: outputBins.Count > 0 ? outputBins : null,
            SupportedQualities: new[] { "draft", "normal", "high" },
            SupportsBorderless: supportsBorderless
        );
    }

    private static List<string> ExtractCapabilityOptions(XmlDocument doc, string featureContains)
    {
        var list = new List<string>();
        var nodes = doc.SelectNodes($"//*[local-name()='Feature' and contains(@name, '{featureContains}')]/*[local-name()='Option']");
        if (nodes == null) return list;
        foreach (XmlNode opt in nodes)
        {
            var dn = opt.SelectSingleNode("./*[local-name()='Property' and contains(@name,'DisplayName')]/*[local-name()='Value']")?.InnerText;
            var rawName = (opt as XmlElement)?.GetAttribute("name") ?? string.Empty;
            var colonIdx = rawName.IndexOf(':');
            var cleanRaw = colonIdx >= 0 ? rawName[(colonIdx + 1)..] : rawName;
            var val = SanitizeDriverText(!string.IsNullOrWhiteSpace(dn) ? dn : cleanRaw);
            if (!string.IsNullOrWhiteSpace(val) && !list.Contains(val, StringComparer.OrdinalIgnoreCase))
            {
                list.Add(val);
            }
        }
        return list;
    }

    private static PrinterProfileDto ReadActiveProfile(
        string printerName,
        string portName,
        PrinterCapabilitiesDto caps,
        PrintQueue? queue,
        IntPtr pDevMode)
    {
        const double dipPerMm = 96.0 / 25.4;
        string? paper = null;
        string? paperName = null;
        double? widthMm = null;
        double? heightMm = null;
        string orientation = "portrait";
        string tray = caps.SupportedTrays.FirstOrDefault() ?? "Auto Select";
        string duplexMode = caps.SupportsDuplex ? "long-edge" : "none";
        string colorMode = caps.SupportsColor ? "color" : "monochrome";
        int dpi = caps.SupportedDpi.Contains(600) ? 600 : caps.SupportedDpi.FirstOrDefault(300);
        bool collate = true;

        if (pDevMode != IntPtr.Zero)
        {
            try
            {
                var dm = Marshal.PtrToStructure<WinSpoolInterop.DEVMODEW>(pDevMode);
                if ((dm.dmFields & WinSpoolInterop.DM_ORIENTATION) != 0 && dm.dmOrientation == 2)
                    orientation = "landscape";

                if ((dm.dmFields & WinSpoolInterop.DM_PAPERWIDTH) != 0 && dm.dmPaperWidth > 0 &&
                    (dm.dmFields & WinSpoolInterop.DM_PAPERLENGTH) != 0 && dm.dmPaperLength > 0)
                {
                    widthMm = Math.Round(dm.dmPaperWidth / 10.0, 1);
                    heightMm = Math.Round(dm.dmPaperLength / 10.0, 1);
                }

                if ((dm.dmFields & WinSpoolInterop.DM_PAPERSIZE) != 0 && dm.dmPaperSize > 0)
                {
                    var matchOpt = caps.PaperOptions?.FirstOrDefault(o => o.RawKind == dm.dmPaperSize);
                    if (matchOpt != null)
                    {
                        paperName = matchOpt.Name;
                        widthMm ??= matchOpt.WidthMm;
                        heightMm ??= matchOpt.HeightMm;
                        paper = matchOpt.Id;
                    }
                    else
                    {
                        paper = MapPaperKindId(dm.dmPaperSize);
                    }
                }

                if (paper == null && widthMm.HasValue && heightMm.HasValue)
                    paper = MatchPaperSize(widthMm.Value, heightMm.Value);

                if ((dm.dmFields & WinSpoolInterop.DM_DEFAULTSOURCE) != 0)
                {
                    var matchedTray = MatchBinById(printerName, portName, dm.dmDefaultSource);
                    if (!string.IsNullOrWhiteSpace(matchedTray)) tray = matchedTray;
                }

                if ((dm.dmFields & WinSpoolInterop.DM_DUPLEX) != 0 && caps.SupportsDuplex)
                {
                    duplexMode = dm.dmDuplex switch
                    {
                        2 => "long-edge",
                        3 => "short-edge",
                        _ => "none"
                    };
                }

                if ((dm.dmFields & WinSpoolInterop.DM_COLOR) != 0 && caps.SupportsColor)
                {
                    colorMode = dm.dmColor == 1 ? "monochrome" : "color";
                }

                if ((dm.dmFields & WinSpoolInterop.DM_PRINTQUALITY) != 0 && dm.dmPrintQuality > 0)
                {
                    dpi = dm.dmPrintQuality;
                }

                if ((dm.dmFields & WinSpoolInterop.DM_COLLATE) != 0)
                {
                    collate = dm.dmCollate == 1;
                }
            }
            catch
            {
                // Ignore malformed driver DEVMODE
            }
        }

        if (queue != null)
        {
            try
            {
                var ticket = queue.UserPrintTicket ?? queue.DefaultPrintTicket;
                var media = ticket?.PageMediaSize;
                if (media?.Width is double w && w > 0 && media?.Height is double h && h > 0)
                {
                    widthMm ??= Math.Round(w / dipPerMm, 1);
                    heightMm ??= Math.Round(h / dipPerMm, 1);
                    paper ??= MatchPaperSize(widthMm.Value, heightMm.Value);
                }
                if (ticket?.PageOrientation == PageOrientation.Landscape)
                    orientation = "landscape";
            }
            catch
            {
                // Safe fallback
            }
        }

        paper ??= caps.SupportedPapers.Contains("A4")
            ? "A4"
            : caps.SupportedPapers.FirstOrDefault() ?? "A4";

        if ((!widthMm.HasValue || !heightMm.HasValue) && caps.PaperOptions != null)
        {
            var opt = caps.PaperOptions.FirstOrDefault(o => string.Equals(o.Id, paper, StringComparison.OrdinalIgnoreCase));
            if (opt != null)
            {
                widthMm = opt.WidthMm;
                heightMm = opt.HeightMm;
                paperName ??= opt.Name;
            }
        }

        return new PrinterProfileDto(
            PrinterName: printerName,
            PaperSize: paper,
            Tray: tray,
            MediaType: caps.SupportedMediaTypes.FirstOrDefault() ?? "Plain Paper",
            DuplexMode: duplexMode,
            Orientation: orientation,
            ColorMode: colorMode,
            Dpi: dpi,
            Quality: "normal",
            PaperWidthMm: widthMm.HasValue && heightMm.HasValue ? Math.Min(widthMm.Value, heightMm.Value) : null,
            PaperHeightMm: widthMm.HasValue && heightMm.HasValue ? Math.Max(widthMm.Value, heightMm.Value) : null,
            PaperName: paperName ?? paper,
            Collate: collate
        );
    }

    private static string? MatchBinById(string printerName, string portName, short targetBinId)
    {
        int count = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_BINS, IntPtr.Zero, IntPtr.Zero);
        if (count <= 0) return null;
        var names = ReadCapabilityStrings(printerName, portName, WinSpoolInterop.DC_BINNAMES, 24);
        int totalBytes = count * sizeof(short);
        var idBuffer = Marshal.AllocHGlobal(totalBytes);
        try
        {
            Marshal.Copy(new byte[totalBytes], 0, idBuffer, totalBytes);
            int fetched = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_BINS, idBuffer, IntPtr.Zero);
            for (int i = 0; i < Math.Min(Math.Min(count, fetched), names.Count); i++)
            {
                if (Marshal.ReadInt16(idBuffer, i * sizeof(short)) == targetBinId)
                    return names[i];
            }
        }
        finally
        {
            Marshal.FreeHGlobal(idBuffer);
        }
        return null;
    }

    private static string? MapPaperKindId(short paperId) => paperId switch
    {
        1 => "Letter", 5 => "Legal", 8 => "A3", 9 => "A4",
        11 => "A5", 12 => "B4", 13 => "B5", 66 => "A2", 67 => "A1",
        68 => "A0", 70 => "A6", _ => null
    };

    private static string MatchPaperSize(double widthMm, double heightMm)
    {
        var shortSide = Math.Min(widthMm, heightMm);
        var longSide = Math.Max(widthMm, heightMm);
        (string Id, double W, double H)[] standards =
        {
            ("A0", 841, 1189), ("A1", 594, 841), ("A2", 420, 594),
            ("A3", 297, 420), ("A4", 210, 297), ("A5", 148, 210),
            ("A6", 105, 148), ("B4", 250, 353), ("B5", 176, 250),
            ("Letter", 215.9, 279.4), ("Legal", 215.9, 355.6)
        };
        foreach (var item in standards)
            if (Math.Abs(shortSide - Math.Min(item.W, item.H)) < 2.2 &&
                Math.Abs(longSide - Math.Max(item.W, item.H)) < 2.2)
                return item.Id;
        return "Custom";
    }

    private static List<PrinterPaperOptionDto> ReadSupportedPaperOptions(string printerName, string portName)
    {
        int count = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_PAPERS, IntPtr.Zero, IntPtr.Zero);
        if (count <= 0) return new List<PrinterPaperOptionDto>();

        var names = ReadCapabilityStrings(printerName, portName, WinSpoolInterop.DC_PAPERNAMES, 64);
        int idBytes = count * sizeof(short);
        int sizeBytes = count * Marshal.SizeOf<WinSpoolInterop.POINT>();
        var idBuffer = Marshal.AllocHGlobal(idBytes);
        var sizeBuffer = Marshal.AllocHGlobal(sizeBytes);
        try
        {
            Marshal.Copy(new byte[idBytes], 0, idBuffer, idBytes);
            Marshal.Copy(new byte[sizeBytes], 0, sizeBuffer, sizeBytes);
            int idsRead = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_PAPERS, idBuffer, IntPtr.Zero);
            int sizesRead = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_PAPERSIZE, sizeBuffer, IntPtr.Zero);
            int total = Math.Min(count, Math.Min(idsRead, sizesRead));
            var result = new List<PrinterPaperOptionDto>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            for (int i = 0; i < total; i++)
            {
                short paperId = Marshal.ReadInt16(idBuffer, i * sizeof(short));
                var size = Marshal.PtrToStructure<WinSpoolInterop.POINT>(IntPtr.Add(sizeBuffer, i * Marshal.SizeOf<WinSpoolInterop.POINT>()));
                double wMm = size.X > 0 ? Math.Round(size.X / 10.0, 1) : 210;
                double hMm = size.Y > 0 ? Math.Round(size.Y / 10.0, 1) : 297;
                string? id = MapPaperKindId(paperId);
                id ??= size.X > 0 && size.Y > 0 ? MatchPaperSize(wMm, hMm) : "Custom";
                string rawName = i < names.Count && !string.IsNullOrWhiteSpace(names[i])
                    ? SanitizeDriverText(names[i])
                    : id;
                if (string.IsNullOrWhiteSpace(rawName)) rawName = id;

                var key = $"{rawName}|{wMm}x{hMm}";
                if (seen.Add(key))
                {
                    result.Add(new PrinterPaperOptionDto(id, rawName, wMm, hMm, paperId));
                }
            }
            return result;
        }
        finally
        {
            Marshal.FreeHGlobal(idBuffer);
            Marshal.FreeHGlobal(sizeBuffer);
        }
    }

    private static List<int> ReadSupportedDpi(string printerName, string portName)
    {
        int count = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_ENUMRESOLUTIONS, IntPtr.Zero, IntPtr.Zero);
        if (count <= 0) return new List<int>();
        int totalBytes = count * Marshal.SizeOf<WinSpoolInterop.POINT>();
        var buffer = Marshal.AllocHGlobal(totalBytes);
        try
        {
            Marshal.Copy(new byte[totalBytes], 0, buffer, totalBytes);
            int fetched = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_ENUMRESOLUTIONS, buffer, IntPtr.Zero);
            var result = new SortedSet<int>();
            for (int i = 0; i < Math.Min(count, fetched); i++)
            {
                var resolution = Marshal.PtrToStructure<WinSpoolInterop.POINT>(IntPtr.Add(buffer, i * Marshal.SizeOf<WinSpoolInterop.POINT>()));
                int value = Math.Max(resolution.X, resolution.Y);
                if (value > 0 && value <= 9600) result.Add(value);
            }
            return result.ToList();
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private static List<string> ReadCapabilityStrings(string printerName, string portName, short capability, int charWidth)
    {
        var items = new List<string>();
        int count = WinSpoolInterop.DeviceCapabilities(printerName, portName, capability, IntPtr.Zero, IntPtr.Zero);
        if (count <= 0) return items;
        int bytesPerEntry = charWidth * 2;
        int totalBytes = count * bytesPerEntry;
        IntPtr buffer = Marshal.AllocHGlobal(totalBytes);
        try
        {
            Marshal.Copy(new byte[totalBytes], 0, buffer, totalBytes);
            int fetched = WinSpoolInterop.DeviceCapabilities(printerName, portName, capability, buffer, IntPtr.Zero);
            var chars = new char[charWidth];
            for (int i = 0; i < Math.Min(count, fetched); i++)
            {
                IntPtr entryPtr = IntPtr.Add(buffer, i * bytesPerEntry);
                Marshal.Copy(entryPtr, chars, 0, charWidth);
                int nullPos = Array.IndexOf(chars, '\0');
                int len = nullPos >= 0 ? nullPos : charWidth;
                string text = SanitizeDriverText(new string(chars, 0, len));
                if (!string.IsNullOrWhiteSpace(text)) items.Add(text);
            }
        }
        finally { Marshal.FreeHGlobal(buffer); }
        return items;
    }

    public PrinterInfoDto? UpdateProfile(PrinterProfileDto profile)
    {
        _profiles[profile.PrinterName] = profile;
        return ListPrinters().FirstOrDefault(p =>
            string.Equals(p.Name, profile.PrinterName, StringComparison.OrdinalIgnoreCase));
    }

    public bool SetDefaultPrinter(string printerName)
    {
        return WinSpoolInterop.SetDefaultPrinter(printerName);
    }

    /// <summary>
    /// Submits rendered imposed PNG sheet pages directly to the selected Windows Spooler queue
    /// using WPF FixedDocument + PrintTicket on an STA thread.
    /// </summary>
    public SpoolerJobDto SubmitPrintJob(PrintJobRpcParams request)
    {
        if (string.IsNullOrWhiteSpace(request.PrinterName))
            throw new ArgumentException("PrinterName is required.");

        var imagePaths = request.PageImagePaths?.Where(File.Exists).ToList() ?? new List<string>();
        if (imagePaths.Count == 0)
            throw new InvalidOperationException("No rendered sheet images were supplied for printing.");

        SpoolerJobDto? jobResult = null;
        Exception? captured = null;

        var staThread = new Thread(() =>
        {
            try
            {
                jobResult = SubmitFixedDocumentOnSta(request, imagePaths);
            }
            catch (Exception ex)
            {
                captured = ex;
            }
        });
        staThread.SetApartmentState(ApartmentState.STA);
        staThread.Start();
        staThread.Join();

        if (captured != null)
            throw new InvalidOperationException(captured.Message, captured);

        return jobResult ?? throw new InvalidOperationException("Print submission completed without job metadata.");
    }

    private static SpoolerJobDto SubmitFixedDocumentOnSta(PrintJobRpcParams request, List<string> imagePaths)
    {
        const double dipPerMm = 96.0 / 25.4;
        using var server = new LocalPrintServer();
        var queue = server.GetPrintQueues(new[]
        {
            EnumeratedPrintQueueTypes.Local,
            EnumeratedPrintQueueTypes.Connections
        }).FirstOrDefault(q => string.Equals(q.FullName, request.PrinterName, StringComparison.OrdinalIgnoreCase));

        if (queue == null)
            throw new InvalidOperationException($"Windows printer \"{request.PrinterName}\" was not found.");

        using (queue)
        {
            queue.Refresh();
            var baseTicket = (queue.UserPrintTicket ?? queue.DefaultPrintTicket ?? new PrintTicket()).Clone();
            double widthMm = request.PaperWidthMm is > 10 ? request.PaperWidthMm.Value : 210;
            double heightMm = request.PaperHeightMm is > 10 ? request.PaperHeightMm.Value : 297;
            bool isLandscape = string.Equals(request.Orientation, "landscape", StringComparison.OrdinalIgnoreCase);

            var shortDip = Math.Min(widthMm, heightMm) * dipPerMm;
            var longDip = Math.Max(widthMm, heightMm) * dipPerMm;
            baseTicket.PageMediaSize = new PageMediaSize(shortDip, longDip);
            baseTicket.PageOrientation = isLandscape ? PageOrientation.Landscape : PageOrientation.Portrait;
            baseTicket.CopyCount = Math.Max(1, Math.Min(999, request.Copies));
            baseTicket.Collation = request.Collate ? Collation.Collated : Collation.Uncollated;
            baseTicket.OutputColor = string.Equals(request.ColorMode, "bw", StringComparison.OrdinalIgnoreCase)
                ? OutputColor.Monochrome
                : OutputColor.Color;
            baseTicket.Duplexing = request.DuplexMode switch
            {
                "long-edge" => Duplexing.TwoSidedLongEdge,
                "short-edge" => Duplexing.TwoSidedShortEdge,
                _ => Duplexing.OneSided
            };
            if (request.Dpi >= 72)
                baseTicket.PageResolution = new PageResolution(request.Dpi, request.Dpi);
            if (string.Equals(request.Quality, "draft", StringComparison.OrdinalIgnoreCase))
                baseTicket.OutputQuality = OutputQuality.Draft;
            else if (string.Equals(request.Quality, "high", StringComparison.OrdinalIgnoreCase))
                baseTicket.OutputQuality = OutputQuality.High;
            else
                baseTicket.OutputQuality = OutputQuality.Normal;

            if (request.Borderless == true)
                baseTicket.PageBorderless = PageBorderless.Borderless;

            var validated = queue.MergeAndValidatePrintTicket(queue.DefaultPrintTicket ?? new PrintTicket(), baseTicket).ValidatedPrintTicket;

            double pageWidthDip = (isLandscape ? Math.Max(widthMm, heightMm) : Math.Min(widthMm, heightMm)) * dipPerMm;
            double pageHeightDip = (isLandscape ? Math.Min(widthMm, heightMm) : Math.Max(widthMm, heightMm)) * dipPerMm;

            var fixedDoc = new FixedDocument();
            fixedDoc.DocumentPaginator.PageSize = new Size(pageWidthDip, pageHeightDip);

            foreach (var imgPath in imagePaths)
            {
                var bitmap = new BitmapImage();
                using (var fs = File.OpenRead(imgPath))
                {
                    bitmap.BeginInit();
                    bitmap.CacheOption = BitmapCacheOption.OnLoad;
                    bitmap.StreamSource = fs;
                    bitmap.EndInit();
                }
                bitmap.Freeze();

                var page = new FixedPage
                {
                    Width = pageWidthDip,
                    Height = pageHeightDip,
                    Background = Brushes.White
                };
                var imageControl = new Image
                {
                    Source = bitmap,
                    Width = pageWidthDip,
                    Height = pageHeightDip,
                    Stretch = Stretch.Uniform
                };
                FixedPage.SetLeft(imageControl, 0);
                FixedPage.SetTop(imageControl, 0);
                page.Children.Add(imageControl);
                page.Measure(new Size(pageWidthDip, pageHeightDip));
                page.Arrange(new Rect(new Size(pageWidthDip, pageHeightDip)));
                page.UpdateLayout();

                var content = new PageContent();
                ((IAddChild)content).AddChild(page);
                fixedDoc.Pages.Add(content);
            }

            var writer = PrintQueue.CreateXpsDocumentWriter(queue);
            writer.Write(fixedDoc, validated);

            queue.Refresh();
            var latestJob = queue.GetPrintJobInfoCollection()
                .OrderByDescending(j => j.JobIdentifier)
                .FirstOrDefault();

            return new SpoolerJobDto(
                JobId: latestJob?.JobIdentifier ?? Environment.TickCount,
                PrinterName: queue.FullName,
                DocumentTitle: string.IsNullOrWhiteSpace(request.JobTitle) ? "PrintStudio Document" : request.JobTitle,
                UserName: latestJob?.Submitter ?? Environment.UserName,
                Status: latestJob != null ? MapJobStatus(latestJob.JobStatus) : "Spooling",
                TotalPages: imagePaths.Count,
                PagesPrinted: latestJob?.NumberOfPagesPrinted ?? 0,
                SizeBytes: latestJob?.JobSize ?? 0,
                Priority: latestJob != null ? (int)latestJob.Priority : 1,
                SubmittedAt: DateTime.UtcNow.ToString("O")
            );
        }
    }

    public IReadOnlyList<SpoolerJobDto> ListJobs(string? printerFilter = null)
    {
        var jobs = new List<SpoolerJobDto>();
        try
        {
            foreach (var queue in OpenQueues(printerFilter))
            {
                try
                {
                    queue.Refresh();
                    var queueName = queue.FullName;
                    foreach (var job in queue.GetPrintJobInfoCollection())
                    {
                        jobs.Add(new SpoolerJobDto(
                            JobId: job.JobIdentifier,
                            PrinterName: queueName,
                            DocumentTitle: job.Name ?? "PrintStudio Document",
                            UserName: job.Submitter ?? Environment.UserName,
                            Status: MapJobStatus(job.JobStatus),
                            TotalPages: Math.Max(1, job.NumberOfPages),
                            PagesPrinted: Math.Max(0, job.NumberOfPagesPrinted),
                            SizeBytes: job.JobSize,
                            Priority: (int)job.Priority,
                            SubmittedAt: job.TimeJobSubmitted.ToString("O")
                        ));
                    }
                }
                catch (Exception ex)
                {
                    Program.Log($"Skipping jobs of queue '{SafeQueueName(queue)}': {ex.Message}");
                }
            }
        }
        catch (Exception ex)
        {
            Program.Log($"spooler job enumeration failed: {ex.Message}");
        }

        return jobs;
    }

    private static IEnumerable<PrintQueue> OpenQueues(string? printerFilter)
    {
        using var server = new LocalPrintServer();
        var queues = server.GetPrintQueues(new[]
        {
            EnumeratedPrintQueueTypes.Local,
            EnumeratedPrintQueueTypes.Connections
        });

        foreach (var queue in queues)
        {
            string fullName;
            try { fullName = queue.FullName; }
            catch { continue; }

            if (!string.IsNullOrWhiteSpace(printerFilter) &&
                !string.Equals(fullName, printerFilter, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            yield return queue;
        }
    }

    public bool ControlJob(ControlJobParams request)
    {
        var defaults = new WinSpoolInterop.PRINTER_DEFAULTS
        {
            DesiredAccess = 0x000F000C // PRINTER_ALL_ACCESS
        };

        if (!WinSpoolInterop.OpenPrinter(request.PrinterName, out IntPtr hPrinter, ref defaults))
        {
            return false;
        }

        try
        {
            int command = request.Action.ToLowerInvariant() switch
            {
                "pause" => WinSpoolInterop.JOB_CONTROL_PAUSE,
                "resume" => WinSpoolInterop.JOB_CONTROL_RESUME,
                "restart" => WinSpoolInterop.JOB_CONTROL_RESTART,
                "cancel" => WinSpoolInterop.JOB_CONTROL_CANCEL,
                _ => WinSpoolInterop.JOB_CONTROL_CANCEL
            };

            return WinSpoolInterop.SetJob(hPrinter, request.JobId, 0, IntPtr.Zero, command);
        }
        finally
        {
            WinSpoolInterop.ClosePrinter(hPrinter);
        }
    }

    public bool PurgeQueue(string printerName)
    {
        var defaults = new WinSpoolInterop.PRINTER_DEFAULTS
        {
            DesiredAccess = 0x000F000C
        };

        if (!WinSpoolInterop.OpenPrinter(printerName, out IntPtr hPrinter, ref defaults))
        {
            return false;
        }

        try
        {
            return WinSpoolInterop.SetPrinter(hPrinter, 0, IntPtr.Zero, WinSpoolInterop.PRINTER_CONTROL_PURGE);
        }
        finally
        {
            WinSpoolInterop.ClosePrinter(hPrinter);
        }
    }

    private static string MapQueueStatus(PrintQueue q)
    {
        if (q.IsPaperJammed) return "PaperJam";
        if (q.IsOutOfPaper) return "OutOfPaper";
        if (q.IsDoorOpened) return "DoorOpen";
        if (q.IsTonerLow) return "LowToner";
        if (q.IsOffline) return "Offline";
        if (q.IsPaused) return "Paused";
        if (q.IsPrinting) return "Printing";
        if (q.IsInError) return "Error";
        return "Ready";
    }

    private static string MapJobStatus(PrintJobStatus status)
    {
        if (status.HasFlag(PrintJobStatus.Error)) return "Error";
        if (status.HasFlag(PrintJobStatus.Paused)) return "Paused";
        if (status.HasFlag(PrintJobStatus.Printing)) return "Printing";
        if (status.HasFlag(PrintJobStatus.Spooling)) return "Spooling";
        if (status.HasFlag(PrintJobStatus.Completed) || status.HasFlag(PrintJobStatus.Printed)) return "Completed";
        if (status.HasFlag(PrintJobStatus.Deleted) || status.HasFlag(PrintJobStatus.Deleting)) return "Canceled";
        return "Spooling";
    }
}

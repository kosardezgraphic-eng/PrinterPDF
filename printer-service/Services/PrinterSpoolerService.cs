using System.IO;
using System.Printing;
using System.Printing.Interop;
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
                        : ReadEffectiveProfile(name, port, caps, queue, IntPtr.Zero);
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
                    profile = ReadEffectiveProfile(name, port, caps, queue, info.pDevMode);
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
                    : ReadEffectiveProfile(name, string.Empty, caps, null, IntPtr.Zero);
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

                var portName = SanitizeDriverText(queue.QueuePort?.Name);
                var gdiMargins = TryGetGdiPrinterMargins(queue.FullName, portName, request);
                var wpfMargins = TryGetWpfPrinterMargins(queue, request);

                static double MaxSide(PrinterMarginsDto m) => Math.Max(Math.Max(m.Top, m.Right), Math.Max(m.Bottom, m.Left));
                // Real hardware printers either report 0/0/0/0 (borderless) or physical unprintable borders (>= 0.5mm).
                // Values like 0.042mm (42 microns or 1 dot @ 600 DPI) are driver PrintSchema unit-scaling bugs.
                static bool IsPlausible(PrinterMarginsDto? m) => m != null && (MaxSide(m) == 0 || MaxSide(m) >= 0.5);

                bool gdiOk = IsPlausible(gdiMargins);
                bool wpfOk = IsPlausible(wpfMargins);

                if (gdiMargins != null && gdiOk && (MaxSide(gdiMargins) > 0 || wpfMargins == null || !wpfOk || MaxSide(wpfMargins) == 0))
                {
                    if (wpfMargins != null && !wpfOk)
                        Program.Log($"GetPrinterMargins '{queue.FullName}': rejected implausible WPF margins ({wpfMargins.Top}/{wpfMargins.Right}/{wpfMargins.Bottom}/{wpfMargins.Left} mm), using GDI ({gdiMargins.Top}/{gdiMargins.Right}/{gdiMargins.Bottom}/{gdiMargins.Left} mm)");
                    return new PrinterMarginResultDto("available", "hardware", gdiMargins);
                }

                if (wpfMargins != null && wpfOk)
                    return new PrinterMarginResultDto("available", "hardware", wpfMargins);

                if (gdiMargins != null || wpfMargins != null)
                {
                    Program.Log($"GetPrinterMargins '{queue.FullName}': rejected implausible non-zero margins gdi={gdiMargins?.Top}/{gdiMargins?.Right}/{gdiMargins?.Bottom}/{gdiMargins?.Left} wpf={wpfMargins?.Top}/{wpfMargins?.Right}/{wpfMargins?.Bottom}/{wpfMargins?.Left}");
                    return Unavailable("Driver reported implausibly small non-zero hardware margins");
                }

                return Unavailable("Driver did not report the requested paper size and imageable area");
            }
        }
        catch (Exception ex)
        {
            return Unavailable($"Cannot query printer imageable area: {ex.Message}");
        }
    }

    private static PrinterMarginsDto? TryGetWpfPrinterMargins(PrintQueue queue, PrinterMarginRequestDto request)
    {
        try
        {
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
            if (name == null && request.PaperSize != "Custom") return null;
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
                return null;
            double left = area.OriginWidth, top = area.OriginHeight;
            double right = width.Value - left - area.ExtentWidth, bottom = height.Value - top - area.ExtentHeight;
            if (!double.IsFinite(left) || !double.IsFinite(top) || !double.IsFinite(right) || !double.IsFinite(bottom) ||
                area.ExtentWidth <= 0 || area.ExtentHeight <= 0 || Math.Min(Math.Min(left, right), Math.Min(top, bottom)) < -0.5)
                return null;
            static double Mm(double dip) => Math.Round(Math.Max(0, dip) / dipPerMm, 3);
            return new PrinterMarginsDto(Mm(top), Mm(right), Mm(bottom), Mm(left));
        }
        catch
        {
            return null;
        }
    }

    private static PrinterMarginsDto? TryGetGdiPrinterMargins(string printerName, string portName, PrinterMarginRequestDto request)
    {
        IntPtr hPrinter = IntPtr.Zero;
        IntPtr pDevMode = IntPtr.Zero;
        IntPtr hdc = IntPtr.Zero;
        try
        {
            if (!WinSpoolInterop.OpenPrinter(printerName, out hPrinter, IntPtr.Zero) || hPrinter == IntPtr.Zero)
                return null;

            int dmSize = WinSpoolInterop.DocumentProperties(IntPtr.Zero, hPrinter, printerName, IntPtr.Zero, IntPtr.Zero, 0);
            if (dmSize <= 0) return null;

            pDevMode = Marshal.AllocHGlobal(dmSize);
            if (WinSpoolInterop.DocumentProperties(IntPtr.Zero, hPrinter, printerName, pDevMode, IntPtr.Zero, WinSpoolInterop.DM_OUT_BUFFER) < 0)
                return null;

            double shortMm = Math.Min(request.WidthMm, request.HeightMm);
            double longMm = Math.Max(request.WidthMm, request.HeightMm);
            var paperOptions = ReadSupportedPaperOptions(printerName, portName);
            short? matchedRawKind = null;
            var exactIdMatch = paperOptions.FirstOrDefault(o =>
                o.RawKind.HasValue &&
                string.Equals(o.Id, request.PaperSize, StringComparison.OrdinalIgnoreCase) &&
                Math.Abs(Math.Min(o.WidthMm, o.HeightMm) - shortMm) <= 2.2 &&
                Math.Abs(Math.Max(o.WidthMm, o.HeightMm) - longMm) <= 2.2);
            if (exactIdMatch?.RawKind is int exactRk)
            {
                matchedRawKind = (short)exactRk;
            }
            else
            {
                var dimMatch = paperOptions.FirstOrDefault(o =>
                    o.RawKind.HasValue &&
                    Math.Abs(Math.Min(o.WidthMm, o.HeightMm) - shortMm) <= 2.0 &&
                    Math.Abs(Math.Max(o.WidthMm, o.HeightMm) - longMm) <= 2.0);
                if (dimMatch?.RawKind is int dimRk)
                    matchedRawKind = (short)dimRk;
            }

            matchedRawKind ??= request.PaperSize switch
            {
                "Letter" => (short)1,
                "Legal" => (short)5,
                "A3" => (short)8,
                "A4" => (short)9,
                "A5" => (short)11,
                "B4" => (short)12,
                "B5" => (short)13,
                "A2" => (short)66,
                "A1" => (short)67,
                "A0" => (short)68,
                "A6" => (short)70,
                _ => (short?)null
            };

            if (matchedRawKind == null && request.PaperSize != "Custom")
                return null;

            int fieldsOffset = Marshal.OffsetOf<WinSpoolInterop.DEVMODEW>(nameof(WinSpoolInterop.DEVMODEW.dmFields)).ToInt32();
            int orientOffset = Marshal.OffsetOf<WinSpoolInterop.DEVMODEW>(nameof(WinSpoolInterop.DEVMODEW.dmOrientation)).ToInt32();
            int paperSizeOffset = Marshal.OffsetOf<WinSpoolInterop.DEVMODEW>(nameof(WinSpoolInterop.DEVMODEW.dmPaperSize)).ToInt32();
            int paperLengthOffset = Marshal.OffsetOf<WinSpoolInterop.DEVMODEW>(nameof(WinSpoolInterop.DEVMODEW.dmPaperLength)).ToInt32();
            int paperWidthOffset = Marshal.OffsetOf<WinSpoolInterop.DEVMODEW>(nameof(WinSpoolInterop.DEVMODEW.dmPaperWidth)).ToInt32();

            int dmFields = Marshal.ReadInt32(pDevMode, fieldsOffset);
            dmFields |= WinSpoolInterop.DM_ORIENTATION;
            Marshal.WriteInt16(pDevMode, orientOffset, (short)(request.Orientation == "landscape" ? 2 : 1));

            if (matchedRawKind.HasValue)
            {
                dmFields |= WinSpoolInterop.DM_PAPERSIZE;
                dmFields &= ~(WinSpoolInterop.DM_PAPERWIDTH | WinSpoolInterop.DM_PAPERLENGTH);
                Marshal.WriteInt16(pDevMode, paperSizeOffset, matchedRawKind.Value);
            }
            else
            {
                dmFields |= WinSpoolInterop.DM_PAPERSIZE | WinSpoolInterop.DM_PAPERWIDTH | WinSpoolInterop.DM_PAPERLENGTH;
                Marshal.WriteInt16(pDevMode, paperSizeOffset, WinSpoolInterop.DMPAPER_USER);
                Marshal.WriteInt16(pDevMode, paperWidthOffset, (short)Math.Clamp((int)Math.Round(shortMm * 10.0), 100, 20000));
                Marshal.WriteInt16(pDevMode, paperLengthOffset, (short)Math.Clamp((int)Math.Round(longMm * 10.0), 100, 20000));
            }
            Marshal.WriteInt32(pDevMode, fieldsOffset, dmFields);

            WinSpoolInterop.DocumentProperties(IntPtr.Zero, hPrinter, printerName, pDevMode, pDevMode, WinSpoolInterop.DM_IN_BUFFER | WinSpoolInterop.DM_OUT_BUFFER);

            hdc = WinSpoolInterop.CreateDC("WINSPOOL", printerName, null, pDevMode);
            if (hdc == IntPtr.Zero) return null;

            int dpiX = WinSpoolInterop.GetDeviceCaps(hdc, WinSpoolInterop.LOGPIXELSX);
            int dpiY = WinSpoolInterop.GetDeviceCaps(hdc, WinSpoolInterop.LOGPIXELSY);
            int physW = WinSpoolInterop.GetDeviceCaps(hdc, WinSpoolInterop.PHYSICALWIDTH);
            int physH = WinSpoolInterop.GetDeviceCaps(hdc, WinSpoolInterop.PHYSICALHEIGHT);
            int offX = WinSpoolInterop.GetDeviceCaps(hdc, WinSpoolInterop.PHYSICALOFFSETX);
            int offY = WinSpoolInterop.GetDeviceCaps(hdc, WinSpoolInterop.PHYSICALOFFSETY);
            int horzRes = WinSpoolInterop.GetDeviceCaps(hdc, WinSpoolInterop.HORZRES);
            int vertRes = WinSpoolInterop.GetDeviceCaps(hdc, WinSpoolInterop.VERTRES);

            if (dpiX <= 0 || dpiY <= 0 || physW <= 0 || physH <= 0 || horzRes <= 0 || vertRes <= 0)
                return null;

            double gdiWidthMm = physW * 25.4 / dpiX;
            double gdiHeightMm = physH * 25.4 / dpiY;
            if (Math.Abs(gdiWidthMm - request.WidthMm) > 2.5 || Math.Abs(gdiHeightMm - request.HeightMm) > 2.5)
                return null;

            double leftMm = offX * 25.4 / dpiX;
            double topMm = offY * 25.4 / dpiY;
            double rightMm = (physW - offX - horzRes) * 25.4 / dpiX;
            double bottomMm = (physH - offY - vertRes) * 25.4 / dpiY;
            if (Math.Min(Math.Min(leftMm, rightMm), Math.Min(topMm, bottomMm)) < -0.5)
                return null;

            static double RoundMm(double v) => Math.Round(Math.Max(0, v), 2);
            return new PrinterMarginsDto(RoundMm(topMm), RoundMm(rightMm), RoundMm(bottomMm), RoundMm(leftMm));
        }
        catch
        {
            return null;
        }
        finally
        {
            if (hdc != IntPtr.Zero) WinSpoolInterop.DeleteDC(hdc);
            if (pDevMode != IntPtr.Zero) Marshal.FreeHGlobal(pDevMode);
            if (hPrinter != IntPtr.Zero) WinSpoolInterop.ClosePrinter(hPrinter);
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

    private static PrinterProfileDto ReadEffectiveProfile(
        string printerName,
        string portName,
        PrinterCapabilitiesDto caps,
        PrintQueue? queue,
        IntPtr fallbackDevMode)
    {
        IntPtr hPrinter = IntPtr.Zero;
        IntPtr pDevMode = IntPtr.Zero;
        try
        {
            if (WinSpoolInterop.OpenPrinter(printerName, out hPrinter, IntPtr.Zero) && hPrinter != IntPtr.Zero)
            {
                int dmSize = WinSpoolInterop.DocumentProperties(IntPtr.Zero, hPrinter, printerName, IntPtr.Zero, IntPtr.Zero, 0);
                if (dmSize > 0)
                {
                    pDevMode = Marshal.AllocHGlobal(dmSize);
                    if (WinSpoolInterop.DocumentProperties(IntPtr.Zero, hPrinter, printerName, pDevMode, IntPtr.Zero, WinSpoolInterop.DM_OUT_BUFFER) >= 0)
                    {
                        return ReadActiveProfile(printerName, portName, caps, queue, pDevMode);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Program.Log($"ReadEffectiveProfile('{printerName}') fell back to fallback DEVMODE: {ex.Message}");
        }
        finally
        {
            if (pDevMode != IntPtr.Zero) Marshal.FreeHGlobal(pDevMode);
            if (hPrinter != IntPtr.Zero) WinSpoolInterop.ClosePrinter(hPrinter);
        }

        return ReadActiveProfile(printerName, portName, caps, queue, fallbackDevMode);
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
        string mediaType = caps.SupportedMediaTypes.FirstOrDefault() ?? "Plain Paper";
        string duplexMode = "none";
        string colorMode = caps.SupportsColor ? "color" : "monochrome";
        int dpi = caps.SupportedDpi.Contains(600) ? 600 : caps.SupportedDpi.FirstOrDefault(300);
        string quality = "normal";
        bool collate = true;
        string? staple = null;
        string? holePunch = null;
        string? fold = null;
        string? outputBin = null;
        bool borderless = false;

        if (pDevMode != IntPtr.Zero)
        {
            try
            {
                var dm = Marshal.PtrToStructure<WinSpoolInterop.DEVMODEW>(pDevMode);
                if ((dm.dmFields & WinSpoolInterop.DM_ORIENTATION) != 0)
                    orientation = dm.dmOrientation == WinSpoolInterop.DMORIENT_LANDSCAPE ? "landscape" : "portrait";

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

                if ((dm.dmFields & WinSpoolInterop.DM_MEDIATYPE) != 0 && dm.dmMediaType > 0)
                {
                    var matchedMedia = MatchMediaTypeById(printerName, portName, dm.dmMediaType);
                    if (!string.IsNullOrWhiteSpace(matchedMedia)) mediaType = matchedMedia;
                }

                if ((dm.dmFields & WinSpoolInterop.DM_DUPLEX) != 0)
                {
                    duplexMode = dm.dmDuplex switch
                    {
                        WinSpoolInterop.DMDUP_VERTICAL => "long-edge",
                        WinSpoolInterop.DMDUP_HORIZONTAL => "short-edge",
                        _ => "none"
                    };
                }

                if ((dm.dmFields & WinSpoolInterop.DM_COLOR) != 0 && caps.SupportsColor)
                {
                    colorMode = dm.dmColor == WinSpoolInterop.DMCOLOR_MONOCHROME ? "monochrome" : "color";
                }

                if ((dm.dmFields & WinSpoolInterop.DM_PRINTQUALITY) != 0 && dm.dmPrintQuality > 0)
                {
                    dpi = dm.dmPrintQuality;
                }

                if ((dm.dmFields & WinSpoolInterop.DM_COLLATE) != 0)
                {
                    collate = dm.dmCollate == WinSpoolInterop.DMCOLLATE_TRUE;
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
                if (ticket != null)
                {
                    var media = ticket.PageMediaSize;
                    if (media?.Width is double w && w > 0 && media?.Height is double h && h > 0)
                    {
                        widthMm ??= Math.Round(w / dipPerMm, 1);
                        heightMm ??= Math.Round(h / dipPerMm, 1);
                        paper ??= MatchPaperSize(widthMm.Value, heightMm.Value);
                    }
                    if (ticket.PageOrientation == PageOrientation.Landscape)
                        orientation = "landscape";
                    else if (ticket.PageOrientation == PageOrientation.Portrait && pDevMode == IntPtr.Zero)
                        orientation = "portrait";

                    if (pDevMode == IntPtr.Zero && ticket.Duplexing.HasValue)
                    {
                        duplexMode = ticket.Duplexing.Value switch
                        {
                            Duplexing.TwoSidedLongEdge => "long-edge",
                            Duplexing.TwoSidedShortEdge => "short-edge",
                            _ => "none"
                        };
                    }

                    if (pDevMode == IntPtr.Zero && ticket.OutputColor.HasValue && caps.SupportsColor)
                    {
                        colorMode = ticket.OutputColor.Value == OutputColor.Monochrome ? "monochrome" : "color";
                    }

                    if (ticket.OutputQuality.HasValue)
                    {
                        quality = ticket.OutputQuality.Value switch
                        {
                            OutputQuality.Draft => "draft",
                            OutputQuality.High => "high",
                            _ => "normal"
                        };
                    }

                    if (pDevMode == IntPtr.Zero && ticket.Collation.HasValue)
                    {
                        collate = ticket.Collation.Value == Collation.Collated;
                    }

                    if (pDevMode == IntPtr.Zero && ticket.PageResolution?.X is int rx && rx >= 72)
                    {
                        dpi = Math.Max(rx, ticket.PageResolution.Y ?? rx);
                    }

                    if (ticket.PageBorderless == PageBorderless.Borderless)
                        borderless = true;

                    try
                    {
                        var ticketDoc = new XmlDocument();
                        using (var tStream = ticket.GetXmlStream())
                            ticketDoc.Load(tStream);

                        var capsDoc = new XmlDocument();
                        using (var cStream = queue.GetPrintCapabilitiesAsXml())
                            capsDoc.Load(cStream);

                        var xmlMedia = ReadTicketFeatureDisplayName(ticketDoc, capsDoc, "PageMediaType");
                        if (!string.IsNullOrWhiteSpace(xmlMedia) && (pDevMode == IntPtr.Zero || mediaType == (caps.SupportedMediaTypes.FirstOrDefault() ?? "Plain Paper")))
                            mediaType = xmlMedia;

                        var xmlTray = ReadTicketFeatureDisplayName(ticketDoc, capsDoc, "InputBin");
                        if (!string.IsNullOrWhiteSpace(xmlTray) && pDevMode == IntPtr.Zero)
                            tray = xmlTray;

                        var xmlPaperName = ReadTicketFeatureDisplayName(ticketDoc, capsDoc, "PageMediaSize");
                        if (!string.IsNullOrWhiteSpace(xmlPaperName))
                            paperName ??= xmlPaperName;

                        staple = ReadTicketFeatureDisplayName(ticketDoc, capsDoc, "Staple");
                        holePunch = ReadTicketFeatureDisplayName(ticketDoc, capsDoc, "HolePunch");
                        fold = ReadTicketFeatureDisplayName(ticketDoc, capsDoc, "Fold");
                        outputBin = ReadTicketFeatureDisplayName(ticketDoc, capsDoc, "OutputBin");
                    }
                    catch
                    {
                        // Optional XML enrichment
                    }
                }
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
            MediaType: mediaType,
            DuplexMode: duplexMode,
            Orientation: orientation,
            ColorMode: colorMode,
            Dpi: dpi,
            Quality: quality,
            PaperWidthMm: widthMm.HasValue && heightMm.HasValue ? Math.Min(widthMm.Value, heightMm.Value) : null,
            PaperHeightMm: widthMm.HasValue && heightMm.HasValue ? Math.Max(widthMm.Value, heightMm.Value) : null,
            PaperName: paperName ?? paper,
            Collate: collate,
            Staple: string.IsNullOrWhiteSpace(staple) ? null : staple,
            OutputBin: string.IsNullOrWhiteSpace(outputBin) ? null : outputBin,
            HolePunch: string.IsNullOrWhiteSpace(holePunch) ? null : holePunch,
            Fold: string.IsNullOrWhiteSpace(fold) ? null : fold,
            Borderless: borderless ? true : null
        );
    }

    private static string? ReadTicketFeatureDisplayName(XmlDocument ticketDoc, XmlDocument capsDoc, string featureContains)
    {
        var optNode = ticketDoc.SelectSingleNode($"//*[local-name()='Feature' and contains(@name, '{featureContains}')]/*[local-name()='Option']") as XmlElement;
        var optName = optNode?.GetAttribute("name");
        if (string.IsNullOrWhiteSpace(optName)) return null;

        var capOpt = capsDoc.SelectSingleNode($"//*[local-name()='Feature' and contains(@name, '{featureContains}')]/*[local-name()='Option' and @name='{optName}']");
        var dn = capOpt?.SelectSingleNode("./*[local-name()='Property' and contains(@name,'DisplayName')]/*[local-name()='Value']")?.InnerText;
        var colonIdx = optName.IndexOf(':');
        var cleanRaw = colonIdx >= 0 ? optName[(colonIdx + 1)..] : optName;
        var resolved = SanitizeDriverText(!string.IsNullOrWhiteSpace(dn) ? dn : cleanRaw);
        return string.IsNullOrWhiteSpace(resolved) ? null : resolved;
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

    private static string? MatchMediaTypeById(string printerName, string portName, int targetMediaId)
    {
        int count = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_MEDIATYPES, IntPtr.Zero, IntPtr.Zero);
        if (count <= 0) return null;
        var names = ReadCapabilityStrings(printerName, portName, WinSpoolInterop.DC_MEDIATYPENAMES, 64);
        int totalBytes = count * sizeof(int);
        var idBuffer = Marshal.AllocHGlobal(totalBytes);
        try
        {
            Marshal.Copy(new byte[totalBytes], 0, idBuffer, totalBytes);
            int fetched = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_MEDIATYPES, idBuffer, IntPtr.Zero);
            for (int i = 0; i < Math.Min(Math.Min(count, fetched), names.Count); i++)
            {
                if (Marshal.ReadInt32(idBuffer, i * sizeof(int)) == targetMediaId)
                    return names[i];
            }
        }
        finally
        {
            Marshal.FreeHGlobal(idBuffer);
        }
        return null;
    }

    private static short? FindBinIdByName(string printerName, string portName, string? trayName)
    {
        if (string.IsNullOrWhiteSpace(trayName)) return null;
        int count = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_BINS, IntPtr.Zero, IntPtr.Zero);
        if (count <= 0) return null;
        var names = ReadCapabilityStrings(printerName, portName, WinSpoolInterop.DC_BINNAMES, 24);
        int totalBytes = count * sizeof(short);
        var idBuffer = Marshal.AllocHGlobal(totalBytes);
        try
        {
            Marshal.Copy(new byte[totalBytes], 0, idBuffer, totalBytes);
            int fetched = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_BINS, idBuffer, IntPtr.Zero);
            int limit = Math.Min(Math.Min(count, fetched), names.Count);
            string target = trayName.Trim();

            for (int i = 0; i < limit; i++)
            {
                if (string.Equals(names[i], target, StringComparison.OrdinalIgnoreCase))
                    return Marshal.ReadInt16(idBuffer, i * sizeof(short));
            }
            for (int i = 0; i < limit; i++)
            {
                if (names[i].Contains(target, StringComparison.OrdinalIgnoreCase) ||
                    target.Contains(names[i], StringComparison.OrdinalIgnoreCase))
                    return Marshal.ReadInt16(idBuffer, i * sizeof(short));
            }
            if (target.Contains("auto", StringComparison.OrdinalIgnoreCase))
            {
                for (int i = 0; i < limit; i++)
                {
                    if (names[i].Contains("auto", StringComparison.OrdinalIgnoreCase) ||
                        names[i].Contains("default", StringComparison.OrdinalIgnoreCase))
                        return Marshal.ReadInt16(idBuffer, i * sizeof(short));
                }
                return 7; // DMBIN_AUTO
            }
        }
        finally
        {
            Marshal.FreeHGlobal(idBuffer);
        }
        return null;
    }

    private static int? FindMediaTypeIdByName(string printerName, string portName, string? mediaName)
    {
        if (string.IsNullOrWhiteSpace(mediaName)) return null;
        int count = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_MEDIATYPES, IntPtr.Zero, IntPtr.Zero);
        if (count <= 0) return null;
        var names = ReadCapabilityStrings(printerName, portName, WinSpoolInterop.DC_MEDIATYPENAMES, 64);
        int totalBytes = count * sizeof(int);
        var idBuffer = Marshal.AllocHGlobal(totalBytes);
        try
        {
            Marshal.Copy(new byte[totalBytes], 0, idBuffer, totalBytes);
            int fetched = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_MEDIATYPES, idBuffer, IntPtr.Zero);
            int limit = Math.Min(Math.Min(count, fetched), names.Count);
            string target = mediaName.Trim();

            for (int i = 0; i < limit; i++)
            {
                if (string.Equals(names[i], target, StringComparison.OrdinalIgnoreCase))
                    return Marshal.ReadInt32(idBuffer, i * sizeof(int));
            }
            for (int i = 0; i < limit; i++)
            {
                if (names[i].Contains(target, StringComparison.OrdinalIgnoreCase) ||
                    target.Contains(names[i], StringComparison.OrdinalIgnoreCase))
                    return Marshal.ReadInt32(idBuffer, i * sizeof(int));
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

    public IReadOnlyList<PrinterInfoDto> ReloadPrinters(string? printerName = null)
    {
        if (string.IsNullOrWhiteSpace(printerName))
            _profiles.Clear();
        else
            _profiles.Remove(printerName);
        return ListPrinters();
    }

    public PrinterInfoDto? UpdateProfile(PrinterProfileDto profile)
    {
        _profiles[profile.PrinterName] = profile;
        TryApplyProfileToWindowsPrinter(profile);
        var matched = ListPrinters().FirstOrDefault(p =>
            string.Equals(p.Name, profile.PrinterName, StringComparison.OrdinalIgnoreCase));
        return matched is null
            ? null
            : matched with { ActiveProfile = profile };
    }

    private static (short? RawKind, string? MatchedName, double ShortMm, double LongMm) ResolveDriverPaperMatch(
        string printerName,
        string portName,
        string? paperSize,
        string? paperName,
        double? widthMm,
        double? heightMm)
    {
        var stdDims = paperSize switch
        {
            "A0" => (841.0, 1189.0),
            "A1" => (594.0, 841.0),
            "A2" => (420.0, 594.0),
            "A3" => (297.0, 420.0),
            "A4" => (210.0, 297.0),
            "A5" => (148.0, 210.0),
            "A6" => (105.0, 148.0),
            "B4" => (250.0, 353.0),
            "B5" => (176.0, 250.0),
            "Letter" => (215.9, 279.4),
            "Legal" => (215.9, 355.6),
            _ => (210.0, 297.0)
        };

        double rawW = widthMm is > 10 ? widthMm.Value : stdDims.Item1;
        double rawH = heightMm is > 10 ? heightMm.Value : stdDims.Item2;
        double shortMm = Math.Min(rawW, rawH);
        double longMm = Math.Max(rawW, rawH);

        var options = ReadSupportedPaperOptions(printerName, portName);
        PrinterPaperOptionDto? matched = null;

        if (!string.IsNullOrWhiteSpace(paperName))
        {
            matched = options.FirstOrDefault(o =>
                o.RawKind.HasValue &&
                string.Equals(o.Name, paperName.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        if (matched == null && !string.IsNullOrWhiteSpace(paperSize) && !string.Equals(paperSize, "Custom", StringComparison.OrdinalIgnoreCase))
        {
            matched = options.FirstOrDefault(o =>
                o.RawKind.HasValue &&
                string.Equals(o.Id, paperSize, StringComparison.OrdinalIgnoreCase) &&
                Math.Abs(Math.Min(o.WidthMm, o.HeightMm) - shortMm) <= 2.5 &&
                Math.Abs(Math.Max(o.WidthMm, o.HeightMm) - longMm) <= 2.5);
        }

        if (matched == null)
        {
            matched = options.FirstOrDefault(o =>
                o.RawKind.HasValue &&
                Math.Abs(Math.Min(o.WidthMm, o.HeightMm) - shortMm) <= 2.2 &&
                Math.Abs(Math.Max(o.WidthMm, o.HeightMm) - longMm) <= 2.2);
        }

        short? rawKind = matched?.RawKind is int rk && rk > 0 ? (short)rk : null;
        rawKind ??= paperSize switch
        {
            "Letter" => (short)1,
            "Legal" => (short)5,
            "A3" => (short)8,
            "A4" => (short)9,
            "A5" => (short)11,
            "B4" => (short)12,
            "B5" => (short)13,
            "A2" => (short)66,
            "A1" => (short)67,
            "A0" => (short)68,
            "A6" => (short)70,
            _ => (short?)null
        };

        return (rawKind, matched?.Name ?? paperName, shortMm, longMm);
    }

    private static byte[]? TryBuildConfiguredDevModeBytes(
        string printerName,
        string portName,
        string? paperSize,
        string? paperName,
        double? paperWidthMm,
        double? paperHeightMm,
        string? orientation,
        string? tray,
        string? mediaType,
        string? duplexMode,
        string? colorMode,
        int dpi,
        int? copies,
        bool? collate)
    {
        IntPtr hPrinter = IntPtr.Zero;
        IntPtr pDevMode = IntPtr.Zero;
        try
        {
            var defaults = new WinSpoolInterop.PRINTER_DEFAULTS { DesiredAccess = WinSpoolInterop.PRINTER_ACCESS_USE };
            if (!WinSpoolInterop.OpenPrinter(printerName, out hPrinter, ref defaults) || hPrinter == IntPtr.Zero)
            {
                if (!WinSpoolInterop.OpenPrinter(printerName, out hPrinter, IntPtr.Zero) || hPrinter == IntPtr.Zero)
                    return null;
            }

            int dmBytes = WinSpoolInterop.DocumentProperties(IntPtr.Zero, hPrinter, printerName, IntPtr.Zero, IntPtr.Zero, 0);
            if (dmBytes < Marshal.SizeOf<WinSpoolInterop.DEVMODEW>())
                return null;

            pDevMode = Marshal.AllocHGlobal(dmBytes);
            if (WinSpoolInterop.DocumentProperties(IntPtr.Zero, hPrinter, printerName, pDevMode, IntPtr.Zero, WinSpoolInterop.DM_OUT_BUFFER) < 0)
                return null;

            int fieldsOffset = Marshal.OffsetOf<WinSpoolInterop.DEVMODEW>(nameof(WinSpoolInterop.DEVMODEW.dmFields)).ToInt32();
            int orientOffset = Marshal.OffsetOf<WinSpoolInterop.DEVMODEW>(nameof(WinSpoolInterop.DEVMODEW.dmOrientation)).ToInt32();
            int paperSizeOffset = Marshal.OffsetOf<WinSpoolInterop.DEVMODEW>(nameof(WinSpoolInterop.DEVMODEW.dmPaperSize)).ToInt32();
            int paperLengthOffset = Marshal.OffsetOf<WinSpoolInterop.DEVMODEW>(nameof(WinSpoolInterop.DEVMODEW.dmPaperLength)).ToInt32();
            int paperWidthOffset = Marshal.OffsetOf<WinSpoolInterop.DEVMODEW>(nameof(WinSpoolInterop.DEVMODEW.dmPaperWidth)).ToInt32();
            int copiesOffset = Marshal.OffsetOf<WinSpoolInterop.DEVMODEW>(nameof(WinSpoolInterop.DEVMODEW.dmCopies)).ToInt32();
            int sourceOffset = Marshal.OffsetOf<WinSpoolInterop.DEVMODEW>(nameof(WinSpoolInterop.DEVMODEW.dmDefaultSource)).ToInt32();
            int qualityOffset = Marshal.OffsetOf<WinSpoolInterop.DEVMODEW>(nameof(WinSpoolInterop.DEVMODEW.dmPrintQuality)).ToInt32();
            int colorOffset = Marshal.OffsetOf<WinSpoolInterop.DEVMODEW>(nameof(WinSpoolInterop.DEVMODEW.dmColor)).ToInt32();
            int duplexOffset = Marshal.OffsetOf<WinSpoolInterop.DEVMODEW>(nameof(WinSpoolInterop.DEVMODEW.dmDuplex)).ToInt32();
            int yResOffset = Marshal.OffsetOf<WinSpoolInterop.DEVMODEW>(nameof(WinSpoolInterop.DEVMODEW.dmYResolution)).ToInt32();
            int collateOffset = Marshal.OffsetOf<WinSpoolInterop.DEVMODEW>(nameof(WinSpoolInterop.DEVMODEW.dmCollate)).ToInt32();
            int mediaTypeOffset = Marshal.OffsetOf<WinSpoolInterop.DEVMODEW>(nameof(WinSpoolInterop.DEVMODEW.dmMediaType)).ToInt32();

            // PASS 1: Apply paper size and orientation first so driver paper-change resets do not wipe duplex/tray/media.
            var (matchedRawKind, _, shortMm, longMm) = ResolveDriverPaperMatch(
                printerName, portName, paperSize, paperName, paperWidthMm, paperHeightMm);

            int dmFields = Marshal.ReadInt32(pDevMode, fieldsOffset);
            dmFields |= WinSpoolInterop.DM_ORIENTATION;
            Marshal.WriteInt16(
                pDevMode,
                orientOffset,
                string.Equals(orientation, "landscape", StringComparison.OrdinalIgnoreCase)
                    ? WinSpoolInterop.DMORIENT_LANDSCAPE
                    : WinSpoolInterop.DMORIENT_PORTRAIT);

            if (matchedRawKind.HasValue && matchedRawKind.Value != WinSpoolInterop.DMPAPER_USER)
            {
                dmFields |= WinSpoolInterop.DM_PAPERSIZE;
                dmFields &= ~(WinSpoolInterop.DM_PAPERWIDTH | WinSpoolInterop.DM_PAPERLENGTH | WinSpoolInterop.DM_FORMNAME);
                Marshal.WriteInt16(pDevMode, paperSizeOffset, matchedRawKind.Value);
            }
            else
            {
                dmFields |= WinSpoolInterop.DM_PAPERSIZE | WinSpoolInterop.DM_PAPERWIDTH | WinSpoolInterop.DM_PAPERLENGTH;
                dmFields &= ~WinSpoolInterop.DM_FORMNAME;
                Marshal.WriteInt16(pDevMode, paperSizeOffset, WinSpoolInterop.DMPAPER_USER);
                Marshal.WriteInt16(pDevMode, paperWidthOffset, (short)Math.Clamp((int)Math.Round(shortMm * 10.0), 100, 20000));
                Marshal.WriteInt16(pDevMode, paperLengthOffset, (short)Math.Clamp((int)Math.Round(longMm * 10.0), 100, 20000));
            }
            Marshal.WriteInt32(pDevMode, fieldsOffset, dmFields);
            WinSpoolInterop.DocumentProperties(IntPtr.Zero, hPrinter, printerName, pDevMode, pDevMode, WinSpoolInterop.DM_IN_BUFFER | WinSpoolInterop.DM_OUT_BUFFER);

            // PASS 2: Apply duplex, tray, media type, color, copies, collate, and resolution on top of resolved paper.
            dmFields = Marshal.ReadInt32(pDevMode, fieldsOffset);
            dmFields |= WinSpoolInterop.DM_DUPLEX;
            short dmDuplex = duplexMode switch
            {
                "long-edge" => WinSpoolInterop.DMDUP_VERTICAL,
                "short-edge" => WinSpoolInterop.DMDUP_HORIZONTAL,
                _ => WinSpoolInterop.DMDUP_SIMPLEX
            };
            Marshal.WriteInt16(pDevMode, duplexOffset, dmDuplex);

            short? binId = FindBinIdByName(printerName, portName, tray);
            if (binId.HasValue)
            {
                dmFields |= WinSpoolInterop.DM_DEFAULTSOURCE;
                Marshal.WriteInt16(pDevMode, sourceOffset, binId.Value);
            }

            int? mediaId = FindMediaTypeIdByName(printerName, portName, mediaType);
            if (mediaId.HasValue)
            {
                dmFields |= WinSpoolInterop.DM_MEDIATYPE;
                Marshal.WriteInt32(pDevMode, mediaTypeOffset, mediaId.Value);
            }

            dmFields |= WinSpoolInterop.DM_COLOR;
            bool isMono = string.Equals(colorMode, "bw", StringComparison.OrdinalIgnoreCase) ||
                          string.Equals(colorMode, "monochrome", StringComparison.OrdinalIgnoreCase);
            Marshal.WriteInt16(pDevMode, colorOffset, isMono ? WinSpoolInterop.DMCOLOR_MONOCHROME : WinSpoolInterop.DMCOLOR_COLOR);

            if (copies.HasValue && copies.Value >= 1)
            {
                dmFields |= WinSpoolInterop.DM_COPIES;
                Marshal.WriteInt16(pDevMode, copiesOffset, (short)Math.Clamp(copies.Value, 1, 999));
            }

            if (collate.HasValue)
            {
                dmFields |= WinSpoolInterop.DM_COLLATE;
                Marshal.WriteInt16(pDevMode, collateOffset, collate.Value ? WinSpoolInterop.DMCOLLATE_TRUE : WinSpoolInterop.DMCOLLATE_FALSE);
            }

            if (dpi >= 72)
            {
                dmFields |= WinSpoolInterop.DM_PRINTQUALITY | WinSpoolInterop.DM_YRESOLUTION;
                Marshal.WriteInt16(pDevMode, qualityOffset, (short)Math.Clamp(dpi, 72, 9600));
                Marshal.WriteInt16(pDevMode, yResOffset, (short)Math.Clamp(dpi, 72, 9600));
            }

            Marshal.WriteInt32(pDevMode, fieldsOffset, dmFields);
            WinSpoolInterop.DocumentProperties(IntPtr.Zero, hPrinter, printerName, pDevMode, pDevMode, WinSpoolInterop.DM_IN_BUFFER | WinSpoolInterop.DM_OUT_BUFFER);

            var bytes = new byte[dmBytes];
            Marshal.Copy(pDevMode, bytes, 0, dmBytes);
            return bytes;
        }
        catch (Exception ex)
        {
            Program.Log($"TryBuildConfiguredDevModeBytes('{printerName}') failed: {ex.Message}");
            return null;
        }
        finally
        {
            if (pDevMode != IntPtr.Zero) Marshal.FreeHGlobal(pDevMode);
            if (hPrinter != IntPtr.Zero) WinSpoolInterop.ClosePrinter(hPrinter);
        }
    }

    private static bool TryWritePerUserDevMode(string printerName, byte[] devModeBytes)
    {
        IntPtr hPrinter = IntPtr.Zero;
        GCHandle pinned = default;
        try
        {
            var defaults = new WinSpoolInterop.PRINTER_DEFAULTS { DesiredAccess = WinSpoolInterop.PRINTER_ACCESS_USE };
            if (!WinSpoolInterop.OpenPrinter(printerName, out hPrinter, ref defaults) || hPrinter == IntPtr.Zero)
            {
                if (!WinSpoolInterop.OpenPrinter(printerName, out hPrinter, IntPtr.Zero) || hPrinter == IntPtr.Zero)
                    return false;
            }

            pinned = GCHandle.Alloc(devModeBytes, GCHandleType.Pinned);
            var info9 = new WinSpoolInterop.PRINTER_INFO_9 { pDevMode = pinned.AddrOfPinnedObject() };
            return WinSpoolInterop.SetPrinter(hPrinter, 9, ref info9, 0);
        }
        catch (Exception ex)
        {
            Program.Log($"TryWritePerUserDevMode('{printerName}') failed: {ex.Message}");
            return false;
        }
        finally
        {
            if (pinned.IsAllocated) pinned.Free();
            if (hPrinter != IntPtr.Zero) WinSpoolInterop.ClosePrinter(hPrinter);
        }
    }

    private static void TryApplyProfileToWindowsPrinter(PrinterProfileDto profile)
    {
        try
        {
            string portName = string.Empty;
            using var server = new LocalPrintServer();
            var queue = server.GetPrintQueues(new[]
            {
                EnumeratedPrintQueueTypes.Local,
                EnumeratedPrintQueueTypes.Connections
            }).FirstOrDefault(q => string.Equals(q.FullName, profile.PrinterName, StringComparison.OrdinalIgnoreCase));

            if (queue != null)
            {
                using (queue)
                {
                    portName = SanitizeDriverText(queue.QueuePort?.Name);
                    var devModeBytes = TryBuildConfiguredDevModeBytes(
                        printerName: profile.PrinterName,
                        portName: portName,
                        paperSize: profile.PaperSize,
                        paperName: profile.PaperName,
                        paperWidthMm: profile.PaperWidthMm,
                        paperHeightMm: profile.PaperHeightMm,
                        orientation: profile.Orientation,
                        tray: profile.Tray,
                        mediaType: profile.MediaType,
                        duplexMode: profile.DuplexMode,
                        colorMode: profile.ColorMode,
                        dpi: profile.Dpi,
                        copies: null,
                        collate: profile.Collate
                    );
                    if (devModeBytes != null)
                        TryWritePerUserDevMode(profile.PrinterName, devModeBytes);

                    try
                    {
                        var validated = BuildValidatedPrintTicket(
                            queue,
                            portName,
                            devModeBytes,
                            paperSize: profile.PaperSize,
                            paperName: profile.PaperName,
                            paperWidthMm: profile.PaperWidthMm,
                            paperHeightMm: profile.PaperHeightMm,
                            orientation: profile.Orientation,
                            tray: profile.Tray,
                            mediaType: profile.MediaType,
                            duplexMode: profile.DuplexMode,
                            colorMode: profile.ColorMode,
                            dpi: profile.Dpi,
                            quality: profile.Quality,
                            copies: 1,
                            collate: profile.Collate ?? true,
                            staple: profile.Staple,
                            holePunch: profile.HolePunch,
                            fold: profile.Fold,
                            outputBin: profile.OutputBin,
                            borderless: profile.Borderless ?? false
                        );
                        queue.UserPrintTicket = validated;
                        queue.Commit();
                    }
                    catch (Exception ex)
                    {
                        Program.Log($"UserPrintTicket commit skipped for '{profile.PrinterName}': {ex.Message}");
                    }
                    return;
                }
            }

            var fallbackDevMode = TryBuildConfiguredDevModeBytes(
                printerName: profile.PrinterName,
                portName: portName,
                paperSize: profile.PaperSize,
                paperName: profile.PaperName,
                paperWidthMm: profile.PaperWidthMm,
                paperHeightMm: profile.PaperHeightMm,
                orientation: profile.Orientation,
                tray: profile.Tray,
                mediaType: profile.MediaType,
                duplexMode: profile.DuplexMode,
                colorMode: profile.ColorMode,
                dpi: profile.Dpi,
                copies: null,
                collate: profile.Collate
            );
            if (fallbackDevMode != null)
                TryWritePerUserDevMode(profile.PrinterName, fallbackDevMode);
        }
        catch (Exception ex)
        {
            Program.Log($"TryApplyProfileToWindowsPrinter('{profile.PrinterName}') failed: {ex.Message}");
        }
    }

    private static PrintTicket BuildValidatedPrintTicket(
        PrintQueue queue,
        string portName,
        byte[]? devModeBytes,
        string? paperSize,
        string? paperName,
        double? paperWidthMm,
        double? paperHeightMm,
        string? orientation,
        string? tray,
        string? mediaType,
        string? duplexMode,
        string? colorMode,
        int dpi,
        string? quality,
        int copies,
        bool collate,
        string? staple,
        string? holePunch,
        string? fold,
        string? outputBin,
        bool borderless)
    {
        const double dipPerMm = 96.0 / 25.4;
        PrintTicket ticket;
        if (devModeBytes != null)
        {
            try
            {
                using var converter = new PrintTicketConverter(queue.FullName, queue.ClientPrintSchemaVersion);
                ticket = converter.ConvertDevModeToPrintTicket(devModeBytes);
            }
            catch (Exception ex)
            {
                Program.Log($"ConvertDevModeToPrintTicket('{queue.FullName}') fallback: {ex.Message}");
                ticket = (queue.UserPrintTicket ?? queue.DefaultPrintTicket ?? new PrintTicket()).Clone();
            }
        }
        else
        {
            ticket = (queue.UserPrintTicket ?? queue.DefaultPrintTicket ?? new PrintTicket()).Clone();
        }

        bool isLandscape = string.Equals(orientation, "landscape", StringComparison.OrdinalIgnoreCase);
        ticket.PageOrientation = isLandscape ? PageOrientation.Landscape : PageOrientation.Portrait;
        ticket.CopyCount = Math.Max(1, Math.Min(999, copies));
        ticket.Collation = collate ? Collation.Collated : Collation.Uncollated;
        ticket.OutputColor = string.Equals(colorMode, "bw", StringComparison.OrdinalIgnoreCase) ||
                             string.Equals(colorMode, "monochrome", StringComparison.OrdinalIgnoreCase)
            ? OutputColor.Monochrome
            : OutputColor.Color;
        ticket.Duplexing = duplexMode switch
        {
            "long-edge" => Duplexing.TwoSidedLongEdge,
            "short-edge" => Duplexing.TwoSidedShortEdge,
            _ => Duplexing.OneSided
        };
        ticket.OutputQuality = quality?.ToLowerInvariant() switch
        {
            "draft" => OutputQuality.Draft,
            "high" => OutputQuality.High,
            _ => OutputQuality.Normal
        };
        if (borderless)
            ticket.PageBorderless = PageBorderless.Borderless;

        var (_, _, shortMm, longMm) = ResolveDriverPaperMatch(
            queue.FullName, portName, paperSize, paperName, paperWidthMm, paperHeightMm);

        bool ticketMediaMatches =
            ticket.PageMediaSize?.Width is double tw &&
            ticket.PageMediaSize?.Height is double th &&
            Math.Abs(Math.Min(tw, th) / dipPerMm - shortMm) <= 2.5 &&
            Math.Abs(Math.Max(tw, th) / dipPerMm - longMm) <= 2.5;

        if (!ticketMediaMatches)
        {
            PageMediaSizeName? stdName = paperSize switch
            {
                "A0" => PageMediaSizeName.ISOA0,
                "A1" => PageMediaSizeName.ISOA1,
                "A2" => PageMediaSizeName.ISOA2,
                "A3" => PageMediaSizeName.ISOA3,
                "A4" => PageMediaSizeName.ISOA4,
                "A5" => PageMediaSizeName.ISOA5,
                "A6" => PageMediaSizeName.ISOA6,
                "B4" => PageMediaSizeName.JISB4,
                "B5" => PageMediaSizeName.JISB5,
                "Letter" => PageMediaSizeName.NorthAmericaLetter,
                "Legal" => PageMediaSizeName.NorthAmericaLegal,
                _ => null
            };
            ticket.PageMediaSize = stdName.HasValue
                ? new PageMediaSize(stdName.Value, shortMm * dipPerMm, longMm * dipPerMm)
                : new PageMediaSize(shortMm * dipPerMm, longMm * dipPerMm);
        }

        // Only set PageResolution when the driver advertises the exact DPI (so validation doesn't fail and revert other features)
        if (dpi >= 72)
        {
            try
            {
                var capsObj = queue.GetPrintCapabilities(ticket);
                var matchedRes = capsObj.PageResolutionCapability.FirstOrDefault(r =>
                    Math.Max(r.X ?? 0, r.Y ?? 0) == dpi);
                if (matchedRes != null)
                    ticket.PageResolution = matchedRes;
            }
            catch
            {
                // Keep DEVMODE-converted resolution
            }
        }

        // Patch PrintSchema XML directly against driver's PrintCapabilities XML so driver-specific Tray, MediaType, Duplex, PaperSize, and Finishing options stick.
        try
        {
            var capsDoc = new XmlDocument();
            using (var cStream = queue.GetPrintCapabilitiesAsXml())
                capsDoc.Load(cStream);

            var ticketDoc = new XmlDocument();
            using (var tStream = ticket.GetXmlStream())
                ticketDoc.Load(tStream);

            if (!string.IsNullOrWhiteSpace(paperName) || !string.IsNullOrWhiteSpace(paperSize))
                TrySetPaperMediaSizeOptionInXml(ticketDoc, capsDoc, paperName, paperSize, shortMm, longMm);

            string duplexTarget = duplexMode switch
            {
                "long-edge" => "TwoSidedLongEdge",
                "short-edge" => "TwoSidedShortEdge",
                _ => "OneSided"
            };
            TrySetCapabilityOptionInXml(ticketDoc, capsDoc, new[] { "JobDuplexAllDocumentsContiguously", "DocumentDuplex", "Duplex" }, duplexTarget);

            if (!string.IsNullOrWhiteSpace(tray))
                TrySetCapabilityOptionInXml(ticketDoc, capsDoc, new[] { "JobInputBin", "DocumentInputBin", "PageInputBin", "InputBin" }, tray);

            if (!string.IsNullOrWhiteSpace(mediaType))
                TrySetCapabilityOptionInXml(ticketDoc, capsDoc, new[] { "PageMediaType" }, mediaType);

            if (!string.IsNullOrWhiteSpace(staple))
                TrySetCapabilityOptionInXml(ticketDoc, capsDoc, new[] { "JobStapleAllDocuments", "DocumentStaple", "Staple" }, staple);

            if (!string.IsNullOrWhiteSpace(holePunch))
                TrySetCapabilityOptionInXml(ticketDoc, capsDoc, new[] { "JobHolePunch", "DocumentHolePunch", "HolePunch" }, holePunch);

            if (!string.IsNullOrWhiteSpace(fold))
                TrySetCapabilityOptionInXml(ticketDoc, capsDoc, new[] { "JobFold", "DocumentFold", "Fold" }, fold);

            if (!string.IsNullOrWhiteSpace(outputBin))
                TrySetCapabilityOptionInXml(ticketDoc, capsDoc, new[] { "JobOutputBin", "DocumentOutputBin", "PageOutputBin", "OutputBin" }, outputBin);

            using var outMs = new MemoryStream();
            ticketDoc.Save(outMs);
            outMs.Position = 0;
            ticket = new PrintTicket(outMs);
        }
        catch (Exception ex)
        {
            Program.Log($"XML PrintTicket enrichment skipped for '{queue.FullName}': {ex.Message}");
        }

        // Validate our configured ticket against driver capabilities using an empty delta PrintTicket so DefaultPrintTicket cannot override Duplex/Media/PaperSize.
        return queue.MergeAndValidatePrintTicket(ticket, new PrintTicket()).ValidatedPrintTicket;
    }

    private static void TrySetPaperMediaSizeOptionInXml(
        XmlDocument ticketDoc,
        XmlDocument capsDoc,
        string? paperName,
        string? paperSize,
        double shortMm,
        double longMm)
    {
        var feat = capsDoc.SelectSingleNode("//*[local-name()='Feature' and contains(@name, 'PageMediaSize')]");
        if (feat == null) return;

        XmlElement? chosen = null;
        var options = feat.SelectNodes("./*[local-name()='Option']");
        if (options == null || options.Count == 0) return;

        foreach (XmlNode node in options)
        {
            if (node is not XmlElement optEl) continue;
            var dn = SanitizeDriverText(optEl.SelectSingleNode("./*[local-name()='Property' and contains(@name,'DisplayName')]/*[local-name()='Value']")?.InnerText);
            var rawName = optEl.GetAttribute("name");
            var cleanRaw = rawName.Contains(':') ? rawName[(rawName.IndexOf(':') + 1)..] : rawName;
            if (!string.IsNullOrWhiteSpace(paperName) &&
                (string.Equals(dn, paperName, StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(cleanRaw, paperName, StringComparison.OrdinalIgnoreCase)))
            {
                chosen = optEl;
                break;
            }
        }

        if (chosen == null)
        {
            double targetShortMicrons = shortMm * 1000.0;
            double targetLongMicrons = longMm * 1000.0;
            foreach (XmlNode node in options)
            {
                if (node is not XmlElement optEl) continue;
                var wText = optEl.SelectSingleNode("./*[local-name()='ScoredProperty' and contains(@name,'MediaSizeWidth')]/*[local-name()='Value']")?.InnerText;
                var hText = optEl.SelectSingleNode("./*[local-name()='ScoredProperty' and contains(@name,'MediaSizeHeight')]/*[local-name()='Value']")?.InnerText;
                if (double.TryParse(wText, System.Globalization.CultureInfo.InvariantCulture, out var wMic) &&
                    double.TryParse(hText, System.Globalization.CultureInfo.InvariantCulture, out var hMic))
                {
                    double oShort = Math.Min(wMic, hMic);
                    double oLong = Math.Max(wMic, hMic);
                    if (Math.Abs(oShort - targetShortMicrons) <= 2500 && Math.Abs(oLong - targetLongMicrons) <= 2500)
                    {
                        chosen = optEl;
                        break;
                    }
                }
            }
        }

        if (chosen == null && !string.IsNullOrWhiteSpace(paperSize) && !string.Equals(paperSize, "Custom", StringComparison.OrdinalIgnoreCase))
        {
            foreach (XmlNode node in options)
            {
                if (node is not XmlElement optEl) continue;
                var dn = SanitizeDriverText(optEl.SelectSingleNode("./*[local-name()='Property' and contains(@name,'DisplayName')]/*[local-name()='Value']")?.InnerText);
                var rawName = optEl.GetAttribute("name");
                if (rawName.Contains(paperSize, StringComparison.OrdinalIgnoreCase) ||
                    dn.Contains(paperSize, StringComparison.OrdinalIgnoreCase))
                {
                    chosen = optEl;
                    break;
                }
            }
        }

        if (chosen != null)
            ReplaceTicketFeatureWithOption(ticketDoc, (feat as XmlElement)?.GetAttribute("name") ?? "psk:PageMediaSize", chosen);
    }

    private static void TrySetCapabilityOptionInXml(
        XmlDocument ticketDoc,
        XmlDocument capsDoc,
        string[] featureKeywords,
        string targetValue)
    {
        string target = targetValue.Trim();
        foreach (var keyword in featureKeywords)
        {
            var featNodes = capsDoc.SelectNodes($"//*[local-name()='Feature' and contains(@name, '{keyword}')]");
            if (featNodes == null || featNodes.Count == 0) continue;

            foreach (XmlNode featNode in featNodes)
            {
                if (featNode is not XmlElement featEl) continue;
                var featName = featEl.GetAttribute("name");
                var options = featEl.SelectNodes("./*[local-name()='Option']");
                if (options == null) continue;

                XmlElement? exactMatch = null;
                XmlElement? partialMatch = null;
                foreach (XmlNode optNode in options)
                {
                    if (optNode is not XmlElement optEl) continue;
                    var rawName = optEl.GetAttribute("name");
                    var cleanRaw = rawName.Contains(':') ? rawName[(rawName.IndexOf(':') + 1)..] : rawName;
                    var dn = SanitizeDriverText(optEl.SelectSingleNode("./*[local-name()='Property' and contains(@name,'DisplayName')]/*[local-name()='Value']")?.InnerText);

                    if (string.Equals(dn, target, StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(cleanRaw, target, StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(rawName, target, StringComparison.OrdinalIgnoreCase))
                    {
                        exactMatch = optEl;
                        break;
                    }

                    if (partialMatch == null &&
                        ((!string.IsNullOrWhiteSpace(dn) && (dn.Contains(target, StringComparison.OrdinalIgnoreCase) || target.Contains(dn, StringComparison.OrdinalIgnoreCase))) ||
                         (!string.IsNullOrWhiteSpace(cleanRaw) && (cleanRaw.Contains(target, StringComparison.OrdinalIgnoreCase) || target.Contains(cleanRaw, StringComparison.OrdinalIgnoreCase))) ||
                         (target.Contains("auto", StringComparison.OrdinalIgnoreCase) && (dn.Contains("auto", StringComparison.OrdinalIgnoreCase) || cleanRaw.Contains("AutoSelect", StringComparison.OrdinalIgnoreCase))) ||
                         (target.Contains("plain", StringComparison.OrdinalIgnoreCase) && (dn.Contains("plain", StringComparison.OrdinalIgnoreCase) || cleanRaw.Equals("Plain", StringComparison.OrdinalIgnoreCase)))))
                    {
                        partialMatch = optEl;
                    }
                }

                var chosen = exactMatch ?? partialMatch;
                if (chosen != null && !string.IsNullOrWhiteSpace(featName))
                {
                    ReplaceTicketFeatureWithOption(ticketDoc, featName, chosen);
                    return;
                }
            }
        }
    }

    private static void ReplaceTicketFeatureWithOption(XmlDocument ticketDoc, string featureName, XmlElement capOptionEl)
    {
        var root = ticketDoc.DocumentElement;
        if (root == null) return;
        string psfNs = root.NamespaceURI;
        if (string.IsNullOrWhiteSpace(psfNs))
            psfNs = "http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework";
        string psfPrefix = string.IsNullOrWhiteSpace(root.Prefix) ? "psf" : root.Prefix;

        var existingFeatures = ticketDoc.SelectNodes($"//*[local-name()='Feature' and @name='{featureName}']");
        if (existingFeatures != null)
        {
            foreach (XmlNode old in existingFeatures)
                old.ParentNode?.RemoveChild(old);
        }

        var featureEl = ticketDoc.CreateElement(psfPrefix, "Feature", psfNs);
        featureEl.SetAttribute("name", featureName);

        var optionEl = ticketDoc.CreateElement(psfPrefix, "Option", psfNs);
        optionEl.SetAttribute("name", capOptionEl.GetAttribute("name"));

        foreach (XmlNode child in capOptionEl.ChildNodes)
        {
            if (child.LocalName == "ScoredProperty")
                optionEl.AppendChild(ticketDoc.ImportNode(child, true));
        }

        featureEl.AppendChild(optionEl);
        root.AppendChild(featureEl);
    }

    public bool SetDefaultPrinter(string printerName)
    {
        return WinSpoolInterop.SetDefaultPrinter(printerName);
    }

    /// <summary>
    /// Submits rendered imposed PNG sheet pages directly to the selected Windows Spooler queue
    /// using WPF FixedDocument + driver-validated DEVMODE/PrintTicket on an STA thread.
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
            var portName = SanitizeDriverText(queue.QueuePort?.Name);
            double widthMm = request.PaperWidthMm is > 10 ? request.PaperWidthMm.Value : 210;
            double heightMm = request.PaperHeightMm is > 10 ? request.PaperHeightMm.Value : 297;
            bool isLandscape = string.Equals(request.Orientation, "landscape", StringComparison.OrdinalIgnoreCase);

            var devModeBytes = TryBuildConfiguredDevModeBytes(
                printerName: queue.FullName,
                portName: portName,
                paperSize: request.PaperSize,
                paperName: request.PaperName,
                paperWidthMm: widthMm,
                paperHeightMm: heightMm,
                orientation: request.Orientation,
                tray: request.Tray,
                mediaType: request.MediaType,
                duplexMode: request.DuplexMode,
                colorMode: request.ColorMode,
                dpi: request.Dpi,
                copies: request.Copies,
                collate: request.Collate
            );

            var validated = BuildValidatedPrintTicket(
                queue,
                portName,
                devModeBytes,
                paperSize: request.PaperSize,
                paperName: request.PaperName,
                paperWidthMm: widthMm,
                paperHeightMm: heightMm,
                orientation: request.Orientation,
                tray: request.Tray,
                mediaType: request.MediaType,
                duplexMode: request.DuplexMode,
                colorMode: request.ColorMode,
                dpi: request.Dpi,
                quality: request.Quality,
                copies: request.Copies,
                collate: request.Collate,
                staple: request.Staple,
                holePunch: request.HolePunch,
                fold: request.Fold,
                outputBin: request.OutputBin,
                borderless: request.Borderless == true
            );

            double pageWidthDip = (isLandscape ? Math.Max(widthMm, heightMm) : Math.Min(widthMm, heightMm)) * dipPerMm;
            double pageHeightDip = (isLandscape ? Math.Min(widthMm, heightMm) : Math.Max(widthMm, heightMm)) * dipPerMm;

            var fixedDoc = new FixedDocument
            {
                PrintTicket = validated
            };
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

using System.Printing;
using System.Runtime.InteropServices;
using PrintStudio.PrinterService.Models;

namespace PrintStudio.PrinterService.Services;

/// <summary>
/// Manages Windows Print Queues, Capabilities (winspool.drv + System.Printing),
/// DEVMODE/PrintTicket profiles, and Spooler Job lifecycle.
/// </summary>
public sealed class PrinterSpoolerService
{
    private readonly Dictionary<string, PrinterProfileDto> _profiles = new(StringComparer.OrdinalIgnoreCase);

    public IReadOnlyList<PrinterInfoDto> ListPrinters()
    {
        var result = new List<PrinterInfoDto>();
        try
        {
            using var server = new LocalPrintServer();
            var defaultQueueName = server.DefaultPrintQueue?.FullName ?? string.Empty;
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
                    var name = queue.FullName;
                    var port = queue.QueuePort?.Name ?? "LOCAL";
                    var driver = queue.QueueDriver?.Name ?? "Generic Driver";
                    var status = MapQueueStatus(queue);
                    var caps = QueryCapabilities(name, port, queue);

                    // Re-read the driver's current user ticket on every refresh. This is
                    // important after the user changes paper/orientation in Windows Preferences.
                    var profile = ReadActiveProfile(name, caps, queue);
                    _profiles[name] = profile;

                    result.Add(new PrinterInfoDto(
                        Name: name, DriverName: driver, PortName: port,
                        IsDefault: string.Equals(name, defaultQueueName, StringComparison.OrdinalIgnoreCase),
                        IsNetwork: name.StartsWith(@"\\", StringComparison.Ordinal) || port.StartsWith("IP_", StringComparison.OrdinalIgnoreCase),
                        IsVirtual: IsVirtualPrinter(name), Status: status,
                        JobsInQueue: queue.NumberOfJobs, TonerLevelPercent: null, TotalPageCounter: null,
                        Location: queue.Location, Capabilities: caps, ActiveProfile: profile
                    ));
                }
                catch (Exception ex)
                {
                    // A single unavailable queue must not hide other installed printers, but it must
                    // not be silent either: the Electron host forwards stderr into the printer panel.
                    Console.Error.WriteLine($"Skipping printer queue '{queue.FullName}': {ex.Message}");
                }
            }
        }
        catch
        {
            // System.Printing can fail on some Windows installations; use the native spooler API below.
        }

        if (result.Count > 0) return result;

        var nativePrinters = ListPrintersWithWin32();
        if (nativePrinters.Count > 0) return nativePrinters;

        throw new InvalidOperationException(
            "Windows returned no printer queues. Check that the Print Spooler service is running and that at least one printer is installed for this Windows account.");
    }

    private IReadOnlyList<PrinterInfoDto> ListPrintersWithWin32()
    {
        // Level 2 includes the actual driver and port names, which are required by
        // DeviceCapabilities. Level 4 only returns printer names and cannot query
        // device-specific media capabilities reliably.
        var flags = WinSpoolInterop.PRINTER_ENUM_LOCAL | WinSpoolInterop.PRINTER_ENUM_CONNECTIONS;
        WinSpoolInterop.EnumPrinters(flags, null, 2, IntPtr.Zero, 0, out var needed, out _);
        if (needed == 0)
            return ListPrintersByNameOnly(flags);

        var buffer = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!WinSpoolInterop.EnumPrinters(flags, null, 2, buffer, needed, out _, out var returned))
                return ListPrintersByNameOnly(flags);
            if (returned == 0)
                return ListPrintersByNameOnly(flags);

            var defaultSize = 0u;
            WinSpoolInterop.GetDefaultPrinter(null, ref defaultSize);
            var defaultBuffer = new System.Text.StringBuilder((int)Math.Max(1, defaultSize));
            var defaultName = WinSpoolInterop.GetDefaultPrinter(defaultBuffer, ref defaultSize)
                ? defaultBuffer.ToString() : string.Empty;
            var result = new List<PrinterInfoDto>();
            int stride = Marshal.SizeOf<WinSpoolInterop.PRINTER_INFO_2>();

            for (var i = 0; i < returned; i++)
            {
                var info = Marshal.PtrToStructure<WinSpoolInterop.PRINTER_INFO_2>(IntPtr.Add(buffer, i * stride));
                var name = Marshal.PtrToStringUni(info.pPrinterName);
                if (string.IsNullOrWhiteSpace(name)) continue;
                var port = Marshal.PtrToStringUni(info.pPortName) ?? string.Empty;
                var driver = Marshal.PtrToStringUni(info.pDriverName) ?? "Windows printer driver";
                var caps = QueryCapabilities(name, port, null!);

                if (!_profiles.TryGetValue(name, out var profile))
                {
                    profile = new PrinterProfileDto(name,
                        caps.SupportedPapers.FirstOrDefault() ?? "Custom",
                        caps.SupportedTrays.FirstOrDefault() ?? "Auto Select",
                        caps.SupportedMediaTypes.FirstOrDefault() ?? "Plain Paper",
                        caps.SupportsDuplex ? "long-edge" : "none",
                        "portrait", caps.SupportsColor ? "color" : "monochrome",
                        caps.SupportedDpi.FirstOrDefault(300), "normal");
                    _profiles[name] = profile;
                }

                string status = (info.Status & 0x00000080) != 0 ? "Offline" :
                    (info.Status & 0x00000002) != 0 ? "Error" :
                    (info.Status & 0x00000008) != 0 ? "PaperJam" :
                    (info.Status & 0x00000010) != 0 ? "OutOfPaper" :
                    (info.Status & 0x00000001) != 0 ? "Paused" : "Ready";

                result.Add(new PrinterInfoDto(
                    Name: name, DriverName: driver, PortName: port,
                    IsDefault: string.Equals(name, defaultName, StringComparison.OrdinalIgnoreCase),
                    IsNetwork: (info.Attributes & 0x10) != 0 || name.StartsWith(@"\\", StringComparison.Ordinal),
                    IsVirtual: IsVirtualPrinter(name), Status: status,
                    JobsInQueue: (int)info.cJobs, TonerLevelPercent: null, TotalPageCounter: null,
                    Location: Marshal.PtrToStringUni(info.pLocation),
                    Capabilities: caps, ActiveProfile: profile));
            }
            return result;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private IReadOnlyList<PrinterInfoDto> ListPrintersByNameOnly(uint flags)
    {
        // Some Windows print providers do not return PRINTER_INFO_2 data to a
        // non-elevated desktop process. PRINTER_INFO_4 is a lighter enumeration
        // that still exposes every locally installed and connected queue name.
        WinSpoolInterop.EnumPrinters(flags, null, 4, IntPtr.Zero, 0, out var needed, out _);
        if (needed == 0) return Array.Empty<PrinterInfoDto>();

        var buffer = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!WinSpoolInterop.EnumPrinters(flags, null, 4, buffer, needed, out _, out var returned) || returned == 0)
                return Array.Empty<PrinterInfoDto>();

            uint defaultSize = 0;
            WinSpoolInterop.GetDefaultPrinter(null, ref defaultSize);
            var defaultBuffer = new System.Text.StringBuilder((int)Math.Max(1, defaultSize));
            var defaultName = WinSpoolInterop.GetDefaultPrinter(defaultBuffer, ref defaultSize)
                ? defaultBuffer.ToString() : string.Empty;

            var result = new List<PrinterInfoDto>();
            int stride = Marshal.SizeOf<WinSpoolInterop.PRINTER_INFO_4>();
            for (var i = 0; i < returned; i++)
            {
                var info = Marshal.PtrToStructure<WinSpoolInterop.PRINTER_INFO_4>(IntPtr.Add(buffer, i * stride));
                var name = Marshal.PtrToStringUni(info.pPrinterName);
                if (string.IsNullOrWhiteSpace(name)) continue;

                // Port and driver details are not part of level 4. Passing an empty
                // port lets the driver/provider decide whether it can report capabilities.
                var caps = QueryCapabilities(name, string.Empty, null);
                var profile = new PrinterProfileDto(
                    name,
                    caps.SupportedPapers.FirstOrDefault() ?? "Custom",
                    caps.SupportedTrays.FirstOrDefault() ?? "Auto Select",
                    caps.SupportedMediaTypes.FirstOrDefault() ?? "Plain Paper",
                    caps.SupportsDuplex ? "long-edge" : "none",
                    "portrait",
                    caps.SupportsColor ? "color" : "monochrome",
                    caps.SupportedDpi.FirstOrDefault(300),
                    "normal");
                _profiles[name] = profile;

                result.Add(new PrinterInfoDto(
                    Name: name,
                    DriverName: "Windows installed printer",
                    PortName: string.Empty,
                    IsDefault: string.Equals(name, defaultName, StringComparison.OrdinalIgnoreCase),
                    IsNetwork: (info.Attributes & 0x10) != 0 || name.StartsWith(@"\\", StringComparison.Ordinal),
                    IsVirtual: IsVirtualPrinter(name),
                    Status: "Unknown",
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

    // The existing queue list uses this name-based classification. Virtual queues
    // default to zero by product policy, rather than being reported as measured hardware.
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
                    return new PrinterMarginResultDto("available", "virtual", new PrinterMarginsDto(0,0,0,0));

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
                    new PageMediaSize(Math.Min(request.WidthMm,request.HeightMm)*dipPerMm, Math.Max(request.WidthMm,request.HeightMm)*dipPerMm);
                var delta = new PrintTicket { PageMediaSize = media,
                    PageOrientation = request.Orientation == "landscape" ? PageOrientation.Landscape : PageOrientation.Portrait };
                var baseTicket = queue.UserPrintTicket ?? queue.DefaultPrintTicket ?? new PrintTicket();
                var validated = queue.MergeAndValidatePrintTicket(baseTicket,delta).ValidatedPrintTicket;
                var caps = queue.GetPrintCapabilities(validated);
                var area = caps.PageImageableArea;
                var width = caps.OrientedPageMediaWidth;
                var height = caps.OrientedPageMediaHeight;
                if (area == null || !width.HasValue || !height.HasValue ||
                    !double.IsFinite(width.Value) || !double.IsFinite(height.Value) ||
                    Math.Abs(width.Value/dipPerMm - request.WidthMm) > 1 || Math.Abs(height.Value/dipPerMm - request.HeightMm) > 1)
                    return Unavailable("Driver did not report the requested paper size and imageable area");
                double left = area.OriginWidth, top = area.OriginHeight;
                double right = width.Value-left-area.ExtentWidth, bottom = height.Value-top-area.ExtentHeight;
                if (!double.IsFinite(left) || !double.IsFinite(top) || !double.IsFinite(right) || !double.IsFinite(bottom) ||
                    area.ExtentWidth <= 0 || area.ExtentHeight <= 0 || Math.Min(Math.Min(left,right),Math.Min(top,bottom)) < -0.5)
                    return Unavailable("Driver reported an invalid imageable area");
                double Mm(double dip) => Math.Round(Math.Max(0,dip)/dipPerMm,3);
                return new PrinterMarginResultDto("available", "hardware", new PrinterMarginsDto(Mm(top),Mm(right),Mm(bottom),Mm(left)));
            }
        }
        catch (Exception ex)
        {
            return Unavailable($"Cannot query printer imageable area: {ex.Message}");
        }
    }

    public PrinterCapabilitiesDto QueryCapabilities(string printerName, string portName, PrintQueue? queue)
    {
        // Query the selected device/port. Do not advertise generic paper sizes, trays or DPI
        // values that the installed driver has not reported.
        var papers = ReadSupportedPaperSizes(printerName, portName);
        var trays = ReadCapabilityStrings(printerName, portName, WinSpoolInterop.DC_BINNAMES, 24);
        var mediaTypes = ReadCapabilityStrings(printerName, portName, WinSpoolInterop.DC_MEDIATYPENAMES, 64);
        var dpi = ReadSupportedDpi(printerName, portName);

        bool supportsDuplex = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_DUPLEX, IntPtr.Zero, IntPtr.Zero) == 1;
        bool supportsColor = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_COLORDEVICE, IntPtr.Zero, IntPtr.Zero) == 1;
        int copies = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_COPIES, IntPtr.Zero, IntPtr.Zero);

        return new PrinterCapabilitiesDto(
            SupportedPapers: papers,
            SupportedTrays: trays.Count > 0 ? trays : new List<string> { "Auto Select" },
            SupportedMediaTypes: mediaTypes,
            SupportsDuplex: supportsDuplex,
            SupportsColor: supportsColor,
            SupportedDpi: dpi,
            MaxCopies: copies > 0 ? Math.Min(999, copies) : 1
        );
    }

    private static PrinterProfileDto ReadActiveProfile(string printerName, PrinterCapabilitiesDto caps, PrintQueue queue)
    {
        const double dipPerMm = 96.0 / 25.4;
        var ticket = queue.UserPrintTicket ?? queue.DefaultPrintTicket;
        var media = ticket?.PageMediaSize;
        double? widthMm = media?.Width is double width && width > 0 ? width / dipPerMm : null;
        double? heightMm = media?.Height is double height && height > 0 ? height / dipPerMm : null;
        var paper = widthMm.HasValue && heightMm.HasValue
            ? MatchPaperSize(widthMm.Value, heightMm.Value)
            : caps.SupportedPapers.FirstOrDefault() ?? "Custom";
        var orientation = ticket?.PageOrientation == PageOrientation.Landscape ? "landscape" : "portrait";

        return new PrinterProfileDto(
            PrinterName: printerName,
            PaperSize: paper,
            Tray: caps.SupportedTrays.FirstOrDefault() ?? "Auto Select",
            MediaType: caps.SupportedMediaTypes.FirstOrDefault() ?? "Plain Paper",
            DuplexMode: caps.SupportsDuplex ? "long-edge" : "none",
            Orientation: orientation,
            ColorMode: caps.SupportsColor ? "color" : "monochrome",
            Dpi: caps.SupportedDpi.Contains(600) ? 600 : caps.SupportedDpi.FirstOrDefault(300),
            Quality: "normal",
            PaperWidthMm: widthMm,
            PaperHeightMm: heightMm
        );
    }

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
            if (Math.Abs(shortSide - Math.Min(item.W, item.H)) < 1.5 &&
                Math.Abs(longSide - Math.Max(item.W, item.H)) < 1.5)
                return item.Id;
        return "Custom";
    }

    private static List<string> ReadSupportedPaperSizes(string printerName, string portName)
    {
        int count = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_PAPERS, IntPtr.Zero, IntPtr.Zero);
        if (count <= 0) return new List<string>();

        var idBuffer = Marshal.AllocHGlobal(count * sizeof(short));
        var sizeBuffer = Marshal.AllocHGlobal(count * Marshal.SizeOf<WinSpoolInterop.POINT>());
        try
        {
            int idsRead = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_PAPERS, idBuffer, IntPtr.Zero);
            int sizesRead = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_PAPERSIZE, sizeBuffer, IntPtr.Zero);
            int total = Math.Min(count, Math.Min(idsRead, sizesRead));
            var result = new List<string>();
            for (int i = 0; i < total; i++)
            {
                short paperId = Marshal.ReadInt16(idBuffer, i * sizeof(short));
                var size = Marshal.PtrToStructure<WinSpoolInterop.POINT>(IntPtr.Add(sizeBuffer, i * Marshal.SizeOf<WinSpoolInterop.POINT>()));
                string? mapped = paperId switch
                {
                    1 => "Letter", 5 => "Legal", 8 => "A3", 9 => "A4",
                    11 => "A5", 12 => "B4", 13 => "B5", 66 => "A2", 67 => "A1",
                    68 => "A0", 70 => "A6", _ => null
                };
                if (mapped == null && size.X > 0 && size.Y > 0)
                    mapped = MatchPaperSize(size.X / 10.0, size.Y / 10.0) == "Custom" ? "Custom" :
                        MatchPaperSize(size.X / 10.0, size.Y / 10.0);
                if (mapped != null && !result.Contains(mapped, StringComparer.OrdinalIgnoreCase))
                    result.Add(mapped);
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
        var buffer = Marshal.AllocHGlobal(count * Marshal.SizeOf<WinSpoolInterop.POINT>());
        try
        {
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
        IntPtr buffer = Marshal.AllocHGlobal(count * bytesPerEntry);
        try
        {
            int fetched = WinSpoolInterop.DeviceCapabilities(printerName, portName, capability, buffer, IntPtr.Zero);
            for (int i = 0; i < Math.Min(count, fetched); i++)
            {
                string? text = Marshal.PtrToStringUni(IntPtr.Add(buffer, i * bytesPerEntry), charWidth)?.TrimEnd('\0').Trim();
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

    public IReadOnlyList<SpoolerJobDto> ListJobs(string? printerFilter = null)
    {
        var jobs = new List<SpoolerJobDto>();
        using var server = new LocalPrintServer();
        var queues = server.GetPrintQueues(new[]
        {
            EnumeratedPrintQueueTypes.Local,
            EnumeratedPrintQueueTypes.Connections
        });

        foreach (var queue in queues)
        {
            if (!string.IsNullOrWhiteSpace(printerFilter) &&
                !string.Equals(queue.FullName, printerFilter, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            try
            {
                queue.Refresh();
                var jobCollection = queue.GetPrintJobInfoCollection();
                foreach (var job in jobCollection)
                {
                    jobs.Add(new SpoolerJobDto(
                        JobId: job.JobIdentifier,
                        PrinterName: queue.FullName,
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
            catch
            {
                // Ignore inaccessible queue
            }
        }

        return jobs;
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

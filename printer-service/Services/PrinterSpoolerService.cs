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

                    if (!_profiles.TryGetValue(name, out var profile))
                    {
                        profile = new PrinterProfileDto(
                            PrinterName: name,
                            PaperSize: caps.SupportedPapers.Contains("A4") ? "A4" : caps.SupportedPapers.FirstOrDefault() ?? "A4",
                            Tray: caps.SupportedTrays.FirstOrDefault() ?? "Auto Select",
                            MediaType: caps.SupportedMediaTypes.FirstOrDefault() ?? "Plain Paper",
                            DuplexMode: caps.SupportsDuplex ? "long-edge" : "none",
                            Orientation: "portrait",
                            ColorMode: caps.SupportsColor ? "color" : "monochrome",
                            Dpi: caps.SupportedDpi.Contains(600) ? 600 : caps.SupportedDpi.FirstOrDefault(300),
                            Quality: "normal"
                        );
                        _profiles[name] = profile;
                    }

                    result.Add(new PrinterInfoDto(
                        Name: name, DriverName: driver, PortName: port,
                        IsDefault: string.Equals(name, defaultQueueName, StringComparison.OrdinalIgnoreCase),
                        IsNetwork: name.StartsWith(@"\\", StringComparison.Ordinal) || port.StartsWith("IP_", StringComparison.OrdinalIgnoreCase),
                        IsVirtual: IsVirtualPrinter(name), Status: status,
                        JobsInQueue: queue.NumberOfJobs, TonerLevelPercent: null, TotalPageCounter: null,
                        Location: queue.Location, Capabilities: caps, ActiveProfile: profile
                    ));
                }
                catch
                {
                    // A single unavailable queue must not hide other installed printers.
                }
            }
        }
        catch
        {
            // System.Printing can fail on some Windows installations; use the native spooler API below.
        }

        return result.Count > 0 ? result : ListPrintersWithWin32();
    }

    private IReadOnlyList<PrinterInfoDto> ListPrintersWithWin32()
    {
        var needed = 0u;
        var returned = 0u;
        WinSpoolInterop.EnumPrinters(
            WinSpoolInterop.PRINTER_ENUM_LOCAL | WinSpoolInterop.PRINTER_ENUM_CONNECTIONS,
            null, 4, IntPtr.Zero, 0, out needed, out returned);
        if (needed == 0) return Array.Empty<PrinterInfoDto>();

        var buffer = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!WinSpoolInterop.EnumPrinters(
                WinSpoolInterop.PRINTER_ENUM_LOCAL | WinSpoolInterop.PRINTER_ENUM_CONNECTIONS,
                null, 4, buffer, needed, out _, out returned))
                return Array.Empty<PrinterInfoDto>();

            var defaultSize = 0u;
            WinSpoolInterop.GetDefaultPrinter(null, ref defaultSize);
            var defaultBuffer = new System.Text.StringBuilder((int)Math.Max(1, defaultSize));
            var defaultName = WinSpoolInterop.GetDefaultPrinter(defaultBuffer, ref defaultSize)
                ? defaultBuffer.ToString() : string.Empty;

            var caps = new PrinterCapabilitiesDto(
                SupportedPapers: new[] { "A4", "A3", "A5", "B4", "B5", "Letter", "Legal", "Custom" },
                SupportedTrays: new[] { "Auto Select" },
                SupportedMediaTypes: new[] { "Plain Paper" },
                SupportsDuplex: false, SupportsColor: true,
                SupportedDpi: new[] { 300, 600 }, MaxCopies: 1);
            var result = new List<PrinterInfoDto>();

            for (var i = 0; i < returned; i++)
            {
                var info = Marshal.PtrToStructure<WinSpoolInterop.PRINTER_INFO_4>(
                    IntPtr.Add(buffer, i * Marshal.SizeOf<WinSpoolInterop.PRINTER_INFO_4>()));
                var name = Marshal.PtrToStringUni(info.pPrinterName);
                if (string.IsNullOrWhiteSpace(name)) continue;
                var serverName = Marshal.PtrToStringUni(info.pServerName) ?? string.Empty;
                if (!_profiles.TryGetValue(name, out var profile))
                {
                    profile = new PrinterProfileDto(name, "A4", "Auto Select", "Plain Paper",
                        "none", "portrait", "color", 300, "normal");
                    _profiles[name] = profile;
                }

                result.Add(new PrinterInfoDto(
                    Name: name, DriverName: "Windows printer driver", PortName: "Windows Spooler",
                    IsDefault: string.Equals(name, defaultName, StringComparison.OrdinalIgnoreCase),
                    IsNetwork: !string.IsNullOrWhiteSpace(serverName) || (info.Attributes & 0x10) != 0,
                    IsVirtual: IsVirtualPrinter(name), Status: "Ready", JobsInQueue: 0,
                    TonerLevelPercent: null, TotalPageCounter: null, Location: null,
                    Capabilities: caps, ActiveProfile: profile));
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

    public PrinterCapabilitiesDto QueryCapabilities(string printerName, string portName, PrintQueue queue)
    {
        var trays = ReadCapabilityStrings(printerName, portName, WinSpoolInterop.DC_BINNAMES, 24);
        if (trays.Count == 0)
        {
            trays.AddRange(new[] { "Auto Select", "Tray 1", "Manual Feed" });
        }

        var mediaTypes = ReadCapabilityStrings(printerName, portName, WinSpoolInterop.DC_MEDIATYPENAMES, 64);
        if (mediaTypes.Count == 0)
        {
            mediaTypes.AddRange(new[] { "Plain Paper", "Heavyweight 120g", "Glossy Photo", "Recycled" });
        }

        bool supportsDuplex = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_DUPLEX, IntPtr.Zero, IntPtr.Zero) == 1;
        bool supportsColor = WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_COLORDEVICE, IntPtr.Zero, IntPtr.Zero) == 1;
        int maxCopies = Math.Max(1, WinSpoolInterop.DeviceCapabilities(printerName, portName, WinSpoolInterop.DC_COPIES, IntPtr.Zero, IntPtr.Zero));

        return new PrinterCapabilitiesDto(
            SupportedPapers: new[] { "A4", "A3", "A5", "B4", "B5", "Letter", "Legal", "Custom" },
            SupportedTrays: trays,
            SupportedMediaTypes: mediaTypes,
            SupportsDuplex: supportsDuplex,
            SupportsColor: supportsColor,
            SupportedDpi: new[] { 300, 600, 1200 },
            MaxCopies: maxCopies > 999 ? 999 : maxCopies
        );
    }

    private static List<string> ReadCapabilityStrings(string printerName, string portName, short capability, int charWidth)
    {
        var items = new List<string>();
        int count = WinSpoolInterop.DeviceCapabilities(printerName, portName, capability, IntPtr.Zero, IntPtr.Zero);
        if (count <= 0) return items;

        int bytesPerEntry = charWidth * 2; // Unicode chars
        IntPtr buffer = Marshal.AllocHGlobal(count * bytesPerEntry);
        try
        {
            int fetched = WinSpoolInterop.DeviceCapabilities(printerName, portName, capability, buffer, IntPtr.Zero);
            for (int i = 0; i < fetched; i++)
            {
                IntPtr itemPtr = IntPtr.Add(buffer, i * bytesPerEntry);
                string? text = Marshal.PtrToStringUni(itemPtr)?.TrimEnd('\0').Trim();
                if (!string.IsNullOrWhiteSpace(text))
                {
                    items.Add(text);
                }
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }

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

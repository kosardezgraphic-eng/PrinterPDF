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
                    Name: name,
                    DriverName: driver,
                    PortName: port,
                    IsDefault: string.Equals(name, defaultQueueName, StringComparison.OrdinalIgnoreCase),
                    IsNetwork: name.StartsWith(@"\\", StringComparison.Ordinal) || port.StartsWith("IP_", StringComparison.OrdinalIgnoreCase),
                    IsVirtual: name.Contains("PDF", StringComparison.OrdinalIgnoreCase) ||
                               name.Contains("PrintStudio", StringComparison.OrdinalIgnoreCase) ||
                               name.Contains("XPS", StringComparison.OrdinalIgnoreCase),
                    Status: status,
                    JobsInQueue: queue.NumberOfJobs,
                    TonerLevelPercent: null,
                    TotalPageCounter: null,
                    Location: queue.Location,
                    Capabilities: caps,
                    ActiveProfile: profile
                ));
            }
            catch
            {
                // Skip inaccessible queue without crashing sidecar
            }
        }

        return result;
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

using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using PrintStudio.PrinterService.Models;
using PrintStudio.PrinterService.Services;

namespace PrintStudio.PrinterService;

/// <summary>
/// PrintStudio Pro — C# (.NET 8) Named Pipe Sidecar Entrypoint.
/// Listens on \\.\pipe\PrintStudioPrinterService and processes JSON-RPC 2.0 requests.
/// </summary>
public static class Program
{
    private const string PipeName = "PrintStudioPrinterService";

    /// Consecutive accept failures tolerated before giving up, so an unusable pipe produces a
    /// logged exit instead of a process spinning at 100% CPU forever.
    private const int MaxAcceptFailures = 5;

    private static readonly PrinterSpoolerService Spooler = new();
    private static readonly object LogGate = new();

    /// %APPDATA%\PrintStudioPro\printer-service.log
    /// The service is spawned without a console, so when it dies the app only sees an exit code.
    /// This file is the only surviving record of why, and the app quotes its path in the UI.
    public static readonly string? LogPath = ResolveLogPath();

    private static string? ResolveLogPath()
    {
        try
        {
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            return string.IsNullOrWhiteSpace(appData)
                ? null
                : Path.Combine(appData, "PrintStudioPro", "printer-service.log");
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Writes one line to stderr (the Electron host keeps the tail and shows it in the printer
    /// panel) and to the log file. Diagnostics must never be the thing that breaks printing, so
    /// every failure here is swallowed on purpose.
    /// </summary>
    internal static void Log(string message)
    {
        var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {message}";
        try { Console.Error.WriteLine(line); } catch { /* no console attached */ }
        if (LogPath is null) return;
        try
        {
            lock (LogGate)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
                File.AppendAllText(LogPath, line + Environment.NewLine);
            }
        }
        catch
        {
            // A read-only or roaming-blocked profile is not a reason to stop answering printers.
        }
    }

    public static async Task Main(string[] args)
    {
        // Nothing in this process has a window or a console. Without these two handlers a fault on
        // a background thread or an unobserved task is reduced to "exit code 0xC000041D" in the app.
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            Log($"UNHANDLER ({e.IsTerminating ? "terminating" : "non-terminating"}): {e.ExceptionObject}");
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            Log($"UNOBSERVED TASK: {e.Exception}");
            e.SetObserved();
        };
        AppDomain.CurrentDomain.ProcessExit += (_, _) => Log("exiting");

        RotateLogIfNeeded();
        Log($"starting PrinterService pid={Environment.ProcessId} framework={Environment.Version} log={LogPath ?? "<unavailable>"}");

        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cts.Cancel();
        };

        var acceptFailures = 0;
        while (!cts.Token.IsCancellationRequested)
        {
            NamedPipeServerStream? server = null;
            var handedOff = false;
            try
            {
                server = new NamedPipeServerStream(
                    PipeName,
                    PipeDirection.InOut,
                    NamedPipeServerStream.MaxAllowedServerInstances,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous
                );
                await server.WaitForConnectionAsync(cts.Token);
                acceptFailures = 0;
                // From here the handler owns the connected pipe and disposes it.
                handedOff = true;
                _ = HandleOwnedConnectionAsync(server!, cts.Token);
            }
            catch (OperationCanceledException) when (cts.IsCancellationRequested)
            {
                // Shutdown: the token cancelled the pending accept.
            }
            catch (Exception ex)
            {
                acceptFailures += 1;
                Log($"pipe attempt {acceptFailures}/{MaxAcceptFailures} failed: {ex}");
                if (acceptFailures >= MaxAcceptFailures)
                {
                    // A pipe that cannot be created at all (name already owned by another session,
                    // disabled spooler, group policy) will never recover. Exit with a logged reason
                    // so the app reports one clear error instead of a spinner and a hot loop.
                    Log("giving up: the named pipe could not be created or used");
                    Environment.Exit(1);
                }
                await Task.Delay(250);
            }
            finally
            {
                if (!handedOff && server is not null)
                {
                    try { await server.DisposeAsync(); } catch { /* already broken */ }
                }
            }
        }

        Log("stopped (cancelled)");
    }

    private static void RotateLogIfNeeded()
    {
        const long keepUnderBytes = 1024 * 1024;
        try
        {
            if (LogPath is null) return;
            var file = new FileInfo(LogPath);
            if (!file.Exists || file.Length < keepUnderBytes) return;
            Directory.CreateDirectory(file.DirectoryName!);
            File.WriteAllText(LogPath, $"--- log truncated at start of run (was {file.Length} bytes) ---{Environment.NewLine}");
        }
        catch
        {
            // Rotation is a nicety; never block startup for it.
        }
    }

    private static async Task HandleOwnedConnectionAsync(NamedPipeServerStream pipe, CancellationToken ct)
    {
        await using (pipe)
        {
            try { await HandleClientConnectionAsync(pipe, ct); }
            catch (IOException) { /* Client disconnected. */ }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
            catch (Exception ex)
            {
                // This task is fire-and-forget, so an escaping fault would only surface as an
                // unobserved task exception and a closed pipe on the app side. Log it instead.
                Log($"connection failed: {ex}");
            }
        }
    }

    private static async Task HandleClientConnectionAsync(NamedPipeServerStream pipe, CancellationToken ct)
    {
        using var reader = new StreamReader(pipe, Encoding.UTF8, leaveOpen: true);
        await using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true)
        {
            AutoFlush = true
        };

        while (pipe.IsConnected && !ct.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(ct);
            if (string.IsNullOrWhiteSpace(line))
            {
                break;
            }

            JsonRpcResponse response;
            try
            {
                var req = JsonSerializer.Deserialize<JsonRpcRequest>(line);
                if (req is null)
                {
                    continue;
                }

                object? result = req.Method switch
                {
                    "printer:list" => Spooler.ListPrinters(),
                    "printer:get-margins" => Spooler.GetPrinterMargins(req.Params.Deserialize<PrinterMarginRequestDto>()!),
                    "printer:update-profile" => Spooler.UpdateProfile(
                        req.Params.Deserialize<PrinterProfileDto>()!
                    ),
                    "printer:set-default" => Spooler.SetDefaultPrinter(
                        req.Params.GetProperty("printerName").GetString()!
                    ),
                    "spooler:list-jobs" => Spooler.ListJobs(
                        req.Params.TryGetProperty("printerName", out var pProp) ? pProp.GetString() : null
                    ),
                    "spooler:control-job" => Spooler.ControlJob(
                        req.Params.Deserialize<ControlJobParams>()!
                    ),
                    "spooler:purge-queue" => Spooler.PurgeQueue(
                        req.Params.GetProperty("printerName").GetString()!
                    ),
                    _ => throw new InvalidOperationException($"Unknown RPC method: {req.Method}")
                };

                response = new JsonRpcResponse("2.0", req.Id, Result: result);
            }
            catch (Exception ex)
            {
                // Every spooler problem ends here as a JSON-RPC error the app can display. Letting
                // it escape would kill the sidecar and the next request would fail with a pipe error
                // instead — a far worse diagnosis than the real message.
                Log($"request '{Trim(line)}' failed: {ex}");
                using var doc = JsonDocument.Parse("0");
                response = new JsonRpcResponse(
                    "2.0",
                    doc.RootElement.Clone(),
                    Error: new JsonRpcError(-32603, ex.Message)
                );
            }

            var json = JsonSerializer.Serialize(response);
            await writer.WriteLineAsync(json);
        }
    }

    private static string Trim(string value) =>
        value.Length <= 240 ? value : value[..240] + "…";
}

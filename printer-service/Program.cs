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
    private static readonly PrinterSpoolerService Spooler = new();

    public static async Task Main(string[] args)
    {
        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cts.Cancel();
        };

        while (!cts.Token.IsCancellationRequested)
        {
            var server = new NamedPipeServerStream(
                PipeName,
                PipeDirection.InOut,
                NamedPipeServerStream.MaxAllowedServerInstances,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous
            );
            try
            {
                await server.WaitForConnectionAsync(cts.Token);
                // The handler owns the connected pipe; the accept loop must not dispose it.
                _ = HandleOwnedConnectionAsync(server, cts.Token);
            }
            catch
            {
                await server.DisposeAsync();
                if (cts.IsCancellationRequested) break;
                throw;
            }
        }
    }

    private static async Task HandleOwnedConnectionAsync(NamedPipeServerStream pipe, CancellationToken ct)
    {
        await using (pipe)
        {
            try { await HandleClientConnectionAsync(pipe, ct); }
            catch (IOException) { /* Client disconnected. */ }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
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
}

using System.Text.Json;
using System.Text.Json.Serialization;

namespace PrintStudio.PrinterService.Models;

public sealed record JsonRpcRequest(
    [property: JsonPropertyName("jsonrpc")] string JsonRpc,
    [property: JsonPropertyName("id")] JsonElement Id,
    [property: JsonPropertyName("method")] string Method,
    [property: JsonPropertyName("params")] JsonElement Params
);

public sealed record JsonRpcError(
    [property: JsonPropertyName("code")] int Code,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("data")] object? Data = null
);

public sealed record JsonRpcResponse(
    [property: JsonPropertyName("jsonrpc")] string JsonRpc,
    [property: JsonPropertyName("id")] JsonElement Id,
    [property: JsonPropertyName("result")] object? Result = null,
    [property: JsonPropertyName("error")] JsonRpcError? Error = null
);

public sealed record PrinterCapabilitiesDto(
    [property: JsonPropertyName("supportedPapers")] IReadOnlyList<string> SupportedPapers,
    [property: JsonPropertyName("supportedTrays")] IReadOnlyList<string> SupportedTrays,
    [property: JsonPropertyName("supportedMediaTypes")] IReadOnlyList<string> SupportedMediaTypes,
    [property: JsonPropertyName("supportsDuplex")] bool SupportsDuplex,
    [property: JsonPropertyName("supportsColor")] bool SupportsColor,
    [property: JsonPropertyName("supportedDpi")] IReadOnlyList<int> SupportedDpi,
    [property: JsonPropertyName("maxCopies")] int MaxCopies
);

public sealed record PrinterProfileDto(
    [property: JsonPropertyName("printerName")] string PrinterName,
    [property: JsonPropertyName("paperSize")] string PaperSize,
    [property: JsonPropertyName("tray")] string Tray,
    [property: JsonPropertyName("mediaType")] string MediaType,
    [property: JsonPropertyName("duplexMode")] string DuplexMode,
    [property: JsonPropertyName("orientation")] string Orientation,
    [property: JsonPropertyName("colorMode")] string ColorMode,
    [property: JsonPropertyName("dpi")] int Dpi,
    [property: JsonPropertyName("quality")] string Quality
);

public sealed record PrinterInfoDto(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("driverName")] string DriverName,
    [property: JsonPropertyName("portName")] string PortName,
    [property: JsonPropertyName("isDefault")] bool IsDefault,
    [property: JsonPropertyName("isNetwork")] bool IsNetwork,
    [property: JsonPropertyName("isVirtual")] bool IsVirtual,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("jobsInQueue")] int JobsInQueue,
    [property: JsonPropertyName("tonerLevelPercent")] int? TonerLevelPercent,
    [property: JsonPropertyName("totalPageCounter")] int? TotalPageCounter,
    [property: JsonPropertyName("location")] string? Location,
    [property: JsonPropertyName("capabilities")] PrinterCapabilitiesDto Capabilities,
    [property: JsonPropertyName("activeProfile")] PrinterProfileDto ActiveProfile
);

public sealed record SpoolerJobDto(
    [property: JsonPropertyName("jobId")] int JobId,
    [property: JsonPropertyName("printerName")] string PrinterName,
    [property: JsonPropertyName("documentTitle")] string DocumentTitle,
    [property: JsonPropertyName("userName")] string UserName,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("totalPages")] int TotalPages,
    [property: JsonPropertyName("pagesPrinted")] int PagesPrinted,
    [property: JsonPropertyName("sizeBytes")] long SizeBytes,
    [property: JsonPropertyName("priority")] int Priority,
    [property: JsonPropertyName("submittedAt")] string SubmittedAt
);

public sealed record ControlJobParams(
    [property: JsonPropertyName("printerName")] string PrinterName,
    [property: JsonPropertyName("jobId")] int JobId,
    [property: JsonPropertyName("action")] string Action,
    [property: JsonPropertyName("priority")] int? Priority
);

public sealed record PrintJobRpcParams(
    [property: JsonPropertyName("printerName")] string PrinterName,
    [property: JsonPropertyName("jobTitle")] string JobTitle,
    [property: JsonPropertyName("pdfFilePath")] string? PdfFilePath,
    [property: JsonPropertyName("copies")] int Copies,
    [property: JsonPropertyName("duplexMode")] string DuplexMode,
    [property: JsonPropertyName("dpi")] int Dpi,
    [property: JsonPropertyName("colorMode")] string ColorMode,
    [property: JsonPropertyName("tray")] string Tray
);

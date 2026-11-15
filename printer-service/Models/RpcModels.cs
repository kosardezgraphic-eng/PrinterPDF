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

public sealed record PrinterMarginRequestDto(
    [property: JsonPropertyName("printerName")] string PrinterName,
    [property: JsonPropertyName("paperSize")] string PaperSize,
    [property: JsonPropertyName("orientation")] string Orientation,
    [property: JsonPropertyName("widthMm")] double WidthMm,
    [property: JsonPropertyName("heightMm")] double HeightMm
);

public sealed record PrinterMarginsDto(
    [property: JsonPropertyName("top")] double Top,
    [property: JsonPropertyName("right")] double Right,
    [property: JsonPropertyName("bottom")] double Bottom,
    [property: JsonPropertyName("left")] double Left
);

public sealed record PrinterMarginResultDto(
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("source"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Source = null,
    [property: JsonPropertyName("marginsMm"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] PrinterMarginsDto? MarginsMm = null,
    [property: JsonPropertyName("reason"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Reason = null
);

public sealed record PrinterPaperOptionDto(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("widthMm")] double WidthMm,
    [property: JsonPropertyName("heightMm")] double HeightMm,
    [property: JsonPropertyName("rawKind"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? RawKind = null
);

public sealed record PrinterCapabilitiesDto(
    [property: JsonPropertyName("supportedPapers")] IReadOnlyList<string> SupportedPapers,
    [property: JsonPropertyName("supportedTrays")] IReadOnlyList<string> SupportedTrays,
    [property: JsonPropertyName("supportedMediaTypes")] IReadOnlyList<string> SupportedMediaTypes,
    [property: JsonPropertyName("supportsDuplex")] bool SupportsDuplex,
    [property: JsonPropertyName("supportsColor")] bool SupportsColor,
    [property: JsonPropertyName("supportedDpi")] IReadOnlyList<int> SupportedDpi,
    [property: JsonPropertyName("maxCopies")] int MaxCopies,
    [property: JsonPropertyName("paperOptions"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<PrinterPaperOptionDto>? PaperOptions = null,
    [property: JsonPropertyName("supportsCollate"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? SupportsCollate = null,
    [property: JsonPropertyName("supportsStaple"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? SupportsStaple = null,
    [property: JsonPropertyName("supportedStapleModes"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? SupportedStapleModes = null,
    [property: JsonPropertyName("supportedHolePunchModes"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? SupportedHolePunchModes = null,
    [property: JsonPropertyName("supportedFoldModes"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? SupportedFoldModes = null,
    [property: JsonPropertyName("supportedOutputBins"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? SupportedOutputBins = null,
    [property: JsonPropertyName("supportedQualities"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? SupportedQualities = null,
    [property: JsonPropertyName("supportsBorderless"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? SupportsBorderless = null
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
    [property: JsonPropertyName("quality")] string Quality,
    [property: JsonPropertyName("paperWidthMm"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] double? PaperWidthMm = null,
    [property: JsonPropertyName("paperHeightMm"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] double? PaperHeightMm = null,
    [property: JsonPropertyName("paperName"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? PaperName = null,
    [property: JsonPropertyName("collate"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Collate = null,
    [property: JsonPropertyName("staple"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Staple = null,
    [property: JsonPropertyName("outputBin"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? OutputBin = null,
    [property: JsonPropertyName("holePunch"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? HolePunch = null,
    [property: JsonPropertyName("fold"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Fold = null,
    [property: JsonPropertyName("borderless"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Borderless = null
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
    [property: JsonPropertyName("pageImagePaths")] IReadOnlyList<string>? PageImagePaths,
    [property: JsonPropertyName("copies")] int Copies,
    [property: JsonPropertyName("collate")] bool Collate,
    [property: JsonPropertyName("duplexMode")] string DuplexMode,
    [property: JsonPropertyName("dpi")] int Dpi,
    [property: JsonPropertyName("colorMode")] string ColorMode,
    [property: JsonPropertyName("tray")] string Tray,
    [property: JsonPropertyName("paperSize")] string? PaperSize = null,
    [property: JsonPropertyName("paperName")] string? PaperName = null,
    [property: JsonPropertyName("paperWidthMm")] double? PaperWidthMm = null,
    [property: JsonPropertyName("paperHeightMm")] double? PaperHeightMm = null,
    [property: JsonPropertyName("orientation")] string? Orientation = null,
    [property: JsonPropertyName("mediaType")] string? MediaType = null,
    [property: JsonPropertyName("quality")] string? Quality = null,
    [property: JsonPropertyName("staple")] string? Staple = null,
    [property: JsonPropertyName("outputBin")] string? OutputBin = null,
    [property: JsonPropertyName("holePunch")] string? HolePunch = null,
    [property: JsonPropertyName("fold")] string? Fold = null,
    [property: JsonPropertyName("borderless")] bool? Borderless = null
);

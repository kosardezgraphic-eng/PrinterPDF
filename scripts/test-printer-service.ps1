<#
.SYNOPSIS
  Talks to the PrintStudio print sidecar directly, without Electron, to prove whether the
  Windows Named Pipe and the spooler query work.

.DESCRIPTION
  Connects to \\.\pipe\PrintStudioPrinterService, sends one JSON-RPC 2.0 request
  (printer:list by default) and prints the reply.

  Use this when the app shows an empty printer list: if this script prints printers but the app
  does not, the Electron bridge (preload) is at fault; if this script cannot connect, the sidecar
  or the spooler is. The service is normally started by the Electron app
  (electron/printerSidecarClient.ts); to run it by hand, start
  printer-service\bin\Release\net8.0-windows\win-x64\publish\PrinterService.exe first.

  Exit codes: 0 ok (including "answered, but Windows has no printers"), 2 no pipe, 3 bad reply,
  4 the service reported a JSON-RPC error, 5 timeout.

.EXAMPLE
  .\scripts\test-printer-service.ps1
  .\scripts\test-printer-service.ps1 -Method spooler:list-jobs
  npm run test:sidecar
#>
[CmdletBinding()]
param(
  [string] $PipeName = 'PrintStudioPrinterService',
  [string] $Method = 'printer:list',
  [string] $ParamsJson = '{}',
  [int] $TimeoutMs = 8000
)

$ErrorActionPreference = 'Stop'
$script:exitCode = 0

function Write-Step([string] $Message) { Write-Host "[printer-service] $Message" }
function Fail([int] $Code, [string] $Message) {
  $script:exitCode = $Code
  Write-Host "[printer-service] $Message" -ForegroundColor Red
}

try {
  # Windows PowerShell 5.1 is still the default on Windows 10/11; .NET Framework 4.5+ is needed
  # for the async pipe read below, and everything in this script stays 5.1-compatible otherwise.
  if ($PSVersionTable.PSVersion.Major -lt 5) {
    throw "Windows PowerShell 5.0 or newer is required (this is $($PSVersionTable.PSVersion))."
  }

  $pipePath = '\\' + '.' + '\' + 'pipe' + '\' + $PipeName
  Write-Step "connecting to $pipePath"
  $pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
  try {
    $pipe.Connect($TimeoutMs)
  } catch {
    throw "No process accepted the connection on $pipePath within ${TimeoutMs}ms. Start the desktop app, or run PrinterService.exe directly. If it was never built: npm run build:service (needs the .NET 8 SDK)."
  }

  try {
    $request = '{"jsonrpc":"2.0","id":1,"method":"' + $Method + '","params":' + $ParamsJson + '}'
    Write-Step "sending $request"

    $payload = [System.Text.Encoding]::UTF8.GetBytes($request + [char]10)
    $writeTask = $pipe.WriteAsync($payload, 0, $payload.Length)
    if (-not $writeTask.Wait($TimeoutMs)) { throw "The pipe did not accept the request within ${TimeoutMs}ms." }

    # One ReadAsync can return a partial line, so accumulate until a newline shows up. A blocking
    # ReadLine would hang the console forever if the service died mid-request.
    $buffer = New-Object byte[] 65536
    $received = New-Object System.IO.MemoryStream
    $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
    $text = ''
    while ((Get-Date) -lt $deadline) {
      $readTask = $pipe.ReadAsync($buffer, 0, $buffer.Length)
      $remaining = [int]($deadline - (Get-Date)).TotalMilliseconds
      if ($remaining -le 0) { break }
      if (-not $readTask.Wait($remaining)) { break }
      if ($readTask.Result -le 0) { break }
      $received.Write($buffer, 0, $readTask.Result)
      $text = [System.Text.Encoding]::UTF8.GetString($received.ToArray())
      if ($text.IndexOf([char]10) -ge 0) { break }
    }

    $line = ($text -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 } | Select-Object -First 1)
    if (-not $line) {
      throw ("The service owns the pipe but answered nothing within ${TimeoutMs}ms - the spooler call is probably hanging. " +
        "Check the Print Spooler service (Get-Service Spooler) and read the sidecar log at $env:APPDATA\PrintStudioPro\printer-service.log")
    }

    Write-Step 'raw response:'
    Write-Host $line

    try {
      $parsed = $line | ConvertFrom-Json
    } catch {
      throw "The reply was not valid JSON: $($_.Exception.Message)"
    }

    if ($parsed.error) {
      Fail 4 "service error $($parsed.error.code): $($parsed.error.message)"
      if ($Method -eq 'printer:list') {
        Write-Step "printer:list failed inside the service; the stack trace is in $env:APPDATA\PrintStudioPro\printer-service.log"
      }
      exit $script:exitCode
    }

    if ($Method -eq 'printer:list') {
      $printers = @($parsed.result)
      if ($printers.Count -eq 0) {
        Write-Step 'the service answered successfully with an EMPTY list'
        Write-Warning 'Windows reported no printers. Check that the spooler is running (Get-Service Spooler) and that a printer is installed under Settings > Printers & scanners.'
        exit $script:exitCode
      }
      Write-Step "$($printers.Count) printer(s) read from the Windows spooler:"
      # The wire format is camelCase (JsonPropertyName on PrinterInfoDto). Format-Table needs
      # scalar properties; capabilities and activeProfile are objects and would print type names.
      $printers |
        Select-Object name, status, driverName, portName, isDefault, isVirtual, isNetwork, jobsInQueue, location |
        Format-Table -AutoSize |
        Out-String -Width 200 |
        Write-Host
      $default = @($printers | Where-Object { $_.isDefault })
      if ($default.Count -eq 0) { Write-Warning 'No printer is flagged as default; the app falls back to the first Ready queue.' }
    } else {
      Write-Step 'parsed result:'
      $parsed.result | ConvertTo-Json -Depth 6 | Write-Host
    }
  } finally {
    if ($pipe) { $pipe.Dispose() }
  }
} catch {
  if ($script:exitCode -eq 0) { $script:exitCode = 5 }
  Write-Host "[printer-service] $($_.Exception.Message)" -ForegroundColor Red
}

exit $script:exitCode

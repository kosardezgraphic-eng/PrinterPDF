param(
  [string]$PrinterName = "PrintStudio Pro Virtual Printer",
  [string]$SpoolPath = "$env:LOCALAPPDATA\PrintStudioPro\VirtualSpool\incoming-job.pdf",
  [string]$PaperSize = "A4",
  [ValidateSet("portrait", "landscape")]
  [string]$Orientation = "portrait",
  [int]$Dpi = 600,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin) {
  $argList = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$PSCommandPath`"",
    "-PrinterName", "`"$PrinterName`"",
    "-SpoolPath", "`"$SpoolPath`"",
    "-PaperSize", "`"$PaperSize`"",
    "-Orientation", "`"$Orientation`"",
    "-Dpi", $Dpi
  )
  if ($Uninstall) { $argList += "-Uninstall" }
  $proc = Start-Process -FilePath "powershell.exe" -ArgumentList $argList -Verb RunAs -Wait -PassThru
  exit $proc.ExitCode
}

if ($Uninstall) {
  if (Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue) {
    Remove-Printer -Name $PrinterName
  }
  if (Get-PrinterPort -Name $SpoolPath -ErrorAction SilentlyContinue) {
    Remove-PrinterPort -Name $SpoolPath -ErrorAction SilentlyContinue
  }
  Write-Host "Removed virtual printer '$PrinterName'."
  exit 0
}

$spoolDir = Split-Path -Path $SpoolPath -Parent
New-Item -ItemType Directory -Force -Path $spoolDir | Out-Null
try {
  & icacls $spoolDir /grant "*S-1-5-32-545:(OI)(CI)F" /grant "SYSTEM:(OI)(CI)F" /T /C | Out-Null
} catch {}

$driverName = $null
foreach ($candidate in @("Microsoft Print To PDF", "Microsoft XPS Document Writer v4")) {
  $drv = Get-PrinterDriver -Name $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($drv) { $driverName = $drv.Name; break }
}

if (-not $driverName) {
  Add-PrinterDriver -Name "Microsoft Print To PDF"
  $driverName = "Microsoft Print To PDF"
}

if (-not (Get-PrinterPort -Name $SpoolPath -ErrorAction SilentlyContinue)) {
  Add-PrinterPort -Name $SpoolPath
}

if (Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue) {
  Set-Printer -Name $PrinterName -DriverName $driverName -PortName $SpoolPath
} else {
  Add-Printer -Name $PrinterName -DriverName $driverName -PortName $SpoolPath
}

try {
  Set-PrintConfiguration -PrinterName $PrinterName -PaperSize $PaperSize -Color $true -ErrorAction SilentlyContinue | Out-Null
} catch {}

Write-Host "Installed '$PrinterName' using driver '$driverName' -> '$SpoolPath'."

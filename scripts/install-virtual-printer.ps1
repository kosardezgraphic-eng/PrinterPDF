param(
  [string]$PrinterName = "PrintStudio Pro Virtual Printer",
  [string]$SpoolPath = "$env:LOCALAPPDATA\PrintStudioPro\VirtualSpool\incoming-job.pdf",
  [string]$PaperSize = "A4",
  [ValidateSet("portrait", "landscape")]
  [string]$Orientation = "portrait",
  [int]$Dpi = 600,
  [switch]$Uninstall,
  [switch]$Silent
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$PrinterName = $PrinterName.Trim()
$SpoolPath = $SpoolPath.Trim()
$CanonicalPortSuffix = "\PrintStudioPro\VirtualSpool\incoming-job.pdf"
$SafeEscapedName = [regex]::Escape($PrinterName)

function Get-AllPrintersSafe {
  try {
    return @(Get-Printer -ErrorAction SilentlyContinue)
  } catch {
    return @()
  }
}

function Get-AllPrinterPortsSafe {
  try {
    return @(Get-PrinterPort -ErrorAction SilentlyContinue)
  } catch {
    return @()
  }
}

function Test-IsVirtualPrinterMatch {
  param($PrinterObj)
  if (-not $PrinterObj) { return $false }
  $name = [string]$PrinterObj.Name
  $port = [string]$PrinterObj.PortName
  if ($name -ieq $PrinterName) { return $true }
  if ($name -imatch ("^" + $SafeEscapedName + "\s*\(")) { return $true }
  if ($port -and (($port -ieq $SpoolPath) -or ($port.ToLowerInvariant().EndsWith($CanonicalPortSuffix.ToLowerInvariant())))) {
    return $true
  }
  return $false
}

function Test-IsVirtualPortMatch {
  param($PortObj)
  if (-not $PortObj) { return $false }
  $port = [string]$PortObj.Name
  return ($port -ieq $SpoolPath) -or ($port.ToLowerInvariant().EndsWith($CanonicalPortSuffix.ToLowerInvariant()))
}

# Read-only fast-path check BEFORE attempting UAC elevation:
# - On updates/reinstalls, if the canonical virtual printer already exists once on the exact port,
#   skip re-creating or prompting UAC so updates are seamless and never create duplicates.
# - On uninstall, if nothing is registered, exit cleanly without prompting UAC.
$initialPrinters = @(Get-AllPrintersSafe | Where-Object { Test-IsVirtualPrinterMatch $_ })
$initialPorts = @(Get-AllPrinterPortsSafe | Where-Object { Test-IsVirtualPortMatch $_ })

if (-not $Uninstall) {
  if ($initialPrinters.Count -eq 1 -and
      $initialPrinters[0].Name -ieq $PrinterName -and
      ([string]$initialPrinters[0].PortName) -ieq $SpoolPath) {
    $spoolDirOnly = Split-Path -Path $SpoolPath -Parent
    New-Item -ItemType Directory -Force -Path $spoolDirOnly | Out-Null
    Write-Host "Virtual printer '$PrinterName' already configured cleanly without duplicates."
    exit 0
  }
} else {
  if ($initialPrinters.Count -eq 0 -and $initialPorts.Count -eq 0) {
    if (Test-Path -LiteralPath $SpoolPath) {
      Remove-Item -LiteralPath $SpoolPath -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Virtual printer '$PrinterName' is already absent."
    exit 0
  }
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin) {
  $argList = @(
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", "`"$PSCommandPath`"",
    "-PrinterName", "`"$PrinterName`"",
    "-SpoolPath", "`"$SpoolPath`"",
    "-PaperSize", "`"$PaperSize`"",
    "-Orientation", "`"$Orientation`"",
    "-Dpi", $Dpi
  )
  if ($Uninstall) { $argList += "-Uninstall" }
  if ($Silent) { $argList += "-Silent" }
  $proc = Start-Process -FilePath "powershell.exe" -ArgumentList $argList -Verb RunAs -Wait -PassThru
  exit $proc.ExitCode
}

function Clear-PrinterQueueSafe {
  param([string]$TargetName)
  try {
    $jobs = @(Get-PrintJob -PrinterName $TargetName -ErrorAction SilentlyContinue)
    foreach ($job in $jobs) {
      Remove-PrintJob -PrinterName $TargetName -ID $job.ID -ErrorAction SilentlyContinue
    }
  } catch {}
}

if ($Uninstall) {
  $matchingPrinters = @(Get-AllPrintersSafe | Where-Object { Test-IsVirtualPrinterMatch $_ })
  foreach ($mp in $matchingPrinters) {
    Clear-PrinterQueueSafe -TargetName $mp.Name
    try {
      Remove-Printer -Name $mp.Name -ErrorAction Stop
    } catch {
      try {
        Start-Sleep -Milliseconds 250
        Remove-Printer -Name $mp.Name -ErrorAction SilentlyContinue
      } catch {}
    }
  }

  Start-Sleep -Milliseconds 300
  $matchingPorts = @(Get-AllPrinterPortsSafe | Where-Object { Test-IsVirtualPortMatch $_ })
  foreach ($port in $matchingPorts) {
    try {
      Remove-PrinterPort -Name $port.Name -ErrorAction SilentlyContinue
    } catch {}
  }

  if (Test-Path -LiteralPath $SpoolPath) {
    Remove-Item -LiteralPath $SpoolPath -Force -ErrorAction SilentlyContinue
  }
  $spoolDir = Split-Path -Path $SpoolPath -Parent
  if ($spoolDir -and (Test-Path -LiteralPath $spoolDir)) {
    $remaining = @(Get-ChildItem -LiteralPath $spoolDir -Force -ErrorAction SilentlyContinue)
    if ($remaining.Count -eq 0) {
      Remove-Item -LiteralPath $spoolDir -Force -ErrorAction SilentlyContinue
    }
  }

  Write-Host "Removed virtual printer '$PrinterName' and its spool port."
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

# Remove any duplicate/cloned virtual printers (e.g. "(Copy 1)" or old-port entries) so only one exists
$allMatching = @(Get-AllPrintersSafe | Where-Object { Test-IsVirtualPrinterMatch $_ })
$canonicalMatches = @($allMatching | Where-Object { $_.Name -ieq $PrinterName })
$duplicatePrinters = @($allMatching | Where-Object { $_.Name -ine $PrinterName })

foreach ($dup in $duplicatePrinters) {
  Clear-PrinterQueueSafe -TargetName $dup.Name
  Remove-Printer -Name $dup.Name -ErrorAction SilentlyContinue
}

# Ensure target local spool port exists
if (-not (Get-PrinterPort -Name $SpoolPath -ErrorAction SilentlyContinue)) {
  Add-PrinterPort -Name $SpoolPath
}

# Update canonical printer in-place or add once if absent
if ($canonicalMatches.Count -gt 1) {
  for ($i = 1; $i -lt $canonicalMatches.Count; $i++) {
    Remove-Printer -Name $canonicalMatches[$i].Name -ErrorAction SilentlyContinue
  }
}

if (Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue) {
  Set-Printer -Name $PrinterName -DriverName $driverName -PortName $SpoolPath
} else {
  Add-Printer -Name $PrinterName -DriverName $driverName -PortName $SpoolPath
}

# Clean up any old orphaned virtual spool ports that no printer points to anymore
$stalePorts = @(Get-AllPrinterPortsSafe | Where-Object { (Test-IsVirtualPortMatch $_) -and ($_.Name -ine $SpoolPath) })
foreach ($sp in $stalePorts) {
  Remove-PrinterPort -Name $sp.Name -ErrorAction SilentlyContinue
}

try {
  Set-PrintConfiguration -PrinterName $PrinterName -PaperSize $PaperSize -Color $true -ErrorAction SilentlyContinue | Out-Null
} catch {}

Write-Host "Installed single virtual printer '$PrinterName' using driver '$driverName' -> '$SpoolPath'."

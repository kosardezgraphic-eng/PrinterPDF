!include "LogicLib.nsh"

; Install the Windows Virtual Printer only on a fresh install. The PowerShell script is
; idempotent, but skipping it on app updates also avoids unnecessary UAC prompts.
!macro RunPrintStudioVirtualPrinter Arguments
  SetOutPath "$PLUGINSDIR"
  File /oname=install-virtual-printer.ps1 "${BUILD_RESOURCES_DIR}\..\scripts\install-virtual-printer.ps1"

  ; NSIS can be 32-bit on x64 Windows. Sysnative bypasses WOW64 redirection so the
  ; Windows print-management cmdlets run in native PowerShell.
  StrCpy $0 "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  ${If} ${RunningX64}
    StrCpy $0 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    IfFileExists "$0" +2 0
      StrCpy $0 "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}

  nsExec::ExecToLog '"$0" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-virtual-printer.ps1" -PrinterName "PrintStudio Pro Virtual Printer" -SpoolPath "$LOCALAPPDATA\PrintStudioPro\VirtualSpool\incoming-job.pdf" ${Arguments}'
  Pop $1
  ${If} $1 != 0
    DetailPrint "Virtual Printer provisioning returned $1."
  ${EndIf}
!macroend

!macro customInstall
  ${ifNot} ${isUpdated}
    !insertmacro RunPrintStudioVirtualPrinter "-Silent"
  ${endIf}
!macroend

!macro customUnInstall
  !insertmacro RunPrintStudioVirtualPrinter "-Uninstall -Silent"
!macroend

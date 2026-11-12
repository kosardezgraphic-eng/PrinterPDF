using System.Runtime.InteropServices;

namespace PrintStudio.PrinterService.Services;

/// <summary>
/// Win32 Spooler (winspool.drv) P/Invoke declarations for direct DEVMODE,
/// DeviceCapabilities, and Job Control operations.
/// </summary>
public static class WinSpoolInterop
{
    public const int DC_PAPERS = 2;
    public const int DC_BINS = 6;
    public const int DC_DUPLEX = 7;
    public const int DC_COPIES = 18;
    public const int DC_PAPERNAMES = 16;
    public const int DC_BINNAMES = 12;
    public const int DC_ENUMRESOLUTIONS = 13;
    public const int DC_COLORDEVICE = 32;
    public const int DC_MEDIATYPENAMES = 34;

    public const int JOB_CONTROL_PAUSE = 1;
    public const int JOB_CONTROL_RESUME = 2;
    public const int JOB_CONTROL_CANCEL = 3;
    public const int JOB_CONTROL_RESTART = 4;
    public const int JOB_CONTROL_DELETE = 5;

    public const int PRINTER_CONTROL_PURGE = 3;
    public const uint PRINTER_ENUM_LOCAL = 0x00000002;
    public const uint PRINTER_ENUM_CONNECTIONS = 0x00000004;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct PRINTER_INFO_4
    {
        public IntPtr pPrinterName;
        public IntPtr pServerName;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct PRINTER_DEFAULTS
    {
        public IntPtr pDatatype;
        public IntPtr pDevMode;
        public int DesiredAccess;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool EnumPrinters(uint flags, string? name, uint level, IntPtr buffer, uint bufferSize, out uint needed, out uint returned);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool GetDefaultPrinter(System.Text.StringBuilder? buffer, ref uint bufferSize);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool OpenPrinter(
        string pPrinterName,
        out IntPtr phPrinter,
        ref PRINTER_DEFAULTS pDefault
    );

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool SetDefaultPrinter(string pszPrinter);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int DeviceCapabilities(
        string pDevice,
        string pPort,
        short fwCapability,
        IntPtr pOutput,
        IntPtr pDevMode
    );

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool SetJob(
        IntPtr hPrinter,
        int JobId,
        int Level,
        IntPtr pJob,
        int Command
    );

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool SetPrinter(
        IntPtr hPrinter,
        int Level,
        IntPtr pPrinter,
        int Command
    );
}

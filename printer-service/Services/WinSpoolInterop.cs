using System.Runtime.InteropServices;

namespace PrintStudio.PrinterService.Services;

/// <summary>
/// Win32 Spooler (winspool.drv) P/Invoke declarations for direct DEVMODE,
/// DeviceCapabilities, and Job Control operations.
/// </summary>
public static class WinSpoolInterop
{
    public const int DC_PAPERS = 2;
    public const int DC_PAPERSIZE = 3;
    public const int DC_BINS = 6;
    public const int DC_DUPLEX = 7;
    public const int DC_BINNAMES = 12;
    public const int DC_ENUMRESOLUTIONS = 13;
    public const int DC_PAPERNAMES = 16;
    public const int DC_COPIES = 18;
    public const int DC_COLLATE = 22;
    public const int DC_STAPLE = 30;
    public const int DC_COLORDEVICE = 32;
    public const int DC_MEDIATYPENAMES = 34;

    public const int DM_ORIENTATION = 0x00000001;
    public const int DM_PAPERSIZE = 0x00000002;
    public const int DM_PAPERLENGTH = 0x00000004;
    public const int DM_PAPERWIDTH = 0x00000008;
    public const int DM_COPIES = 0x00000100;
    public const int DM_DEFAULTSOURCE = 0x00000200;
    public const int DM_PRINTQUALITY = 0x00000400;
    public const int DM_COLOR = 0x00000800;
    public const int DM_DUPLEX = 0x00001000;
    public const int DM_COLLATE = 0x00008000;

    public const int DM_OUT_BUFFER = 2;
    public const int DM_IN_BUFFER = 8;
    public const short DMPAPER_USER = 256;

    public const int HORZRES = 8;
    public const int VERTRES = 10;
    public const int LOGPIXELSX = 88;
    public const int LOGPIXELSY = 90;
    public const int PHYSICALWIDTH = 110;
    public const int PHYSICALHEIGHT = 111;
    public const int PHYSICALOFFSETX = 112;
    public const int PHYSICALOFFSETY = 113;

    public const int JOB_CONTROL_PAUSE = 1;
    public const int JOB_CONTROL_RESUME = 2;
    public const int JOB_CONTROL_CANCEL = 3;
    public const int JOB_CONTROL_RESTART = 4;
    public const int JOB_CONTROL_DELETE = 5;

    public const int PRINTER_CONTROL_PURGE = 3;
    public const uint PRINTER_ENUM_LOCAL = 0x00000002;
    public const uint PRINTER_ENUM_CONNECTIONS = 0x00000004;

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DEVMODEW
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmDeviceName;
        public short dmSpecVersion;
        public short dmDriverVersion;
        public short dmSize;
        public short dmDriverExtra;
        public int dmFields;
        public short dmOrientation;
        public short dmPaperSize;
        public short dmPaperLength;
        public short dmPaperWidth;
        public short dmScale;
        public short dmCopies;
        public short dmDefaultSource;
        public short dmPrintQuality;
        public short dmColor;
        public short dmDuplex;
        public short dmYResolution;
        public short dmTTOption;
        public short dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel;
        public int dmPelsWidth;
        public int dmPelsHeight;
        public int dmDisplayFlags;
        public int dmDisplayFrequency;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct PRINTER_INFO_4
    {
        public IntPtr pPrinterName;
        public IntPtr pServerName;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct PRINTER_INFO_2
    {
        public IntPtr pServerName;
        public IntPtr pPrinterName;
        public IntPtr pShareName;
        public IntPtr pPortName;
        public IntPtr pDriverName;
        public IntPtr pComment;
        public IntPtr pLocation;
        public IntPtr pDevMode;
        public IntPtr pSepFile;
        public IntPtr pPrintProcessor;
        public IntPtr pDatatype;
        public IntPtr pParameters;
        public IntPtr pSecurityDescriptor;
        public uint Attributes;
        public uint Priority;
        public uint DefaultPriority;
        public uint StartTime;
        public uint UntilTime;
        public uint Status;
        public uint cJobs;
        public uint AveragePPM;
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

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool OpenPrinter(
        string pPrinterName,
        out IntPtr phPrinter,
        IntPtr pDefault
    );

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int DocumentProperties(
        IntPtr hwnd,
        IntPtr hPrinter,
        string pDeviceName,
        IntPtr pDevModeOutput,
        IntPtr pDevModeInput,
        int fMode
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

    [DllImport("gdi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateDC(
        string? pwszDriver,
        string pwszDevice,
        string? pszPort,
        IntPtr pdm
    );

    [DllImport("gdi32.dll", SetLastError = true)]
    public static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    public static extern int GetDeviceCaps(IntPtr hdc, int index);
}

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class TmsTaskbarWindows {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr hWnd, uint command);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")]
    public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLong")]
    public static extern IntPtr GetWindowLongPtr32(IntPtr hWnd, int index);

    public static IntPtr GetWindowLongPtr(IntPtr hWnd, int index) {
        return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, index) : GetWindowLongPtr32(hWnd, index);
    }

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int size);

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct PropertyKey {
        public Guid formatId;
        public uint propertyId;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct PropVariant {
        [FieldOffset(0)] public ushort variantType;
        [FieldOffset(8)] public IntPtr pointerValue;
    }

    [ComImport]
    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore {
        [PreserveSig] int GetCount(out uint propertyCount);
        [PreserveSig] int GetAt(uint propertyIndex, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }

    [DllImport("shell32.dll")]
    private static extern int SHGetPropertyStoreForWindow(
        IntPtr hWnd,
        ref Guid interfaceId,
        [MarshalAs(UnmanagedType.Interface)] out IPropertyStore propertyStore
    );

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PropVariant value);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(
        IntPtr processHandle,
        int flags,
        StringBuilder executablePath,
        ref int executablePathLength
    );

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetApplicationUserModelId(
        IntPtr processHandle,
        ref uint applicationUserModelIdLength,
        StringBuilder applicationUserModelId
    );

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(
        IntPtr processHandle,
        int processInformationClass,
        IntPtr processInformation,
        int processInformationLength,
        out int returnLength
    );

    [StructLayout(LayoutKind.Sequential)]
    private struct UnicodeString {
        public ushort length;
        public ushort maximumLength;
        public IntPtr buffer;
    }

    public static string GetTitle(IntPtr hWnd) {
        int length = GetWindowTextLength(hWnd);
        if (length <= 0) return String.Empty;

        StringBuilder text = new StringBuilder(length + 1);
        GetWindowText(hWnd, text, text.Capacity);
        return text.ToString();
    }

    public static string GetAppUserModelId(IntPtr hWnd) {
        Guid propertyStoreId = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        IPropertyStore propertyStore;

        if (SHGetPropertyStoreForWindow(hWnd, ref propertyStoreId, out propertyStore) != 0) {
            return String.Empty;
        }

        try {
            PropertyKey key = new PropertyKey {
                formatId = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
                propertyId = 5
            };
            PropVariant value;

            if (propertyStore.GetValue(ref key, out value) != 0) return String.Empty;

            try {
                return value.variantType == 31 && value.pointerValue != IntPtr.Zero
                    ? Marshal.PtrToStringUni(value.pointerValue)
                    : String.Empty;
            } finally {
                PropVariantClear(ref value);
            }
        } finally {
            Marshal.ReleaseComObject(propertyStore);
        }
    }

    public static string GetProcessAppUserModelId(uint processId) {
        const uint ProcessQueryLimitedInformation = 0x1000;
        const int ErrorInsufficientBuffer = 122;
        IntPtr processHandle = OpenProcess(ProcessQueryLimitedInformation, false, processId);

        if (processHandle == IntPtr.Zero) return String.Empty;

        try {
            uint length = 0;
            int result = GetApplicationUserModelId(processHandle, ref length, null);
            if (result != ErrorInsufficientBuffer || length == 0) return String.Empty;

            StringBuilder value = new StringBuilder((int)length);
            return GetApplicationUserModelId(processHandle, ref length, value) == 0
                ? value.ToString()
                : String.Empty;
        } finally {
            CloseHandle(processHandle);
        }
    }

    public static string GetExecutablePath(uint processId) {
        const uint ProcessQueryLimitedInformation = 0x1000;
        IntPtr processHandle = OpenProcess(ProcessQueryLimitedInformation, false, processId);

        if (processHandle == IntPtr.Zero) return String.Empty;

        try {
            int length = 32768;
            StringBuilder value = new StringBuilder(length);
            return QueryFullProcessImageName(processHandle, 0, value, ref length)
                ? value.ToString()
                : String.Empty;
        } finally {
            CloseHandle(processHandle);
        }
    }

    public static string GetProcessCommandLine(uint processId) {
        const uint ProcessQueryLimitedInformation = 0x1000;
        const int ProcessCommandLineInformation = 60;
        IntPtr processHandle = OpenProcess(ProcessQueryLimitedInformation, false, processId);

        if (processHandle == IntPtr.Zero) return String.Empty;

        try {
            int requiredLength;
            NtQueryInformationProcess(
                processHandle,
                ProcessCommandLineInformation,
                IntPtr.Zero,
                0,
                out requiredLength
            );
            if (requiredLength <= 0) return String.Empty;

            IntPtr buffer = Marshal.AllocHGlobal(requiredLength);
            try {
                int result = NtQueryInformationProcess(
                    processHandle,
                    ProcessCommandLineInformation,
                    buffer,
                    requiredLength,
                    out requiredLength
                );
                if (result != 0) return String.Empty;

                UnicodeString value = (UnicodeString)Marshal.PtrToStructure(
                    buffer,
                    typeof(UnicodeString)
                );
                return value.buffer != IntPtr.Zero && value.length > 0
                    ? Marshal.PtrToStringUni(value.buffer, value.length / 2)
                    : String.Empty;
            } finally {
                Marshal.FreeHGlobal(buffer);
            }
        } finally {
            CloseHandle(processHandle);
        }
    }
}
'@

$GW_OWNER = 4
$GWL_EXSTYLE = -20
$WS_EX_APPWINDOW = 0x00040000
$WS_EX_TOOLWINDOW = 0x00000080
$DWMWA_CLOAKED = 14
$windows = [System.Collections.Generic.List[object]]::new()

$callback = [TmsTaskbarWindows+EnumWindowsProc] {
    param([IntPtr]$hWnd, [IntPtr]$lParam)

    if (-not [TmsTaskbarWindows]::IsWindowVisible($hWnd)) { return $true }

    $extendedStyle = [TmsTaskbarWindows]::GetWindowLongPtr($hWnd, $GWL_EXSTYLE).ToInt64()
    if (($extendedStyle -band $WS_EX_TOOLWINDOW) -ne 0) { return $true }

    $owner = [TmsTaskbarWindows]::GetWindow($hWnd, $GW_OWNER)
    if ($owner -ne [IntPtr]::Zero -and ($extendedStyle -band $WS_EX_APPWINDOW) -eq 0) {
        return $true
    }

    $cloaked = 0
    $dwmResult = [TmsTaskbarWindows]::DwmGetWindowAttribute(
        $hWnd,
        $DWMWA_CLOAKED,
        [ref]$cloaked,
        4
    )
    if ($dwmResult -eq 0 -and $cloaked -ne 0) { return $true }

    [uint32]$processId = 0
    [void][TmsTaskbarWindows]::GetWindowThreadProcessId($hWnd, [ref]$processId)
    if ($processId -gt 0) {
        $appUserModelId = [TmsTaskbarWindows]::GetAppUserModelId($hWnd)

        $windows.Add([pscustomobject]@{
            pid = $processId
            windowTitle = [TmsTaskbarWindows]::GetTitle($hWnd)
            appUserModelId = $appUserModelId
        })
    }

    return $true
}

[void][TmsTaskbarWindows]::EnumWindows($callback, [IntPtr]::Zero)

$seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$processDetails = @{}
$result = foreach ($window in $windows) {
    try {
        $processKey = [string]$window.pid
        if (-not $processDetails.ContainsKey($processKey)) {
            $processDetails[$processKey] = [pscustomobject]@{
                executablePath = [TmsTaskbarWindows]::GetExecutablePath($window.pid)
                commandLine = [TmsTaskbarWindows]::GetProcessCommandLine($window.pid)
                appUserModelId = [TmsTaskbarWindows]::GetProcessAppUserModelId($window.pid)
            }
        }

        $details = $processDetails[$processKey]
        if ([string]::IsNullOrWhiteSpace($details.executablePath)) { continue }

        $appUserModelId = $window.appUserModelId
        if ([string]::IsNullOrWhiteSpace($appUserModelId)) {
            $appUserModelId = $details.appUserModelId
        }

        $key = "$($window.pid)|$($window.windowTitle)|$appUserModelId"
        if (-not $seen.Add($key)) { continue }

        [pscustomobject]@{
            pid = [int]$window.pid
            processName = [System.IO.Path]::GetFileNameWithoutExtension($details.executablePath)
            executablePath = [string]$details.executablePath
            commandLine = [string]$details.commandLine
            windowTitle = [string]$window.windowTitle
            appUserModelId = [string]$appUserModelId
        }
    } catch {
        # Skip processes whose executable path is inaccessible.
    }
}

@($result) | ConvertTo-Json -Compress

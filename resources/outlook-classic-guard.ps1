param(
    [ValidateSet('inspect', 'activate', 'terminate')]
    [string]$Action = 'inspect'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class TmsOutlookClassicGuard {
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

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int size);

    public static string GetTitle(IntPtr hWnd) {
        int length = GetWindowTextLength(hWnd);
        if (length <= 0) return String.Empty;

        StringBuilder text = new StringBuilder(length + 1);
        GetWindowText(hWnd, text, text.Capacity);
        return text.ToString();
    }

    public static bool ActivateWindow(long hWndValue) {
        IntPtr hWnd = new IntPtr(hWndValue);
        const int SW_SHOW = 5;
        const int SW_RESTORE = 9;

        if (IsIconic(hWnd)) {
            ShowWindowAsync(hWnd, SW_RESTORE);
        } else {
            ShowWindowAsync(hWnd, SW_SHOW);
        }

        return SetForegroundWindow(hWnd);
    }
}
'@

$GW_OWNER = 4
$GWL_EXSTYLE = -20
$WS_EX_APPWINDOW = 0x00040000
$WS_EX_TOOLWINDOW = 0x00000080
$DWMWA_CLOAKED = 14

function Get-OutlookClassicProcesses {
    @(
        Get-Process -Name OUTLOOK -ErrorAction SilentlyContinue |
            ForEach-Object {
                [pscustomobject]@{
                    pid = [int]$_.Id
                }
            }
    )
}

function Get-OutlookClassicWindows {
    param(
        [object[]]$Processes
    )

    $pidSet = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($process in $Processes) {
        [void]$pidSet.Add([int]$process.pid)
    }

    if ($pidSet.Count -eq 0) {
        return @()
    }

    $windows = [System.Collections.Generic.List[object]]::new()

    $callback = [TmsOutlookClassicGuard+EnumWindowsProc] {
        param([IntPtr]$hWnd, [IntPtr]$lParam)

        if (-not [TmsOutlookClassicGuard]::IsWindowVisible($hWnd)) { return $true }

        $extendedStyle = [TmsOutlookClassicGuard]::GetWindowLongPtr($hWnd, $GWL_EXSTYLE).ToInt64()
        if (($extendedStyle -band $WS_EX_TOOLWINDOW) -ne 0) { return $true }

        $owner = [TmsOutlookClassicGuard]::GetWindow($hWnd, $GW_OWNER)
        if ($owner -ne [IntPtr]::Zero -and ($extendedStyle -band $WS_EX_APPWINDOW) -eq 0) {
            return $true
        }

        $cloaked = 0
        $dwmResult = [TmsOutlookClassicGuard]::DwmGetWindowAttribute(
            $hWnd,
            $DWMWA_CLOAKED,
            [ref]$cloaked,
            4
        )
        if ($dwmResult -eq 0 -and $cloaked -ne 0) { return $true }

        [uint32]$processId = 0
        [void][TmsOutlookClassicGuard]::GetWindowThreadProcessId($hWnd, [ref]$processId)
        if ($processId -gt 0 -and $pidSet.Contains([int]$processId)) {
            $windows.Add([pscustomobject]@{
                pid = [int]$processId
                hWnd = [string]$hWnd.ToInt64()
                windowTitle = [TmsOutlookClassicGuard]::GetTitle($hWnd)
            })
        }

        return $true
    }

    [void][TmsOutlookClassicGuard]::EnumWindows($callback, [IntPtr]::Zero)
    @($windows.ToArray())
}

$processes = Get-OutlookClassicProcesses
$windows = Get-OutlookClassicWindows -Processes $processes
$activated = $false
$activatedWindow = $null
$terminatedProcessIds = [System.Collections.Generic.List[int]]::new()
$remainingProcessIds = [System.Collections.Generic.List[int]]::new()
$errors = [System.Collections.Generic.List[string]]::new()

if ($Action -eq 'activate' -and @($windows).Count -gt 0) {
    $activatedWindow = @($windows | Sort-Object @{ Expression = { if ([string]::IsNullOrWhiteSpace($_.windowTitle)) { 1 } else { 0 } } } | Select-Object -First 1)[0]
    $activated = [TmsOutlookClassicGuard]::ActivateWindow([Int64]$activatedWindow.hWnd)
}

if ($Action -eq 'terminate' -and @($windows).Count -eq 0) {
    $targetProcessIds = @($processes | ForEach-Object { [int]$_.pid })

    if ($targetProcessIds.Count -gt 0) {
        foreach ($processId in $targetProcessIds) {
            try {
                Stop-Process -Id $processId -Force -ErrorAction Stop
                [void]$terminatedProcessIds.Add($processId)
            } catch {
                [void]$errors.Add("PID ${processId}: $($_.Exception.Message)")
            }
        }

        $deadline = (Get-Date).AddSeconds(5)
        while ((Get-Date) -lt $deadline) {
            $remaining = @(Get-Process -Id $targetProcessIds -ErrorAction SilentlyContinue)
            if ($remaining.Count -eq 0) {
                break
            }

            Start-Sleep -Milliseconds 200
        }

        foreach ($process in @(Get-Process -Id $targetProcessIds -ErrorAction SilentlyContinue)) {
            [void]$remainingProcessIds.Add([int]$process.Id)
        }
    }
}

[pscustomobject]@{
    action = $Action
    processIds = @($processes | ForEach-Object { [int]$_.pid })
    windows = @($windows)
    activated = [bool]$activated
    activatedWindow = $activatedWindow
    terminatedProcessIds = @($terminatedProcessIds.ToArray())
    remainingProcessIds = @($remainingProcessIds.ToArray())
    errors = @($errors.ToArray())
} | ConvertTo-Json -Compress -Depth 4

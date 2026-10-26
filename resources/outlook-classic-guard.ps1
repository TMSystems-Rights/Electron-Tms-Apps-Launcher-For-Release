<#
.SYNOPSIS
    Outlook クラシックの検査、前面化、終了を行う

.DESCRIPTION
    可視ウィンドウと OUTLOOK プロセスを JSON で返す
    inspect は変更しない。activate は先頭ウィンドウを前面にする
    terminate は可視ウィンドウが無いときだけ残プロセスを強制終了する

.PARAMETER Action
    inspect、activate、terminate のいずれか。未指定時は inspect

.OUTPUTS
    System.String
    action、processIds、windows、activated、terminatedProcessIds、remainingProcessIds、errors を含む JSON

.EXAMPLE
    pwsh -NoProfile -File resources/outlook-classic-guard.ps1 -Action inspect

.NOTES
    例外:
    - Win32 列挙の型読み込みに失敗したときは、その例外をそのまま送出する
    - 個別プロセスの終了失敗は errors に入れ、スクリプト全体は throw しない
#>
param(
	[ValidateSet('inspect', 'activate', 'terminate')]
	[string]$Action = 'inspect'
)

# 失敗したら止める。Win32 型の読み込み失敗は、その例外のまま出す
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
# 子プロセスとリダイレクトの出力エンコーディング。BOM なし UTF-8。JSON が文字化けしないようにする
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
        // タイトルの文字数。0 以下は空タイトル
        int length = GetWindowTextLength(hWnd);
        // タイトルが無い。空文字を返し、バッファは作らない
        if (length <= 0) return String.Empty;

        // 終端 NUL を含めたバッファ。length が 0 のときはここへ来ない
        StringBuilder text = new StringBuilder(length + 1);
        GetWindowText(hWnd, text, text.Capacity);
        return text.ToString();
    }

    public static bool ActivateWindow(long hWndValue) {
        // 前面化するウィンドウ。0 は無効ハンドルで、前面化は失敗する
        IntPtr hWnd = new IntPtr(hWndValue);
        // ShowWindow の表示。最小化されていないときに使う
        const int SW_SHOW = 5;
        // ShowWindow の復元。最小化されているときに使う
        const int SW_RESTORE = 9;

        // 最小化されている。復元してから前面化する。最小化でなければ表示するだけ
        if (IsIconic(hWnd)) {
            ShowWindowAsync(hWnd, SW_RESTORE);
        } else {
            ShowWindowAsync(hWnd, SW_SHOW);
        }

        return SetForegroundWindow(hWnd);
    }
}
'@

# GetWindow のコマンド。オーナーウィンドウを取る
$GW_OWNER = 4
# GetWindowLongPtr のインデックス。拡張ウィンドウスタイル
$GWL_EXSTYLE = -20
# 拡張スタイル。タスクバーへ出すアプリウィンドウ
$WS_EX_APPWINDOW = 0x00040000
# 拡張スタイル。タスクバーに出さないツールウィンドウ
$WS_EX_TOOLWINDOW = 0x00000080
# DwmGetWindowAttribute の属性。クロークされているか
$DWMWA_CLOAKED = 14

<#
.SYNOPSIS
    起動中の OUTLOOK プロセス ID を返す

.DESCRIPTION
    プロセスが無いときは空配列。プロセスは終了しない

.OUTPUTS
    System.Management.Automation.PSObject[]
    pid だけを持つ

.EXAMPLE
    $processes = Get-OutlookClassicProcesses
#>
function Get-OutlookClassicProcesses {
	@(
		Get-Process -Name OUTLOOK -ErrorAction SilentlyContinue |
			ForEach-Object {
				# 起動中の 1 プロセス。OUTLOOK が無ければ、このオブジェクトは作らない
				[pscustomobject]@{
					# OUTLOOK の PID。ウィンドウの所属判定に使う。0 にはならない
					pid = [int]$_.Id
				}
			}
	)
}

<#
.SYNOPSIS
    指定プロセスが所有する可視ウィンドウを返す

.DESCRIPTION
    ツールウィンドウとクロークされたウィンドウは除く。ウィンドウは前面化しない

.PARAMETER Processes
    pid を持つプロセス一覧。空なら空配列

.OUTPUTS
    System.Management.Automation.PSObject[]
    pid、hWnd、windowTitle を持つ

.EXAMPLE
    $windows = Get-OutlookClassicWindows -Processes $processes
#>
function Get-OutlookClassicWindows {
	param(
		[object[]]$Processes
	)

	# ----------------------------------------------
	# 対象プロセス
	# ----------------------------------------------
	# 対象 OUTLOOK の PID。列挙中の所属判定に使う
	$pidSet = [System.Collections.Generic.HashSet[int]]::new()
	foreach ($process in $Processes) {
		[void]$pidSet.Add([int]$process.pid)
	}

	# 対象 PID が無い。全ウィンドウを見ても採用できるものがない
	if ($pidSet.Count -eq 0) {
		return @()
	}

	# ----------------------------------------------
	# タスクバーに出るウィンドウ
	# ----------------------------------------------
	# 採用したウィンドウ。コールバックから追加する
	$windows = [System.Collections.Generic.List[object]]::new()

	# 1 ウィンドウ分の判定。false を返すと EnumWindows が残りの列挙を止める
	$callback = [TmsOutlookClassicGuard+EnumWindowsProc] {
		param([IntPtr]$hWnd, [IntPtr]$lParam)

		# ----- 見えていないウィンドウ -----
		# 不可視はタスクバーに出ない。除外して列挙は続ける
		if (-not [TmsOutlookClassicGuard]::IsWindowVisible($hWnd)) { return $true }

		# ----- ツールウィンドウ -----
		# 拡張スタイル。ツールウィンドウとアプリウィンドウの判定に使う
		$extendedStyle = [TmsOutlookClassicGuard]::GetWindowLongPtr($hWnd, $GWL_EXSTYLE).ToInt64()
		# ツールウィンドウはタスクバーに出ない。除外して列挙は続ける
		if (($extendedStyle -band $WS_EX_TOOLWINDOW) -ne 0) { return $true }

		# ----- オーナー付きのポップアップ -----
		# このウィンドウのオーナー。無いときはゼロ
		$owner = [TmsOutlookClassicGuard]::GetWindow($hWnd, $GW_OWNER)
		# オーナーがあり、アプリウィンドウでなければ本体ではない。除外して列挙は続ける
		if ($owner -ne [IntPtr]::Zero -and ($extendedStyle -band $WS_EX_APPWINDOW) -eq 0) {
			return $true
		}

		# ----- クロークされたウィンドウ -----
		# クローク値。0 は見えている。DWM へ渡す前の初期値
		$cloaked = 0
		# DWM の戻り値。0 は取得成功。失敗時はクロークを信用しない
		$dwmResult = [TmsOutlookClassicGuard]::DwmGetWindowAttribute(
			$hWnd,
			$DWMWA_CLOAKED,
			[ref]$cloaked,
			4
		)
		# 取得に成功し、クロークされていれば画面に無い。除外して列挙は続ける
		if ($dwmResult -eq 0 -and $cloaked -ne 0) { return $true }

		# ----- 対象プロセスが所有するウィンドウ -----
		# ウィンドウを所有するプロセス ID。取れないときは 0
		[uint32]$processId = 0
		[void][TmsOutlookClassicGuard]::GetWindowThreadProcessId($hWnd, [ref]$processId)
		# 対象 PID のウィンドウだけ採用する。それ以外は列挙を続ける
		if ($processId -gt 0 -and $pidSet.Contains([int]$processId)) {
			# 対象 PID が所有する 1 ウィンドウ。ツールウィンドウとクロークはここへ来ない
			$windows.Add([pscustomobject]@{
					# 所有プロセスの PID。対象集合に含まれる
					pid         = [int]$processId
					# ウィンドウハンドルの十進文字列。前面化の引数に使う。0 は無効
					hWnd        = [string]$hWnd.ToInt64()
					# ウィンドウタイトル。空なら前面化のとき後ろへ回す
					windowTitle = [TmsOutlookClassicGuard]::GetTitle($hWnd)
				})
		}

		# 除外も採用もしない。次のウィンドウへ進む
		return $true
	}

	[void][TmsOutlookClassicGuard]::EnumWindows($callback, [IntPtr]::Zero)
	@($windows.ToArray())
}

# 起動中の OUTLOOK。ウィンドウが無くてもプロセスだけ残ることがある
$processes = Get-OutlookClassicProcesses
# タスクバーに出ている OUTLOOK のウィンドウ
$windows = Get-OutlookClassicWindows -Processes $processes
# 前面化できたか。inspect と terminate、対象ウィンドウが無いときは false
$activated = $false
# 前面化したウィンドウ。していないときは null
$activatedWindow = $null
# 強制終了できた PID
$terminatedProcessIds = [System.Collections.Generic.List[int]]::new()
# 終了待ちのあと、まだ残っている PID
$remainingProcessIds = [System.Collections.Generic.List[int]]::new()
# 個別プロセスの終了失敗。全体は止めない
$errors = [System.Collections.Generic.List[string]]::new()

# 前面化は、可視ウィンドウがあるときだけ行う
if ($Action -eq 'activate' -and @($windows).Count -gt 0) {
	# タイトルが空のウィンドウは後ろへ回し、タイトルがある先頭を前面化する
	$activatedWindow = @(
		$windows | Sort-Object @{
			Expression = {
				# タイトルが空なら後ろ。あるものを先に選ぶ
				if ([string]::IsNullOrWhiteSpace($_.windowTitle)) { 1 } else { 0 }
			}
		} | Select-Object -First 1
	)[0]
	# 前面化 API の戻り値。false は前面に出せなかった
	$activated = [TmsOutlookClassicGuard]::ActivateWindow([Int64]$activatedWindow.hWnd)
}

# 可視ウィンドウがあるときは作業中なので、プロセスは終了しない
if ($Action -eq 'terminate' -and @($windows).Count -eq 0) {
	# 終了対象の PID。ウィンドウ列挙とは別に、プロセス一覧から取る
	$targetProcessIds = @($processes | ForEach-Object { [int]$_.pid })

	# 終了する PID があるときだけ Stop-Process する
	if ($targetProcessIds.Count -gt 0) {
		foreach ($processId in $targetProcessIds) {
			try {
				Stop-Process -Id $processId -Force -ErrorAction Stop
				[void]$terminatedProcessIds.Add($processId)
			} catch {
				[void]$errors.Add("PID ${processId}: $($_.Exception.Message)")
			}
		}

		# プロセス終了は非同期。最大 5 秒まで消えたかを見る期限
		$deadline = (Get-Date).AddSeconds(5)
		while ((Get-Date) -lt $deadline) {
			# まだ生きている対象 PID。空なら待ちを終わる
			$remaining = @(Get-Process -Id $targetProcessIds -ErrorAction SilentlyContinue)
			# 対象 PID がすべて消えた
			if ($remaining.Count -eq 0) {
				break
			}

			# 終了直後はプロセスが残る。200ms ごとに再確認する
			Start-Sleep -Milliseconds 200
		}

		foreach ($process in @(Get-Process -Id $targetProcessIds -ErrorAction SilentlyContinue)) {
			[void]$remainingProcessIds.Add([int]$process.Id)
		}
	}
}

# 呼び出し側へ返す検査結果。個別の失敗は errors に積み、ここでは throw しない
[pscustomobject]@{
	# 依頼した操作。inspect、activate、terminate のいずれか
	action               = $Action
	# 見つかった OUTLOOK の PID。ウィンドウが無くてもプロセスがあれば含める
	processIds           = @($processes | ForEach-Object { [int]$_.pid })
	# タスクバーに出ている可視ウィンドウ。無いときは空配列
	windows              = @($windows)
	# 前面化できたとき true。inspect と terminate、対象ウィンドウが無いときは false
	activated            = [bool]$activated
	# 前面化したウィンドウ。していないときは null
	activatedWindow      = $activatedWindow
	# 強制終了できた PID。inspect と activate では空
	terminatedProcessIds = @($terminatedProcessIds.ToArray())
	# 終了待ちのあと残った PID。残っていれば呼び出し側は再起動を止める
	remainingProcessIds  = @($remainingProcessIds.ToArray())
	# 個別プロセスの終了失敗。全体は止めず、メッセージだけ返す
	errors               = @($errors.ToArray())
} | ConvertTo-Json -Compress -Depth 4

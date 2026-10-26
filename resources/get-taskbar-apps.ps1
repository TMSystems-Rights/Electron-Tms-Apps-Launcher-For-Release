<#
.SYNOPSIS
    タスクバーに出ているウィンドウのプロセスを JSON で返す

.DESCRIPTION
    可視ウィンドウからプロセスパス、コマンドライン、AppUserModelID を集める
    プロセスもウィンドウも終了しない。ファイルは変更しない
    実行パスを読めないプロセスは結果から除く

.OUTPUTS
    System.String
    pid、processName、executablePath、commandLine、windowTitle、appUserModelId を含む JSON

.EXAMPLE
    pwsh -NoProfile -File resources/get-taskbar-apps.ps1

.NOTES
    例外:
    - Win32 列挙の型読み込みに失敗したときは、その例外をそのまま送出する
#>
# 失敗したら止める。Win32 型の読み込み失敗は、その例外のまま出す
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
        // タイトルの文字数。0 以下は空タイトル
        int length = GetWindowTextLength(hWnd);
        // タイトルが無い。空文字を返し、バッファは作らない
        if (length <= 0) return String.Empty;

        // 終端 NUL を含めたバッファ。length が 0 のときはここへ来ない
        StringBuilder text = new StringBuilder(length + 1);
        GetWindowText(hWnd, text, text.Capacity);
        return text.ToString();
    }

    public static string GetAppUserModelId(IntPtr hWnd) {
        // ウィンドウのプロパティストアの IID。取得に失敗したら ID は空
        Guid propertyStoreId = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        // ウィンドウのプロパティストア。取得失敗時は未使用
        IPropertyStore propertyStore;

        // プロパティストアを開けない。AppUserModelID は空
        if (SHGetPropertyStoreForWindow(hWnd, ref propertyStoreId, out propertyStore) != 0) {
            return String.Empty;
        }

        try {
            // System.AppUserModel.ID。formatId はそのプロパティセット、propertyId 5 が ID 本体
            PropertyKey key = new PropertyKey {
                formatId = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
                propertyId = 5
            };
            // 取得した値。読めないときは未使用。読めたときは finally で解放する
            PropVariant value;

            // プロパティ値を読めない。ID は空
            if (propertyStore.GetValue(ref key, out value) != 0) return String.Empty;

            try {
                // VT_LPWSTR (31) で、かつ文字列ポインタがあるときだけ ID にする。どちらかが欠けても空
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
        // PROCESS_QUERY_LIMITED_INFORMATION。ハンドルを開けないときは ID を空にする
        const uint ProcessQueryLimitedInformation = 0x1000;
        // バッファ不足。長さを知る 1 回目の戻り値で、0 は成功ではない
        const int ErrorInsufficientBuffer = 122;
        // プロセスハンドル。Zero なら権限不足か、すでに終了している
        IntPtr processHandle = OpenProcess(ProcessQueryLimitedInformation, false, processId);

        // ハンドルを開けない。ID は空
        if (processHandle == IntPtr.Zero) return String.Empty;

        try {
            // 必要な文字数。0 のままなら ID は無い
            uint length = 0;
            // 1 回目の戻り値。バッファ不足以外は、ID を持たない
            int result = GetApplicationUserModelId(processHandle, ref length, null);
            // バッファ不足以外か、長さが 0。どちらか一方でも ID は空。バッファ不足かつ長さが 1 以上のときだけ先へ進む
            if (result != ErrorInsufficientBuffer || length == 0) return String.Empty;

            // 2 回目に渡すバッファ。length が 0 のときはここへ来ない
            StringBuilder value = new StringBuilder((int)length);
            // 2 回目が成功 (0) したときだけ ID にする。失敗時は空
            return GetApplicationUserModelId(processHandle, ref length, value) == 0
                ? value.ToString()
                : String.Empty;
        } finally {
            CloseHandle(processHandle);
        }
    }

    public static string GetExecutablePath(uint processId) {
        // PROCESS_QUERY_LIMITED_INFORMATION。ハンドルを開けないときはパスを空にする
        const uint ProcessQueryLimitedInformation = 0x1000;
        // プロセスハンドル。Zero なら権限不足か、すでに終了している
        IntPtr processHandle = OpenProcess(ProcessQueryLimitedInformation, false, processId);

        // ハンドルを開けない。実行パスは空
        if (processHandle == IntPtr.Zero) return String.Empty;

        try {
            // パスバッファの文字数。長いパスも収める。0 にはしない
            int length = 32768;
            // 実行ファイルのフルパス。Query に失敗したときは空のまま捨てる
            StringBuilder value = new StringBuilder(length);
            // Query が成功したときだけパスにする。失敗時は空
            return QueryFullProcessImageName(processHandle, 0, value, ref length)
                ? value.ToString()
                : String.Empty;
        } finally {
            CloseHandle(processHandle);
        }
    }

    public static string GetProcessCommandLine(uint processId) {
        // PROCESS_QUERY_LIMITED_INFORMATION。ハンドルを開けないときはコマンドラインを空にする
        const uint ProcessQueryLimitedInformation = 0x1000;
        // ProcessCommandLineInformation。コマンドラインを取れないときは空
        const int ProcessCommandLineInformation = 60;
        // プロセスハンドル。Zero なら権限不足か、すでに終了している
        IntPtr processHandle = OpenProcess(ProcessQueryLimitedInformation, false, processId);

        // ハンドルを開けない。コマンドラインは空
        if (processHandle == IntPtr.Zero) return String.Empty;

        try {
            // 必要なバイト数。0 以下ならコマンドラインは読めない
            int requiredLength;
            NtQueryInformationProcess(
                processHandle,
                ProcessCommandLineInformation,
                IntPtr.Zero,
                0,
                out requiredLength
            );
            // 必要サイズが 0 以下。コマンドラインは空
            if (requiredLength <= 0) return String.Empty;

            // コマンドライン構造体のバッファ。finally で解放する
            IntPtr buffer = Marshal.AllocHGlobal(requiredLength);
            try {
                // NtQuery の NTSTATUS。0 以外は失敗で、コマンドラインは空
                int result = NtQueryInformationProcess(
                    processHandle,
                    ProcessCommandLineInformation,
                    buffer,
                    requiredLength,
                    out requiredLength
                );
                // 取得に失敗した。コマンドラインは空
                if (result != 0) return String.Empty;

                // バッファ先頭の UNICODE_STRING。buffer が Zero、または length が 0 なら空
                UnicodeString value = (UnicodeString)Marshal.PtrToStructure(
                    buffer,
                    typeof(UnicodeString)
                );
                // バッファがあり、かつバイト長が 1 以上のときだけ文字列にする。どちらかが欠けても空。length はバイト数なので文字数はその半分
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
# 採用したウィンドウ。コールバックから追加する。0 件なら結果は空配列
$windows = [System.Collections.Generic.List[object]]::new()

# 1 ウィンドウ分の判定。false を返すと EnumWindows が残りの列挙を止める
$callback = [TmsTaskbarWindows+EnumWindowsProc] {
	param([IntPtr]$hWnd, [IntPtr]$lParam)

	# 不可視はタスクバーに出ない。除外して列挙は続ける
	if (-not [TmsTaskbarWindows]::IsWindowVisible($hWnd)) { return $true }

	# 拡張スタイル。ツールウィンドウとアプリウィンドウの判定に使う
	$extendedStyle = [TmsTaskbarWindows]::GetWindowLongPtr($hWnd, $GWL_EXSTYLE).ToInt64()
	# ツールウィンドウはタスクバーに出ない。除外して列挙は続ける
	if (($extendedStyle -band $WS_EX_TOOLWINDOW) -ne 0) { return $true }

	# このウィンドウのオーナー。無いときはゼロ
	$owner = [TmsTaskbarWindows]::GetWindow($hWnd, $GW_OWNER)
	# オーナーがあり、かつアプリウィンドウではない。どちらかが欠けても除外しない
	if ($owner -ne [IntPtr]::Zero -and ($extendedStyle -band $WS_EX_APPWINDOW) -eq 0) {
		return $true
	}

	# クローク値。0 は見えている。DWM へ渡す前の初期値
	$cloaked = 0
	# DWM の戻り値。0 は取得成功。失敗時はクロークを信用しない
	$dwmResult = [TmsTaskbarWindows]::DwmGetWindowAttribute(
		$hWnd,
		$DWMWA_CLOAKED,
		[ref]$cloaked,
		4
	)
	# 取得に成功し、かつクロークされている。どちらかが欠けても除外しない
	if ($dwmResult -eq 0 -and $cloaked -ne 0) { return $true }

	# ウィンドウを所有するプロセス ID。取れないときは 0
	[uint32]$processId = 0
	[void][TmsTaskbarWindows]::GetWindowThreadProcessId($hWnd, [ref]$processId)
	# プロセス ID が取れたウィンドウだけ採用する。0 は列挙を続ける
	if ($processId -gt 0) {
		# ウィンドウプロパティの AppUserModelID。読めなければ空
		$appUserModelId = [TmsTaskbarWindows]::GetAppUserModelId($hWnd)

		# 採用した 1 ウィンドウ。実行パスは後段で足す
		$windows.Add([pscustomobject]@{
				# 所有プロセスの PID。0 のときはここへ来ない
				pid            = $processId
				# ウィンドウタイトル。空タイトルもあり得る
				windowTitle    = [TmsTaskbarWindows]::GetTitle($hWnd)
				# ウィンドウ側の AppUserModelID。空なら後でプロセス側を使う
				appUserModelId = $appUserModelId
			})
	}

	return $true
}

[void][TmsTaskbarWindows]::EnumWindows($callback, [IntPtr]::Zero)

# すでに出した pid、タイトル、AppUserModelID の組。大文字小文字は区別しない。空なら初回はすべて通る
$seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
# PID ごとの実行パスとコマンドライン。同じ PID のウィンドウでは再取得しない
$processDetails = @{}
# 実行パスが読めたウィンドウだけ。読めないプロセスは含めない
$result = foreach ($window in $windows) {
	try {
		# 詳細キャッシュのキー。PID の十進文字列。空にはならない
		$processKey = [string]$window.pid
		# この PID の詳細がまだ無い。取得に失敗しても、次のウィンドウで再試行できる
		if (-not $processDetails.ContainsKey($processKey)) {
			# プロセスから読んだ詳細。実行パスが空なら結果には出さない
			$processDetails[$processKey] = [pscustomobject]@{
				# 実行ファイルのフルパス。読めなければ空
				executablePath = [TmsTaskbarWindows]::GetExecutablePath($window.pid)
				# コマンドライン。読めなければ空
				commandLine    = [TmsTaskbarWindows]::GetProcessCommandLine($window.pid)
				# プロセス側の AppUserModelID。ウィンドウ側が空のときの予備。無ければ空
				appUserModelId = [TmsTaskbarWindows]::GetProcessAppUserModelId($window.pid)
			}
		}

		# キャッシュした詳細。実行パスが空なら、このウィンドウは捨てる
		$details = $processDetails[$processKey]
		# 実行パスが空。起動中判定に使えないので、次のウィンドウへ進む
		if ([string]::IsNullOrWhiteSpace($details.executablePath)) { continue }

		# ウィンドウ側の AppUserModelID。空ならプロセス側へ置き換える
		$appUserModelId = $window.appUserModelId
		# ウィンドウ側が空。プロセス側も空なら、結果の ID は空のまま
		if ([string]::IsNullOrWhiteSpace($appUserModelId)) {
			# プロセス側の AppUserModelID。無ければ空文字のまま
			$appUserModelId = $details.appUserModelId
		}

		# 重複判定のキー。同じ PID、タイトル、ID は 1 件だけ出す
		$key = "$($window.pid)|$($window.windowTitle)|$appUserModelId"
		# 同じキーが既にある。2 件目は出さない
		if (-not $seen.Add($key)) { continue }

		# 呼び出し側へ返す 1 ウィンドウ。実行パスが空の件はここへ来ない
		[pscustomobject]@{
			# プロセス ID。数値。0 の件は手前で除外済み
			pid            = [int]$window.pid
			# 実行ファイル名から拡張子を除いたもの。パスが空のときはここへ来ない
			processName    = [System.IO.Path]::GetFileNameWithoutExtension($details.executablePath)
			# 実行ファイルのフルパス。空の件は手前で除外済み
			executablePath = [string]$details.executablePath
			# コマンドライン。読めなければ空文字
			commandLine    = [string]$details.commandLine
			# ウィンドウタイトル。空もあり得る
			windowTitle    = [string]$window.windowTitle
			# ウィンドウ側、無ければプロセス側。両方空なら空文字
			appUserModelId = [string]$appUserModelId
		}
	} catch {
		# 実行パスを読めないプロセスは、起動中判定に使えないので飛ばす
	}
}

@($result) | ConvertTo-Json -Compress

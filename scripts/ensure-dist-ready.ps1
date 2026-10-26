<#
.SYNOPSIS
    dist の前に、app.asar を置き換えられるかを検査する

.DESCRIPTION
    electron-builder は既存 app.asar の unlink に失敗すると EBUSY になる
    プロセスと app.asar は削除しない。ロックされていれば終了コード 1 で理由を出す

.PARAMETER ProjectRoot
    リポジトリのルート。未指定時は、このスクリプトの親ディレクトリ

.OUTPUTS
    なし。結果は標準出力へ書く

.EXAMPLE
    pwsh -NoProfile -File scripts/ensure-dist-ready.ps1

.NOTES
    例外:
    - package.json を読めないときは、その例外をそのまま送出する
    - ロックを見つけたときは throw せず exit 1 する
#>
param(
	[string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

# 失敗したら止める。package.json を読めないときは、その例外のまま出す
$ErrorActionPreference = 'Stop'

<#
.SYNOPSIS
    package.json から version を読む

.DESCRIPTION
    release 配下の検査対象を決めるためだけに使う。ファイルは変更しない

.PARAMETER Root
    リポジトリのルート。package.json はこの直下にある

.OUTPUTS
    System.String

.EXAMPLE
    $version = Get-PackageVersion -Root $ProjectRoot

.NOTES
    例外:
    - package.json を読めないときは、その例外をそのまま送出する
#>
function Get-PackageVersion {
	param([string]$Root)

	# package.json の絶対パス。読めなければ throw する
	$packageJsonPath = Join-Path $Root 'package.json'
	# 読んだ package.json。version が無いときは、戻り値は空文字
	$packageJson     = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json

	return [string]$packageJson.version
}

<#
.SYNOPSIS
    実行ファイルが指定ディレクトリの配下かを返す

.DESCRIPTION
    パスは完全パスへ揃えてから、大文字小文字を無視して前方一致させる。ファイルは変更しない

.PARAMETER ExecutablePath
    プロセスの実行ファイル。空なら false

.PARAMETER DirectoryPath
    基準ディレクトリ。末尾区切りの有無は問わない

.OUTPUTS
    System.Boolean

.EXAMPLE
    Test-PathUnderDirectory -ExecutablePath $process.ExecutablePath -DirectoryPath $releaseRoot
#>
function Test-PathUnderDirectory {
	param(
		[string]$ExecutablePath,
		[string]$DirectoryPath
	)

	# ----------------------------------------------
	# 空の実行ファイル
	# ----------------------------------------------
	# 実行ファイルが空。配下かどうかは判定できず false
	if ([string]::IsNullOrWhiteSpace($ExecutablePath)) {
		return $false
	}

	# ----------------------------------------------
	# 完全パスでの前方一致
	# ----------------------------------------------
	# 比較する実行ファイル。相対パスはカレント基準で絶対化する
	$normalizedExecutable = [System.IO.Path]::GetFullPath($ExecutablePath)
	# 比較する基準ディレクトリ。末尾区切りの有無は GetFullPath の結果に従う
	$normalizedDirectory  = [System.IO.Path]::GetFullPath($DirectoryPath)

	return $normalizedExecutable.StartsWith($normalizedDirectory, [StringComparison]::OrdinalIgnoreCase)
}

<#
.SYNOPSIS
    コマンドラインが指定ディレクトリを含むかを返す

.DESCRIPTION
    開発時の electron.exe がプロジェクトパスを引数に持つかを見る。ファイルは変更しない

.PARAMETER CommandLine
    プロセスのコマンドライン。空なら false

.PARAMETER DirectoryPath
    探すディレクトリ。完全パスへ揃える

.OUTPUTS
    System.Boolean

.EXAMPLE
    Test-CommandLineReferencesDirectory -CommandLine $process.CommandLine -DirectoryPath $ProjectRoot
#>
function Test-CommandLineReferencesDirectory {
	param(
		[string]$CommandLine,
		[string]$DirectoryPath
	)

	# ----------------------------------------------
	# 空のコマンドライン
	# ----------------------------------------------
	# コマンドラインが空。ディレクトリを含まないので false
	if ([string]::IsNullOrWhiteSpace($CommandLine)) {
		return $false
	}

	# ----------------------------------------------
	# ディレクトリの検索
	# ----------------------------------------------
	# 探すディレクトリの完全パス。見つからなければ false
	$normalizedDirectory = [System.IO.Path]::GetFullPath($DirectoryPath)

	return $CommandLine.IndexOf($normalizedDirectory, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

<#
.SYNOPSIS
    app.asar をリネームしてすぐ戻し、置き換えできるかを返す

.DESCRIPTION
    ファイルが無いときは true。あるときは一時名へ変えて同じ名前へ戻す
    削除はしない。戻せなかったロックは false

.PARAMETER AppAsarPath
    検査する app.asar の絶対パス

.OUTPUTS
    System.Boolean
    置き換えできる、またはファイルが無いとき true

.EXAMPLE
    Test-AppAsarReplaceable -AppAsarPath $appAsar
#>
function Test-AppAsarReplaceable {
	param([string]$AppAsarPath)

	# ----------------------------------------------
	# ファイルが無いとき
	# ----------------------------------------------
	# app.asar が無い。置き換える対象が無いので、ロックされていない
	if (-not (Test-Path -LiteralPath $AppAsarPath)) {
		return $true
	}

	# ----------------------------------------------
	# 一時名への付け替え
	# ----------------------------------------------
	# app.asar があるディレクトリ。一時ファイルもここへ置く
	$directory = Split-Path -Parent $AppAsarPath
	# 戻すときの名前。app.asar 固定
	$fileName  = Split-Path -Leaf $AppAsarPath
	# 衝突しない一時名。削除はせず、リネームにだけ使う
	$probeName = ".dist-lock-probe-$([Guid]::NewGuid().ToString('N'))"
	# 付け替え先。戻せなければ false で、一時名のまま残ることがある
	$probePath = Join-Path $directory $probeName

	try {
		Rename-Item -LiteralPath $AppAsarPath -NewName $probeName -ErrorAction Stop
		Rename-Item -LiteralPath $probePath -NewName $fileName -ErrorAction Stop
		return $true
	} catch {
		return $false
	}
}

# ----------------------------------------------
# 起動中プロセス
# ----------------------------------------------

# package.json の version。release\<version> の検査対象を決める。空ならパスがずれる
$version     = Get-PackageVersion -Root $ProjectRoot
# release ディレクトリ。この配下からの起動をロック原因にする
$releaseRoot = Join-Path $ProjectRoot 'release'
# 中止理由。空なら dist してよい
$issues      = [System.Collections.Generic.List[string]]::new()

# 置き換えを試す app.asar。ファイルが無いバージョンでは検査が true を返す
$appAsar = Join-Path $releaseRoot "$version\win-unpacked\resources\app.asar"

foreach ($processName in @('TmsAppLauncher', 'electron')) {
	Get-CimInstance Win32_Process -Filter "Name='$processName.exe'" -ErrorAction SilentlyContinue |
		ForEach-Object {
			# 実行ファイルが release 配下。発行物から起動中なので dist できない
			if (Test-PathUnderDirectory $_.ExecutablePath $releaseRoot) {
				$issues.Add("$processName.exe が release 配下から起動中です (PID $($_.ProcessId)): $($_.ExecutablePath)")
			}
			# 実行ファイルがプロジェクト配下か、コマンドラインがプロジェクトを含む。どちらか一方でも残プロセス。両方無ければ入らない
			elseif (
				(Test-PathUnderDirectory $_.ExecutablePath $ProjectRoot) -or
				(Test-CommandLineReferencesDirectory $_.CommandLine $ProjectRoot)
			) {
				$issues.Add("$processName.exe がテスト/動作確認後に残っています (PID $($_.ProcessId)): $($_.ExecutablePath)")
			}
		}
}

# ----------------------------------------------
# app.asar の置換可否
# ----------------------------------------------

# app.asar を一時名へ変えて戻せない。他プロセスがロックしている
if (-not (Test-AppAsarReplaceable -AppAsarPath $appAsar)) {
	# リポジトリからの相対パス。メッセージ用。先頭の区切りは外す
	$relative = $appAsar.Substring($ProjectRoot.Length).TrimStart('\')
	$issues.Add("$relative を上書きできません（他プロセスが参照中）")
}

# 中止理由が 1 件以上ある。exit 1 で dist を止める。0 件なら続行する
if ($issues.Count -gt 0) {
	Write-Host ''
	Write-Host 'dist ビルドを中止しました。release 内の app.asar を置き換えできません。' -ForegroundColor Yellow
	Write-Host ''
	foreach ($issue in $issues) {
		Write-Host "  - $issue"
	}
	Write-Host ''
	Write-Host '想定される原因（エクスプローラーで release を開いていなくても発生します）:'
	Write-Host '  - Cursor 等 IDE がワークスペース内の release を監視している'
	Write-Host '  - テスト／動作確認で起動したランチャーや Electron が残っている'
	Write-Host '  - ウイルス対策（F-Secure / NURO SAFE 等）のリアルタイムスキャン'
	Write-Host '  - Windows Search のインデックス作成'
	Write-Host ''
	Write-Host '対処（ファイル削除は不要）:'
	Write-Host '  1. 本リポジトリに .cursorignore（release/ 除外）を追加済み。Cursor を再起動すると効果が出ます'
	Write-Host '  2. テスト／動作確認で起動した TmsAppLauncher.exe / electron.exe があれば終了する'
	Write-Host '  3. ウイルス対策の除外リストに release フォルダを追加する'
	Write-Host '  4. release 配下から起動したランチャー／Electron があれば終了する'
	Write-Host '  5. 動作確認は setup.exe でインストールした版を使う'
	Write-Host ''
	exit 1
}

Write-Host "dist ビルド前提条件 OK (output: release/$version)"

<#
.SYNOPSIS
    発行済みの win-unpacked からポータブル ZIP と SHA-256 を作る

.DESCRIPTION
    electron-builder の zip ターゲットは使わない
    win-unpacked と resources の同梱ファイルは削除しない
    出力 ZIP と .sha256 は上書きする。app-update.yml と data/ は ZIP に入れない

.PARAMETER ProjectRoot
    リポジトリのルート。未指定時は、このスクリプトの親ディレクトリ

.PARAMETER Version
    成果物のバージョン。未指定時は package.json の version

.PARAMETER WinUnpackedDir
    コピー元の win-unpacked。未指定時は release\<Version>\win-unpacked

.PARAMETER OutputDir
    ZIP と .sha256 の出力先。未指定時は release\<Version>

.OUTPUTS
    なし。成果物は OutputDir へファイルとして書く

.EXAMPLE
    pwsh -NoProfile -File scripts/package-portable.ps1

.NOTES
    例外:
    - win-unpacked、portable-mode.json、README-PORTABLE.txt が無いときは throw し、既存の発行ディレクトリは削除しない
    - ZIP の中身が不足している、または除外対象が含まれるときは throw する
#>
param(
	[string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
	[string]$Version = '',
	[string]$WinUnpackedDir = '',
	[string]$OutputDir = ''
)

# 失敗したら止める。入力が足りない、または ZIP の中身が不正なときは throw する
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

<#
.SYNOPSIS
    package.json から version を読む

.DESCRIPTION
    ファイルは変更しない

.PARAMETER Root
    リポジトリのルート。package.json はこの直下にある

.OUTPUTS
    System.String

.EXAMPLE
    $version = Get-PackageVersion -Root $ProjectRoot

.NOTES
    例外:
    - package.json を読めない、または version が無いときは、その例外をそのまま送出する
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
    ZIP 内のエントリ名を、ルート名と相対パスから作る

.DESCRIPTION
    区切りはスラッシュに揃える。ファイルは変更しない

.PARAMETER Prefix
    ZIP 直下のフォルダ名。空の相対パスのときは、この値だけを返す

.PARAMETER RelativePath
    win-unpacked からの相対パス。空なら Prefix だけを返す

.OUTPUTS
    System.String

.EXAMPLE
    Convert-ToZipEntryName -Prefix 'TMS-AppsLauncher' -RelativePath 'resources\app.asar'
#>
function Convert-ToZipEntryName {
	param(
		[string]$Prefix,
		[string]$RelativePath
	)

	# ----------------------------------------------
	# 区切りの正規化
	# ----------------------------------------------
	# スラッシュ区切りにした相対パス。空なら Prefix だけを返す
	$normalized = $RelativePath.Replace('\', '/')

	# ----------------------------------------------
	# 空の相対パス
	# ----------------------------------------------
	# 相対パスが空。ZIP 直下のフォルダ名だけを返す
	if ([string]::IsNullOrWhiteSpace($normalized)) {
		return $Prefix
	}

	return "$Prefix/$normalized"
}

<#
.SYNOPSIS
    ポータブル ZIP に入れないパスかを返す

.DESCRIPTION
    app-update.yml と data/ 配下を除外する。ファイルは変更しない

.PARAMETER RelativePath
    win-unpacked からの相対パス。区切りはバックスラッシュでもスラッシュでもよい

.OUTPUTS
    System.Boolean
    除外するとき true

.EXAMPLE
    Test-ExcludedPortableSource -RelativePath 'data\launcher-data.json'
#>
function Test-ExcludedPortableSource {
	param([string]$RelativePath)

	# ----------------------------------------------
	# 区切りの正規化
	# ----------------------------------------------
	# スラッシュ区切りの相対パス。空なら、どの除外にも当たらず false
	$normalized = $RelativePath.Replace('\', '/')

	# ----------------------------------------------
	# 自動更新の設定
	# ----------------------------------------------
	# app-update.yml そのものか、どこかの階層の同名ファイル。どちらか一方でも除外する。両方外れていれば入らない
	if ($normalized -eq 'app-update.yml' -or $normalized.EndsWith('/app-update.yml')) {
		return $true
	}

	# ----------------------------------------------
	# 利用者データ
	# ----------------------------------------------
	# data ディレクトリそのものか、その配下。どちらか一方でも除外する。両方外れていれば入らない
	if ($normalized -eq 'data' -or $normalized.StartsWith('data/')) {
		return $true
	}

	return $false
}

<#
.SYNOPSIS
    既存ファイルを ZIP エントリへコピーする

.DESCRIPTION
    元ファイルは削除しない。開いたストリームはこの関数の中で閉じる

.PARAMETER Archive
    書き込み中の ZipArchive。Create モードであること

.PARAMETER EntryName
    ZIP 内のエントリ名。スラッシュ区切り

.PARAMETER SourcePath
    コピー元のファイル。読み取り専用で開く

.OUTPUTS
    なし

.EXAMPLE
    Add-ZipFileEntry -Archive $archive -EntryName 'TMS-AppsLauncher/TmsAppLauncher.exe' -SourcePath $exePath

.NOTES
    例外:
    - 元ファイルを開けない、または書き込みに失敗したときは、その例外をそのまま送出する
#>
function Add-ZipFileEntry {
	param(
		[System.IO.Compression.ZipArchive]$Archive,
		[string]$EntryName,
		[string]$SourcePath
	)

	# 作った ZIP エントリ。Optimal。元ファイルは削除しない
	$entry = $Archive.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
	# コピー元。読み取り専用。finally で閉じる
	$sourceStream = [System.IO.File]::OpenRead($SourcePath)
	try {
		# エントリの書き込み先。finally で閉じる
		$entryStream = $entry.Open()
		try {
			$sourceStream.CopyTo($entryStream)
		} finally {
			$entryStream.Dispose()
		}
	} finally {
		$sourceStream.Dispose()
	}
}

<#
.SYNOPSIS
    バイト列を ZIP エントリとして書く

.DESCRIPTION
    ディスク上の元ファイルは作らない。エントリのストリームはこの関数の中で閉じる

.PARAMETER Archive
    書き込み中の ZipArchive。Create モードであること

.PARAMETER EntryName
    ZIP 内のエントリ名。スラッシュ区切り

.PARAMETER Bytes
    書き込む内容。空配列でもエントリは作る

.OUTPUTS
    なし

.EXAMPLE
    Add-ZipTextEntry -Archive $archive -EntryName 'TMS-AppsLauncher/note.txt' -Bytes $bytes

.NOTES
    例外:
    - エントリを開けない、または書き込みに失敗したときは、その例外をそのまま送出する
#>
function Add-ZipTextEntry {
	param(
		[System.IO.Compression.ZipArchive]$Archive,
		[string]$EntryName,
		[byte[]]$Bytes
	)

	# 作った ZIP エントリ。Optimal。ディスク上の元ファイルは作らない
	$entry = $Archive.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
	# エントリの書き込み先。finally で閉じる。Bytes が空でもエントリは残る
	$entryStream = $entry.Open()
	try {
		$entryStream.Write($Bytes, 0, $Bytes.Length)
	} finally {
		$entryStream.Dispose()
	}
}

# ----------------------------------------------
# 入力パスの解決
# ----------------------------------------------

# Version が未指定。package.json の version を使う。指定済みなら、この代入はしない
if ([string]::IsNullOrWhiteSpace($Version)) {
	# package.json の version。未指定のときだけここへ入る。空の version はここでは埋まらない
	$Version = Get-PackageVersion -Root $ProjectRoot
}

# コピー元が未指定。release\<Version>\win-unpacked を使う
if ([string]::IsNullOrWhiteSpace($WinUnpackedDir)) {
	# 既定の win-unpacked。未指定のときだけここへ入る
	$WinUnpackedDir = Join-Path $ProjectRoot "release\$Version\win-unpacked"
}

# 出力先が未指定。release\<Version> を使う
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
	# 既定の出力ディレクトリ。未指定のときだけここへ入る
	$OutputDir = Join-Path $ProjectRoot "release\$Version"
}

# コピー元の絶対パス
$winUnpackedFull = [System.IO.Path]::GetFullPath($WinUnpackedDir)
# ZIP と .sha256 の出力ディレクトリ。無ければ後で作る
$outputFull      = [System.IO.Path]::GetFullPath($OutputDir)
# 本体 exe。無いときは ZIP を作らず throw する
$exePath         = Join-Path $winUnpackedFull 'TmsAppLauncher.exe'
# ZIP に足す portable-mode.json。発行ツリーには残し、削除しない
$markerSource    = Join-Path $ProjectRoot 'resources\portable-mode.json'
# ZIP に足す README。発行ツリーには残し、削除しない
$readmeSource    = Join-Path $ProjectRoot 'resources\README-PORTABLE.txt'
# 出力 ZIP のファイル名。Version を含む
$zipName         = "TmsAppLauncher-$Version-portable-x64.zip"
# SHA-256 ファイル名。ZIP 名に .sha256 を付けたもの
$hashName        = "$zipName.sha256"
# 出力 ZIP の絶対パス。既存は上書きする
$zipPath         = Join-Path $outputFull $zipName
# SHA-256 ファイルの絶対パス。既存は上書きする
$hashPath        = Join-Path $outputFull $hashName
# ZIP 直下のフォルダ名。エントリはすべてこの配下
$zipRoot         = 'TMS-AppsLauncher'

# 本体 exe が無い。dist 前とみなし、既存の発行ディレクトリは消さない
if (-not (Test-Path -LiteralPath $exePath)) {
	throw "win-unpacked が見つかりません: $exePath`nnpm run dist の後に実行してください。"
}

# 同梱マーカーが無い。ZIP は作らない
if (-not (Test-Path -LiteralPath $markerSource)) {
	throw "portable-mode.json がありません: $markerSource"
}

# 同梱 README が無い。ZIP は作らない
if (-not (Test-Path -LiteralPath $readmeSource)) {
	throw "README-PORTABLE.txt がありません: $readmeSource"
}

# 出力先ディレクトリが無い。ZIP を書く前に作る。既存ディレクトリは消さない
if (-not (Test-Path -LiteralPath $outputFull)) {
	New-Item -ItemType Directory -Path $outputFull | Out-Null
}

# ----------------------------------------------
# ZIP の作成
# ----------------------------------------------

# BOM なし UTF-8。.sha256 をこのエンコーディングで書く
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
# 新規 ZIP。Create なので同名ファイルは切り詰めて上書きする
$zipStream = [System.IO.File]::Create($zipPath)
# 書き込み中のアーカイブ。finally で閉じる
$archive   = New-Object System.IO.Compression.ZipArchive($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)
# ZIP に入れたファイル数。除外したファイルは数えない。検証前は 0
$added     = 0

try {
	# win-unpacked 内の全ファイル。ディレクトリエントリは作らない。空ならマーカーと README だけになる
	$files = Get-ChildItem -LiteralPath $winUnpackedFull -Recurse -File

	foreach ($file in $files) {
		# win-unpacked からの相対パス。先頭の区切りは外す
		$relative = $file.FullName.Substring($winUnpackedFull.Length).TrimStart('\', '/')

		# app-update.yml か data/。ZIP に入れず、次のファイルへ進む
		if (Test-ExcludedPortableSource -RelativePath $relative) {
			continue
		}

		# ZIP 内のエントリ名。ルート名と相対パスをスラッシュでつなぐ
		$entryName = Convert-ToZipEntryName -Prefix $zipRoot -RelativePath $relative
		Add-ZipFileEntry -Archive $archive -EntryName $entryName -SourcePath $file.FullName
		# 除外しなかったファイルを 1 件として数える
		$added += 1
	}

	Add-ZipFileEntry -Archive $archive -EntryName "$zipRoot/portable-mode.json" -SourcePath $markerSource
	Add-ZipFileEntry -Archive $archive -EntryName "$zipRoot/README-PORTABLE.txt" -SourcePath $readmeSource
	# マーカーと README の 2 件を数に足す。どちらかを足せなかったときは、ここへ来ず throw する
	$added += 2
} finally {
	$archive.Dispose()
	$zipStream.Dispose()
}

# ZIP の SHA-256。小文字の 16 進。検証と .sha256 に使う
$sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
# .sha256 の 1 行。ハッシュ、空白 2 つ、ZIP 名、改行
$hashLine = "$sha256  $zipName`n"
[System.IO.File]::WriteAllText($hashPath, $hashLine, $utf8NoBom)

# ----------------------------------------------
# 中身の検証
# ----------------------------------------------

# 読み取り専用で開いた ZIP。finally で閉じる
$verify = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
	# エントリ名。バックスラッシュはスラッシュに揃える。空アーカイブなら空配列
	$names = @($verify.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })

	# 本体 exe が ZIP に無い
	if ($names -notcontains "$zipRoot/TmsAppLauncher.exe") {
		throw "ZIP に $zipRoot/TmsAppLauncher.exe がありません。"
	}

	# マーカーが ZIP に無い
	if ($names -notcontains "$zipRoot/portable-mode.json") {
		throw "ZIP に portable-mode.json がありません。"
	}

	# README が ZIP に無い
	if ($names -notcontains "$zipRoot/README-PORTABLE.txt") {
		throw "ZIP に README-PORTABLE.txt がありません。"
	}

	# app-update.yml が直下か配下に 1 件でもある。どちらか一方でも検証失敗。両方無ければ入らない
	if ($names | Where-Object { $_ -eq "$zipRoot/app-update.yml" -or $_.EndsWith('/app-update.yml') }) {
		throw 'ZIP に app-update.yml が含まれています。'
	}

	# data ディレクトリか、その配下が 1 件でもある。どちらか一方でも検証失敗。両方無ければ入らない
	if ($names | Where-Object { $_ -eq "$zipRoot/data" -or $_.StartsWith("$zipRoot/data/") }) {
		throw 'ZIP に利用者データ data/ が含まれています。'
	}
} finally {
	$verify.Dispose()
}

Write-Host "portable zip: $zipPath"
Write-Host "sha256: $sha256"
Write-Host "entries copied: $added"

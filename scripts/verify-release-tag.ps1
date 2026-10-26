<#
.SYNOPSIS
    ローカルとリモートのリリースタグが同じコミットを指すかを検証する

.DESCRIPTION
    dist:publish のあと、タグの SHA が origin と食い違うと次回の pull --tags が失敗する
    タグもコミットも変更しない。不一致のときは終了コード 1

.PARAMETER Version
    検証するバージョン。未指定時は package.json の version。タグ名は v を付ける

.OUTPUTS
    なし。結果は標準出力、失敗理由はエラー出力へ書く

.EXAMPLE
    pwsh -NoProfile -File scripts/verify-release-tag.ps1

.NOTES
    例外:
    - git コマンド自体が失敗したときは、その失敗のまま終了する
    - タグが無い、または SHA が違うときは exit 1 する
#>
param(
	[string]$Version = (Get-Content "$PSScriptRoot\..\package.json" -Raw | ConvertFrom-Json).version
)

# 検証するタグ名。Version の先頭に v を付ける。Version が空ならタグは v だけになる
$tag = "v$Version"
# git の作業ディレクトリ。このスクリプトの親がリポジトリルート
$repoRoot = Resolve-Path "$PSScriptRoot\.."

Push-Location $repoRoot
try {
	# ローカルタグの SHA。タグが無いときは空。空は不一致ではなく未作成
	$local = git rev-parse $tag 2>$null
	# ローカルにタグが無い。終了コード 1。リモートはまだ見ない
	if (-not $local) {
		Write-Error "ローカルにタグ $tag がありません。dist:publish を実行したか確認してください。"
		exit 1
	}

	# origin 上のタグ行。SHA と ref。タグが無いときは空
	$remoteLine = git ls-remote origin "refs/tags/$tag"
	# リモートにタグが無い。終了コード 1。公開が途中で止まった可能性がある
	if (-not $remoteLine) {
		Write-Error "リモートにタグ $tag がありません。dist:publish の GitHub 公開が失敗した可能性があります。"
		exit 1
	}
	# リモートタグの SHA。空白区切りの先頭。空行ではここへ来ない
	$remote = ($remoteLine -split '\s+')[0]

	# ローカルとリモートの SHA が違う。次回の pull --tags が競合する
	if ($local -ne $remote) {
		Write-Error @"
タグ $tag がローカルとリモートで不一致です。
  ローカル: $local ($(git log -1 --oneline $local))
  リモート: $remote ($(git log -1 --oneline $remote 2>$null))

electron-builder はローカルで git tag -f しますが、リモートに同名タグが別 SHA で存在すると上書きされません。
次回の pull --tags でタグ競合が起きます。原因を確認してから対処してください。
"@
		exit 1
	}

	# dist:publish 直後は release コミット = HEAD。後から別コミットを push した場合は一致しないが正常
	$onHead = $local -eq (git rev-parse HEAD)
	# 表示用の補足。HEAD と一致すればその旨。過去のタグなら、リリース後の追加コミットとして正常と書く
	$headHint = if ($onHead) { '（現在の HEAD と一致）' } else { '（HEAD より過去のリリースコミット — リリース後に別コミットを push した場合は正常）' }

	Write-Host "OK: $tag -> $local $headHint"
	Write-Host "OK: ローカルとリモートのタグ SHA が一致しています。"
	exit 0
} finally {
	Pop-Location
}

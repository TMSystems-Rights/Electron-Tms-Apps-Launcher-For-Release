<#
.SYNOPSIS
    ショートカットの起動先と AppUserModelID を JSON で返す

.DESCRIPTION
    シェルの拡張プロパティを読む。ショートカットと AppsFolder の実体は変更しない
    1 件が読めなくても、その件の error に理由を入れて残りの件は続ける

.PARAMETER ShortcutPathsBase64
    UTF-8 JSON のパス配列を Base64 にした文字列。必須

.OUTPUTS
    System.String
    各ショートカットの targetParsingPath、appUserModelId、resolvedExecutablePath、displayName、error を含む JSON

.EXAMPLE
    pwsh -NoProfile -File resources/get-shortcut-identity.ps1 -ShortcutPathsBase64 $payload

.NOTES
    例外:
    - Base64 または JSON が壊れているときは throw し、結果は返さない
#>
param(
	[Parameter(Mandatory = $true)]
	[string]$ShortcutPathsBase64
)

# 失敗したら止める。Base64 や JSON が壊れていれば、結果は返さず throw する
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
# Base64 を戻した UTF-8 JSON。壊れていれば、この代入の時点で throw する
$shortcutPathsJson = [System.Text.Encoding]::UTF8.GetString(
	[System.Convert]::FromBase64String($ShortcutPathsBase64)
)
# 読むショートカットのパス。空配列なら結果も空
$shortcutPaths = [string[]](ConvertFrom-Json -InputObject $shortcutPathsJson)

# シェル名前空間の COM。ショートカットも AppsFolder の実体も変更しない
$shell = New-Object -ComObject Shell.Application
# AppsFolder。null なら AppUserModelID から実行ファイルは解決しない
$appsFolder = $shell.Namespace('shell:AppsFolder')
# 1 件ごとの結果。1 件が読めなくても、残りは続ける
$results = foreach ($path in $shortcutPaths) {
	try {
		# ショートカットの親フォルダ。開けなければ null
		$folder = $shell.Namespace((Split-Path -Parent $path))

		# 親フォルダを開けない。この件は error にして次へ進む
		if ($null -eq $folder) {
			throw "Shortcut folder could not be opened."
		}

		# フォルダ内のショートカット項目。見つからなければ null
		$item = $folder.ParseName((Split-Path -Leaf $path))

		# ショートカット項目を取れない。この件は error にして次へ進む
		if ($null -eq $item) {
			throw "Shortcut could not be parsed."
		}

		# リンクの起動先。空なら、ショートカットに解決先が無い
		$targetParsingPath = [string]$item.ExtendedProperty('System.Link.TargetParsingPath')
		# AppUserModelID。空なら、従来の実行ファイルリンク
		$appUserModelId = [string]$item.ExtendedProperty('System.AppUserModel.ID')
		# AppsFolder を引くキー。AppUserModelID が空白なら起動先、そうでなければ ID。両方空なら解決しない
		$identity = if ([string]::IsNullOrWhiteSpace($appUserModelId)) {
			$targetParsingPath
		} else {
			$appUserModelId
		}
		# 解決した exe。AppsFolder から exe を取れないときは空
		$resolvedExecutablePath = ''
		# AppsFolder の表示名。項目が無いときは空
		$displayName = ''

		# 解決キーと AppsFolder の両方があるときだけ実行ファイルを探す。どちらかが欠けても入らない
		if (-not [string]::IsNullOrWhiteSpace($identity) -and $null -ne $appsFolder) {
			# AppsFolder 上の項目。見つからなければ null
			$appItem = $appsFolder.ParseName($identity)

			# AppsFolder に項目がある。無いときは、パスも表示名も空のまま
			if ($null -ne $appItem) {
				# 項目の起動先。exe 以外は、実行ファイルとして採用しない
				$candidate = [string]$appItem.ExtendedProperty('System.Link.TargetParsingPath')
				# 拡張子が exe。それ以外は、実行ファイルパスを空のままにする
				if ([System.IO.Path]::GetExtension($candidate) -ieq '.exe') {
					# 採用する exe のフルパス。拡張子が exe のときだけ入る
					$resolvedExecutablePath = $candidate
				}
				# AppsFolder の表示名。名前が無ければ空文字
				$displayName = [string]$appItem.Name
			}
		}

		# 1 件の読み取り結果。成功時の error は空
		[pscustomobject]@{
			# 入力されたショートカットのパス
			shortcutPath           = $path
			# リンクの起動先。読めなければ空
			targetParsingPath      = $targetParsingPath
			# AppUserModelID。無ければ空
			appUserModelId         = $appUserModelId
			# AppsFolder から解決した exe。取れなければ空
			resolvedExecutablePath = $resolvedExecutablePath
			# AppsFolder の表示名。取れなければ空
			displayName            = $displayName
			# 失敗理由。成功時は空
			error                  = ''
		}
	} catch {
		# 読めなかった 1 件。error 以外は空にして、残りの件は続ける
		[pscustomobject]@{
			# 入力されたショートカットのパス。失敗しても残す
			shortcutPath           = $path
			# 起動先。この件は読めていないので空
			targetParsingPath      = ''
			# AppUserModelID。この件は読めていないので空
			appUserModelId         = ''
			# 解決した exe。この件は読めていないので空
			resolvedExecutablePath = ''
			# 表示名。この件は読めていないので空
			displayName            = ''
			# この件を読めなかった理由。空にはしない
			error                  = $_.Exception.Message
		}
	}
}

@($results) | ConvertTo-Json -Compress

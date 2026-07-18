param(
    [Parameter(Mandatory = $true)]
    [string]$ShortcutPathsBase64
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$shortcutPathsJson = [System.Text.Encoding]::UTF8.GetString(
    [System.Convert]::FromBase64String($ShortcutPathsBase64)
)
$shortcutPaths = [string[]](ConvertFrom-Json -InputObject $shortcutPathsJson)

$shell = New-Object -ComObject Shell.Application
$appsFolder = $shell.Namespace('shell:AppsFolder')
$results = foreach ($path in $shortcutPaths) {
    try {
        $folder = $shell.Namespace((Split-Path -Parent $path))

        if ($null -eq $folder) {
            throw "Shortcut folder could not be opened."
        }

        $item = $folder.ParseName((Split-Path -Leaf $path))

        if ($null -eq $item) {
            throw "Shortcut could not be parsed."
        }

        $targetParsingPath = [string]$item.ExtendedProperty('System.Link.TargetParsingPath')
        $appUserModelId = [string]$item.ExtendedProperty('System.AppUserModel.ID')
        $identity = if ([string]::IsNullOrWhiteSpace($appUserModelId)) {
            $targetParsingPath
        } else {
            $appUserModelId
        }
        $resolvedExecutablePath = ''
        $displayName = ''

        if (-not [string]::IsNullOrWhiteSpace($identity) -and $null -ne $appsFolder) {
            $appItem = $appsFolder.ParseName($identity)

            if ($null -ne $appItem) {
                $candidate = [string]$appItem.ExtendedProperty('System.Link.TargetParsingPath')
                if ([System.IO.Path]::GetExtension($candidate) -ieq '.exe') {
                    $resolvedExecutablePath = $candidate
                }
                $displayName = [string]$appItem.Name
            }
        }

        [pscustomobject]@{
            shortcutPath = $path
            targetParsingPath = $targetParsingPath
            appUserModelId = $appUserModelId
            resolvedExecutablePath = $resolvedExecutablePath
            displayName = $displayName
            error = ''
        }
    } catch {
        [pscustomobject]@{
            shortcutPath = $path
            targetParsingPath = ''
            appUserModelId = ''
            resolvedExecutablePath = ''
            displayName = ''
            error = $_.Exception.Message
        }
    }
}

@($results) | ConvertTo-Json -Compress

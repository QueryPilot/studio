$ErrorActionPreference = "Stop"

$Version = "1.2.553.0"
$Dest = Join-Path (Resolve-Path ".." | Select-Object -ExpandProperty Path) "src-tauri\sidecars"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

if (-not [Environment]::Is64BitOperatingSystem) {
    Write-Output "Unsupported architecture. Only 64-bit Windows is supported."
    exit 0
}

$Url = "https://s3.amazonaws.com/session-manager-downloads/plugin/$Version/windows/SessionManagerPluginSetup.exe"
$Output = Join-Path $Dest "session-manager-plugin-x86_64-pc-windows-msvc.exe"

Write-Output "📥 Downloading session-manager-plugin $Version for Windows..."
$TempInstaller = Join-Path $env:TEMP "ssm_installer.exe"
Invoke-WebRequest -Uri $Url -OutFile $TempInstaller -UseBasicParsing

$TempExtract = Join-Path $env:TEMP "ssm_extract"
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $TempExtract
New-Item -ItemType Directory -Path $TempExtract | Out-Null

if (Get-Command 7z -ErrorAction SilentlyContinue) {
    & 7z x $TempInstaller "-o$TempExtract" -y | Out-Null
    $Binary = Get-ChildItem -Path $TempExtract -Filter "session-manager-plugin.exe" -Recurse | Select-Object -First 1
    if (-not $Binary) {
        Write-Error "Failed to locate session-manager-plugin.exe in extracted contents."
        exit 1
    }
    Copy-Item $Binary.FullName -Destination $Output -Force
} else {
    Write-Output "7zip not available. Running silent installer instead..."
    Start-Process $TempInstaller -ArgumentList "/S" -Wait
    $InstalledPath = "C:\Program Files\Amazon\SessionManagerPlugin\bin\session-manager-plugin.exe"
    if (-not (Test-Path $InstalledPath)) {
        Write-Error "Installation failed. session-manager-plugin.exe not found at $InstalledPath"
        exit 1
    }
    Copy-Item $InstalledPath -Destination $Output -Force
}

Remove-Item -Force $TempInstaller -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $TempExtract -ErrorAction SilentlyContinue

Write-Output "✅ Installed session-manager-plugin to $Output"


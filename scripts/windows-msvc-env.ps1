param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Command
)

$vswhere = Join-Path "${env:ProgramFiles(x86)}" "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
    Write-Error "vswhere.exe not found. Install Visual Studio Build Tools 2022."
    exit 1
}

# Pick the latest Build Tools/VS install and then load vcvars for arm64.
$installPathRaw = & $vswhere -latest -products * -property installationPath | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($installPathRaw)) {
    Write-Error "Visual Studio Build Tools not found."
    exit 1
}
$installPath = $installPathRaw.Trim()

$vcvars = Join-Path $installPath "VC\Auxiliary\Build\vcvarsall.bat"
if (-not (Test-Path $vcvars)) {
    Write-Error "vcvarsall.bat not found at: $vcvars"
    exit 1
}

# Force Cargo to an actual MSVC ARM64 linker binary.
# Some installations expose SDK libs but miss PATH ordering or have Git's link.exe first.
$msvcRoot = Join-Path $installPath "VC\Tools\MSVC"
$candidatePatterns = @(
    "bin\HostArm64\arm64\link.exe",
    "bin\HostX64\arm64\link.exe",
    "bin\HostX86\arm64\link.exe"
)

$resolvedLinker = $null
$selectedVersionName = $null
if (Test-Path $msvcRoot) {
    $versions = Get-ChildItem $msvcRoot -Directory | Sort-Object Name -Descending
    foreach ($versionDir in $versions) {
        $hasMsvcrt = Test-Path (Join-Path $versionDir.FullName "lib\ARM64\msvcrt.lib")
        if (-not $hasMsvcrt) {
            continue
        }
        foreach ($pattern in $candidatePatterns) {
            $candidate = Join-Path $versionDir.FullName $pattern
            if (Test-Path $candidate) {
                $resolvedLinker = $candidate
                $selectedVersionName = $versionDir.Name
                break
            }
        }
        if ($resolvedLinker) { break }
    }
}

if (-not $resolvedLinker) {
    Write-Error "No MSVC ARM64 linker found under $msvcRoot. Install 'MSVC v143 - VS 2022 C++ ARM64/ARM64EC build tools (Latest)'."
    exit 1
}

# Bootstrap full MSVC/SDK environment first, pinned to the selected MSVC version.
$versionSegments = $selectedVersionName.Split(".")
$vcvarsVersion = if ($versionSegments.Length -ge 2) {
    "$($versionSegments[0]).$($versionSegments[1])"
} else {
    $selectedVersionName
}

$escapedVcvars = $vcvars.Replace('"', '\"')
$envDump = cmd.exe /d /s /c "`"$escapedVcvars`" arm64 -vcvars_ver=$vcvarsVersion >nul && set"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to initialize ARM64 MSVC environment for version $selectedVersionName."
    exit $LASTEXITCODE
}

foreach ($line in $envDump) {
    if ($line -match "^[^=]+=.*$") {
        $parts = $line -split "=", 2
        [Environment]::SetEnvironmentVariable($parts[0], $parts[1], "Process")
    }
}

[Environment]::SetEnvironmentVariable("CARGO_TARGET_AARCH64_PC_WINDOWS_MSVC_LINKER", $resolvedLinker, "Process")

# ring (transitively used by tauri/rustls stacks) requires clang on Windows ARM64.
# Prefer an existing clang on PATH, then try common VS/Git locations.
$resolvedClang = $null
$clangFromPath = Get-Command clang -ErrorAction SilentlyContinue
if ($clangFromPath) {
    $resolvedClang = $clangFromPath.Source
}

if (-not $resolvedClang) {
    $clangCandidates = @(
        (Join-Path $installPath "VC\Tools\Llvm\bin\clang.exe"),
        "C:\Program Files\LLVM\bin\clang.exe",
        "C:\Program Files\Git\clangarm64\bin\clang.exe"
    )
    foreach ($candidate in $clangCandidates) {
        if (Test-Path $candidate) {
            $resolvedClang = $candidate
            break
        }
    }
}

$needsClang = $Command -match "(?i)(tauri:dev|tauri dev|tauri:build|tauri build)"
if ($needsClang -and -not $resolvedClang) {
    Write-Error @"
clang.exe not found, but this build requires it (ring crate on Windows ARM64).

Install one of:
  1) Visual Studio Installer -> Individual components -> C++ Clang tools for Windows
  2) LLVM (clang) for Windows and ensure clang.exe is on PATH
"@
    exit 1
}

if ($resolvedClang) {
    [Environment]::SetEnvironmentVariable("CC_aarch64_pc_windows_msvc", $resolvedClang, "Process")
    [Environment]::SetEnvironmentVariable("CC_aarch64-pc-windows-msvc", $resolvedClang, "Process")
}

# Constrain build resource usage for low-RAM Windows machines (e.g. 6-8 GB ARM64 devices).
# Large crates (aws-sdk-ecs, sqlparser) cause rustc-LLVM OOM with full debuginfo.
# macOS dev machines have plenty of RAM so this is Windows-only.
$totalRamMB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB)
if ($totalRamMB -lt 16384) {
    [Environment]::SetEnvironmentVariable("CARGO_BUILD_JOBS", "2", "Process")

    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $workspaceRoot = Split-Path -Parent $scriptDir
    $cargoDir = Join-Path $workspaceRoot ".cargo"
    $cargoConfig = Join-Path $cargoDir "config.toml"

    if (-not (Test-Path $cargoDir)) {
        New-Item -ItemType Directory -Path $cargoDir -Force | Out-Null
    }

    $marker = "# AUTO-GENERATED by windows-msvc-env.ps1 for low-RAM builds"
    $needsWrite = $true
    if (Test-Path $cargoConfig) {
        $firstLine = Get-Content $cargoConfig -TotalCount 1
        if ($firstLine -eq $marker) { $needsWrite = $false }
    }

    if ($needsWrite) {
        Set-Content -Path $cargoConfig -Value @"
$marker
# Reduces LLVM memory usage during dev builds on machines with <16 GB RAM.
# This file is gitignored; macOS/Linux builds are unaffected.

[profile.dev]
debug = "limited"

[profile.dev.package."*"]
debug = false
"@
    }
}

cmd.exe /d /s /c $Command
exit $LASTEXITCODE

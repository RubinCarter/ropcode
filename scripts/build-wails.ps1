param(
  [switch]$SkipInstall,
  [switch]$SkipFrontend,
  [switch]$RunAfterBuild
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Write-Step($Message) {
  Write-Host ""
  Write-Host "=== $Message ==="
}

function Get-DirectorySize($Path) {
  if (-not (Test-Path $Path)) {
    return 0
  }
  $sum = Get-ChildItem -LiteralPath $Path -Recurse -Force -File | Measure-Object -Property Length -Sum
  return [int64]($sum.Sum)
}

function Format-Bytes($Bytes) {
  if ($Bytes -ge 1GB) {
    return "{0:N2} GB" -f ($Bytes / 1GB)
  }
  if ($Bytes -ge 1MB) {
    return "{0:N2} MB" -f ($Bytes / 1MB)
  }
  if ($Bytes -ge 1KB) {
    return "{0:N2} KB" -f ($Bytes / 1KB)
  }
  return "$Bytes B"
}

function Resolve-Wails {
  $cmd = Get-Command wails -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  $goBin = & go env GOBIN
  if (-not $goBin) {
    $goPath = & go env GOPATH
    $goBin = Join-Path $goPath "bin"
  }

  $candidate = Join-Path $goBin "wails.exe"
  if (Test-Path $candidate) {
    return $candidate
  }

  return ""
}

function Stop-WailsBuildProcesses {
  $rootPrefix = "$Root\"
  $self = $PID
  $targets = Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $self -and (
      ($_.ExecutablePath -like "$rootPrefixbuild-wails*") -or
      ($_.CommandLine -like "*$rootPrefixbuild-wails*")
    )
  }

  foreach ($proc in $targets) {
    Write-Host "Stopping previous Wails process: $($proc.Name) ($($proc.ProcessId))"
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

Write-Step "Ropcode Wails Build"
Write-Host "Output folder: build-wails"
Write-Host "Renderer: system WebView2"
Write-Host "Bun/Electron runtime: not bundled"

if (-not $SkipInstall) {
  Write-Step "Ensuring Wails CLI"
  $wails = Resolve-Wails
  if (-not $wails) {
    $env:GOPROXY = "https://goproxy.cn,direct"
    $env:GOSUMDB = "off"
    go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
    $wails = Resolve-Wails
  }
} else {
  $wails = Resolve-Wails
}

if (-not $wails) {
  throw "wails.exe not found. Run: go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0"
}

if (-not $SkipFrontend) {
  Write-Step "Building frontend"
  Push-Location "frontend"
  npm run build
  Pop-Location
}

Write-Step "Cleaning Wails output folder"
Stop-WailsBuildProcesses
Remove-Item -Recurse -Force -LiteralPath "build-wails" -ErrorAction SilentlyContinue

Write-Step "Building Wails shell"
& $wails build -clean -tags "wails" -ldflags "-s -w" -trimpath -skipbindings

Write-Step "Size summary"
$paths = @(
  "build-wails",
  "build-wails/bin/RopcodeWails.exe",
  "frontend/dist"
)

foreach ($path in $paths) {
  if (Test-Path $path) {
    $item = Get-Item $path
    $size = if ($item.PSIsContainer) { Get-DirectorySize $path } else { $item.Length }
    Write-Host ("{0,-45} {1,12}" -f $path, (Format-Bytes $size))
  }
}

Write-Host ""
Write-Host "Largest Wails files:"
Get-ChildItem -Path "build-wails" -Recurse -Force -File -ErrorAction SilentlyContinue |
  Sort-Object Length -Descending |
  Select-Object -First 20 FullName,Length |
  ForEach-Object {
    Write-Host ("{0,-90} {1,12}" -f $_.FullName, (Format-Bytes $_.Length))
  }

if ($RunAfterBuild) {
  Write-Step "Running Wails shell"
  & "build-wails/bin/RopcodeWails.exe"
}

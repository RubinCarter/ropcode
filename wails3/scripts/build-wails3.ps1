param(
  [switch]$SkipInstall,
  [switch]$SkipFrontend,
  [switch]$RunAfterBuild
)

$ErrorActionPreference = "Stop"

$Wails3Root = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent $Wails3Root
Push-Location $RepoRoot

function Write-Step($Message) {
  Write-Host ""
  Write-Host "=== $Message ==="
}

function Resolve-Wails3 {
  $cmd = Get-Command wails3 -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  $goBin = (& go env GOBIN 2>$null | Select-Object -First 1).Trim()
  if (-not $goBin) {
    $goPath = (& go env GOPATH 2>$null | Select-Object -First 1).Trim()
    if (-not $goPath) {
      $goPath = Join-Path $env:USERPROFILE "go"
    }
    $goBin = Join-Path $goPath "bin"
  }

  $candidate = Join-Path $goBin "wails3.exe"
  if (Test-Path $candidate) {
    return $candidate
  }

  return ""
}

function Stop-Wails3Processes {
  $rootPrefix = "$Wails3Root\"
  $self = $PID
  $targets = Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $self -and (
      ($_.ExecutablePath -like "$rootPrefix*") -or
      ($_.CommandLine -like "*$rootPrefix*")
    )
  }

  foreach ($proc in $targets) {
    Write-Host "Stopping previous Wails v3 process: $($proc.Name) ($($proc.ProcessId))"
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

Write-Step "Ropcode Wails v3 Build"
Write-Host "Output folder: wails3\build"
Write-Host "Renderer: system WebView2"
Write-Host "Runtime: Wails v3 shell + embedded ropcode-server"

if (-not $SkipInstall) {
  Write-Step "Ensuring Wails v3 CLI"
  $wails3 = Resolve-Wails3
  if (-not $wails3) {
    go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-alpha.95
    $wails3 = Resolve-Wails3
  }
} else {
  $wails3 = Resolve-Wails3
}

if (-not $wails3) {
  throw "wails3.exe not found. Run: go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-alpha.95"
}

if (-not $SkipFrontend) {
  Write-Step "Building frontend"
  Push-Location "frontend"
  npm run build
  Pop-Location
}

Write-Step "Building Go server"
New-Item -ItemType Directory -Force -Path "wails3/bin" | Out-Null
go build -tags server -o "wails3/bin/ropcode-server.exe" .

Write-Step "Copying frontend into Wails v3 module"
if (Test-Path "wails3/frontend") {
  Remove-Item -Recurse -Force -LiteralPath "wails3/frontend"
}
Copy-Item -Recurse -Force -LiteralPath "frontend/dist" -Destination "wails3/frontend"
New-Item -ItemType File -Force -Path "wails3/frontend/.keep" | Out-Null

Write-Step "Cleaning Wails v3 output folder"
Stop-Wails3Processes
Remove-Item -Recurse -Force -LiteralPath "wails3/build" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "wails3/build/bin" | Out-Null

Write-Step "Generating Windows resources"
Push-Location "wails3"
& $wails3 generate syso -arch amd64 -icon "..\build-wails\windows\icon.ico" -manifest "..\build-wails\windows\wails.exe.manifest" -info "..\build-wails\windows\info.json" -out "wails3_windows.syso"

Write-Step "Building Wails v3 shell"
go build -tags production -trimpath -ldflags "-s -w -H windowsgui" -o "build/bin/RopcodeWails3.exe" .
Remove-Item -Force -LiteralPath "wails3_windows.syso" -ErrorAction SilentlyContinue

Write-Step "Size summary"
Get-Item "build/bin/RopcodeWails3.exe" | Select-Object FullName,Length

if ($RunAfterBuild) {
  Write-Step "Running Wails v3 shell"
  & "build/bin/RopcodeWails3.exe"
}

Pop-Location
Pop-Location

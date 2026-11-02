# Builds the DriveStream phone and TV APKs locally (no EAS) into app/dist-local.
#
#   powershell -File tools/build-android.ps1 -Version 1.0.0
#
# Needs: Node 22+, JDK 17 or 21 (JAVA_HOME), the Android SDK (ANDROID_HOME), and app/.env
# with your DRIVESTREAM_SERVER and ANDROID_PACKAGE. Optional: app/keys/keystore.properties to
# sign with your own key (see app/keys.example); otherwise Gradle uses its debug key.
#
# Windows' 260-character path limit breaks the native build in deep folders, so the app is
# copied to a short path first (-BuildDir, default C:\dsb) and CMake works in C:\c.
param(
  [string]$Version = '1.0.0',
  [string]$BuildDir = 'C:\dsb'
)
$ErrorActionPreference = 'Continue' # tools write warnings to stderr; exit codes decide
$src = Join-Path (Split-Path $PSScriptRoot -Parent) 'app'
$out = Join-Path $src 'dist-local'
New-Item -ItemType Directory -Force $out | Out-Null
if (-not $env:JAVA_HOME) { throw 'Set JAVA_HOME to your JDK folder.' }
if (-not $env:ANDROID_HOME) { throw 'Set ANDROID_HOME to your Android SDK folder.' }

robocopy $src $BuildDir /MIR /XD android .expo dist-local /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }

if (-not $env:ANDROID_CXX_DIR) { $env:ANDROID_CXX_DIR = 'C:/c' }
$env:EAS_NO_VCS = '1'

foreach ($kind in 'Phone', 'TV') {
  Set-Location $BuildDir
  if ($kind -eq 'TV') { $env:EXPO_TV = '1' } else { Remove-Item Env:EXPO_TV -ErrorAction SilentlyContinue }
  Write-Output "== ${kind}: prebuild"
  & npx.cmd expo prebuild --platform android --clean --no-install 2>&1 | Select-Object -Last 3
  if ($LASTEXITCODE -ne 0) { throw "prebuild $kind failed" }
  Set-Location (Join-Path $BuildDir 'android')
  Write-Output "== ${kind}: gradle"
  & .\gradlew.bat assembleRelease --console=plain 2>&1 | Select-Object -Last 5
  if ($LASTEXITCODE -ne 0) { throw "gradle $kind failed" }
  $apk = Join-Path $BuildDir 'android\app\build\outputs\apk\release\app-release.apk'
  $dest = Join-Path $out "DriveStream.$kind.$Version.apk"
  Copy-Item $apk $dest -Force
  Write-Output "== ${kind}: done $((Get-Item $dest).Length) bytes"
}

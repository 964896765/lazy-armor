param(
  [string]$SourceRepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$TempWorkspaceRoot = "C:\laabuild-$([guid]::NewGuid().ToString('N').Substring(0, 6))",
  [string]$PnpmStorePath = "C:\v2",
  [switch]$KeepWorkspace
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host "==> $Message"
}

function Remove-IfExists([string]$Path) {
  if (Test-Path $Path) {
    Remove-Item -Recurse -Force $Path
  }
}

function Copy-RepoTree {
  param(
    [string]$Source,
    [string]$Destination
  )

  $excludeDirs = @(
    ".git",
    ".data",
    "node_modules",
    "dist",
    ".next",
    ".expo",
    "coverage",
    "artifacts\android"
  )
  $excludeFiles = @(
    ".env",
    ".env.local",
    ".env.development",
    ".env.staging",
    ".env.production",
    "apps\mobile\android\app\debug.keystore"
  )

  Get-ChildItem -Force -LiteralPath $Source | ForEach-Object {
    $relative = $_.FullName.Substring($Source.Length).TrimStart('\')
    if (-not $relative) { return }

    foreach ($dir in $excludeDirs) {
      if ($relative -eq $dir -or $relative.StartsWith("$dir\")) {
        return
      }
    }
    foreach ($file in $excludeFiles) {
      if ($relative -eq $file) {
        return
      }
    }

    $target = Join-Path $Destination $relative
    if ($_.PSIsContainer) {
      New-Item -ItemType Directory -Force -Path $target | Out-Null
    } else {
      New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
      Copy-Item -LiteralPath $_.FullName -Destination $target -Force
    }
  }
}

function New-DebugVerificationKeystore {
  param([string]$KeystorePath)

  Write-Step "Creating ephemeral debug verification keystore"
  & keytool `
    -genkeypair `
    -v `
    -keystore $KeystorePath `
    -storepass android `
    -keypass android `
    -alias androiddebugkey `
    -keyalg RSA `
    -keysize 2048 `
    -validity 3650 `
    -dname "CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US" | Out-Null
}

function Get-AabMetadata {
  param(
    [string]$WorkspaceRoot,
    [string]$RepoRoot
  )

  $aab = Join-Path $WorkspaceRoot "apps\mobile\android\app\build\outputs\bundle\release\app-release.aab"
  if (-not (Test-Path $aab)) {
    throw "AAB not found: $aab"
  }

  $artifactDirectory = Join-Path $RepoRoot "artifacts\android"
  $artifactOutputPath = Join-Path $artifactDirectory "lazy-armor-verification-release.aab"
  New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
  Copy-Item -LiteralPath $aab -Destination $artifactOutputPath -Force
  $hash = (Get-FileHash -Algorithm SHA256 $artifactOutputPath).Hash
  $artifact = Get-Item $artifactOutputPath
  $commit = (git -C $RepoRoot rev-parse HEAD).Trim()
  $metadataPath = Join-Path $artifactDirectory "build-artifact-metadata.json"
  $nativeEvidencePaths = @(
    "apps\mobile\android\app\src\main\AndroidManifest.xml",
    "apps\mobile\android\app\src\main\java\com\lazyarmor\app\DeviceAppBridgeModule.kt",
    "apps\mobile\android\app\src\main\java\com\lazyarmor\app\DeviceAppBridgePackage.kt",
    "apps\mobile\android\app\src\main\java\com\lazyarmor\app\GenericNotificationNormalizer.kt",
    "apps\mobile\android\app\src\main\java\com\lazyarmor\app\LazyArmorNotificationListener.kt"
  )
  $nativeSourceEvidence = @($nativeEvidencePaths | ForEach-Object {
    $sourcePath = Join-Path $WorkspaceRoot $_
    if (-not (Test-Path $sourcePath)) { throw "Required Android source evidence file is missing: $sourcePath" }
    [ordered]@{ path = $_; sha256 = (Get-FileHash -Algorithm SHA256 $sourcePath).Hash }
  })

  $body = [ordered]@{
    artifactType = "AAB"
    artifactPath = $artifact.FullName
    sizeBytes = $artifact.Length
    sha256 = $hash
    buildEnvironment = "development"
    signingMode = "DEBUG_VERIFICATION_ONLY"
    publishable = $false
    buildTimestamp = $artifact.LastWriteTimeUtc.ToString("o")
    commitSha = $commit
    buildWorkspace = @{
      type = "short_ascii_verification_workspace"
      path = $WorkspaceRoot
      pnpmStorePath = $PnpmStorePath
    }
    nativeSourceEvidence = $nativeSourceEvidence
    acceptance = @{
      requiresRealDevice = $true
      requiresDeviceGeneratedKeystoreProof = $true
      requiresPackageManagerDiscovery = $true
      requiresNotificationConsentAndCallback = $true
      providerHardcodingAllowed = $false
      productionMockAllowed = $false
    }
  } | ConvertTo-Json -Depth 6

  New-Item -ItemType Directory -Force -Path (Split-Path $metadataPath -Parent) | Out-Null
  Set-Content -LiteralPath $metadataPath -Value $body -Encoding UTF8
  Write-Host $body
}

$workspace = $TempWorkspaceRoot
$mobileRoot = Join-Path $workspace "apps\mobile"
$androidRoot = Join-Path $mobileRoot "android"
$appRoot = Join-Path $androidRoot "app"
$keystorePath = Join-Path $appRoot "debug.keystore"

try {
  Write-Step "Preparing fresh short ASCII workspace at $workspace"
  Remove-IfExists $workspace
  New-Item -ItemType Directory -Force -Path $workspace | Out-Null

  Write-Step "Copying repository without Git metadata, env files, credentials, or keystores"
  Copy-RepoTree -Source $SourceRepoRoot -Destination $workspace

  New-DebugVerificationKeystore -KeystorePath $keystorePath

  Write-Step "Configuring short pnpm store"
  New-Item -ItemType Directory -Force -Path $PnpmStorePath | Out-Null
  $env:PNPM_STORE_DIR = $PnpmStorePath

  Write-Step "Installing dependencies with frozen lockfile"
  Push-Location $workspace
  pnpm install --frozen-lockfile
  Pop-Location

  Write-Step "Running Android verification bundle"
  Push-Location $androidRoot
  $env:JAVA_TOOL_OPTIONS = "-Dfile.encoding=UTF-8"
  $env:EXPO_PUBLIC_APP_ENV = "development"
  $env:APP_ENV = "development"
  $env:LAZY_ARMOR_ANDROID_ALLOW_DEBUG_RELEASE = "true"
  .\gradlew.bat bundleRelease --no-daemon
  Pop-Location

  Write-Step "Writing artifact metadata"
  Get-AabMetadata -WorkspaceRoot $workspace -RepoRoot $SourceRepoRoot
} finally {
  if (-not $KeepWorkspace) {
    Write-Step "Cleaning temporary workspace"
    Remove-IfExists $workspace
  }
}

param(
  [string]$SourceRepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  # Verification-only root must stay exceptionally short for React Native CMake/Prefab paths.
  # Callers may override it, but CI uses this empty disposable directory.
  [string]$TempWorkspaceRoot = "C:\l-$([guid]::NewGuid().ToString('N').Substring(0, 4))",
  # A per-run virtual store is kept outside node_modules to shorten native CMake paths.
  [string]$VirtualStorePath = "C:\p-$([guid]::NewGuid().ToString('N').Substring(0, 4))",
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

  # 必须递归复制源码树；只复制顶层目录会生成空 apps\ 目录，
  # 导致 Windows CI 找不到 apps\mobile\android 与 Gradle Wrapper。
  Get-ChildItem -Force -LiteralPath $Source -Recurse | ForEach-Object {
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
    cmakeVersion = $verificationCmakeVersion
    signingMode = "DEBUG_VERIFICATION_ONLY"
    publishable = $false
    buildTimestamp = $artifact.LastWriteTimeUtc.ToString("o")
    commitSha = $commit
    buildWorkspace = @{
      type = "short_ascii_verification_workspace"
      path = $WorkspaceRoot
      pnpmStorePath = $PnpmStorePath
      virtualStorePath = $VirtualStorePath
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
$verificationCmakeVersion = "3.30.5"
$virtualStoreCreated = $false
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

  Write-Step "Configuring short pnpm content and virtual stores"
  New-Item -ItemType Directory -Force -Path $PnpmStorePath | Out-Null
  $env:PNPM_STORE_DIR = $PnpmStorePath
  if (Test-Path -LiteralPath $VirtualStorePath) {
    throw "Verification virtual store already exists: $VirtualStorePath"
  }

  Write-Step "Installing dependencies with frozen lockfile and an external Windows-safe virtual store"
  Push-Location $workspace
  # React Native Prefab builds native objects below the virtual store. Keep both
  # its root and package names short without changing the production linker.
  $virtualStoreCreated = $true
  pnpm install --frozen-lockfile --config.virtual-store-dir=$VirtualStorePath --config.virtual-store-dir-max-length=60
  Write-Step "Building mobile runtime workspace dependencies"
  pnpm --filter @lazy-armor/shared build
  pnpm --filter @lazy-armor/plan-schema build
  Pop-Location

  Write-Step "Configuring verification CMake toolchain"
  # React Native 0.86 uses 3.30.5 by default. Expo applies android.cmakeVersion
  # to each native subproject, keeping Worklets and ReactAndroid on one toolchain.
  # This is appended only to the disposable copy, not repository gradle.properties.
  Add-Content -LiteralPath (Join-Path $androidRoot "gradle.properties") -Value "`nandroid.cmakeVersion=$verificationCmakeVersion"

  Write-Step "Running Android verification bundle"
  Push-Location $androidRoot
  $env:JAVA_TOOL_OPTIONS = "-Dfile.encoding=UTF-8"
  $env:CMAKE_VERSION = $verificationCmakeVersion
  $env:EXPO_PUBLIC_APP_ENV = "development"
  $env:APP_ENV = "development"
  $env:LAZY_ARMOR_ANDROID_ALLOW_DEBUG_RELEASE = "true"
  # Isolate native CMake configurations in the verification runner. This does
  # not alter application code, dependency versions, New Architecture, or ABI policy.
  .\gradlew.bat bundleRelease --no-daemon --no-parallel --max-workers=1
  Pop-Location

  Write-Step "Writing artifact metadata"
  Get-AabMetadata -WorkspaceRoot $workspace -RepoRoot $SourceRepoRoot
} finally {
  if (-not $KeepWorkspace -and $virtualStoreCreated) {
    Write-Step "Cleaning temporary virtual store"
    Remove-IfExists $VirtualStorePath
  }
  if (-not $KeepWorkspace) {
    Write-Step "Cleaning temporary workspace"
    Remove-IfExists $workspace
  }
}

# Android Build On Windows

## Purpose

This document defines the Windows-native verification build path for `@lazy-armor/mobile`.
It is build infrastructure guidance only. It must not change product architecture, domain model, connector rules, or worker logic.

## Why This Exists

The current Android verification build exposed three recurring Windows constraints:

1. Non-ASCII workspace paths can break React Native / CMake / Gradle toolchains.
2. Long paths can exceed native build tool expectations.
3. `pnpm` virtual-store paths can become too long for generated native code and CMake autolinking outputs.

## Recommended Verification Setup

Keep normal source development in the regular repository location.
For Windows native release verification, use a separate short ASCII build workspace and a short `pnpm` store path.

Recommended defaults:

- Verification workspace: `C:\laabuild-<id>`
- Short `pnpm` store: `C:\v2`
- Gradle JVM encoding: `-Dfile.encoding=UTF-8`
- App environment for debug verification builds: `development`

## Required Guardrails

- Never hardcode temporary Windows paths into application code.
- Never copy `.git`, `.env`, credential files, release keystores, or other secrets into the verification workspace.
- Never treat warnings, deprecation notices, or CMake warnings as build failure by themselves.
- Only mark Android build verified when both conditions are true:
  - `BUILD SUCCESSFUL`
  - real `*.aab` exists

## Signing Policy

Current verified AAB is a development verification artifact only.

- `signingMode = DEBUG_VERIFICATION_ONLY`
- `publishable = false`

Staging and production must never use debug signing.
When staging release verification is required, use a dedicated staging release keystore stored outside Git.

## Permission Review Policy

Verification must inspect the final merged manifest or AAB-derived manifest, not just source files.

Remove unneeded permissions from the final artifact.
Current review focus:

- Keep `INTERNET` only when networking is required.
- Do not allow SMS, contacts, call log, camera, microphone, or location permissions unless the product truly needs them.
- Do not keep legacy storage or biometric permissions unless they are required by the actual feature set.

## Fresh Workspace Rule

Prefer a fresh verification workspace over `gradlew clean` in a reused copied workspace.

Observed issue:

- `externalNativeBuildCleanRelease` can fail in copied React Native workspaces because generated CMake autolinking paths point to stale `pnpm` store locations.

Safer pattern:

1. Create a fresh short ASCII workspace.
2. Install dependencies with a short `pnpm` store.
3. Run `bundleRelease`.
4. Collect metadata and hashes.
5. Delete the temporary workspace.

## Standard Verification Flow

1. Create fresh short ASCII workspace.
2. Copy repository contents without secrets or Git metadata.
3. Generate an ephemeral debug verification keystore in the temp workspace.
4. Run `pnpm install --frozen-lockfile`.
5. Run `gradlew.bat bundleRelease --no-daemon`.
6. Verify `BUILD SUCCESSFUL`.
7. Verify `*.aab` exists.
8. Compute SHA-256 and signing evidence.
9. Inspect merged manifest permissions.
10. Write `artifacts/android/build-artifact-metadata.json`.
11. Remove the temporary workspace.

## Automation

Use `scripts/android-verification-build.ps1` for the standard Windows verification flow.

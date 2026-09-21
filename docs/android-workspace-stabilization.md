# Android Workspace Stabilization

Status: **LOCAL GREEN** (workspace and APK build)

This milestone stabilizes the generated Android workspace. It does not claim Android Runtime Closure or real-device acceptance.

## Baseline

- Package: `com.lazyarmor.app`
- Expo: `57.0.18`
- React Native: `0.86.3`
- Android compile/target SDK: `36`
- Minimum SDK: `24`

## Stabilized contract

- `expo prebuild --platform android --no-install` is the authoritative generator.
- `with-lazy-armor-android-runtime` restores the reviewed native bridge after every prebuild.
- The plugin owns the notification listener, foreground service, share receiver, package-usage declaration, bridge package registration, and eight Kotlin runtime sources.
- Sensitive or unrelated Android permissions remain explicitly blocked in `app.json`.
- Windows dependency paths use a hoisted pnpm layout and a short virtual store, avoiding native CMake path overflow without changing dependency versions.
- No temporary package id or legacy `.r9` branch is introduced.

## Reproduction

```powershell
pnpm install --frozen-lockfile
pnpm --filter @lazy-armor/mobile android:stabilize
pnpm --filter @lazy-armor/mobile typecheck
pnpm --filter @lazy-armor/mobile test
```

## Evidence

- Prebuild was run repeatedly after deleting and recreating `apps/mobile/android`.
- All eight generated Kotlin sources matched their checked-in templates byte-for-byte.
- Full Android debug build: `BUILD SUCCESSFUL`, 379 tasks, including all four configured ABIs.
- Recreated-workspace debug build: `BUILD SUCCESSFUL`, 353 tasks.
- Mobile typecheck: passed.
- Mobile tests: 27 files / 179 tests passed.
- Debug artifact: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
- Artifact SHA-256: `68551BA9C96120E0628AB42102FC2FEB3F12C343089CD55F38555532DCE7C299`.

## Deliberately not claimed

- No `AWAITING_ANDROID_*` state is promoted by this milestone.
- ADB reported no attached device at the final local check, so install/launch and system-permission evidence remain pending.
- Trusted Device, heartbeat, notification, share, AppReadSession, DeviceTask lease, process-death recovery, and `OUTCOME_UNKNOWN` still require the real-device acceptance run.

# Android Beta Engineering Report

状态：ANDROID ENGINEERING VERIFIED

## Build Verified

- Verified command: `gradlew.bat bundleRelease --no-daemon`
- Result: `BUILD SUCCESSFUL`
- Exit code: `0`
- Verified AAB: `C:\laabuild-73f6c\apps\mobile\android\app\build\outputs\bundle\release\app-release.aab`
- Metadata: `artifacts/android/build-artifact-metadata.json`

## Signing Evidence

- `signingMode = DEBUG_VERIFICATION_ONLY`
- `publishable = false`
- Certificate subject: `CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US`
- Certificate SHA-256: `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`
- Verification tool: `jarsigner -verify -verbose -certs`

## Permission Review

Final merged manifest keeps only the permissions required by the current Android feature set:

- `android.permission.INTERNET`
- `com.lazyarmor.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`

Removed from the verification artifact:

- `android.permission.VIBRATE`
- `android.permission.WRITE_EXTERNAL_STORAGE`
- `android.permission.READ_EXTERNAL_STORAGE`
- `android.permission.USE_BIOMETRIC`
- `android.permission.USE_FINGERPRINT`

Absent from the verification artifact:

- SMS
- Contacts
- Call log
- Location
- Camera
- Microphone

## Code Verified

- SecureStore adapter
- token persist order
- startup refresh
- refresh rotation
- invalid refresh cleanup
- logout
- API unavailable behavior
- signing fail-closed

Verified command:

- `pnpm --filter @lazy-armor/mobile test -- src/api.spec.ts src/auth-store.spec.ts src/token-storage-policy.spec.ts`
- Result: `14/14 PASS`

## Device Deferred

- physical Android SecureStore verification
- real app process kill and restart
- OS reboot
- uninstall and reinstall
- biometric or key invalidation behavior
- native secure-storage failure injection

## Production Deferred

- production release keystore
- production signed artifact

## Staging Deferred Gate

Staging release signing is not ready yet.
Current staging gate remains deferred until all of the following exist together:

- HTTPS staging API
- staging DB
- staging Redis
- staging Redis namespace isolation
- staging Credential Provider
- staging OAuth callback
- staging Webhook callback
- staging release keystore

Until then:

- `environment = staging` is not enough
- `STAGING BETA READY` must not be claimed
- debug signing must not be reused for staging or production

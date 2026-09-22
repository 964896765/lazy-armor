# R9 real-device evidence — 2026-09-22

Device identifier is redacted. This is a local development check, not a production acceptance claim.

| Check | Observed result | Acceptance |
| --- | --- | --- |
| ADB authorization | One USB device reported as `device`, Android 13, model 23049RAD8C | Verified on device |
| Package | `com.lazyarmor.app` already installed, version 0.1.0 | Verified on device |
| Current debug APK | SHA-256 `68551BA9C96120E0628AB42102FC2FEB3F12C343089CD55F38555532DCE7C299`; `adb install -r -t` succeeded without uninstall/data clear | Verified on device |
| API | Local `/api/health` returned `ok`, MySQL ready, Redis PONG, BullMQ ready; USB reverse 3001 configured | Verified local + USB transport |
| Metro | Restarted with IPv4-compatible listener after `::1`-only bind blocked USB reverse; Android bundle generated | Verified local + USB transport |
| Launch | MainActivity foreground; screenshot visually confirmed the real login page | Verified on device |
| Login / TrustedDevice / heartbeat | No authenticated session on the phone yet | Pending user test-account login |
| Notification listener | Component declared, but not enabled in Android secure settings | Awaiting system permission confirmation |
| Share receiver | Receiver activity declared for share intents | Declaration only; reception not yet tested |
| AppReadSession / DeviceTask / RealityPipeline / Truth / Today / Record | Not executed on this device | Awaiting authenticated, authorized journey |
| Revoke, offline, process death, lease, duplicate, OUTCOME_UNKNOWN | Not executed on this device | Awaiting authenticated journey |

The raw screenshot was inspected locally and then removed. No captured UI content or account credentials are stored in this report. No `AWAITING_ANDROID_*` gate is promoted from declaration, local API health, or an unauthenticated login screen.

API startup against the current local `.env` database (`lazy_armor` on port 3307) initially found six immutable catalog revision conflicts. Five changed ScenarioDefinitions and `shipment.updated_at` were advanced to revision 2 in code; revision 1 rows were not rewritten or deleted. The API then started normally. The user confirmed this local database is the intended R9 isolated acceptance environment; account login and downstream device evidence remain pending until observed on the phone.

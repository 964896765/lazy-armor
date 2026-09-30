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
| Login | Created one `example.test`-domain R9 test account through the existing development registration API; entered credentials on the real phone and visually confirmed the Today screen | Verified on device |
| TrustedDevice enrollment | One active trusted-device row for the R9 test account, following the device-signed challenge flow | Verified on device + isolated DB |
| DeviceHeartbeat | Tapped the phone's signed "发送心跳" action; UI showed server confirmation, and isolated DB recorded one `online` heartbeat at 2026-09-22 12:16:34 UTC | Verified on device + isolated DB |
| Notification listener | Component declared, but not enabled in Android secure settings | Awaiting system permission confirmation |
| Share receiver | Receiver activity declared for share intents | Declaration only; reception not yet tested |
| AppReadSession / DeviceTask / RealityPipeline / Truth / Today / Record | Today page rendered after login, but no real-source observation or DeviceTask journey has executed on this device | Awaiting authorized journey; Today rendering alone is not chain evidence |
| Revoke, offline, process death, lease, duplicate, OUTCOME_UNKNOWN | Not executed on this device | Awaiting authenticated journey |

Raw screenshots were inspected locally and then removed. No captured UI content or account credentials are stored in this report. Login, enrollment, and heartbeat have direct device/database evidence; no downstream `AWAITING_ANDROID_*` gate is promoted from a declaration or empty Today screen.

API startup against the current local `.env` database (`lazy_armor` on port 3307) initially found six immutable catalog revision conflicts. Five changed ScenarioDefinitions and `shipment.updated_at` were advanced to revision 2 in code; revision 1 rows were not rewritten or deleted. The API then started normally. The user confirmed this local database is the intended R9 isolated acceptance environment. The test account's password is not stored in the repository or this report.

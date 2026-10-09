# V8.3 Development Ledger — 2026-10-05

Baseline: integration/2026-10-01-cleanup / 476bbb6, with all existing V8.1/V8.2 uncommitted implementation and real evidence preserved. User authorized development from the two V8.3 documents in Downloads. No parallel core/resource system.

## V8.3-0
Implemented: docs/current updated to Persistent Plan & Hybrid Capability Runtime and 13 product domains / 19 legacy runtime taxonomy. CI inspected: pull_request + workflow_dispatch already present, MySQL8.4 gates retained. No remote GitHub run claimed.

## V8.3-A — in progress
Implemented: shared RuntimeTarget contract and public runtime_targets header; owned TrustedDevice/Provider Connection/ServiceProvider adapters; operator-pinned MCP connection mapping. Existing backing tables remain authorization truth; credentials/grants are not copied. Idempotent owner-serialized refresh, missing backing fail closed, stale heartbeats, epoch fencing and manifest mismatch barriers.
Migration: append-only 0076 applied business + isolated MySQL8.0 test DB; native MySQL8.4.11 lazy_armor_test supplemental migration/tests subsequently passed. No historical PlanVersion modification.
Tests: initial registry integration 3 passed; schema full 192 passed; monorepo typecheck 8/8 passed at A baseline. Additional adapter/invocation regressions pending.
Real evidence: no new V8.3 flow claimed yet; existing V8.1/V8.2 evidence retained.

## V8.3-B — in progress
Explicit canonical identity/aliases; 0077 identities and aliases applied; resolver canonical evaluation keeps source keys and frozen historical inputs. Unknown aliases fail closed. Operator MCP binding uses stable server/tool-specific identity with collision rejection.

## V8.3-C — in progress
Immutable Invocation schema and 0078/0079 storage/links. Existing resolved Execution dispatch creates invocation in same transaction as ActionIntent/adapter binding. Worker rechecks target epoch/manifest. No direct execution endpoint. Android acquisition/create, Service booking and MCP read-only integration remain pending.

## Remaining
D/E durable projections + Result Ledger/ACK/Resume; F/G Android/Provider/MCP/Windows; H Cloud Workspace; I controlled capability candidates; J persistent replanning; K product/real Golden Flows. Missing real credentials/objects stay Pending. No V8.3 completion or Production Ready claim.


## Continued batch — C/D/E protocol foundation
- Server-owned MCP canonical Execution now produces one immutable Invocation; existing Approval, ActionAdapter, SideEffectOperation, Outbox and independent Verification remain authoritative. No new direct execution endpoint.
- RuntimeTaskProjection is read-only over existing Execution/DeviceTask/Operation/Service/Outbox state. Lease expiry alone does not invent retry safety or success.
- Result Ledger is captured in the same terminal transaction; immutable result hash includes references and a digest of retained step outputs. Delivery attempts/ACK/resume are separate from execution and Verification.
- Mobile foreground inbox persists receipt atomically before transport ACK. Saved receipts survive ACK loss/restart; storage failure stops before ACK. Account namespaces remain separate. ACK never authorizes an action or writes Truth.
- Device revoke and signed local permission/grant changes fence existing epochs; registration locks backing rows to avoid stale snapshots overwriting revocation.
- Append-only migrations 0076–0081 applied to business MySQL8.4.11, isolated MySQL8.0 and native isolated lazy_armor_test MySQL8.4.11. API specialized integration 3 files/10 tests passed on both versions. Mobile 53 files/307 tests, Schema38 files/201 tests and monorepo typecheck8/8 passed.
- Migration safety82 files, terminology, production data-truth and repository hygiene passed. Full API regression remains running; no GitHub Green claimed.
- APK544f959560f05f1f752d4546751bc06167947383458231c0ce47030988a75fb7 installed; bundle77980369e1a4c58625ae8e42513f2c254309e76eb1f17c74f0028d4fecc0bda0. Dedicated build evidence preserves prior V8.2 evidence.
- Real registration evidence: eight headers derived from existing real Android/service backing; no real Invocation or Result ACK yet. Those flows remain REAL_EVIDENCE_PENDING. Automated MCP fixture tests are isolated contract evidence only.

## Infrastructure observations
Existing Docker test MySQL is8.0; native MySQL84 service reports8.4.11. A new Docker8.4 pull could not reach the configured daemon proxy; no daemon restart/proxy rewrite was performed. Native existing isolated test schema provided the required8.4 test path without new root credentials. Prior real artifacts were not deleted or overwritten.


CI audit refinement: the workflow trigger supported PR already, but full-rc-gate and android-verification were initially limited to push/manual. Both job conditions now include PRs from codex/v83* branches. No CI job or remote result has been invented.
Backup/restore8.4.11 now also seeds isolated runtime header/invocation/result/delivery records and compares hashes, epoch, idempotency key, cursor/ACK data and foreign-key orphan counts after restore. Dedicated evidence: artifacts/v83-runtime-backup-restore/backup-restore-report.json. These fixtures are backup contract tests, not Golden Flow evidence.

Full API regression (RUN_REAL_DB_INTEGRATION=1, isolatedMySQL8.0):142 files passed/1 skipped;1017 tests passed/6 skipped;zero failures,853.34s. Supplemental nativeMySQL8.4.11 specialized tests and backup/restore passed. These are local results, not GitHub Green. Subsequent native Invocation integration receives fresh focused validation.
Authority refinement: proving the same active device key for a renewed request session is idempotent and does not bump epoch. Actual revoke/re-pair/grant changes still fence stale work. This avoids confusing reconnect/session refresh with a new authorization.


## Native Plan calendar Invocation and durable receipt continuation
- Existing scheduled Plan acquisition now atomically commits DeviceTask + immutable Invocation + DEVICE_TASK link. Pre-confirmation/manual reads retain existing acquisition behavior and never invent a PlanVersion.
- Existing CapabilityResolver records a read decision from the confirmed source contract. Enqueue/claim/complete require the owned active PlanVersion, schedule trigger, exact frozen demand/source pins, signed fresh local grant, current device authority and RuntimeTarget epoch/manifest. No parallel resolver or arbitrary execute endpoint.
- Successful native completion atomically captures one verified Result Ledger entry from the server-verified acquisition receipt. Owned payload retrieval rechecks the retained bytes; delivery/ACK still do not approve actions or create Truth.
- Mobile saves completed read bytes in private versioned files before sending. Large payloads avoid SecureStore limits. Failed rename prevents transmission; partial files cannot supersede committed state. Serialized logout tombstone removes prior result snapshots. Retry/restart resends the same result, not another read. Account/device mismatch is rejected before retained bytes are sent.
- Native/structured completed read replay requires the same claim and result hash and performs no second ingestion. Current Plan/epoch checks remain mandatory. Existing legacy task duplicate-rejection contract is preserved.
- MySQL8.4.11 focused regression:4 files/30 tests passed plus existing resolver1 file/4 tests. Includes immutable source binding, duplicate completion after lease expiry, no duplicate acquisition, changed payload/claim rejection, durable payload/ACK, and grant off/on epoch fencing. Mobile full54 files/314 tests passed; API/Mobile typechecks, API build, migration/terminology/data-truth/hygiene passed. Prior full API1017-test baseline remains separate; not claimed rerun after this batch.
- APK1f6fdaedc71fb3bc5831c26286b8a742338ecfa24dc737520301e7fa5e5ff226 installed successfully on2c696fe. Bundle1be3e0b6f0d6d50f093820cd01c9a10a2d5a063583ae29c2b60cf123340ae84b. Build evidence:artifacts/v83-native-invocation-build-evidence-20261005.json.
- Read-only real-object check found zero active scheduled Plans with frozen native calendar pins and zero real calendar Invocations/results. Native persistent Plan/restart/ACK Golden Flow remains REAL_EVIDENCE_PENDING. No fake Plan or notification was created to fill it.
- C/D/E remain in progress: terminal failure coverage, native create, Provider/Service/read-only MCP onboarding and additional existing runtime links still need development. Later V8.3 stages and final full regression remain open.


## Resource UI / RuntimeTarget Projection continuation
- Reused existing signed TrustedDevice identity, RuntimeTarget Header, Consumer ResourceProjection, Provider Catalog, local capability manifest and real launchable app discovery. No new Resource authority, no copied grants/credentials and no Plan/ExternalReference model changes. Public header metadata exposes owned backing/installation identity for strict projection only.
- Four primary tabs preserved. Contextual + routes:LOCAL→/add-phone-app;CLOUD→/add-cloud-resource;DEVICE→/pair-device;INTERFACE→/add-interface. Main page no longer uses legacy /connections/add. Legacy URL remains compatible with the same phone discovery component.
- Local projects only current signed Android identity. Header shows Xiaomi23049RAD8C, actual heartbeat/check and per-capability statistics. Information acquisition/device execution/app capabilities use lightweight rows. ExternalReference and artifacts are excluded; share and clipboard remain capabilities. Read and userGrant controls moved to owned current-capability detail. OS permission is displayed/managed separately. Per-use file/media/camera/clipboard capability details have no persistent toggle. Clipboard read is a foreground user action with temporary native grant cleared in finally; no background clipboard listener.
- App entry uses actual discovery:19 launchable apps on this phone. Add preview never labels discovery as runtime AVAILABLE. Existing added status is scoped to current TrustedDevice. App detail exposes installed/version and each basic/enhanced capability's permission, grant, health and evidence. Currently missing installation fences an older AVAILABLE snapshot. StructuredRead/execute remain fail closed according to existing server authority.
- Cloud keeps the seven real Provider catalog entries:Gmail/GoogleCalendar/GitHub/Notion/Feishu/DingTalk/WeCom. Removed file_provider/logistics_provider/content_provider placeholders from resource projections. Concrete connection status and current health map distinctly to configured/auth/reauth/connected/degraded/error states. Provider/Connection details separate configuration, authorization, capabilities, health and last check. No name regex is used to confuse an official Provider with a protocol interface.
- Other devices strictly exclude current Target/backing/installation identity, including historical registrations for the same installation. Existing different signing identities were preserved rather than deleted or guessed to be the same physical phone; historical headers remain waiting for checks. Cross-device pairing UI is an explicit entry but its unsupported node enrollments remain 待接入. No Windows/Mac/iPhone/NAS flow is claimed completed.
- Interfaces show protocol entries/Public JSON/Webhook/MCP RuntimeTarget if actually registered. Unimplemented HTTP/REST/OpenAPI/MCP configuration remains 待接入. Only contextual + on the main interface page; no duplicate bottom add button. Protocol types are labels, not fake connected objects.
- Tests:Mobile55 files/337 tests passed;related API5 files/42 tests passed on native MySQL8.4.11 and isolated unit contracts. Covered signed current isolation, no unsigned local projection, exclusion of current identity and placeholders, contextual routes/status mappings, per-use toggle restrictions, external reference exclusion, App discovery safety, loading/error/empty/offline and existing revoked authority behavior. API/Mobile typechecks, API build, Android build and migration/terminology/data-truth/hygiene passed. Full API regression from earlier foundation remains a separate baseline, not claimed rerun here.
- Real UI assertions:artifacts/v83-resource-workspace-real-ui-evidence.json. Current model only on Local;all four contextual labels;three local sections;real19-app discovery;no main read/external-reference entry;no file-detail Switch;no duplicate bottom interface action. Screenshot and XML evidence preserved in artifacts. These prove UI/identity projection only.
- Final APK7e983c4c5fdcd097ec0d09fb64f6c45de9ed1fe20571e11d45a3cf3a7dbc4a07 installed on2c696fe;bundle2484367f5ee0f92cf140307af14105f42acec224ae1c86228848759a7a6b46f8. Build ledger:artifacts/v83-resource-workspace-build-evidence-20261005.json. No prior V8.1/V8.2 implementation or evidence reset/deleted.
- C/D/E are NOT complete:multi-Target read/write/async execution and real Golden Flow closure remain the continuing main line. Missing Runtime/device evidence stays REAL_EVIDENCE_PENDING;missing official Provider credentials stay REAL_CREDENTIAL_PENDING. UI visibility, installation, configuration, authorization and health do not certify execution.

## C-first calendar write contract continuation
- Execution order remains C Multi-Target Invocation → D async projection → E write Result Ledger/ACK/Resume → real calendar Golden Flow. Windows Runtime Node and Cloud Workspace are not started.
- Added shared target-neutral timed calendar write schema (`calendar-write.ts`). Google Calendar create/update now consume the same field/time contract; provider-specific account identity, update ETag and deterministic eventId checks remain intact.
- Android v1 request preparation accepts only an explicit numeric local calendar identity, no attendees and sendUpdates=none. Unsupported invitation semantics, invalid intervals/time zones and injected fields fail closed. This is request-contract preparation only: no native write Executor or approved DeviceTask dispatch is enabled by this change.
- Validation: Schema build passed; calendar-write contract 11 tests passed; Google Calendar provider contract 15 tests passed; API typecheck passed. The provider test verifies a committed mutation with lost response can be reconciled after Executor reconstruction and repeated operation lookup with exactly one mutation; changed approved fields fail verification. All transports are isolated test transports, not real Google-account evidence.
- C/D/E are NOT closed. Android approved write dispatch, durable native effect receipt/reconciliation, multi-executor Invocation acceptance and full write Ledger failure matrix remain open. No real event was created by this batch; Golden Flow remains REAL_EVIDENCE_PENDING. The previously installed Resource UI APK is unchanged.

## Write-side executor and verification safety continuation
- Added internal Android `CalendarInvocationExecutor` with actual CalendarContract insertion and independent read-back. Its input is the canonical Invocation, not a mobile-composed event request; it requires current target/epoch, existing risk/execution references, approval-to-Invocation binding, active account/userGrant and READ/WRITE calendar permission. Numeric writable calendar identity and no-invitation v1 semantics fail closed. Android API24/25 are explicitly rejected by this v1 executor.
- Local operation identity is account + target + immutable idempotency key. PREPARED must commit synchronously before insertion; crash recovery/duplicate execution performs read-only lookup by the operation marker. Missing/deleted/duplicate/mismatched events remain OUTCOME_UNKNOWN. Retained successful receipt hash is checked and transport replay returns the same bytes without another read. Explicit reconciliation may read again. There is no arbitrary React Native write bridge.
- IMPORTANT: this is a compiled internal executor, NOT an enabled end-to-end capability. Android write manifest/health remain unavailable, WRITE permission is not newly requested, and the existing runner does not dispatch native writes. Server-approved native DeviceTask dispatch and result completion have not been connected. No real Android write, fault-injection evidence, APK installation or Golden Flow is claimed.
- Fixed Google Calendar write success handling: mismatched read-back raises AFTER_DISPATCH OUTCOME_UNKNOWN. Existing VerificationService uses the frozen Calendar policy instead of generic ok=true; Outbox success requires SUCCEEDED verification before committing operation/step success. A failed frozen verification routes to existing Reconciliation without another mutation.
- Original SideEffectOperation now retains deterministic Google create eventId before dispatch, including response-loss cases. Successful responses retain real event/device operation identity rather than a literal null string. Existing Result Ledger payloads continue referencing retained execution outputs and verification evidence; no second result authority was created.
- Validation: native Kotlin compile passed (artifacts/v83-calendar-write-kotlin-compile.log); API typecheck passed. Native MySQL8.4 Calendar/Reconciliation/MCP integrations:3 files/20 tests passed (artifacts/v83-calendar-write-verification-regression.log). Includes HTTP success/mismatched read-back → one mutation only → OUTCOME_UNKNOWN/Reconciliation, retained event identity after response loss, and successful eventId/resultHash storage. Calendar provider isolated contract15 tests passed. Additional safety regression7 files/70 tests passed/2 skipped; its true-process subset initially used prior dist and is not counted as fresh-code process validation. Fresh API build and dedicated process rerun recorded separately below.
- Remaining authority integration: PlansService currently requires Connection for capability actions; ExecutionDispatch and ActionAdapter also bind resolver decisions through Connection identity; SideEffectCoordinator refuses unbound R3/R4 actions. These must be extended together for owned Android RuntimeTarget binding through the SAME Risk/Approval/Execution chain, without fake Connections or a direct write endpoint. Native read resolver cannot be reused as write approval.
- C/D/E remain IN_PROGRESS and real calendar Golden Flow remains REAL_EVIDENCE_PENDING. Windows and Cloud Workspace are not started.
- Fresh compiled API process validation: API build passed; dedicated Outbox true-process regression10 passed/3 skipped,98.87s (artifacts/v83-calendar-write-fresh-worker-regression.log). CI=true intentionally excludes shared dependency outage tests; process crash/redelivery/permission/idempotency checks use newly built code. These remain isolated test evidence, not phone or Google-account acceptance.

## 2026-10-06 Native Android approved write and front-end consolidation
- RuntimeTarget-native action bindings extend the existing immutable ActionAdapter/ExecutionDispatch/CapabilityInvocation authority; Connection/Provider paths are retained. Only an explicitly approved canonical calendar.event.create Invocation can create NATIVE_CALENDAR_CREATE DeviceTask. The task freezes target/epoch/idempotency/verification, with a lease-bound P256 server dispatch signature pinned in the APK. No arbitrary mobile business-write bridge was added.
- Native CalendarContract insertion uses durable PREPARED + operation marker and actual read-back; existing Operation/Verification/Reconciliation/Execution/Result Ledger receive outcomes. Terminal DeviceTask heartbeat is rejected. Recovery of committed receipt before Execution finalization runs from the existing Outbox worker, without write redispatch. Expired leases recover through existing tasks; duplicate queue delivery at waiting_approval/waiting_dispatch cannot acquire an execution lease and fail an otherwise waiting execution.
- Real phone 23049RAD8C / adb 2c696fe: first approved manually triggered Plan created calendar event 7; actual read-back matched approved fields; Operation/Execution succeeded, Ledger VERIFIED and ACKed. Evidence: artifacts/v83-native-calendar-first-flow.json, v83-native-calendar-first-write-evidence.json and native journal snapshots.
- Separate real response-loss trial on the SAME Plan created event 8. HTTP proxy forwarded the real signed completion and deliberately discarded its successful response after commit, then force-stopped the App. Restart replayed the retained receipt: one Operation, one claim attempt, event identity 8, one VERIFIED Ledger result, ACK complete. Native journal hash before/after restart is identical. Evidence: artifacts/v83-native-write-response-loss.json, v83-native-calendar-real-fault-evidence.json, v83-native-calendar-journal-after-response-loss.xml and v83-native-calendar-journal-after-restart.xml. The earlier interrupted trial expired at Approval and had no write DeviceTask; it is retained as failed, not rewritten as success.
- Scope limit: these real flows use a manually triggered actual Plan, Resolver and existing Approval. Time-triggered NBA=EXECUTE -> Truth/Plan re-evaluation/Replan has NOT been accepted. Google second Executor, all D/E failure cases and full C/D/E closure remain IN_PROGRESS; Windows/Cloud Workspace remain unopened. Do not describe this as the complete scheduled Golden Flow.
- Front end keeps 日程/计划/会话/资源/服务. All five pages expose avatar -> 我的; schedule right action is search. Profile links existing account/device/settings/notifications/automation safety/AI/privacy/membership/help/about pages. Removed old global message/attention header buttons and drawer business entry; no Skill primary route.
- Schedule consumes existing Timeline + Attention + Notification authorities, groups incomplete items into 需要你处理/正在进行/接下来/最新动态, and shows completed history. Business messages appear in activity; security/login/version/privacy messages go to 我的 -> 安全与系统通知. Search consumes all-date Timeline with filters plus existing attention/messages. Legacy messages/attention routes remain compatible, not primary navigation.
- Plan detail adds existing owned Attention projection and links actual latest Execution for execution resource evidence; no fabricated target or capability availability. Remaining final comparison work is NOT declared complete: automatic resource-gap return/Resolver resume, service request reality-confirmation detail, richer verified Target names and complete Plan control-page ordering/records, business Skill/Recipe template binding audit, server pagination for large all-record searches and fully consistent business/system event taxonomy remain open.
- Validation: native write/Calendar/MCP/device task API regression 4 files /29 passed; front-end Consumer/Calendar API regression 2 files /13 passed. Mobile full regression 56 files /340 passed; API/Mobile typechecks, API build, Kotlin compilation and APK build passed. Real phone UI hierarchy confirms schedule groups, profile settings and search with existing history. Isolated contract tests are NOT substituted for phone evidence.
- Installed APK SHA256: 9a99d88be2d2debe66571d9be690736fd2cd90ff1ca01c96bff38e1ea9c4bf71. Build log artifacts/v83-schedule-profile-apk-build.log; UI captures artifacts/v83-final-schedule.xml, v83-final-profile.xml, v83-final-search.xml. HTTP routing restored to adb reverse tcp:3001 -> tcp:3001 after response-loss test.
### 2026-10-06 Six requested mobile UI corrections
- Avatar entry retained only on Schedule; removed from Plans, Chat, Resources and Services, and guarded legacy shell avatar by Schedule route.
- My uses a 52dp horizontal identity and compact 48dp single-line rows; existing settings destinations retained.
- Plan status filters retained (All/Running/Attention/Paused/Ended); horizontal ChipTabs gets a non-growing 42dp minimum area. Real phone hierarchy confirms all five filters under My Plans.
- add-phone-app disables stack header; real phone confirms only one Add Phone App title and 19 actual discovered launchable apps.
- External Services tabs are All + shared 13 SERVICE_DOMAINS. SERVICE-only kind projection unchanged.
- Chat drawer bottom-right Archived routes to owned backend archived conversation list; excludes deleted records, ordered by archive time. Details open existing Chat. No new Plan created.
- Validation: API/Mobile typecheck and API build passed; consumer API 13 tests passed including archived ownership/delete exclusion; focused Mobile 42 tests passed; Android debug build passed and installed on 2c696fe / 23049RAD8C.
- APK SHA256 C286884DC488BACFED97D4B265D370ADE2B0B84B33ABD207AB4A88F1DB2BA42E.
- Evidence: artifacts/v83-ui-six-fixes-profile.png, *-mine.xml, *-add-phone.xml, *-archive.xml; API/mobile/build logs under same prefix. Real archive screen is empty; nonempty archive isolation is contract-tested, not claimed as new real archive evidence.
- Existing write Runtime Golden Flow gaps remain as previously recorded; this UI correction does not claim C/D/E completed.

### 2026-10-06 Screenshot-driven layout refinement
- Removed My menu container background/border/radius; settings are plain separated rows over shared theme background.
- Fixed horizontal filter viewport to explicit 42dp height and non-shrinking wrapper in My Plans. Screenshot now visibly shows all five status tabs; prior node-only validation was insufficient.
- External service empty state removes nested list/card backgrounds and aligns icon, copy and action in one transparent row.
- Add Phone App uses shared ui.header/ui.pageTitle centered secondary header; page/catalog backgrounds transparent to existing ThemeBackground.
- Mobile typecheck and APK build passed; installed on 23049RAD8C. All four pages visually reviewed from real phone screenshots: artifacts/v83-layout-profile.png, v83-layout-mine.png, v83-layout-external.png, v83-layout-phone-app.png. Existing real discovery remains 19 apps. No Runtime authority changes.

### 2026-10-06 P1-first persistent runtime continuation checkpoint
The user has set the execution order to P1 Scheduled Persistent Plan Golden Flow → P2 ResourceGap automatic return/resume → P3 Plan Detail projection → P4 Service Reality Verification → P5 Provider/MCP → P6 Business Skill/templates → P7 Android UI Agent → P8 Windows → P9 Cloud → P10 Synthesis → P11 final closure. Five primary pages are frozen; preserve existing local changes and real evidence.

Implemented in existing authorities:
- Strategy dispatch resolves canonical calendar.event.create using the same CapabilityResolver and Dispatch/Risk/Approval/Invocation path. Missing target stays PENDING/WAITING_RESOURCE for re-resolution, not a new Execution engine.
- Fixed both normal and concurrent strategy replay fences to accept existing TruthHandoffProof as well as TerminalHandoffProof. Replay checks the persisted execution before resolving new resources.
- Verified signed Android calendar write read-back now enters existing RealityPipeline Observation/Candidate/Truth transaction. UNKNOWN creates no new verified facts. Immutable write result references verified Truth records.
- Existing scheduler recovers completed strategy executions from Result Ledger independently of ACK. Durable audit records next schedule WAIT or inactive/replaced version fencing; duplicate continuation/Worker restart is idempotent under execution lock. This is a continuation checkpoint, not proof of full business Assessment/Replan completion.
- Narrow confirmed calendar binding adapter accepts only owned immutable source contracts, work.meetings, exactly one canonical scheduled native calendar action, explicit timezone, always approval, no uncompiled conditions. Existing compiled bindings and Provider semantics retained.

Validation: 34 runtime regression tests passed (native write, wakeup, replay, calendar Provider, MCP and DeviceTask); latest confirmed-binding/consumer/native/wakeup/replay suite 25 tests passed; API typecheck/build passed. Isolated test receipts and runtime fixtures are explicitly NOT real phone acceptance.

Real attempt: formal auth refreshed privately; actual conversation 01a1118d-743a-77ce-9782-9bcea2112946 retained in artifacts/v83-p1-real-scheduled-draft.json. Actual configured AI returned MODEL_UNAVAILABLE, with no Plan proposal. No test event was scheduled or written from this attempt. Do not fake the proposal, inject Truth, or invoke manually to bypass this failure. API, Execution Worker and Outbox Worker restarted on the validated build. P1 remains REAL_EVIDENCE_PENDING; requires a real authored/frozen schedule contract and actual due-time wakeup through Assessment/NBA, write and next-run state. Broad fault matrix, authoritative post-result business re-assessment and Google second Target remain pending. Existing manually triggered event7/event8 evidence unchanged.

P1 additional validation and current state:
 - P1 acceptance blocker: `REAL_PLAN_CREATION_BLOCKED_BY_MODEL_UNAVAILABLE`. The retained creation attempt produced no Plan, schedule, due-time wakeup, Invocation or execution. This is a Plan creation dependency blocker, not a Scheduler/Runtime failure or acceptance result. Retry through the existing user-facing creation/confirmation authority; never insert a Plan or manually trigger acceptance.
- Frozen source resolution now supplies actual acquisition coverage to assessState/nextBestAction. The persisted Trigger Decision contains StateAssessment and NBA. EXECUTE is only a recommendation to enter existing Dispatch/Risk/Approval; it never bypasses device approval.
- Final seven-file strategy/offer/native/binding/replay regression: 26 tests passed, including current Plan WAITING_NEXT_SCHEDULE continuation without ACK and paused Plan INACTIVE_VERSION fencing. Latest API typecheck/build passed. API/Execution/Outbox restarted together on this build.
- Real attempt is still a retained conversation with MODEL_UNAVAILABLE, not a Plan or due-time receipt. No manual dispatch fallback used. Conversational goal/subject authoring and confirmed scheduled-action projection still need an end-to-end actual authoring path; adapter contracts passing do not prove that path. Post-result domain Assessment/Truth/Replan and full real fault matrix remain incomplete. P1 remains open; do not advance acceptance to P2 or declare V8.3 closure.

### 2026-10-06 P1 actual UI retry and authority fences
- Restored adb reverse after reconnect; retried the SAME retained conversation through the installed phone UI with a future 22:47 Asia/Shanghai request, without pressing an execution button. Model returned `PLANNER_OUTPUT_INVALID`, not `MODEL_UNAVAILABLE`: `publish` marker rejected, scenario null, and `calendar.event.create` absent from planner capability projection. Preserve the earlier `REAL_PLAN_CREATION_BLOCKED_BY_MODEL_UNAVAILABLE` attempt separately. Current blocker is the normal authoring contract path; no Plan/schedule/Invocation/write was created. Evidence: `artifacts/v83-p1-real-ui-retry.json`, `v83-p1-ui-retry-result.xml`, `v83-p1-real-ui-retry.png`.
- Confirmation now fails closed and rolls back when a calendar write CreationDraft lacks a valid demand/source contract. It cannot silently create a calendar Plan without the required frozen authority. Existing non-calendar draft behavior retained. No test-only creation or authority bypass added.
- Added isolated DB contract coverage that waiting Approval continues the same Invocation, and applying a newer PlanVersion preserves an old execution's immutable version and prevents the old result from scheduling its replaced version. These do not prove a real scheduled new-version run.
- Four-file regression passed 24 tests; evidence `artifacts/v83-p1-four-boundaries-regression.log`. API typecheck/build passed. Latest consumer/creation rollback regression passed 14 tests (`artifacts/v83-p1-creation-fence-regression.log`); the suites overlap and are not counted as 38 distinct tests.
- P1 remains `REAL_EVIDENCE_PENDING`. None of the four boundaries is newly claimed as real phone acceptance. Full post-result Assessment/Replan and next WAIT remain open. P2 acceptance has not started.

### 2026-10-06 P1-A Scheduled Plan Authoring Contract Closure and actual due-time observation
- Added one parameterized Calendar Recipe to the existing Action Recipe catalog. Model supplies only recognized Recipe parameters (future first time, timezone, daily cadence, actual discovered observation subject, Calendar event fields). Compiler derives the registered Scenario/revision, FactDemand goal, capability requirements, existing publish adapter action, always Approval, and read-back verification. Raw model `publish` and arbitrary action definitions remain forbidden. Missing Scenario returns clarification; no calendar intent can silently fall back to generic notification actions.
- Planner projects real native capability state alongside existing Provider capabilities. Calendar resource identities are labelled identity-only and remain separate from current Truth evidence; model scopes must match an owned discovered native calendar object and its actual calendar identity. An identity never implies fresh facts or write permission.
- CreationDraft stores the compiled typed goal/subject and SourceResolver-selected sources. Confirmation recompiles from retained Recipe parameters, compares the complete PlanDefinition hash, validates source choices, and freezes the source contract and runtime binding for the same immutable PlanVersion. Missing/changed Recipe, source, Scenario, schedule, or authority still rolls back. No second Plan/Resource/Runtime was introduced.
- Compatibility: the existing `work.meetings` reminder Contract V2 retains its original hash `a6f22e1efffac44cd9d55b3caecf53c0b83b29cc96948b6453f6eb7784d0ca42`. Calendar write uses a goal-scoped Recipe contract with a different hash; old reminder contracts are not rewritten. First-run not-before is frozen in the existing schedule trigger. Automatic acquisition scope includes the selected real observed event, rather than substituting a future-only empty scope.
- Contract evidence: full Schema suite 40 files / 222 tests passed; final focused API suite 4 files / 57 tests passed, including model omission of capability, illegal markers/scenarios/scope, real-authority confirmation freezing, pre-first-time and paused scheduling fences, same Invocation Approval, old version isolation, and confirmation rollback. These are isolated contracts, not phone evidence. Schema/API builds passed; full workspace typecheck 8/8 tasks passed (`artifacts/v83-p1a-workspace-typecheck.log`).
- REAL phone UI: retained conversation `01a1118d-743a-77ce-9782-9bcea2112946` produced an actual configured model `PLAN_DRAFT`; UI Confirm created Plan `01a111cc-7e0b-74e9-92d6-b85e7b837c62`, PlanVersion `01a111cc-7e10-75fb-b7c1-a66228ec959e`, runtime binding `01a111cc-7e8b-72cc-8c56-c2c8c2cec1fe`. UI marked ready, applied version, then activated before 23:24 Asia/Shanghai. No run-once/manual trigger/debug tick or direct database write was used. Before-due snapshot proves zero executions/tasks/approvals/write invocations.
- REAL 23:24 trigger: Scheduler dispatched `NATIVE_CALENDAR_READ` task `1ef5c035-503e-54f6-8a3b-328551d88e12`; actual phone returned `VERIFIED_PRESENT`, 3 real events, observedAt `2026-10-06T15:24:14.829Z`. Canonical read result Ledger is VERIFIED and ACK at `2026-10-06T15:24:29.198Z`. This proves actual scheduled acquisition and read delivery, not calendar write acceptance.
- REAL continuation blocker: `AUTOMATIC_PLAN_ACQUISITION_ASSESSED` still resolves the selected subject to stale Truth version `01a107ed-705c-77cc-8245-5af760190733`, observedAt `2026-10-04T17:19:24.011Z`, despite fresh signed acquisition. StateAssessment=BLOCKED, NBA=REFRESH_SOURCE, wakeupId=null. No write Invocation, Approval, event insertion, post-write re-evaluation, or next WAIT was reached. Do not lower freshness or manually dispatch. New acquisition freshness and canonical Truth refresh need closure within the existing Reality chain; further code expansion stopped after the first actual Plan was created as requested.
- Evidence: `artifacts/v83-p1a-real-before-due.json`, `v83-p1a-real-due-time.json`, `v83-p1a-real-scheduled-evidence.json`, actual phone UI XML/PNG under the same prefix; `v83-p1a-real-evidence.cjs` is a read-only collector. Earlier MODEL_UNAVAILABLE and rejected parameter attempts remain separate. Earlier manually triggered event 7/8 evidence remains unchanged.
- Status: P1-A actual authoring/confirmation/activation reached. P1 engineering remains incomplete at automatic fresh Truth continuation. Actual scheduled Plan=CREATED; due-time wake=OBSERVED; actual read=VERIFIED/ACKED; P1 write=NOT_REACHED; post-result re-evaluation and next WAIT=NOT_ACCEPTED; overall=`REAL_EVIDENCE_PENDING`. P2/UI/extra Targets were not opened.

### 2026-10-07 P1-B Fresh Truth Handoff — traced root cause and engineering closure
- Read-only trace of actual task `1ef5c035-503e-54f6-8a3b-328551d88e12` proves category **B**. Target event 6 has a new Observation `01a111d0-bc05-7526-9b97-19b3d0703e7e`, observed at `2026-10-06T15:24:14.829Z`, with **zero attached Candidates**. Semantic content dedupe returned the Oct 4 verified Candidate; confirmCandidate returned that Candidate's existing Truth/provenance. The acquisition and VERIFIED/ACK Ledger were committed; this was not evidence loss or a proven transaction timing race. Event 7/8 did have new Candidates but belong to different subjects and cannot satisfy the frozen demand. Evidence: `artifacts/v83-p1b-real-readonly-trace.json` and its SELECT-only collector.
- Existing native Calendar Reality ingestion now dedupes by immutable Observation plus semantic fact identity. A genuine new read of unchanged content produces a new authority-confirmed Truth/provenance with the actual observedAt; exact receipt replays reuse the same Observation/Candidate/Truth. Provider repository/document versioned publication semantics are unchanged. No freshness threshold was relaxed and old Truth was not rewritten.
- Automatic continuation resolves the committed canonical Invocation/DeviceTask/VERIFIED Result Ledger/acquisition identity, hash, scope, owner, PlanVersion, source and epoch, then selects only Truth with matching acquisition Observation and provenance. The authority-derived `acquisition-truth-handoff.v1` proof records result/Observation/Truth version refs and confirmed FactDemand coverage. Schedule wakeup binds that exact version; frozen-source evaluation also checks the selected version rather than querying unrelated latest Truth. This proof augments the existing Reality/Truth/Runtime chain, not a second authority.
- Task locking and a single transaction atomically commit schedule wakeup plus assessment checkpoint. Worker replay/restart and concurrent continuation cannot commit a second assessment. ACK remains transport-only. Native scheduler replay cannot bypass the committed Truth barrier via the old immediate latest-Truth path. Active PlanVersion is checked under the continuation transaction lock.
- Isolated tests: all seven requested handoff contracts pass (fresh unchanged read; old/new coexist; subject mismatch; source mismatch; receipt replay; ACK absent; restart/concurrent continuation). Native capability/native write/terminal authority suites: **30 tests passed**, `artifacts/v83-p1b-authority-regression.log`. Strategy/wakeup/replay: **9 tests passed**, `artifacts/v83-p1b-strategy-regression.log`. Separate generic Reality/concurrency suites passed in the initial focused run; that run also recorded the subsequently fixed test-strategy setup failure. API typecheck/build passed. These fixtures are contract verification only, not phone evidence.
- REAL next trial: through installed phone UI, configured AI generated the scheduled Calendar Recipe and UI confirmation created Plan `01a11433-ffe6-7758-8fb8-ef92cfe29edd` in conversation `01a11430-b1b3-74bd-a31d-459e743f950f`. UI marked ready, applied version, and activated by `2026-10-07T02:33:01.654Z`. First trigger is **2026-10-07 10:38 Asia/Shanghai**; event is **11:00–11:10**, title `P1-B Scheduled Golden Flow 20261007`, native calendar 1, no attendees/invitations, always Approval. Before-due evidence has zero tasks/executions/Invocations/Approvals/results. No manual run, debug tick or production DB insertion used.
- Before due-time observation, P1-B real Fresh Truth consumption and P1 scheduled write/post-write domain reassessment/next WAIT remain `REAL_EVIDENCE_PENDING`. Preserve the Oct 6 blocked run and manual event 7/8 separately. No P2/UI/extra Target work opened.

### 2026-10-07 P1-B real acceptance and SAME P1 scheduled write/reassessment recovery
**Latest status:** P1-B Fresh Truth Handoff = `REAL_VERIFIED`. The normal Scheduled Persistent Plan Golden Flow is verified **with automatic post-write recovery across Worker restart**. Broader P1 boundary/fault acceptance and V8.3 overall remain pending; no P2, UI redesign or extra Target was started.

Actual chain (all UTC below; trigger and next wait also shown in Shanghai time):
- Phone UI real AI Proposal → CreationDraft → user confirmation → immutable PlanVersion `01a11433-ffe9-714d-9f95-bf5f0c9588c0` → apply/ACTIVE, Plan `01a11433-ffe6-7758-8fb8-ef92cfe29edd`. The 02:37:53Z snapshot still had zero tasks/executions/approvals/Invocations/results, before the actual **10:38 Shanghai** trigger. No run-once/debug tick/handoff/production DB insertion was used to trigger acceptance.
- Scheduler automatically dispatched read task `9d66ab51-1d3e-5912-84a9-7be7fa1852dc`; phone read 3 genuine events at `02:38:14.286Z`. Content hash is unchanged from the old read, proving the new provenance came from actual rereading rather than changed event contents.
- Authority committed Observation `01a11439-cf9c-7372-b908-74b48d66d90a` → new Candidate → Truth record `01a11439-cfb7-731a-a842-60da4e9622f1`, Truth version `01a11439-cfb8-7751-a11e-286d5e0775d9`. Frozen subject, source, FactDemand, owner and PlanVersion match. Acquisition `01a11439-cf96-77ee-9f50-9838f5bb8151`, read Invocation `01a11439-976c-751b-96b0-438c1ba9335f`, VERIFIED Result `01a11439-d019-7045-aa49-8040f07b7a2f` are recorded in the committed `acquisition-truth-handoff.v1` proof.
- Automatic assessment consumes that exact Truth version. Canonical SCHEDULE decision `01a11439-d228-77f2-93e1-ad1d17c1e6e4` has StateAssessment=NEEDS_ATTENTION and NBA=EXECUTE at `02:38:16.104Z`; dispatch creates Execution `01a11439-d2ba-73bb-b5e5-59ec41ac3c62`, write Invocation `01a11439-d310-7745-85c8-31ca0b05d1e1`, pending Approval `01a11439-d3c7-73e1-97dd-ecdb300ed696`. This occurs while read ACK is still null; read ACK arrives at `02:38:44.577Z`. The source-coverage assessment and the SCHEDULE-trigger assessment are separate existing stages, not a forced NBA override.
- Actual installed App Approval detail and its confirmation dialog approve that same Invocation. Navigation used the existing supported App approval deep link after the schedule row opened the read-only execution record; no direct approve API or manual execute was used for real acceptance. Approved write DeviceTask succeeds through Android Calendar Executor, actual event **9**, calendar 1, title `P1-B Scheduled Golden Flow 20261007`, **2026-10-07 11:00–11:10 Shanghai**.
- Real read-back independently matches operation marker, event id, calendar id, title, start/end/timezone and undeleted state. Existing SideEffectOperation/Verification/Reality transaction publishes output Observation `01a1143c-30b3-75e0-aaae-274793508b97`, schedule Truth version `01a1143c-30be-750f-9c8d-f8b26184ad6e`; write Result `01a1143c-30f1-729e-8c8e-362b475ac55c` is VERIFIED and ACK at `02:41:14.034Z`.
- Existing next-WAIT checkpoint alone was not accepted as business reassessment. Added a narrow existing Recipe output-goal assessment: read the committed Ledger's Truth refs, validate Reality subject/Observation/source Invocation and exact frozen Calendar goal, then call the existing assessState/nextBestAction. Output completion facts remain distinct from the original acquisition FactDemand; next scheduled execution must acquire fresh input again. No input freshness threshold changed and no historical observation time was advanced.
- Real Worker restart automatically recovers the same committed write at `02:50:28.057Z`; `PERSISTENT_PLAN_POST_WRITE_ASSESSED` records actual output Truth consumption, occurrence StateAssessment=COMPLETE/NBA=COMPLETE, then persistent Plan replan StateAssessment=READY/NBA=WAIT, **nextRunAt `2026-10-08T02:38:00.000Z` = Oct 8 10:38 Shanghai**. The old checkpoint is retained, not deleted or rewritten. Paused/replaced versions cannot schedule the current version through this recovery.
- Read-only Android CalendarProvider query at the end returns **exactly one** undeleted event with this title, id 9. Retained evidence still has one Execution, one read Task, one write Task, and two VERIFIED/ACK results. The restart produced one domain assessment and no extra Invocation/task/event. This proves automatic recovery of this committed result, not arbitrary process-crash or network-fault matrix completion.

Evidence: `artifacts/v83-p1b-real-before-due.json`, `v83-p1b-real-last-before-due.json`, `v83-p1b-real-due-time.json`, `v83-p1b-real-approved.json`, `v83-p1b-real-write-result.json`, `v83-p1b-real-post-write-assessment.json`, `v83-p1b-real-final-evidence.json`, `v83-p1b-real-calendar-readonly-check.txt`, and actual phone UI XML/PNG under that prefix. SELECT-only collectors preserved; Oct 6 failed continuation and manual event 7/8 remain separate and unchanged.

Validation: final **8 API files / 53 tests passed**, `artifacts/v83-p1b-final-regression.log`, including all seven requested Fresh Truth handoff contracts and additional scheduled output Truth goal/subject/unknown-result guards. The post-write contract fixtures also verify no-ACK completion and once-only assessment replay. API build and workspace typecheck recorded separately below after final verification. No mobile code was changed in P1-B; the installed canonical native Calendar Executor performed real read/write/read-back/receipt delivery.

Remaining real acceptance: Plan paused before due; next-round PlanVersion replacement; foreground/background/offline/device recovery; approval expiry; broader duplicate schedule/claim/stale epoch and scheduled response-loss/ACK-loss fault matrix. Prior manually triggered response-loss event 7/8 evidence remains valid for that earlier scope only. Schedule UI currently projects a next-run time differently from the actual timezone-bound backend Trigger; the backend next WAIT is correctly Oct 8 10:38. Calendar completion Truth uses the existing write collector device identity while acquisition Truth uses TrustedDevice identity; this trial validates each against its own authenticated Task/Invocation and does not alias unrelated subjects. These remaining projections/identity compatibility items are not silently claimed fixed and are outside this P1-B UI freeze. V8.3 and the full P1 boundary matrix are not declared closed.

Final verification for this checkpoint: full workspace typecheck **8/8 tasks successful** (`artifacts/v83-p1b-workspace-typecheck.log`), final API build passed (`artifacts/v83-p1b-final-build.log`), affected-file diff whitespace check passed. Validated build is running in separate hidden API/Execution Worker/Outbox Worker processes. A second normal Worker restart still leaves one post-write assessment, one read task, one write task, one execution and event 9; no new side effect or authority object was injected.
Actual system Calendar UI also confirms `P1-B Scheduled Golden Flow 20261007`, **今天 上午11:00至11:10**, same operation marker and calendar account: `artifacts/v83-p1b-calendar-view-final.xml/png`. The first diagnostic ACTION_VIEW launch omitted CalendarContract beginTime/endTime and MIUI displayed a default 1970 occurrence; the existing Activity ignored later extras. Returning and launching a new view with the Provider's actual stored begin/end timestamps shows the correct time. These earlier diagnostic frames are preserved and are not used as the accepted Calendar time evidence. No event was edited or re-created.

## 2026-10-07 日程与外部日历边界
已核对现有 Consumer timeline / CalendarProjection / mobile scheduleRows：已有内部运行、预约、提醒、待处理与结果投影，外部 CalendarEvent 来自 verified Truth。新增 docs/current/SCHEDULE_AUTHORITY.md 固定权威与默认行为；独立 USER_EVENT 生命周期、内部提醒完整创建链及可选外部同步仍未验收。本次为产品合同与代码审计，无 Runtime 改动或新增真机验收。P1 实际 Evidence 保持，不将其等同内部日历完成。

## 2026-10-07 新 P0–P11 主线冻结
用户两份方向修正文稿已合并为 docs/current/V83_MAINLINE.md，TASK_BOOK 顶部引用。旧阶段编号为历史；新主线为自然语言 Goal / Skill / Facts与Capability / Resolver / Action或Plan / Runtime / Verification / Truth / Replan。P0 去权威化但保留历史执行合同，P6 正式迁移资产；P1 正向已验但故障矩阵 Pending，P2 USER_EVENT 提升优先级。本 checkpoint 只冻结工程方向，没有宣称 Skill 平台、内部事项、跨 Target 已实现。

### P0 首批入口整改
计划主页改 Skill仓库 / 我的计划，默认我的计划；删除主页旧模板目录和 productTemplateKey 新建传参，新建继续自然语言 chat?mode=plan。Skill 仓库明确待接入，不冒充旧模板已迁 Skill；历史路由、模板引用与执行合同保留。清单见 docs/current/P0_AUTHORITY_CLEANUP.md。mobile typecheck 通过；信息架构/导航 2 文件 9 项测试通过；diff check 通过。尚未构建安装 APK，无本批真机 Evidence；P0 overall 仍 Pending，P1 故障矩阵未新增验收。

### P0 Phase 1 CLOSED — 2026-10-07
依赖分类与 docs/current 口径收尾完成；最终 dev=false APK 已安装真机。Skill 待接入、我的计划筛选、+ 到自然语言计划会话、实际模型 PLAN_DRAFT、旧 Plan 详情与版本不变均已核对。mobile 56 文件/340 项、全仓 typecheck 8/8 通过。详情及失败打包记录见 docs/current/P0_AUTHORITY_CLEANUP.md。本阶段关闭不代表 P6 迁资产或 P1 故障矩阵关闭；主力回 P1 reliability。

## 2026-10-07 Plan 控制页真实投影 checkpoint
用户指定九项详情整改已实现并安装真机：短 Goal 标题、次级安全操作菜单、timezone-aware 时间、匹配冻结 FactDemand 的真实 Truth、中文 Verification、实际执行资源、真实来源、分页运行记录、独立设置/判断依据。详情及测试/Evidence见 docs/current/PLAN_CONTROL_SURFACE.md。现有 PlanVersion/Runtime/Truth authority 不变，无新增外部副作用。本 checkpoint 不等于 P4 整体封版；接下来回 P1 reliability，P6 Registry 不提前打开。

Plan 控制页最终合同 hash guard：39 项测试及 API build 通过；部署后真实 Truth/count、VERIFIED write、10/8 10:38 NEXT WAIT、手动写重放禁用复核通过，PlanVersion hash 未变化。

2026-10-07 接收用户 Skill仓库最终设计：Repository 与 Entry 分离、0～N Entry 可选组合、不可变 EntryRevision 与 PlanSkillReference、GitHub commit同步和不可信内容边界，已冻结 docs/current/SKILL_REPOSITORY_DESIGN.md。仅文档合同，无 Registry/同步/运行完成宣称；继续 P1 fault matrix。

## 2026-10-07 P1 fault acceptance started / Plan Detail frozen
Plan Detail 主体冻结；本批只修 runtime 真实语义。实际新建验收 Plan 暴露 draft→ready 入口被菜单遗漏，已补回 canonical allowed transition，不改状态机/PlanVersion。手机新 APK 已安装；mobile typecheck、22项runner/result/presenter测试、API 17项write/epoch/replay合同测试通过。APK build successful，失败打包诊断保留。

复用 event8 response-loss/App restart/journal replay 和 event9 committed-result Worker restart Evidence；只证明各自 scope，独立 ACK-loss/offline/stale-epoch/unknown仍 Pending。正式矩阵见 docs/current/P1_FAULT_ACCEPTANCE.md。

第一轮真实 UI Plan `01a11511-16c4-7192-95b1-b0343b456e63` 原定14:44，因free active-plan limit及合法状态准备步骤，实际activation在14:44:09.845；不记为严格pre-due验收，已通过canonical status暂停并保留。为容量暂停的旧验收Plan `01a10cef-864c-708d-b71e-2293a9a0e545` 保留版本和event7/8证据，没有修改套餐/authority。

第二轮真实AI→UI确认→apply→ready→active：Plan `01a1151d-2abf-75ae-9ee8-83f9dcc15741`，PlanVersion `01a1151d-2ac1-76b9-9244-69a539cf34e6`，14:53 Asia/Shanghai到点，14:48已ACTIVE。实际pm撤销WRITE_CALENDAR；签名manifest证明userGrant=true/systemPermission=DENIED，calendar.read仍AVAILABLE。到点前执行/Task/Invocation均为空，无Calendar标题事项；尚未到点时只记Pending，不把无副作用提前记为验收成功。证据前缀v83-p1-fault-permission-r2。

R2实际恢复：APK更新安装自动恢复同组WRITE_CALENDAR，15:00原wake自动转审批；手机实际批准后event10回读VERIFIED、Ledger/ACK、post-write COMPLETE→Replan WAIT/10月8日14:53均完成，随后暂停验收Plan。此权限恢复来自OS安装行为，不改写成人为授权。修复后权限缺口UI尚待R3真实验证。R3真实模型输出Plan名称超过120字符，被PLANNER_OUTPUT_INVALID fail-closed，无Plan/执行；保持合同不放宽，实际UI补充短名称重试。

2026-10-07 P1故障验收运行更新：R2实际event10已创建/read-back VERIFIED，两Ledger/ACK完成，post-write Assessment COMPLETE、NEXT WAIT=2026-10-08T06:53:00Z；无新wake/逻辑运行。APK更新引起WRITE_CALENDAR同组权限恢复，原pending WAITING_RESOURCE自动续同wake审批，明确保留OS恢复来源。R2完成后通过canonical status暂停，防止每日验收重复。

Runtime缺口产品投影修正已部署：Todos读取当前ACTIVE PlanVersion的pending WAITING_RESOURCE→EXCEPTION；暂停/旧版本/已dispatch不显示旧缺口；PlanStateAssessment呈BLOCKED/CONNECT_RESOURCE，审批和核对优先级保留。零Truth/Runtime写操作。15项真实DB合同回归及22项mobile回归通过，API build、全仓typecheck8/8通过；最终APK hash 57E99D97DC2E41AF3E3790827FD9E9808B6B9D35BBC6A2D0D0A5392A2E259193，已安装。

R3两次真实PLANNER_OUTPUT_INVALID因模型summary被用作name超过120字。保持Plan校验，修受控Recipe标题投影：长摘要保留Goal.description、name用已支持日历动作短标题；Scenario、source、capability、futureTime/approval合同不变。11项Recipe测试和15项DB确认回归通过，API部署。实际同会话重新请求未来15:19后生成合法Draft并由UI确认，Plan 01a11535-4316-74a8-b971-6f80f220c7a3；等待真正到点证明权限缺口UI。先前15:13未创建Plan的Proposal拒绝不算Runtime故障。

已发现历史approval摘要仍把calendar.event.create的legacy publish显示成发布内容；不重写已冻结审批，记真实语义修正待办，不冒称已修。

### 2026-10-07 permission revoke：REAL_VERIFIED（R3）
真实UI生成/确认/提前ACTIVE，15:19自动触发，READ_CALENDAR有效、WRITE_CALENDAR真实DENIED/userGrant=true。实际native read→fresh Truth→NBA EXECUTE，原wake `01a1153a-ec34-76bf-93f0-1a629d20ff53`停WAITING_RESOURCE。没有write Invocation/DeviceTask/Approval；真实CalendarProvider查询无R3标题。现有attention只读投影生成一个resource-wait事项；真机日程15:20截图/XML确实位于“需要你处理”，work-item assessment=BLOCKED/CONNECT_RESOURCE。没有手工scheduler tick、Plan/Truth注入或freshness放宽。
证据：`artifacts/v83-p1-fault-permission-r3-due.json`、`...r3-resources-due.json`、`...r3-attention.json`、`v83-p0-p1-fault-permission-r3-schedule-attention.png/xml`、`...r3-events-before.txt`。15:20后通过真实OS授权命令恢复WRITE_CALENDAR，等待原wake自动续审批；尚未因此把offline/stale-epoch/unknown等组标记通过。

### 2026-10-07 R3 event11 / real ACK-loss recovery
R3原wake权限恢复后自动续同一审批；手机批准后App停止/API断连，Task PENDING/attempt0、Target OFFLINE、Runtime WAITING_DEVICE。实际Worker重启后同一write Invocation/Task保留，无事项。恢复App后同Invocation创建event11并read-back VERIFIED，write attempt1。真实ACK在upstream201提交后丢弃响应，App重启重传相同ACK hash；单一event11，无重复副作用。post-write COMPLETE→Replan→WAIT，nextRunAt=2026-10-08T07:19:00Z。完成后canonical暂停验收Plan，历史版本/Evidence保留。
证据：artifacts/v83-p1-fault-r3-final.json、v83-p1-r3-real-ack-loss.json、v83-p1-fault-r3-offline-runtime.json、v83-p1-fault-r3-after-worker-restart-runtime.json、v83-p1-fault-permission-r3-events-verified.txt。离线只发生scheduled write dispatch阶段，不能替代initial due-offline；lease expiry/mid-executor、stale epoch、OUTCOME_UNKNOWN仍Pending，P1 OPEN。

只读追踪确认Runner未调用设备heartbeat；仅资源页query发送，claim heartbeat不更新设备presence。修Runner idle polling使用现有签名heartbeatDevice，失败停止本轮poll/claim，未改变lease、epoch、Result或执行权威。25项runner/client/storage测试通过；尚未部署此修正APK，真机presence验收Pending。

### 2026-10-07 heartbeat fix 真机安装
安装 APK SHA256 `1AFC3FD14D5174FA73EAF1190A499FDD34E712775EA51E7352E36C7C771E6F6E`。在日程页空闲、未打开资源页，read-only服务端样本07:54:28Z/07:54:54Z均ONLINE，lastSeen从07:54:24.492Z推进至07:54:54.528Z，authorityEpoch保持13。设备心跳由空闲Runner续期，不是collector或资源页发送。第三样本07:55:34Z在会话创建流程、尚无Task执行时继续ONLINE；scope与前两样本分开。证据artifacts/v83-p1-heartbeat-idle-1.json、-2.json、-3.json、v83-p0-p1-heartbeat-idle.png/xml。初轮bundle入口路径解析失败保留v83-p1-heartbeat-bundle.log，重打包成功日志bundle-retry/apk-final。heartbeat真机项REAL_VERIFIED；P1仍OPEN。

### 2026-10-07 initial due-offline：event12 修复后 REAL_VERIFIED
Plan `01a1155c-abd7-71ed-a7df-d91724750de1`，PlanVersion `01a1155c-abda-705b-be31-b2262e2fa42a`，15:57已ACTIVE、15:58停止App并移除API reverse。16:03真实到点：Target OFFLINE，Calendar无事项，Scheduler记pending NO_SUPPORTED_ACQUISITION_DISPATCH，但无read Task；16:04恢复ONLINE后仍无Task。确认原代码只扫描due minute，source不可用尚未入队的slot丢失；不能把此修复前行为记为通过。

修正仅恢复已有scheduler/system pending receipt记录的已观察slot：重新核对当前ACTIVE/owned PlanVersion、frozen trigger cron/timezone/firstRunAt、原correlation identity；继续由SourceResolver验证当前source，原acquisitionKey生成同一幂等Task。已有成功dispatch receipt排除重复恢复；暂停/新版本不匹配不恢复；Audit只追加不修改，无Plan/Truth注入/手工tick，无freshness放宽。首轮隔离测试试图更新Audit被append-only保护拒绝，失败日志保留；改为隔离追加时钟fixture后13项native-write集成、13项slot/timezone测试通过，API typecheck/build通过。

新Worker PID13628自动恢复真实16:03slot：唯一read Task `a289c645-96e2-5d88-8064-7320532978aa`，payload scheduledAt=2026-10-07T08:03:00Z；真机read→VERIFIED/ACK→fresh Truth→NBA EXECUTE→手机UI审批→同逻辑运行write Invocation/Task `01a1156b-af76-728f-a9d1-3f60b5fd90a0`→真实event12→read-back VERIFIED→Ledger/ACK。post-write COMPLETE→Replan WAIT，nextRunAt=2026-10-08T08:03:00Z。仅一个event12、一个write Task、一个Execution。16:14真实最终Ledger两个ACK后canonical暂停验收Plan，版本保留。

证据：artifacts/v83-p1-initial-offline-authoring.json、activation-check/last-before-due/due/target-due/events-due/restored-after-minute/after-worker-recovery/final.json、v83-p1-initial-offline-events-written.txt、v83-p1-initial-offline-paused.json、v83-p0-p1-initial-offline-approval/dialog.xml；构建和测试日志v83-p1-initial-offline-contract.log（首次拒绝保留）、contract-retry.log、api-build.log、v83-p1-observed-schedule-unit.log。P1 overall仍OPEN，stale epoch与OUTCOME_UNKNOWN待真机。

### 2026-10-07 17:04 continuation checkpoint
恢复时实际时间17:02，stale epoch原16:23仍仅Draft、无Plan，不能当成scheduler/runtime验收。API/Execution/Outbox原进程已停止，已恢复PID17236/32728/4144、正式OTP刷新只用于collector，手机API reverse恢复。真实会话拟重新描述未来首次时间；手机锁屏/AOD，UI未能发送，故revised-authoring文件只是未提交意图，不代表合法Proposal或Plan。已提示用户解锁；不后台confirm、不插Plan、不手工tick。heartbeat及event12既有真实Evidence保留，stale epoch/OUTCOME_UNKNOWN仍Pending，P1 OPEN。

### 2026-10-07 stale authority epoch：REAL_VERIFIED（R2 core fencing）
16:23旧Draft未确认，恢复后18:42真实UI重试MODEL_UNAVAILABLE未创建Plan；第二次模型恢复18:43合法创建，故障代理未命中，实际event13正常VERIFIED/ACK/NEXT WAIT，canonical暂停；event13绝不计stale epoch验收。新网络连接重建后代理真实看到签名poll，R2正常AI/Draft/UI创建Plan `01a115fd-eb6a-771e-ae2d-4dd957458c29`、18:53 ACTIVE、18:54真正到点，read/Truth/NBA EXECUTE→UI批准。服务器claim写Task/Invocation `01a115ff-e962-710b-be12-06c9ccdd621b` epoch13成功，代理丢claim回复并停止App，真实日历无R2事项；实际lease到期恢复PENDING。OS撤销WRITE_CALENDAR→签名manifest epoch14，实际旧任务claim409 STALE_NATIVE_AUTHORITY；恢复权限GRANTED/AVAILABLE→epoch15，旧epoch13任务仍409。未生成write Result/Truth或事项，PlanVersion不变。实际event13 retained Result delivery在epoch15下409 STALE_AUTHORITY_EPOCH。R2验收Plancanonical暂停，WRITE权限已恢复，reverse正常3001，代理停止，Evidence保留。
证据：artifacts/v83-p1-stale-epoch-r2-real-fence.json、target-revoked/restored.json、resources-revoked/restored.json、events-claimed/restored.txt、old-result-fenced.json、final.json、paused.json、active-before-due/due.json。500中间claim响应不计fence通过，另做duplicate-active-claim隔离回归核查，不能隐藏。fenced旧PENDING task暴露runner首项饥饿，小修只对403/409跳至下一任务；网络/auth失败不扩散，当前任务仍server claim authority。26项mobile回归通过，正在打包验证。

### 2026-10-07 OUTCOME_UNKNOWN：event14 REAL_VERIFIED → NEEDS_USER
正常UI/AI确认Plan `01a1160a-e850-70f7-8372-32995526aa03`、版本 `01a1160a-e853-76af-b48e-709a232f7791`，19:07已ACTIVE，19:10实际到点→真实read VERIFIED/ACK→fresh Truth→NBA EXECUTE→UI批准。新Runner在旧stale PENDING task仍存在时继续完成本次read，验证公平性修正真机通过。最终安装APK SHA256 7F3F4EA81750A31327DE5E3597118C9B2A76E2437AB8180868F7EE5EF4133679。

使用标准JDWP debugger（无生产fault入口）暂停CalendarInvocationExecutor首次readback方法，真实event14已插入；仅对该唯一测试event/operation marker用Android CalendarProvider实际修改title为external edit。移除断点/恢复后，原Executor真实readback matched=false/OUTCOME_UNKNOWN，服务器独立对比。Result不伪造、不注入DB，不重跑原写。初次complete瞬态500保留日志；原retained result自动重传后成功进入operation outcome_unknown、attempt1、providerOperationId14、Verification、Result Ledger OUTCOME_UNKNOWN并ACK。

已有Reconciliation创建lookupOnly Task，复用同Invocation `01a1160e-794c-7075-9d7e-1ecb27eff96b`及operation marker只读查询；真实回查仍mismatch→case `01a11610-8540-7041-8f2c-418e0cf0dd1f` NEEDS_USER/attempt1。Plan continuation=OUTCOME_UNKNOWN/NBA RECONCILE/nextRunAt null，未误报VERIFIED或NEXT WAIT。真机执行/结果回查页实际显示「结果待确认」「需要你核实实际结果」「只读回查、不重发」。19:20只读CalendarProvider按operation marker查询仅event14；original write Task1 + lookupOnly Task1不能混写为重复副作用。

证据：artifacts/v83-p1-outcome-unknown-authoring/pre-due/due/approved/initial-unknown/error-state/final.json、real-edit.json、event14-final.txt；v83-p0-p1-outcome-unknown-result-ready/reconciliation-ui.png/xml。canonical暂停验收Plan保留NEEDS_USERcase与真实event14，未删除/伪造成功。JDWP断点已移除、调试器退出、adb forward5005移除；本地Node exception observer只读分类未捕获到复现，debug inspector已关闭，不修改生产error过滤，不打印原始SQL/stack/token。整体P1仍需核对既定approval timeout/pause/version替换等条目，未新增矩阵。

### 2026-10-07 final fixed-matrix checkpoint
heartbeat、initial due-offline/event12、stale epoch R2、OUTCOME_UNKNOWN/event14→NEEDS_USER均已有真实Evidence。Result/response loss与ACK-loss分开记账。P1尚未CLOSED，继续原台账已定义approval expiry、pause/end、PlanVersion replacement，未扩新fault case。19:28真实到点Plan 01a1161c-3862-727e-be05-aea254960bf8，v1 01a1161c-3863-7373-a00e-77c36380664c，Execution 01a1161e-e894-711b-b1d1-150bda450f59，Approval 01a1161e-e941-742a-aa9c-9829c846c140真实expiresAt=2026-10-07T11:43:06.977Z；不批准，等待实际过期，无写事项。通过真实Plan关联会话生成/确认v2 01a11621-b013-72eb-a273-2d58fd7f66af，firstRun19:50；currentVersion v2、activeVersion仍v1、原Execution仍v1。API read-only核对两冻结definitionHash=computedHash，旧hash未改。

审批语义bug小修：future canonical calendar.event.create摘要「将在日历创建事项」替代legacy publish产品标签，风险R3/审批框架/历史审批不可变；14项native-write真实DB隔离合同测试/API build通过。Worker实际重启30728后原waiting Approval/Execution不变、未追加新执行。证据v83-p1-version-authority-before-apply.json、v83-p1-approval-expiry-after-worker-restart.json、v83-p1-calendar-approval-semantics-tests/build.log。此时expiry/pause/version acceptance仍Pending，不提前记通过。

## 2026-10-07 20:05：既定审批过期、暂停与版本替换真实验收

同一真实 Plan `01a1161c-3862-727e-be05-aea254960bf8`：v1 在19:28自动触发，未批准的审批于19:43真实过期，无 write Task/事件，terminal Result UNVERIFIED/ACK；v2 在19:50到点前由真实UI暂停，跨过完整触发分钟无 acquisition/Invocation/Execution；v3 由关联会话真实AI Draft、UI确认、启用/恢复后于20:02自动调度，无run-once或数据库注入。

v3 Execution `01a1163e-1c94-75d7-a02a-23c356014630`、Invocation `01a1163e-1ce2-71cd-b9b1-3ccb6673103b`。手机实际两层审批确认后创建唯一event15（P1 Version Resume 20261007，20:22–20:32），read-back VERIFIED，Result `01a11640-341c-74f0-9485-9af045c56b30`，ACK 12:04:39.669Z；真实post-write Truth/Assessment COMPLETE→Replan→WAITING_NEXT_SCHEDULE，nextRunAt `2026-10-08T12:02:00Z`（北京时间20:02）。旧Execution仍绑定v1，新Execution绑定v3，无v2执行，三个frozen hash与computed hash不变。新审批摘要真实显示“将在日历创建事项（风险 R3）”。验收后真实UI暂停Plan，保留事件、版本及Evidence。

证据：artifacts/v83-p1-approval-expiry-after-real-deadline.json、v83-p1-version-pause-actual-due.json、v83-p1-version-pause-due-worker-ready.json、v83-p1-v3-actual-due.json、v83-p1-v3-final-first.json、v83-p1-v3-authority-after-complete.json、v83-p1-v3-event15-read.txt、v83-p1-v3-paused-confirmed.json，以及v83-p0-p1-v3-*截图/XML。

P1仍OPEN：固定矩阵Worker/App项尚为PARTIAL_REAL，需明确lease expiry/mid-executor恢复接受范围并取得对应证据；不得把已证实的queued/pre-write或committed-result重启扩大成所有执行中崩溃通过。不新增故障范围，P2尚未开工。stale/unknown期间瞬态500根因仍未确认，不冒称修复。实际Plan详情仍显示旧v1失败待处理、英文失败摘要以及“每天20:2”；记作产品语义缺口，不修改历史运行权威或Evidence。

## 2026-10-07 P1-L1：中断恢复 / lease authority 审计
读取用户最新P1-L1–L8指令，范围冻结为Worker/App interruption+lease recovery；不重跑已验event15/ACK loss，不扩UI/Skill/Target。审计见docs/current/P1_LEASE_RECOVERY_AUDIT.md。

发现并修正ExecutionLeaseService.heartbeat只核对token、允许过期但未接管holder自行renew的缺口：新增leaseExpiresAt>now及合法执行状态条件。API build通过；隔离DB+独立Redis prefix下执行回归33/33通过，新增自然lease过期/旧holder拒绝/新owner接管/旧token fencing/终态不可renew。日志artifacts/v83-p1-lease-regression-natural-takeover.log。早期构建未结束及provider身份/共享队列失败与后续通过分记。

此为自动测试，不是真机L2–L6证明。当前运行服务尚未重启加载修正；真实Worker crash、App RUNNING process death、OS insert/receipt commit-gap、同Invocation只读恢复及stale holder边界仍Pending。DeviceTask过期PENDING依赖native PREPARED防重写，必须实际验证；不凭代码/测试关闭P1。P1 OPEN，P2未开始。

## 2026-10-07 21:10 P1-L真实进展（仍OPEN）
已部署Execution lease过期token拒绝修正。v4真实20:35调度Execution 01a1165c-4e24-7298-9f33-a02634a9cd95，Worker32616在running/pre-effect边界被标准debugger暂停，lease自然过期；Worker14004实际takeover=true/attempt2，进入同Execution审批。旧holder恢复后Runner heartbeat拒绝继续，未派发第二operation。证据v83-p1-lease-worker-interruption.json、lease-expired-state.json、old-worker-resumed-state.json；这不是旧token complete/任意terminal transition的全面验证。

v4手机在CalendarInvocationExecutor line124、PREPARED前真实暂停，无测试event；实际force-stop；lease过期同Task恢复后再次执行，line138真实暂停在insert后的首次readback前，已存在唯一event16，journal PREPARED/无Result。再次force-stop后手机意外自动恢复（PID24184），先于新Outbox部署沿旧路径只读回查成功，VERIFIED/ACK/post-write WAIT。event16不能记为新OUTCOME_UNKNOWN恢复验收。证据lease-app-precommit-paused.json、lease-app-dead-beforecommit-state.json、lease-app-commitgap-paused.json、commitgap-native-journal.xml、commitgap-event-before-kill.txt、lease-event16-final.json。

新代码：write lease过期不重派原写Task，进入OUTCOME_UNKNOWN与既有case/lookupOnly；兼容恢复旧LEASE_EXPIRED_RECOVERY任务。resolved case continuation新增append-only PERSISTENT_PLAN_RECONCILIATION_REEVALUATED，验证case/verification hash/lookupTask/Truth，不改原unknown Ledger或历史Execution。API build与14项native-write回归通过；新增expiry→lookupOnly→resolved、原Task不改回成功回归正在运行。此continuation尚无真机成功证据。

v5真实20:52调度Execution 01a1166b-e318-72d9-9f05-33768c762ace，Worker14004实际进程终止；lease自然过期后Worker18408在12:53:33Z真实takeover=true/attempt2，同Execution等待审批，无第二写Invocation。证据lease-worker-real-crash-before.json、worker-real-kill-time.txt、worker-real-takeover.json。未完成UI审批（详情内卡片未导航，后手机锁屏）；审批13:08:33Z真实过期，Execution安全失败，未生成writeTask，未进入event17/新commit-gap。证据v5-current-terminal.json，不冒称整轮通过。

当前API3300、Worker18408、Outbox31740加载本轮build；真实手机锁屏，等待用户解锁后走合法同Plan的新版本未来schedule，不恢复过期审批、不run-once。调试observer已停止/adb forward8700移除。P1仍OPEN：显式stale holder拒绝证据范围、新commit-gap→case VERIFIED→Truth→reassessment WAIT真机验收待完成。precommit safe-resume不能靠server猜测未写入；超lease且缺可信not-started证明保持unknown。P2/UI/Skill/Provider/MCP未进入。

## 21:30 P1-L checkpoint — 不关闭
用户解锁后同Plan通过真实UI创建/确认/启用v6，21:24 Scheduler自动运行，新审批01a11689-0f81-73fe-be1f-bbfd0dbebc6c已实际双层UI批准。Execution01a11689-0e84-7739-89cb-35f1b6539039；首次故障操作时Task仍PENDING、没有事件/未命中断点，提前force-stop不计commit-gap。随后JDWP重连handshake失败，Task正常成功并产生唯一外部事项；新OUTCOME_UNKNOWN/lookup-only continuation仍无真机证据，不能记为通过。证据v83-p1-r2-final-not-commitgap.json、r2-events-final.txt、lease-r2-stopped-state.json及debugger日志。调试进程/forward已清理；真实UI暂停验收Plan防次日写入。

新增expiry→lookup-only→RESOLVED回归14/14通过（v83-p1-expiry-lookup-regression.log），原Task保持FAILED/resultHash null，不改历史结果。新resolved-case continuation代码已部署，尚缺真实case Truth消费和nextWAIT证明。P1保持OPEN；后续只补既定commit-gap以及stale holder terminal/dispatch显式拒绝边界，禁止P2/UI/Skill/Provider/MCP。此前v5真实Worker死亡takeover证据继续有效，v4 precommit/旧路径event16证据保留且不换口径。

## 2026-10-07 22:08 P1 Final：B/C REAL_VERIFIED，A仍Pending
A审计发现ExecutionStateService终态转换缺少Runner lease owner事务校验。新增execution-owner-context仅携带现有token，Worker运行上下文内Execution/Step转换行锁核对token+expiry，Android Native prepare事务也核对；不改外部Outbox/Approval权威。build与33/33执行回归通过，包括旧owner终态STALE_EXECUTION_LEASE。已部署Worker。真实v7新holder takeover后原token探针失败（Debugger Runtime.awaitPromise Could not find promise with given id），不当作拒绝证据。A仍REAL_PENDING。

B/C：同Plan v7 21:52真实scheduler，Execution01a116a2-dbcb-72b6-b7bd-1369dc9e5381，Invocation01a116a2-dc1c-771d-8062-7992777cd3c9，真实UI审批。CalendarExecutor line138命中：唯一event18已insert，PREPARED持久化，Result尚未持久化，实际force-stop。现有Outbox自然lease expiry→原writeTask FAILED/OUTCOME_UNKNOWN，没有重派create；Case01a116a9-c862-7791-90cf-f7cbe0b825bf→lookupOnly Task→真实回读event18→Verification/Reality/Truth→RESOLVED/SUCCEEDED。手机系统随后自动重启PID23994，回查按现有Runner自然完成，不人工插结果。

原Result01a116a9-c888-7018-8a61-65be47cdba81、hash3b8aaf700c7365c9e552b782b9a26c3c1941203f2103c9e99b0884749adb5f7e始终OUTCOME_UNKNOWN，ACK14:01:04Z；历史Execution failed不改写。resolved continuation首次因错读cron而COMPLETED_RUN，无nextRunAt，真实发现并修复为cronExpression；保留错误checkpoint，Worker部署后自然追加WAITING_NEXT_SCHEDULE、nextRunAt2026-10-08T13:52Z（北京时间21:52），post-write Assessment COMPLETE与真实Truth ref。未修改旧Ledger/版本/Evidence。B/C REAL_VERIFIED（修复后恢复范围）；P1 OPEN，仅A显式旧token终态拒绝证据仍Pending。

证据：v83-p1-final-r3-commitgap-paused.json、commitgap-real-event.txt、native-journal-at-gap.xml、dispatch-state.json、original-unknown-ledger.json、v83-p1-event18-reconciliation-next-wait.json、event18-original-ledger-retained.json、event18-after-reconciliation.txt。自动测试33/33、14/14与真机分记。后续不扩故障/UI/Skill/Target，不进入P2。


### 2026-10-07 22:35 P1 final closure — stale holder REAL_VERIFIED

P1 = CLOSED。既定 fault matrix 冻结，Calendar reliability 验收线结束；当前主线切换 P2 Internal Schedule / USER_EVENT，不提前开展 Skill、Provider/MCP 或新增 UI。

同一真实 Plan `01a1161c-3862-727e-be05-aea254960bf8` 的 v8 经真机自然语言草稿、用户确认/启用，22:25 真实 scheduler 触发。Execution `01a116c0-fbe4-76de-a0bc-1773f01bdfaa`、PlanVersion `01a116bb-e817-76bf-ab5b-4d43b5b1402e`。标准 Node inspector 在原 Worker32808 的 pre-side-effect 边界捕获真实 token（仅内存保留、证据只存 SHA256），未注入数据库、任务或 Result。

原 lease 14:25:08.727Z → 14:25:38.727Z 自然过期。Replacement Worker32112 14:30:53Z 对同 Execution takeover=true/attempt2，进入 WAITING_APPROVAL 后按既有协议释放 lease。本轮不审批写入，未生成该标题的 write Task。

原 Worker 的实际 token 续租返回 false；通过现有 ExecutionStateService.transition 与 executionOwnerContext 分别尝试 failed、succeeded，均真实抛出 ConflictException 409 / STALE_EXECUTION_LEASE。属于真实部署服务方法探针，不宣称经不存在的 HTTP terminal endpoint 发送；Worker terminal transition 正是 Ledger capture 的入口，未增加生产后门。

拒绝前后 Plan、Execution/lease owner、Invocation、DeviceTask、steps/attempt相关状态、Result Ledger/verificationState、operations/cases、回读 Truth 及 Audit 一致。恢复旧 Runner 追加一条 conditions_met 过程事件；初次完整比较因此 pass=false，原证据保留，复核确认无 authority/terminal/result/Truth mutation 后 reviewed comparison pass=true。不能把该过程事件描述成完全没有任何新日志。

证据：artifacts/v83-p1-a-ownership-real.json；v83-p1-a-old-owner-expired.json；v83-p1-a-after-takeover.json（早于实际takeover，保留为观察中样本）；v83-p1-a-takeover-worker-real.log；v83-p1-a-before/after-stale-request-authority.json 与 lease.json；v83-p1-a-stale-fence-authority-comparison.json（初次差异）；v83-p1-a-stale-fence-reviewed-comparison.json（复核通过）；v83-p1-a-paused-final-verified.json（UI暂停已服务端确认）。B/C event18 evidence、原 OUTCOME_UNKNOWN Ledger 与次日21:52 WAIT 保留不动。

关闭依据：既有 Worker death/natural takeover + 本轮真实 stale-terminal fencing + event18 commit-gap/lookup-only/verified Truth/resolved continuation/WAIT + 同 Invocation 无重复副作用 + unknown Ledger不可变。原33/33执行合同及14/14写入恢复回归保留，本轮未修改生产代码，未用自动测试替代真实拒绝证据。


### 2026-10-07 23:40 P2 phase 1 — internal USER_EVENT REAL_VERIFIED

复用 recurring_item_profiles，新增严格 USER_EVENT_DRAFT/用户确认、owner/version fencing、编辑/延后/完成/取消、时区/offset合同、现有ScheduleProjection和Outbox到点站内提醒；无新表或第二套Plan/CalendarEngine。

真实AI/UI确认事项01a116e9-ead3-753f-ae35-3aa827a60f0b，23:16真实到点，通知15:16:00.429Z提交，延后23:32后完成v3，跨过延后时间仍仅原归档通知1。第二事项01a116f3-98f0-745a-aae1-ad7647fcf925真实解析“明天下午3点”为10月8日15:00，编辑15:30/提醒15:15 v2后取消v3，无通知。旧包全角日期编辑失败样本保留，NFKC修复新包真机复验成功。两事项均已结束。

第一条正常链截至23:17无新Calendar Invocation/Task。23:24既有独立Plan01a111cc-7e0b-74e9-92d6-b85e7b837c62自动read，已通过Task planWakeup追溯，不来自P2。全验收期间新增calendar.event.create/原生日历create Task为0，CalendarProvider ID/title前后最终快照相同（不声称全部字段核验）。

最终后端16项、共享合同4项、移动端时间规范化3项及既有投影验证通过；API build/typecheck、Mobile typecheck、APK构建通过且新包安装，SHA256 D98FC41F29247FE7E7C69785B044612D8F1BE53BC82E14401FA5CC35D23F56DA。总证据artifacts/v83-p2-internal-reminder-acceptance.json，合同docs/current/P2_USER_EVENT.md。

第一阶段REAL_VERIFIED仅指持久化站内通知，不宣称Android OS push。显式外部同步尚未实现，当前安全澄清；P2整体IN_PROGRESS，P1保持CLOSED，不进入P3/Skill/Provider/MCP。


### 2026-10-08 统一设计基线冻结

用户提供P1 Closed / P2 Phase 1 Verified统一模型，已收口至docs/current/V83_UNIFIED_BASELINE.md：Goal生命周期Temporary/USER_EVENT/Persistent与执行模式分开，Context仅派生，Skill0～N，ScheduleProjection无调度权威。P2下一批显式同步复用现有Runtime；内部编辑/延后/取消先按内部合同生效，外部update/取消建议走Risk/Approval，完成不默认删除外部事件。Link/同步能力当前仍设计未实现，不将文档冻结当作部署或真实验收。本次仅文档变更，P1/Evidence保持原样，未重跑代码测试或进入P3/UI/Skill。


### 2026-10-08 P2 Phase 2 合同首批

新增user-event-sync.ts：显式Sync Intent、独立identity Link、owner/version核验、create/update/cancel建议、完成不默认删除、in-flight等待、unknown优先Reconciliation。合计10项共享合同测试通过，plan-schema typecheck通过。仅合同实现，未接Planner/持久化/部署或真机，不把引用字段存在当Truth证明。

审计发现既有Execution/ActionIntent/Invocation及Native authority强依赖PlanVersion，ConversationOnce创建ONCE Plan不符合USER_EVENT独立权威；需在同一Runtime补受控非Plan来源绑定，不建立第二套Runtime或伪Calendar Plan。详见docs/current/P2_EXTERNAL_SYNC.md。P2仍IN_PROGRESS，显式同步仍安全澄清，P1保持CLOSED。


### 2026-10-08 Runtime多受控Authority Source首批

按用户澄清：Runtime由多个受控Authority Source驱动，Plan仍为长期来源，不为USER_EVENT绕过Runtime。新增严格PLAN/USER_EVENT_SYNC source合同；0082同步确认请求表与冻结hash、幂等服务；RuntimeAuthorityService事务校验owner/version/合同/内部输入，原NativeCalendarRuntime的Plan检查已接此统一门。取消/编辑/撤销拒绝write，原冻结请求仍支持只读reconciliation；不代替Target/Approval/lease权威。

数据库/plan-schema构建及API typecheck/build通过；共享合同12项，隔离数据库Authority6项通过，原native write14项通过。0082仅迁移隔离*_test数据库，真实服务未重启部署。尚未贯穿Execution/ActionIntent/Resolver/Runner非Plan来源，Planner外部sync仍澄清；不得宣称Runtime多来源端到端或P2 Phase2 REAL_VERIFIED。下一批继续同一Runtime约束收口，P1保持CLOSED。


## 2026-10-08 P2 — multi-authority-source Runtime / source continuation

- 既有Runtime受控支持PLAN和USER_EVENT_SYNC。非Plan空引用由共享合同、DB CHECK及owner/version/contractHash gate约束；不创建假的Plan/PlanVersion，不添加调度器。
- Dispatcher/Resolver/Risk/Approval/Invocation/Runner/NativeDeviceTask复用原执行与恢复链。WRITE校验最新事项；RECONCILE仅消费旧请求现实结果。
- 新RuntimeSourceContinuationService消费committed Ledger + Verification + server-owned Truth；unknown必须RESOLVED case。独立resultProjectionJson记录外部identity及原版本，内部编辑/取消产生CHANGE_PENDING/CANCEL_PENDING，不自动改写外部，不改变原unknown Ledger。
- 0083/0084只应用隔离*_test数据库。生产DB/API/Worker未升级；Planner公开同步入口仍CLARIFICATION_REQUIRED。
- 自动验证：4套API集成27/27（多来源3、authority6、原native write14、内部USER_EVENT4）；共享5套22/22；API和Mobile typecheck通过。多来源覆盖签名collector、取消后lookup与原unknown保留、来源交接恢复和重放幂等。均非真机Calendar副作用证据。
- 证据：artifacts/v83-p2-multiauthority-regression.log、v83-p2-source-shared-regression.log、v83-p2-source-api-typecheck.log、v83-p2-source-mobile-typecheck.log。
- P1保持CLOSED；P2 Phase1 REAL_VERIFIED、Phase2 IN_PROGRESS。下一步接合法Planner/confirmation入口及真实同步验收，update/cancel策略与permission/offline保护仍待覆盖。


## 2026-10-08 P2.3 real Android source + event19 commit-gap closure

CORE_REAL_VERIFIED，P2未关闭。真实读10项、真实DeepSeek/USER_EVENT_DRAFT、合法UI确认与独立审批；同一Shared Runtime执行无Plan/PlanVersion。event19真实insert后、Result前由标准JDWP命中并force-stop App；自然lease expiry→OUTCOME_UNKNOWN；真实Worker/App重启→lookup-only→Verification/Truth→RESOLVED→Link VERIFIED v1/event19。重复重启无第二写/Invocation/现实事件。原unknown Ledger不变，来源交接早于ACK、ACK后来完成。

证据artifacts/v83-p23-real-sync-acceptance-reviewed.json，18项通过；真实event19前后CalendarProvider查询、PREPARED无result native journal、原unknown/server snapshots均保留。首轮旧P2 APK公钥为空Native health UNAVAILABLE导致无执行，修正只靠正确公钥重建APK，没有DB健康注入；过期来源不被当新Truth，早期请求取消但合同保留。

只读产品同步投影已实现/部署：owner隔离，历史syncedVersion与内部currentVersion分开，修改/取消生成未授权建议，update/delete仍NOT_IMPLEMENTED。投影APK C18785A9…安装成功，但手机锁屏/AOD，编辑/取消页面真实校验等用户解锁。P1旧Authority迁移前后7类hash不变；P1保持CLOSED，未新增P1故障/Target/Skill/Provider/MCP。

自动验证API38/38、共享22/22、只读投影增量9/9，API/Mobile类型检查及构建通过。重复来源事件及成功同步后edit/cancel产品验收仍Pending，不以核心链通过冒充P2整体CLOSED。


## 2026-10-08 13:15 P2 版本语义与真实请求重放

真机event19关联事项通过UI延后时间修改v2并取消v3；外部event19保持v1原09:20–09:50，Link/unknown Ledger/Invocation/Verification/Case不变。公开合法confirm/start各重放3次均返回原身份。27项现实复核及重放后的标题唯一性查询已保留：artifacts/v83-p23-event19-lifecycle-reviewed.json与v83-p23-event19-lifecycle-followup-validation.json。未将其冒充标题EDIT或重复Observation/App delivery专项验收。

新增v2 UPDATE/DELETE冻结合同及单对象Android mutation参数；v1无默认字段变化。执行链未接通，明确拒绝编译，不能落入create。共享28项、API拒绝门2项、隔离authority/shared-runtime/native-write回归24项通过；API/共享typecheck及共享build通过。P1 CLOSED，P2 IN_PROGRESS，update/delete未部署，P3等不进入。


## 2026-10-08 P2.4 / P2.5 执行接入 checkpoint（真机未验收）

UPDATE/DELETE已接入现有USER_EVENT_SYNC→Resolver→独立Risk/Approval→Invocation→NativeCalendarRuntimeService→DeviceTask→同一CalendarInvocationExecutor。服务端从旧Link及正式Verification生成变更建议，客户端只提交version/messageId/confirmed；确认冻结v2请求，不接受客户端Target/外部event身份。WRITE对UPDATE要求active/current事项版本，对DELETE仅允许对应cancelled/current版本；历史lookup仍只消费冻结来源。既有create的合同、Task类型和审批不迁移。

外部变更限定同一Target/device/calendar/eventId及上次验证的operation marker；Native UPDATE/DELETE先持久化PREPARED再调用CalendarProvider，已有journal或lookupOnly只读回查，不重新写。更新按标题/时间/时区/新marker回读；删除只在保留提交前合法身份观察时接受缺失证明。删除写独立calendar_event.presence Truth，不虚构日程时间；新Link为DELETED/externalState=ABSENT，旧请求/Verification/unknown Ledger保留。内部COMPLETE不提出外部update/delete。

新增calendar.update/calendar.delete独立grant，android-local-v4清单；旧v2/v3仍接收，但缺失新能力会撤销其旧可执行投影。Resolver按能力对应grant解析，只允许确认的原设备/Target；permission恢复后用当前authority/manifest投影重新解析，同一Sync Request仍唯一Execution。最小目录迁移0085仅注册delete身份及update/delete别名；真实迁移前后7类核心权威hash相同。

隔离API主回归28/28（旧Native14、Authority6、SharedRuntime6、定义编译2）；并发注册修复及来源执行补充7/7，Shared28/28，Mobile Runner19/19、类型检查与API/Shared/Android构建通过。签名collector合同测试覆盖permission拒绝不损坏v2、update与delete未知结果的lookup-only→Truth→Link、原unknown Ledger不改写、COMPLETE不删除。它们不是真机CalendarProvider证据。

首次同时部署时ExecutionWorker因新absence adapter注册竞争退出；已修幂等注册且保留不可变hash核验，补充并发回归通过后重建/重新部署。部署记录artifacts/v83-p24-runtime-deployment-r2.json；保留首次失败记录。新版APK SHA256 BB039F73037AEDFA4B6BA067EE399CD1B50CAF0DBD145062AA8045AB6F076CF7已构建，ADB当前无连接设备，尚未安装。

P2.4/P2.5状态：CODE_IMPLEMENTED / BACKEND_DEPLOYED / REAL_PENDING。真实update/delete、permission/offline/failure隔离及duplicate Source/delivery仍待手机验收；手机缺失不能替代为offline验收证据。event19仍保留既有现实证据；本checkpoint未对它执行新外部变更。P1 CLOSED，P2 IN_PROGRESS，不进入P3。


## 2026-10-08 22:56 P2 最终收口 — CLOSED

指定APK已真机安装；UPDATE保持event20身份、DELETE缺失Verification、permission/offline隔离、UPDATE unknown只读回查、真实签名回执/来源重放、Worker/Outbox/App重启均通过冻结验收。完成仅内部生命周期，原unknown Ledger与历史合同/证明保留。最终[32项真实复核](../artifacts/v83-p24-final-acceptance-reviewed.json)全部通过；[完整验收与限制](current/P2_FINAL_ACCEPTANCE.md)记录真实UI、既有owner协议和JDWP观察的各自范围。

本轮修复UTC自动恢复查询、Drizzle包装重复签名错误500→409、completed回执重放误标CHANGE_PENDING；9项签名权威回归、7项multi-authority集成及API构建通过，修复均部署/对应真路径复验。内部提醒交付仍限定持久化站内通知，Android OS push尚未验收。USER_EVENT/Calendar sync可靠性线冻结，P1 CLOSED、P2 CLOSED；下一主线P3 ResourceGap Auto Resume，本批未开始P3实现。

## 2026-10-09 P3 首批 A Auto Resume 真机收口；Shipment Truth Pending

用户选定京东通知。实际手机临时Conversation `01a11c37-59ce-76ed-9de4-ae5a0e8b87f6` v1中，DeepSeek Planner生成受限`shipment.status`查询、京东package和168h范围；原Goal Message/owner/hash持久化在既有assistant message，复用Outbox恢复及DeviceTask Runner。没有新增Plan/调度器/数据库权威，没有由客户端提交可执行Runtime对象。

授权前WAITING_RESOURCE无Task；当前手机京东来源由真实发现/设备证明/UI确认新增，旧设备连接保持历史。真机暴露监听器connected字段遗漏、消息获取OFF却被健康投影忽略两项问题：补回真实connected、将采集暂停呈现为UNAVAILABLE/明确设置引导；账户切换和撤权清理保留。首次原生采集失败Task `9f083837-a1ce-53e0-8d9f-a95e90528249`始终FAILED/result=null，未伪装成功。

正常UI恢复系统Notification access、本机grant、京东来源许可和消息获取后，同一Goal自动经Outbox/Resolver进入新的有界只读attempt2，Task `b15b69cd-0ad8-58ee-808a-07992d43f293`，实际签名Acquisition `01a11c4c-9436-776e-9ea4-078159670116`=VERIFIED_EMPTY/items0。00:15:43 Asia/Shanghai结果自动回原会话，gap=COMPLETED、唯一最终Message `01a11c4c-977b-725a-9a38-001689416bcb`；无需重新问、未手工补Task或注入Result。App force-stop/reopen仍相同两条读取Task、一个结果；新增Plan/Calendar Invocation/write均0。

原生范围仅active notifications+已授权保留队列，按京东package/时间过滤，不是过去七天完整通知历史。最终答案明确“当前授权应用的通知读取范围内，没有已核实的物流线索。这不能证明没有快递。”Receipts0、truthRefs=[]，不伪造Shipment Truth。A Auto Resume=REAL_VERIFIED；JD Acquisition=EMPTY_READ_VERIFIED；B Shipment Candidate→Truth=REAL_PENDING；P3 Overall=IN_PROGRESS。真实23/23复核及sha证据见[review](../artifacts/v83-p3-auto-resume-acceptance-reviewed.json)，[范围/限制](current/P3_RESOURCE_GAP.md)。未来新到通知不能改写本次已完成空读历史。

API冻结协议6/6、Mobile Executor/Runner27/27分别通过，API/Android构建及Mobile typecheck通过；最终APK SHA256 `8C0E2D115FCB091490ECD463FBC2233F98A4BF4770D82BB203609409407EA7F4`已安装。首次Kotlin构建缺清理方法失败和bundle EBUSY失败日志保留，修正后构建成功。API/ExecutionWorker/OutboxWorker实际部署/ready均200，见P3部署文件。最终只读复核曾因自动审批服务额度暂时不可用被拒绝，随后恢复后正常审查执行，未绕过审批。

本批无SMS/Provider/MCP/Service/UI扩展。未覆盖Persistent Plan ResourceGap和未完成Task的epoch/sourceVersion重新绑定；app.lastSeenAt可由心跳更新不等于新discovery；含Truth时并发撤回/发布事务一致性仍需后续验证。本次空读不含业务Truth，不将这些未验边界宣布关闭。

## 2026-10-09 P3 长期通知Plan资源恢复与旧来源请求fencing真机证据

保留上条临时Goal及完成的VERIFIED_EMPTY历史，新增长期需求经真实DeepSeek→合法CreationDraft→手机UI确认/启动：Plan `01a11e56-22b8-75ba-a888-7ac702815eb3`，唯一v1 `01a11e56-22bc-711c-95ec-c8ef0a53c07c`，合同 `01a11e56-22ec-7395-88fb-1624fd944c59`。冻结来源是当前手机京东连接；仅核实为异常的真实通知线索可以发站内提醒，不虚构运单或完整订单，不把正常/签收当异常，不写日历。

资源不具备时Plan处于WAITING_RESOURCE，不读取。用户经正常UI恢复通知监听器/来源/本机grant后，既有Worker/Resolver自动继续原Plan和版本，无第二次创建或确认。首条真实读取 `a759ff5a-bcd6-576e-85bc-76cf3e50c326` SUCCEEDED/VERIFIED_EMPTY，真实Invocation/Result Ledger VERIFIED，转WAITING_FACT_CHANGE。京东来源UI撤销/恢复改变sourceVersion后，新采集窗口产生 `bd04a04c-0be9-5d33-8829-09cb08611708`，同样实际空读并等待。各窗口只读获得当前授权范围，不追加进临时已完成空读或改写其答案。

复用首条真实**已完成读取**保留的旧holder，通过既有原生签名和正式生产Task端点分别尝试heartbeat、fail、complete：三项各409 `STALE_PLAN_NOTIFICATION_AUTHORITY`，见[sourceVersion拒绝证据](../artifacts/v83-p3-source-fence-probe-real.json)。随后正常UI撤销本机notification.read grant，使authorityEpoch从29→31；当前京东sourceVersion未改变，第二条已完成读取的旧holder在三个同一端点也各409，见[epoch拒绝证据](../artifacts/v83-p3-epoch-fence-probe-real.json)。这证明真实部署的来源/epoch gate阻断旧授权写权；本轮没有在读取执行中kill App/Worker，也没有实际换设备，不将它记为in-flight process death或跨设备rebind证据。

本机grant恢复后epoch33，原Plan同一窗口自动产生attempt2 `ff7e4d21-4fa0-5fb9-8bc0-90c2112b0445`；随后自然下一窗口产生 `3e43a9a4-5458-56f7-8726-0c0ae22e8568`。四条真实Task均SUCCEEDED/VERIFIED_EMPTY，原Plan/v1/合同、历史读取及结果完整保留，旧holder拒绝未污染权威。SELECT-only一致性快照见[原Plan恢复记录](../artifacts/v83-p3-plan-epoch-restored-real.json)。本轮未用DB修改制造Task/Result/Truth，未伪造通知或Shipment事实。

真机暴露Plan Detail仍将真实WAITING_RESOURCE显示为“运行中/到点处理”的状态语义错误；已最小修复既有Control只读投影与页面“当前情况/下一步”两段文字。当前Resolver权限、来源、监听器/采集、在线状态优先于旧读取checkpoint，仅消费owner/currentVersion的冻结来源；暂停/草稿/归档不覆盖。页面现在显示“等待新物流线索”，明确当前范围不能证明没有快递，不展示Runtime/epoch/JSON。独立只读投影fixture7/7与API/Mobile typecheck通过，这些是自动验证，和上述真实证据分别记账；没有布局重构。

API/ExecutionWorker/OutboxWorker closure r3已实际部署，三个health/ready检查200，见[部署记录](../artifacts/v83-p3-closure-runtime-deployment-r3.json)。r5 APK已安装，SHA256 `0DBD0F31BE09C7E80C9F2012F418B1C1320C942F0FDDA94B99A6738394EA17FA`，见[真机安装](../artifacts/v83-p3-closure-apk-install-r5-real.json)。保留前轮部署、构建、安装及失败记录；不把构建/200替代业务验收。

**P1 CLOSED / P2 CLOSED / P3 IN_PROGRESS**。Temporary Auto Resume及长期Plan资源恢复/真实空读WAIT已有真实证据；JD Acquisition仍EMPTY_READ_VERIFIED。用户明确当前无真实京东物流通知，Shipment Candidate→用户核实→Truth、含Truth结果发布一致性、真实Plan Truth→Assessment→异常站内提醒→Replan/WAIT仍REAL_PENDING。合同中的这些正向路径不能替代真机证明，不关闭P3、不扩Calendar/SMS/Provider/MCP/Windows/Service/Skill；Android OS push仍未验收。后续真实物流通知必须进入新查询或新合法采集窗口，不能改写任何已完成的空读历史。

## 2026-10-09 P3 恢复后的证据复核与当前运行状态

离线复核最终57/57 PASS，15份输入hash核对；原临时Goal/失败Task/唯一最终答案不变，长期Plan/v1/合同不变，两类旧holder的heartbeat/fail/complete各409且Task/Invocation/Ledger未污染。原42/46与新增严格Acquisition引用检查55/57失败记录保留。修正为ISO时间/epoch-ms归一及通过后续不可变Invocation的evidenceRefs关联已存在Acquisition；明确ff7e4d21没有自身WAIT，不能借下一窗口3e43a9a4的WAIT补造审计。r5安装后实际为WAITING_RESOURCE/UNKNOWN，四条成功历史读取完整保留。见[最终57项](../artifacts/v83-p3-plan-acceptance-final-reviewed.json)。

中断后API/Worker进程停止、手机会话失效，真实ADB仍连接。恢复同一部署r4后三个health/ready 200；原用户经手机正常验证码登录恢复，不注入Token或修改业务DB。r6仅增加标准Android listener requestRebind尝试，严格系统permission/account grant/acquisition/SDK/未连接门及30秒单调节流，connected/HEALTHY仍只由真实连接回调建立。canonical/generated listener一致，Kotlin构建通过并安装APK SHA256 `3D053C9A6DEA20716953DCD09754718BF5DC200C9D86BCE9DC89D3C4186C437C`。

正常系统连接及京东来源UI恢复后，原Plan/v1在当前window5971716保留attempt1 `cbbfefc4-6193-52e1-8056-93b9918ad065` FAILED/STALE_PLAN_NOTIFICATION_AUTHORITY，自动形成当前sourceVersion/epoch33的attempt2 `76208d59-1a9f-571f-833f-4aadc93c3ef8` SUCCEEDED/VERIFIED_EMPTY，Invocation Ledger VERIFIED，11:03:22 Asia/Shanghai进入本次真实WAIT。前四读取、冻结合同与原临时Goal均保留。当前HEALTHY/GRANTED/grant1，页面准确说明等待新物流且不能证明没有快递；无Receipt/Shipment Truth/异常Execution/通知。

这一轮使用了正常Android权限UI恢复连接，因此标准requestRebind自身只记BUILD_VERIFIED/DEPLOYED，不单独冒充本机自动重绑已REAL_VERIFIED。真实恢复快照/页面/部署见[P3当前状态](current/P3_RESOURCE_GAP.md)及[补充复核](../artifacts/v83-p3-plan-r6-recovery-reviewed.json)。P1/P2 CLOSED，P3 IN_PROGRESS；三个正向Truth待验项仍需真实通知，不扩大矩阵或开始后续模块。

## 2026-10-09 P3 最终关闭范围冻结

用户确认P1/P2 CLOSED、P3 IN_PROGRESS，已有Temporary/Persistent Auto Resume、health/collection、sourceVersion/epoch fencing、历史保留、重启恢复、空读不推断无快递的真实证据保持冻结。P3 DoD剩余仅三条连续真机闭环：真实京东Shipment Candidate→用户核实→Truth；含Truth结果发布前再次检查source permission/sourceVersion/authority epoch及Truth version/revoked state；同一Plan/v1对真实异常Truth完成Assessment→站内提醒→post-result WAIT。

纯自动requestRebind未独立真验的事实继续保留，用户明确其不作为本阶段关闭blocker。不增加ResourceGap类型，不加入SMS/MCP/Windows/Service等Target，不改写旧Task/Result/Ledger或伪造通知。普通物流Truth不强行触发异常提醒；三个既定闭环有真实证据后直接P3=CLOSED并冻结京东通知验收线。本次仅更新验收/主线文档，没有新增真机结果、运行时代码或故障场景。

## 2026-10-09 P0～P11前后端一体化总计划冻结

按用户最新总计划，正式更新 [V83_MAINLINE.md](current/V83_MAINLINE.md)：五个一级页面日程/计划/会话/资源/服务的名称、数量、顺序和职责永久冻结，二三级表面可随阶段完善。新能力只接现有Manifest/Capability/Resolver/Invocation/Shared Runtime/Verification/Truth，不另造Skill/MCP/Service/Scenario/Windows/Agent核心Engine；Goal生命周期与0～N方法、Resource/Service能力分开。

P4～P11统一Backend Capability、Product Surface、Real Evidence三轨同步，每阶段Contract DoD、Runtime DoD、Product DoD、Real Evidence DoD与十一项关闭Gate齐全，真实联调后更新文档/ledger才CLOSED。P3关闭后按P4计划体验→P5Service→P6Skill组合→P7多Target→P8App执行→P9Windows→P10Cloud/Synthesis→P11封版推进；无依赖设计可并行，不先堆完后端再补手机。

新增 [Mobile Product System Track](current/MOBILE_PRODUCT_SYSTEM_TRACK.md)为随行产品工程轨道，不是新P或一级页面。统一状态、组件职责、层级和交互，保持黑白/低装饰/少卡片；P11走查五页及所有二三级页面。同步PRODUCT/ARCHITECTURE/STATUS/TASK_BOOK/统一基线和P4/P6设计，修正旧Plan-only表述、遗漏USER_EVENT和“P2尚未实现”等过期口径，历史checkpoint与Evidence保留。

本次仅更新文档，无应用代码、DB迁移、部署或新的真机结果。P0 Phase1 CLOSED、P1/P2 CLOSED、P3 IN_PROGRESS；剩余严格三个真实Truth闭环，未开发后续阶段或追加P3矩阵。九份基线文件的本地链接、Markdown格式、十二阶段范围、四DoD、十一Gate与产品基础件职责检查通过；修正PRODUCT文件末尾空行后whitespace检查通过，不将文档检查记为Runtime或真实业务验收。

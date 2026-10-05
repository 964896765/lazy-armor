# V8.1 capability foundation: evidence ledger

Branch: integration/2026-10-01-cleanup. Existing uncommitted work preserved; no commit created.

## Delivered in this development pass

- Service icons use transparent hit areas. Workbench is a modal drawer controlled by the same INTERNAL/EXTERNAL state as the homepage. Service settings is a normal menu after the management cards, inside the scrollable area.
- Conversation drawer shares the active TEMPORARY/PLAN mode and filters actual server conversation records. Retry identity resets when switching mode, starting a conversation or selecting history.
- Composer has bounded multiline input, attachments, sending/stop-wait/retry. Android explicit height avoidance fixes a reproduced keyboard obstruction on device 2c696fe. Stop cancels client waiting, not the canonical backend execution.
- VoiceInputProvider has listening/transcribing/error, 45-second timeout, cancellation and late-result rejection. Cancellation fences both native cleanup and the preliminary account lookup. Transcripts only enter editable input; no send or execution is invoked.
- Android local capability manifest and user grants are scoped to the authenticated user. Signed manifests are persisted. Resource availability uses user grant, system permission and fresh health evidence. Revoked trusted devices are excluded from resource projection and native source candidates.
- Native calendar read validates exact JSON content hash and current grant. Acquisition and the existing Reality Pipeline publish calendar Truth atomically. Verified empty reads remain acquisition evidence, not invented event Truth.
- Explicit shared native-to-runtime mapping unifies calendar ResourceProjection, SourceResolver and Acquisition identity. Historical native source IDs are normalized through the same registry.
- Draft gap projection carries resolver coverage, StateAssessment and NextBestAction. ResourceGap WorkItems reuse that recommendation. Source options are based on actual resolver candidates; no new task/execution engine is introduced.

## Automated checks

- API and mobile typecheck; API, schema and Android builds passed during this pass.
- Native signed integration: 5 tests, including disabled grant, unsupported capability, content hash rejection, verified-empty receipt, real-pipeline calendar Truth publication with isolated test input, revoked-device projection exclusion.
- Voice controller: 5 tests. Composer content contract: 5 tests.
- Native parser/local availability/deterministic rules: 6 tests.
- Source selection/20 V2 contracts/acquisition assessment: 15 tests.
- Consumer projections/productization: 15 tests.
- Test fixtures are isolated integration inputs and are not phone Golden Flow evidence.

## Phone evidence

Directory: artifacts/android/v8-productization.

- v81-keyboard-fixed-visible.png/xml: actual Android keyboard, attachment/input/microphone/send all visible above it.
- v81-conversation-history-live.xml: temporary records only.
- v81-history-plan-only.xml and v81-history-mode-shared.xml: plan-only records and the same active main conversation mode.
- v81-service-drawer-external.xml and v81-service-home-external.xml: drawer changes external mode and homepage + becomes add external reference.
- v81-service-settings-fully-visible.xml: settings text/action fully visible after clipping repair.
- v81-local-resources-live.xml: direct compact capability list and truthful unsupported labels.
- v81-calendar-real-acquisition.xml: actual phone calendar read returned zero events in its scope. Development database confirms calendar.read VERIFIED_EMPTY, item_count=0, three evidence references. This does not establish a nonempty calendar or end-to-end reminder execution.

Installed final APK SHA256: C793DE3021A6602C0EC6562133A2FC1C3D4348BA09439D503D2AD2405DCEE44D. Final build and adb installation completed successfully; settings visibility was verified afterwards.

## Still not accepted as complete

- Native refresh/device task dispatch through canonical runtime capability readiness remains to be connected. Resolving native facts is not proof that an automatic Plan is executable.
- Notification/files/share legacy pathways require a complete grant/evidence audit; unsupported photos/SMS/send-notification/open-app/background/AppReadSession remain explicitly unintegrated in the new local capability contract.
- Voice successful recognition requires actual audio on the phone. Permission/cancel/timeout unit coverage does not substitute for it.
- Retry/stop and multiline attachment flows need further phone interaction validation.
- Draft source options need final mobile presentation/selection integration.
- All running Plan and other WorkItem kinds need complete assessment integration beyond existing authoritative status projection.
- Six Golden Flows are not fully accepted: actual logistics, bill, consumable, work email and service appointment source/fulfillment evidence still required; native calendar currently establishes verified-empty acquisition only.
- Service fulfillment existing contracts are preserved, but no real phone order PENDING→BOOKED→IN_PROGRESS→COMPLETED is claimed here.
- DeepSeek user Key submission over HTTP remains disabled. Existing server development Key and development OTP flow were not rewritten.

## Continuation: native DeviceTask transport and authoritative projections

- Installed APK SHA256: `28A66EAFD1E8D40AD39664C80702E6574EF5E59EB35EF3E81B8C92E4E8F750AF`. Android assembleDebug and adb install succeeded. This APK contains native-calendar task runner and draft source UI; subsequent service-query invalidation change still needs the next mobile build.
- SourceResolver `/runtime/fact-demands/acquire` dispatches selected usable calendar sources through existing DeviceTask leases. Signed completion validates exact scope/hash and writes Acquisition, Truth and Audit atomically. VERIFIED_EMPTY means successful transport with zero facts; it does not establish Plan/Execution success. Automatic Plan wakeup dispatch is still pending.
- Provider manifest modes now match independently per FactDemand. Regression check covers one declared connection satisfying OFFICIAL_API and WEBHOOK demands without inventing a mode.
- Notification acquisition enforces account-scoped userGrant, systemPermission, healthy manifest and existing per-App authorization. Logout/account change clears notification previews. Files remain explicit picker acquisition; Share health UNKNOWN. Full file/share evidence integration is pending.
- CreationDraft source selection has owned/versioned source-selection API and mobile gap panel. Final Plan confirmation binding to explicit choices still needs audit.
- Read-only StateAssessment covers active Plan versions and feeds WorkItem recommendations. Unknown/missing contract remains UNKNOWN/ASK_USER; this service does not execute actions. Full NBA authority integration remains pending.
- Service progress now appends Audit within the same transaction, tagged PARTICIPANT_CONFIRMATION. It does not claim autonomous Verification. Integration proves PENDING -> BOOKED -> IN_PROGRESS -> COMPLETED, WorkItem, Schedule and three status Audit records with isolated test accounts. Phone fulfillment is not yet accepted.
- Checks: shared fact-demand 14 tests passed; consumer surfaces + native local capabilities 21 tests passed; API typecheck/build and mobile typecheck passed. Isolated fixtures are not live Golden Flow evidence.

### Accepted pending evidence boundaries

- Calendar: prior real Android VERIFIED_EMPTY retained; real nonempty event pending user preparation.
- Shipment / Bill / Device Consumable: REAL_EVIDENCE_PENDING.
- Work Email: REAL_CREDENTIAL_PENDING.
- Voice actual spoken transcript: PHONE_AUDIO_EVIDENCE_PENDING; editable transcript only, no automatic send/action.
- Service Appointment: development digital diagnostic service fulfilled on the phone through PENDING -> BOOKED -> IN_PROGRESS -> COMPLETED; WorkItem, Schedule and transactional Audit verified. This is participant-confirmed service delivery, not an autonomous execution success. See `v81-closure-progress-2026-10-04.md` for current closure evidence and remaining Pending items.
- Pending external objects do not block independent code/contract/tests/runtime development. No fixtures or fabricated notifications count as phone proof.

## CalendarSheet presentation upgrade

- Preserved CalendarSheet; no system DatePicker or new calendar business engine.
- Opaque white sheet with approximately 80% screen height, safe-area handling and scrollable content; today/close remain at the top.
- Added deterministic Gregorian/lunar labels, Chinese festivals and solar terms using pinned lunar-javascript 1.7.7. These are date labels, not execution or resource Authority.
- Added authenticated /consumer/calendar monthly grouping of existing ScheduleProjection and WorkItemProjection. WorkItems correlate by canonical source references and scheduled dates; updatedAt is not a due date. A failed date has UNAVAILABLE/null counts, never zero.
- Mobile renders incomplete/completed dots only from backend counts; failed or unread dates have no fabricated empty/success interpretation.
- Verified 2026 lunar new year, mid-autumn and Cold Dew with two date tests. Calendar projection failure/source-reference policy unit test passed. API/mobile typecheck and API build passed.
- Official holiday/adjusted-workday acquisition and Weather FactDemand -> SourceResolver -> Weather Provider are NOT complete. They currently return explicit UNAVAILABLE with no invented holiday/forecast values. Forecasts must not be substituted from date algorithms, provider name or AI inference.
- Phone evidence: artifacts/android/v8-productization/v81-calendar-expanded-current.png/xml shows opaque sheet, full month grid, lunar dates, Cold Dew/Frost Descent and an actual completed-item marker from backend projection. Backend reports true zero for selected 2026-10-04. Extra international observances were subsequently filtered from date labels. Month projection loads successfully on phone.

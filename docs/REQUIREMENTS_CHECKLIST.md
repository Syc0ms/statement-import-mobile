# Requirements checklist

One line per requirement, with the PDF section it comes from. An item is ticked only after it was
verified; the evidence column says how. `UNTESTED` / `NOT DONE` items carry the reason.

Legend: `[x]` verified · `[ ]` open · `[~]` partially verified (see note)

## Что вы получаете (scope and constraints)

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| R1 | Stack is React Native + TypeScript; Expo development build allowed | Что вы получаете | [ ] | |
| R2 | Native run is checked, not web and not Expo Go | Что вы получаете | [ ] | |
| R3 | Server and fixtures are not modified; code only in the mobile client and its tests | Что вы получаете | [ ] | |
| R4 | No real PDF parser, AI, bank integration, auth, payments, store publishing or own cloud services | Что вы получаете | [ ] | |
| R5 | All data is synthetic | Что вы получаете | [ ] | |

## Сценарий (user flow)

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| S1 | Pick PDF/CSV through the system picker | Сценарий | [ ] | |
| S2 | Confirmation screen shows name, size and format | Сценарий | [ ] | |
| S3 | spoofed.pdf is rejected before POST | Сценарий | [ ] | |
| S4 | A file larger than 10 MiB is rejected before POST | Сценарий | [ ] | |
| S5 | Validation does not rely only on the extension or the declared MIME | Сценарий | [ ] | |
| S6 | On confirm the app sends the real bytes to the local HTTP mock | Сценарий | [ ] | |
| S7 | Create returns a job; the report appears later (202 is not a finished report) | Сценарий | [ ] | |
| S8 | UI shows queued / processing / ready / error | Сценарий | [ ] | |
| S9 | An uncertain POST outcome can be recovered | Сценарий | [ ] | |
| S10 | Result: two synthetic recurring charges with AUD amount and date | Сценарий | [ ] | |
| S11 | "Подробнее" (Details) opens a card | Сценарий | [ ] | |
| S12 | No subscription-cancel action anywhere | Сценарий | [ ] | |
| S13 | Delete is a separate async operation | Сценарий | [ ] | |
| S14 | Never claim server data is deleted until the mock returned status=deleted | Сценарий | [ ] | |
| S15 | Own temporary file copies are removed when the flow finishes or is cancelled | Сценарий | [ ] | |

## Контракт локального HTTP mock

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| C1 | Client talks to the kit server over the network, not via a stubbed UI call | Контракт | [ ] | |
| C2 | POST /imports sends raw bytes as application/octet-stream | Контракт | [ ] | |
| C3 | Headers Idempotency-Key and X-File-Name are sent | Контракт | [ ] | |
| C4 | Idempotency key is created and persisted before the first send | Контракт | [ ] | |
| C5 | Emulator/simulator localhost address is configurable per the kit README | Контракт | [ ] | |
| C6 | Same key + same bytes → same job (retry uses the same key and bytes) | Контракт (table) | [ ] | |
| C7 | GET /imports/by-key/{key} used after a lost response; 404 = "not found yet", retry POST with the same key | Контракт (table) | [ ] | |
| C8 | GET /imports/{jobId}: queued/processing/ready/deleting/deleted + revision; result only when ready | Контракт (table) | [ ] | |
| C9 | DELETE /imports/{jobId} with a stable delete key; deletion confirmed only by a later GET: deleted | Контракт (table) | [ ] | |
| C10 | Fixed ready result rendered: AUD, StreamBeam 1999 monthly 2026-10-01, BrightGrid 13200 monthly 2026-10-03 | Фиксированный ready-ответ | [ ] | |
| C11 | Result is shown as the server's answer, not client parsing | Фиксированный ready-ответ | [ ] | |
| C12 | No raw bytes, file name or transaction descriptions in analytics or crash logs | Фиксированный ready-ответ | [ ] | |

## Одинаковые файлы для проверки

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| F1 | statement.csv accepted; after ready: two items and 151.99 AUD/month | Одинаковые файлы | [ ] | |
| F2 | statement.pdf accepted; after ready: two items and 151.99 AUD/month | Одинаковые файлы | [ ] | |
| F3 | spoofed.pdf rejected before POST | Одинаковые файлы | [ ] | |
| F4 | oversize.csv (npm run fixtures:oversize) rejected before POST | Одинаковые файлы | [ ] | |

## Единая матрица приёмки

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| M1 | happy: file really sent; 202 not announced as a ready report; mock data visible after ready | Матрица | [ ] | |
| M2 | lost_ack: first POST creates the job without a reply; after retry/relaunch by-key finds it; newJobs=1 | Матрица | [ ] | |
| M3 | stale_status: processing/rev 2 after ready/rev 3 does not roll back the UI; a test proves it | Матрица | [ ] | |
| M4 | delete_failure: 503 → UI does not claim deletion; after switching to happy, retry with the same key reaches deleted | Матрица | [ ] | |
| M5 | spoofed + oversize: both rejected before POST; createRequests unchanged before/after | Матрица | [ ] | |

## Инженерные требования

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| E1 | Temporary access to Android content:// and iOS Files URLs handled (private copy) | Инженерные | [ ] | |
| E2 | Bytes are read without loading a large file into memory; size limit from metadata | Инженерные | [ ] | |
| E3 | Own private temp copy is cleaned up | Инженерные | [ ] | |
| E4 | Extension/MIME not trusted without a content check | Инженерные | [ ] | |
| E5 | Key and minimal operation state persisted before POST | Инженерные | [ ] | |
| E6 | After a normal relaunch the current job is shown without resending the file | Инженерные | [ ] | |
| E7 | A late response cannot resurrect a deleted job | Инженерные | [ ] | |
| E8 | Scenarios switched via /__test/scenario (diagnostics screen or README commands) | Инженерные | [ ] | |
| E9 | No source changes between runs | Инженерные | [ ] | |
| E10 | No raw bytes, file name or descriptions in logs/analytics | Инженерные | [ ] | |
| E11 | Tests: persisted key | Инженерные | [ ] | |
| E12 | Tests: one job on lost_ack | Инженерные | [ ] | |
| E13 | Tests: stale revision | Инженерные | [ ] | |
| E14 | Tests: failed delete | Инженерные | [ ] | |
| E15 | Tests: local rejection of both bad files | Инженерные | [ ] | |
| E16 | Test results and mock counters are reproducible | Инженерные | [ ] | |
| E17 | Native run on iOS: file pick + one full import | Инженерные | [ ] | |
| E18 | Native run on Android: file pick + one full import, or honestly marked untested | Инженерные | [ ] | |
| E19 | Small screen and large system font do not break the main actions | Инженерные | [ ] | |
| E20 | Readable loading / error / empty states | Инженерные | [ ] | |

## Релизная зрелость

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| RM1 | README: exact clean checkout | Релизная зрелость | [ ] | |
| RM2 | README: commands to start the client and the mock | Релизная зрелость | [ ] | |
| RM3 | README: tests | Релизная зрелость | [ ] | |
| RM4 | README: devices / OS versions | Релизная зрелость | [ ] | |
| RM5 | README: actual result separately for iOS and Android; untested platform not marked as working | Релизная зрелость | [ ] | |
| RM6 | Release note: permissions really needed | Релизная зрелость | [ ] | |
| RM7 | Release note: where file copies remain | Релизная зрелость | [ ] | |
| RM8 | Release note: how to clear data | Релизная зрелость | [ ] | |
| RM9 | Release note: signal that stops a rollout | Релизная зрелость | [ ] | |
| RM10 | Release note: what needs a new native binary vs JS/OTA | Релизная зрелость | [ ] | |
| RM11 | No store credentials or other people's work materials in the repo | Релизная зрелость | [ ] | |

## Что прислать

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| D1 | Repo with the client and the unmodified kit, README and test results | Что прислать | [ ] | |
| D2 | Short video: iOS, Android, happy, lost_ack/relaunch, stale_status, delete_failure (honest about gaps) | Что прислать | [ ] | |
| D3 | Self-review ≤ 1 page: 2-3 decisions, simplifications, what breaks first in production and how it is noticed | Что прислать | [ ] | |
| D4 | Self-review: how AI tools were used and what was checked by hand | Что прислать | [ ] | |
| D5 | No public URL, real bank files, external APIs, passwords or store access; not published to stores | Что прислать | [ ] | |

## Как оцениваем / Как проверим (stop factors and reviewer flow)

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| G1 | Stop factor: no critical leak of document data or secrets | Как оцениваем | [ ] | |
| G2 | Stop factor: no second job after a resend | Как оцениваем | [ ] | |
| G3 | Stop factor: no false deletion confirmation | Как оцениваем | [ ] | |
| G4 | Reviewer can run from a clean checkout with no extra coding or external services | Как проверим | [ ] | |
| G5 | Mock counters match the UI and the automated tests | Как проверим | [ ] | |

## Additional requirements from the brief (beyond the PDF)

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| X1 | Kit copied unchanged into kit/ and verified with diff -r | Brief §1 | [ ] | |
| X2 | Small logical commits, no remote, no push | Brief §1 | [ ] | |
| X3 | No Monetor code, assets, branding or credentials | Brief §1 | [ ] | |
| X4 | TypeScript strict, no `any` | Brief §2 | [ ] | |
| X5 | Latest stable Expo SDK + expo-dev-client; native only | Brief §2 | [ ] | |
| X6 | Upload does not load the file into JS memory; proven with acceptedBytes / sha256 | Brief §2 | [ ] | |
| X7 | API base URL configurable, default http://127.0.0.1:8787; LAN host for a physical device | Brief §2 | [ ] | |
| X8 | Key from expo-crypto randomUUID; record holds key, phase, temp path, size, format, content hash | Brief §3 | [ ] | |
| X9 | Every phase transition persisted | Brief §3 | [ ] | |
| X10 | by-key 404 → "Retry upload" with the same key and bytes; never a new key for the same operation | Brief §3 | [ ] | |
| X11 | Polling with backoff while foregrounded; stops on terminal states | Brief §3 | [ ] | |
| X12 | Revision rule in one pure, unit-tested reducer | Brief §3 | [ ] | |
| X13 | Monthly total 151.99 AUD; Details card per item | Brief §3 | [ ] | |
| X14 | Delete key generated and persisted before the first DELETE; 503 → retry with the same key | Brief §3 | [ ] | |
| X15 | Launch sweep removes orphaned copies not owned by an active operation | Brief §3 | [ ] | |
| X16 | Copy locations documented for iOS and Android | Brief §3 | [ ] | |
| X17 | Single safe logger; test proves it drops the file name | Brief §3 | [ ] | |
| X18 | Diagnostics screen: scenario switch, reset, live /__test/state, API host; clearly marked as a test tool | Brief §4 | [ ] | |
| X19 | Integration tests run the real kit mock (createMockServer) on a random port with a temp statePath | Brief §5 | [ ] | |
| X20 | Oversize fixture generated in a temp dir during tests; nothing written into kit/ | Brief §5 | [ ] | |
| X21 | Relaunch simulated in tests by recreating the store and controller | Brief §5 | [ ] | |
| X22 | `npm test` passes from a clean checkout; output recorded in README | Brief §5 | [ ] | |
| X23 | UI principles applied: concentric radii, optical alignment, soft shadows, stagger enter / subtle exit, 0.96 press, tabular numbers, balanced headings, interruptible transitions, 40×40 hit areas | Brief §6 | [ ] | |
| X24 | Calm original identity: one neutral ramp, one accent, no gradients/glows/emoji, sentence case, no exclamation marks | Brief §6 | [ ] | |
| X25 | Status timeline is the hero and never claims more than the server said | Brief §6 | [ ] | |
| X26 | Largest Dynamic Type and iPhone SE checked; reduced motion respected; light and dark | Brief §6 | [ ] | |
| X27 | Clips and /__test/state snapshots before/after each scenario in docs/evidence/ | Brief §7 | [ ] | |
| X28 | Physical iPhone over a LAN host, if possible | Brief §7 | [ ] | |
| X29 | Docs in Russian: README, RELEASE_NOTES, SELF_REVIEW (placeholders for manual checks), docs/VIDEO_SCRIPT | Brief §8 | [ ] | |

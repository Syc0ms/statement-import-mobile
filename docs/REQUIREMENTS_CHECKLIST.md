# Requirements checklist

One line per requirement, with the PDF section it comes from. An item is ticked only after it was
verified; the evidence column says how. `UNTESTED` / `NOT DONE` items carry the reason.

Legend: `[x]` verified · `[~]` partially verified (see note) · `[ ]` not done

Evidence shorthand: **IT** = integration test in `app/test/integration/importFlow.test.ts` (real kit
mock); **UT** = unit test in `app/test/unit/`; **SIM** = iOS simulator run, `docs/evidence/ios-sim/`
(walkthrough, clips, `/__test/state` JSON before/after); **DEV** = physical iPhone 14 Pro.

## Что вы получаете (scope and constraints)

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| R1 | Stack is React Native + TypeScript; Expo development build allowed | Что вы получаете | [x] | Expo SDK 58, RN 0.88.1, TS strict, `expo-dev-client` (`app/package.json`) |
| R2 | Native run is checked, not web and not Expo Go | Что вы получаете | [x] | Release builds via xcodebuild on SIM and DEV; `app.json` platforms = ios, android |
| R3 | Server and fixtures are not modified; code only in the mobile client and its tests | Что вы получаете | [x] | `diff -r` vs the provided kit (identical); single commit touching `kit/` |
| R4 | No real PDF parser, AI, bank integration, auth, payments, store publishing or own cloud services | Что вы получаете | [x] | Code review: only the local mock is called |
| R5 | All data is synthetic | Что вы получаете | [x] | Only kit fixtures used |

## Сценарий (user flow)

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| S1 | Pick PDF/CSV through the system picker | Сценарий | [x] | SIM clips 01–05 (UIDocumentPicker, «На iPhone») |
| S2 | Confirmation screen shows name, size and format | Сценарий | [x] | SIM 01 (statement.csv, 112 Б, CSV), 02 (statement.pdf, 33.1 КБ, PDF) |
| S3 | spoofed.pdf is rejected before POST | Сценарий | [x] | SIM 05 + IT `spoofed.pdf and oversize.csv are rejected…` |
| S4 | A file larger than 10 MiB is rejected before POST | Сценарий | [x] | SIM 05 + IT (content never read, `readCount` unchanged) |
| S5 | Validation does not rely only on the extension or the declared MIME | Сценарий | [x] | UT `ignores the extension…`; picker MIME filter is not trusted |
| S6 | On confirm the app sends the real bytes to the local HTTP mock | Сценарий | [x] | SIM: `acceptedBytes` 112 / 33882, mock `sha256` = `shasum` of fixture; IT asserts the same |
| S7 | Create returns a job; the report appears later (202 is not a finished report) | Сценарий | [x] | UT `202 queued is never shown as ready`; IT first status queued/1 |
| S8 | UI shows queued / processing / ready / error | Сценарий | [x] | Timeline steps; error states: local rejection, server rejection, unknown, 503 (SIM 02, 04, 05) |
| S9 | An uncertain POST outcome can be recovered | Сценарий | [x] | SIM 02 (lost_ack + relaunch), IT lost_ack tests |
| S10 | Result: two synthetic recurring charges with AUD amount and date | Сценарий | [x] | SIM 01: StreamBeam 19.99 AUD, BrightGrid 132.00 AUD, dates |
| S11 | "Подробнее" (Details) opens a card | Сценарий | [x] | SIM 01 (details sheet) |
| S12 | No subscription-cancel action anywhere | Сценарий | [x] | Code review + UT action labels; details card read-only |
| S13 | Delete is a separate async operation | Сценарий | [x] | Own delete key/phase; SIM 01, 04 |
| S14 | Never claim server data is deleted until the mock returned status=deleted | Сценарий | [x] | UT `"deleted from server" appears only…`; IT 202 is not confirmation; SIM 04 |
| S15 | Own temporary file copies are removed when the flow finishes or is cancelled | Сценарий | [x] | IT cancel/rejection/forget/accepted delete the copy; SIM «Локальная копия: удалена» |

## Контракт локального HTTP mock

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| C1 | Client talks to the kit server over the network, not via a stubbed UI call | Контракт | [x] | SIM/DEV over HTTP; IT over a real socket |
| C2 | POST /imports sends raw bytes as application/octet-stream | Контракт | [x] | `File.upload` BINARY_CONTENT + header; IT asserts header |
| C3 | Headers Idempotency-Key and X-File-Name are sent | Контракт | [x] | IT asserts both |
| C4 | Idempotency key is created and persisted before the first send | Контракт | [x] | IT `is persisted with phase "sending" before the POST leaves` |
| C5 | Emulator/simulator localhost address is configurable per the kit README | Контракт | [x] | Тест-панель «Адрес API»; README (adb reverse, LAN host) |
| C6 | Same key + same bytes → same job (retry uses the same key and bytes) | Контракт | [x] | IT `user retry with the same key…` (duplicateHits 1, newJobs 1) |
| C7 | by-key after a lost response; 404 = "not found yet", retry POST with the same key | Контракт | [x] | IT `by-key 404 › offers a retry…`; UT primary action |
| C8 | GET /imports/{jobId} states + revision; result only when ready | Контракт | [x] | `parseJob` (UT), reducer (UT), SIM timeline |
| C9 | DELETE with a stable delete key; deletion confirmed only by a later GET deleted | Контракт | [x] | IT delete_failure (same key twice), SIM 04 |
| C10 | Fixed ready result rendered exactly | Фиксированный ready-ответ | [x] | SIM 01; UT money formatting |
| C11 | Result is shown as the server's answer, not client parsing | Фиксированный ready-ответ | [x] | Copy «По ответу сервера», no parser in code |
| C12 | No raw bytes, file name or transaction descriptions in analytics or crash logs | Фиксированный ready-ответ | [x] | UT safe logger; IT `logs never contain…`; no analytics/crash SDK |

## Одинаковые файлы для проверки

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| F1 | statement.csv accepted; after ready: two items and 151.99 AUD/month | Одинаковые файлы | [x] | SIM 01, IT |
| F2 | statement.pdf accepted; after ready: two items and 151.99 AUD/month | Одинаковые файлы | [x] | SIM 02 (ready, 151.99 AUD), IT |
| F3 | spoofed.pdf rejected before POST | Одинаковые файлы | [x] | SIM 05, IT |
| F4 | oversize.csv rejected before POST | Одинаковые файлы | [x] | SIM 05 (kit `npm run fixtures:oversize`), IT (temp dir) |

## Единая матрица приёмки

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| M1 | happy: bytes really sent; 202 not announced as ready; mock data after ready | Матрица | [x] | SIM 01 + `01-happy-*.json` |
| M2 | lost_ack: retry/relaunch finds the job by key; newJobs=1 | Матрица | [x] | SIM 02 + `02-lost-ack-*.json` (newJobs 1, duplicateHits 0); IT |
| M3 | stale_status: no rollback after ready/3; a test proves it | Матрица | [x] | SIM 03; IT + UT reducer |
| M4 | delete_failure: no deletion claim; retry with the same key reaches deleted | Матрица | [x] | SIM 04 (same delete key, 2 attempts); IT |
| M5 | spoofed + oversize rejected before POST; createRequests unchanged | Матрица | [x] | SIM 05 (`createRequests` 1→1); IT (0→0) |

## Инженерные требования

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| E1 | Temporary access to Android content:// and iOS Files URLs (private copy) | Инженерные | [~] | iOS verified (picker copy → own cache). Android path implemented but **UNTESTED** (no SDK) |
| E2 | Bytes read without loading a large file into memory; size limit from metadata | Инженерные | [x] | `File.size`, `readBytes(64)`, native `digest`, native upload; IT `readCount` unchanged for oversize |
| E3 | Own private temp copy is cleaned up | Инженерные | [x] | IT (cancel, rejection, accepted, forget, launch sweep) |
| E4 | Extension/MIME not trusted without a content check | Инженерные | [x] | UT, SIM 05 |
| E5 | Key and minimal operation state persisted before POST | Инженерные | [x] | IT persisted-before-POST |
| E6 | After a normal relaunch the current job is shown without resending | Инженерные | [x] | IT relaunch tests (upload calls stay 1); SIM 02 |
| E7 | A late response cannot resurrect a deleted job | Инженерные | [x] | IT `a late ready/3 response…`; UT reducer |
| E8 | Scenarios switched via /__test/scenario (diagnostics screen or README commands) | Инженерные | [x] | Тест-панель (SIM 02–04 switch on camera); README curl commands |
| E9 | No source changes between runs | Инженерные | [x] | All SIM scenarios on one build |
| E10 | No raw bytes, file name or descriptions in logs/analytics | Инженерные | [x] | see C12 |
| E11 | Tests: persisted key | Инженерные | [x] | IT |
| E12 | Tests: one job on lost_ack | Инженерные | [x] | IT (3 tests) |
| E13 | Tests: stale revision | Инженерные | [x] | IT + UT |
| E14 | Tests: failed delete | Инженерные | [x] | IT |
| E15 | Tests: local rejection of both bad files | Инженерные | [x] | IT |
| E16 | Test results and mock counters are reproducible | Инженерные | [x] | Fresh clone `npm test` (README); counters asserted from `/__test/state` |
| E17 | Native run on iOS: file pick + one full import | Инженерные | [x] | SIM full matrix. DEV: built, installed, launched; full import on the phone not driven by me |
| E18 | Native run on Android, or honestly marked untested | Инженерные | [x] | **Android UNTESTED** — no Android SDK/emulator/Java on this Mac; marked in README and here |
| E19 | Small screen and large system font do not break the main actions | Инженерные | [~] | Largest accessibility size (AX5) + dark on iPhone 16 Pro sim: fixed header wrap, all actions reachable (`docs/evidence/ios-sim/a11y/`). iPhone SE sim **NOT CHECKED** (access declined) |
| E20 | Readable loading / error / empty states | Инженерные | [x] | SIM: empty state, «Проверяем файл», unknown, 503, rejections |

## Релизная зрелость

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| RM1 | README: exact clean checkout | Релизная зрелость | [x] | README «Clean checkout»; verified by a fresh clone |
| RM2 | README: commands to start the client and the mock | Релизная зрелость | [x] | README |
| RM3 | README: tests | Релизная зрелость | [x] | README with real output |
| RM4 | README: devices / OS versions | Релизная зрелость | [x] | iPhone 16 Pro sim iOS 18.6; iPhone 14 Pro iOS 27.2.1 |
| RM5 | README: result separately for iOS and Android; untested not marked as working | Релизная зрелость | [x] | README «Устройства и фактические результаты» |
| RM6 | Release note: permissions really needed | Релизная зрелость | [x] | RELEASE_NOTES; Info.plist checked in the built app |
| RM7 | Release note: where file copies remain | Релизная зрелость | [x] | RELEASE_NOTES table |
| RM8 | Release note: how to clear data | Релизная зрелость | [x] | RELEASE_NOTES |
| RM9 | Release note: signal that stops a rollout | Релизная зрелость | [x] | RELEASE_NOTES |
| RM10 | Release note: native binary vs JS/OTA | Релизная зрелость | [x] | RELEASE_NOTES |
| RM11 | No store credentials or other people's work materials in the repo | Релизная зрелость | [x] | `git grep` for team IDs/accounts: none; signing team passed only on the command line |

## Что прислать

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| D1 | Repo with the client and the unmodified kit, README and test results | Что прислать | [x] | this repository |
| D2 | Short video: iOS, Android, happy, lost_ack/relaunch, stale_status, delete_failure | Что прислать | [~] | iOS simulator walkthrough with all scenarios: `docs/evidence/ios-sim/walkthrough.mp4`. Phone recording and final cut by the owner (`docs/VIDEO_SCRIPT.md`). Android: shown as untested |
| D3 | Self-review ≤ 1 page | Что прислать | [x] | SELF_REVIEW.md |
| D4 | Self-review: how AI was used and what was checked by hand | Что прислать | [~] | AI usage described; the owner's own manual checks are placeholders to fill in |
| D5 | No public URL, real bank files, external APIs, passwords or store access | Что прислать | [x] | — |

## Как оцениваем / Как проверим

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| G1 | No critical leak of document data or secrets | Как оцениваем | [x] | C12; copies removed; names not on disk (`<uuid>.bin`) |
| G2 | No second job after a resend | Как оцениваем | [x] | M2, C6 (newJobs 1 everywhere) |
| G3 | No false deletion confirmation | Как оцениваем | [x] | S14, M4, E7 |
| G4 | Reviewer can run from a clean checkout with no extra coding | Как проверим | [x] | fresh clone: `npm ci --prefix app && npm test` |
| G5 | Mock counters match the UI and the automated tests | Как проверим | [x] | README results table vs `docs/evidence/ios-sim/*.json` |

## Additional requirements from the brief (beyond the PDF)

| # | Requirement | Source | Status | Evidence |
|---|---|---|---|---|
| X1 | Kit copied unchanged into kit/ and verified with diff -r | Brief §1 | [x] | `diff -r` identical |
| X2 | Small logical commits, no remote, no push | Brief §1 | [x] | `git log`; `git remote` empty |
| X3 | No code, assets, branding or credentials from other projects | Brief §1 | [x] | `git grep`; template icons only |
| X4 | TypeScript strict, no `any` | Brief §2 | [x] | `tsconfig` strict; grep for `any`: none; `npm run typecheck` |
| X5 | Latest stable Expo SDK + expo-dev-client; native only | Brief §2 | [x] | SDK 58 (npm `latest`) |
| X6 | Upload does not load the file into JS memory; proven with acceptedBytes / sha256 | Brief §2 | [x] | SIM 01/02 sha256 match |
| X7 | API base URL configurable, default 127.0.0.1:8787; LAN host for a device | Brief §2 | [x] | Тест-панель; DEV reaches the LAN mock |
| X8 | Key from expo-crypto randomUUID; record holds key, phase, temp path, size, format, hash | Brief §3 | [x] | `importController.confirm`; IT snapshot |
| X9 | Every phase transition persisted | Brief §3 | [x] | `commit()` persists every transition |
| X10 | by-key 404 → "Retry upload" with the same key and bytes | Brief §3 | [x] | IT + UT |
| X11 | Polling with backoff while foregrounded; stops on terminal states | Brief §3 | [x] | `needsPolling`, AppState wiring |
| X12 | Revision rule in one pure, unit-tested reducer | Brief §3 | [x] | `jobReducer.ts` + UT |
| X13 | Monthly total 151.99 AUD; Details card per item | Brief §3 | [x] | SIM 01 |
| X14 | Delete key persisted before the first DELETE; 503 → retry with the same key | Brief §3 | [x] | IT |
| X15 | Launch sweep removes orphaned copies | Brief §3 | [x] | IT |
| X16 | Copy locations documented for iOS and Android | Brief §3 | [x] | RELEASE_NOTES |
| X17 | Single safe logger; test proves it drops the file name | Brief §3 | [x] | UT |
| X18 | Diagnostics screen: scenarios, reset, live counters, API host; marked as a test tool | Brief §4 | [x] | SIM (Тест-панель) |
| X19 | Integration tests run the real kit mock on a random port with a temp statePath | Brief §5 | [x] | `test/support/start-mock.mjs` |
| X20 | Oversize fixture generated in a temp dir during tests | Brief §5 | [x] | `makeOversize` |
| X21 | Relaunch simulated in tests by recreating the store and controller | Brief §5 | [x] | IT |
| X22 | `npm test` passes from a clean checkout; output recorded in README | Brief §5 | [x] | fresh clone run |
| X23 | UI principles applied | Brief §6 | [x] | concentric radii (22 = 16 + 6), layered shadows, staggered enter / short exit, 0.96 press, tabular numbers, balanced headings, interruptible withTiming, 44 pt targets |
| X24 | Calm original identity: one ramp, one accent, no gradients/emoji, sentence case, no "!" | Brief §6 | [x] | `theme.ts`; SIM |
| X25 | Status timeline is the hero and never claims more than the server said | Brief §6 | [x] | UT presentation rules; SIM |
| X26 | Largest Dynamic Type, iPhone SE, reduced motion, light and dark | Brief §6 | [~] | AX5 + dark verified; reduced motion via `ReduceMotion.System` (code, not toggled on device); SE **NOT CHECKED** |
| X27 | Clips and /__test/state snapshots before/after each scenario | Brief §7 | [x] | `docs/evidence/ios-sim/` |
| X28 | Physical iPhone over a LAN host, if possible | Brief §7 | [~] | Built, installed and launched on iPhone 14 Pro; mock on LAN; scenarios on the phone are left to the owner |
| X29 | Docs in Russian: README, RELEASE_NOTES, SELF_REVIEW, VIDEO_SCRIPT | Brief §8 | [x] | repository root and `docs/` |

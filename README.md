# Импорт банковской выписки без потери состояния

Фрагмент мобильного приложения на React Native + TypeScript (Expo SDK 58, development build,
только нативный запуск). Пользователь выбирает синтетическую выписку (PDF/CSV), приложение
проверяет её на устройстве, отправляет байты локальному mock API, переживает потерю ответа,
перезапуск и устаревшие статусы, показывает результат и безопасно удаляет импорт.

```
kit/     неизменённый набор кандидата (mock, фикстуры, тесты mock) — не редактируется
app/     клиент: Expo + TypeScript (strict)
tools/   record-mock-state.mjs — журнал изменений GET /__test/state при ручной проверке
docs/    REQUIREMENTS_CHECKLIST.md, VIDEO_SCRIPT.md, evidence/
RELEASE_NOTES.md, SELF_REVIEW.md
```

`kit/` побайтно совпадает с выданным набором (проверено `diff -r`, один коммит,
`git log -- kit`).

## Требования

- macOS с Xcode 16+ (проверено на Xcode 27.2), CocoaPods.
- Node.js **22.13+** (Expo SDK 58 требует `^22.13 || ^24.3 || ^26`; сам mock — Node 20+). Проверено на Node 26.7.
- Для iPhone: Apple Developer team в Xcode (бесплатный аккаунт тоже подходит), телефон в Developer Mode.
- Для Android: Android Studio, SDK, эмулятор или устройство (см. раздел Android — **не проверено**).

## Clean checkout

```bash
git clone <repo> mobile-engineer-task
cd mobile-engineer-task
npm ci --prefix app
```

У `kit/` нет зависимостей. Нативные папки `app/ios` и `app/android` не хранятся в репозитории:
они генерируются из `app/app.json` (Expo Continuous Native Generation).

## Тесты

```bash
npm test
```

Запускает тесты самого mock (`kit/`, `node --test`) и тесты клиента (`app/`, Jest).
Интеграционные тесты клиента поднимают **настоящий неизменённый** `kit/mock-server.mjs`
(`createMockServer`) в дочернем процессе на случайном порту с временным `statePath` и проверяют
счётчики через `GET /__test/state`. `oversize.csv` генерируется во временную папку той же логикой,
что `make-oversize.mjs`; в `kit/` тесты ничего не пишут.

Проверка типов: `npm run typecheck`.

Фактический результат из свежего `git clone` → `npm ci --prefix app` → `npm test` (19 ноября 2026, Node 26.7.0, macOS):

```
kit:  ℹ tests 6  ℹ pass 6  ℹ fail 0
app:  Test Suites: 6 passed, 6 total
      Tests:       52 passed, 52 total
```

<details>
<summary>Список тестов клиента</summary>

```
PASS test/unit/logger.test.ts
  ✓ safe logger › drops the file name, whatever field it is passed in
  ✓ safe logger › drops transaction descriptions, raw bytes and free text
  ✓ safe logger › keeps allow-listed safe values
  ✓ safe logger › drops a record whose event name is not a plain identifier
PASS test/unit/jobReducer.test.ts
  ✓ reduceJob (revision rule) › applies the first snapshot
  ✓ reduceJob (revision rule) › applies strictly newer revisions in order
  ✓ reduceJob (revision rule) › keeps ready/3 when processing/2 arrives late (stale_status)
  ✓ reduceJob (revision rule) › ignores an equal revision
  ✓ reduceJob (revision rule) › treats deleting/4 and deleted/5 as later states and keeps the ready result while deleting
  ✓ reduceJob (revision rule) › never resurrects a deleted job, whatever arrives later
  ✓ reduceJob (revision rule) › ignores snapshots of another job
  ✓ reduceJob (revision rule) › does not mutate its inputs
PASS test/unit/presentation.test.ts
  ✓ presentation honesty rules › 202 queued is never shown as ready and shows no result
  ✓ presentation honesty rules › ready shows the result and the 151.99 AUD monthly total
  ✓ presentation honesty rules › a failed delete says "not deleted", keeps the data visible and offers a retry
  ✓ presentation honesty rules › a 202 delete is "deleting", never "deleted"
  ✓ presentation honesty rules › "deleted from server" appears only when the stored job status is deleted
  ✓ presentation honesty rules › unknown upload outcome offers a key lookup first and a same-key resend second
  ✓ presentation honesty rules › by-key 404 offers "retry upload" as the primary action
  ✓ presentation honesty rules › notes an ignored stale status on the ready step
  ✓ presentation honesty rules › labels a job recovered by key after a lost response, not as a plain 202
PASS test/unit/money.test.ts
  ✓ money formatting from minor units › formats the fixed ready result exactly
  ✓ money formatting from minor units › groups thousands, keeps cents exact and handles zero-decimal currencies
  ✓ money formatting from minor units › sums the monthly total of the fixed result to 151.99 AUD
  ✓ money formatting from minor units › formats dates without time-zone drift and sizes in binary units
  ✓ parseJob (untrusted server body) › rejects malformed bodies instead of guessing
  ✓ parseJob (untrusted server body) › returns no result for non-ready states
PASS test/unit/validation.test.ts
  ✓ content sniffing › accepts the kit PDF and CSV by content
  ✓ content sniffing › rejects spoofed.pdf: text with a .pdf name
  ✓ content sniffing › ignores the extension: a real PDF named .csv is a PDF, a CSV named .pdf is a CSV
  ✓ content sniffing › handles a UTF-8 BOM and CRLF line endings in the CSV header
  ✓ content sniffing › rejects near misses of the CSV header and of the PDF magic
  ✓ content sniffing › rejects empty files
  ✓ size limit › accepts exactly 10 MiB and rejects one byte more, from the size alone
PASS test/integration/importFlow.test.ts
  ✓ happy path › statement.csv: real bytes reach the mock, 202 is queued (not ready), ready shows the fixed result
  ✓ happy path › statement.pdf: real bytes reach the mock, 202 is queued (not ready), ready shows the fixed result
  ✓ durable idempotency key › is persisted with phase "sending" before the POST leaves, and matches the header
  ✓ durable idempotency key › a normal relaunch restores the job without resending the file
  ✓ lost_ack › relaunch after a lost response: by-key finds the job, exactly one job, nothing resent
  ✓ lost_ack › app killed mid-POST (record still "sending"): relaunch treats it as unknown and looks up by key
  ✓ lost_ack › user retry with the same key returns the same job (duplicate hit, still one job)
  ✓ by-key 404 › offers a retry that reuses the key and bytes, and creates exactly one job
  ✓ by-key 404 › refuses to resend if the private copy changed, so a key never carries other bytes
  ✓ stale_status › processing/2 after ready/3 is ignored and the UI stays ready
  ✓ delete › delete_failure: 503 never claims deletion; after happy, retry with the same key reaches deleted
  ✓ delete › a late ready/3 response arriving after deleted/5 cannot resurrect the job
  ✓ local rejection before POST › spoofed.pdf and oversize.csv are rejected with createRequests unchanged
  ✓ local rejection before POST › cancel on the confirmation screen deletes the private copy and sends nothing
  ✓ local rejection before POST › a CSV with a BOM passes local sniffing; the mock answers 415 and the client shows a server rejection
  ✓ temp files and privacy › launch sweep removes orphaned copies but keeps the one owned by the active operation
  ✓ temp files and privacy › logs never contain the file name, the key, merchants or file content
  ✓ temp files and privacy › forget clears the record and every private copy
```

</details>

## Запуск mock

```bash
npm run mock          # = npm --prefix kit start → http://127.0.0.1:8787 (только loopback)
npm run mock:lan      # = HOST=0.0.0.0 npm --prefix kit start — для физического телефона
npm run fixtures:oversize   # создаёт kit/fixtures/oversize.csv (игнорируется git'ом набора)
```

`mock:lan` открывает mock только в локальной сети (Wi‑Fi). Не пробрасывайте порт 8787 наружу и не
запускайте его в публичной сети. Код mock при этом не меняется: адрес задаёт переменная `HOST`,
которую читает сам `kit/mock-server.mjs`.

## Запуск клиента

### iOS — физический iPhone (основной проверенный путь)

1. Телефон и Mac в одной Wi‑Fi сети. Узнать адрес Mac: `ipconfig getifaddr en0`.
2. `npm run mock:lan`.
3. Сборка Release (JS-бандл внутри приложения, Metro не нужен) и установка:

```bash
cd app
npx expo prebuild --platform ios --no-install
(cd ios && LANG=en_US.UTF-8 pod install)
xcodebuild -workspace ios/StatementImport.xcworkspace -scheme StatementImport \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath ~/Library/Developer/Xcode/DerivedData/StatementImport-device \
  DEVELOPMENT_TEAM=<ваш Team ID> CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates build \
&& xcrun devicectl device install app --device <UDID> \
  ~/Library/Developer/Xcode/DerivedData/StatementImport-device/Build/Products/Release-iphoneos/StatementImport.app \
&& xcrun devicectl device process launch --device <UDID> dev.candidate.statementimport
```

   - `<UDID>` — из `xcrun devicectl list devices`. Team ID в репозиторий не записывается.
   - DerivedData лежит вне папки проекта: если проект в синхронизируемой iCloud-папке
     (Desktop/Documents), подпись фреймворков падает с ошибкой «resource fork, Finder information,
     or similar detritus not allowed».
   - Если телефон пишет «Ненадёжный разработчик»: Настройки → Основные → VPN и управление
     устройством → доверять.
4. В приложении: «Тест-панель» → адрес `http://<IP Mac>:8787` → «Сохранить». iOS спросит доступ к
   локальной сети — разрешить; macOS может спросить про входящие соединения для `node` — разрешить.

Debug-сборка с dev-клиентом (`-configuration Debug`) тоже возможна, но тогда Metro должен быть
доступен телефону: `npx expo start --dev-client --lan` в `app/`. На устройстве проверялась только
Release-сборка.

### iOS — симулятор

Матрица приёмки записана на симуляторе (см. «Фактические результаты»). Адрес по умолчанию
`http://127.0.0.1:8787` работает без настройки.

```bash
npm run mock
cd app
npx expo prebuild --platform ios --no-install && (cd ios && LANG=en_US.UTF-8 pod install)
xcodebuild -workspace ios/StatementImport.xcworkspace -scheme StatementImport -configuration Release \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ~/Library/Developer/Xcode/DerivedData/StatementImport-sim build \
&& xcrun simctl install booted ~/Library/Developer/Xcode/DerivedData/StatementImport-sim/Build/Products/Release-iphonesimulator/StatementImport.app \
&& xcrun simctl launch booted dev.candidate.statementimport
```

`npx expo run:ios` тоже подходит; на этой машине он может падать с «Can't determine id of
Simulator app» — тогда команды выше. Файлы для picker'а: перетащите фикстуры в окно
симулятора или скопируйте их в «Файлы → На iPhone».

### Android

```bash
cd app
npx expo prebuild --platform android
npx expo run:android            # debug dev build на эмуляторе/устройстве
adb reverse tcp:8787 tcp:8787   # чтобы 127.0.0.1:8787 на устройстве вёл на mock на Mac
```

Debug-сборка разрешает cleartext HTTP (шаблон RN/Expo для debug). **Не проверено**, см. ниже.

## Переключение сценариев

В приложении: «Тест-панель» (правый верхний угол; помечена как тестовый инструмент) —
сценарии `happy / lost_ack / stale_status / delete_failure`, «Сбросить mock», живые счётчики
`/__test/state` (раз в секунду), адрес API, «Очистить данные на устройстве».

Или из терминала:

```bash
curl -X POST http://127.0.0.1:8787/__test/reset
curl -X POST http://127.0.0.1:8787/__test/scenario -H 'Content-Type: application/json' -d '{"mode":"lost_ack"}'
curl -s http://127.0.0.1:8787/__test/state | python3 -m json.tool
node tools/record-mock-state.mjs http://127.0.0.1:8787 docs/evidence/run.jsonl   # журнал изменений
```

Исходники между прогонами не меняются.

## Как это устроено (коротко)

- `app/src/core` — платформонезависимое ядро (без React Native), полностью тестируется в Node:
  - `jobReducer.ts` — единственное место слияния статусов сервера: применяется только строго
    большая ревизия; `deleted` терминален; чужой `jobId` игнорируется.
  - `importController.ts` — машина состояний операции: ключ (`expo-crypto` UUID v4) и запись
    (ключ, фаза, путь к копии, размер, формат, SHA-256) сохраняются **до** POST; каждый переход
    сохраняется; неизвестный исход → `GET /imports/by-key/{key}` с backoff; 404 → пользователь
    повторяет с тем же ключом и теми же байтами (SHA-256 сверяется); relaunch ничего не
    переотправляет сам; опрос с backoff только на переднем плане; удаление со своим ключом,
    сохранённым до первого DELETE; «удалено» — только после GET `deleted`.
  - `validation.ts` — `%PDF-` или заголовок `date,description,amount` (BOM, CRLF); лимит 10 МиБ
    по метаданным до чтения содержимого; читаются только первые 64 байта.
  - `presentation.ts` — что экран вправе утверждать в каждом состоянии (покрыто тестами).
  - `logger.ts` — единственный логгер, allow-list полей и значений; имя файла, байты, описания не
    проходят; в release-сборке не пишет ничего.
- `app/src/platform` — Expo: `expo-document-picker` (`copyToCacheDirectory: true`), копия
  переносится в `cache/statement-import/<uuid>.bin`; размер из метаданных; заголовок через
  `FileHandle.readBytes(64)`; SHA-256 нативно (`File.digest`); загрузка `File.upload(...,
  BINARY_CONTENT)` — нативный стриминг из файла, 10 МиБ не попадают в JS-память.
  Что реально ушли байты файла, видно по `acceptedBytes` и `sha256` в `/__test/state`: тест-панель
  сравнивает серверный SHA-256 с локальным.
- `app/src/ui` — экран импорта (таймлайн статусов — главный элемент), карточка «Подробнее»
  (без отмены подписки), тест-панель.

## Устройства и фактические результаты

### iOS

| | Симулятор | Физическое устройство |
|---|---|---|
| Устройство | iPhone 16 Pro Simulator, iOS 18.6 (22G86) | iPhone 14 Pro (iPhone15,2), **iOS 27.2.1** (24B156), по Wi‑Fi |
| Сборка | Release, Expo SDK 58 / React Native 0.88.1, Xcode 27.2 | то же, подпись личной командой разработчика |
| Mock | `http://127.0.0.1:8787` | `HOST=0.0.0.0`, `http://<IP Mac>:8787` |

**Симулятор — матрица приёмки пройдена целиком (19.11.2026).** Видео с подписями:
[`docs/evidence/ios-sim/walkthrough.mp4`](docs/evidence/ios-sim/walkthrough.mp4) (1 мин);
полные записи без монтажа — `docs/evidence/ios-sim/clips/`; снимки `GET /__test/state` до и
после — `docs/evidence/ios-sim/*.json`.

| Сценарий | Что видно на экране | `/__test/state` до → после |
|---|---|---|
| happy (`statement.csv`) | picker → подтверждение (112 Б, CSV по содержимому) → «В очереди» → «Обрабатывается» → «Отчёт готов» 151.99 AUD → «Подробнее» → удаление → «Удалено с сервера» (GET deleted/5) | createRequests 0→1, newJobs 0→1, acceptedBytes 0→112, deleteRequests 0→1; SHA-256 на mock = SHA-256 фикстуры |
| lost_ack + перезапуск (`statement.pdf`) | «Исход отправки неизвестен», отсчёт до проверки по ключу; приложение убито (`simctl terminate`) и открыто снова → by-key → «Отчёт готов» | createRequests 0→1, **newJobs 0→1**, duplicateHits 0, acceptedBytes 33882 |
| stale_status | первый GET — ready/3; «Обновить статус» → processing/2 проигнорирован, экран остаётся «Отчёт готов» | newJobs 1; задание на mock ready/3 |
| delete_failure | «Удалить» → 503 → «Не удалено, данные остаются на сервере»; happy → «Повторить удаление» тем же ключом → «Удалено с сервера» | deleteRequests 0→1 (503) →2; задание ready/3 → deleted/5 |
| spoofed + oversize | «Это не PDF»; «Файл больше 10 МиБ» (по метаданным, содержимое не читалось) | **createRequests 1→1** (не изменился) |

**Физический iPhone 14 Pro:** Release-сборка собрана, установлена (`devicectl`) и запускается;
mock доступен по LAN. Сценарии на телефоне проходит владелец вручную по
`docs/VIDEO_SCRIPT.md` с записью экрана iOS — результаты: _<заполнить после прогона>_.

**Крупный шрифт и тёмная тема (симулятор):** максимальный размер Dynamic Type (AX5) + тёмная
тема — экраны «пусто», подтверждение и «Отчёт готов», все основные действия доступны прокруткой,
ничего не обрезано (`docs/evidence/ios-sim/a11y/`). Найденная проблема (заголовок ломался по
буквам) исправлена ограничением роста «хрома» до 1.4×, контента — до 2×.
**iPhone SE (маленький экран) — НЕ ПРОВЕРЕН** отдельным прогоном.

Найдено и исправлено во время прогона: долгий показ системного picker'а без обратной связи
(добавлен индикатор), формулировка отказа по размеру (точные байты), подпись шага «Отправка»
после восстановления по ключу. Видео записано на сборке до этих правок текста.

### Android — НЕ ПРОВЕРЕНО

На машине разработки нет Android SDK, эмулятора и Java (в `~/Library/Android/sdk` только
заглушка `adb`). Код и конфигурация кроссплатформенные (SAF picker, `cacheDir`, `adb reverse`),
но запуск, picker и импорт на Android **не проверялись**. Ни один пункт для Android не отмечен
как работающий.

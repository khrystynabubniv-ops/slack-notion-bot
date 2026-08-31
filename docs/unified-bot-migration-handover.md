# Handover / Migration Specification — Slack → Notion Tasks Bot

> Технічна специфікація поточного стану бота `slack-notion-bot`, побудована на повному читанні коду репозиторію (`src/**`, `docs/**`, `README.md`, `package.json`, `railway.json`, `.env.example`). Документ призначений для інженера, який переносить цю функціональність в інший (unified company) Slack-бот. Усі назви, лейбли, значення й правила наведені буквально, без переказу.

---

## 1. Огляд і призначення бота

**Що робить.** Slack-бот `Tasks Bot` дозволяє співробітникам створювати робочі запити (задачі) через короткий бриф у Slack modal-формі. Бот:

1. Показує вибір команди/типу задачі у Slack (slash-команди `/new-task`, `/event-request`, або кнопка в App Home).
2. Приймає бриф через модальні форми (набір і кількість полів залежать від відділу і типу задачі).
3. Створює відповідну сторінку в Notion database (кожен відділ пише у свою базу).
4. Надсилає користувачу в Slack DM-тред підтвердження з посиланням на Notion-сторінку.
5. Фоновий поллер (окремий цикл на кожен активний відділ) періодично перевіряє статус і нові відкриті коментарі в Notion і надсилає апдейти назад у той самий DM-тред.
6. Текстові відповіді користувача в цьому DM-треді автоматично переносяться в Notion як коментарі до задачі.
7. Для Design-відділу підтримується цикл "правок" (feedback rounds): sub-item-задачі-правки, кнопки прийняття результату, quality survey (5-зіркова оцінка + опційний коментар з категоріями) при завершенні задачі.

**Для кого.** Внутрішній корпоративний бот (Universe Group / uni.tech).

**Активні відділи (`src/config/departments.js`):**

| Департамент (key) | Умова активності | Що пише в Notion |
|---|---|---|
| `design` | завжди активний | база Design (`NOTION_DESIGN_DATABASE_ID`), поведінково базовий/легасі-відділ |
| `smm` | завжди активний | Activities database, `Team=SMM` |
| `event` | активний, коли `EVENT_DEPARTMENT_ENABLED=true` **або** заданий `NOTION_EVENT_DATABASE_ID` | Activities database, `Team=Event`; у продакшн-середовищі `EVENT_DEPARTMENT_ENABLED=true`, тобто Event активний у picker-і нарівні з Design і SMM |

`RESERVED_DEPARTMENT_KEYS = ['pr', 'employer_brand']` — ключі, зарезервовані під майбутні відділи; ніде більше в коді не використовуються.

**Архітектура:**

- **Slack**: `@slack/bolt` v3, HTTP-режим (не Socket Mode), через `ExpressReceiver`. Один Express-застосунок обслуговує і Slack events/interactivity (стандартний Bolt-шлях `/slack/events`), і власні маршрути (`/`, `/notion/design-task-launch`).
- **Notion**: `@notionhq/client` v2 (`Client`). Кожен модуль, що звертається до Notion, створює свій власний екземпляр `Client` (єдиного спільного client-модуля немає), але буквально кожен виклик SDK обгорнутий у спільний rate-limit/retry wrapper `notionRequest` з `src/notion/request.js`.
- **Redis**: `@upstash/redis` v1 (Upstash REST API, не TCP-клієнт). Зберігає: трекінг задач (стан для поллінгу статусу/коментарів), sorted-set чергу сабмітів задач, чернетки невдалих сабмітів, quality-feedback записи, launch-context з Notion webhook, ідемпотентність синку Slack-тред → Notion-коментар.
- **`dotenv`** — завантаження `.env` (`import 'dotenv/config'` на початку `src/index.js`).

**Стек і версії (з `package.json`):**

```json
{
  "name": "slack-notion-bot",
  "version": "1.0.0",
  "type": "module",
  "main": "src/index.js",
  "dependencies": {
    "@slack/bolt": "^3.19.0",
    "@notionhq/client": "^2.2.15",
    "@upstash/redis": "^1.34.0",
    "dotenv": "^16.4.5"
  }
}
```

`package.json` scripts: `start` (`node src/index.js`), `verify:ids`, `verify:department-key`, `verify:polling-guard`, `verify:notion-throttle`, `verify:pure-helpers`, агрегований `verify` (запускає всі п'ять послідовно), `backfill:department-key`. Деталі — розділ 16.

---

## 2. Архітектура і потік виконання

### 2.1 Загальний потік

`Slack modal submit` → `app.view(tasksbot_submit_task)` (`src/handlers/submission.js`) → валідація дедлайну проти SLA → `enqueueTaskSubmission()` (Redis ZSET) → миттєве повідомлення користувачу "прийнято в чергу" → фоновий queue worker створює Notion-сторінку через `createNotionPage()` → DM-повідомлення з посиланням у Notion → фоновий поллер (`startPolling()`) періодично звіряє статус/коментарі та шле апдейти в той самий Slack-тред → текстові відповіді користувача в цьому треді синхронізуються назад у Notion як коментарі.

### 2.2 Черга сабмітів задач (Redis sorted set)

Після сабміту модалки бот не тримає Slack-запит відкритим, поки Notion відповідає (Notion-запит може зайняти секунди, а Slack очікує `ack` за 3 секунди). Натомість:

1. `app.view(tasksbot_submit_task)` одразу викликає `enqueueTaskSubmission(payload)` — записує весь payload у Redis (`task-submission-queue-item:<id>`) і додає `id` у ZSET `task-submission-queue` зі score = час, коли елемент стає "due".
2. Фоновий worker (`startTaskSubmissionQueueWorker`, запускається один раз при старті процесу з `registerSubmissionHandlers(app)`) кожні `TASK_SUBMISSION_QUEUE_INTERVAL_MS` (за замовчуванням 5000 мс) викликає `processQueuedTaskSubmissions()`, а також одразу після кожного нового сабміту (`setTimeout(..., 0)`), щоб користувач не чекав повний тік.
3. Worker захищений від паралельного виконання в межах ОДНОГО процесу через module-scope м'ютекс-флаг `queueWorkerProcessing` (якщо попередній прохід ще не завершився — новий виклик одразу виходить).
4. На старті кожного проходу викликається `recoverOrphanedTaskSubmissions({ excludeIds: [...активні зараз id] })` — сканує всі ключі `task-submission-queue-item:*`, і якщо якийсь `id` відсутній у ZSET (осиротів через рестарт/деплой у момент між записом item і `zadd`), повертає його в чергу з `score = min(nextAttemptAt, now)`. Це гарантує, що задача не "застрягне" у статусі "прийнято в чергу" назавжди після рестарту процесу.
5. Далі worker у циклі викликає `getDueTaskSubmission()`, поки та не поверне `null` (черга порожня):
   - Якщо потрібний `payload` для `id` не знайдено (`missing: true` — payload протух за TTL, поки worker довго не піднімався), worker логує попередження і робить `continue`, а не `break` — тобто **пропускає лише цей конкретний зіпсований елемент і продовжує обробляти решту черги в тому самому проході**, замість того щоб зупинити весь батч через одну "сироту".
   - В іншому разі викликає `createTaskFromSubmissionPayload()` (реальне створення Notion-сторінки + DM-повідомлення + опційне повідомлення в канал команди). При успіху — `completeTaskSubmission()` (видаляє item і прибирає з ZSET).
   - При помилці: якщо це retriable-помилка (`code === 'rate_limited'`, `status/statusCode === 429` або `>= 500`) і кількість спроб < `TASK_SUBMISSION_QUEUE_MAX_ATTEMPTS` (за замовчуванням 20) — `requeueTaskSubmission()` з обчисленою затримкою (`Retry-After`-заголовок + 30с буфер, або експоненційний backoff `TASK_SUBMISSION_QUEUE_RETRY_DELAY_MS * 2^attempt`, з межею `TASK_SUBMISSION_QUEUE_MAX_RETRY_DELAY_MS`); користувачу лише на 1-й спробі й далі кожні 5 спроб надсилається DM про затримку. Якщо помилка не retriable або спроби вичерпано — `failQueuedSubmission()` зберігає чернетку (`failed-submission:<draftId>`) і повідомляє користувача код чернетки.

### 2.3 Фоновий поллер Notion

Один раз при старті `src/index.js` викликає `startPolling(app.client)` (`src/notion/pollStatus.js`). Для кожного активного відділу (`getAllDepartments()`) плануються окремі `setTimeout`+`setInterval` з інтервалом `department.pollIntervalSec` секунд (за замовчуванням 180). `startPolling()` захищений module-scope прапорцем-одинаком `pollingStarted`: повторний виклик у тому самому процесі просто логує попередження `startPolling() called again in the same process — ignoring, polling is already running.` і виходить без побудови нового набору таймерів. Деталі циклу — розділ 10.

### 2.4 Синк Slack-тред → Notion-коментар

`registerThreadCommentSync(app)` (`src/slack/threadComments.js`) слухає всі Slack-події `message`, вручну фільтрує до людських реплаїв у тредах DM-каналів (не bot-луна, є `thread_ts ≠ ts`, `channel_type === 'im'`), знаходить відповідну Notion-задачу за Slack-тредом (`getTaskBySlackThread`) і створює Notion-коментар. Захист від дублювання/mirror-петлі — Redis-ключ `slack-thread-comment-sync:<syncId>` з `SET NX`. Деталі — розділ 12.

### 2.5 Feedback / revision round (тільки Design, `supportsFeedbackRounds: true`)

Кнопка "✏️ Дати правки" на кореневому повідомленні задачі (тільки коли статус `Comments` і відділ — Design) відкриває модалку правок → сабміт створює sub-item-сторінку в Notion (`Parent item` relation, `Sub-type = правка`) і трекає її як окремий Redis-запис із `taskKind: 'feedback'`. Деталі — розділ 11.

### 2.6 Quality survey

Надсилається одноразово при переході задачі у "завершальний" статус: для Design — на `Ready` (`NOTION_DESIGN_QUALITY_SURVEY_STATUSES`, за замовчуванням `Ready`); для SMM — на `Published` (`NOTION_SMM_QUALITY_SURVEY_STATUSES`, за замовчуванням `Published`); для Event `NOTION_EVENT_QUALITY_SURVEY_STATUSES` за замовчуванням порожній рядок — тобто quality survey для Event зараз не надсилається (умова `isQualitySurveyStatus` для порожнього списку в Event підпадає під загальний fallback "статус містить `ready`/`реді`", але поточні статуси Event (`Backlog`/`Done`/`Completed`/`Canceled`/`Cancelled`) цій умові не відповідають). Ідемпотентність — Redis-запис `feedback:<pageId>.feedbackSurveySentAt`, перевіряється через `markFeedbackSurveySent` (перший виклик повертає `alreadySent:false` і записує позначку, повторні — `alreadySent:true`).

### 2.7 Відновлення чернеток невдалих сабмітів

Якщо Notion остаточно відхилив створення сторінки (після вичерпання ретраїв черги, або якщо сам запис у чергу не вдався), бот зберігає весь payload брифу в Redis під ключем `failed-submission:<draftId>` (TTL `FAILED_SUBMISSION_TTL_SECONDS`, за замовчуванням 30 днів) і повідомляє користувачу код `draftId` у Slack. Адмін може вручну дістати payload із Redis і відновити задачу без повторного заповнення форми користувачем.

---

## 3. Усі Slack routes / entry points

### 3.1 Slash-команди (`app.command`, `src/handlers/newTask.js`)

| Команда | Дія |
|---|---|
| `/new-task` | `views.open` з `buildInitialTaskEntryView()` — стартова модалка (вибір відділу, або одразу вибір напрямку/типу задачі, якщо активний лише один відділ) |
| `/event-request` | `views.open` з `buildTaskTypePickerView('event')` — одразу відкриває пікер типів задач Event, минаючи вибір відділу й крок домену |

### 3.2 `app.action(...)` — точні action_id / regex (`src/config/interactionIds.js`, namespace `tasksbot_`)

| Дія | Поточний action_id | Legacy action_id (теж приймається) | Де зареєстровано | Механізм |
|---|---|---|---|---|
| Відкрити нову задачу з App Home | `tasksbot_open_new_task_from_home` | `open_new_task_from_home` | `src/slack/home.js` | `currentAndLegacyActionIdPattern(...)` |
| Прийняти правку/задачу | `tasksbot_accept_task_result` | `accept_task_result` | `src/index.js` | `currentAndLegacyActionIdPattern(...)` |
| Відкрити модалку правок | `tasksbot_open_feedback_modal` | `open_feedback_modal` | `src/index.js` | `currentAndLegacyActionIdPattern(...)` |
| Quality rating (1–5) | `tasksbot_quality_rating_N` (`buildQualityRatingActionId(rating)`) | `quality_rating_N` | `src/index.js` | `qualityRatingActionIdPattern()` (regex, приймає обидва префікси + `_N`) |
| Вибір Platform у Design-формі | `tasksbot_platform` | — (legacy-варіанта немає) | `src/handlers/submission.js` | точний match `ACTION_IDS.platform`, всередині гард `isSubmitTaskView(body.view?.callback_id)` |
| SMM/Event умовні поля (`showWhen`-контролери) | regex `/^(structure_choice\|ready_texts\|visual_source\|link_needed\|title_description\|thumbnail\|ad_goal\|fixed_budget\|source_materials)$/` | — | `src/handlers/submission.js` | гард `isSubmitTaskView(...)` + `resolveDepartmentKey(departmentKey) === DEFAULT_DEPARTMENT_KEY` (спрацьовує тільки для НЕ-Design відділів) |

Ці три пари (`accept_task_result`, `open_feedback_modal`, `quality_rating_N`) і `open_new_task_from_home` приймають одночасно і новий (`tasksbot_`-namespaced), і легасі (pre-namespace) action_id, тому що ці конкретні action_id "заморожені" всередині вже надісланих Slack-повідомлень (кнопки на задачах, які можуть перебувати в роботі тижнями — лід-тайм окремих типів задач сягає 45–60 днів). Перейменування коду не змінює текст уже надісланих повідомлень заднім числом, тому без legacy-гілки кнопки на цих старих повідомленнях стали б мертвими одразу після деплою з перейменуванням. Модалки (`app.view`) такої проблеми не мають — модалка живе лише в межах однієї сесії користувача, тому в жодного `VIEW_CALLBACK_IDS` legacy-варіанта немає.

Дії вибору кроків візарда (`department`, `domain`, `task_type`, `complexity`) використовують прості, не namespaced action_id всередині `static_select`-елементів модалок, але маршрутизація між кроками відбувається не через `app.action` на них, а через `app.view` на callback_id відповідної модалки (Slack надсилає весь `view.state.values` при сабміті модалки незалежно від action_id окремих полів).

### 3.3 `app.view(...)` — точні callback_id

| Крок | callback_id | Обробник |
|---|---|---|
| Вибір відділу | `tasksbot_select_department` | `src/handlers/submission.js` |
| Вибір напрямку (тільки Design) | `tasksbot_select_design_domain` | `src/handlers/submission.js` |
| Вибір типу задачі | `tasksbot_select_task_type` | `src/handlers/submission.js` |
| Вибір складності (Event-типи з рівнями) | `tasksbot_select_task_complexity` | `src/handlers/submission.js` |
| Фінальний бриф задачі | `tasksbot_submit_task` | `src/handlers/submission.js` |
| Сабміт правки | `tasksbot_feedback_submission` | `src/index.js` → `handleFeedbackSubmission` |
| Сабміт quality feedback (коментар до оцінки 1–4) | `tasksbot_quality_feedback_submission` | `src/index.js` → `handleQualityFeedbackSubmission` |

`isSubmitTaskView(callbackId)` = `callbackId === VIEW_CALLBACK_IDS.submitTask` — саме ця перевірка застосована як гард у `platform`-екшені і в SMM/Event regex-обробнику умовних полів: без неї обробники спрацьовували б на БУДЬ-яке поле з таким самим action_id у БУДЬ-якій відкритій в workspace модалці — включно з модалками іншого (unified) бота, якщо коли-небудь буде злито в один Slack App — і псували б чужий `view` через `views.update`.

### 3.4 `app.event(...)`

| Подія | Обробник |
|---|---|
| `app_home_opened` | `src/slack/home.js` — публікує App Home view |
| `message` (фільтрується вручну до DM-реплаїв) | `src/slack/threadComments.js` — синк Slack-тред → Notion-коментар |

### 3.5 HTTP endpoints на Express receiver (`src/index.js`)

| Метод + шлях | Призначення |
|---|---|
| `GET /` | Healthcheck, повертає `OK` |
| `POST /` | Обробляє Slack `url_verification` challenge (`{challenge}`), інакше передає далі в Bolt-стек через `next()` |
| `POST /slack/events` | Стандартний Bolt-шлях для всіх Slack events/interactivity payload (slash-команди, actions, view submissions) |
| `POST /notion/design-task-launch` | Webhook від Notion (`registerNotionLaunchWebhook`, `src/notion/launchWebhook.js`) — приймає launch-контекст для батьківської задачі. Деталі — розділ 8. |

`ExpressReceiver` створений з `processEventErrorHandler` (логує помилку через `logSlackReceiverIssue` і відповідає `500`, якщо заголовки ще не надіслані) і `unhandledRequestHandler` (логує, що запит не був підтверджений вчасно, відповідає `404`).

### 3.6 Stub-режим (без `SLACK_BOT_TOKEN`)

Якщо `SLACK_BOT_TOKEN` не заданий, порожній, або дорівнює рядку `placeholder`, процес не піднімає Bolt/Express App узагалі. Замість цього стартує сирий Node `http`-сервер на `PORT`, який відповідає на `url_verification` challenge (щоб Slack App configuration міг пройти перевірку Request URL ще до апруву токена) і повертає `200 Bot is waiting for Slack token approval.` на будь-який інший запит. Це дозволяє задеплоїти сервіс і налаштувати Slack App Request URL ще до того, як токен доступний, не падаючи в crash loop.

---

## 4. Повний покроковий флоу створення задачі (Slack modal wizard)

1. **Вхід.** Користувач викликає `/new-task`, відкриває App Home і тисне кнопку `➕ Створити запит` (`tasksbot_open_new_task_from_home`), або (тільки для Event) викликає `/event-request`. `/new-task` і кнопка App Home відкривають `buildInitialTaskEntryView()`: якщо активних відділів більше одного (`getAllDepartments().length > 1` — зараз завжди так, бо активні мінімум Design і SMM) — показує пікер відділу (крок 2); інакше, якщо єдиний активний відділ — Design, одразу показує пікер напрямку (крок 3); інакше — одразу пікер типу задачі (крок 4).

2. **Крок "Вибір відділу"** — `callback_id: tasksbot_select_department`. Заголовок `Новий запит`, submit `Далі`, close `Скасувати`. Секція `Куди летить запит?`, `static_select` `department_block/department` (placeholder `Обери команду...`), опції — активні відділи у форматі `{emoji} {label}` (`🎨 Design`, `📱 SMM`, `🎪 Event`), значення = ключ відділу. При сабміті: якщо не обрано — помилка на полі `Обери команду.`; якщо обрано Design — `response_action: update` на `buildDesignDomainPickerView`; інакше — одразу на `buildTaskTypePickerView(departmentKey)`.

3. **Крок "З якого ти напрямку?"** (тільки Design) — `callback_id: tasksbot_select_design_domain`. Заголовок `{emoji} Новий запит`, submit `Далі`. Секція `З якого ти напрямку?`, `static_select` `domain_block/domain` (placeholder `Обери напрямок...`), опції рівно: `PR`, `SMM`, `Employer Brand`, `Команда Офісу`, `Рекрутинг/HR`, `Внутрішні комунікації`. Значення потім записується в Notion-властивість `domain` (multi_select) через `ensureSelectOptionsExist` + `addPropertyByDatabaseType`. При сабміті без вибору — помилка `Обери напрямок.`; інакше — `buildTaskTypePickerView(departmentKey, {domain})`.

4. **Крок "Вибір типу задачі"** — `callback_id: tasksbot_select_task_type`. Заголовок `{emoji} Новий запит`, submit `Далі`. Секція: для Design — `Обери тип запиту — далі побачиш потрібні поля для брифу.`; для інших відділів — `Обери тип запиту для {label} — далі побачиш потрібні поля для брифу.`. `static_select` `task_type_block/task_type` (placeholder `Вибери тип...`), `option_groups` = групи типів задач відповідного відділу (розділ 6). При сабміті без вибору — помилка `Обери тип запиту.`; якщо в обраного типу є `complexityOptions` (Event: `event_internal`, `event_external`, `conference`, `gifts_custom`, `stand_concept`) — переходить на крок складності; інакше — одразу на фінальну форму брифу.

5. **Крок "Складність"** (тільки перелічені вище Event-типи) — `callback_id: tasksbot_select_task_complexity`. Заголовок `🎪 Складність`. Секція: `Обери рівень складності для *{taskTypeLabel}*.` + по рядку на кожен варіант `*{label}* — {description}`. `static_select` `complexity_block/complexity` (placeholder `Обери рівень...`). При сабміті без вибору — помилка `Обери рівень складності.`; інакше `resolveTaskTypeComplexity` перетворює category-тип + складність на конкретний task type (наприклад `event_internal` + `medium` → `event_internal_medium`) і переходить на фінальну форму.

6. **Фінальна форма брифу** — `callback_id: tasksbot_submit_task`, заголовок `📋 Бриф задачі`, submit `Створити задачу`, close `Скасувати`. `private_metadata` містить `{departmentKey, taskType, taskTypeLabel, domain}`. Блоки будує `getModalBlocks(taskType, values, {departmentKey, leadTimeWarning})` (`src/handlers/modalBlocks.js`):
   - **Design** (`departmentKey === 'design'`): статичні блоки `baseBlocks()` (спільні для всіх Design-типів) + специфічні блоки типу задачі (`specificBlocks[taskType]`, розділ 7.6), розділені `divider()`.
   - **SMM/Event**: динамічні поля, побудовані з `getDepartmentTaskFields(departmentKey, taskType)` (`config/departments.js`, розділ 7.1–7.4) — назва задачі (`nameLabel`/`namePlaceholder` з конфігу типу) + всі видимі поля (з урахуванням `showWhen`).
   - Живі оновлення всередині цієї самої модалки (без переходу на новий callback_id, через `views.update`):
     - Design, поле `Platform` (`action_id: tasksbot_platform`, `dispatch_action: true`) — при виборі `Other` динамічно з'являється текстове поле `📱 Platform (other) *`.
     - SMM/Event, поля-контролери `showWhen` (`structure_choice`, `ready_texts`, `visual_source`, `link_needed`, `title_description`, `thumbnail`, `ad_goal`, `fixed_budget`, `source_materials`) — при зміні значення відповідні залежні поля показуються/ховаються.
   - **Перевірка SLA-дедлайну** при сабміті (`getLeadTimeViolation`): якщо обрана дата дедлайну ближча, ніж `minLeadDays` типу задачі:
     - якщо користувач ще не обрав, як діяти — `response_action: update`, та сама модалка повторно рендериться з доданими зверху блоками попередження `⚠️ Дедлайн ближче за SLA` (текст: `⚠️ За політикою дедлайнів для *{label}* мінімальний термін — *{minLeadText}*.{рекомендований термін, якщо є} Ти вказуєш {N днів}.\nМожеш змінити дату або відправити задачу як late: {дизайн-команда|команда відділу} розгляне її окремо без гарантії виконання в цей термін.`) і `static_select lead_time_override_block/lead_time_override` з опціями `Відправити як late` (`late`) / `Змінити дату` (`change_date`);
     - якщо обрано `Змінити дату` — `response_action: errors` на блок дедлайну: `Зміни дату: для цього типу мінімальний термін — {label}.`;
     - якщо обрано `Відправити як late` — сабміт проходить далі з `isLate = true` (у Notion виставляється checkbox `Late`; для Event також у DM-повідомленні з'являється попереджувальний рядок про запізнення — розділ 5/8).

7. **Прийняття сабміту.** `ack()` без подальших оновлень view. Payload складається (включно з усіма зібраними полями) і кладеться в чергу через `enqueueTaskSubmission()` (розділ 2.2). Користувач одразу отримує DM: `🕐 Задачу прийнято в чергу.\n{назва}\nЗараз у боті багато запитів, тому створення задачі може зайняти трохи більше часу. Напишу тут, щойно задача буде готова.`

8. **Фонове створення задачі.** Queue worker створює Notion-сторінку (`createNotionPage`, розділ 8) і надсилає користувачу DM з посиланням і кнопкою; для Design/SMM текст `Ми отримали твій запит!\n*{taskName}*\n⚪ *Статус:* {status}\n🎨/🎨 *{Дизайнер|Відповідальний}:* {ім'я}\n\n{текст про передачу в команду}`; для Event — `🎪 *Твій запит прийнято!*\n\n*{taskName}*\n📋 Тип: {type}\n📅 Дедлайн: {DD.MM.YYYY}\n🔄 Статус: *Backlog*\n👤 Відповідальна: {mention/label}\n{опційний late-варнінг}\n\nЗаявку створено й передано далі. Я оновлюватиму статус у цьому повідомленні й окремо напишу, коли він зміниться.` Якщо в департамента заданий `notifyChannel` — додатково надсилається повідомлення в командний канал з кнопкою `📋 Відкрити в Notion`.

---

## 5. Департаменти — повна конфігурація

Конфігурація живе в `src/config/departments.js`. Кожен запис відділу має: `key`, `label`, `emoji`, `notionDataSourceId`, `notionTemplateId`, `hubUrl`, `feedbackDatabaseId`, `statusProperty`, `initialStatus`, `completedStatuses`, `qualitySurveyStatuses`, `supportsFeedbackRounds`, `pollIntervalSec`, `notifyChannel`, `ownerId`, `ownerLabel`, `team`, `taskTypeGroups`, `taskTypes` (+ опційно `useBodyBrief`, `defaultProperties`, `ownerSlackId`, `active`).

### 5.1 `design`

| Поле | Джерело / fallback-ланцюжок | Поточне значення за замовчуванням |
|---|---|---|
| `notionDataSourceId` | `NOTION_DESIGN_DATABASE_ID` → `NOTION_DATABASE_ID` | — (обов'язково задати одну з них) |
| `notionTemplateId` | `NOTION_DESIGN_TEMPLATE_ID` → `NOTION_TEMPLATE_ID` | — |
| `hubUrl` | `NOTION_DESIGN_HUB_URL` → `NOTION_BRAND_DESIGN_HUB_URL` → хардкод | `https://www.notion.so/Brand-Design-Hub-33cce9899cb7814488c0f439326aaf2a?source=copy_link` |
| `feedbackDatabaseId` | `NOTION_DESIGN_FEEDBACK_DATABASE_ID` → `NOTION_FEEDBACK_DATABASE_ID` → `null` | якщо обидві порожні — використовується глобальний хардкод-fallback `164e70dbe0774b8ca7fa761ab2f0e6a5` у `feedbackDatabase.js` |
| `statusProperty` | `NOTION_DESIGN_STATUS_PROPERTY` → `NOTION_STATUS_PROPERTY` → хардкод | `Design Status` |
| `initialStatus` | `NOTION_DESIGN_INITIAL_STATUS` → хардкод | `To do` |
| `completedStatuses` | `NOTION_DESIGN_COMPLETED_STATUSES` → `NOTION_POLL_COMPLETED_STATUSES` → хардкод | `Ready,Cancelled,Canceled` |
| `qualitySurveyStatuses` | `NOTION_DESIGN_QUALITY_SURVEY_STATUSES` → хардкод | `Ready` |
| `supportsFeedbackRounds` | — | `true` |
| `pollIntervalSec` | `NOTION_DESIGN_POLL_INTERVAL_SEC` | `180` |
| `notifyChannel` | `DESIGN_CHANNEL_ID` | — (опційно) |
| `ownerId` | `NOTION_DESIGN_OWNER_ID` → хардкод | `f342c30b-c5c1-4a52-8cdf-c8b636928364` |
| `ownerLabel` | `NOTION_DESIGN_OWNER_LABEL` | — |
| `team` | `NOTION_DESIGN_TEAM` → хардкод | `Brand Design` |
| `taskTypeGroups`/`taskTypes` | `designTaskTypeGroups` + `DESIGN_TASK_TYPE_RELATION_IDS` + лід-тайми | 36 типів, 12 груп (розділ 6.1) |

### 5.2 `smm`

| Поле | Джерело / fallback-ланцюжок | Поточне значення за замовчуванням |
|---|---|---|
| `notionDataSourceId` | `NOTION_SMM_DATABASE_ID` → `NOTION_ACTIVITIES_DATABASE_ID` → `NOTION_DATABASE_ID` → хардкод | `b1ff9daa012c41c597e1d5ad5dd91917` |
| `notionTemplateId` | `NOTION_SMM_TEMPLATE_ID` → `NOTION_SMM_TASK_TEMPLATE_ID` → `null` | — |
| `hubUrl` | `NOTION_SMM_HUB_URL` → хардкод | `https://www.notion.so/SMM-Hub-375ce9899cb781aaab1ddb4c30833e23?source=copy_link` |
| `feedbackDatabaseId` | `NOTION_SMM_FEEDBACK_DATABASE_ID` → хардкод | `025dce2c634e4a079ee7600ea8c63253` |
| `statusProperty` | `NOTION_SMM_STATUS_PROPERTY` → хардкод | `SMM статус` |
| `initialStatus` | `NOTION_SMM_INITIAL_STATUS` → хардкод | `To do` |
| `completedStatuses` | `NOTION_SMM_COMPLETED_STATUSES` → хардкод | `Published,Canceled,Cancelled` |
| `qualitySurveyStatuses` | `NOTION_SMM_QUALITY_SURVEY_STATUSES` → хардкод | `Published` |
| `supportsFeedbackRounds` | — | `false` |
| `useBodyBrief` | — | `true` (бриф іде в тіло сторінки, `Description` = `"Опис нижче в тілі задачі."`) |
| `pollIntervalSec` | `NOTION_SMM_POLL_INTERVAL_SEC` | `180` |
| `notifyChannel` | `SMM_CHANNEL_ID` → `SLACK_SMM_NOTIFY_CHANNEL` → `null` | — (опційно) |
| `ownerId` | `NOTION_SMM_OWNER_ID` → хардкод | `77a3e7fe-a555-4c14-b794-d63a6e42a324` |
| `ownerLabel` | `NOTION_SMM_OWNER_LABEL` → хардкод | `Anna Gayuk` |
| `team` | `NOTION_SMM_TEAM` → хардкод | `SMM` |
| `defaultProperties` | — | `{ 'SMM needed': true, 'SMM briefed': true }` |
| `taskTypeGroups`/`taskTypes` | `smmTaskTypeGroups` + `smmTaskTypeConfig` | 14 типів, 4 групи (розділ 6.2) |

### 5.3 `event`

| Поле | Джерело / fallback-ланцюжок | Поточне значення за замовчуванням |
|---|---|---|
| `active` | `isEventDepartmentEnabled()` = `boolEnv('EVENT_DEPARTMENT_ENABLED')` OR `Boolean(env('NOTION_EVENT_DATABASE_ID'))` | у продакшн-середовищі `EVENT_DEPARTMENT_ENABLED=true` — Event активний |
| `notionDataSourceId` | `NOTION_EVENT_DATABASE_ID` → `NOTION_ACTIVITIES_DATABASE_ID` → `NOTION_DATABASE_ID` → хардкод | `b1ff9daa012c41c597e1d5ad5dd91917` |
| `notionTemplateId` | `NOTION_EVENT_TEMPLATE_ID` → `NOTION_EVENT_TASK_TEMPLATE_ID` → хардкод | `34ace9899cb780afb5b5e4ba36e1c2e2` |
| `hubUrl` | `NOTION_EVENT_HUB_URL` → хардкод | `https://www.notion.so/Event-Manager-Hub-366ce9899cb7817580bccd4a2651f925?source=copy_link` |
| `feedbackDatabaseId` | `NOTION_EVENT_FEEDBACK_DATABASE_ID` → `null` | якщо не задано — глобальний хардкод-fallback `164e70dbe0774b8ca7fa761ab2f0e6a5` |
| `statusProperty` | `NOTION_EVENT_STATUS_PROPERTY` → хардкод | `Status` |
| `initialStatus` | `NOTION_EVENT_INITIAL_STATUS` → хардкод | `Backlog` |
| `completedStatuses` | `NOTION_EVENT_COMPLETED_STATUSES` → хардкод | `Done,Completed,Canceled,Cancelled` |
| `qualitySurveyStatuses` | `NOTION_EVENT_QUALITY_SURVEY_STATUSES` → хардкод | `''` (порожньо — quality survey для Event зараз не спрацьовує, розділ 2.6) |
| `supportsFeedbackRounds` | — | `false` |
| `useBodyBrief` | — | `true` |
| `pollIntervalSec` | `NOTION_EVENT_POLL_INTERVAL_SEC` | `180` |
| `notifyChannel` | `EVENT_CHANNEL_ID` → `SLACK_EVENT_NOTIFY_CHANNEL` → `null` | — (опційно) |
| `ownerId` | `NOTION_EVENT_OWNER_ID` → хардкод | `2cdd872b-594c-815b-acd7-000259d98a51` |
| `ownerLabel` | `NOTION_EVENT_OWNER_LABEL` → хардкод | `Mariia Tarasiuk` |
| `ownerSlackId` | `SLACK_EVENT_OWNER_ID` → `SLACK_MARIA_USER_ID` → `null` | використовується для `<@id>`-згадки у DM-повідомленні Event |
| `team` | `NOTION_EVENT_TEAM` → хардкод | `Event` |
| `defaultProperties` | — | `{ 'Event needed': true, 'Event briefed': true, 'Brief received': false }` |
| `taskTypeGroups`/`taskTypes` | `eventTaskTypeGroups` + `eventTaskTypeConfig` | 9 видимих у picker-і + похідні варіанти складності (розділ 6.3) |

Redis-записи трекінгу задач без поля `departmentKey` (записи ще до появи Phase 2) резолвляться як `design` без жодних попереджень — це очікуваний legacy-кейс.

---

## 6. Повний реєстр типів задач (task types) за департаментами

### 6.1 Design — 36 типів, 12 груп

Ключі `DESIGN_TASK_TYPE_RELATION_IDS` мають relation ID на окрему Notion-базу типів задач (властивість `Task Type` записується як relation). Лід-тайми — `leadTimeEnv(ENV_VAR, default[, label])`; коли задано `label`, саме він показується в попередженні SLA замість числа днів.

| Група (picker label) | Ключ | Лейбл у Slack | Notion relation ID | Env-змінна лід-тайму | Дефолт (днів) | Лейбл лід-тайму |
|---|---|---|---|---|---|---|
| 🖼 SMM / Банери | `static_simple` | Статична картинка проста | `752ce989-9cb7-82c6-97ad-81b4b8e8003c` | `DESIGN_STATIC_SIMPLE_MIN_LEAD_DAYS` | 2 | — |
| 🖼 SMM / Банери | `static_complex` | Статична картинка складна | `f5cce989-9cb7-838d-8f7c-0144b56d4a48` | `DESIGN_STATIC_COMPLEX_MIN_LEAD_DAYS` | 4 | — |
| 🖼 SMM / Банери | `carousel` | SMM карусель | `c82ce989-9cb7-820d-ba26-814f5aad916f` | `DESIGN_CAROUSEL_MIN_LEAD_DAYS` | 4 | — |
| 🖼 SMM / Банери | `resize` | SMM ресайзи | `296ce989-9cb7-837b-a4db-0198dca40fc7` | `DESIGN_RESIZE_MIN_LEAD_DAYS` | 2 | — |
| 📣 Promo Creatives | `promo_creo_static_template` | Promo Creo Static (по шаблону) | `349ce989-9cb7-8021-b677-c57985031659` | `DESIGN_PROMO_CREO_STATIC_TEMPLATE_MIN_LEAD_DAYS` | 2 | — |
| 📣 Promo Creatives | `promo_creo_static_ideas` | Promo Creo Static (нові ідеї) | `349ce989-9cb7-8021-b677-c57985031659` | `DESIGN_PROMO_CREO_STATIC_IDEAS_MIN_LEAD_DAYS` | 4 | — |
| 📣 Promo Creatives | `promo_creo_mix_template` | Promo Creo Mix (по шаблону) | `349ce989-9cb7-802c-a7b7-d0a5d88bb981` | `DESIGN_PROMO_CREO_MIX_TEMPLATE_MIN_LEAD_DAYS` | 3 | — |
| 📣 Promo Creatives | `promo_creo_mix_ideas` | Promo Creo Mix (нові ідеї) | `349ce989-9cb7-802c-a7b7-d0a5d88bb981` | `DESIGN_PROMO_CREO_MIX_IDEAS_MIN_LEAD_DAYS` | 11 | `1.5 тижні` |
| 📣 Promo Creatives | `promo_creo_video_template` | Promo Creo Video (по шаблону) | `349ce989-9cb7-8099-b98a-da5724416b6a` | `DESIGN_PROMO_CREO_VIDEO_TEMPLATE_MIN_LEAD_DAYS` | 3 | — |
| 📣 Promo Creatives | `promo_creo_video_ideas` | Promo Creo Video (нові ідеї) | `349ce989-9cb7-8099-b98a-da5724416b6a` | `DESIGN_PROMO_CREO_VIDEO_IDEAS_MIN_LEAD_DAYS` | 11 | `1.5 тижні` |
| 🎬 Монтаж / Анімація | `video_simple` | Монтаж / Анімація простий | `a03ce989-9cb7-8244-915d-816db55e2120` | `DESIGN_VIDEO_SIMPLE_MIN_LEAD_DAYS` | 3 | — |
| 🎬 Монтаж / Анімація | `video_complex` | Монтаж / Анімація складний | `aaece989-9cb7-83e8-8da6-811e658d9abc` | `DESIGN_VIDEO_COMPLEX_MIN_LEAD_DAYS` | 11 | `1.5 тижні` |
| 📊 Презентації | `pres_edit` | Презентація (коригування існуючого) | `c6bce989-9cb7-8334-b0b6-810890bbc828` | `DESIGN_PRES_EDIT_MIN_LEAD_DAYS` | 3 | — |
| 📊 Презентації | `pres_template` | Презентація по шаблону | `29dce989-9cb7-837f-a3f5-812baee600fe` | `DESIGN_PRES_TEMPLATE_MIN_LEAD_DAYS` | 7 | `1 тиждень` |
| 📊 Презентації | `pres_wow` | Wow презентація | `ed0ce989-9cb7-8295-9249-819159d83211` | `DESIGN_PRES_WOW_MIN_LEAD_DAYS` | 14 | `2 тижні` |
| 🤖 ШІ-контент | `ai_static_simple` | ШІ статика проста | `a33ce989-9cb7-83f3-8952-814aaab2dcc1` | `DESIGN_AI_STATIC_SIMPLE_MIN_LEAD_DAYS` | 2 | — |
| 🤖 ШІ-контент | `ai_static_complex` | ШІ статика складна | `375ce989-9cb7-8351-b0df-018fd1e42f11` | `DESIGN_AI_STATIC_COMPLEX_MIN_LEAD_DAYS` | 14 | `2 тижні` |
| 🤖 ШІ-контент | `ai_dynamic_simple` | ШІ динаміка проста | `343ce989-9cb7-81a4-bba2-d1009fd95515` | `DESIGN_AI_DYNAMIC_SIMPLE_MIN_LEAD_DAYS` | 2 | — |
| 🤖 ШІ-контент | `ai_dynamic_complex` | ШІ динаміка складна | `343ce989-9cb7-813f-9728-e155c08a8f53` | `DESIGN_AI_DYNAMIC_COMPLEX_MIN_LEAD_DAYS` | 14 | `2 тижні` |
| 🌐 Веб | `landing_template` | Лендинг по шаблону | `366ce989-9cb7-8386-8625-8190d6befc23` | `DESIGN_LANDING_TEMPLATE_MIN_LEAD_DAYS` | 14 | `2 тижні` |
| 🌐 Веб | `landing_wow` | Wow лендинг з нуля | `8b4ce989-9cb7-8232-bcb6-015790e03b20` | `DESIGN_LANDING_WOW_MIN_LEAD_DAYS` | 42 | `6 тижнів` |
| 🌐 Веб | `blog` | Верстка блогу | `b5fce989-9cb7-8225-81d9-816f4d760cc9` | `DESIGN_BLOG_MIN_LEAD_DAYS` | 1 | — |
| 📰 Email / Дайджест | `digest_simple` | Дайджест базовий по шаблону | `e5bce989-9cb7-8235-a612-81d4b445a8a1` | `DESIGN_DIGEST_SIMPLE_MIN_LEAD_DAYS` | 7 | `1 тиждень` |
| 📰 Email / Дайджест | `digest_wow` | Wow дайджест | `dcace989-9cb7-83a9-ad38-816e3060a9c6` | `DESIGN_DIGEST_WOW_MIN_LEAD_DAYS` | 21 | `3 тижні` |
| 📰 Email / Дайджест | `email_digest` | Email дайджест | `343ce989-9cb7-814b-81d5-ff0505cbe181` | `DESIGN_EMAIL_DIGEST_MIN_LEAD_DAYS` | 7 | `1 тиждень` |
| 👕 Мерч / Поліграфія | `merch_simple` | Мерч простий | `4bbce989-9cb7-83a8-8516-8161b982a0a2` | `DESIGN_MERCH_SIMPLE_MIN_LEAD_DAYS` | 3 | — |
| 👕 Мерч / Поліграфія | `merch_ref` | Мерч по референсах | `b6bce989-9cb7-82da-9c91-81720258436d` | `DESIGN_MERCH_REF_MIN_LEAD_DAYS` | 7 | `1 тиждень` |
| 👕 Мерч / Поліграфія | `merch_research` | Мерч з власним рісьорчем | `c53ce989-9cb7-830f-93a7-81be6d1dd8cb` | `DESIGN_MERCH_RESEARCH_MIN_LEAD_DAYS` | 7 | `1 тиждень` |
| 👕 Мерч / Поліграфія | `print_materials` | Друковані матеріали (постер, флаєр, брошура) | `349ce989-9cb7-8045-8d52-facad67e1175` | `DESIGN_PRINT_MATERIALS_MIN_LEAD_DAYS` | 7 | `1 тиждень` |
| 🎯 Брендинг | `identity` | Айдентика | `0fcce989-9cb7-827c-8b66-01cb5d7f5858` | — | — (лід-тайм не налаштований) | — |
| 🎯 Брендинг | `logo` | Логотип | `3eece989-9cb7-82cd-ac15-0142b897d94b` | — | — | — |
| 📷 Фото | `photo_simple` | Редагування фото просте | `a55ce989-9cb7-820d-a866-010c7a9329bb` | `DESIGN_PHOTO_SIMPLE_MIN_LEAD_DAYS` | 1 | — |
| 📷 Фото | `photo_complex` | Редагування фото складне | `226ce989-9cb7-8256-966e-0164ca4add44` | `DESIGN_PHOTO_COMPLEX_MIN_LEAD_DAYS` | 3 | — |
| 📺 TV / Івент | `tv_announce` | Анонси TV | `3d6ce989-9cb7-82ca-b830-013021cbce03` | `DESIGN_TV_ANNOUNCE_MIN_LEAD_DAYS` | 2 | — |
| 📺 TV / Івент | `tv_static` | Статика UniTV | `665ce989-9cb7-83ba-b05e-817d5cdc90e6` | `DESIGN_TV_STATIC_MIN_LEAD_DAYS` | 7 | `1 тиждень` |
| 📺 TV / Івент | `event_simple` | Івент простий | `587ce989-9cb7-82dd-b8f7-81157ea44ebd` | `DESIGN_EVENT_SIMPLE_MIN_LEAD_DAYS` | 21 | `3 тижні` |
| 📺 TV / Івент | `event_complex` | Івент складний | `4dfce989-9cb7-8372-bc59-01222d1aaa29` | `DESIGN_EVENT_COMPLEX_MIN_LEAD_DAYS` | 60 | `2 місяці` |
| 💡 Інше | `other` | Інша задача / нетиповий запит | `349ce989-9cb7-80f9-832f-c55be91be724` | — | — | — |

Карта `DESIGN_TASK_TYPE_RELATION_IDS` додатково містить базові ключі `promo_creo_static`, `promo_creo_mix`, `promo_creo_video` з тими самими relation ID, що й відповідні `_template`/`_ideas`-варіанти вище — ці базові ключі ніде не з'являються в `designTaskTypeGroups` і не мають власного лейбла, тому фактично не використовуються: у picker-і присутні лише `_template`/`_ideas`-варіанти.

### 6.2 SMM — 14 типів, 4 групи

| Група | Ключ | Лейбл у Slack | Env-змінна лід-тайму | Дефолт (днів) | `defaultProperties` / `defaultPlatforms` |
|---|---|---|---|---|---|
| 📱 Контент для публікації | `reels` | Reels | `SMM_REELS_MIN_LEAD_DAYS` | 4 | `Format: 'Reels'` |
| 📱 Контент для публікації | `carousel_post` | Пост-карусель | `SMM_CAROUSEL_POST_MIN_LEAD_DAYS` | 3 | `Format: 'Carousel'` |
| 📱 Контент для публікації | `announcement_post` | Пост-анонс | `SMM_ANNOUNCEMENT_POST_MIN_LEAD_DAYS` | 2 | `Format: 'Static Image'` |
| 📱 Контент для публікації | `stories` | Сторіз | `SMM_STORIES_MIN_LEAD_DAYS` | 2 | `Format: 'Stories'`, `defaultPlatforms: ['Instagram']` |
| 📱 Контент для публікації | `linkedin_newsletter` | Newsletter LinkedIn | `SMM_LINKEDIN_NEWSLETTER_MIN_LEAD_DAYS` | 4 | `defaultPlatforms: ['LinkedIn']` |
| 🎬 Відео виробництво | `video_production` | Зйомка відео | `SMM_VIDEO_PRODUCTION_MIN_LEAD_DAYS` | 7 | `Format: 'Video'` |
| 🎬 Відео виробництво | `video_editing` | Монтаж відео | `SMM_VIDEO_EDITING_MIN_LEAD_DAYS` (fallback на `SMM_VIDEO_PRODUCTION_MIN_LEAD_DAYS`, немає в `.env.example`) | 7 | `Format: 'Video'` |
| 🎬 Відео виробництво | `youtube_video_publish` | Публікація відео на YouTube | `SMM_YOUTUBE_VIDEO_PUBLISH_MIN_LEAD_DAYS` | 2 | `Format: 'Video'`, `defaultPlatforms: ['YouTube']` |
| 💰 Платне просування | `vacancy_promo_static` | Промо вакансій (статика) | `SMM_VACANCY_PROMO_STATIC_MIN_LEAD_DAYS` | 3 | `Format: 'Static Image'` |
| 💰 Платне просування | `vacancy_promo_video` | Промо вакансій (відео) | `SMM_VACANCY_PROMO_VIDEO_MIN_LEAD_DAYS` | 7 | `Format: 'Video'` |
| 💰 Платне просування | `publication_boost` | Просування публікацій | `SMM_PUBLICATION_BOOST_MIN_LEAD_DAYS` | 2 | — |
| 💰 Платне просування | `blogger_collab` | Колаборація з блогером | `SMM_BLOGGER_COLLAB_MIN_LEAD_DAYS` | 7 | — |
| 📁 Операційне | `drive_upload` | Завантаження фото/відео на диск | `SMM_DRIVE_UPLOAD_MIN_LEAD_DAYS` | 1 | — |
| 📁 Операційне | `event_report` | Звіт з івенту | `SMM_EVENT_REPORT_MIN_LEAD_DAYS` | 3 | — |

### 6.3 Event — 9 видимих у picker-і типів + похідні варіанти складності

`eventTaskTypeGroups` містить лише одну групу `🎪 Event` з такими опціями:

| Ключ у picker-і | Лейбл | Механізм лід-тайму |
|---|---|---|
| `merch` | Виготовлення мерчу | плоский `EVENT_MERCH_MIN_LEAD_DAYS` (дефолт 45, лейбл `45 днів`, рекомендація `2 місяці`) |
| `event_internal` | Організація події (внутрішня локація) | пікер складності → `event_internal_simple/medium/complex` |
| `event_external` | Організація події (зовнішня локація) | пікер складності → `event_external_simple/medium/complex` |
| `conference` | Підготовка до виїзної конференції / ярмарку | пікер складності → `conference_simple/medium/complex` |
| `gifts_ready` | Підготовка та відправка подарунків (готова продукція) | плоский `EVENT_GIFTS_READY_MIN_LEAD_DAYS` (дефолт 1, лейбл `1 день`, рекомендація `3 дні`) |
| `gifts_custom` | Підготовка та відправка подарунків (індивідуальне виготовлення) | пікер складності → `gifts_custom_simple/medium/complex` |
| `activity` | Організація активності на зовнішній локації | плоский `EVENT_ACTIVITY_MIN_LEAD_DAYS` (дефолт 21, лейбл `3 тижні`) |
| `stand_concept` | Підготовка концепту стенду | пікер складності (лише 2 рівні, не 3) → `stand_concept_simple`/`stand_concept_complex` |
| `field_conference` | Підготовка до виїзних конференцій/ярмарків | плоский `EVENT_FIELD_CONFERENCE_MIN_LEAD_DAYS` (дефолт 18, лейбл `2,5 тижні`, рекомендація `3 тижні`) |

Лід-тайми для рівнів складності `event_internal`/`event_external`/`conference`/`gifts_custom` захардкоджені в коді (не читаються з env-змінних):

| Тип | simple | medium | complex |
|---|---|---|---|
| `event_internal_*` | 7 днів (`1 тиждень`) | 14 днів (`2 тижні`) | 21 день (`3 тижні`) |
| `event_external_*` | 14 днів (`2 тижні`) | 21 день (`3 тижні`) | 28 днів (`4 тижні`) |
| `conference_*` | 14 днів (`2 тижні`) | 30 днів (`1 місяць`) | 60 днів (`2 місяці`) |
| `gifts_custom_*` | 2 дні | 10 днів (`1,5 тижні`) | 60 днів (`2 місяці`) |

`stand_concept_simple`/`stand_concept_complex` мають власні env-змінні: `EVENT_STAND_CONCEPT_SIMPLE_MIN_LEAD_DAYS` (дефолт 21, `3 тижні`) і `EVENT_STAND_CONCEPT_COMPLEX_MIN_LEAD_DAYS` (дефолт 45, `1,5 місяці`). Жодна з `EVENT_*_MIN_LEAD_DAYS` змінних цього розділу не присутня в `.env.example` — усі значення в продакшні йдуть як код-дефолти, якщо явно не перевизначені в Railway.

Кожен тип у таблиці вище (та їхні складністні варіанти) має `defaultProperties: { 'EB Activity Type': '<значення>' }` (наприклад `Merch`, `Event Internal`, `Conference`), а варіанти складності додатково `Complexity: 'Simple'/'Medium'/'Complex'` (для `stand_concept_*` — `Complexity: 'SIMPLE'/'COMPLEX'` великими літерами).

**Чотири окремо сконфігуровані, але недосяжні через Slack-picker типи.** У `eventTaskTypeConfig` і `eventTaskFields` визначені записи `event_new`, `event_support`, `event_materials`, `event_report` (лід-тайми `EVENT_NEW_MIN_LEAD_DAYS`=30, `EVENT_SUPPORT_MIN_LEAD_DAYS`=14, `EVENT_MATERIALS_MIN_LEAD_DAYS`=7, `EVENT_REPORT_MIN_LEAD_DAYS`=3, кожен зі своїм `defaultProperties['EB Activity Type']`) — вони мають поля форми (розділ 7.4), але **відсутні** в `eventTaskTypeGroups` і не мають ключа `label` у своєму конфіг-об'єкті. Функція `buildTaskTypesFromGroups`, яка формує фінальний `department.taskTypes`, додає "додаткові" (поза групами) типи з `extraConfigByKey` лише тоді, коли в них є `label`; ці чотири записи цю умову не проходять, тож вони ніколи не потрапляють у `department.taskTypes` — `getDepartmentTaskType('event', 'event_new')` поверне `null`, і жодного шляху дістатись до них через Slack (ні через picker, ні напряму) не існує. Це поточний навмисний стан, а не помилка конфігурації: ключ `event_report` в Event-конфігурації — це окремий, повністю відмінний запис від ключа `event_report` у SMM-конфігурації (обидва відділи мають власний ізольований об'єкт `taskTypes`, колізії імен між ними немає).

---

## 7. Повний реєстр полів (fields) за типами задач

### 7.1 SMM — спільні поля (`smmCommonFields`)

| key | Тип | Лейбл | Notion-властивості | Примітка |
|---|---|---|---|---|
| `publication_date` | date | `Дата публікації / потрібна дата *` | `Publication date`, `Deadline` | `role: deadline` |
| `platforms` | multi_select | `Для якої платформи? (можна обрати кілька) *` (або `Для якої платформи? *`, якщо опція одна) | — | `role: platforms`; базові опції `Instagram, LinkedIn, YouTube, Facebook` |
| `context` | textarea | `Контекст / ідея — для чого, про що (1–3 речення) *` | — | `role: context` |
| `materials` | text | `Посилання на матеріали (лендинг, прес-реліз, вакансія, відео, фото)` | — | опційне, placeholder `Якщо матеріалів ще немає, залиш поле порожнім` |
| `approver` | slack_user | `Хто погоджує з вашої сторони? *` | — | — |

`smmNoteField`: `note` (textarea, опційне) — `Додаткова інформація / note`, placeholder `Можеш додати будь-який контекст, уточнення, тексти, посилання або побажання, які не влізли в поля вище.`

`SMM_ATTACHMENT_HINT` (використовується як `hint` на кількох полях): `Якщо маєш лінки — встав їх сюди. Якщо у тебе файли, після завершення форми перейди в задачу в Notion і прикріпи всі файли туди.`

Спільні поля виключаються/перевизначаються по типах:

| Тип задачі | Виключені спільні поля | Перевизначені поля |
|---|---|---|
| `announcement_post` | `materials` | — |
| `stories` | `platforms` | — |
| `linkedin_newsletter` | `platforms`, `context`, `materials` | — |
| `youtube_video_publish` | `platforms`, `materials` | — |
| `vacancy_promo_static` | `materials`, `approver` | `platforms` → лише `Meta, Google Ads, LinkedIn Ads` |
| `vacancy_promo_video` | `materials`, `approver` | `platforms` → лише `Meta, Google Ads, LinkedIn Ads` |
| `publication_boost` | `approver` | — |
| `blogger_collab` | `publication_date`, `materials` | — |
| `drive_upload` | `publication_date`, `platforms`, `materials`, `approver` | — |
| `event_report` (SMM) | `publication_date`, `platforms`, `materials`, `approver` | — |
| `reels` | — | `platforms` → лише `Instagram` |
| `carousel_post` | — | `platforms` → `Instagram, LinkedIn, Facebook` |

### 7.2 SMM — специфічні поля за типом (`smmTaskFields`)

**`reels`**: `talent_consent` (textarea, `Хто знімається + чи є згода *`) · `style_references` (text, `Референси стилю/монтажу *`, hint = `SMM_ATTACHMENT_HINT`) · `subtitles` (select, `Субтитри *`, `Так`/`Ні`).

**`carousel_post`**: `structure_choice` (select, `Структура каруселі *`, `Є структура — опишу` / `SMM придумує`, hint `Якщо обереш «Є структура — опишу», нижче зʼявиться поле для опису структури.`) · `slide_topics` (textarea, опційне, показується при `structure_choice=Є структура — опишу`, placeholder `Опиши структуру або теми слайдів: слайд 1 — ..., слайд 2 — ...`) · `ready_texts` (select, `Готові тексти *`, `Так — посилання` / `Ні, писати з нуля`) · `ready_texts_link` (textarea, опційне, показується при `ready_texts=Так — посилання`) · `design_references` (text, опційне, `Референси дизайну`).

**`announcement_post`**: `landing_link` (text, `Лінк на лендинг / прес-реліз *`, → `Ad link`) · `event_date` (date, `Дата події *`, → `Event date`) · `cta_link` (textarea, `CTA + посилання *`, → `Ad CTA`) · `visual_source` (select, `Візуал *`, `Є — посилання` / `Беремо з лендингу`) · `visual_link` (text, опційне, показується при `visual_source=Є — посилання`).

**`stories`**: `goal` (select, `Мета *`, `Анонс, Охоплення, Голосування, Трафік на посилання`) · `link_needed` (select, `Посилання потрібне? *`, `Так`/`Ні`) · `story_link` (text, опційне, показується при `link_needed=Так`) · `story_format` (select, `Формат *`, `Статика, Відео, Інтерактив`, → `Format`) · `ready_materials` (text, опційне, hint `SMM_ATTACHMENT_HINT`).

**`linkedin_newsletter`**: `key_points` (textarea, `Список вакансій *`) · `ready_copy_link` (text, `Посилання на готовий текст *`).

**`video_production`**: `video_idea` (textarea, `Що знімаємо / ідея *`) · `shoot_location_date` (text, `Локація і дата зйомки *`) · `frame_people_consent` (textarea, `Хто в кадрі + згода *`) · `video_references` (text, опційне, hint `SMM_ATTACHMENT_HINT`) · `duration` (text, `Орієнтовний хронометраж *`) · `editing_needed` (select, `Чи потрібен монтаж? *`, `Так`/`Ні`).

**`video_editing`**: `video_materials` (text, `Посилання на відеоматеріали *`, hint `SMM_ATTACHMENT_HINT`) · `edit_brief` (textarea, `Що потрібно змонтувати / ідея *`) · `video_references` (text, опційне, hint `SMM_ATTACHMENT_HINT`) · `duration` (text, `Орієнтовний хронометраж *`) · `subtitles` (select, `Субтитри *`, `Так`/`Ні`).

**`youtube_video_publish`**: `video_link` (text, `Готове відео *`) · `title_description` (select, `Назва + опис *`, `Є — додам` / `Треба допомога`) · `youtube_title_description_text` (textarea, опційне, показується при `title_description=Є — додам`) · `thumbnail` (select, `Обкладинка *`, `Є — посилання` / `Треба зробити`) · `thumbnail_link` (text, опційне, показується при `thumbnail=Є — посилання`) · `video_visibility` (select, `Видимість відео *`, `Публічне` / `Приховане`).

**`vacancy_promo_static`**: `vacancies_list` (textarea, `Список вакансій або посилання на список вакансій *`) · `targeting` (textarea, `Гео / аудиторія таргету *`) · `campaign_start_date` (date, `Період кампанії: від *`) · `campaign_end_date` (date, `Період кампанії: до *`).

**`vacancy_promo_video`**: те саме, що `vacancy_promo_static`, + `video_asset_link` (text, опційне, hint `SMM_ATTACHMENT_HINT`).

**`publication_boost`**: `post_link` (text, `Посилання на пост *`, → `Ad link`) · `budget` (text, `Бюджет у доларах ($) *`) · `ad_goal` (select, `Ціль *`, `Охоплення, Кліки, Інше (напишу в коментарі)`) · `ad_goal_other` (textarea, показується при `ad_goal=Інше (напишу в коментарі)`) · `success_kpi` (textarea, `KPI успішної кампанії *`) · `campaign_start_date`/`campaign_end_date` (date) · `targeting` (textarea, `Гео / аудиторія *`).

**`blogger_collab`**: `blogger_profile` (text, `Блогер / профіль *`, → `Ad link`) · `collab_goal` (select, `Ціль *`, `Промо вакансій, Промо івентів, Побудова знання`) · `collab_format` (select, `Формат *`, `Reels, Сторіз, Пост`) · `fixed_budget` (select, `Чи є фіксований бюджет? *`, `Так`/`Ні`) · `budget_amount` (text, показується при `fixed_budget=Так`) · `key_message` (textarea, `Ключове повідомлення *`) · `publish_deadline` (date, `Дедлайн виходу *`, `role: deadline`).

**`drive_upload`**: `upload_content` (textarea, `Що завантажуємо *`) · `source_materials` (select, `Джерело матеріалів *`, `Посилання` / `Передам окремо`) · `source_link` (text, опційне, показується при `source_materials=Посилання`) · `destination_folder` (text, `Куди (папка/диск) *`) · `operation_deadline` (date, `Дедлайн *`, `role: deadline`, → `Deadline`).

**`event_report`** (SMM): `event_name` (text, `Який івент *`) · `event_date` (date, `Дата івенту *`, → `Event date`) · `report_data` (textarea, `Які дані потрібні *`) · `report_format` (select, `Формат звіту *`, `Notion, Презентація, Таблиця`) · `report_deadline` (date, `Дедлайн *`, `role: deadline`, → `Deadline`).

### 7.3 Event — спільні поля (`eventCommonFields`)

| key | Тип | Лейбл | Notion-властивості |
|---|---|---|---|
| `event_date` | date | `Дата івенту *` | `Event date`, `Deadline`; `role: deadline` |
| `event_format` | select | `Формат івенту *` (`Online, Offline, Hybrid`) | `Format` |
| `location` | text | `Локація / платформа` (опційне) | `Location` |
| `budget` | text | `Бюджет, $` (опційне, placeholder `Наприклад: $500`) | `$ EB Budget`, `EB Budget`, `Budget` |
| `context` | textarea | `Контекст / ціль івенту *` | `role: context` |
| `audience` | textarea | `Аудиторія *` | `Audience`, `Target audience` |
| `materials` | text | `Посилання на матеріали` (опційне, placeholder `Лендінг, Figma, Drive, референси або інші матеріали.`) | — |
| `approver` | slack_user | `Хто погоджує з вашої сторони? *` | — |

`eventNoteField`: `note` (textarea, опційне) — `Додаткова інформація / note`, placeholder `Усе, що важливо для Event команди і не вмістилось у полях вище.`

Ці спільні поля (і `note`) використовуються ТІЛЬКИ для типів, які не входять у список `eventTaskFieldsWithoutCommon`/`eventTaskFieldsWithoutNote`. У поточному коді обидва набори-винятки містять однаковий перелік: `merch`, `event_internal`, `event_external`, `conference`, `gifts_ready`, `gifts_custom`, `activity`, усі похідні варіанти складності, `stand_concept_simple`, `stand_concept_complex`, `field_conference` — тобто фактично **жоден із 9 типів, видимих у Event-picker-і, не використовує спільні поля й нотатку** (кожен такий тип має власний повний набір полів, включно з власними `budget`/`context`/`location`). Спільні поля й нотатка фактично застосовуються лише до чотирьох недосяжних типів (`event_new`, `event_support`, `event_materials`, `event_report`), описаних у розділі 6.3.

### 7.4 Event — специфічні поля за типом (`eventTaskFields`)

**`merch`**: `project` (text, `Проєкт *`) · `quantity` (number, `Кількість *`) · `references` (textarea, опційне, `Референси`) · `budget` (text, `Бюджет, $ *`, → `$ EB Budget`/`EB Budget`/`Budget`) · `audience` (text, `Аудиторія *`) · `context` (textarea, `Контекст - для чого потрібно *`, `role: context`) · `deadline_receive` (date, `Дедлайн отримання *`, `role: deadline`, → `Deadline`).

**`event_internal`** (і однаково для складністних варіантів `event_internal_simple/medium/complex`): `event_date` (date, `Дата події *`, → `Event date`/`Deadline`) · `office_location` (text, `Локація в офісі *`) · `start_time` (time, `Час початку *`) · `event_type` (select, `Тип події *`, `Партнерський`/`Власний`) · `guests_count` (number, `Кількість гостей *`) · `budget` (text, `Бюджет, $ *`) · `concept` (textarea, `Концепція заходу *`) · `design_concept` (text, опційне, `Дизайн-концепт`) · `audience` (text, `Аудиторія *`) · `context` (textarea, `Загальний контекст *`, `role: context`) · `welcome_packs` (checkbox, опційне, `Потрібні велком-паки?`) · `gifts_needed` (checkbox, опційне, `Потрібні подарунки?`) · `gifts_quantity` (number, опційне, `Якщо подарунки потрібні - кількість`) · `catering` (text, опційне, `Кейтеринг`) · `photographer` (checkbox, опційне, `Потрібен фотограф?`) · `recording` (checkbox, опційне, `Потрібен запис події?`) · `badges` (checkbox, опційне, `Потрібні бейджі?`) · `tech_setup` (text, опційне, `Технічний сетап`).

**`event_external`** (і варіанти складності): те саме, що `event_internal`, але замість `office_location` — `location` (text, `Локація *`, placeholder `Назва локації або район`, → `Location`) + `location_confirmed` (radio, `Підтверджена локація? *`, `Так, є адреса` / `Ні, треба шукати`) + `location_address` (text, опційне, `Якщо так - адреса локації`); решта полів ідентичні (з уточненими placeholder-ами для `concept`/`design_concept`/`audience`/`context`/`catering`/`tech_setup`).

**`conference`** (і варіанти складності): `event_date` (date, → `Event date`/`Deadline`) · `location` (text, `Локація *`, → `Location`) · `setup_date`/`setup_time` (`Дата монтажу *`/`Час монтажу *`) · `teardown_date`/`teardown_time` (`Дата демонтажу *`/`Час демонтажу *`) · `participants_count` (number, `Кількість учасників від Universe *`, → `Participants`/`Attendees`) · `event_attendees_count` (number, опційне, `Кількість учасників події`) · `budget` (text, `Бюджет, $ *`) · `team_look` (text, `Зовнішній вигляд команди *`) · `context` (textarea, `Загальний контекст *`, `role: context`) · `stand_logistics` (checkbox, опційне) · `merch_packaging` (textarea, опційне, `Мерч для пакування`) · `stand_activity` (textarea, опційне, `Активність на стенді`) · `extra_items` (textarea, опційне, `Додаткові айтеми для замовлення`).

**`gifts_ready`**: `items` (textarea, `Перелік айтемів для відправки *`) · `recipient_details` (textarea, `Реквізити отримувача - ПІБ, адреса, телефон *`) · `payer` (text, `Хто платник за відправку *`) · `gift_deadline` (date, `Дедлайн отримання подарунку *`, `role: deadline`, → `Deadline`).

**`gifts_custom`** (і варіанти складності): `quantity` (number, `Кількість *`) · `budget` (text, `Бюджет, $ *`) · `references` (textarea, `Референси *`) · `context` (textarea, `Загальний контекст *`, `role: context`) · `deadline_receive` (date, `Дедлайн отримання *`, `role: deadline`, → `Deadline`).

**`activity`**: `date` (date, `Дата *`, `role: deadline`, → `Event date`/`Deadline`) · `location` (text, `Локація *`, placeholder `Вкажіть локацію`, → `Location`) · `work_time` (`time_range` — рендериться як два `timepicker`-и: `{label} від *` / `{label} до *`) · `references` (textarea, `Референси *`) · `budget` (text, `Бюджет, $ *`) · `context` (textarea, `Загальний контекст *`, `role: context`).

**`stand_concept_simple`/`stand_concept_complex`**: `project_date` (date, `Дата проєкту *`, `role: deadline`, → `Event date`/`Deadline`) · `location` (text, `Локація *`, → `Location`) · `stand_size` (text, `Розмір стенду *`, → `Stand size`/`Size`) · `participants_count` (number, `Кількість учасників *`, → `Participants`/`Attendees`) · `merch_needed` (select, `Чи потрібен мерч *`, `Так, Ні, Потрібно обговорити`, → `Merch needed`/`Merch`) · `team_look` (textarea, `Зовнішній вигляд команди *`, → `Team look`/`Team appearance`) · `activity_goal` (textarea, `Мета активності *`, `role: context`) · `context` (textarea, `Загальний контекст / напрацьовані ідеї / напрямок *`) · `budget` (text, `Бюджет, $ *`).

**`field_conference`**: `project_date` (date, `Дата проєкту *`, → `Event date`/`Deadline`) · `location` (text, `Локація *`) · `setup_date`/`setup_time` (→ `Mounting date`/`Mounting time` або `Installation date`/`Installation time`) · `teardown_date`/`teardown_time` (→ `Demounting date`/`Demounting time` або `Teardown date`/`Teardown time`) · `logistics_needed` (select, `Чи потрібна логістика *`, `Так, Ні, Потрібно обговорити`, → `Logistics needed`/`Logistics`) · `participants_count` (number, `Кількість учасників від Universe *`) · `team_look` (textarea, `Зовнішній вигляд команди *`) · `context` (textarea, `Загальний контекст *`, `role: context`) · `budget` (text, `Бюджет, $ *`).

**`event_new`** (недосяжний): `event_goal` (textarea, `Що має відбутися / короткий опис *`) · `expected_attendees` (text, опційне, → `Attendees`/`Participants`) · `deliverables` (textarea, `Що потрібно від Event команди *`).

**`event_support`** (недосяжний): `current_status` (textarea, `Що вже готово *`) · `support_needed` (textarea, `Яка підтримка потрібна *`).

**`event_materials`** (недосяжний): `materials_needed` (textarea, `Які матеріали потрібні *`) · `sizes_formats` (textarea, опційне, → `Formats`/`Sizes`).

**`event_report`** (Event, недосяжний — не плутати з однойменним типом у SMM): `report_data` (textarea, `Які дані потрібні *`) · `report_format` (select, `Формат звіту *`, → `Format`) · `report_deadline` (date, `Дедлайн звіту *`, `role: deadline`, → `Deadline`).

### 7.5 Design — базові поля (`baseBlocks()`, статичні Slack-блоки, завжди перед специфічними)

| block_id | Лейбл | Елемент | Placeholder / опції | Hint |
|---|---|---|---|---|
| `name_block` | `📌 Назва задачі *` | plain_text_input | `Банер для посту про Summer Camp` | — |
| `priority_block` | `🔥 Пріоритет *` | static_select: `Urgent, High, Normal, Low, Planned` | `Вибери пріоритет...` | `Urgent — є конкретна дата події / підрядник з дедлайном / force majeure. Потребує ревю Жені.\nHigh — задача цього тижня, є дедлайн, але не горить сьогодні. Стандартний пріоритет для більшості задач.\nNormal — задача без жорсткого дедлайну, береться за чергою.\nLow — задача «коли буде час», не блокує нікого.\nPlanned — задача відома наперед, запланована на конкретний тиждень у майбутньому (Summer Camp, дайджест, ребрендинг).` |
| `deadline_block` | `📅 Дедлайн *` | datepicker | `Вибери дату...` | — |
| `context_block` | `💬 Контекст *` | plain_text_input (multiline) | `Це для Instagram-посту до Дня компанії. Основна емоція — гордість і тепло.` | `Для чого це потрібно? Як буде використовуватись? Яка емоція?` |
| `style_block` | `🎨 Стиль / Референси` (опційне) | plain_text_input (multiline) | `Референс: figma.com/... Хочемо щось у дусі цього, але з нашими кольорами` | — |
| `antiref_block` | `🚫 Антиреференси` (опційне) | plain_text_input (multiline) | `Нічого занадто мінімалістичного, без чорного фону` | — |
| `can_edit_block` | `✏️ Дизайнер може правити текст?` (опційне) | static_select: `Так`/`Ні` | `Вибери...` | — |

Поле `Platform`, де воно є у специфічних блоках нижче, використовує `action_id: tasksbot_platform` (`ACTION_IDS.platform`), а не сирий `platform` — саме цей action_id ловить `app.action(ACTION_IDS.platform)` у `submission.js` для живого рендеру поля "Platform (other)".

Для блоків, чий `block_id` входить у список `artifact_figma_block, artifact_drive_block, artifact_video_block, artifact_music_block, artifact_photo_block, artifact_logo_block, artifact_brand_block, artifact_pres_block, artifact_article_block`, у рантаймі динамічно додається `hint`: `Будь ласка, перейдіть у таску в ноушин та додайте аттачменти у коментарі`. (`artifact_ref_block` у цей список не входить і власного hint-а не отримує.)

### 7.6 Design — специфічні поля за типом (`specificBlocks`)

**`static_simple`**: `platform_block` (`📱 Платформа *`, static_select: `Instagram, LinkedIn, Facebook, Email, Print, Corpsite`, `action_id: tasksbot_platform`) · `message_block` (`💬 Ключове повідомлення / CTA *`, placeholder `Реєструйся до 20 квітня`) · `size_block` (опційне, `📏 Розміри або орієнтація`, placeholder `1080×1080 / квадрат / горизонталь`) · `artifact_drive_block` (опційне, `📎 Текст, фото, референси (Google Drive / Figma)`, placeholder `drive.google.com/...`).

**`static_complex`**: `platform_block` (`📱 Платформа *`, `Instagram, LinkedIn, Facebook, Print`) · `message_block` (`💬 Ключове повідомлення *`, placeholder `Головний меседж банера`) · `output_format_block` (`📄 Формат файлу на виході *`, `PNG, JPG, PDF, SVG`) · `color_model_block` (опційне, `🎨 Кольорова модель`, `RGB (digital)` / `CMYK (друк)`) · `artifact_drive_block` (опційне, `📎 Текст, фото, референси (Google Drive / Figma)`).

**`carousel`**: `slides_count_block` (`🔢 Кількість слайдів *`, placeholder `5`) · `slides_text_block` (`📝 Тема і текст по кожному слайду *`, multiline, placeholder `Слайд 1: Заголовок\nСлайд 2: Текст про...`) · `platform_block` (опційне, `📱 Платформа`, `Instagram, LinkedIn`) · `artifact_drive_block` (опційне, `📎 Фото, референси (Google Drive)`).

**`resize`**: `formats_list_block` (`📐 Перелік форматів на виході *`, multiline, placeholder `1080×1080\n1080×1920\n1200×628`) · `artifact_figma_block` (`📎 Посилання на вихідний макет у Figma *`, placeholder `figma.com/file/...`).

**`promo_creo_static_template`**: `selected_concept_block` (`🎯 Обраний концепт *`) · `new_text_block` (`📝 Новий текст *`, multiline) · `cta_block` (`📢 CTA *`, placeholder `Наприклад: Подати заявку до 1 травня`).

**`promo_creo_static_ideas`**: `concept_only_block` (`💡 Концепція *`, multiline, placeholder `Опиши ідею майбутнього креативу`) · `artifact_ref_block` (`📎 Референси *`, multiline) · `message_block` (`💬 Меседж *`, multiline) · `cta_block` (`📢 CTA *`, placeholder `Наприклад: Подати заявку / Дізнатись більше`).

**`promo_creo_mix_template`**: `selected_concept_block` (`🎯 Обраний концепт *`) · `new_text_block` (`📝 Новий текст *`, multiline, placeholder `Текст, який треба використати в шаблоні`) · `cta_block` (`📢 CTA *`).

**`promo_creo_mix_ideas`**: `concept_only_block` (`💡 Концепція *`, multiline) · `artifact_ref_block` (`📎 Референси *`, multiline) · `message_block` (`💬 Меседж *`, multiline) · `cta_block` (`📢 CTA *`) · `subtitles_block` (`💬 Чи потрібні субтитри? *`, `Так`/`Ні`) · `hooks_block` (опційне, `🪝 Хуки`, multiline) · `desired_dynamics_block` (опційне, `🎞 Мінімальний опис бажаної динаміки`, multiline).

**`promo_creo_video_template`**: `selected_concept_block` (`🎯 Обраний концепт *`) · `video_format_block` (`🎬 Фінальний формат *`, `Рілз + квадрат` / `Тільки рілз`) · `subtitles_block` (`💬 Чи потрібні субтитри? *`, `Так`/`Ні`) · `cta_block` (`📢 CTA наприкінці *`, multiline) · `hooks_block` (опційне, `🪝 Хуки`, multiline).

**`promo_creo_video_ideas`**: `concept_only_block` (`💡 Концепція *`, multiline) · `artifact_ref_block` (`📎 Референси *`, multiline) · `message_block` (`💬 Меседж *`, multiline) · `cta_block` (`📢 CTA *`) · `subtitles_block` (`💬 Чи потрібні субтитри? *`) · `hooks_block` (опційне) · `desired_dynamics_block` (опційне).

**`video_simple`**: `video_format_block` (`🎬 Фінальний формат *`, `Reels / вертикальний (9:16)`, `Квадрат (1:1)`, `Горизонталь (16:9)`) · `subtitles_block` (`💬 Потрібні субтитри? *`) · `cta_block` (опційне, `📢 CTA наприкінці`, placeholder `Підписуйся на наш Instagram`) · `artifact_video_block` (`📎 Відеоматеріал (Google Drive) *`) · `artifact_music_block` (опційне, `📎 Музика (або напиши "підібрати самостійно")`).

**`video_complex`**: `video_format_block` (те саме) · `mood_block` (`🌀 Концепція / настрій *`, multiline, placeholder `Динамічно, з музикою, акцент на людях, відчуття команди`) · `edit_style_block` (опційне, `✂️ Стиль монтажу`, placeholder `кінематографічний / швидка нарізка / cinematic`) · `artifact_video_block` (опційне, `📎 Відеоматеріал (Google Drive)`) · `artifact_ref_block` (опційне, `📎 Референси відео`).

**`pres_edit`**: `artifact_pres_block` (`📎 Посилання на існуючу презентацію *`) · `slide_list_block` (`📋 Перелік слайдів для правок + коментарі *`, multiline, placeholder `Слайд 3: замінити фото\nСлайд 7: оновити дату`) · `can_shorten_block` (опційне, `✂️ Можна скорочувати текст?`, `Так`/`Ні`).

**`pres_template`**: `structure_block` (`🗂 Структура (перелік слайдів) *`, multiline, placeholder `1. Вступ\n2. Проблема\n3. Рішення\n4. CTA`) · `slides_text_block` (`📝 Текст / тези по кожному слайду *`, multiline) · `artifact_drive_block` (опційне, `📎 Фото, іконки (Google Drive)`).

**`pres_wow`**: `audience_block` (`👥 Ціль і аудиторія *`, placeholder `Для топ-менеджменту, ціль — затвердити Q3 бюджет`) · `structure_block` (`🗂 Структура *`, multiline) · `artifact_ref_block` (`📎 Референси (обов'язково)`) · `artifact_drive_block` (опційне, `📎 Текст, фото, логотип, бренд-гайд`).

**`ai_static_simple`**: `ai_description_block` (`🤖 Що має бути зображено *`, multiline, placeholder `Жінка-програміст в офісі, стиль — кінематографічний, тепле світло`) · `platform_block` (`📱 Платформа використання *`, `Instagram, LinkedIn, Corpsite, Email`) · `artifact_ref_block` (опційне, `📎 Референс і що в ньому подобається`).

**`ai_static_complex`**: `ai_description_block` (`🤖 Що має бути зображено і для чого *`, multiline) · `platform_block` (`📱 Платформа *`, `Instagram, LinkedIn, Corpsite, Print`) · `artifact_ref_block` (`📎 Референси стилю (обов'язково)`).

**`ai_dynamic_simple`**: `ai_description_block` (`🤖 Що має бути зображено *`, multiline, placeholder `Анімований логотип з появою тексту, стиль мінімалістичний`) · `platform_block` (`📱 Платформа *`, `Instagram, YouTube`) · `artifact_ref_block` (опційне, `📎 Референси`).

**`ai_dynamic_complex`**: `ai_description_block` (`🤖 Що має бути зображено *`, multiline, placeholder `Повністю згенерована відеосцена: місто майбутнього, 15 сек, для Instagram`) · `platform_block` (`📱 Платформа *`, `Instagram, YouTube`) · `artifact_ref_block` (`📎 Референси стилю (обов'язково)`).

**`landing_template`**: `structure_block` (`🗂 Структура блоків *`, multiline, placeholder `Hero → Про нас → Переваги → Команда → CTA`) · `slides_text_block` (`📝 Текст по кожному блоку *`, multiline) · `artifact_drive_block` (опційне, `📎 Текст, фото, логотип (Google Drive)`).

**`landing_wow`**: `audience_block` (`👥 Ціль і ЦА *`, placeholder `Залучити студентів до стажування, ЦА — 18-25 років`) · `structure_block` (`🗂 Структура *`, multiline) · `artifact_ref_block` (`📎 Референси (обов'язково)`, placeholder `dribbble.com/... або awwwards.com/...`) · `artifact_drive_block` (опційне, `📎 Текст, фото, логотип, бренд-гайд`).

**`blog`**: `artifact_article_block` (`📎 Посилання на статтю / текст *`) · `custom_images_block` (опційне, `🖼 Потрібні кастомні картинки в текст?`, `Так`/`Ні`) · `artifact_photo_block` (опційне, `📎 Фото для обкладинки`).

**`digest_simple`**: `structure_block` (`🗂 Структура дайджесту *`, multiline, placeholder `Блок 1: новини команди\nБлок 2: вакансії\nБлок 3: події місяця`) · `slides_text_block` (`📝 Текст по кожному блоку *`, multiline) · `artifact_drive_block` (опційне, `📎 Фото, логотип (Google Drive)`).

**`digest_wow`**: `audience_block` (`👥 Ціль і аудиторія *`, placeholder `Внутрішній дайджест для всіх співробітників`) · `structure_block` (`🗂 Структура *`, multiline, placeholder `Обкладинка → Головна новина → Люди місяця → події`) · `artifact_ref_block` (`📎 Референси обкладинки (обов'язково)`) · `artifact_drive_block` (опційне, `📎 Всі тексти, фото, логотип`).

**`email_digest`**: `structure_block` (`🗂 Структура email *`, multiline, placeholder `Заголовок → 3 новини → CTA → Футер`) · `artifact_drive_block` (опційне, `📎 Тексти, фото (Google Drive)`).

**`merch_simple`**: `carrier_block` (`👕 Тип носія *`, placeholder `футболка / худі / пляшка / шопер`) · `print_zone_block` (`📍 Зони нанесення *`, placeholder `Передня частина по центру, розмір 20×20 см`) · `artifact_logo_block` (опційне, `📎 Логотип у векторі (AI / SVG)`).

**`merch_ref`**: `carrier_block` (`👕 Тип носія *`) · `variants_block` (`🔄 Кількість варіантів макетів *`, placeholder `2`) · `artifact_ref_block` (`📎 Референси (обов'язково)`) · `artifact_logo_block` (опційне, `📎 Логотип у векторі`).

**`merch_research`**: `carrier_block` (`👕 Тип носія *`) · `concept_block` (`💡 Концепція / меседж *`, multiline, placeholder `Мерч для літнього табору, відчуття пригоди і молодості`) · `restrictions_block` (опційне, `🚫 Обмеження (кольори, слогани)`) · `artifact_brand_block` (опційне, `📎 Бренд-гайд, логотип`).

**`print_materials`**: `print_size_block` (`📐 Розміри *`, placeholder `A3, горизонталь / A4, вертикаль / 100×70 см`) · `construction_block` (`🧩 Конструкція *`, multiline) · `file_packaging_block` (`📦 Як передавати елементи *`, multiline) · `print_effect_block` (`✨ Ефект нанесення *`, multiline) · `artifact_ref_block` (`📎 Референси готового обʼєкту *`, multiline).

**`identity`**: `brand_name_block` (`🏷 Назва бренду *`, placeholder `UniWork — платформа для стажувань`) · `business_block` (`🏢 Опис бізнесу / продукту *`, multiline) · `artifact_ref_block` (`📎 Референси + антиреференси (обов'язково)`) · `target_block` (опційне, `🎯 ЦА`) · `competitors_block` (опційне, `⚔️ Конкуренти`).

**`logo`**: `brand_name_block` (`🏷 Назва *`, placeholder `UniWork`) · `sphere_block` (`🏭 Сфера *`, placeholder `EdTech / HR / фінанси / ритейл`) · `artifact_ref_block` (`📎 Референси (обов'язково)`) · `usage_block` (опційне, `📍 Де буде використовуватись`).

**`photo_simple`**: `what_to_fix_block` (`🔧 Що саме прибрати / змінити *`, multiline, placeholder `Видалити людину справа, вирізати фон`) · `artifact_photo_block` (`📎 Вихідне фото (Google Drive) *`).

**`photo_complex`**: `what_to_fix_block` (`🔧 Детальний опис що зробити *`, multiline) · `artifact_photo_block` (`📎 Вихідне фото *`) · `artifact_ref_block` (опційне, `📎 Референс результату`).

**`tv_announce`**: `person_name_block` (`👤 Ім'я та посада *`, placeholder `Марія Коваль, Product Designer`) · `event_date_block` (`📅 Дата події *`, datepicker) · `artifact_photo_block` (`📎 Фото людини (Google Drive) *`).

**`tv_static`**: `tv_text_block` (`📺 Текст *`, multiline, placeholder `Лекція «Дизайн-системи» о 18:00 в аудиторії 301`) · `qr_block` (опційне, `🔗 QR-код / посилання`).

**`event_simple`**: `event_name_block` (`🎪 Назва івенту *`, placeholder `TechTalk #12`) · `location_block` (`📍 Локація *`, placeholder `UniHub, вул. Хрещатик 10`) · `carriers_list_block` (`📋 Перелік носіїв *`, placeholder `афіша A2, екран 1920×1080, Instagram stories`) · `artifact_drive_block` (опційне, `📎 Текст, логотип, фото`).

**`event_complex`**: `event_name_block` (`🎪 Назва івенту *`, placeholder `Summer Camp 2025`) · `location_block` (`📍 Локація *`, placeholder `Карпати, база відпочинку «Едельвейс»`) · `carriers_list_block` (`📋 Перелік всіх носіїв *`, multiline) · `artifact_ref_block` (`📎 Референси (обов'язково)`) · `artifact_drive_block` (опційне, `📎 Текст, всі фото, логотип, бренд-гайд`).

**`other`**: пояснювальна секція `💡 *Нетипова задача* — опиши детально що потрібно, дизайнер сам оцінить складність.` · `other_desc_block` (`📝 Детальний опис задачі *`, multiline, placeholder `Наприклад: оформити сторінку Notion для онбордингу, зробити символ для бізнесу FORMA, налаштувати профіль в Ashby...`) · `artifact_drive_block` (опційне, `📎 Додаткові матеріали (Google Drive / Figma / посилання)`).

### 7.7 `fieldMapping` — Design, зіставлення `block_id → людський лейбл` для тіла/Description

Поточний повний список (`src/handlers/submission.js`), використовується лише для Design (`specificFields`, які потрапляють у `Description`/тіло сторінки):

```
size_block → 📐 Розміри
print_size_block → 📐 Розміри
message_block → 💬 Ключове повідомлення
color_model_block → 🎨 Кольорова модель
output_format_block → 📄 Формат файлу на виході
video_format_block → 🎬 Фінальний формат відео
subtitles_block → 💬 Субтитри
cta_block → 📢 CTA
mood_block → 🌀 Концепція / настрій
edit_style_block → ✂️ Стиль монтажу
slides_count_block → 🔢 Кількість слайдів
slides_text_block → 📝 Текст по слайдах
structure_block → 🗂 Структура
audience_block → 👥 Ціль і аудиторія
ai_description_block → 🤖 Що зобразити
custom_images_block → 🖼 Кастомні картинки
carrier_block → 👕 Тип носія
print_zone_block → 📍 Зони нанесення
variants_block → 🔄 Кількість варіантів
concept_block → 💡 Концепція / меседж
restrictions_block → 🚫 Обмеження
brand_name_block → 🏷 Назва бренду
business_block → 🏢 Опис бізнесу
target_block → 🎯 ЦА
competitors_block → ⚔️ Конкуренти
usage_block → 📍 Де використовуватись
sphere_block → 🏭 Сфера
what_to_fix_block → 🔧 Що прибрати / змінити
person_name_block → 👤 Ім'я та посада
event_date_block → 📅 Дата події
tv_text_block → 📺 Текст
qr_block → 🔗 QR / посилання
event_name_block → 🎪 Назва івенту
location_block → 📍 Локація
carriers_list_block → 📋 Перелік носіїв
slide_list_block → 📋 Перелік слайдів для правок
can_shorten_block → ✂️ Можна скорочувати текст
formats_list_block → 📐 Перелік форматів
selected_concept_block → 🎯 Обраний концепт
new_text_block → 📝 Новий текст
concept_only_block → 💡 Концепція
hooks_block → 🪝 Хуки
desired_dynamics_block → 🎞 Мінімальний опис бажаної динаміки
construction_block → 🧩 Конструкція
file_packaging_block → 📦 Як передавати елементи
print_effect_block → ✨ Ефект нанесення
other_desc_block → 📝 Опис задачі
```

`artifactMapping` (ті самі механізм, для секції "Артефакти"):

```
artifact_figma_block → Figma / макет
artifact_drive_block → Google Drive
artifact_video_block → Відеоматеріал
artifact_music_block → Музика
artifact_photo_block → Фото
artifact_logo_block → Логотип
artifact_ref_block → Референси
artifact_brand_block → Бренд-гайд
artifact_pres_block → Презентація
artifact_article_block → Стаття / текст
```

---

## 8. Notion — точна структура сторінки, яка створюється

### 8.1 Створення сторінки (`createNotionPage`, `src/notion/createPage.js`)

Послідовність:

1. Резолюція `department`/`taskConfig` за `departmentKey`/`taskType`.
2. Побудова `Description`: якщо `department.useBodyBrief` (SMM/Event) — фіксований текст `Опис нижче в тілі задачі.`, а реальний бриф іде окремими блоками в тіло сторінки (нижче). Інакше (Design) — плейн-текстовий опис з емодзі-секціями (`📌 Повна назва`, `📌 Контекст`, `🎨 Стиль/Референси`, `🚫 Антиреференси`, `✏️ Дизайнер може правити текст`, `📱 Platform (other)`, `— СПЕЦИФІЧНІ ПОЛЯ —`, `— АРТЕФАКТИ —`).
3. Отримання схеми Notion-бази (`notion.databases.retrieve`, кешується в пам'яті процесу за `notionDataSourceId`; при помилці кеш інвалідується, щоб наступний виклик спробував ще раз).
4. Визначення властивості заголовка (`title`-тип, пріоритет — властивість з іменем `Name`) і властивості статусу (`resolveStatusPropertyName`, розділ 8.1.1).
5. Побудова об'єкта `properties`:
   - **Title**: заголовок (обрізаний до 2000 символів, `Untitled` якщо порожній).
   - **Статус**: `department.initialStatus` (з fallback на опцію `to do` без урахування регістру або першу доступну опцію, якщо точного збігу немає — з `console.warn`).
   - Для Design: чекбокс `Design needed = true`, якщо властивість існує.
   - `department.defaultProperties`, потім `taskConfig.defaultProperties` (специфічні для типу задачі default-значення — саме звідси йде `Format`, `EB Activity Type`, `Complexity` тощо).
   - **`Team`** (select) = `department.team` — це і є механізм запису SMM `Team=SMM`/Design `Team=Brand Design`/Event `Team=Event`, не окремий спеціальний код-шлях.
   - **`domain`** (multi_select, тільки Design, коли обрано напрямок на кроці 3): відсутні опції спершу додаються в схему бази (`notion.databases.update`), потім записується значення.
   - **Owner/Slack Person matching**: `resolveNotionUserId({ email: slackPersonEmail, names: [slackPersonName] })` (розділ 8.4) — якщо знайдено відповідний Notion-користувач, він іде і в `Owner` (замість дефолтного `department.ownerId`), і в `Slack Person`.
   - **`Priority`** (select), **`Deadline`** (date).
   - **`Late`** (checkbox) — виставляється в `true` ТІЛЬКИ якщо `isLate` truthy; в іншому разі властивість не чіпається взагалі (не виставляється явно у `false`).
   - **`Platforms`/`Platform`**: джерело — явно передані `platforms`, інакше `taskConfig.defaultPlatforms`, інакше одинарний `platform`; записується у властивість-мультиселект `Platforms`/`Platform`, або, якщо такої немає, перший платформ записується в `select`-властивість `Platform`.
   - **`Task Type`**: якщо для `taskType` є Design relation ID (`DESIGN_TASK_TYPE_RELATION_IDS`) — `relation`-властивість `Task Type` = `[{ id: relationId }]`; інакше — текст/select у `Task Type`/`Request type`/`Type` зі значенням `taskConfig.label || taskType`.
   - Кожне поле з `fieldAnswers` (динамічні SMM/Event-поля) записується у першу властивість зі списку `field.notionProperties`, тип якої відповідає — саме так Event-поля (`Ad link`, `Event date`, `$ EB Budget` тощо) потрапляють у конкретні Notion-колонки.
   - Тестове маркування: якщо задано `TEST_TASK_PREFIX` — чекбокс `Test = true` і тег `Test` у `Tags`/`Tag`.
   - **`Slack Person`**: поведінка залежить від фактичного типу властивості в базі — `people` (пише знайдений `notionUserId`, або, якщо збігу немає, не записується взагалі, і замість цього в тіло сторінки додається попереджувальний блок — див. нижче), `title`/`rich_text`/`select` (пише `slackPersonName` як є).
   - **`Description`** — з кроку 2.
6. **Створення сторінки**: `notion.pages.create({ parent: { database_id: department.notionDataSourceId }, properties })`.
7. **Асинхронне застосування шаблону** (лише якщо `department.notionTemplateId` заданий): окремий Notion-клієнт із `notionVersion: '2026-03-11'` виконує `PATCH pages/{id}` з `template: { type: 'template_id', template_id, timezone: NOTION_TEMPLATE_TIMEZONE }` і `erase_content: true`. Оскільки застосування шаблону перезаписує вміст і може стерти щойно виставлені властивості, одразу після цього бот повторно записує `Owner` і `Slack Person` окремим `pages.update` (помилка тут лише логується, не кидає виняток).
8. **Тіло сторінки** (лише коли `useBodyBrief`): блоки заголовків/параграфів/списків з назвою відділу, типом задачі, секціями "Базові поля"/"Специфічні поля" (з `fieldAnswers`) і "Матеріали" (з `artifacts`) — додаються шматками по 100 блоків (ліміт Notion на виклик) через `notion.blocks.children.append`.
9. Якщо Slack-заявник не зіставився з жодним Notion-користувачем (властивість `Slack Person` типу `people`), у тіло сторінки додається окремий параграф: `⚠️ Slack requester not matched to a Notion account: {ім'я} ({email або "email unknown"})`.

Повертає `{ pageId, pageUrl, templateApplied }`.

### 8.1.1 Резолюція назви властивості статусу (`taskConfig.js`)

`getStatusPropertyNames(departmentKey)` формує пріоритетний список кандидатів: спершу `department.statusProperty`/`NOTION_STATUS_PROPERTY`, потім для Design — `['Design Status', 'Status']`, для решти відділів — `['Status', 'Design Status']` (зворотний порядок — не-Design-відділи за замовчуванням очікують просту властивість `Status`). `resolveStatusPropertyName` бере першу з цього списку, чий тип у фактичній схемі бази — `status` або `select`.

### 8.2 Тіло сторінки (body blocks) — `Description` vs body brief

Design пише повний бриф у властивість `Description` (rich text, з автолінкуванням URL і лімітом Notion на довжину — розділ 8.5). SMM/Event (`useBodyBrief: true`) лишають `Description` як короткий плейсхолдер, а весь бриф — заголовки, "Базові поля", "Специфічні поля", "Матеріали" — записують блоками в тіло сторінки.

### 8.3 Sub-item / feedback-round сторінки (`createFeedbackSubitem`, `src/notion/createSubitem.js`)

Тільки для Design. Створює нову сторінку в тій самій базі, що й батьківська задача:

- Заголовок: `Правка {N} — {назва батьківської задачі}`.
- `Parent item` (relation, назва властивості з `NOTION_PARENT_ITEM_PROPERTY`, за замовчуванням `Parent item`) = `[{ id: parentPageId }]`.
- `Sub-type` (select, `NOTION_SUB_TYPE_PROPERTY`, за замовчуванням `Sub-type`) = `NOTION_FEEDBACK_SUB_TYPE` (за замовчуванням `правка`).
- Копіюються з батьківської сторінки (якщо властивість існує з відповідним типом): `Team`, `Priority`, `Deadline`, `Task Type`, `Designer`, `Slack Person`, `Final project`.
- `Owner` (people) = `Дизайнер`/`Designer` з батьківської сторінки, якщо є люди в цій властивості, інакше — існуючий `Owner` батьківської сторінки.
- `Тип правки` (`NOTION_FEEDBACK_TYPE_PROPERTY`, за замовчуванням) записується в тип властивості, який фактично існує (`select`/`status`/`multi_select`/`rich_text`) зі значенням лейбла обраного типу правки (`Об'єктивна`/`Суб'єктивна`).
- `Description` (`NOTION_DESCRIPTION_PROPERTY`, за замовчуванням `Description`) = текст правки з модалки.
- Статус — виставляється в `DEFAULT_STATUS` (`To do`), якщо статусна властивість типу `status`.

Кидає виняток, якщо в базі немає властивості `title`, немає `Parent item` типу `relation`, або немає `Sub-type` типу `select`.

### 8.4 Резолюція "дизайнера" і зіставлення Slack-користувача з Notion-людиною

**Читання дизайнера з уже створеної сторінки** (`src/notion/designer.js`, `extractDesignerFromProperties(properties, notion)`): читає властивість `Designer`/`Дизайнер`; для типу `people` повертає `{name, userId, email}`; для типу `relation` резолвить кожну пов'язану сторінку (кешується в пам'яті процесу за `pageId`, без витіснення) і зчитує з неї назву/email/Slack ID (шукає в іменах властивостей `Slack ID`, `Slack User ID`, `Slack user id`, `Slack`, `SlackId` значення формату `/^[UW][A-Z0-9]+$/`); для `title`/`rich_text`/`select` повертає текстове значення. Ідентичний, простіший варіант цієї логіки (без relation-гілки) продубльований у `src/notion/acceptTask.js` для власних потреб (див. розділ 11.5).

**Зіставлення Slack-заявника з Notion-людиною** (`resolveNotionUserId`/`getNotionPeople`, визначені в `src/notion/createPage.js`): спершу точний збіг за нормалізованим email; якщо не знайдено — збіг за нормалізованим ім'ям, і лише якщо збіг унікальний (рівно одна людина з таким іменем) — неоднозначні збіги за іменем трактуються як відсутність збігу. Список людей Notion-workspace (`notion.users.list`, тільки `type === 'person'`) кешується в пам'яті процесу разом з часом останнього завантаження (`{ promise, fetchedAt }`). Кеш вважається протухлим (`isNotionPeopleCacheStale`), коли минуло більше `NOTION_PEOPLE_CACHE_TTL_MS` (за замовчуванням 24 години) з моменту останнього завантаження; оновлення кешу відбувається лінькuo — тобто не за таймером у фоні, а в момент першого виклику `getNotionPeople()` ПІСЛЯ спливання TTL (найближче створення нової задачі). Якщо завантаження списку людей падає з помилкою, кеш скидається в `null` (наступний виклик спробує заново), а сама помилка проброшується виклику.

### 8.5 Побудова публічного URL задачі (`buildTaskPageUrl`, `src/notion/pageUrl.js`)

Якщо в департамента заданий `hubUrl` — посилання будується як `{hubUrl}?p={pageId без дефісів}&pm=s` (параметр Notion-конвенції "відкрити цей запис усередині хаб-сторінки"). Якщо `hubUrl` не заданий або не парситься як URL — пряме посилання на сторінку `https://www.notion.so/{pageId}` (або переданий `fallbackUrl`, якщо є).

### 8.6 Rich text — автолінкування й ліміти (`src/notion/richText.js`)

`buildRichText(value, options)`: конвертує рядок у масив Notion rich-text об'єктів. Автоматично розпізнає й лінкує URL (крім тих, що йдуть одразу після `@`, щоб не лінкувати частину email/mention), відсікаючи кінцеву пунктуацію (`.`, `,`, `;`, `:`, `!`, `)`, `]`, `}`) з-під самого посилання. Кожен текстовий сегмент, довший за `RICH_TEXT_CONTENT_LIMIT` (2000 символів — власне обмеження Notion на один rich-text об'єкт), розбивається на кілька об'єктів. Весь вхідний рядок додатково обрізається, якщо перевищує `RICH_TEXT_CONTENT_LIMIT × RICH_TEXT_OBJECT_LIMIT` (2000×100) символів, з допискою `[Обрізано: Notion має ліміт на довжину rich text поля.]`; а вже готовий масив об'єктів додатково обрізається до `RICH_TEXT_OBJECT_LIMIT` (100) елементів, якщо лінкування/чанкінг дали більше об'єктів, ніж очікувалось із самої довжини тексту.

---

## 9. Redis — модель даних

Усі ключі опційно префіксуються `REDIS_KEY_PREFIX` (за замовчуванням порожній рядок).

| Ключ | Тип | TTL | Призначення |
|---|---|---|---|
| `notion:<pageId>` | STRING (JSON) | без TTL | Основний запис трекінгу задачі |
| `notion-launch:<parentTaskId>` | STRING (JSON) | без TTL | Launch-контекст від Notion webhook |
| `task-submission-queue` | ZSET | — | Черга сабмітів (member = queueId, score = due timestamp) |
| `task-submission-queue-item:<id>` | STRING (JSON) | `FAILED_SUBMISSION_TTL_SECONDS` (той самий TTL, що й у чернеток) | Payload одного елемента черги |
| `failed-submission:<draftId>` | STRING (JSON) | `FAILED_SUBMISSION_TTL_SECONDS` (за замовчуванням 30 днів) | Чернетка невдалого сабміту |
| `feedback:<pageId>` | STRING (JSON) | без TTL | Стан quality-опитування/фідбеку |
| `slack-thread-comment-sync:<syncId>` | STRING | 7 днів (`SET NX EX`) | Ідемпотентність синку Slack→Notion коментаря |

### 9.1 Форма запису задачі (`notion:<pageId>`, `saveTask`)

```
{
  departmentKey, slackUserId, slackChannelId, slackMessageTs, slackThreadTs,
  taskName, requesterName, taskKind ('task'|'feedback'), parentPageId,
  pageUrl, team, hub, requestType,
  lastStatus, lastAssignee, lastDesignerName, lastDesignerUserId,
  lastDeadline, lastFinalProjectUrl, snapshotInitialized,
  trackedAt, lastCommentId, lastCommentCreatedTime, roundsCount
}
```

Кожна read/update-операція (`getTask`, `updateStatus`, `updateTaskSnapshot`, `incrementRoundsCount` тощо) прогонює `departmentKey` через `resolveDepartmentKey()` перед поверненням/збереженням — тобто в застосунку завжди бачимо резолвлене значення, навіть якщо в самому Redis лежить сире/легасі значення.

### 9.2 Черга сабмітів — деталі структур

Елемент `task-submission-queue-item:<id>`:
```
{ id, createdAt, nextAttemptAt, attempts, payload[, lastError] }
```

`getDueTaskSubmission(now)` — точний контракт повернення:
- повертає `null`, коли черга дійсно порожня (немає елементів із `score ≤ now`, або елемент вже забрав інший виклик — `zrem` повернув 0);
- повертає `{ id, key, missing: true }`, коли due-елемент вибрано з ZSET, але відповідний STRING-запис протух за TTL (`FAILED_SUBMISSION_TTL_SECONDS`), поки worker довго не запускався;
- в іншому разі повертає `{ ...розпарсений payload, key }`.

Виклик у `processQueuedTaskSubmissions` (`src/handlers/submission.js`) трактує `missing: true` як "пропустити цей елемент і читати чергу далі" (`continue`), а не "чергу вичерпано" (`break`) — саме так один осиротілий елемент не блокує обробку решти due-елементів у тому самому проході воркера.

`recoverOrphanedTaskSubmissions({ excludeIds })` сканує (`KEYS`) усі `task-submission-queue-item:*`, і якщо для ключа немає відповідного запису в ZSET (`zscore` повертає `null`) — повертає його в чергу з `score = min(nextAttemptAt, now)`.

### 9.3 `getAllTasks()` / `getAllTaskRecordsRaw()`

`getAllTasks()` (`KEYS notion:*` + `MGET`-подібний прохід) повертає масив записів із **резолвленим** `departmentKey` — використовується поллером, синком тредів тощо.

`getAllTaskRecordsRaw()` — та сама вибірка, але повертає **сире** значення `departmentKey` без резолюції, у формі `{ pageId, key, raw }`. Використовується виключно скриптом `backfillDepartmentKey.js` (розділ 16), якому потрібно розрізняти "поля немає в записі взагалі" (легасі-запис) від "поле є, але не розпізнається" (підозрілий випадок).

### 9.4 `setDepartmentKeyIfMissing(key, departmentKey)`

Перечитує запис безпосередньо перед записом (щоб не перезаписати паралельну зміну від живого бота між читанням і записом), і записує `departmentKey` тільки якщо запис існує І в ньому ще немає власного `departmentKey`. Повертає `true`, лише якщо дійсно щось записав.

### 9.5 Quality feedback (`feedback:<pageId>`)

```
{
  pageId, departmentKey, slackUserId, taskName, requesterName, requestUrl,
  team, hub, requestType, completedAt,
  feedbackSurveySentAt,
  rating, comment, categories, feedbackSubmittedAt
}
```

`markFeedbackSurveySent` пише `feedbackSurveySentAt` лише один раз (повторний виклик повертає `{ alreadySent: true }` і нічого не міняє). `saveQualityFeedback` окремо пише `rating`/`comment`/`categories`/`feedbackSubmittedAt` і дублює `rating`/`feedbackSubmittedAt` назад у `notion:<pageId>`-запис (поля `feedbackRating`/`feedbackSubmittedAt`).

### 9.6 Slack-тред ↔ Notion-сторінка (`getTaskBySlackThread`)

Проходить по всіх `getAllTasks()`, шукає збіг `slackThreadTs`(або `slackMessageTs`, якщо треду немає) з переданим `threadTs`, і `slackChannelId` рівний або каналу, або самому `slackUserId` (для DM-каналів це може бути еквівалентно). Якщо збігів декілька (наприклад корінь задачі + sub-item-правка в тому самому треді) — пріоритет віддається запису, чий `slackMessageTs` дорівнює кореню треду (`threadTs`).

### 9.7 Launch context (`notion-launch:<parentTaskId>`)

```
{ parentTaskId, parentPageName, payload, createdAt }
```

Записується через `saveLaunchContext` з `src/notion/launchWebhook.js`, читається через `getLaunchContext`. Без TTL — живе, поки не буде перезаписано новим викликом webhook-а з тим самим `parentTaskId`.

---

## 10. Notion-поллінг (`src/notion/pollStatus.js`)

### 10.1 `startPolling(slackClient)` і одинак (singleton guard)

```js
export async function startPolling(slackClient) {
  if (pollingStarted) {
    console.warn('startPolling() called again in the same process — ignoring, polling is already running.')
    return
  }
  pollingStarted = true
  ...
}
```

Модульна змінна `pollingStarted` гарантує, що повторний виклик `startPolling()` у межах ОДНОГО процесу — безпечний no-op з попередженням у лог, а не подвоєння набору таймерів. Для кожного активного відділу (`getAllDepartments()`) планується `setTimeout` (перший запуск) + `setInterval` (повторення) з `intervalMs = department.pollIntervalSec × 1000` (мінімум 1 секунда, за замовчуванням 180). Перший запуск кожного наступного відділу додатково зсувається на `index × NOTION_POLL_STARTUP_STAGGER_MS` (за замовчуванням 10 секунд), щоб не бити по Notion усіма відділами одночасно при старті процесу.

### 10.2 Черга циклів поллінгу

Виклики циклів для різних відділів проходять через FIFO-чергу (`pollingQueue`/`drainPollingQueue`) з м'ютексом `pollingQueueRunning`, а кожен окремий відділ додатково захищений від накладання свого власного повторного циклу через `pollingInProgressByDepartment` (`Set`) — якщо попередній цикл для відділу ще не завершився, новий запуск для того самого відділу пропускається з попередженням, а не ставиться паралельно.

### 10.3 Один цикл (`runPollingCycle(slackClient, department)`)

1. Гард: якщо глобальний rate-limit cooldown ще не минув (`Date.now() < pollingPausedUntil`) — пропустити весь цикл.
2. Завантажити всі трековані задачі з Redis, відфільтрувати за `resolveDepartmentKey(task.departmentKey) === department.key`.
3. Задачі, чий збережений `lastStatus` вже "завершальний" (`isCompletedStatus`), одразу зупиняються (`stopPollingCompletedTask`) без запиту актуального стану з Notion.
4. Решта задач обмежується батчем `NOTION_POLL_TASK_BATCH_SIZE` (за замовчуванням 25) — сортування за часом останнього опитування (найдавніше опитані — першими), щоб жодна задача не "голодувала" при великій кількості активних задач.
5. Для кожної задачі з батчу — `notion.pages.retrieve`, витягування поточного статусу (`extractTaskSnapshotFromPage`, з урахуванням `getStatusPropertyNames(departmentKey)`); для Design (`supportsFeedbackRounds`) додатково — дочірні sub-item-задачі через `notion.databases.query` за `Parent item`-relation, коли статус — "Comments".
6. **Порівняння статусу**: точний рядковий збіг спочатку; якщо різниця лише в регістрі/пробілах (`normalizeStatusName`) — тихе оновлення знімка БЕЗ Slack-сповіщення; якщо статус справді змінився — `sendStatusUpdate` у Slack, потім checkpoint (або зупинка поллінгу, якщо новий статус — завершальний).
7. **Зміна полів** (коли статус не змінився): порівняння відповідального/фінального URL проти збереженого знімка — `sendTaskFieldUpdate` і/або `sendReviewRequest` (для Design, коли з'явився фінальний URL при статусі "Comments" і це перший раунд).
8. **Нові коментарі**: обмежено `MAX_COMMENT_POLLS_PER_CYCLE` (за замовчуванням 8) задач за цикл і мінімальним інтервалом `NOTION_COMMENT_POLL_INTERVAL_MS` (за замовчуванням 15 хв) між опитуваннями коментарів однієї задачі. Порівняння — за збереженим `lastCommentId` (усе після нього — нове) або, якщо його немає, за `lastCommentCreatedTime`. Коментарі, чий текст починається з `Slack thread · ` (mirror-echo коментарі, створені самим ботом із Slack-треду), розпізнаються й пропускаються без повторного сповіщення (`isSlackThreadMirrorComment`) — це і є анти-петля між пунктами 12 і "Notion → Slack".
9. **Rate-limit cooldown**: якщо будь-який запит у циклі впав з 429/`rate_limited` — увесь поллінг ставиться на паузу (`pollingPausedUntil = now + cooldownMs`), де `cooldownMs` — або `Retry-After`-заголовок, або `NOTION_POLL_RATE_LIMIT_COOLDOWN_MS` (за замовчуванням 10 хвилин), що більше. Це окремий, грубіший механізм на рівні всього циклу поллінгу, додатковий до `notionRequest`-івського per-call ретраю (розділ 17).
10. У `finally` відділ завжди прибирається з `pollingInProgressByDepartment`.

### 10.4 Класифікація статусів

`isCompletedStatus(status, department)`: `true`, якщо нормалізований статус входить у `department.completedStatuses`, АБО містить `cancel`, `скас`, чи `done`.

`isQualitySurveyStatus(status, department)`: `true`, якщо статус входить у `department.qualitySurveyStatuses`; якщо цей список порожній — `true`, якщо статус дорівнює/містить `ready`/`реді`.

### 10.5 "Read comments" capability і fallback

При помилці `restricted_resource`/403 на `notion.comments.list` бот назавжди (до перезапуску процесу) вимикає опитування коментарів (`commentPollingEnabled = false`) і одноразово логує попередження про потребу увімкнути capability `Read comments` для інтеграції — далі бот продовжує надсилати лише статусні сповіщення, як і описано в README.

---

## 11. Feedback rounds (правки) — тільки Design

### 11.1 Поява кнопки

Кнопка `✏️ Дати правки` (`tasksbot_open_feedback_modal`) з'являється на кореневому повідомленні задачі тільки для Design, коли статус — `Comments` (`getStatusActionElements` у `src/slack/notify.js`).

### 11.2 Модалка `tasksbot_feedback_submission` (`src/handlers/feedbackModal.js`)

Заголовок `Правка #{N}`, submit `Надіслати правки`, close `Скасувати`. Секції: `*Задача:* {назва}\n*Раунд правок:* {N}`, інструкція `Перед відправкою перевір, чи ця правка допоможе бізнес-результату: конверсії, клікам, довірі, зрозумілості або швидшому рішенню користувача. Якщо зміна радше про смак чи нове бачення, познач її як субʼєктивну.`, поле `feedback_type` (radio, `Тип правки`): `Об'єктивна` (`Є відхилення від ТЗ, формату, факту або вимоги.`) / `Суб'єктивна` (`Не зайшов напрям, змінилися очікування або смак.`), поле `feedback_text` (`Правка і очікуваний результат`, multiline, placeholder `Що змінити, навіщо це потрібно і який результат очікуємо...`).

### 11.3 Обробка сабміту (`src/handlers/feedbackSubmission.js`)

Перевіряє, що `roundNumber` із `private_metadata` дорівнює очікуваному наступному номеру раунду (`getRoundsCount(pageId) + 1`) — якщо ні (кнопку натиснули на застарілому повідомленні) — показує повідомлення `⚠️ Це рев'ю вже неактуальне. Дочекайся оновлення головного повідомлення, коли статус знову стане «Comments».` і оновлює джерело кнопки текстом `✏️ *Правки #{N} вже передано дизайнеру*` + `Кнопки цього рев'ю вимкнено. Коли статус задачі знову стане «Comments», актуальні кнопки зʼявляться в головному повідомленні задачі.`. Інакше — створює sub-item через `createFeedbackSubitem`, збільшує `roundsCount`, оновлює кореневе повідомлення задачі, надсилає DM з новою правкою і кнопкою `📋 Відкрити в Notion / додати файли`, зберігає новий Redis-запис (`taskKind: 'feedback'`, `parentPageId` = батьківська задача).

### 11.4 Готовність до прийняття (`src/notion/taskAcceptanceReadiness.js`)

`getTaskAcceptanceReadiness(pageId, departmentKey)`: паралельно читає сторінку і всі дочірні sub-item-задачі (`Parent item`-relation). `canAccept = isCommentsStatus(status) && !hasBlockingSubtasks`, де `hasBlockingSubtasks` — `true`, якщо хоч один sub-item НЕ в прийнятному статусі (`isAcceptableSubtaskStatus`: `ready`/`реді`, `done`, будь-що з `complete`/`готов`/`виконан`, або точно `правка done`, або статус, що містить одночасно `правк` і `done`).

### 11.5 Прийняття результату (`tasksbot_accept_task_result`, `src/handlers/resultAcceptance.js` → `handleTaskAcceptance`)

Для звичайної задачі спершу перевіряється `getTaskAcceptanceReadiness`; якщо `canAccept: false` — користувач бачить `⚠️ Поки не можна прийняти результат: спершу всі сабтаски мають бути у статусі «Ready», «Done» або «Правка Done».` (якщо блокують сабтаски) або `⚠️ Кнопка прийняття вже неактуальна. Прийняти результат можна тільки коли основна задача у статусі «Comments». Зараз статус задачі: «{status}».`. Для sub-item-правки такої перевірки немає — приймається одразу.

`acceptTaskResult()` (`src/notion/acceptTask.js`): читає сторінку, визначає властивість статусу (`resolveStatusPropertyName`), пише новий статус (`Ready` для задачі, `Правка Done` для правки) і додає Notion-коментар з `@mention` дизайнера (якщо є Slack-подібний `designerUserId`) або текстовим `@handle` (транслітерований з імені), з текстом `замовник прийняв задачу, позначено як готово!` або `замовник прийняв правку, статус оновлено на «{status}».`.

Після прийняття: `deleteTask(pageId)` (Redis-запис видаляється повністю), одноразова відправка quality survey (якщо ще не надсилалась і це не sub-item-правка), оновлення джерела кнопки текстом `✅ *{назва}* прийнято після внесених правок.`/`прийнято без правок.`/(для правки) `✅ *{назва}* прийнято. Статус правки у Notion оновлено на «{status}».`.

### 11.6 Quality rating (`tasksbot_quality_rating_N`, `handleQualityRating`/`handleQualityFeedbackSubmission`)

Оцінка `5` зберігається одразу (без модалки) — `saveAndSyncFeedback` + оновлення повідомлення текстом `✅ *Фідбек прийняли*\n*{назва}*\n\n✨ *Твоя оцінка:* {зірки}` + подяка. Оцінки `1–4` відкривають модалку `tasksbot_quality_feedback_submission` із опційними чекбоксами категорій (`Контекст`, `Темп`, `Ясність`, `Результат`) і опційним коментарем; сабміт зберігає й синкає той самий запис. `syncQualityFeedbackToNotion` (`src/notion/feedbackDatabase.js`) пише окрему сторінку в feedback-базу відділу (`department.feedbackDatabaseId`, або глобальний хардкод-fallback `164e70dbe0774b8ca7fa761ab2f0e6a5`, якщо жодного `NOTION_FEEDBACK_DATABASE_ID` не задано) — властивості визначаються "м'яко" (перша знайдена властивість з відповідною назвою й типом; при відсутності "ідеального" типу — деградація до `rich_text`), тож синк не падає навіть при відмінностях схеми бази.

---

## 12. Thread comment sync (`src/slack/threadComments.js`)

### 12.1 Slack → Notion

`registerThreadCommentSync(app)` слухає загальну Slack-подію `message` і вручну фільтрує (`isHumanThreadReply`): не bot-повідомлення (без `subtype`/`bot_id`/`app_id`), є `user`/`channel`/`ts`, є `thread_ts ≠ ts` (це реплай, не корінь), і (якщо поле присутнє) `channel_type === 'im'`. Текст нормалізується (декодує `&lt;`/`&gt;`/`&amp;`, перетворює Slack-розмітку посилань `<url|label>` на `label (url)`). Задача шукається через `getTaskBySlackThread`; якщо не знайдена — подія ігнорується. Ідемпотентність — `claimSlackThreadCommentSync(syncId)` (`syncId` = `client_msg_id` або `channel:ts`) через Redis `SET NX EX 7 днів`; якщо клейм не вдався — подія вже (або зараз) обробляється, вихід без дій. Ім'я автора резолвиться через `client.users.info` (`real_name` → `display_name` → `name` → сирий userId). Коментар створюється через `createSlackThreadComment({pageId, authorName, text})` (`src/notion/comments.js`), яка формує тіло `Slack thread · {authorName}\n\n{text}`. При помилці створення коментаря — клейм звільняється (`releaseSlackThreadCommentSync`, щоб дозволити повторну спробу пізніше) і користувачу в тред надсилається `Не зміг перенести цей коментар у Notion. Помилка: {текст помилки}`. При успіху клейм лишається назавжди застовпленим (без релізу) — щоб той самий Slack-меседж ніколи не синкнувся вдруге.

### 12.2 Notion → Slack (анти-петля)

Поллер (розділ 10.3, пункт 8) при виявленні нового Notion-коментаря спершу перевіряє його текст через `isSlackThreadMirrorComment` — якщо текст (після нормалізації) починається з `slack thread ·`, це коментар, який сам бот щойно створив із кроку 12.1 (echo Slack-репляю в Notion) — такий коментар пропускається без повторного сповіщення в Slack. Це і є механізм, що не дає репляю користувача в Slack повернутися до нього ж другим повідомленням "новий коментар у Notion".

---

## 13. Slack App — необхідна конфігурація

**OAuth Scopes**: `commands`, `chat:write`, `im:write`, `im:history`, `users:read`, `users:read.email`. Явно НЕ потрібні й не запитуються: `im:read`, `mpim:history`, `files:read`, `app_mentions:read`.

**Event Subscriptions**: `app_home_opened`, `message.im` (у коді підписка на `message.im` реалізована через загальний `app.event('message', ...)` з ручною фільтрацією до `channel_type === 'im'`, оскільки Bolt HTTP-режим отримує один потік `message`-подій; сам Slack App у Slack-налаштуваннях все одно повинен мати підписку саме на `message.im`, щоб ці події взагалі надходили). Request URL для Event Subscriptions: `https://<host>/slack/events`.

**Slash Commands**: `/new-task` і `/event-request` (обидві реєструються в `src/handlers/newTask.js`), Request URL: `https://<host>/slack/events`.

**Interactivity & Shortcuts**: Request URL `https://<host>/slack/events` (той самий шлях, що й Events).

**App Home**: увімкнена вкладка Home (публікується при `app_home_opened`); увімкнена вкладка Messages з вимкненим read-only режимом, щоб користувачі могли писати в тред повідомлень бота (потрібно для синку відповідей у Notion-коментарі). Після зміни scopes або налаштувань App Home потрібен **Reinstall to Workspace**.

Поточний текстовий вміст App Home (розділ 3, `src/slack/home.js`) описує персону "PR & Comms Bot" — це відома тимчасова заглушка-копірайт, яка стосується initial use-case бота (PR/Comms) і не відображає фактичний мультивідомчий флоу (Design/SMM/Event); при перенесенні в unified-бот цей текст замінюється на власний Home Tab контент цільового бота (детальніше — розділ 17).

**Довгий опис (Long Description)** для Display Information — точний текст (`docs/slack-app-long-description.md`, ідентичний блоку в README):

```text
Tasks Bot допомагає командам швидко створювати запити зі Slack без ручного перенесення брифів у Notion.

Користувач відкриває App Home або викликає slash command /new-task, обирає відділ і тип задачі, заповнює короткий бриф у Slack modal, а бот створює відповідну сторінку в Notion database. Після створення задачі бот надсилає користувачу повідомлення в DM-треді з посиланням на Notion. Коли статус задачі або результат у Notion змінюється, бот оновлює Slack-тред і повідомляє автора задачі. Якщо користувач відповідає текстом у треді повідомлення бота, ця відповідь переноситься як коментар до відповідної Notion-сторінки.

Бот не читає публічні канали, приватні канали, групові DM або історію всього workspace. Бот не читає Slack-uploaded файли. Якщо користувачу потрібно передати матеріали, він додає посилання на Figma, Google Drive або інший ресурс у формі/треді, або відкриває створену задачу в Notion і додає матеріали там.

Permissions:
- commands: потрібен тільки для slash command /new-task, який відкриває форму створення задачі.
- chat:write: потрібен, щоб бот міг надсилати користувачу підтвердження, статусні апдейти, повідомлення в треді задачі, quality survey та оновлювати власні повідомлення.
- im:write: потрібен, щоб бот міг створити або знайти DM-канал з користувачем і доставити персональні повідомлення про його задачу.
- im:history: потрібен тільки для читання текстових відповідей користувача в DM-треді повідомлення бота, щоб перенести ці відповіді в Notion як коментарі до конкретної задачі.
- users:read: потрібен, щоб отримати ім'я/display name користувача, який створив задачу або написав коментар у треді, і записати це ім'я в Notion замість технічного Slack ID.
- users:read.email: потрібен, щоб отримати email requester-а і знайти відповідного Notion user для поля Owner.

User whitelist / data boundary:
- users:read використовується тільки для користувача, який сам взаємодіє з ботом: створює задачу через /new-task або App Home, натискає кнопку в повідомленні бота, залишає текстову відповідь у DM-треді задачі.
- users:read.email використовується тільки для requester-а задачі під час створення Notion page; email не зберігається в Redis і потрібен лише для зіставлення з Notion user.
- im:history використовується тільки для DM-тредів повідомлень, які бот сам створив для конкретної задачі й зберіг у Redis як зв'язку Slack thread ↔ Notion page.
- chat:write та im:write використовуються тільки для повідомлень, пов'язаних із задачами цього бота.
```

---

## 14. Повний перелік змінних середовища

### 14.1 Slack / інфраструктура

| Змінна | Призначення | Дефолт |
|---|---|---|
| `SLACK_BOT_TOKEN` | Bot token; відсутність або `placeholder` вмикає stub-режим | — |
| `SLACK_SIGNING_SECRET` | Перевірка підпису Slack-запитів | — |
| `PORT` | Порт Express/stub-сервера | `3000` |
| `DESIGN_CHANNEL_ID` | Канал командних сповіщень Design | — (опційно) |
| `SMM_CHANNEL_ID` / `SLACK_SMM_NOTIFY_CHANNEL` | Канал командних сповіщень SMM | — (опційно) |
| `EVENT_CHANNEL_ID` / `SLACK_EVENT_NOTIFY_CHANNEL` | Канал командних сповіщень Event | — (опційно) |
| `SLACK_EVENT_OWNER_ID` / `SLACK_MARIA_USER_ID` | Slack ID власника Event для `<@id>`-згадки | `.env.example`: `U0A2SF2NG8K` |
| `REDIS_KEY_PREFIX` | Префікс усіх Redis-ключів (тестовий namespace) | `''` |
| `TEST_TASK_PREFIX` | Префікс назв тестових задач (напр. `[ТЕСТ]`) | `''` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Доступ до Upstash Redis | — |

### 14.2 Notion — глобальні

| Змінна | Призначення | Код-дефолт | `.env.example` |
|---|---|---|---|
| `NOTION_TOKEN` | Токен інтеграції Notion | — | — |
| `NOTION_TEMPLATE_TIMEZONE` | Таймзона для `template.timezone` при застосуванні шаблону | `Europe/Kiev` | `Europe/Kiev` |
| `NOTION_REQUEST_MIN_INTERVAL_MS` | Мінімальний інтервал між стартами послідовних Notion-запитів | 1000 | 500 |
| `NOTION_REQUEST_MAX_RETRIES` | Максимум ретраїв на 429 в `notionRequest` | 4 | 4 |
| `NOTION_POLL_RATE_LIMIT_COOLDOWN_MS` | Пауза всього циклу поллінгу після 429 | 600000 (10 хв) | 600000 |
| `NOTION_POLL_STARTUP_STAGGER_MS` | Зсув першого запуску поллінгу між відділами | 10000 | немає в `.env.example` |
| `NOTION_POLL_TASK_BATCH_SIZE` | Максимум задач на цикл поллінгу відділу | 25 | немає в `.env.example` |
| `NOTION_COMMENT_POLL_INTERVAL_MS` | Мінімальний інтервал опитування коментарів однієї задачі | 900000 (15 хв) | немає в `.env.example` |
| `NOTION_MAX_COMMENT_POLLS_PER_CYCLE` | Максимум задач, для яких опитуються коментарі за один цикл | 8 | немає в `.env.example` |
| `NOTION_PEOPLE_CACHE_TTL_MS` | TTL кешу списку людей workspace | 86400000 (24 год) | 86400000 |
| `NOTION_FEEDBACK_DATABASE_ID` | Глобальний fallback feedback-бази | хардкод `164e70dbe0774b8ca7fa761ab2f0e6a5` | порожньо |
| `NOTION_PARENT_ITEM_PROPERTY` | Назва relation-властивості "батьківська задача" | `Parent item` | `Parent item` |
| `NOTION_SUB_TYPE_PROPERTY` | Назва select-властивості sub-типу | `Sub-type` | `Sub-type` |
| `NOTION_FEEDBACK_SUB_TYPE` | Значення sub-типу для sub-item-правок | `правка` | `правка` |
| `NOTION_DESCRIPTION_PROPERTY` | Назва rich_text-властивості опису | `Description` | `Description` |
| `NOTION_FEEDBACK_TYPE_PROPERTY` | Назва властивості типу правки | `Тип правки` | `Тип правки` |
| `NOTION_STATUS_PROPERTY` | Легасі-назва статусної властивості (лише Design fallback) | — | `Design Status` |
| `NOTION_DATABASE_ID` | Легасі спільний database id (fallback для Design/SMM/Event) | — | порожньо |
| `NOTION_ACTIVITIES_DATABASE_ID` | Спільна Activities-база для SMM/Event | хардкод `b1ff9daa012c41c597e1d5ad5dd91917` | `b1ff9daa012c41c597e1d5ad5dd91917` |

### 14.3 Notion — Design

| Змінна | Код-дефолт | `.env.example` |
|---|---|---|
| `NOTION_DESIGN_DATABASE_ID` / `NOTION_DATABASE_ID` | — | порожньо |
| `NOTION_DESIGN_TEMPLATE_ID` / `NOTION_TEMPLATE_ID` | — | порожньо |
| `NOTION_DESIGN_HUB_URL` / `NOTION_BRAND_DESIGN_HUB_URL` | хардкод Brand Design Hub URL | не задано (використовується хардкод) |
| `NOTION_DESIGN_FEEDBACK_DATABASE_ID` | — (fallback на `NOTION_FEEDBACK_DATABASE_ID`) | порожньо |
| `NOTION_DESIGN_STATUS_PROPERTY` / `NOTION_STATUS_PROPERTY` | `Design Status` | `Design Status` |
| `NOTION_DESIGN_INITIAL_STATUS` | `To do` | `To do` |
| `NOTION_DESIGN_COMPLETED_STATUSES` / `NOTION_POLL_COMPLETED_STATUSES` | `Ready,Cancelled,Canceled` | `Ready` (для обох змінних) |
| `NOTION_DESIGN_QUALITY_SURVEY_STATUSES` | `Ready` | `Ready` |
| `NOTION_DESIGN_POLL_INTERVAL_SEC` | 180 | 180 |
| `NOTION_DESIGN_OWNER_ID` | хардкод `f342c30b-c5c1-4a52-8cdf-c8b636928364` | той самий |
| `NOTION_DESIGN_OWNER_LABEL` | — | порожньо |
| `NOTION_DESIGN_TEAM` | `Brand Design` | `Brand Design` |
| `DESIGN_CHANNEL_ID` | — | — |
| `DESIGN_*_MIN_LEAD_DAYS` (36 змінних) | див. розділ 6.1 | значення в `.env.example` збігаються з код-дефолтами |

### 14.4 Notion — SMM

| Змінна | Код-дефолт | `.env.example` |
|---|---|---|
| `NOTION_SMM_DATABASE_ID` / `NOTION_SMM_TEMPLATE_ID` / `NOTION_SMM_TASK_TEMPLATE_ID` | — | порожньо |
| `NOTION_SMM_HUB_URL` | хардкод SMM Hub URL | той самий URL |
| `NOTION_SMM_FEEDBACK_DATABASE_ID` | хардкод `025dce2c634e4a079ee7600ea8c63253` | той самий |
| `NOTION_SMM_STATUS_PROPERTY` | `SMM статус` | `SMM статус` |
| `NOTION_SMM_INITIAL_STATUS` | `To do` | `To do` |
| `NOTION_SMM_COMPLETED_STATUSES` | `Published,Canceled,Cancelled` | той самий |
| `NOTION_SMM_QUALITY_SURVEY_STATUSES` | `Published` | `Published` |
| `NOTION_SMM_POLL_INTERVAL_SEC` | 180 | 180 |
| `NOTION_SMM_OWNER_ID` | хардкод `77a3e7fe-a555-4c14-b794-d63a6e42a324` | той самий |
| `NOTION_SMM_OWNER_LABEL` | `Anna Gayuk` | `Anna Gayuk` |
| `NOTION_SMM_TEAM` | `SMM` | `SMM` |
| `SMM_CHANNEL_ID` / `SLACK_SMM_NOTIFY_CHANNEL` | — | порожньо |
| `SMM_*_MIN_LEAD_DAYS` (13 змінних із `.env.example`, `SMM_VIDEO_EDITING_MIN_LEAD_DAYS` — код-only, немає в `.env.example`) | див. розділ 6.2 | значення збігаються з код-дефолтами |

### 14.5 Notion — Event

| Змінна | Код-дефолт | `.env.example` |
|---|---|---|
| `EVENT_DEPARTMENT_ENABLED` | `false` | `.env.example`: `false`; поточне продакшн-значення: `true` |
| `NOTION_EVENT_DATABASE_ID` | — (fallback на `NOTION_ACTIVITIES_DATABASE_ID`) | порожньо |
| `NOTION_EVENT_TEMPLATE_ID` / `NOTION_EVENT_TASK_TEMPLATE_ID` | хардкод `34ace9899cb780afb5b5e4ba36e1c2e2` | `NOTION_EVENT_TEMPLATE_ID` = той самий |
| `NOTION_EVENT_HUB_URL` | хардкод Event Manager Hub URL | той самий URL |
| `NOTION_EVENT_STATUS_PROPERTY` | `Status` | `Status` |
| `NOTION_EVENT_INITIAL_STATUS` | `Backlog` | `Backlog` |
| `NOTION_EVENT_COMPLETED_STATUSES` | `Done,Completed,Canceled,Cancelled` | той самий |
| `NOTION_EVENT_QUALITY_SURVEY_STATUSES` | `''` | не задано в `.env.example` |
| `NOTION_EVENT_POLL_INTERVAL_SEC` | 180 | не задано в `.env.example` |
| `NOTION_EVENT_OWNER_ID` | хардкод `2cdd872b-594c-815b-acd7-000259d98a51` | той самий |
| `NOTION_EVENT_OWNER_LABEL` | `Mariia Tarasiuk` | той самий |
| `NOTION_EVENT_TEAM` | `Event` | `Event` |
| `NOTION_EVENT_FEEDBACK_DATABASE_ID` | — (fallback на глобальний хардкод) | не задано |
| `EVENT_CHANNEL_ID` | — | порожньо |
| `EVENT_*_MIN_LEAD_DAYS` (10 плоских змінних — `MERCH`, `GIFTS_READY`, `ACTIVITY`, `STAND_CONCEPT_SIMPLE`, `STAND_CONCEPT_COMPLEX`, `FIELD_CONFERENCE`, `NEW`, `SUPPORT`, `MATERIALS`, `REPORT`) | див. розділ 6.3 | жодна не задана в `.env.example` |

Лід-тайми для рівнів складності Event (`event_internal_*`, `event_external_*`, `conference_*`, `gifts_custom_*`) захардкоджені в коді й не мають відповідних env-змінних узагалі (розділ 6.3).

### 14.6 Черга сабмітів задач

| Змінна | Код-дефолт | `.env.example` |
|---|---|---|
| `TASK_SUBMISSION_QUEUE_INTERVAL_MS` | 5000 | 5000 |
| `TASK_SUBMISSION_QUEUE_MAX_ATTEMPTS` | 20 | 20 |
| `TASK_SUBMISSION_QUEUE_RETRY_DELAY_MS` | 60000 | 60000 |
| `TASK_SUBMISSION_QUEUE_MAX_RETRY_DELAY_MS` | 600000 | 600000 |
| `FAILED_SUBMISSION_TTL_SECONDS` | 2592000 (30 днів) | 2592000 |

### 14.7 Скрипти (не потрапляють у продакшн-runtime бота, лише ручні прогони)

| Змінна | Використання |
|---|---|
| `BACKFILL_DETAIL_LIMIT` | `src/scripts/backfillSlackPersonPeople.js` — обмежує кількість детальних рядків у виводі (за замовчуванням 40) |

---

## 15. Deployment / Railway

Білд — Nixpacks (`railway.json`): `{"build": {"builder": "NIXPACKS"}, "deploy": {"startCommand": "npm start", "restartPolicyType": "ON_FAILURE", "restartPolicyMaxRetries": 10}}`.

У репозиторії — два Railway-сервери на одному коді, з різними змінними середовища:

- **Продакшн**: project `responsible-healing`, service `slack-notion-bot`, environment `production`. Slack Request URL (Event Subscriptions, Interactivity & Shortcuts, slash-команди): `https://<production-host>/slack/events`.
- **Тестовий (sandbox)**: окремий Railway project/service з окремим тестовим Slack app/workspace, `REDIS_KEY_PREFIX=test:` і `TEST_TASK_PREFIX=[ТЕСТ]`, але тими самими живими Notion database ID.

Перед будь-якими логами, зміною env-змінних або деплоєм варто перевіряти, який саме сервіс/environment активний, щоб не оновити не той сервер. Локальний запуск: `npm install && npm start`, за замовчуванням слухає `PORT=3000`; для розробки з публічним URL — ngrok/Cloudflare Tunnel з відповідним Request URL у Slack App.

Додатковий (не-Slack) endpoint для запусків із Notion: `POST /notion/design-task-launch` (розділ 3.5, 8).

---

## 16. Test/sandbox conventions і внутрішня верифікаційна тулінг-база

**Sandbox-конвенції**: окремий тестовий Slack app/workspace token; `REDIS_KEY_PREFIX=test:` (ізольований Redis namespace); `TEST_TASK_PREFIX=[ТЕСТ]` (бот автоматично додає цей префікс до назви задачі через `applyTestTaskPrefix`); для Event sandbox — `EVENT_DEPARTMENT_ENABLED=true`; використовуються ті самі живі Notion database ID, що й у продакшні. Design/SMM-базах потрібен checkbox `Late` для late-флоу; для SMM — `Team=SMM`, `SMM статус`; для Event — `Team=Event`, `Event date`, `$ EB Budget`, `EB Activity Type`. Тестові задачі шукаються фільтром `Name contains [ТЕСТ]` і видаляються вручну після перевірки.

### 16.1 `npm run verify:*` — що саме перевіряє кожен скрипт

Усі скрипти в цій групі (крім `verify:notion-throttle`, у якого своя структура виводу) автономні — не потребують `NOTION_TOKEN`/`SLACK_BOT_TOKEN`/Redis, і використовують спільний патерн `check(label, fn)`: кожна окрема перевірка ловить власну помилку, друкує `✓`/`✗` і акумулює статус провалу (через `process.exitCode = 1` або локальний прапорець), не зупиняючи решту перевірок — тобто один прогін показує ВСІ провалені перевірки, а не тільки першу.

- **`verify:ids`** (`verifyInteractionIds.js`): звіряє, що кожен `VIEW_CALLBACK_IDS`/`ACTION_IDS` починається з `tasksbot_`; що білдери view (`buildDepartmentPickerView`, `buildDesignDomainPickerView`, `buildTaskTypePickerView`, `buildTaskComplexityPickerView`) повертають саме namespaced `callback_id`; що блок `Platform` у Design-модалках (для `static_simple`, `static_complex`, `ai_static_simple`, `ai_static_complex`, `ai_dynamic_simple`, `ai_dynamic_complex`, `carousel`) використовує саме `ACTION_IDS.platform`, а не стару сиру назву `platform`; що `isSubmitTaskView` вірно розрізняє поточний callback_id від легасі/чужих/`undefined`; що regex-патерни зворотної сумісності (`currentAndLegacyActionIdPattern`, `qualityRatingActionIdPattern`) приймають і новий, і легасі формат, але не приймають схожі, але сторонні рядки.
- **`verify:department-key`** (`verifyDepartmentKeyResolution.js`): `resolveDepartmentKey()` — відсутнє значення → `design` без жодного попередження; активні ключі (`design`, `smm`) → самі себе, без попереджень; невідомий ключ → `design` + рівно одне попередження, що містить сам ключ; повторний виклик з тим самим невідомим ключем → попередження НЕ дублюється (дедуп на процес); розпізнаний, але неактивний відділ (`event`, коли не увімкнений у поточному середовищі) → `design` + рівно одне попередження (перевірка сама себе пропускає, якщо в середовищі, де вона запущена, Event і так активний).
- **`verify:polling-guard`** (`verifyPollingSingletonGuard.js`): перший виклик `startPolling()` планує рівно по одному таймеру на кожен активний відділ і не логує жодного попередження; другий і третій виклики в тому самому процесі — нуль нових запланованих таймерів і рівно одне попередження на кожен виклик (`/startPolling\(\) called again/`), підтверджуючи, що гард стійкий, а не одноразовий. Завершується явним `process.exit(...)`, бо перший виклик реально ставить `setTimeout` на кілька хвилин наперед і без примусового виходу процес довго не завершився б.
- **`verify:notion-throttle`**: текстовий (не AST) статичний аналіз усіх `.js`-файлів під `src/`. Патерн порушення — виклик виду `notion<будь-що>.(pages|databases|blocks|comments|users).<метод>(` десь у файлі, для якого немає збігу `notionRequest(` ні в тому самому рядку, ні в жодному з 4 попередніх (після грубого видалення `//`-коментарів) рядків. Друкує кількість перевірених файлів і знайдених `new Client(...)` (інформаційно), список порушень `шлях:рядок: текст` при їх наявності (з підказкою обгорнути виклик у `notionRequest(() => ..., "мітка")`), і виходить з кодом `1`, якщо хоч одне порушення знайдено. У поточному стані коду скрипт проходить чисто — усі виклики Notion API обгорнуті.
- **`verify:pure-helpers`**: юніт-тести (без моків) на чисті/майже чисті хелпери, імпортовані напряму з реальних модулів: `getDaysUntil`/`getLeadTimeViolation` (`submission.js`) — межові випадки дат і SLA-порогу; `isCompletedStatus`/`isQualitySurveyStatus` (`pollStatus.js`) — розпізнавання завершальних/quality-статусів, включно з "статус містить cancel/скас"-евристикою і регістронезалежністю; `buildRichText` (`richText.js`) — автолінкування URL, обрізання довгого тексту, ліміт кількості об'єктів, відсутність лінкування email; `isNotionPeopleCacheStale` (`createPage.js`) — межові умови TTL-кешу людей Notion.
- **`verify`** (агрегат) — запускає всі п'ять вище послідовно (`npm run verify:ids && ... && npm run verify:pure-helpers`).

### 16.2 `backfill:department-key` (`backfillDepartmentKey.js`)

Поточний інструмент для матеріалізації неявного відділу легасі-записів у явний `departmentKey`. За замовчуванням — **dry-run**: читає всі записи через `getAllTaskRecordsRaw()`, рахує ті, де `raw.departmentKey` відсутній, друкує JSON-зведення (`{mode, totalRecords, missingDepartmentKey, updated, alreadyPresent}`) і список `pageId`, для яких *було б* виставлено `departmentKey="design"`, з підказкою повторити прогін з `--write`. З флагом `--write` для кожного знайденого запису викликається `setDepartmentKeyIfMissing(key, DEFAULT_DEPARTMENT_KEY)` (сам інкремент `updated` рахується лише якщо запис реально записав — захист від гонки, коли поле встигло з'явитися між читанням і записом). Ідемпотентний — повторний запуск після успішного `--write` більше нічого не змінить, бо всі записи вже матимуть `departmentKey`.

### 16.3 Інші допоміжні скрипти (ручні, живі мутуючі виклики — не автоматизовані тести)

- **`backfillSlackPersonPeople.js`**: для кожної кореневої (не sub-item/feedback) трекованої задачі намагається знайти й проставити Notion-властивість `Slack Person` (тип `people`), якщо вона ще порожня (або завжди, з флагом `--force`). Джерело кандидата — Slack `users.info` requester-а задачі (email + варіанти імені), зіставлення з робочим простором Notion — за email, потім за унікальним іменем (та сама логіка, що й `resolveNotionUserId`). За замовчуванням dry-run (`--write` для реального запису); окремі помилки по задачах не зупиняють весь прогін, а рахуються в підсумковому `summary.failed`.
- **`testDomainWrite.js`**: ручний smoke-тест (без автоматизованих перевірок) для кроку "З якого ти напрямку?" — створює через звичайний production-шлях `createNotionPage()` реальну Design-сторінку з `taskType: 'other'` і переданим `domain` (з CLI-аргументу, за замовчуванням `'PR'`), щоб вручну перевірити запис multi-select властивості `domain` у Notion; наприкінці нагадує видалити тестову сторінку.

---

## 17. Нотатки для інженера, який переносить цей функціонал у unified company bot

**Простір імен callback_id/action_id.** Усі `view`-callback_id і `action_id` цього бота живуть в одному файлі — `src/config/interactionIds.js` — під єдиним префіксом `tasksbot_`. Це зроблено, щоб при об'єднанні з іншим ботом у межах одного Slack App не виникало колізій з обробниками цього іншого бота: якщо два різних `app.action`/`app.view` зареєстровані на однаковий "голий" рядок на кшталт `platform` чи `submit_task`, Bolt викличе ОБИДВА обробники на одну й ту саму подію (подвійний `ack`, конфліктні side-effects, а для `platform` — навіть перезапис чужої відкритої модалки через `views.update`). Три action_id додатково приймають легасі (pre-namespace) форму заради зворотної сумісності: `accept_task_result`, `open_feedback_modal`, `quality_rating_N` (реєструються в `src/index.js`) і `open_new_task_from_home` (реєструється в `src/slack/home.js`) — усі чотири "заморожені" всередині вже надісланих і persistent Slack-повідомлень (кнопки на задачах, які можуть лишатися активними тижнями — лід-тайм окремих типів задач сягає 45–60 днів), тоді як `view`-callback_id (модалки) такого зворотносумісного варіанта не потребують, бо модалка існує лише в межах однієї короткої сесії користувача.

**Резолюція `departmentKey` — два різні випадки, різна гучність.** Redis-записи трекінгу задач без поля `departmentKey` (легасі-записи до появи Phase 2) мовчки резолвляться в `design` — це очікуваний, "тихий" випадок. Запис, у якому `departmentKey` ЗАДАНИЙ, але не розпізнається (typo, видалений або тимчасово неактивний відділ) — теж резолвиться в `design`, але ДОДАТКОВО одноразово (на унікальне значення, раз на процес) логує попередження `resolveDepartmentKey: "{key}" не розпізнано або відділ неактивний...`. Розрізнення навмисне: перший випадок — нормальна легасі-сумісність, другий — потенційно підозрілий стан, який варто побачити в логах.

**Одинак-гарди — тільки на рівні процесу.** І воркер черги сабмітів (`queueWorkerStarted` у `src/handlers/submission.js`), і поллер (`pollingStarted` у `src/notion/pollStatus.js`) захищені від повторного запуску module-scope прапорцями в межах ОДНОГО Node-процесу. Це НЕ захищає від кількох окремих OS-процесів/реплік, що одночасно звертаються до тієї самої черги/трекінгу в Redis — за такого сценарію (наприклад, два репліки одного деплою) можливе паралельне вихоплення тих самих задач із черги чи паралельний поллінг тих самих Notion-сторінок. Для повного захисту від цього потрібен розподілений лок (наприклад, `SET NX` у Redis з TTL на рівні всього циклу/чарги) — на сьогодні такого механізму в коді немає.

**Notion throttle — обов'язковий контракт, а не рекомендація.** Кожен виклик Notion API в цьому коді проходить через спільну чергу тротлінгу й ретраю `notionRequest()` (`src/notion/request.js`): серіалізує всі виклики процесу в одну чергу, витримує мінімальний інтервал між стартами запитів (`NOTION_REQUEST_MIN_INTERVAL_MS`), і повторює запит при 429/`rate_limited` (`Retry-After`-заголовок або експоненційний backoff, до `NOTION_REQUEST_MAX_RETRIES` разів). Це не просто конвенція — вона перевіряється автоматично: `npm run verify:notion-throttle` статично сканує весь `src/` і падає, якщо десь є виклик `notion.<домен>.<метод>(...)`, не обгорнутий у `notionRequest(...)` (у самому рядку або в одному з 4 попередніх рядків). Кожен файл, що звертається до Notion, створює власний локальний `new Client(...)` — спільного client-модуля немає, тому дотримання цього контракту особливо важливо тримати явним, а не покладатися на єдину точку інстанціації.

**Свідомо залишені як є речі, які не потребують подальшого рішення:**
- Чотири Event task types (`event_new`, `event_support`, `event_materials`, `event_report`) мають повністю визначені поля форми й лід-тайми в конфігурації, але не мають запису в `eventTaskTypeGroups` і не мають `label` у своєму конфіг-об'єкті — тому фолбек-логіка побудови `department.taskTypes` (`buildTaskTypesFromGroups`) їх пропускає, і вони фізично недосяжні через жоден Slack-шлях (ні picker, ні прямий виклик типу). Це поточний стан конфігурації, залишений навмисно, не технічний борг для виправлення.
- Скрипти й полегеро-читання Redis (`getAllTasks`, `getAllTaskRecordsRaw`, `recoverOrphanedTaskSubmissions` тощо) використовують команду `KEYS` (сканування всього keyspace за патерном), а не `SCAN` (курсорна ітерація без блокування). При фактичному й очікуваному обсязі задач цього бота (десятки-сотні активних трекованих записів, а не мільйони ключів) це прийнятно й не є проблемою продуктивності на даному масштабі.
- Поточний текстовий вміст App Home tab (`src/slack/home.js`, персона "PR & Comms Bot") — відома тимчасова заглушка; при перенесенні в unified-бот він заміняється на власний Home Tab контент цільового бота, а не адаптується.
- Погодження нових OAuth scope і Reinstall to Workspace (розділ 13) навмисно відкладені до фактичного моменту злиття в unified Slack App — виконувати це заздалегідь немає сенсу, доки не відомий фінальний список scope об'єднаного бота.

Будь-яку технічну неоднозначність, знайдену під час читання коду, яка ще потребує рішення (а не є свідомо залишеним поточним станом, як пункти вище), треба позначати міткою "⚠️ Потребує перевірки" окремо від решти тексту. У поточній кодовій базі такої відкритої неоднозначності немає.

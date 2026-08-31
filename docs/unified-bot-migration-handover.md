# Handover / Migration Specification — Slack → Notion Tasks Bot

> Джерело: повне читання репозиторію `slack-notion-bot` (усі файли `src/**`, `docs/**`, `README.md`, `package.json`, `railway.json`, `.env.example`) станом на дату підготовки документа. Документ призначений для інженера, який переносить поведінку цього бота в інший (unified company) бот **без доступу до цього коду** — тому всі назви, лейбли, значення і правила наведені буквально, без переказу.

---

## 1. Огляд і призначення бота

**Що робить.** Slack-бот `Tasks Bot` дозволяє співробітникам створювати робочі запити (задачі) через короткий бриф у Slack modal-формі. Бот:

1. Показує вибір команди/типу задачі у Slack (slash-команда `/new-task`, App Home, або `/event-request`).
2. Приймає бриф через модальні форми (кількість і склад полів залежить від відділу і типу задачі).
3. Створює відповідну сторінку в Notion database (кожен відділ пише у свою базу/вью).
4. Надсилає користувачу в Slack DM-тред підтвердження зі стосунком на Notion-сторінку.
5. Фоновий поллер кожні ~180 секунд (за замовчуванням, індивідуально per department) перевіряє статус і нові відкриті коментарі в Notion та надсилає апдейти назад у Slack (в той самий DM-тред).
6. Текстові відповіді користувача у цьому DM-треді автоматично переносяться в Notion як коментарі до задачі.
7. Для Design-відділу підтримується цикл "правок" (feedback rounds): sub-item-задачі-правки, кнопки прийняття результату, quality survey (5-зіркова оцінка + опційний коментар) при завершенні.

**Для кого.** Внутрішній компанійний бот (Universe Group / uni.tech). Оригінально — суто Design (dизайн-команда), потім розширений на SMM (greenfield) і Event (sandbox, Phase 3 rollout).

**Активні відділи в коді (`src/config/departments.js`):**

| Департамент (key) | Статус активності | Коментар |
|---|---|---|
| `design` | завжди активний | Legacy, поведінково ідентичний старому боту |
| `smm` | завжди активний | Greenfield, пише в Activities database з `Team=SMM` |
| `event` | активний лише якщо `EVENT_DEPARTMENT_ENABLED=true` **або** заданий `NOTION_EVENT_DATABASE_ID` | Sandbox route Phase 3, приховується з picker-а інакше |

`RESERVED_DEPARTMENT_KEYS = ['pr', 'employer_brand']` — зарезервовані, але не реалізовані ключі (заготовка на майбутнє, у коді більше ніде не використовуються).

**Загальна архітектура:**

- **Slack**: `@slack/bolt` v3, HTTP mode (не Socket Mode) через `ExpressReceiver`. Один Express app обслуговує і Slack events/interactivity (`/slack/events` за замовчуванням у Bolt), і власні кастомні маршрути (`/`, `/notion/design-task-launch`).
- **Notion**: `@notionhq/client` v2 (`Client`). Усі запити йдуть через кастомний rate-limit/retry wrapper `notionRequest` (throttle + retry на 429).
- **Redis**: `@upstash/redis` v1 (Upstash REST API, не звичайний TCP redis-клієнт). Зберігає: трекінг задач (status/comment polling state), sorted-set чергу сабмітів задач, чернетки невдалих сабмітів, quality-feedback записи, launch-context з Notion webhook, ідемпотентність синку Slack-thread → Notion comment.
- **`dotenv`** — завантаження `.env` (`import 'dotenv/config'` на початку `src/index.js`).

**Стек і версії (з `package.json`):**

```json
{
  "name": "slack-notion-bot",
  "version": "1.0.0",
  "type": "module",
  "main": "src/index.js",
  "scripts": { "start": "node src/index.js" },
  "dependencies": {
    "@slack/bolt": "^3.19.0",
    "@notionhq/client": "^2.2.15",
    "@upstash/redis": "^1.34.0",
    "dotenv": "^16.4.5"
  }
}
```

Проєкт — чистий ESM (`"type": "module"`), без TypeScript, без build step, без тестового фреймворку в залежностях. Запуск: `npm install && npm start` (= `node src/index.js`).

---

## 2. Архітектура і потік виконання

### 2.1 Загальний потік (від Slack-кліку до Notion і назад)

```
Slack (slash /new-task | App Home button | /event-request)
  → views.open() — крок 1: вибір відділу (якщо >1 активний департамент) або одразу крок Design-domain/тип задачі
  → app.view(select_department) → app.view(select_design_domain) [лише Design] → app.view(select_task_type)
    → [опційно] app.view(select_task_complexity), якщо у типу задачі є complexityOptions
  → модалка "📋 Бриф задачі" (callback_id=submit_task)
  → app.view(submit_task):
      - валідація lead-time (SLA дедлайну) — може повернути помилку/warning-view замість сабміту
      - enqueueTaskSubmission() → payload кладеться в Redis sorted set "task-submission-queue"
      - користувачу одразу надсилається "🕐 Задачу прийнято в чергу"
      - ack() модалки (закриває форму)
  → фоновий queue worker (setInterval, кожні TASK_SUBMISSION_QUEUE_INTERVAL_MS, за замовчуванням 5000мс)
      - забирає due item з sorted set (score = час, коли можна виконувати)
      - createTaskFromSubmissionPayload():
          - resolveSlackPerson() — Slack users.info → ім'я + email
          - createNotionPage() — Notion pages.create (+ ensureSelectOptionsExist, template apply, brief body append)
          - надсилає користувачу DM з кнопкою "Відкрити в Notion"
          - saveTask() у Redis (трекінг для поллера)
          - надсилає повідомлення в department.notifyChannel (якщо заданий)
      - при retriable помилці (429/5xx) — requeueTaskSubmission() з exponential backoff, до TASK_SUBMISSION_QUEUE_MAX_ATTEMPTS спроб
      - при невдачі остаточно — saveFailedSubmission() (чернетка в Redis), користувачу надсилається draftId
Фоновий Notion-поллер (окремий setInterval на кожен департамент, старт зі staggered delay)
  → тягне всі трековані задачі з Redis (getAllTasks), фільтрує за departmentKey
  → якщо задача вже completed (за lastStatus) — намагається одразу "закрити" polling (checkpoint + quality survey + deleteTask)
  → інакше пачками (до NOTION_POLL_TASK_BATCH_SIZE=25 за цикл) читає поточний Notion snapshot (status/assignee/designer/deadline/finalProjectUrl/parentPageIds)
  → порівнює зі збереженим у Redis:
      - новий статус → sendStatusUpdate() (Slack DM у тред + оновлення "кореневого" повідомлення задачі)
      - completed статус → stopPollingCompletedTask() (survey + deleteTask)
      - зміна "Відповідальний" або "Фінальний проєкт" (тільки якщо снепшот вже був) → sendTaskFieldUpdate() / sendReviewRequest()
      - для Design (supportsFeedbackRounds=true) при статусі Comments — окремо витягуються child-задачі-правки (query по Parent item relation) для перевірки готовності прийняття (canAcceptTaskResult)
      - раз на COMMENT_POLL_INTERVAL_MS (default 15 хв) на задачу — перевірка нових відкритих коментарів у Notion (notion.comments.list), надсилання sendCommentUpdate(), окрім коментарів, які самі є "mirror" (тобто були записані ботом же з Slack-треду — детектуються префіксом тексту "Slack thread ·")
Slack DM thread reply (подія message.im)
  → registerThreadCommentSync(app) → app.event('message', ...)
  → якщо це людська відповідь у тред (не бот, не сабтайп, канал типу im, thread_ts ≠ ts)
  → шукає задачу за (channelId, threadTs, slackUserId) у Redis (getTaskBySlackThread)
  → ідемпотентний claim через claimSlackThreadCommentSync(syncId) (syncId = client_msg_id або `channel:ts`)
  → createSlackThreadComment() → notion.comments.create() з текстом "Slack thread · {ім'я}\n\n{текст}"
Notion webhook (Notion automation → бот)
  → POST /notion/design-task-launch → парсить payload (шукає № ID / No ID / ID / parentTaskId тощо, навіть у вкладених полях) → saveLaunchContext() у Redis
```

### 2.2 Черга сабмітів задач (Redis sorted set) — деталі

- Redis-структури: `task-submission-queue` (ZSET, member=queueId, score=timestamp коли можна виконувати), `task-submission-queue-item:<id>` (STRING, повний payload+metadata).
- `enqueueTaskSubmission(payload, {delayMs, queueId})` — записує item і додає в ZSET зі score `now+delayMs`.
- `getDueTaskSubmission(now)` — `ZRANGE ... BYSCORE 0..now LIMIT 1`, потім `ZREM` (атомарний "pop" через zrem-after-read — можливий race, але прийнятний для одного worker-процесу), читає STRING-запис.
- `requeueTaskSubmission(item, {delayMs, error})` — інкремент `attempts`, новий `nextAttemptAt`, перезапис STRING + новий `zadd`.
- `completeTaskSubmission(queueId)` — видаляє STRING-запис і прибирає з ZSET.
- **Orphan recovery**: `recoverOrphanedTaskSubmissions({excludeIds})` — скан усіх ключів `task-submission-queue-item:*`, якщо запису немає в ZSET (`zscore` повертає null/undefined) і він не серед активно оброблюваних (`queueWorkerActiveItemIds`) — повертає його назад у ZSET (score = min(nextAttemptAt, now)). Викликається на початку кожного циклу `processQueuedTaskSubmissions`. Це рятує задачі, що "загубилися" між `set item` і `zadd`, або після рестарту/деплою Railway під час обробки.
- **Retry backoff**: `getTaskCreationRetryDelayMs` — якщо Notion повернув заголовок `Retry-After`, delay = `min(retryAfterSeconds*1000 + 30000, QUEUE_MAX_RETRY_DELAY_MS)`; інакше експоненційний backoff `QUEUE_BASE_RETRY_DELAY_MS * 2^min(attempts,4)` (капується `QUEUE_MAX_RETRY_DELAY_MS`).
- `isRetriableTaskCreationError` — `error.code === 'rate_limited' || status === 429 || status >= 500`.
- Користувачу надсилається "⏳ ще в черзі" повідомлення лише на 1-й спробі та кожній 5-й (`shouldNotifyQueueDelay`).
- Після `QUEUE_MAX_ATTEMPTS` (default 20) невдалих спроб — `failQueuedSubmission()`: `saveFailedSubmission()` (чернетка) + повідомлення користувачу з `draftId`.
- **Singleton worker guard**: `startTaskSubmissionQueueWorker(client)` використовує модульний прапорець `queueWorkerStarted` (boolean, module-scope) — викликається один раз всередині `registerSubmissionHandlers(app)`, яка сама викликається один раз у `src/index.js`. **Важливо для перенесення** — див. розділ 17.

### 2.3 Notion-поллер — коротко (детально в розділі 10)

Один незалежний `setInterval` **на кожен активний департамент** (`startPolling` у `src/notion/pollStatus.js`), з staggered first-run delay (`POLLING_STARTUP_STAGGER_MS`, default 10с × індекс департаменту), щоб цикли департаментів не стартували одночасно. Усередині — черга (`pollingQueue`) і прапорці `pollingInProgressByDepartment` / `queuedPollingDepartmentKeys`, які гарантують що для одного департаменту одночасно виконується не більше одного циклу (новий цикл, якщо попередній ще не завершився, — пропускається з попередженням у лог, а не накопичується).

### 2.4 Синк Slack-тред → Notion-коментар (детально в розділі 12)

Двонапрямковий: Notion-коментарі → Slack (через поллер, з фільтром "не дублювати власні mirror-коментарі"), і Slack DM-тред-відповіді → Notion-коментарі (через `message.im` event). Захист від петлі: коментар, створений ботом з тексту Slack-треду, має префікс `Slack thread · {ім'я}` — поллер розпізнає такий коментар (`isMirroredSlackThreadComment`) і **не** надсилає його назад у Slack, лише зсуває checkpoint.

### 2.5 Feedback / revision round flow (тільки Design, `supportsFeedbackRounds: true`)

Деталі в розділі 11. Короткий сценарій: коли задача в статусі `Comments`, під кореневим повідомленням Slack з'являються кнопки "✏️ Дати правки" і "✅ Приймаю, правок немає" (або "✅ Приймаю, більше правок немає", якщо вже були раунди). Кнопка правки відкриває модалку `feedback_submission` → створює Notion sub-item (`createFeedbackSubitem`) з relation `Parent item`, `Sub-type=правка`, копіює частину властивостей батьківської задачі, зберігає окремий Redis task-record з `taskKind: 'feedback'` і власним циклом поллінгу/прийняття.

### 2.6 Quality survey (обидва: Design на `Ready`, SMM на `Published`, для Event — залежить від `NOTION_EVENT_QUALITY_SURVEY_STATUSES`, за замовчуванням порожньо → не надсилається)

Надсилається один раз (ідемпотентність через `markFeedbackSurveySent`/`getQualityFeedback` у Redis) при переході задачі (не sub-item feedback) у `qualitySurveyStatuses` департаменту, або одразу при `handleTaskAcceptance` (кнопка "✅ Приймаю..."). 5 кнопок ⭐1–⭐5; оцінка 5 зберігається одразу без коментаря; оцінка <5 відкриває модалку `quality_feedback_submission` (опційні категорії покращення + коментар). Результат зберігається в Redis і намагається синкнутись у окрему Notion feedback-базу (`syncQualityFeedbackToNotion`).

### 2.7 Відновлення "чернеток" невдалих сабмітів

Якщо Notion остаточно відхилив створення задачі (після всіх retry в черзі) **або** сам `enqueueTaskSubmission` впав (Redis недоступний) — повний payload брифу зберігається в Redis під ключем `failed-submission:<draftId>` (TTL за замовчуванням 30 днів, `FAILED_SUBMISSION_TTL_SECONDS`). Користувач отримує `draftId` у Slack; адмін вручну дістає JSON із Redis і відновлює задачу без повторного заповнення форми (немає автоматичного UI для цього — суто ручний процес через Redis CLI/консоль).

---

## 3. Усі Slack routes / entry points

### 3.1 Slash-команди (`app.command`)

| Команда | Файл | Поведінка |
|---|---|---|
| `/new-task` | `src/handlers/newTask.js` | `views.open()` з `buildInitialTaskEntryView()` — якщо активних департаментів >1, показує `buildDepartmentPickerView()` (callback_id `select_department`); інакше одразу `buildDesignDomainPickerView()` (якщо default department === `design`) або `buildTaskTypePickerView(default)`. |
| `/event-request` | `src/handlers/newTask.js` | `views.open()` одразу з `buildTaskTypePickerView('event')` — минаючи вибір департаменту і домейн-крок. |

### 3.2 `app.action(...)` — точні action_id / regex

| action_id / regex | Файл-реєстратор | Обробник | Призначення |
|---|---|---|---|
| `open_new_task_from_home` | `src/slack/home.js` | inline | Кнопка в App Home → відкриває `buildInitialTaskEntryView()` |
| `open_feedback_modal` | `src/index.js` | inline (парсить `body.actions[0].value` як JSON `{pageId, taskName, roundNumber}`) | Кнопка "✏️ Дати правки" → `openFeedbackModal()` |
| `accept_task_result` | `src/index.js` | `handleTaskAcceptance` (`src/handlers/resultAcceptance.js`) | Кнопка "✅ Приймаю..." / "✅ Прийняти правку" |
| `/^quality_rating(?:_\d+)?$/` (regex; фактичні id — `quality_rating_1`…`quality_rating_5`) | `src/index.js` | `handleQualityRating` | Кнопки ⭐1–⭐5 quality survey |
| `platform` | `src/handlers/submission.js` | inline | Design-модалка: `static_select` вибору платформи — тригерить `views.update` для показу поля "Platform (other)" при значенні `Other` |
| `/^(structure_choice|ready_texts|visual_source|link_needed|title_description|thumbnail|ad_goal|fixed_budget|source_materials)$/` | `src/handlers/submission.js` | inline | SMM dynamic-модалка: перерендер форми при виборі опції, що відкриває/ховає залежне поле (`showWhen`) — тільки для не-Design департаментів (`callback_id === 'submit_task'`) |

Примітка: усі кнопки в Slack-повідомленнях (не модалках) типу "📋 Відкрити в Notion", "🔗 Відкрити результат" — це `type: button` з `url`, тобто **не мають** `action_id`/handler, Slack сам відкриває лінк.

### 3.3 `app.view(...)` — точні callback_id

| callback_id | Файл | Призначення | ack-поведінка |
|---|---|---|---|
| `select_department` | `src/handlers/submission.js` | Крок 0: вибір Design/SMM/Event | `response_action: update` → наступний view (`select_design_domain` для design, інакше `select_task_type`) |
| `select_design_domain` | `src/handlers/submission.js` | Крок 1 (лише Design): "З якого ти напрямку?" | `response_action: update` → `select_task_type` з `{domain}` у private_metadata |
| `select_task_type` | `src/handlers/submission.js` | Крок 2: вибір типу задачі зі згрупованого списку | якщо у типу є `complexityOptions` → `select_task_complexity`; інакше → `submit_task` |
| `select_task_complexity` | `src/handlers/submission.js` | Крок 2.5 (лише для типів з `complexityOptions`, зараз тільки Event) | `response_action: update` → `submit_task` з реальним (розгорнутим по складності) `taskType` |
| `submit_task` | `src/handlers/submission.js` | Фінальна форма брифу | Валідація lead-time → або `errors`, або `update` (показ lead-time warning блоку), або `ack()` + постановка в чергу |
| `feedback_submission` | `src/index.js` → `src/handlers/feedbackSubmission.js` | Модалка правки | `ack()` одразу, потім side-effects |
| `quality_feedback_submission` | `src/index.js` → `src/handlers/resultAcceptance.js` | Модалка деталей quality-фідбеку (rating < 5) | `ack()` одразу |

`app.view` для `feedback_submission` і `quality_feedback_submission` реєструються прямо в `src/index.js`, решта — у `registerSubmissionHandlers(app)` (`src/handlers/submission.js`).

### 3.4 `app.event(...)`

| Подія | Файл | Обробник |
|---|---|---|
| `app_home_opened` | `src/slack/home.js` (`registerHomeTab`) | `views.publish()` статичного App Home tab (текст "👋 Привіт! Це PR & Comms Bot" — ⚠️ бренд/копірайт App Home НЕ синхронізований з фактичним "Tasks Bot" неймінгом і брендом Design/SMM/Event — див. розділ 17) |
| `message` | `src/slack/threadComments.js` (`registerThreadCommentSync`) | `handleSlackThreadCommentEvent` — фільтрує тільки людські відповіді в DM-треді (`channel_type === 'im'`, немає `bot_id`/`subtype`, є `thread_ts !== ts`) |

App Home tab реєструється лише всередині гілки "токен задано" — у stub-режимі App Home не працює взагалі.

### 3.5 HTTP endpoints на Express receiver (`src/index.js`)

| Метод + шлях | Реалізація | Призначення |
|---|---|---|
| `GET /` | `receiver.router.get('/', ...)` | Health-check, повертає `"OK"` (200) |
| `POST /` | `receiver.router.post('/', ...)` | Якщо `req.body?.type === 'url_verification'` → `res.json({challenge: req.body.challenge})` (для Slack Event Subscriptions verify, якщо Slack колись стукає у `/` замість `/slack/events`); інакше `next()` (передає далі — але на `/` більше нема реєстрованих обробників, тож впаде в 404 через `unhandledRequestHandler`, якщо не Slack request) |
| `POST /notion/design-task-launch` | `registerNotionLaunchWebhook(receiver.router)` (`src/notion/launchWebhook.js`) | Приймає довільний JSON payload з Notion automation, шукає `parentTaskId` (ключі `№ ID`, `No ID`, `ID`, `parentTaskId`, `parent_task_id`, `Variable 1`, або fuzzy-пошук по всіх сплющених ключах, що містять `№ id`/`no id`/закінчуються на `.id`) і `parentPageName` (`Name`, `parentPageName`, `parent_page_name`, `Variable 2`, або fuzzy `name`/`*.name`). Зберігає весь необроблений payload у Redis (`saveLaunchContext`). Повертає 400 якщо не знайдено `parentTaskId`, 200 з `{ok:true, parentTaskId, parentPageName}` при успіху, 500 при винятку. |
| Усе інше (`/slack/events` тощо) | Bolt `ExpressReceiver` default | Стандартна обробка Slack events/interactivity/commands Bolt-ом |

`ExpressReceiver` конфігурується з двома кастомними хендлерами:
- `processEventErrorHandler` — логує через `logSlackReceiverIssue` (парсить payload/body щоб дістати `url`, `retryNum`, `retryReason`, `bodyType`, `callbackId`, `actionId`, `command`, `userId` для діагностики) і повертає 500, якщо відповідь ще не відправлена.
- `unhandledRequestHandler` — та ж діагностика, повертає 404.

### 3.6 Stub-режим (без `SLACK_BOT_TOKEN`)

Якщо `SLACK_BOT_TOKEN` не задано, порожній рядок, або дорівнює `"placeholder"` — Bolt взагалі не інстанціюється. Замість нього піднімається **сирий Node `http.createServer`**, що:
- на будь-який `POST` парсить JSON body; якщо `type === 'url_verification'` — відповідає `{challenge}` (200); інакше 200 з текстом `"Bot is waiting for Slack token approval."`.
- на будь-який інший метод — 200 з тим самим текстом.
- слухає той самий `PORT` (default 3000).

Це дозволяє задеплоїти сервіс на Railway (і пройти healthcheck) до того, як Slack App погоджено/токен видано, без падіння процесу.

---

## 4. Повний покроковий флоу створення задачі (Slack modal wizard)

Нумерація кроків — логічна, не завжди 1:1 з callback_id (деякі кроки пропускаються залежно від департаменту/типу).

**Крок 0 — Вхідна точка.**
`buildInitialTaskEntryView()` (`src/slack/taskEntry.js`):
- Якщо `getAllDepartments().length > 1` (тобто активних департаментів декілька — на практиці завжди true, бо design+smm завжди активні) → `buildDepartmentPickerView()`, callback_id `select_department`, title `"Новий запит"`, submit-текст `"Далі"`, close `"Скасувати"`. Один `input`-блок `department_block` з `static_select` `department` (опції = `${emoji} ${label}` для кожного активного департаменту, значення = department.key).
- Інакше (лише якщо колись department picker вимкнено вручну) → якщо `DEFAULT_DEPARTMENT_KEY === 'design'` → `buildDesignDomainPickerView()`, інакше `buildTaskTypePickerView(default)`.

`/event-request` **обходить** Крок 0 і Крок 1 напряму, відкриваючи `buildTaskTypePickerView('event')`.

**Крок 1 — `select_department` (view submit).**
Валідація: якщо `department_block.department.selected_option` відсутнє → `response_action: errors` з текстом `"Обери команду."` на `department_block`.
Інакше `departmentKey = resolveDepartmentKey(selected.value)` (fallback на `design`, якщо ключ невідомий/неактивний).
- Якщо `departmentKey === 'design'` → `response_action: update` → `buildDesignDomainPickerView({departmentKey})`.
- Інакше → `update` → `buildTaskTypePickerView(departmentKey)`.

**Крок 1.5 — `select_design_domain` (лише Design).**
`buildDesignDomainPickerView()`: callback_id `select_design_domain`, `private_metadata = {departmentKey}`, title `"${emoji} Новий запит"`, текст секції `"З якого ти напрямку?"`, `input`-блок `domain_block` → `static_select` `domain` з опціями (у точному порядку, значення=текст):

```
PR
SMM
Employer Brand
Команда Офісу
Рекрутинг/HR
Внутрішні комунікації
```

(константа `DESIGN_DOMAIN_OPTIONS` у `src/slack/taskEntry.js`.)

Submit-handler (`select_design_domain` view): якщо `domain_block.domain.selected_option` відсутнє → error `"Обери напрямок."`. Інакше `update` → `buildTaskTypePickerView(departmentKey, {domain: selectedDomain.value})`.

Це домен пишеться в Notion як multi-select властивість `domain` (нижній регістр — реальна назва властивості в Activities database), додається автоматично до схеми, якщо значення нове (`ensureSelectOptionsExist`).

**Крок 2 — `select_task_type`.**
`buildTaskTypePickerView(departmentKey, {domain})`: callback_id `select_task_type`, `private_metadata = {departmentKey, domain}`, текст секції:
- Design: `"Обери тип запиту — далі побачиш потрібні поля для брифу."`
- Інші: `` `Обери тип запиту для ${department.label} — далі побачиш потрібні поля для брифу.` ``

Один `input`-блок `task_type_block` → `static_select` `task_type` з `option_groups` = `getTaskTypeGroups(departmentKey)` (групи з `taskTypeGroups` конфігу департаменту — точні тексти груп і опцій у розділі 6).

Submit-handler: якщо не вибрано → error `"Обери тип запиту."` на `task_type_block`.
Інакше `taskType = selected.value`, `taskTypeLabel = selected.text.text`.
- Якщо `getTaskTypeComplexityOptions(departmentKey, taskType).length > 0` → `update` → `buildTaskComplexityPickerView({departmentKey, taskType, taskTypeLabel, domain})`.
- Інакше → `update` → фінальна модалка брифу (`buildTaskModalView`, callback_id `submit_task`).

**Крок 2.5 — `select_task_complexity`** (лише для типів задач із `complexityOptions` — на сьогодні це виключно частина Event-типів: `event_internal`, `event_external`, `conference`, `gifts_custom`, `stand_concept`).
`buildTaskComplexityPickerView()`: callback_id `select_task_complexity`, title `"🎪 Складність"`, текст: `` `Обери рівень складності для *${taskTypeLabel}*.` `` + список `*{label}* — {description}` для кожної опції складності. `input`-блок `complexity_block` → `static_select` `complexity`.

Submit-handler: якщо не вибрано → error `"Обери рівень складності."`. Інакше `taskType = resolveTaskTypeComplexity(departmentKey, categoryTaskType, selectedComplexity.value)` (мапить, наприклад, `event_internal` + `medium` → `event_internal_medium`), `taskTypeLabel = taskConfig.label` (напр. `"Організація події (внутрішня локація) — Medium"`) або fallback `` `${categoryTaskTypeLabel} — ${selectedComplexity.text.text}` ``. → `update` → `buildTaskModalView(...)`.

**Крок 3 — `submit_task`.**
`buildTaskModalView({departmentKey, taskType, taskTypeLabel, domain, values, leadTimeWarning})`:
- callback_id `submit_task`
- `private_metadata = {departmentKey, taskType, taskTypeLabel, domain}`
- title `"📋 Бриф задачі"`, submit `"Створити задачу"`, close `"Скасувати"`
- `blocks = getModalBlocks(taskType, values, {departmentKey, leadTimeWarning})` (`src/handlers/modalBlocks.js`):
  - Якщо `departmentKey !== 'design'` → **динамічна** генерація блоків з `getDepartmentTaskFields(departmentKey, taskType)` (описано в розділі 7 — SMM/Event field system).
  - Якщо `departmentKey === 'design'` → **статичні** блоки: `baseBlocks()` (спільні поля) + `divider()` + `specificBlocks[taskType]` (специфічні поля для конкретного типу задачі, hydratовані `enhanceSpecificBlocks` — додає hint для матеріальних полів і "Platform (other)" при потребі).
  - Якщо переданий `leadTimeWarning` — на початку блоків вставляється попереджувальний блок (`buildLeadTimeWarningBlocks`) з `header` + `section` текстом і `input` `lead_time_override_block` (`static_select` `lead_time_override` з опціями `"Відправити як late"` (value `late`) / `"Змінити дату"` (value `change_date`)).

**Динамічна перерендерка форми (без сабміту).** Дві категорії `app.action`:
- `platform` (тільки Design static_select "Платформа") — при значенні `Other` показує додаткове обов'язкове поле `platform_other_block` ("📱 Platform (other) *").
- Regex `/^(structure_choice|ready_texts|visual_source|link_needed|title_description|thumbnail|ad_goal|fixed_budget|source_materials)$/` — тільки для SMM (не-Design) `submit_task` view: перерендерює модалку зі станом `body.view.state.values` + оновленим полем, щоб показати/сховати залежні поля `showWhen` (наприклад, `structure_choice = "Є структура — опишу"` показує поле опису структури).

**Валідація lead-time (SLA дедлайну) при сабміті `submit_task`:**
`getLeadTimeViolation({departmentKey, taskType, deadline, values})`:
- бере `taskConfig = getDepartmentTaskType(...)`, обчислює `minLeadDays`/`minLeadLabel`/`recommendedLeadLabel` (з урахуванням можливого `leadTimeFieldKey`/`minLeadDaysByValue` — механізм у коді присутній, але **жоден активний тип задачі його не використовує** — завжди фіксований `minLeadDays` на рівні типу).
- якщо `minLeadDays` не заданий або дедлайн не вказано — `null` (без порушення).
- `providedLeadDays = getDaysUntil(deadline)` (`Math.ceil((deadline - today)/86400000)`, обидві дати нормалізуються до 00:00).
- порушення, якщо `providedLeadDays < minLeadDays`.
- `override = getLeadTimeOverride(values)` — значення поля `lead_time_override_block` (якщо форма вже показувала попередження і користувач щось вибрав).

Логіка обробки при сабміті:
1. Якщо є порушення і `override !== 'late'`:
   - якщо `override === 'change_date'` → `ack({response_action: 'errors', errors: {<deadline_block_key>: "Зміни дату: для цього типу мінімальний термін — {label}."}})` (модалка залишається відкритою з помилкою на полі дедлайну).
   - інакше (`override` не задано взагалі, тобто перший сабміт) → `ack({response_action: 'update', view: buildTaskModalView({..., leadTimeWarning: violation})})` — форма перерендерюється з попередженням+вибором зверху, **всі введені значення зберігаються** (`values` передаються назад).
2. Якщо порушення є і `override === 'late'` → `isLate = true`, сабміт продовжується (задача створюється, у Notion ставиться `Late = true` checkbox, у Slack-повідомленні користувачу з'являється попередження про запізнення).
3. Якщо порушення немає — сабміт продовжується нормально.

**Побудова payload сабміту (`submissionPayload`)** — залежить від департаменту:
- **Design** (`departmentKey === 'design'`): `priority`, `deadline`, `context`, `style`, `antiref`, `canEditText`, `videoFormat`, `platform`/`platformOther`, потім `specificFields` збирається зі статичного `fieldMapping` (мапа `block_id → людський лейбл`, повний список у розділі 7.4) і `artifacts` зі статичного `artifactMapping`.
- **SMM/Event** (динамічні): `extractDynamicSubmissionFields()` проходить по `getDepartmentTaskFields(departmentKey, taskType)`, для кожного поля читає значення з `values[<key>_block][<key>]` (крім `time_range`, що читає `_from`/`_to`), формує `fieldAnswers` (масив `{key, label, type, value, formattedValue, notionProperties, role, section}`), `specificFields` (мапа лейбл→formattedValue), і окремо витягує `deadline`/`context`/`platforms` за `role`.

Після постановки в чергу — `ack()` без view (закриває модалку), і одразу окреме `chat.postMessage` користувачу: `` `🕐 Задачу прийнято в чергу.\n${name || taskTypeLabel}\nЗараз у боті багато запитів, тому створення задачі може зайняти трохи більше часу. Напишу тут, щойно задача буде готова.` ``.

---

## 5. Департаменти — повна конфігурація

Джерело: `src/config/departments.js`, об'єкт `departments`. Функція `env(name, fallback)` читає `process.env[name]`, тримує тільки non-empty trimmed значення, інакше `fallback`. `csvEnv` розбиває по комі й трімить. `intEnv` парсить `parseInt`. `boolEnv` — `['1','true','yes','on']` (lowercase) → true.

### 5.1 `design`

| Поле | Значення / env |
|---|---|
| `key` | `'design'` |
| `label` | `'Design'` |
| `emoji` | `'🎨'` |
| `notionDataSourceId` | `NOTION_DESIGN_DATABASE_ID` → fallback `NOTION_DATABASE_ID` |
| `notionTemplateId` | `NOTION_DESIGN_TEMPLATE_ID` → fallback `NOTION_TEMPLATE_ID` |
| `hubUrl` | `NOTION_DESIGN_HUB_URL` → `NOTION_BRAND_DESIGN_HUB_URL` → default `https://www.notion.so/Brand-Design-Hub-33cce9899cb7814488c0f439326aaf2a?source=copy_link` |
| `feedbackDatabaseId` | `NOTION_DESIGN_FEEDBACK_DATABASE_ID` → `NOTION_FEEDBACK_DATABASE_ID` → `null` |
| `statusProperty` | `NOTION_DESIGN_STATUS_PROPERTY` → `NOTION_STATUS_PROPERTY` → default `'Design Status'` |
| `initialStatus` | `NOTION_DESIGN_INITIAL_STATUS` → default `'To do'` |
| `completedStatuses` | `NOTION_DESIGN_COMPLETED_STATUSES` → `NOTION_POLL_COMPLETED_STATUSES` → default `'Ready,Cancelled,Canceled'` (csv) |
| `qualitySurveyStatuses` | `NOTION_DESIGN_QUALITY_SURVEY_STATUSES` → default `'Ready'` (csv) |
| `supportsFeedbackRounds` | `true` |
| `useBodyBrief` | не задано (falsy) |
| `pollIntervalSec` | `NOTION_DESIGN_POLL_INTERVAL_SEC` → default `180` |
| `notifyChannel` | `DESIGN_CHANNEL_ID` (може бути не задано) |
| `ownerId` | `NOTION_DESIGN_OWNER_ID` → default `'f342c30b-c5c1-4a52-8cdf-c8b636928364'` |
| `ownerLabel` | `NOTION_DESIGN_OWNER_LABEL` → `null` |
| `team` | `NOTION_DESIGN_TEAM` → default `'Brand Design'` |
| `defaultProperties` | не задано на рівні департаменту (окремо в `createPage.js` для design ставиться `'Design needed': true` checkbox, якщо є таке property) |
| `taskTypeGroups` / `taskTypes` | `designTaskTypeGroups` / побудовано з груп + `designTaskTypeConfig` (розділ 6.1) |

### 5.2 `smm`

| Поле | Значення / env |
|---|---|
| `key` | `'smm'` |
| `label` | `'SMM'` |
| `emoji` | `'📱'` |
| `notionDataSourceId` | `NOTION_SMM_DATABASE_ID` → `NOTION_ACTIVITIES_DATABASE_ID` → `NOTION_DATABASE_ID` → default `'b1ff9daa012c41c597e1d5ad5dd91917'` |
| `notionTemplateId` | `NOTION_SMM_TEMPLATE_ID` → `NOTION_SMM_TASK_TEMPLATE_ID` → `null` |
| `hubUrl` | `NOTION_SMM_HUB_URL` → default `https://www.notion.so/SMM-Hub-375ce9899cb781aaab1ddb4c30833e23?source=copy_link` |
| `feedbackDatabaseId` | `NOTION_SMM_FEEDBACK_DATABASE_ID` → default `'025dce2c634e4a079ee7600ea8c63253'` |
| `statusProperty` | `NOTION_SMM_STATUS_PROPERTY` → default `'SMM статус'` |
| `initialStatus` | `NOTION_SMM_INITIAL_STATUS` → default `'To do'` |
| `completedStatuses` | `NOTION_SMM_COMPLETED_STATUSES` → default `'Published,Canceled,Cancelled'` |
| `qualitySurveyStatuses` | `NOTION_SMM_QUALITY_SURVEY_STATUSES` → default `'Published'` |
| `supportsFeedbackRounds` | `false` |
| `useBodyBrief` | `true` (бриф пишеться у body сторінки, `Description` = `"Опис нижче в тілі задачі."`) |
| `pollIntervalSec` | `NOTION_SMM_POLL_INTERVAL_SEC` → default `180` |
| `notifyChannel` | `SMM_CHANNEL_ID` → `SLACK_SMM_NOTIFY_CHANNEL` → `null` |
| `ownerId` | `NOTION_SMM_OWNER_ID` → default `'77a3e7fe-a555-4c14-b794-d63a6e42a324'` |
| `ownerLabel` | `NOTION_SMM_OWNER_LABEL` → default `'Anna Gayuk'` |
| `team` | `NOTION_SMM_TEAM` → default `'SMM'` |
| `defaultProperties` | `{'SMM needed': true, 'SMM briefed': true}` (checkbox-и, пишуться тільки якщо існують у схемі) |
| `taskTypeGroups` / `taskTypes` | `smmTaskTypeGroups` / `smmTaskTypeConfig` (розділ 6.2) |

### 5.3 `event`

| Поле | Значення / env |
|---|---|
| `key` | `'event'` |
| `label` | `'Event'` |
| `emoji` | `'🎪'` |
| `active` | `isEventDepartmentEnabled()` = `boolEnv('EVENT_DEPARTMENT_ENABLED')` **OR** `Boolean(env('NOTION_EVENT_DATABASE_ID'))` |
| `notionDataSourceId` | `NOTION_EVENT_DATABASE_ID` → `NOTION_ACTIVITIES_DATABASE_ID` → `NOTION_DATABASE_ID` → default `'b1ff9daa012c41c597e1d5ad5dd91917'` |
| `notionTemplateId` | `NOTION_EVENT_TEMPLATE_ID` → `NOTION_EVENT_TASK_TEMPLATE_ID` → default `'34ace9899cb780afb5b5e4ba36e1c2e2'` |
| `hubUrl` | `NOTION_EVENT_HUB_URL` → default `https://www.notion.so/Event-Manager-Hub-366ce9899cb7817580bccd4a2651f925?source=copy_link` |
| `feedbackDatabaseId` | `NOTION_EVENT_FEEDBACK_DATABASE_ID` → `null` |
| `statusProperty` | `NOTION_EVENT_STATUS_PROPERTY` → default `'Status'` (⚠️ у `.env.example` default фактично `'SMM статус'`, у коді fallback-default — `'Status'`; README каже "default `SMM статус` для тестів у shared Activities" — тобто production-конфіг для sandbox-тестів явно задає `NOTION_EVENT_STATUS_PROPERTY=SMM статус` у `.env.example`, а `Status` — лише code-level default, якщо env взагалі не заданий) |
| `initialStatus` | `NOTION_EVENT_INITIAL_STATUS` → default `'Backlog'` (у `.env.example` явно `To do`) |
| `completedStatuses` | `NOTION_EVENT_COMPLETED_STATUSES` → default `'Done,Completed,Canceled,Cancelled'` |
| `qualitySurveyStatuses` | `NOTION_EVENT_QUALITY_SURVEY_STATUSES` → default `''` (порожньо → **survey не надсилається для Event**, поки не задати env) |
| `supportsFeedbackRounds` | `false` |
| `useBodyBrief` | `true` |
| `pollIntervalSec` | `NOTION_EVENT_POLL_INTERVAL_SEC` → default `180` |
| `notifyChannel` | `EVENT_CHANNEL_ID` → `SLACK_EVENT_NOTIFY_CHANNEL` → `null` |
| `ownerId` | `NOTION_EVENT_OWNER_ID` → default `'2cdd872b-594c-815b-acd7-000259d98a51'` |
| `ownerLabel` | `NOTION_EVENT_OWNER_LABEL` → default `'Mariia Tarasiuk'` |
| `ownerSlackId` | `SLACK_EVENT_OWNER_ID` → `SLACK_MARIA_USER_ID` → `null` (у `.env.example`: `U0A2SF2NG8K`) |
| `team` | `NOTION_EVENT_TEAM` → default `'Event'` |
| `defaultProperties` | `{'Event needed': true, 'Event briefed': true, 'Brief received': false}` |
| `taskTypeGroups` / `taskTypes` | `eventTaskTypeGroups` / `eventTaskTypeConfig` (розділ 6.3) |

**Департамент-специфічні поведінкові особливості (з коду і README):**
- **Design**: єдиний з `supportsFeedbackRounds=true` → тільки тут з'являються кнопки правок/прийняття, лише тут будується "Дизайнер" (people/relation), тільки тут статус `Ready` = quality survey + зупинка поллінгу.
- **SMM**: `useBodyBrief=true` — короткий `Description`, повний бриф у блоках сторінки (`Базові поля` / `Специфічні поля`). Статус `Ready` **не** зупиняє поллінг і не показує кнопок правок/прийняття для SMM (перевірка `departmentKey !== 'design'` у `getStatusActionElements`). Поллінг зупиняється тільки на `Published`/`Canceled`/`Cancelled` (`completedStatuses`).
- **Event**: також `useBodyBrief=true`. У Slack-повідомленнях для Event використовується інший текстовий шаблон (`buildEventTaskThreadText` / гілка `isEventDepartment` в `buildRootTaskText`) — з емодзі 🎪, окремим полем "📋 Тип:", "📅 Дедлайн:", "👤 Відповідальна:" (лейбл "Відповідальна", не "Відповідальний"/"Дизайнер"), і дефолтним відповідальним = `{name: ownerLabel, userId: ownerSlackId}`, якщо `designer`/`responsible` не задано.

---

## 6. Повний реєстр типів задач (task types) для кожного департаменту

### 6.1 Design — `DESIGN_TASK_TYPE_RELATION_IDS` + `designTaskLeadTimes` + `designTaskTypeGroups`

Кожен design task type у Notion пишеться як **relation** у властивість `Task Type` (`notionTaskTypeRelationId`) — це посилання на сторінку-довідник у окремій Notion-базі "типів задач" (сторінки-довідники **не** описані в цьому коді, лише їхні page-ID; при переносі потрібно або відтворити ці ж relation-сторінки в новій Notion структурі, або замінити на select/text). Якщо relation ID відсутній — пишеться текстове значення в `Task Type`/`Request type`/`Type` (перше property, що існує і підходить типом).

| Категорія (group label) | key | Label (Slack) | Notion relation ID (Task Type) | minLeadDays (default) | env var | minLeadLabel (якщо задано) | recommendedLeadLabel |
|---|---|---|---|---|---|---|---|
| 🖼 SMM / Банери | `static_simple` | Статична картинка проста | `752ce989-9cb7-82c6-97ad-81b4b8e8003c` | 2 | `DESIGN_STATIC_SIMPLE_MIN_LEAD_DAYS` | — | — |
| 🖼 SMM / Банери | `static_complex` | Статична картинка складна | `f5cce989-9cb7-838d-8f7c-0144b56d4a48` | 4 | `DESIGN_STATIC_COMPLEX_MIN_LEAD_DAYS` | — | — |
| 🖼 SMM / Банери | `carousel` | SMM карусель | `c82ce989-9cb7-820d-ba26-814f5aad916f` | 4 | `DESIGN_CAROUSEL_MIN_LEAD_DAYS` | — | — |
| 🖼 SMM / Банери | `resize` | SMM ресайзи | `296ce989-9cb7-837b-a4db-0198dca40fc7` | 2 | `DESIGN_RESIZE_MIN_LEAD_DAYS` | — | — |
| 📣 Promo Creatives | `promo_creo_static_template` | Promo Creo Static (по шаблону) | `349ce989-9cb7-8021-b677-c57985031659` | 2 | `DESIGN_PROMO_CREO_STATIC_TEMPLATE_MIN_LEAD_DAYS` | — | — |
| 📣 Promo Creatives | `promo_creo_static_ideas` | Promo Creo Static (нові ідеї) | `349ce989-9cb7-8021-b677-c57985031659` | 4 | `DESIGN_PROMO_CREO_STATIC_IDEAS_MIN_LEAD_DAYS` | — | — |
| 📣 Promo Creatives | `promo_creo_mix_template` | Promo Creo Mix (по шаблону) | `349ce989-9cb7-802c-a7b7-d0a5d88bb981` | 3 | `DESIGN_PROMO_CREO_MIX_TEMPLATE_MIN_LEAD_DAYS` | — | — |
| 📣 Promo Creatives | `promo_creo_mix_ideas` | Promo Creo Mix (нові ідеї) | `349ce989-9cb7-802c-a7b7-d0a5d88bb981` | 11 | `DESIGN_PROMO_CREO_MIX_IDEAS_MIN_LEAD_DAYS` | 1.5 тижні | — |
| 📣 Promo Creatives | `promo_creo_video_template` | Promo Creo Video (по шаблону) | `349ce989-9cb7-8099-b98a-da5724416b6a` | 3 | `DESIGN_PROMO_CREO_VIDEO_TEMPLATE_MIN_LEAD_DAYS` | — | — |
| 📣 Promo Creatives | `promo_creo_video_ideas` | Promo Creo Video (нові ідеї) | `349ce989-9cb7-8099-b98a-da5724416b6a` | 11 | `DESIGN_PROMO_CREO_VIDEO_IDEAS_MIN_LEAD_DAYS` | 1.5 тижні | — |
| 🎬 Монтаж / Анімація | `video_simple` | Монтаж / Анімація простий | `a03ce989-9cb7-8244-915d-816db55e2120` | 3 | `DESIGN_VIDEO_SIMPLE_MIN_LEAD_DAYS` | — | — |
| 🎬 Монтаж / Анімація | `video_complex` | Монтаж / Анімація складний | `aaece989-9cb7-83e8-8da6-811e658d9abc` | 11 | `DESIGN_VIDEO_COMPLEX_MIN_LEAD_DAYS` | 1.5 тижні | — |
| 📊 Презентації | `pres_edit` | Презентація (коригування існуючого) | `c6bce989-9cb7-8334-b0b6-810890bbc828` | 3 | `DESIGN_PRES_EDIT_MIN_LEAD_DAYS` | — | — |
| 📊 Презентації | `pres_template` | Презентація по шаблону | `29dce989-9cb7-837f-a3f5-812baee600fe` | 7 | `DESIGN_PRES_TEMPLATE_MIN_LEAD_DAYS` | 1 тиждень | — |
| 📊 Презентації | `pres_wow` | Wow презентація | `ed0ce989-9cb7-8295-9249-819159d83211` | 14 | `DESIGN_PRES_WOW_MIN_LEAD_DAYS` | 2 тижні | — |
| 🤖 ШІ-контент | `ai_static_simple` | ШІ статика проста | `a33ce989-9cb7-83f3-8952-814aaab2dcc1` | 2 | `DESIGN_AI_STATIC_SIMPLE_MIN_LEAD_DAYS` | — | — |
| 🤖 ШІ-контент | `ai_static_complex` | ШІ статика складна | `375ce989-9cb7-8351-b0df-018fd1e42f11` | 14 | `DESIGN_AI_STATIC_COMPLEX_MIN_LEAD_DAYS` | 2 тижні | — |
| 🤖 ШІ-контент | `ai_dynamic_simple` | ШІ динаміка проста | `343ce989-9cb7-81a4-bba2-d1009fd95515` | 2 | `DESIGN_AI_DYNAMIC_SIMPLE_MIN_LEAD_DAYS` | — | — |
| 🤖 ШІ-контент | `ai_dynamic_complex` | ШІ динаміка складна | `343ce989-9cb7-813f-9728-e155c08a8f53` | 14 | `DESIGN_AI_DYNAMIC_COMPLEX_MIN_LEAD_DAYS` | 2 тижні | — |
| 🌐 Веб | `landing_template` | Лендинг по шаблону | `366ce989-9cb7-8386-8625-8190d6befc23` | 14 | `DESIGN_LANDING_TEMPLATE_MIN_LEAD_DAYS` | 2 тижні | — |
| 🌐 Веб | `landing_wow` | Wow лендинг з нуля | `8b4ce989-9cb7-8232-bcb6-015790e03b20` | 42 | `DESIGN_LANDING_WOW_MIN_LEAD_DAYS` | 6 тижнів | — |
| 🌐 Веб | `blog` | Верстка блогу | `b5fce989-9cb7-8225-81d9-816f4d760cc9` | 1 | `DESIGN_BLOG_MIN_LEAD_DAYS` | — | — |
| 📰 Email / Дайджест | `digest_simple` | Дайджест базовий по шаблону | `e5bce989-9cb7-8235-a612-81d4b445a8a1` | 7 | `DESIGN_DIGEST_SIMPLE_MIN_LEAD_DAYS` | 1 тиждень | — |
| 📰 Email / Дайджест | `digest_wow` | Wow дайджест | `dcace989-9cb7-83a9-ad38-816e3060a9c6` | 21 | `DESIGN_DIGEST_WOW_MIN_LEAD_DAYS` | 3 тижні | — |
| 📰 Email / Дайджест | `email_digest` | Email дайджест | `343ce989-9cb7-814b-81d5-ff0505cbe181` | 7 | `DESIGN_EMAIL_DIGEST_MIN_LEAD_DAYS` | 1 тиждень | — |
| 👕 Мерч / Поліграфія | `merch_simple` | Мерч простий | `4bbce989-9cb7-83a8-8516-8161b982a0a2` | 3 | `DESIGN_MERCH_SIMPLE_MIN_LEAD_DAYS` | — | — |
| 👕 Мерч / Поліграфія | `merch_ref` | Мерч по референсах | `b6bce989-9cb7-82da-9c91-81720258436d` | 7 | `DESIGN_MERCH_REF_MIN_LEAD_DAYS` | 1 тиждень | — |
| 👕 Мерч / Поліграфія | `merch_research` | Мерч з власним рісьорчем | `c53ce989-9cb7-830f-93a7-81be6d1dd8cb` | 7 | `DESIGN_MERCH_RESEARCH_MIN_LEAD_DAYS` | 1 тиждень | — |
| 👕 Мерч / Поліграфія | `print_materials` | Друковані матеріали (постер, флаєр, брошура) | `349ce989-9cb7-8045-8d52-facad67e1175` | 7 | `DESIGN_PRINT_MATERIALS_MIN_LEAD_DAYS` | 1 тиждень | — |
| 🎯 Брендинг | `identity` | Айдентика | `0fcce989-9cb7-827c-8b66-01cb5d7f5858` | — (немає lead-time конфігу) | — | — | — |
| 🎯 Брендинг | `logo` | Логотип | `3eece989-9cb7-82cd-ac15-0142b897d94b` | — | — | — | — |
| 📷 Фото | `photo_simple` | Редагування фото просте | `a55ce989-9cb7-820d-a866-010c7a9329bb` | 1 | `DESIGN_PHOTO_SIMPLE_MIN_LEAD_DAYS` | — | — |
| 📷 Фото | `photo_complex` | Редагування фото складне | `226ce989-9cb7-8256-966e-0164ca4add44` | 3 | `DESIGN_PHOTO_COMPLEX_MIN_LEAD_DAYS` | — | — |
| 📺 TV / Івент | `tv_announce` | Анонси TV | `3d6ce989-9cb7-82ca-b830-013021cbce03` | 2 | `DESIGN_TV_ANNOUNCE_MIN_LEAD_DAYS` | — | — |
| 📺 TV / Івент | `tv_static` | Статика UniTV | `665ce989-9cb7-83ba-b05e-817d5cdc90e6` | 7 | `DESIGN_TV_STATIC_MIN_LEAD_DAYS` | 1 тиждень | — |
| 📺 TV / Івент | `event_simple` | Івент простий | `587ce989-9cb7-82dd-b8f7-81157ea44ebd` | 21 | `DESIGN_EVENT_SIMPLE_MIN_LEAD_DAYS` | 3 тижні | — |
| 📺 TV / Івент | `event_complex` | Івент складний | `4dfce989-9cb7-8372-bc59-01222d1aaa29` | 60 | `DESIGN_EVENT_COMPLEX_MIN_LEAD_DAYS` | 2 місяці | — |
| 💡 Інше | `other` | Інша задача / нетиповий запит | `349ce989-9cb7-80f9-832f-c55be91be724` | — | — | — | — |

Design task types **не мають** `defaultProperties` на рівні `designTaskTypeConfig` (єдина властивість, що ставиться завжди для Design — `Design needed: true` checkbox, у `createPage.js`, окремо від task-type конфігу).

### 6.2 SMM — `smmTaskTypeGroups` + `smmTaskTypeConfig`

| Категорія | key | Label (Slack) | minLeadDays (default) | env var | defaultProperties (Notion) | defaultPlatforms |
|---|---|---|---|---|---|---|
| 📱 Контент для публікації | `reels` | Reels | 4 | `SMM_REELS_MIN_LEAD_DAYS` | `{Format: 'Reels'}` | — |
| 📱 Контент для публікації | `carousel_post` | Пост-карусель | 3 | `SMM_CAROUSEL_POST_MIN_LEAD_DAYS` | `{Format: 'Carousel'}` | — |
| 📱 Контент для публікації | `announcement_post` | Пост-анонс | 2 | `SMM_ANNOUNCEMENT_POST_MIN_LEAD_DAYS` | `{Format: 'Static Image'}` | — |
| 📱 Контент для публікації | `stories` | Сторіз | 2 | `SMM_STORIES_MIN_LEAD_DAYS` | `{Format: 'Stories'}` | `['Instagram']` |
| 📱 Контент для публікації | `linkedin_newsletter` | Newsletter LinkedIn | 4 | `SMM_LINKEDIN_NEWSLETTER_MIN_LEAD_DAYS` | — | `['LinkedIn']` |
| 🎬 Відео виробництво | `video_production` | Зйомка відео | 7 | `SMM_VIDEO_PRODUCTION_MIN_LEAD_DAYS` | `{Format: 'Video'}` | — |
| 🎬 Відео виробництво | `video_editing` | Монтаж відео | 7 | `SMM_VIDEO_EDITING_MIN_LEAD_DAYS` (fallback на `SMM_VIDEO_PRODUCTION_MIN_LEAD_DAYS`, тому теж 7) | `{Format: 'Video'}` | — |
| 🎬 Відео виробництво | `youtube_video_publish` | Публікація відео на YouTube | 2 | `SMM_YOUTUBE_VIDEO_PUBLISH_MIN_LEAD_DAYS` | `{Format: 'Video'}` | `['YouTube']` |
| 💰 Платне просування | `vacancy_promo_static` | Промо вакансій (статика) | 3 | `SMM_VACANCY_PROMO_STATIC_MIN_LEAD_DAYS` | `{Format: 'Static Image'}` | — |
| 💰 Платне просування | `vacancy_promo_video` | Промо вакансій (відео) | 7 | `SMM_VACANCY_PROMO_VIDEO_MIN_LEAD_DAYS` | `{Format: 'Video'}` | — |
| 💰 Платне просування | `publication_boost` | Просування публікацій | 2 | `SMM_PUBLICATION_BOOST_MIN_LEAD_DAYS` | — | — |
| 💰 Платне просування | `blogger_collab` | Колаборація з блогером | 7 | `SMM_BLOGGER_COLLAB_MIN_LEAD_DAYS` | — | — |
| 📁 Операційне | `drive_upload` | Завантаження фото/відео на диск | 1 | `SMM_DRIVE_UPLOAD_MIN_LEAD_DAYS` | — | — |
| 📁 Операційне | `event_report` | Звіт з івенту | 3 | `SMM_EVENT_REPORT_MIN_LEAD_DAYS` | — | — |

Всі 14 типів реально доступні через picker (усі в `smmTaskTypeGroups`). Жоден не має `complexityOptions` — крок 2.5 для SMM ніколи не показується.

### 6.3 Event — `eventTaskTypeGroups` + `eventTaskTypeConfig`

Group у Slack-picker — лише один: **`🎪 Event`**, з опціями (у точному порядку): `Виготовлення мерчу` (`merch`), `Організація події (внутрішня локація)` (`event_internal`), `Організація події (зовнішня локація)` (`event_external`), `Підготовка до виїзної конференції / ярмарку` (`conference`), `Підготовка та відправка подарунків (готова продукція)` (`gifts_ready`), `Підготовка та відправка подарунків (індивідуальне виготовлення)` (`gifts_custom`), `Організація активності на зовнішній локації` (`activity`), `Підготовка концепту стенду` (`stand_concept`), `Підготовка до виїзних конференцій/ярмарків` (`field_conference`).

**Типи без complexity (прямі, `taskConfig.nameLabel`/`namePlaceholder` — окремий "Назва"-крок відсутній! `nameLabel`/`namePlaceholder` використовуються всередині `buildDynamicNameBlock` як лейбл/placeholder поля `name_block` на основній формі брифу, це не окремий Slack-крок):**

| key | Label | nameLabel | namePlaceholder | shortTitle | secondaryTitleFieldKey | minLeadDays (default) | env var | minLeadLabel | recommendedLeadLabel | defaultProperties |
|---|---|---|---|---|---|---|---|---|---|---|
| `merch` | Виготовлення мерчу | `Вид продукції *` | `Вкажіть вид продукції` | `Мерч` | `project` | 45 | `EVENT_MERCH_MIN_LEAD_DAYS` | `45 днів` | `2 місяці` | `{'EB Activity Type': 'Merch'}` |
| `gifts_ready` | Підготовка та відправка подарунків (готова продукція) | `Назва проєкту *` | `Вкажіть назву проєкту` | `Готові подарунки` | — | 1 | `EVENT_GIFTS_READY_MIN_LEAD_DAYS` | `1 день` | `3 дні` | `{'EB Activity Type': 'Ready Gifts'}` |
| `activity` | Організація активності на зовнішній локації | `Назва проєкту *` | `Вкажіть назву проєкту` | `Активність` | — | 21 | `EVENT_ACTIVITY_MIN_LEAD_DAYS` | `3 тижні` | — | `{'EB Activity Type': 'External Activity'}` |
| `stand_concept_simple` | Підготовка концепту стенду — SIMPLE | `Назва проєкту *` | `Назва проєкту або події` | — (`category: '🎪 Event'`) | — | 21 | `EVENT_STAND_CONCEPT_SIMPLE_MIN_LEAD_DAYS` | `3 тижні` | `1 місяць` | `{'EB Activity Type': 'Підготовка концепту стенду', Complexity: 'SIMPLE'}` |
| `stand_concept_complex` | Підготовка концепту стенду — COMPLEX | `Назва проєкту *` | `Назва проєкту або події` | — | — | 45 | `EVENT_STAND_CONCEPT_COMPLEX_MIN_LEAD_DAYS` | `1,5 місяці` | `2 місяці` | `{'EB Activity Type': 'Підготовка концепту стенду', Complexity: 'COMPLEX'}` |
| `field_conference` | Підготовка до виїзних конференцій/ярмарків | `Назва проєкту *` | `Назва проєкту або події` | — | — | 18 | `EVENT_FIELD_CONFERENCE_MIN_LEAD_DAYS` | `2,5 тижні` | `3 тижні` | `{'EB Activity Type': 'Підготовка до виїзних конференцій/ярмарків'}` |

`stand_concept` (сама опція в picker-і) веде через `select_task_complexity` до `stand_concept_simple`/`stand_concept_complex` (лейбли складності `SIMPLE`/`COMPLEX`, описи: SIMPLE — `"Невелика активність, що є причиною збирати анкети та дарувати подарунки."`; COMPLEX — `"Активність є визначною частиною стенду, навколо чого будується вся концепція."`).

**Типи з `complexityOptions` (3 рівні: simple/medium/complex), базові конфіги + похідні через `buildEventComplexityTaskTypeConfigs`:**

| Базовий key | Label (базовий, для picker-а) | `complexityOptions` описи (simple / medium / complex) |
|---|---|---|
| `event_internal` | Організація події (внутрішня локація) | simple: `невелика подія в офісі без складного сетапу.` · medium: `потрібні кейтеринг, декор, подарунки або техніка.` · complex: `велика подія з кількома зонами, підрядниками, записом або повною координацією.` |
| `event_external` | Організація події (зовнішня локація) | simple: `локація вже зрозуміла, потрібна базова координація.` · medium: `треба допомогти з локацією, підрядниками, кейтерингом або логістикою.` · complex: `масштабна подія з бронюванням, кількома підрядниками, технікою, декором і повним супроводом.` |
| `conference` | Підготовка до виїзної конференції / ярмарку | simple: `базова підготовка команди та матеріалів.` · medium: `стенд, мерч, логістика або активність на місці.` · complex: `повний сетап участі: стенд, монтаж/демонтаж, логістика, активності, підрядники й багато айтемів.` |
| `gifts_custom` | Підготовка та відправка подарунків (індивідуальне виготовлення) | simple: `готове рішення з мінімальною персоналізацією.` · medium: `індивідуальний набір, дизайн або кілька позицій.` · complex: `кастомне виробництво, складні матеріали, погодження макетів або довгий цикл виготовлення.` |

Похідні типи (`{base}_simple` / `{base}_medium` / `{base}_complex`), лейбл = `` `${label} — ${Simple|Medium|Complex}` ``, `defaultProperties = {'EB Activity Type': <тип>, Complexity: 'Simple'|'Medium'|'Complex'}`:

| Похідний key | minLeadDays | env var (для базового; **⚠️ похідні типи lead-time env-и не мають окремих імен — значення хардкодні в масивах `eventInternalLeadTimes`/`eventExternalLeadTimes`/`conferenceLeadTimes`/`giftsCustomLeadTimes`, не читаються з `process.env` взагалі**) | minLeadLabel |
|---|---|---|---|
| `event_internal_simple` | 7 | — (хардкод) | `1 тиждень` |
| `event_internal_medium` | 14 | — | `2 тижні` |
| `event_internal_complex` | 21 | — | `3 тижні` |
| `event_external_simple` | 14 | — | `2 тижні` |
| `event_external_medium` | 21 | — | `3 тижні` |
| `event_external_complex` | 28 | — | `4 тижні` |
| `conference_simple` | 14 | — | `2 тижні` |
| `conference_medium` | 30 | — | `1 місяць` |
| `conference_complex` | 60 | — | `2 місяці` |
| `gifts_custom_simple` | 2 | — | `2 дні` |
| `gifts_custom_medium` | 10 | — | `1,5 тижні` |
| `gifts_custom_complex` | 60 | — | `2 місяці` |

⚠️ **Потребує перевірки / важливо для перенесення**: на відміну від Design/SMM (де майже всі lead times мають персональний env var), lead times для 4 event-типів з complexity (12 похідних значень вище) **захардкоджені** в `departments.js` (`eventInternalLeadTimes`, `eventExternalLeadTimes`, `conferenceLeadTimes`, `giftsCustomLeadTimes`) і не перевизначаються через `.env`. При перенесенні варто або зберегти ці значення буквально, або додати env-параметризацію, якщо потрібно їх змінювати без деплою коду.

**Типи, визначені в конфізі, але НЕ доступні через жодний Slack picker (⚠️ Потребує перевірки — ймовірно застарілий/неповний рефакторинг):** `event_new`, `event_support`, `event_materials`, `event_report` (в `eventTaskTypeConfig` є `minLeadDays`/`defaultProperties`, і в `eventTaskFields` є набори полів, але у жодному записі немає `label`, тому `buildTaskTypesFromGroups`-ів "additional configs" loop їх не додає в `department.taskTypes`; вони й не входять в `eventTaskTypeGroups.options`). Це означає: `getDepartmentTaskType('event', 'event_report')` поверне `null` у поточному коді — ці "типи" фактично мертвий код, якщо не викликати `/event-request` й вручну не подати `taskType=event_report` (що неможливо через UI). Якщо в старому Event-боті (Phase 3 "live out", читай README/checklist) ці типи були реальними — при перенесенні їх потрібно або явно додати в `eventTaskTypeGroups`, або видалити як мертвий код.

**Env vars для лідтайм-конфігів прямих (без complexity) Event-типів, не показані вище:**

| env var | default | таск-тайп |
|---|---|---|
| `EVENT_NEW_MIN_LEAD_DAYS` | 30 | `event_new` (недоступний у picker) |
| `EVENT_SUPPORT_MIN_LEAD_DAYS` | 14 | `event_support` (недоступний) |
| `EVENT_MATERIALS_MIN_LEAD_DAYS` | 7 | `event_materials` (недоступний) |
| `EVENT_REPORT_MIN_LEAD_DAYS` | 3 | `event_report` (недоступний) |

---

## 7. Повний реєстр полів (fields) для кожного типу задачі

Умовні позначення в таблицях: **тип** = Slack block element type (`text`=`plain_text_input` single-line, `textarea`=`plain_text_input` multiline, `select`=`static_select`, `multi_select`=`multi_static_select`, `radio`=`radio_buttons`, `checkbox`=`checkboxes` (одна опція "Так", value `yes`), `date`=`datepicker`, `time`=`timepicker`, `time_range`= пара `time`-полів `<key>_from`/`<key>_to`, `slack_user`=`users_select`, `number`= `plain_text_input` без spesial-валідації типу, лише інший placeholder-дефолт `"Наприклад: 25"`). **Обов'язковість**: якщо лейбл закінчується на ` *` — поле required (Slack `input` block без `optional: true`); якщо ні — `optional: true` явно у конфігу.

### 7.1 SMM — спільні поля (`smmCommonFields`) + примітка (`smmNoteField`)

`smmCommonFields` (порядок важливий — саме такий порядок буде на формі, до специфічних полів):

| key | тип | label (буквально) | required | options | notionProperties | role | section | hint/placeholder |
|---|---|---|---|---|---|---|---|---|
| `publication_date` | date | `Дата публікації / потрібна дата *` | так | — | `['Publication date', 'Deadline']` | `deadline` | `base` | — |
| `platforms` | multi_select | `Для якої платформи? (можна обрати кілька) *` (або `Для якої платформи? *`, якщо доступна лише 1 опція) | так | `Instagram, LinkedIn, YouTube, Facebook` (дефолтний набір `smmPlatformOptions`; для окремих типів — інший набір, див. `smmCommonFieldOverrides` нижче) | — (немає явного `notionProperties`, пишеться через `role: platforms` механізм у `createPage.js` → `Platforms`/`Platform`) | `platforms` | `base` | — |
| `context` | textarea | `Контекст / ідея — для чого, про що (1–3 речення) *` | так | — | — | `context` | `base` | — |
| `materials` | text | `Посилання на матеріали (лендинг, прес-реліз, вакансія, відео, фото)` | ні (`optional: true`) | — | — | — | `base` | placeholder: `Якщо матеріалів ще немає, залиш поле порожнім` |
| `approver` | slack_user | `Хто погоджує з вашої сторони? *` | так | — | — | — | `base` | — |

`SMM_ATTACHMENT_HINT` (використовується як `hint` кількох полів нижче, буквально): `Якщо маєш лінки — встав їх сюди. Якщо у тебе файли, після завершення форми перейди в задачу в Notion і прикріпи всі файли туди.`

`smmNoteField` (завжди додається **в кінці** списку полів для кожного SMM task type, немає винятків):

| key | тип | label | required | notes |
|---|---|---|---|---|
| `note` | textarea | `Додаткова інформація / note` | ні | placeholder: `Можеш додати будь-який контекст, уточнення, тексти, посилання або побажання, які не влізли в поля вище.` |

**`smmCommonFieldExclusions`** (які common-поля прибрати для конкретного типу):

| taskType | виключені common-поля |
|---|---|
| `announcement_post` | `materials` |
| `stories` | `platforms` |
| `linkedin_newsletter` | `platforms`, `context`, `materials` |
| `youtube_video_publish` | `platforms`, `materials` |
| `vacancy_promo_static` | `materials`, `approver` |
| `vacancy_promo_video` | `materials`, `approver` |
| `publication_boost` | `approver` |
| `blogger_collab` | `publication_date`, `materials` |
| `drive_upload` | `publication_date`, `platforms`, `materials`, `approver` |
| `event_report` | `publication_date`, `platforms`, `materials`, `approver` |
| (усі інші: `reels`, `carousel_post`, `video_production`, `video_editing`) | немає винятків — всі 5 common-полів показуються |

**`smmCommonFieldOverrides`** (заміна `platforms`-поля на варіант з іншим набором опцій, замінює той самий `key='platforms'`, тому позиція в списку не змінюється):

| taskType | опції `platforms` |
|---|---|
| `reels` | `Instagram` (лише 1 опція → лейбл автоматично стає `Для якої платформи? *` без "можна обрати кілька") |
| `carousel_post` | `Instagram, LinkedIn, Facebook` |
| `vacancy_promo_static` | `Meta, Google Ads, LinkedIn Ads` |
| `vacancy_promo_video` | `Meta, Google Ads, LinkedIn Ads` |
| (усі інші) | дефолтний `smmPlatformOptions` = `Instagram, LinkedIn, YouTube, Facebook` |

### 7.2 SMM — специфічні поля (`smmTaskFields`) по кожному з 14 типів

**`reels`:**

| key | тип | label | required | options | notionProperties | showWhen | hint/placeholder |
|---|---|---|---|---|---|---|---|
| `talent_consent` | textarea | `Хто знімається + чи є згода *` | так | — | — | — | — |
| `style_references` | text | `Референси стилю/монтажу *` | так | — | — | — | hint = SMM_ATTACHMENT_HINT; placeholder `Лінки на референси або короткий опис.` |
| `subtitles` | select | `Субтитри *` | так | `Так, Ні` | — | — | — |

**`carousel_post`:**

| key | тип | label | required | options | showWhen | placeholder |
|---|---|---|---|---|---|---|
| `structure_choice` | select | `Структура каруселі *` | так | `Є структура — опишу`, `SMM придумує` | — | hint: `Якщо обереш «Є структура — опишу», нижче зʼявиться поле для опису структури.` |
| `slide_topics` | textarea | `Опис структури каруселі` | ні | — | `structure_choice = "Є структура — опишу"` | `Опиши структуру або теми слайдів: слайд 1 — ..., слайд 2 — ...` |
| `ready_texts` | select | `Готові тексти *` | так | `Так — посилання`, `Ні, писати з нуля` | — | hint: `Якщо обереш «Так — посилання», нижче зʼявиться поле для готових текстів або лінку.` |
| `ready_texts_link` | textarea | `Готові тексти / посилання` | ні | — | `ready_texts = "Так — посилання"` | `Встав готовий текст або лінк на документ з текстами.` |
| `design_references` | text | `Референси дизайну` | ні | — | — | — |

**`announcement_post`:**

| key | тип | label | required | options | notionProperties | showWhen |
|---|---|---|---|---|---|---|
| `landing_link` | text | `Лінк на лендинг / прес-реліз *` | так | — | `['Ad link']` | — |
| `event_date` | date | `Дата події *` | так | — | `['Event date']` | — |
| `cta_link` | textarea | `CTA + посилання *` | так | — | `['Ad CTA']` | — |
| `visual_source` | select | `Візуал *` | так | `Є — посилання`, `Беремо з лендингу` | — | hint: `Якщо обереш «Є — посилання», нижче зʼявиться поле для лінку на візуал.` |
| `visual_link` | text | `Лінк на візуал` | ні | — | — | `visual_source = "Є — посилання"`; placeholder `Встав лінк на готовий візуал.` |

**`stories`:**

| key | тип | label | required | options | notionProperties | showWhen |
|---|---|---|---|---|---|---|
| `goal` | select | `Мета *` | так | `Анонс, Охоплення, Голосування, Трафік на посилання` | — | — |
| `link_needed` | select | `Посилання потрібне? *` | так | `Так, Ні` | — | — |
| `story_link` | text | `Посилання` | ні | — | — | `link_needed = "Так"` |
| `story_format` | select | `Формат *` | так | `Статика, Відео, Інтерактив` | `['Format']` | — |
| `ready_materials` | text | `Готові матеріали` | ні | — | — | hint=SMM_ATTACHMENT_HINT; placeholder `Лінки на готові матеріали.` |

**`linkedin_newsletter`:**

| key | тип | label | required |
|---|---|---|---|
| `key_points` | textarea | `Список вакансій *` | так |
| `ready_copy_link` | text | `Посилання на готовий текст *` | так |

**`video_production`:**

| key | тип | label | required | options |
|---|---|---|---|---|
| `video_idea` | textarea | `Що знімаємо / ідея *` | так | — |
| `shoot_location_date` | text | `Локація і дата зйомки *` | так | — |
| `frame_people_consent` | textarea | `Хто в кадрі + згода *` | так | — |
| `video_references` | text | `Референси` | ні | hint=SMM_ATTACHMENT_HINT; placeholder `Лінки на референси.` |
| `duration` | text | `Орієнтовний хронометраж *` | так | — |
| `editing_needed` | select | `Чи потрібен монтаж? *` | так | `Так, Ні` |

**`video_editing`:**

| key | тип | label | required | options | placeholder/hint |
|---|---|---|---|---|---|
| `video_materials` | text | `Посилання на відеоматеріали *` | так | — | hint=SMM_ATTACHMENT_HINT; placeholder `Лінк на папку або файл з матеріалами.` |
| `edit_brief` | textarea | `Що потрібно змонтувати / ідея *` | так | — | — |
| `video_references` | text | `Референси` | ні | — | hint=SMM_ATTACHMENT_HINT; placeholder `Лінки на референси.` |
| `duration` | text | `Орієнтовний хронометраж *` | так | — | — |
| `subtitles` | select | `Субтитри *` | так | `Так, Ні` | — |

**`youtube_video_publish`:**

| key | тип | label | required | options | showWhen |
|---|---|---|---|---|---|
| `video_link` | text | `Готове відео *` | так | — | — |
| `title_description` | select | `Назва + опис *` | так | `Є — додам, Треба допомога` | — |
| `youtube_title_description_text` | textarea | `Назва + опис` | ні | — | `title_description = "Є — додам"` |
| `thumbnail` | select | `Обкладинка *` | так | `Є — посилання, Треба зробити` | — |
| `thumbnail_link` | text | `Посилання на обкладинку` | ні | — | `thumbnail = "Є — посилання"` |
| `video_visibility` | select | `Видимість відео *` | так | `Публічне, Приховане` | — |

**`vacancy_promo_static`:**

| key | тип | label | required |
|---|---|---|---|
| `vacancies_list` | textarea | `Список вакансій або посилання на список вакансій *` (placeholder: `Додай лінк на список або кілька вакансій окремими рядками.`) | так |
| `targeting` | textarea | `Гео / аудиторія таргету *` | так |
| `campaign_start_date` | date | `Період кампанії: від *` | так |
| `campaign_end_date` | date | `Період кампанії: до *` | так |

**`vacancy_promo_video`:** те саме, плюс:

| key | тип | label | required |
|---|---|---|---|
| `video_asset_link` | text | `Посилання на відео` (hint=SMM_ATTACHMENT_HINT; placeholder `Якщо відео вже готове, додай лінк.`) | ні |

**`publication_boost`:**

| key | тип | label | required | options | notionProperties | showWhen |
|---|---|---|---|---|---|---|
| `post_link` | text | `Посилання на пост *` | так | — | `['Ad link']` | — |
| `budget` | text | `Бюджет у доларах ($) *` | так | — | — | — |
| `ad_goal` | select | `Ціль *` | так | `Охоплення, Кліки, Інше (напишу в коментарі)` | — | — |
| `ad_goal_other` | textarea | `Коментар до цілі *` | так | — | — | `ad_goal = "Інше (напишу в коментарі)"` |
| `success_kpi` | textarea | `KPI успішної кампанії *` | так | — | — | — |
| `campaign_start_date` | date | `Період: від *` | так | — | — | — |
| `campaign_end_date` | date | `Період: до *` | так | — | — | — |
| `targeting` | textarea | `Гео / аудиторія *` | так | — | — | — |

**`blogger_collab`:**

| key | тип | label | required | options | notionProperties | showWhen | role |
|---|---|---|---|---|---|---|---|
| `blogger_profile` | text | `Блогер / профіль *` | так | — | `['Ad link']` | — | — |
| `collab_goal` | select | `Ціль *` | так | `Промо вакансій, Промо івентів, Побудова знання` | — | — | — |
| `collab_format` | select | `Формат *` | так | `Reels, Сторіз, Пост` | — | — | — |
| `fixed_budget` | select | `Чи є фіксований бюджет? *` | так | `Так, Ні` | — | — | — |
| `budget_amount` | text | `Бюджет *` | так | — | — | `fixed_budget = "Так"` | — |
| `key_message` | textarea | `Ключове повідомлення *` | так | — | — | — | — |
| `publish_deadline` | date | `Дедлайн виходу *` | так | — | — | — | `deadline` |

**`drive_upload`:**

| key | тип | label | required | options | notionProperties | showWhen | role |
|---|---|---|---|---|---|---|---|
| `upload_content` | textarea | `Що завантажуємо *` | так | — | — | — | — |
| `source_materials` | select | `Джерело матеріалів *` | так | `Посилання, Передам окремо` | — | — | — |
| `source_link` | text | `Посилання на матеріали` | ні | — | — | `source_materials = "Посилання"` | — |
| `destination_folder` | text | `Куди (папка/диск) *` | так | — | — | — | — |
| `operation_deadline` | date | `Дедлайн *` | так | — | `['Deadline']` | — | `deadline` |

**`event_report`** (SMM-версія; окрема від Event-департаментної `event_report`):

| key | тип | label | required | options | notionProperties | role |
|---|---|---|---|---|---|---|
| `event_name` | text | `Який івент *` | так | — | — | — |
| `event_date` | date | `Дата івенту *` | так | — | `['Event date']` | — |
| `report_data` | textarea | `Які дані потрібні *` | так | — | — | — |
| `report_format` | select | `Формат звіту *` | так | `Notion, Презентація, Таблиця` | — | — |
| `report_deadline` | date | `Дедлайн *` | так | — | `['Deadline']` | `deadline` |

### 7.3 Event — спільні поля (`eventCommonFields`) + примітка (`eventNoteField`) — ⚠️ практично НЕ використовуються

`eventCommonFields` (для довідки, порядок як у коді):

| key | тип | label | required | notionProperties | role |
|---|---|---|---|---|---|
| `event_date` | date | `Дата івенту *` | так | `['Event date', 'Deadline']` | `deadline` |
| `event_format` | select | `Формат івенту *` | так, опції `Online, Offline, Hybrid` | `['Format']` | — |
| `location` | text | `Локація / платформа` | ні | `['Location']` | — |
| `budget` | text | `Бюджет, $` | ні (placeholder `Наприклад: $500`) | `['$ EB Budget', 'EB Budget', 'Budget']` | — |
| `context` | textarea | `Контекст / ціль івенту *` | так | — | `context` |
| `audience` | textarea | `Аудиторія *` | так | `['Audience', 'Target audience']` | — |
| `materials` | text | `Посилання на матеріали` | ні (placeholder `Лендінг, Figma, Drive, референси або інші матеріали.`) | — | — |
| `approver` | slack_user | `Хто погоджує з вашої сторони? *` | так | — | — |

`eventNoteField`: key `note`, textarea, `Додаткова інформація / note`, optional, placeholder `Усе, що важливо для Event команди і не вмістилось у полях вище.`

⚠️ **Важливо для перенесення**: `eventTaskFieldsWithoutCommon` і `eventTaskFieldsWithoutNote` (обидва Sets з ідентичним вмістом) містять **усі** реально доступні через picker Event task types: `merch`, `event_internal`, `event_external`, `conference`, `gifts_ready`, `gifts_custom`, `activity`, всі 12 complexity-похідних (`event_internal_simple/medium/complex` тощо), `stand_concept_simple`, `stand_concept_complex`, `field_conference`. Отже **для жодного реально використовуваного Event task type common-поля і note-поле не додаються** — кожен тип показує лише свій власний список полів (розділ 7.4). Механізм `eventCommonFields`/`eventNoteField` спрацював би тільки для `event_new`/`event_support`/`event_materials`/`event_report`, які самі недосяжні через UI (розділ 6.3). Якщо мета переносу — відтворити реальну поведінку, `eventCommonFields`/`eventNoteField` можна просто ігнорувати; якщо мета — виправити/розширити Event-флоу, це слід свідомо врахувати.

### 7.4 Event — специфічні поля (`eventTaskFields`) по кожному реально досяжному типу

**`merch`:**

| key | тип | label | required | notionProperties | role |
|---|---|---|---|---|---|
| `project` | text | `Проєкт *` | так | — | — |
| `quantity` | number | `Кількість *` | так | — | — |
| `references` | textarea | `Референси` | ні | — | — |
| `budget` | text | `Бюджет, $ *` (placeholder `Наприклад: $500`) | так | `['$ EB Budget', 'EB Budget', 'Budget']` | — |
| `audience` | text | `Аудиторія *` | так | — | — |
| `context` | textarea | `Контекст - для чого потрібно *` | так | — | `context` |
| `deadline_receive` | date | `Дедлайн отримання *` | так | `['Deadline']` | `deadline` |

**`event_internal`** (і однакові поля успадковують `event_internal_simple`/`_medium`/`_complex`):

| key | тип | label | required | options |
|---|---|---|---|---|
| `event_date` | date | `Дата події *` (notionProperties `['Event date','Deadline']`, role `deadline`) | так | — |
| `office_location` | text | `Локація в офісі *` | так | — |
| `start_time` | time | `Час початку *` | так | — |
| `event_type` | select | `Тип події *` | так | `Партнерський, Власний` |
| `guests_count` | number | `Кількість гостей *` | так | — |
| `budget` | text | `Бюджет, $ *` (notionProperties `['$ EB Budget','EB Budget','Budget']`) | так | — |
| `concept` | textarea | `Концепція заходу *` | так | — |
| `design_concept` | text | `Дизайн-концепт` | ні | — |
| `audience` | text | `Аудиторія *` | так | — |
| `context` | textarea | `Загальний контекст *` (role `context`) | так | — |
| `welcome_packs` | checkbox | `Потрібні велком-паки?` | ні | — |
| `gifts_needed` | checkbox | `Потрібні подарунки?` | ні | — |
| `gifts_quantity` | number | `Якщо подарунки потрібні - кількість` | ні | — |
| `catering` | text | `Кейтеринг` | ні | — |
| `photographer` | checkbox | `Потрібен фотограф?` | ні | — |
| `recording` | checkbox | `Потрібен запис події?` | ні | — |
| `badges` | checkbox | `Потрібні бейджі?` | ні | — |
| `tech_setup` | text | `Технічний сетап` | ні | — |

**`event_external`** (і `event_external_simple/_medium/_complex`) — як `event_internal`, але з відмінностями:

| key | тип | label | required | options | notionProperties |
|---|---|---|---|---|---|
| `event_date` | date | `Дата події *` | так | — | `['Event date','Deadline']`, role `deadline` |
| `location` | text | `Локація *` (placeholder `Назва локації або район`) | так | — | `['Location']` |
| `location_confirmed` | radio | `Підтверджена локація? *` | так | `Так, є адреса` / `Ні, треба шукати` | — |
| `location_address` | text | `Якщо так - адреса локації` (placeholder `Адреса локації`) | ні | — | — |
| `start_time` | time | `Час початку *` | так | — | — |
| `event_type` | select | `Тип події *` | так | `Партнерський, Власний` | — |
| `guests_count` | number | `Кількість гостей *` | так | — | — |
| `budget` | text | `Бюджет, $ *` | так | — | `['$ EB Budget','EB Budget','Budget']` |
| `concept` | textarea | `Концепція заходу *` (placeholder `Опишіть ідею, формат і ключові активності`) | так | — | — |
| `design_concept` | text | `Дизайн-концепт` (placeholder `Посилання або короткий опис`) | ні | — | — |
| `audience` | text | `Аудиторія *` (placeholder `Для кого подія`) | так | — | — |
| `context` | textarea | `Загальний контекст *` (role `context`, placeholder `Навіщо подія і який очікуваний результат`) | так | — | — |
| `welcome_packs` | checkbox | `Потрібні велком-паки?` | ні | — | — |
| `gifts_needed` | checkbox | `Потрібні подарунки?` | ні | — | — |
| `gifts_quantity` | number | `Якщо подарунки потрібні - кількість` | ні | — | — |
| `catering` | text | `Кейтеринг` (placeholder `Кава, снеки, обід або інші потреби`) | ні | — | — |
| `photographer` | checkbox | `Потрібен фотограф?` | ні | — | — |
| `recording` | checkbox | `Потрібен запис події?` | ні | — | — |
| `badges` | checkbox | `Потрібні бейджі?` | ні | — | — |
| `tech_setup` | text | `Технічний сетап` (placeholder `Мікрофони, екран, звук, стрим тощо`) | ні | — | — |

**`conference`** (і `conference_simple/_medium/_complex`):

| key | тип | label | required | notionProperties |
|---|---|---|---|---|
| `event_date` | date | `Дата події *` | так | `['Event date','Deadline']`, role `deadline` |
| `location` | text | `Локація *` | так | `['Location']` |
| `setup_date` | date | `Дата монтажу *` | так | — |
| `setup_time` | time | `Час монтажу *` | так | — |
| `teardown_date` | date | `Дата демонтажу *` | так | — |
| `teardown_time` | time | `Час демонтажу *` | так | — |
| `participants_count` | number | `Кількість учасників від Universe *` | так | `['Participants','Attendees']` |
| `event_attendees_count` | number | `Кількість учасників події` | ні | — |
| `budget` | text | `Бюджет, $ *` | так | `['$ EB Budget','EB Budget','Budget']` |
| `team_look` | text | `Зовнішній вигляд команди *` | так | — |
| `context` | textarea | `Загальний контекст *` | так | role `context` |
| `stand_logistics` | checkbox | `Потрібна логістика стенду?` | ні | — |
| `merch_packaging` | textarea | `Мерч для пакування` | ні | — |
| `stand_activity` | textarea | `Активність на стенді` | ні | — |
| `extra_items` | textarea | `Додаткові айтеми для замовлення` | ні | — |

**`gifts_ready`:**

| key | тип | label | required | notionProperties | role |
|---|---|---|---|---|---|
| `items` | textarea | `Перелік айтемів для відправки *` | так | — | — |
| `recipient_details` | textarea | `Реквізити отримувача - ПІБ, адреса, телефон *` | так | — | — |
| `payer` | text | `Хто платник за відправку *` | так | — | — |
| `gift_deadline` | date | `Дедлайн отримання подарунку *` | так | `['Deadline']` | `deadline` |

**`gifts_custom`** (і `gifts_custom_simple/_medium/_complex`):

| key | тип | label | required | notionProperties | role |
|---|---|---|---|---|---|
| `quantity` | number | `Кількість *` | так | — | — |
| `budget` | text | `Бюджет, $ *` | так | `['$ EB Budget','EB Budget','Budget']` | — |
| `references` | textarea | `Референси *` | так | — | — |
| `context` | textarea | `Загальний контекст *` | так | — | `context` |
| `deadline_receive` | date | `Дедлайн отримання *` | так | `['Deadline']` | `deadline` |

**`activity`:**

| key | тип | label | required | notionProperties | role |
|---|---|---|---|---|---|
| `date` | date | `Дата *` | так | `['Event date','Deadline']` | `deadline` |
| `location` | text | `Локація *` (placeholder `Вкажіть локацію`) | так | `['Location']` | — |
| `work_time` | time_range | `Час роботи *` → генерує 2 поля: `work_time_from` (`Час роботи від *`) і `work_time_to` (`Час роботи до *`) | так | — | — |
| `references` | textarea | `Референси *` | так | — | — |
| `budget` | text | `Бюджет, $ *` | так | `['$ EB Budget','EB Budget','Budget']` | — |
| `context` | textarea | `Загальний контекст *` | так | — | `context` |

**`stand_concept_simple`** і **`stand_concept_complex`** (ідентичні набори полів, усі `section: 'base'` — тобто йдуть у секцію "Базові поля" при побудові body у SMM/Event-стилі body-брифу):

| key | тип | label | required | notionProperties | role |
|---|---|---|---|---|---|
| `project_date` | date | `Дата проєкту *` | так | `['Event date','Deadline']` | `deadline` |
| `location` | text | `Локація *` | так | `['Location']` | — |
| `stand_size` | text | `Розмір стенду *` | так | `['Stand size','Size']` | — |
| `participants_count` | number | `Кількість учасників *` | так | `['Participants','Attendees']` | — |
| `merch_needed` | select | `Чи потрібен мерч *` (опції `Так, Ні, Потрібно обговорити`) | так | `['Merch needed','Merch']` | — |
| `team_look` | textarea | `Зовнішній вигляд команди *` | так | `['Team look','Team appearance']` | — |
| `activity_goal` | textarea | `Мета активності *` | так | — | `context` |
| `context` | textarea | `Загальний контекст / напрацьовані ідеї / напрямок *` | так | — | — |
| `budget` | text | `Бюджет, $ *` | так | `['$ EB Budget','EB Budget','Budget']` | — |

**`field_conference`** (усі поля `section: 'base'`):

| key | тип | label | required | notionProperties | role |
|---|---|---|---|---|---|
| `project_date` | date | `Дата проєкту *` | так | `['Event date','Deadline']` | `deadline` |
| `location` | text | `Локація *` | так | `['Location']` | — |
| `setup_date` | date | `Дата монтажу *` | так | `['Mounting date','Installation date']` | — |
| `setup_time` | time | `Час монтажу *` | так | `['Mounting time','Installation time']` | — |
| `teardown_date` | date | `Дата демонтажу *` | так | `['Demounting date','Teardown date']` | — |
| `teardown_time` | time | `Час демонтажу *` | так | `['Demounting time','Teardown time']` | — |
| `logistics_needed` | select | `Чи потрібна логістика *` (опції `Так, Ні, Потрібно обговорити`) | так | `['Logistics needed','Logistics']` | — |
| `participants_count` | number | `Кількість учасників від Universe *` | так | `['Participants','Attendees']` | — |
| `team_look` | textarea | `Зовнішній вигляд команди *` | так | `['Team look','Team appearance']` | — |
| `context` | textarea | `Загальний контекст *` | так | — | `context` |
| `budget` | text | `Бюджет, $ *` | так | `['$ EB Budget','EB Budget','Budget']` | — |

**Недосяжні через UI, але визначені (`event_new`, `event_support`, `event_materials`, `event_report` — Event-версія, відрізняється від SMM `event_report` вище):**

`event_new`: `event_goal` (textarea, `Що має відбутися / короткий опис *`), `expected_attendees` (text, `Орієнтовна кількість учасників`, optional, notionProperties `['Attendees','Participants']`), `deliverables` (textarea, `Що потрібно від Event команди *`).

`event_support`: `current_status` (textarea, `Що вже готово *`), `support_needed` (textarea, `Яка підтримка потрібна *`).

`event_materials`: `materials_needed` (textarea, `Які матеріали потрібні *`), `sizes_formats` (textarea, `Формати / розміри`, optional, notionProperties `['Formats','Sizes']`).

`event_report` (Event, не SMM): `report_data` (textarea, `Які дані потрібні *`), `report_format` (select, `Формат звіту *`, опції `Notion, Презентація, Таблиця`, notionProperties `['Format']`), `report_deadline` (date, `Дедлайн звіту *`, role `deadline`, notionProperties `['Deadline']`).

### 7.5 Design — базові поля (`baseBlocks()`, статичні Slack-блоки, завжди показуються перед специфічними)

| block_id | action_id | тип елемента | label (буквально) | required | options / placeholder | hint |
|---|---|---|---|---|---|---|
| `name_block` | `name` | plain_text_input | `📌 Назва задачі *` | так | placeholder `Банер для посту про Summer Camp` | — |
| `priority_block` | `priority` | static_select | `🔥 Пріоритет *` | так | опції: `Urgent`, `High`, `Normal`, `Low`, `Planned` (значення = текст) | буквально: `Urgent — є конкретна дата події / підрядник з дедлайном / force majeure. Потребує ревю Жені.\nHigh — задача цього тижня, є дедлайн, але не горить сьогодні. Стандартний пріоритет для більшості задач.\nNormal — задача без жорсткого дедлайну, береться за чергою.\nLow — задача «коли буде час», не блокує нікого.\nPlanned — задача відома наперед, запланована на конкретний тиждень у майбутньому (Summer Camp, дайджест, ребрендинг).` |
| `deadline_block` | `deadline` | datepicker | `📅 Дедлайн *` | так | placeholder `Вибери дату...` | — |
| `context_block` | `context` | plain_text_input (multiline) | `💬 Контекст *` | так | placeholder `Це для Instagram-посту до Дня компанії. Основна емоція — гордість і тепло.` | `Для чого це потрібно? Як буде використовуватись? Яка емоція?` |
| `style_block` | `style` | plain_text_input (multiline) | `🎨 Стиль / Референси` | ні | placeholder `Референс: figma.com/... Хочемо щось у дусі цього, але з нашими кольорами` | — |
| `antiref_block` | `antiref` | plain_text_input (multiline) | `🚫 Антиреференси` | ні | placeholder `Нічого занадто мінімалістичного, без чорного фону` | — |
| `can_edit_block` | `can_edit` | static_select | `✏️ Дизайнер може правити текст?` | ні | опції `Так`/`Ні` | — |

### 7.6 Design — специфічні поля (`specificBlocks`) по кожному з 36 типів (буквальні тексти)

Позначення: R = required (лейбл з ` *`), О = optional.

**`static_simple`:**
- `platform_block`/`platform` (static_select, R) `📱 Платформа *` — опції: `Instagram, LinkedIn, Facebook, Email, Print, Corpsite`.
- `message_block`/`message` (text, R) `💬 Ключове повідомлення / CTA *` — placeholder `Реєструйся до 20 квітня`.
- `size_block`/`size` (text, О) `📏 Розміри або орієнтація` — placeholder `1080×1080 / квадрат / горизонталь`.
- `artifact_drive_block`/`artifact_drive` (text, О) `📎 Текст, фото, референси (Google Drive / Figma)` — placeholder `drive.google.com/...`; отримує авто-hint `Будь ласка, перейдіть у таску в ноушин та додайте аттачменти у коментарі` (бо в `MATERIALS_HINT_BLOCK_IDS`).

**`static_complex`:**
- `platform_block`/`platform` (static_select, R) `📱 Платформа *` — `Instagram, LinkedIn, Facebook, Print`.
- `message_block`/`message` (text, R) `💬 Ключове повідомлення *` — placeholder `Головний меседж банера`.
- `output_format_block`/`output_format` (static_select, R) `📄 Формат файлу на виході *` — `PNG, JPG, PDF, SVG`.
- `color_model_block`/`color_model` (static_select, О) `🎨 Кольорова модель` — `RGB (digital)`→value `RGB`, `CMYK (друк)`→value `CMYK`.
- `artifact_drive_block`/`artifact_drive` (text, О) `📎 Текст, фото, референси (Google Drive / Figma)` — авто-hint (materials).

**`carousel`:**
- `slides_count_block`/`slides_count` (text, R) `🔢 Кількість слайдів *` — placeholder `5`.
- `slides_text_block`/`slides_text` (textarea, R) `📝 Тема і текст по кожному слайду *` — placeholder `Слайд 1: Заголовок\nСлайд 2: Текст про...`.
- `platform_block`/`platform` (static_select, О) `📱 Платформа` — `Instagram, LinkedIn`.
- `artifact_drive_block`/`artifact_drive` (text, О) `📎 Фото, референси (Google Drive)` — авто-hint.

**`resize`:**
- `formats_list_block`/`formats_list` (textarea, R) `📐 Перелік форматів на виході *` — placeholder `1080×1080\n1080×1920\n1200×628`.
- `artifact_figma_block`/`artifact_figma` (text, R) `📎 Посилання на вихідний макет у Figma *` — placeholder `figma.com/file/...`; (⚠️ не в `MATERIALS_HINT_BLOCK_IDS`, тому авто-hint НЕ додається — цей artifact-блок винятковий).

**`promo_creo_static_template`:**
- `selected_concept_block`/`selected_concept` (text, R) `🎯 Обраний концепт *` — placeholder `Назва або короткий опис обраного концепту`.
- `new_text_block`/`new_text` (textarea, R) `📝 Новий текст *` — placeholder `Текст, який треба підставити в готовий шаблон`.
- `cta_block`/`cta` (text, R) `📢 CTA *` — placeholder `Наприклад: Подати заявку до 1 травня`.

**`promo_creo_static_ideas`:**
- `concept_only_block`/`concept_only` (textarea, R) `💡 Концепція *` — placeholder `Опиши ідею майбутнього креативу`.
- `artifact_ref_block`/`artifact_ref` (textarea, R) `📎 Референси *` — placeholder `Посилання на приклади або опиши, що подобається`; авто-hint НЕ додається (`artifact_ref_block` немає в `MATERIALS_HINT_BLOCK_IDS`).
- `message_block`/`message` (textarea, R) `💬 Меседж *` — placeholder `Головний меседж, який має зчитуватися з креативу`.
- `cta_block`/`cta` (text, R) `📢 CTA *` — placeholder `Наприклад: Подати заявку / Дізнатись більше`.

**`promo_creo_mix_template`:**
- `selected_concept_block`/`selected_concept` (text, R) `🎯 Обраний концепт *`.
- `new_text_block`/`new_text` (textarea, R) `📝 Новий текст *` — placeholder `Текст, який треба використати в шаблоні`.
- `cta_block`/`cta` (text, R) `📢 CTA *` — placeholder `Наприклад: Подати заявку / Дізнатись більше`.

**`promo_creo_mix_ideas`:**
- `concept_only_block`/`concept_only` (textarea, R) `💡 Концепція *` — placeholder `Опиши ідею для static + motion креативу`.
- `artifact_ref_block`/`artifact_ref` (textarea, R) `📎 Референси *`.
- `message_block`/`message` (textarea, R) `💬 Меседж *` — placeholder `Головний меседж, який має бути в креативі`.
- `cta_block`/`cta` (text, R) `📢 CTA *`.
- `subtitles_block`/`subtitles` (static_select, R) `💬 Чи потрібні субтитри? *` — `Так, Ні`.
- `hooks_block`/`hooks` (textarea, О) `🪝 Хуки` — placeholder `Перші фрази / меседжі для зачіпки, якщо вже є`.
- `desired_dynamics_block`/`desired_dynamics` (textarea, О) `🎞 Мінімальний опис бажаної динаміки` — placeholder `Що саме має анімуватись, у якому темпі, можна додати приклади`.

**`promo_creo_video_template`:**
- `selected_concept_block`/`selected_concept` (text, R) `🎯 Обраний концепт *`.
- `video_format_block`/`video_format` (static_select, R) `🎬 Фінальний формат *` — `Рілз + квадрат` (value `Reels + Square`), `Тільки рілз` (value `Reels only`).
- `subtitles_block`/`subtitles` (static_select, R) `💬 Чи потрібні субтитри? *` — `Так, Ні`.
- `cta_block`/`cta` (textarea, R) `📢 CTA наприкінці *` — placeholder `Вкажи CTA і чи він один, чи тестуємо кілька варіантів`.
- `hooks_block`/`hooks` (textarea, О) `🪝 Хуки`.

**`promo_creo_video_ideas`:**
- `concept_only_block`/`concept_only` (textarea, R) `💡 Концепція *` — placeholder `Опиши ідею відеокреативу`.
- `artifact_ref_block`/`artifact_ref` (textarea, R) `📎 Референси *`.
- `message_block`/`message` (textarea, R) `💬 Меседж *` — placeholder `Головний меседж, який має бути у відео`.
- `cta_block`/`cta` (text, R) `📢 CTA *`.
- `subtitles_block`/`subtitles` (static_select, R) `💬 Чи потрібні субтитри? *`.
- `hooks_block`/`hooks` (textarea, О) `🪝 Хуки`.
- `desired_dynamics_block`/`desired_dynamics` (textarea, О) `🎞 Мінімальний опис бажаної динаміки`.

**`video_simple`:**
- `video_format_block`/`video_format` (static_select, R) `🎬 Фінальний формат *` — `Reels / вертикальний (9:16)`→`Reels`, `Квадрат (1:1)`→`Square`, `Горизонталь (16:9)`→`Horizontal`.
- `subtitles_block`/`subtitles` (static_select, R) `💬 Потрібні субтитри? *` — `Так, Ні`.
- `cta_block`/`cta` (text, О) `📢 CTA наприкінці` — placeholder `Підписуйся на наш Instagram`.
- `artifact_video_block`/`artifact_video` (text, R) `📎 Відеоматеріал (Google Drive) *` — placeholder `drive.google.com/...`; авто-hint.
- `artifact_music_block`/`artifact_music` (text, О) `📎 Музика (або напиши "підібрати самостійно")` — placeholder `drive.google.com/... або "підібрати самостійно"`; авто-hint.

**`video_complex`:**
- `video_format_block`/`video_format` (static_select, R) `🎬 Фінальний формат *` — ті самі 3 опції.
- `mood_block`/`mood` (textarea, R) `🌀 Концепція / настрій *` — placeholder `Динамічно, з музикою, акцент на людях, відчуття команди`.
- `edit_style_block`/`edit_style` (text, О) `✂️ Стиль монтажу` — placeholder `кінематографічний / швидка нарізка / cinematic`.
- `artifact_video_block`/`artifact_video` (text, О) `📎 Відеоматеріал (Google Drive)` — авто-hint.
- `artifact_ref_block`/`artifact_ref` (text, О) `📎 Референси відео` — placeholder `youtube.com/... або drive.google.com/...`.

**`print_materials`:**
- `print_size_block`/`print_size` (text, R) `📐 Розміри *` — placeholder `A3, горизонталь / A4, вертикаль / 100×70 см`.
- `construction_block`/`construction` (textarea, R) `🧩 Конструкція *` — placeholder `Якщо носій складний: схема складання, кількість згинів, порядок сторін, схема розміщення стін тощо`.
- `file_packaging_block`/`file_packaging` (textarea, R) `📦 Як передавати елементи *` — placeholder `Чи кожен елемент має бути окремим файлом, чи можна скопом в одному документі`.
- `print_effect_block`/`print_effect` (textarea, R) `✨ Ефект нанесення *` — placeholder `Який ефект нанесення очікується: матовість, лак, тиснення, фольга тощо`.
- `artifact_ref_block`/`artifact_ref` (textarea, R) `📎 Референси готового обʼєкту *` — placeholder `Посилання на приклади або фото бажаного результату`.

**`other`:**
- Додатковий не-input `section`-блок з текстом `💡 *Нетипова задача* — опиши детально що потрібно, дизайнер сам оцінить складність.`
- `other_desc_block`/`other_desc` (textarea, R) `📝 Детальний опис задачі *` — placeholder `Наприклад: оформити сторінку Notion для онбордингу, зробити символ для бізнесу FORMA, налаштувати профіль в Ashby...`.
- `artifact_drive_block`/`artifact_drive` (text, О) `📎 Додаткові матеріали (Google Drive / Figma / посилання)` — авто-hint; placeholder `drive.google.com/... або figma.com/...`.

**`pres_edit`:**
- `artifact_pres_block`/`artifact_pres` (text, R) `📎 Посилання на існуючу презентацію *` — placeholder `docs.google.com/presentation/... або figma.com/...`; авто-hint.
- `slide_list_block`/`slide_list` (textarea, R) `📋 Перелік слайдів для правок + коментарі *` — placeholder `Слайд 3: замінити фото\nСлайд 7: оновити дату`.
- `can_shorten_block`/`can_shorten` (static_select, О) `✂️ Можна скорочувати текст?` — `Так, Ні`.

**`pres_template`:**
- `structure_block`/`structure` (textarea, R) `🗂 Структура (перелік слайдів) *` — placeholder `1. Вступ\n2. Проблема\n3. Рішення\n4. CTA`.
- `slides_text_block`/`slides_text` (textarea, R) `📝 Текст / тези по кожному слайду *` — placeholder `Слайд 1: Текст вступу...\nСлайд 2: ...`.
- `artifact_drive_block`/`artifact_drive` (text, О) `📎 Фото, іконки (Google Drive)` — авто-hint.

**`pres_wow`:**
- `audience_block`/`audience` (text, R) `👥 Ціль і аудиторія *` — placeholder `Для топ-менеджменту, ціль — затвердити Q3 бюджет`.
- `structure_block`/`structure` (textarea, R) `🗂 Структура *` — placeholder `1. Вступ\n2. Ринок\n3. Наше рішення\n4. Команда\n5. CTA`.
- `artifact_ref_block`/`artifact_ref` (text, R) `📎 Референси (обов'язково)` — placeholder `drive.google.com/... або посилання на приклад`.
- `artifact_drive_block`/`artifact_drive` (text, О) `📎 Текст, фото, логотип, бренд-гайд` — авто-hint.

**`ai_static_simple`:**
- `ai_description_block`/`ai_description` (textarea, R) `🤖 Що має бути зображено *` — placeholder `Жінка-програміст в офісі, стиль — кінематографічний, тепле світло`.
- `platform_block`/`platform` (static_select, R) `📱 Платформа використання *` — `Instagram, LinkedIn, Corpsite, Email`.
- `artifact_ref_block`/`artifact_ref` (text, О) `📎 Референс і що в ньому подобається` — placeholder `pinterest.com/... — подобається ця кольорова гама`.

**`ai_static_complex`:**
- `ai_description_block`/`ai_description` (textarea, R) `🤖 Що має бути зображено і для чого *` — placeholder `Колаж: людина в костюмі астронавта в офісі, футуристичний стиль`.
- `platform_block`/`platform` (static_select, R) `📱 Платформа *` — `Instagram, LinkedIn, Corpsite, Print`.
- `artifact_ref_block`/`artifact_ref` (text, R) `📎 Референси стилю (обов'язково)` — placeholder `pinterest.com/... або drive.google.com/...`.

**`ai_dynamic_simple`:**
- `ai_description_block`/`ai_description` (textarea, R) `🤖 Що має бути зображено *` — placeholder `Анімований логотип з появою тексту, стиль мінімалістичний`.
- `platform_block`/`platform` (static_select, R) `📱 Платформа *` — `Instagram, YouTube`.
- `artifact_ref_block`/`artifact_ref` (text, О) `📎 Референси` — placeholder `youtube.com/... або drive.google.com/...`.

**`ai_dynamic_complex`:**
- `ai_description_block`/`ai_description` (textarea, R) `🤖 Що має бути зображено *` — placeholder `Повністю згенерована відеосцена: місто майбутнього, 15 сек, для Instagram`.
- `platform_block`/`platform` (static_select, R) `📱 Платформа *` — `Instagram, YouTube`.
- `artifact_ref_block`/`artifact_ref` (text, R) `📎 Референси стилю (обов'язково)`.

**`landing_template`:**
- `structure_block`/`structure` (textarea, R) `🗂 Структура блоків *` — placeholder `Hero → Про нас → Переваги → Команда → CTA`.
- `slides_text_block`/`slides_text` (textarea, R) `📝 Текст по кожному блоку *` — placeholder `Hero: Заголовок і підзаголовок\nПро нас: ...`.
- `artifact_drive_block`/`artifact_drive` (text, О) `📎 Текст, фото, логотип (Google Drive)` — авто-hint.

**`landing_wow`:**
- `audience_block`/`audience` (text, R) `👥 Ціль і ЦА *` — placeholder `Залучити студентів до стажування, ЦА — 18-25 років`.
- `structure_block`/`structure` (textarea, R) `🗂 Структура *` — placeholder `Hero → Переваги → Програма → Команда → FAQ → CTA`.
- `artifact_ref_block`/`artifact_ref` (text, R) `📎 Референси (обов'язково)` — placeholder `dribbble.com/... або awwwards.com/...`.
- `artifact_drive_block`/`artifact_drive` (text, О) `📎 Текст, фото, логотип, бренд-гайд` — авто-hint.

**`blog`:**
- `artifact_article_block`/`artifact_article` (text, R) `📎 Посилання на статтю / текст *` — placeholder `docs.google.com/... або notion.so/...`; авто-hint.
- `custom_images_block`/`custom_images` (static_select, О) `🖼 Потрібні кастомні картинки в текст?` — `Так, Ні`.
- `artifact_photo_block`/`artifact_photo` (text, О) `📎 Фото для обкладинки` — placeholder `drive.google.com/...`; авто-hint.

**`digest_simple`:**
- `structure_block`/`structure` (textarea, R) `🗂 Структура дайджесту *` — placeholder `Блок 1: новини команди\nБлок 2: вакансії\nБлок 3: події місяця`.
- `slides_text_block`/`slides_text` (textarea, R) `📝 Текст по кожному блоку *` — placeholder `Блок 1: текст...\nБлок 2: текст...`.
- `artifact_drive_block`/`artifact_drive` (text, О) `📎 Фото, логотип (Google Drive)` — авто-hint.

**`digest_wow`:**
- `audience_block`/`audience` (text, R) `👥 Ціль і аудиторія *` — placeholder `Внутрішній дайджест для всіх співробітників`.
- `structure_block`/`structure` (textarea, R) `🗂 Структура *` — placeholder `Обкладинка → Головна новина → Люди місяця → події`.
- `artifact_ref_block`/`artifact_ref` (text, R) `📎 Референси обкладинки (обов'язково)` — placeholder `pinterest.com/... або drive.google.com/...`.
- `artifact_drive_block`/`artifact_drive` (text, О) `📎 Всі тексти, фото, логотип` — авто-hint.

**`email_digest`:**
- `structure_block`/`structure` (textarea, R) `🗂 Структура email *` — placeholder `Заголовок → 3 новини → CTA → Футер`.
- `artifact_drive_block`/`artifact_drive` (text, О) `📎 Тексти, фото (Google Drive)` — авто-hint.

**`merch_simple`:**
- `carrier_block`/`carrier` (text, R) `👕 Тип носія *` — placeholder `футболка / худі / пляшка / шопер`.
- `print_zone_block`/`print_zone` (text, R) `📍 Зони нанесення *` — placeholder `Передня частина по центру, розмір 20×20 см`.
- `artifact_logo_block`/`artifact_logo` (text, О) `📎 Логотип у векторі (AI / SVG)` — авто-hint.

**`merch_ref`:**
- `carrier_block`/`carrier` (text, R) `👕 Тип носія *` — placeholder `футболка / худі / пляшка`.
- `variants_block`/`variants` (text, R) `🔄 Кількість варіантів макетів *` — placeholder `2`.
- `artifact_ref_block`/`artifact_ref` (text, R) `📎 Референси (обов'язково)`.
- `artifact_logo_block`/`artifact_logo` (text, О) `📎 Логотип у векторі` — авто-hint.

**`merch_research`:**
- `carrier_block`/`carrier` (text, R) `👕 Тип носія *` — placeholder `футболка / худі / шопер`.
- `concept_block`/`concept` (textarea, R) `💡 Концепція / меседж *` — placeholder `Мерч для літнього табору, відчуття пригоди і молодості`.
- `restrictions_block`/`restrictions` (text, О) `🚫 Обмеження (кольори, слогани)` — placeholder `Тільки корпоративні кольори, без агресивних принтів`.
- `artifact_brand_block`/`artifact_brand` (text, О) `📎 Бренд-гайд, логотип` — авто-hint.

**`identity`:**
- `brand_name_block`/`brand_name` (text, R) `🏷 Назва бренду *` — placeholder `UniWork — платформа для стажувань`.
- `business_block`/`business` (textarea, R) `🏢 Опис бізнесу / продукту *` — placeholder `Платформа для пошуку стажувань для студентів`.
- `artifact_ref_block`/`artifact_ref` (text, R) `📎 Референси + антиреференси (обов'язково)` — placeholder `pinterest.com/... — що подобається і чому`.
- `target_block`/`target` (text, О) `🎯 ЦА` — placeholder `Студенти 18-25 і HR-менеджери корпорацій`.
- `competitors_block`/`competitors` (text, О) `⚔️ Конкуренти` — placeholder `Work.ua, Rabota.ua, LinkedIn Jobs`.

**`logo`:**
- `brand_name_block`/`brand_name` (text, R) `🏷 Назва *` — placeholder `UniWork`.
- `sphere_block`/`sphere` (text, R) `🏭 Сфера *` — placeholder `EdTech / HR / фінанси / ритейл`.
- `artifact_ref_block`/`artifact_ref` (text, R) `📎 Референси (обов'язково)`.
- `usage_block`/`usage` (text, О) `📍 Де буде використовуватись` — placeholder `соцмережі, сайт, мерч, документи`.

**`photo_simple`:**
- `what_to_fix_block`/`what_to_fix` (textarea, R) `🔧 Що саме прибрати / змінити *` — placeholder `Видалити людину справа, вирізати фон`.
- `artifact_photo_block`/`artifact_photo` (text, R) `📎 Вихідне фото (Google Drive) *` — авто-hint.

**`photo_complex`:**
- `what_to_fix_block`/`what_to_fix` (textarea, R) `🔧 Детальний опис що зробити *` — placeholder `Переодягнути людину в ділове вбрання, замінити фон`.
- `artifact_photo_block`/`artifact_photo` (text, R) `📎 Вихідне фото *` — авто-hint.
- `artifact_ref_block`/`artifact_ref` (text, О) `📎 Референс результату` — placeholder `drive.google.com/... або pinterest.com/...`.

**`tv_announce`:**
- `person_name_block`/`person_name` (text, R) `👤 Ім'я та посада *` — placeholder `Марія Коваль, Product Designer`.
- `event_date_block`/`event_date` (datepicker, R) `📅 Дата події *`.
- `artifact_photo_block`/`artifact_photo` (text, R) `📎 Фото людини (Google Drive) *` — авто-hint.

**`tv_static`:**
- `tv_text_block`/`tv_text` (textarea, R) `📺 Текст *` — placeholder `Лекція «Дизайн-системи» о 18:00 в аудиторії 301`.
- `qr_block`/`qr` (text, О) `🔗 QR-код / посилання` — placeholder `forms.google.com/...`.

**`event_simple`:**
- `event_name_block`/`event_name` (text, R) `🎪 Назва івенту *` — placeholder `TechTalk #12`.
- `location_block`/`location` (text, R) `📍 Локація *` — placeholder `UniHub, вул. Хрещатик 10`.
- `carriers_list_block`/`carriers_list` (text, R) `📋 Перелік носіїв *` — placeholder `афіша A2, екран 1920×1080, Instagram stories`.
- `artifact_drive_block`/`artifact_drive` (text, О) `📎 Текст, логотип, фото` — авто-hint.

**`event_complex`:**
- `event_name_block`/`event_name` (text, R) `🎪 Назва івенту *` — placeholder `Summer Camp 2025`.
- `location_block`/`location` (text, R) `📍 Локація *` — placeholder `Карпати, база відпочинку «Едельвейс»`.
- `carriers_list_block`/`carriers_list` (textarea, R) `📋 Перелік всіх носіїв *` — placeholder `Екран 1920×1080, постер A1, мерч (футболка), сторіс`.
- `artifact_ref_block`/`artifact_ref` (text, R) `📎 Референси (обов'язково)`.
- `artifact_drive_block`/`artifact_drive` (text, О) `📎 Текст, всі фото, логотип, бренд-гайд` — авто-hint.

**Список `MATERIALS_HINT_BLOCK_IDS`** (block_id, яким автоматично додається hint `Будь ласка, перейдіть у таску в ноушин та додайте аттачменти у коментарі`): `artifact_figma_block`, `artifact_drive_block`, `artifact_video_block`, `artifact_music_block`, `artifact_photo_block`, `artifact_logo_block`, `artifact_brand_block`, `artifact_pres_block`, `artifact_article_block`. **Не входять** (тобто без авто-hint): `artifact_ref_block` (жодного разу).

### 7.7 Design — `fieldMapping` і `artifactMapping` (мапи block_id → людський лейбл для body/Description)

`fieldMapping` (`src/handlers/submission.js`, використовується для збирання `specificFields` при сабміті — точні лейбли, з якими значення потраплять у `Description`/секцію "СПЕЦИФІЧНІ ПОЛЯ"):

```
size_block → 📐 Розміри
print_size_block → 📐 Розміри
message_block → 💬 Ключове повідомлення
accent_block → 🎯 Основний акцент
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
new_blocks_block → ➕ Нові блоки
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
character_block → 🎭 Характер івенту
carriers_list_block → 📋 Перелік носіїв
slide_list_block → 📋 Перелік слайдів для правок
can_shorten_block → ✂️ Можна скорочувати текст
vacancy_block → 💼 Назва вакансії та умови
formats_list_block → 📐 Перелік форматів
promo_desc_block → 💡 Опис задачі
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

⚠️ Мапа містить block_id (`accent_block`, `new_blocks_block`, `character_block`, `vacancy_block`, `promo_desc_block`), яких **немає в жодному актуальному `specificBlocks[...]`** — це "мертві" записи мапи, що лишились від попередніх версій форм/типів задач, які вже видалені або перейменовані. Вони нешкідливі (просто ніколи не спрацьовують), але при переносі не варто плутати їх із реальними полями.

`artifactMapping` (мапа block_id → лейбл для секції "АРТЕФАКТИ" у `Description`):

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

Джерело: `src/notion/createPage.js`, `createSubitem.js`, `richText.js`, `pageUrl.js`, `taskConfig.js`.

### 8.1 Створення сторінки (`createNotionPage`)

Порядок дій (кожен виклик Notion API йде через `notionRequest` throttle/retry-wrapper):

1. `getDatabaseProperties(department)` — `notion.databases.retrieve({database_id})`, кешується (Map по `databaseId`, промис, інвалідується при помилці або при `ensureSelectOptionsExist`).
2. `resolveTitlePropertyName` — шукає властивість `Name` типу `title`; якщо немає — перше property з `type === 'title'`. Якщо взагалі немає жодного title property → **throw** `'Notion database is missing a title property for task name.'`.
3. `resolveStatusPropertyName` (з `taskConfig.js`) — див. 8.1.1 нижче.
4. Властивість-title: `{[titlePropertyName]: {title: [{text: {content: clampText(name)}}]}}` (обрізка `clampText` = 2000 символів; якщо порожньо — `'Untitled'`).
5. Статус: `resolveStatusValue(databaseProperties, statusPropertyName, department.initialStatus || 'To do')` — якщо тип властивості `select`/`status` і список опцій бази **не містить** бажаного значення — фолбек на опцію `'to do'` (case-insensitive) або першу доступну опцію (з попередженням у лог). Пишеться через `addPropertyByDatabaseType` (авто-детект типу властивості: `checkbox`/`rich_text`/`url`/`select`/`multi_select`/`date`/`number`/`status`).
6. Якщо `department.key === 'design'` — `Design needed` checkbox → `true` (тільки якщо властивість існує і типу checkbox).
7. `department.defaultProperties` (SMM: `SMM needed`, `SMM briefed`; Event: `Event needed`, `Event briefed`, `Brief received: false`) — записуються, якщо властивість існує (тип автоматично визначається).
8. `taskConfig.defaultProperties` (з конфігу типу задачі — `Format`, `EB Activity Type`, `Complexity` тощо) — записуються так само.
9. `Team` (select) = `department.team`, тільки якщо властивість існує і select.
10. `domain` (лише якщо переданий, тільки Design-флоу): `ensureSelectOptionsExist(department, databaseProperties, 'domain', domain)` — якщо значення домену відсутнє серед опцій select/multi_select властивості `domain` — Notion database schema **оновлюється** (`notion.databases.update`) додаванням нової опції, потім `domain` пишеться. Властивість — саме нижній регістр `domain` (реальна назва в Activities database, як зазначено в коментарі скрипта `testDomainWrite.js`).
11. **Owner / Slack Person matching**: `resolveNotionUserId({email: slackPersonEmail, names: [slackPersonName]})` — кешований (module-scope Promise) повний список `notion.users.list()` (пагінація по 100), фільтр `type === 'person'`; спочатку шукає **точний match по email** (case-insensitive, trimmed); якщо email не задано/не знайдено — шукає **унікальний** match по нормалізованому display name (lowercase, згорнуті пробіли) — якщо кілька людей мають однакове ім'я, збіг **не** береться (щоб не помилитись). `ownerId = requesterNotionUserId || department.ownerId` (department default owner, якщо requester не знайдений) → пишеться в `Owner` (тільки якщо тип `people`).
12. `Priority` (select) — якщо передано (тільки Design).
13. `Deadline` (date) — якщо передано.
14. `Late` (будь-який тип, авто-детект) = `true`, якщо `isLate`.
15. **Platform(s)**: `platformSource = platforms.length ? platforms : (taskConfig.defaultPlatforms.length ? taskConfig.defaultPlatforms : [resolvePlatform(platform)].filter(Boolean))`, кожне значення проганяється через `resolvePlatform` (по суті no-op — мапа `PLATFORM_MAP` містить лише `{Meta: 'Meta'}`, і `'Other'` → `null`). Пишеться спершу в `Platforms`, якщо немає — в `Platform` (обидва як multi/select, авто-детект через `addPropertyByDatabaseType`); якщо жодна з двох назв не підійшла типом — прямий fallback: `Platform` (select) = перше значення.
16. **Task Type**: якщо є `taskTypeRelationId` (тільки Design) → `Task Type` (relation) = `[{id: relationId}]`. Інакше — `addPropertyByDatabaseType` пробує `Task Type` → `Request type` → `Type` (текстове значення = `taskConfig.label || taskType`).
17. Для кожного `field` з `fieldAnswers` (SMM/Event) — пишеться в кожну з `field.notionProperties` (перше, що підійде типом); значення — `field.formattedValue` для `slack_user`-полів, інакше `field.value` (raw, не formatted — важливо: наприклад дата пишеться як raw ISO string, чекбокс як raw boolean).
18. Якщо `getTestTaskPrefix()` заданий — `Test` checkbox = `true`, і `Tags`/`Tag` (multi_select/select) = `'Test'` (авто-детект типу).
19. **Slack Person** — окрема властивість `'Slack Person'` (не плутати з `Owner`!): `buildSlackPersonProperty(databaseProperties['Slack Person'], {slackPersonName, notionUserId})` — підтримує 4 типи: `people` (пише `notionUserId`, якщо він резолвнувся — інакше `null`, властивість пропускається), `title`/`rich_text`/`select` (пише `slackPersonName` як текст, обрізаний до 2000/100 символів відповідно).
20. **Unmatched requester note**: якщо `Slack Person` — тип `people`, і requester **не** знайдений у Notion users (`requesterNotionUserId` = null), і є хоч ім'я або email — після створення сторінки в body додається окремий параграф: `` `⚠️ Slack requester not matched to a Notion account: ${slackPersonName || '—'} (${slackPersonEmail || 'email unknown'})` `` (англійською, навмисно техноозна нотатка для тріажу).
21. `Description` (rich_text) — див. 8.2 нижче — пишеться, тільки якщо непорожній рядок і властивість існує/rich_text.
22. `notion.pages.create({parent: {database_id}, properties})`.
23. **Template apply** (`applyTemplateToPage`): якщо `department.notionTemplateId` заданий — окремий Notion client з `notionVersion: '2026-03-11'` виконує `PATCH /pages/{id}` з `{template: {type: 'template_id', template_id, timezone: NOTION_TEMPLATE_TIMEZONE || 'Europe/Kiev'}, erase_content: true}`. Це асинхронно застосовує Notion page template (корисно, якщо в темплейті вже є нативна кнопка "Add subtask" чи інші елементи).
24. **Restore after template**: застосування темплейту "стирає" контент і може перезаписати `Owner`/`Slack Person`, якщо в самому темплейті ці властивості порожні — тому одразу після успішного apply бот повторно `pages.update()` тими самими значеннями `Owner`/`Slack Person`, які були встановлені на кроці 11/19 (якщо вони були непорожні).
25. **Append brief body blocks** (`appendBriefBodyBlocks`) — лише для `department.useBodyBrief` (SMM, Event) — див. 8.2.
26. Повертає `{pageId, pageUrl, templateApplied}`.

### 8.1.1 Резолюція назви властивості статусу (`resolveStatusPropertyName`, `getStatusPropertyNames` — `taskConfig.js`)

```js
DEFAULT_STATUS_PROPERTY = 'Design Status'
LEGACY_STATUS_PROPERTY = 'Status'
```
Порядок кандидатів (без дублікатів):
1. `department.statusProperty` (сконфігурований env, з фолбеками з розділу 5).
2. Якщо `department.key === 'design'` → `['Design Status', 'Status']`; інакше → `['Status', 'Design Status']`.
Перше ім'я з цього списку, чия властивість у реальній Notion-схемі має тип `status` або `select`, вважається справжньою "статусною" властивістю. Якщо жодна не підходить — використовується `department.statusProperty` або `'Design Status'` як текстовий фолбек (запис все одно спрацює, якщо `addPropertyByDatabaseType` знайде відповідний тип).

### 8.2 Тіло сторінки (body blocks) — `Description` vs body brief

- Для департаментів **без** `useBodyBrief` (Design): `Description` (rich_text властивість) містить повний людський бриф:
  - `📌 Повна назва: {fullName}` (лише якщо назва була обрізана `clampText`)
  - `📌 Контекст: {context}`
  - `🎨 Стиль/Референси: {style}`
  - `🚫 Антиреференси: {antiref}`
  - `✏️ Дизайнер може правити текст: {canEditText}`
  - `📱 Platform (other): {platformOther}`
  - `\n— СПЕЦИФІЧНІ ПОЛЯ —` + `{label}: {value}` для кожного специфічного поля (з `fieldMapping`, розділ 7.7) — **або**, якщо `specificFields` порожній, а є `fieldAnswers` — `\n— ПОЛЯ БРИФУ —` + `{label}: {formattedValue}` (fallback-гілка, фактично для non-Design коду, хоча ця функція викликається завжди — гілка `fieldAnswers` активна тільки якщо `specificFields` не заповнений).
  - `\n— АРТЕФАКТИ —` + `📎 {label}: {value}` для кожного артефакту.
- Для департаментів **з** `useBodyBrief` (SMM, Event): `Description` = буквально рядок `'Опис нижче в тілі задачі.'`. Натомість у **тілі сторінки** (page content blocks, через `notion.blocks.children.append`, батчами по 100 блоків) додається:
  1. `heading_2`: `` `Бриф ${department.label}` `` (напр. "Бриф SMM").
  2. `paragraph`: `` `Тип задачі: ${taskConfig.label || taskConfig.key || 'не вказано'}` ``.
  3. Якщо є поля з `section === 'base'` (`fieldAnswers.filter(f => f.section === 'base')`) → `heading_3` `'Базові поля'` + bulleted list `{label}: {formattedValue}` для кожного.
  4. Якщо є поля з `section === 'specific'` (все, що не `base`) → `heading_3` `'Специфічні поля'` + bulleted list.
  5. Якщо є artifacts → `heading_3` `'Матеріали'` + bulleted list `{label}: {value}`.

`buildRichText()` (`richText.js`) — конвертує plain-текст у Notion rich_text array з автоматичним розпізнаванням URL (regex — підтримує `http(s)://` і "схожі на домен" рядки без протоколу, автододає `https://`), розбиває на об'єкти лімітом 2000 символів кожен (`RICH_TEXT_CONTENT_LIMIT`), максимум 100 rich-text-об'єктів (`RICH_TEXT_OBJECT_LIMIT`); при перевищенні — обрізає джерело і додає нотатку `'\n\n[Обрізано: Notion має ліміт на довжину rich text поля.]'`.

### 8.3 Sub-item / feedback-round сторінки (`createFeedbackSubitem`, `createSubitem.js`)

- Назва: `` `Правка ${roundNumber} — ${taskName}` `` (title, обрізано до 1000 символів вхідного `taskName`).
- `[PARENT_ITEM_PROPERTY]` (relation, default `'Parent item'`, env `NOTION_PARENT_ITEM_PROPERTY`) = `[{id: parentPageId}]`.
- `[SUB_TYPE_PROPERTY]` (select, default `'Sub-type'`, env `NOTION_SUB_TYPE_PROPERTY`) = `{select: {name: FEEDBACK_SUB_TYPE}}`, `FEEDBACK_SUB_TYPE` — env `NOTION_FEEDBACK_SUB_TYPE`, default `'правка'`.
- **Копіювання властивостей з батьківської сторінки** (`COPIED_PARENT_PROPERTIES` = `['Team', 'Priority', 'Deadline', 'Task Type', 'Designer', 'Slack Person', 'Final project']`) — тільки якщо властивість з такою ж назвою й типом (select/multi_select/date/relation/people/rich_text/url) існує в цільовій базі, і значення на батьківській сторінці непорожнє.
- `Owner` (people) — окремо: `addDesignerOwner` бере `Designer`/`Дизайнер` people з батьківської сторінки (fallback на `Owner` батьківської, якщо `Designer` порожній).
- `[FEEDBACK_TYPE_PROPERTY]` (default `'Тип правки'`, env `NOTION_FEEDBACK_TYPE_PROPERTY`) — пишеться, якщо властивість існує (підтримує типи `select`/`status`/`multi_select`/`rich_text`), значення = лейбл вибраної опції фідбек-типу (`"Об'єктивна"` або `"Суб'єктивна"`, розділ 11).
- `[DESCRIPTION_PROPERTY]` (default `'Description'`, env `NOTION_DESCRIPTION_PROPERTY`) — rich_text = текст правки (`buildRichText(feedbackText, {emptyText: ' '})` — якщо текст порожній, пишеться пробіл, щоб властивість не лишалась `null`).
- Статус (через `resolveStatusPropertyName`) — якщо тип `status` → `DEFAULT_STATUS` (`'To do'`).
- Створюється **без** template apply, **без** brief body blocks — це просте page create.
- Повертає `{pageId, pageUrl, taskName, initialStatus: 'To do', finalProjectUrl: parentProperties['Final project']?.url || null, designer}` (`designer` резолвиться через `extractDesignerFromProperties` — розділ 8.4).

### 8.4 Резолюція "дизайнера" (`src/notion/designer.js`)

`extractDesignerFromProperties(properties, notion)` шукає властивість `Designer` **або** `Дизайнер` (кирилична назва — Legacy design database), підтримує 4 типи:
- `people` → `{name: join(', '), userId: перший person.id, email: перший person.person?.email}`.
- `relation` → для кожної relation-сторінки: `notion.pages.retrieve` (кешується в module-scope `Map`), витягує title/email(-шукає властивість `type==='email'` або email-подібний текст в будь-якій властивості)/slackId (шукає в `['Slack ID','Slack User ID','Slack user id','Slack','SlackId']`, валідує regex `^[UW][A-Z0-9]+$`), об'єднує кількох дизайнерів через кому.
- `title`/`rich_text` → просто текст.
- `select` → `{name: select.name}`.

### 8.5 Побудова публічного URL задачі (`buildTaskPageUrl`, `pageUrl.js`)

Якщо в департаменту є `hubUrl` — URL будується як `${hubUrl}?p={normalizedPageId}&pm=s` (`p`/`pm=s` — Notion-специфічний механізм відкриття database item "всередині" вказаної hub-сторінки, замість прямого лінку на сторінку). `normalizedPageId` = pageId без дефісів. Якщо `hubUrl` не заданий/невалідний — фолбек на прямий лінк `https://www.notion.so/{normalizedPageId}` або на `response.url` з Notion API.

---

## 9. Redis — модель даних

Джерело: `src/redis/store.js`. Клієнт: `@upstash/redis` (`Redis({url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN})`) — REST-based, не звичайний TCP протокол; ключова відмінність для перенесення — якщо унікальний бот вже має власний Redis-клієнт (наприклад TCP `ioredis`), логіку доведеться портувати, зберігаючи ті самі команди (`GET`/`SET`/`DEL`/`ZADD`/`ZRANGE ... BYSCORE`/`ZREM`/`ZSCORE`/`KEYS`).

`REDIS_KEY_PREFIX` (env, default `''`) — префіксується **до кожного** ключа через `redisKey(key) = \`${REDIS_KEY_PREFIX}${key}\``, дозволяючи повний sandbox-namespace (наприклад `test:`) в тому самому Redis instance.

### 9.1 Ключі і їхня форма

| Ключ (шаблон, до префіксу) | Тип Redis | Призначення |
|---|---|---|
| `notion:<pageId>` | STRING (JSON) | Основний трекінг-запис задачі (розділ 9.2) |
| `task-submission-queue` | ZSET | Черга сабмітів: member=queueId, score=timestamp виконання |
| `task-submission-queue-item:<id>` | STRING (JSON) | Повний payload одного елемента черги |
| `failed-submission:<draftId>` | STRING (JSON), TTL=`FAILED_SUBMISSION_TTL_SECONDS` (default 2592000 = 30 днів) | Чернетка невдалого сабміту |
| `feedback:<pageId>` | STRING (JSON) | Quality-feedback запис (survey sent / submitted) |
| `slack-thread-comment-sync:<syncId>` | STRING (timestamp), TTL=7 днів, `nx: true` | Ідемпотентний claim для синку Slack→Notion коментаря (не дає обробити один і той самий Slack event двічі) |
| `notion-launch:<parentTaskId>` | STRING (JSON) | Launch-context з Notion automation webhook |

### 9.2 Форма запису задачі (`notion:<pageId>`, `saveTask`/оновлення)

```json
{
  "departmentKey": "design | smm | event (resolveDepartmentKey — незнайомий/відсутній key → 'design')",
  "slackUserId": "U...",
  "slackChannelId": "...",
  "slackMessageTs": "1234.5678 | null",
  "slackThreadTs": "той же ts, якщо не задано окремо | null",
  "taskName": "...",
  "requesterName": "... | null",
  "taskKind": "task | feedback",
  "parentPageId": "... | null (для taskKind=feedback — id батьківської задачі)",
  "pageUrl": "...",
  "team": "...",
  "hub": "... (department.label)",
  "requestType": "... (taskTypeLabel)",
  "lastStatus": "To do (за замовчуванням при saveTask)",
  "lastAssignee": null,
  "lastDesignerName": null,
  "lastDesignerUserId": null,
  "lastDeadline": null,
  "lastFinalProjectUrl": null,
  "snapshotInitialized": false,
  "trackedAt": "ISO timestamp",
  "lastCommentId": null,
  "lastCommentCreatedTime": "той самий ISO timestamp, що trackedAt (щоб перший поллінг коментарів не вважав ВСІ існуючі коментарі 'новими')",
  "roundsCount": 0
}
```

Додаткові поля, які дописуються поверх (через `updateTaskSnapshot`/`updateStatus`/`updateLastComment`/`incrementRoundsCount` — всі роблять `GET` → merge → `SET`, без Redis-транзакцій/optimistic locking, тому теоретично можлива втрата конкурентних записів, якщо два процеси пишуть одночасно — прийнятно для одного worker-процесу):

- `lastSnapshotPollAt`, `lastCommentPollAt` — ISO timestamps останнього поллінгу (для батчингу — розділ 10).
- `fallbackStatusNotifiedFor`, `fallbackStatusNotifiedAt`, `missingThreadRestoreAttemptedFor`, `missingThreadRestoreAttemptedAt`, `threadRestoredAt` — стан "recovery" механізму для задач без Slack-треду (розділ 10).
- `feedbackSurveySentAt`, `feedbackRating`, `feedbackSubmittedAt` — дублікати даних з `feedback:<pageId>` для швидкого доступу без другого GET.

### 9.3 `getAllTasks()` 

`redis.keys(redisKey('notion:*'))` (⚠️ `KEYS` — O(n) блокуюча команда в звичайному Redis; Upstash REST API це абстрагує, але при масштабуванні кількості трекованих задач варто розглянути `SCAN`/індекс-set замість `KEYS`, якщо мігрується на інший Redis-клієнт) → `GET` кожного ключа → парсинг JSON → `pageId` витягується зі stripped ключа (`stripRedisKeyPrefix(key).replace('notion:', '')`).

### 9.4 Черга сабмітів — деталі структур

- `enqueueTaskSubmission(payload, {delayMs, queueId})`: `id = queueId || \`queued-${now}-${random}\``, `item = {id, createdAt, nextAttemptAt, attempts: payload.attempts||0, payload}`, `SET task-submission-queue-item:<id>` (з тим самим TTL-механізмом, що й failed-submission — тобто елементи черги також автоматично зникнуть після `FAILED_SUBMISSION_TTL_SECONDS`, якщо worker довго не забере item, — ⚠️ це може бути неочікуваним побічним ефектом, розділ 17), `ZADD task-submission-queue score=now+delayMs member=id`.
- `getDueTaskSubmission(now)`: `ZRANGE task-submission-queue 0 now BYSCORE OFFSET 0 COUNT 1` → бере перший id → `ZREM` (якщо `removed === 0`, тобто хтось інший вже забрав — повертає `null`, це базовий anti-double-processing механізм) → `GET` відповідного item-ключа.
- `recoverOrphanedTaskSubmissions`: скан всіх `task-submission-queue-item:*`, для кожного без відповідного `ZSCORE` в ZSET (і не в `excludeIds`) — повертає в ZSET.

### 9.5 Quality feedback (`feedback:<pageId>`)

`markFeedbackSurveySent(...)` записує/оновлює: `{pageId, departmentKey, slackUserId, taskName, requesterName, requestUrl, team, hub, requestType, completedAt, feedbackSurveySentAt}` — ідемпотентно (`if (existing.feedbackSurveySentAt) return {alreadySent: true}`), + дублює `feedbackSurveySentAt` в основний `notion:<pageId>` запис (якщо він ще існує).

`saveQualityFeedback(...)` перезаписує той самий ключ, додаючи `rating`, `comment`, `categories` (array), `feedbackSubmittedAt` — і теж дублює у `notion:<pageId>` (`feedbackRating`, `feedbackSubmittedAt`).

### 9.6 Slack thread ↔ page matching (`getTaskBySlackThread`)

Проходить по **всіх** трекованих задачах (`getAllTasks()` — немає індексу за threadTs, тобто O(n) на кожен вхідний Slack DM-reply), шукає збіг за `isSameThread`: `normalizeThreadValue(task.slackThreadTs || task.slackMessageTs) === threadTs` **AND** `task.slackChannelId === channelId OR task.slackChannelId === slackUserId`. Серед знайдених — пріоритет тому, чий `slackMessageTs === threadTs` (тобто кореневе повідомлення, а не sub-thread reply-в-reply); інакше — перший знайдений.

### 9.7 Launch context (`notion-launch:<parentTaskId>`)

`{parentTaskId, parentPageName, payload (весь необроблений webhook body), createdAt}`. **Ніде в коді не зчитується назад** (`getLaunchContext` є, але не викликається жодним обробником) — це, ймовірно, заготовка/half-built інтеграція для майбутнього "launch design task from Notion button" флоу (⚠️ Потребує перевірки — при перенесенні варто уточнити бізнес-намір цього webhook, бо на сьогодні дані лише зберігаються, ефекту не мають).

---

## 10. Notion-поллінг (`pollStatus.js`) — детальний опис

### 10.1 Планування циклів

`startPolling(slackClient)` — для кожного активного департаменту (`getAllDepartments()`): `intervalMs = max(department.pollIntervalSec || 180, 1) * 1000`; перший запуск — через `intervalMs + index * POLLING_STARTUP_STAGGER_MS` (default 10с), де `index` — порядковий номер департаменту в `Object.values(departments)` (стабільний, бо `departments` — звичайний об'єкт, порядок ключів: `design, smm, event`). Далі — звичайний `setInterval` кожні `intervalMs`.

Кожен tick кладе департамент у `pollingQueue` (`enqueuePollingCycle`) — але тільки якщо він ще не в черзі й не виконується (`queuedPollingDepartmentKeys`/`pollingInProgressByDepartment`), інакше — просто лог-попередження, цикл **пропускається** (не накопичується). `drainPollingQueue` — послідовний runner (`while queue.length`), тобто цикли різних департаментів **виконуються послідовно**, не паралельно (хоч і в одному event loop process, це просто гарантує упорядкованість викликів Notion API).

### 10.2 Один цикл (`runPollingCycle(slackClient, department)`)

1. Global rate-limit pause check: якщо `Date.now() < pollingPausedUntil` — весь цикл пропускається (лог).
2. `getAllTasks()` → фільтр `resolveDepartmentKey(task.departmentKey) === department.key` (тобто трек-записи без `departmentKey` **завжди** мапляться на `'design'` — legacy сумісність).
3. Для кожної задачі, у якої `lastStatus` вже вважається completed (`isCompletedStatus`, дивись 10.3) — одразу `stopPollingCompletedTask` (без нового читання з Notion!) — це "прибирання застряглих" задач, які мали б бути видалені раніше, але процес впав.
4. Для решти ("active") — `selectTasksForPolling`: якщo їх більше `NOTION_POLL_TASK_BATCH_SIZE` (default 25), береться підмножина, відсортована за найдавнішим `lastSnapshotPollAt`/`trackedAt` (найдовше не опитувані — пріоритет). Це **захист від перевантаження** Notion API, коли трекованих задач дуже багато — за один цикл гарантовано опитується не більше 25 (решта — наступного разу).
5. `getCurrentTaskSnapshots(department, tasksToPoll)`: для кожного унікального `pageId` — `notion.pages.retrieve` (якщо сторінка недоступна: `object_not_found`/`restricted_resource`/403/404 → трек-запис видаляється з Redis і пропускається, без падіння циклу). Знімок: `{pageId, status, assignee (з Owner people), designer (extractDesignerFromProperties), deadline, finalProjectUrl (властивість 'Final project', тип url), parentPageIds (relation 'Parent item')}`.
6. Якщо `department.supportsFeedbackRounds` (Design) — додатково для кожної **батьківської** (не feedback) задачі, чий поточний знімок статусу = "Comments" (`isCommentsStatus`), робиться `databases.query` по `Parent item` relation (`contains: parentPageId`), і знімки дочірніх feedback-задач домішуються в загальний `currentTasks` map — потрібно, щоб `canAcceptTaskResult` (readiness-перевірка) бачила актуальні статуси всіх sub-items, навіть якщо вони не є окремо трекованими Redis-записами (хоча на практиці вони теж трекуються через `saveTask` у `feedbackSubmission.js`).
7. Для кожної задачі з `tasksToPoll`:
   - Якщо в поточному знімку немає `status` — пропуск (Notion повернув сторінку без розпізнаного статусу — можливо властивість перейменована).
   - **Немає `task.lastStatus`** (тобто попереднього значення взагалі нема — це можливо, якщо старий Redis-запис зберігався без цього поля) → якщо новий статус вже completed — одразу `stopPollingCompletedTask`; інакше — `refreshRootTaskMessage` (перерендер кореневого Slack-повідомлення, без окремого DM про "зміну статусу") + checkpoint.
   - **Статус змінився** (`currentTask.status !== task.lastStatus`):
     - Якщо зміна лише в регістрі (`normalizeStatusName` рівні) — checkpoint без нотифікації, лог `"Status casing normalized without notification"` (⚠️ явно продокументований у rollout-checklist кейс: `To do → to do` не має тригерити Slack-сповіщення).
     - Інакше — `sendStatusUpdate()` (розділ 10.4) → якщо новий статус completed → `stopPollingCompletedTask`, інакше checkpoint зі status snapshot.
   - **Статус той самий, але `snapshotInitialized` ще не true** (перший прогон після додавання трекінгу) → `refreshRootTaskMessage` + checkpoint (без DM-нотифікації, лише оновлення кореневого повідомлення).
   - **Інакше** — перевірка "польових" змін (`getTrackedFieldChanges`): зміна "Відповідальний" (composite key з designer.name/userId/assignee) або зміна "Фінальний проєкт" (URL, нормалізований). Якщо є зміни:
     - Обчислюється `shouldSendReviewRequest` = `finalProjectChanged && isCommentsStatus(status) && normalizeTrackedUrl(finalProjectUrl) truthy && roundsCount === 0` (тобто "запит на рев'ю" шле спеціальне сповіщення тільки якщо це **перший** раз, коли з'явився фінальний проєкт при статусі Comments, і ще не було жодного раунду правок).
     - Якщо `shouldSendReviewRequest` — `finalProject`-зміна виключається зі звичайних `sendTaskFieldUpdate` і замість неї викликається `sendReviewRequest` (окремий текст "Результат оновлено для ревʼю").
     - Решта польових змін (якщо є, напр. тільки "Відповідальний") — `sendTaskFieldUpdate`.
   - `shouldSendMissingThreadStatusRecovery` (розділ 10.5) — окрема перевірка "чи задача взагалі має Slack-тред" — якщо ні, і статус не initial/не completed, і recovery ще не спрацював для цього статусу — `sendMissingThreadStatusRecovery`.
   - Якщо задача не completed, не feedback, статус = Comments, і жодне з попередніх гілок не оновило кореневе повідомлення (`!rootMessageRefreshed`) — примусовий `refreshRootTaskMessage` (гарантує, що кнопки прийняття/правок завжди актуальні при статусі Comments, навіть якщо нічого не "змінилось" формально).
   - Якщо completed — `stopPollingCompletedTask` + `continue`.
   - Якщо жоден checkpoint ще не робився в цій ітерації — `checkpointTaskPolled` (оновлює тільки `lastSnapshotPollAt`, для `selectTasksForPolling` пріоритезації).
   - **Коментарі**: `shouldPollComments(task, commentPollsThisCycle)` — не частіше ніж раз на `NOTION_COMMENT_POLL_INTERVAL_MS` (default 15 хв) на задачу, і не більше `NOTION_MAX_COMMENT_POLLS_PER_CYCLE` (default 8) задач за один цикл поллінгу статусів (додатковий throttle специфічно для дорожчого `comments.list` запиту). Якщо дозволено:
     - `getOpenComments(pageId)` — `notion.comments.list({block_id: pageId})`, пагінація. Якщо Notion повертає `restricted_resource`/403 — **глобально** (module-scope `commentPollingEnabled = false`) вимикає коментар-поллінг на решту життя процесу з попередженням про потрібну capability `Read comments`.
     - Якщо `!task.lastCommentId && !task.lastCommentCreatedTime` — перший прогін: просто checkpoint останнього коментаря без надсилання (щоб не "засипати" Slack усіма старими коментарями одночасно).
     - `getNewComments` — або по індексу `lastCommentId` в поточному масиві (точніше), або по `Date.parse(createdTime) > lastCommentCreatedTime` (fallback, якщо збережений id вже не знайдений — сторінка/коментар видалені).
     - Для кожного нового коментаря: якщо це "mirror"-коментар (текст починається з `slack thread ·`, case-insensitive) — лише checkpoint, **без** відправки в Slack (антипетля, розділ 12).
     - Інакше — `sendCommentUpdate()` + checkpoint.
     - Якщо під час `comments.list` стався rate limit — `pausePollingAfterRateLimit` + `break` з циклу коментарів (не всього циклу задач).

### 10.3 Логіка "completed"/"quality survey" статусів

```js
isCompletedStatus(status, department):
  normalized включає одне з completedStatusNames (з CSV env) 
  OR normalized.includes('cancel') OR includes('скас') OR includes('done')
```
(тобто навіть якщо адміністратор забуде додати кастомний статус у `completedStatuses`, будь-який статус що містить "cancel"/"скас"/"done" **автоматично** вважається завершеним — це запасний механізм, важливий нюанс: статус, що випадково містить підрядок "done" (напр. кастомний "Done-review"), теж зупинить поллінг).

```js
isQualitySurveyStatus(status, department):
  normalized включає одне з qualitySurveyStatusNames (CSV env)
  OR (список порожній І normalized включає 'ready'/'реді')
```
Тобто для Event, де `qualitySurveyStatuses` за замовчуванням порожній масив — спрацює фолбек "будь-який статус, що містить ready/реді", доки явно не задати `NOTION_EVENT_QUALITY_SURVEY_STATUSES`.

`shouldSendQualitySurvey` — додатково: `task.taskKind !== 'feedback'` (sub-items ніколи не отримують окремий survey).

### 10.4 `sendStatusUpdate` — що саме відправляється

Дві дії одночасно:
1. `updateRootTaskMessage` — **редагує** (не надсилає нове) кореневе Slack-повідомлення задачі (`chat.update` по `slackChannelId`/`slackMessageTs`, з фолбеком на інші резолвлені канали, якщо основний недоступний — `channel_not_found`/`not_in_channel`/`is_archived`). Повний текст і кнопки перебудовуються з нуля (розділ 8/13 логіки `notify.js`, докладний опис нижче).
2. `postThreadStatusMovement` — **новий** коротший пост у той самий тред (`{mention} *Є рух по задачі* 🔄\n*Статус:* {old} → {new}`), з `<@userId>` mention на початку, якщо `slackUserId` заданий.

### 10.5 "Missing thread" recovery mechanism

Якщо задача трекується (`slackUserId` присутній), але **немає** Slack-треду (`slackChannelId`/`slackMessageTs` відсутні — можливо, через збій на етапі `createTaskFromSubmissionPayload`, коли `chat.postMessage` не вдався, але `saveTask` пройшов), і статус — не initial ("to do"/"todo"/"ту ду" або = `department.initialStatus`) і не completed:
- `tryRestoreMissingSlackThread`: відкриває DM-історію користувача (`conversations.open` + `conversations.history`, до 10 сторінок по 200 повідомлень), шукає повідомлення від бота, текст якого містить назву задачі (case/whitespace-insensitive) і одну з фраз `"задача створена"`/`"ми отримали твій запит"`/`"твій запит прийнято"` **і не** є попереднім fallback-повідомленням (`isFallbackStatusRecoveryMessage` — виключає повідомлення, що вже містять "є рух по задачі" + "статус", щоб не сплутати одне fallback-повідомлення з іншим).
- Якщо знайдено — відновлює `slackChannelId`/`slackMessageTs`/`slackThreadTs` у Redis і надсилає повний `sendStatusUpdate` вже в цей відновлений тред.
- Якщо не знайдено — усе одно позначає спробу зробленою (`missingThreadRestoreAttemptedFor`), щоби не намагатись щоразу; DM все одно надсилається (нетредований fallback), позначений як "restored"/"fallback" в логах.

### 10.6 Rate-limit і retry (розділені на 2 рівні)

1. **`notionRequest` (`request.js`)** — застосовується до **кожного** окремого Notion API виклику у всьому проєкті (createPage, poll, comments, тощо). Внутрішня послідовна черга-Promise (`queue = queue.then(...)`) гарантує мінімальний інтервал `NOTION_REQUEST_MIN_INTERVAL_MS` (default 1000мс) між **послідовними** запитами (глобально на процес, не per-department!). При 429 — до `NOTION_REQUEST_MAX_RETRIES` (default 4) повторів, delay = `Retry-After` header (якщо є) або `1500 * 2^attempt` (капується 30000мс).
2. **Poll-cycle level pause (`pollStatus.js`)** — якщо rate limit стався під час самого циклу поллінгу (за межами внутрішніх `notionRequest`-ретраїв, тобто після їх виснаження) — `pausePollingAfterRateLimit`: `pollingPausedUntil = now + cooldownMs`, де `cooldownMs = max(Retry-After*1000, NOTION_POLL_RATE_LIMIT_COOLDOWN_MS)` (default 10 хв). Це **глобальна** пауза (не per-department) — весь `runPollingCycle` для будь-якого департаменту буде скіпатись, доки `Date.now() < pollingPausedUntil`.

---

## 11. Feedback rounds (правки) — тільки Design

### 11.1 Поява кнопки

Коли статус кореневої задачі = `Comments` і `department.key === 'design'` (`getStatusActionElements` у `notify.js`), під кореневим Slack-повідомленням з'являються (у порядку):
1. `"✅ Приймаю, правок немає"` (0 попередніх раундів) або `"✅ Приймаю, більше правок немає"` (≥1 раунд) — `action_id: accept_task_result`, style `primary`, значення = JSON `{pageId, taskName, departmentKey, designerName, designerUserId, designerEmail, requestUrl, resultUrl, rootMessageTs, taskKind, completedRounds}` — **тільки якщо** `canAcceptResult` (розраховується `canAcceptTaskResult` — усі дочірні feedback-задачі мають бути в acceptable статусі, розділ 8.4/`taskAcceptanceReadiness.js`).
2. `"✏️ Дати правки"` — `action_id: open_feedback_modal`, style `primary`, значення = JSON `{pageId, taskName, roundNumber}` (`roundNumber` = `completedRounds+1`, тобто номер наступного раунду).
3. `"📋 Відкрити задачу"` (лінк).
4. `"🔗 Відкрити результат"` (лінк на `Final project`, якщо є).

Якщо задача сама є feedback sub-item (`taskKind === 'feedback'`) і в Comments — показуються лише "✅ Прийняти правку" (за наявності `canAcceptResult`), "📋 Відкрити правку", "🔗 Відкрити результат" (без кнопки нової правки — на sub-item не можна створити sub-sub-item).

### 11.2 Модалка `feedback_submission` (`feedbackModal.js`)

Title: `` `Правка #${roundNumber}` ``, submit `"Надіслати правки"`, close `"Скасувати"`. `private_metadata = {pageId, taskName, roundNumber, sourceChannelId, sourceMessageTs}` (координати повідомлення, з якого натиснута кнопка — потрібні, щоб коректно "закрити" саме те повідомлення після сабміту, розділ 11.4). Блоки:
1. `section`: `` `*Задача:* ${taskName}\n*Раунд правок:* ${roundNumber}` ``.
2. `section` (статичний текст): `Перед відправкою перевір, чи ця правка допоможе бізнес-результату: конверсії, клікам, довірі, зрозумілості або швидшому рішенню користувача. Якщо зміна радше про смак чи нове бачення, познач її як субʼєктивну.`
3. `input` `feedback_type` → `radio_buttons` `feedback_type_input`, опції:
   - `"Об'єктивна"` (value `objective`), description: `Є відхилення від ТЗ, формату, факту або вимоги.`
   - `"Суб'єктивна"` (value `subjective`), description: `Не зайшов напрям, змінилися очікування або смак.`
4. `input` `feedback_text` → `plain_text_input` (multiline) `feedback_input`, лейбл `"Правка і очікуваний результат"`, placeholder `Що змінити, навіщо це потрібно і який результат очікуємо...`.

### 11.3 Обробка сабміту (`feedbackSubmission.js`, `handleFeedbackSubmission`)

1. Парсить metadata, читає `feedbackText`/`feedbackType` зі `view.state.values`.
2. Якщо немає `pageId` — помилка користувачу.
3. `getRoundsCount(pageId)` (з Redis запису **батьківської** задачі) → `expectedRoundNumber = roundsCount + 1`. Якщо надісланий `roundNumber !== expectedRoundNumber` — це **застаріле рев'ю** (кнопку вже натиснуто раніше або гонка кількох модалок) → оновлює джерело (`updateReviewSourceAfterFeedback`, позначає "вже передано") + повідомляє користувачу `"⚠️ Це рев'ю вже неактуальне..."`, **без** створення нового sub-item.
4. Інакше — `createFeedbackSubitem()` (розділ 8.3) → `incrementRoundsCount(pageId)` (інкремент лічильника на батьківському Redis-записі).
5. `updateReviewSourceAfterFeedback`: якщо повідомлення, з якого відкрито форму, — і є кореневе повідомлення задачі (`isRootTaskSource` — збіг `parentTask.slackMessageTs` з `metadata.sourceMessageTs`) → повне `updateRootTaskMessage` з `statusNote` (`"Правки #N передано дизайнеру..."`) і `canAcceptResult: false` (тимчасово ховає кнопки, доки статус знову не стане Comments). Якщо форму відкрито з **іншого** (не кореневого) повідомлення (напр. з попереднього feedback-повідомлення) — просто `chat.update` того конкретного повідомлення на статичний текст `"✏️ Правки #N передано дизайнеру"` без кнопок (`buildClosedReviewPromptText`).
6. Надсилає окреме DM-повідомлення в тред батьківської задачі (`postFeedbackTaskCreatedMessage`) з текстом (`buildFeedbackThreadText`): `*{taskName}*\n⚪ *Статус правки:* To do\n🎨 *Дизайнер:* {designer}\n📌 *Тип правки:* {label}\n📝 *Правка:* «{перші 240 символів тексту}»\n\nПравку передано дизайнеру.` + кнопка `"📋 Відкрити в Notion / додати файли"` (лінк на sub-item).
7. `saveTask()` для sub-item з `taskKind: 'feedback'`, `parentPageId`, успадкованим `requesterName`/`team`/`hub`/`requestType` від батьківської задачі, і власним Slack-тредом (той самий `channelId`/`threadTs` батьківської задачі, `slackMessageTs` = ts нового feedback-повідомлення).

### 11.4 Готовність до прийняття (`taskAcceptanceReadiness.js`)

- `isAcceptableSubtaskStatus(status)` — включає (case-insensitive substring match) будь-яке з: `ready`, `реді`, `done`, `complete`, `готов`, `виконан`, або точний `правка done`/(`правк`+`done`).
- `canAcceptTaskResult(currentTasks, pageId)` — знаходить усі дочірні задачі (за `parentPageIds` relation, знайдені в поточних снепшотах) → `true`, якщо дочірніх немає **або** всі дочірні в acceptable статусі.
- `getTaskAcceptanceReadiness(pageId, departmentKey)` — при кліку кнопки "✅ Приймаю" ще раз "живо" (не з кешованого снепшота) читає сторінку + робить `databases.query` по child tasks (`Parent item` relation `contains: pageId`) — `canAccept = isCommentsStatus(status) && !hasBlockingSubtasks`.

### 11.5 Прийняття результату (`accept_task_result`, `resultAcceptance.js` → `handleTaskAcceptance`)

1. Парсить value з кнопки.
2. Якщо **не** feedback (`taskKind !== 'feedback'`) — ще раз перевіряє `getTaskAcceptanceReadiness` (захист від race — кнопка могла бути показана на старому снепшоті); якщо `!canAccept` — блокує з текстом (`getBlockedAcceptanceText`): або `"⚠️ Поки не можна прийняти результат: спершу всі сабтаски мають бути у статусі «Ready», «Done» або «Правка Done»."`, або `` `⚠️ Кнопка прийняття вже неактуальна. Прийняти результат можна тільки коли основна задача у статусі «Comments».{Зараз статус задачі: «X».}` ``.
3. `acceptTaskResult()` (`notion/acceptTask.js`): читає сторінку → `resolveStatusPropertyName` → **оновлює статус** на `acceptedStatus` (`'Ready'` для звичайної задачі, `'Правка Done'` (константа `FEEDBACK_ACCEPTED_STATUS`) для sub-item) → створює Notion-коментар з `@mention` дизайнера (`designerUserId`, якщо є, як реальна Notion people-mention) або текстовим fallback-handle (нормалізований `@ім'я_дизайнера`), текст: `"замовник прийняв задачу, позначено як готово!"` або `` `замовник прийняв правку, статус оновлено на «${acceptedStatus}».` `` для feedback.
4. Оновлює Slack: повідомлення-джерело (з кнопки) → простий текст прийняття (`getAcceptanceText` — `"✅ *{taskName}* прийнято після внесених правок / без правок. Статус у Notion оновлено на «Ready»."`); кореневе повідомлення задачі — повний `updateRootTaskMessage`.
5. Якщо `taskKind === 'feedback'` — після прийняття оновлює **батьківську** задачу (`refreshParentTaskAfterFeedbackAcceptance`) — перечитує readiness і кількість раундів, оновлює кореневе повідомлення (можливо повертає кнопки прийняття, якщо це була остання блокуюча sub-задача).
6. Якщо `!result.commentCreated` (коментар не вдалось створити) — окреме попереджувальне DM користувачу.
7. Якщо `shouldSendSurvey` (не feedback, і фідбек ще не було відправлено) — `sendQualitySurvey()` + `markFeedbackSurveySent()` — тобто **прийняття задачі теж тригерить quality survey**, незалежно від того, чи поллер вже це зробив.
8. `deleteTask(pageId)` — трек-запис видаляється з Redis (поллінг цієї задачі зупиняється негайно, а не чекає наступного циклу).

### 11.6 Quality rating (`quality_rating_N`, `resultAcceptance.js` → `handleQualityRating`/`handleQualityFeedbackSubmission`)

- Кнопка з `rating` в JSON value.
- `rating === 5` — одразу `saveAndSyncFeedback()` (без коментаря/категорій) і оновлення повідомлення (`updateQualitySurveyMessage` → `buildFeedbackAcceptedText`: `"✅ *Фідбек прийняли*\n*{taskName}*\n\n✨ *Твоя оцінка:* {★×rating}{☆×(5-rating)}\n\nДякуємо. Так ми бачимо, що вже працює, а що підняти на наступний рівень."`).
- `rating < 5` — відкриває модалку `quality_feedback_submission` (`getQualityFeedbackModal`): секція з оцінкою і назвою задачі, опційний `checkboxes` `feedback_categories` (`Контекст`/`Темп`/`Ясність`/`Результат`, values `context`/`pace`/`clarity`/`result`), опційний `plain_text_input` (multiline) `feedback_comment` "Коментар".
- Сабміт `quality_feedback_submission` → `saveAndSyncFeedback()` з коментарем/категоріями → те саме оновлення повідомлення (з доданим блоком `"*Твій фідбек:*\n>{комент}"`, якщо коментар був).
- `saveAndSyncFeedback` завжди намагається `syncQualityFeedbackToNotion()` (окрема Notion feedback-база, розділ 8/14) — при помилці лише логує, не блокує Redis-збереження.

---

## 12. Thread comment sync (`threadComments.js`)

### 12.1 Slack → Notion (DM-reply → Notion comment)

- Підписка: `app.event('message', ...)` — **глобальний** обробник усіх `message`-подій, що доходять до бота (не тільки `im`, фільтрація — усередині).
- `isHumanThreadReply(event)`: **виключає** будь-яке повідомлення з `event.subtype` (edit/delete/join/etc.), з `event.bot_id`/`event.app_id` (усі бот-повідомлення, включно з власними), без `event.user`/`event.channel`/`event.ts`; вимагає наявність `thread_ts` **і** `thread_ts !== ts` (тобто це має бути **відповідь у треді**, не кореневе повідомлення); якщо `event.channel_type` заданий — має бути саме `'im'` (пряме повідомлення) — це і є практичне обмеження "тільки DM-треди повідомлень бота", хоча технічно перевірка не звіряє, що це саме тред повідомлення **цього** бота (це робиться пізніше через пошук задачі).
- Текст обробляється `formatSlackText`: розкодовує `&lt;`/`&gt;`/`&amp;`, конвертує Slack-лінки `<url|text>` → `text (url)`, `<url>` → `url`.
- Порожній текст (після обробки) — ігнорується (наприклад, повідомлення, що складається лише з emoji-реакції в блоках, чи файл без підпису).
- Пошук задачі: `getTaskBySlackThread({channelId, threadTs, slackUserId})` — розділ 9.6. Якщо не знайдено (`!task?.pageId`) — подія просто ігнорується (жодного повідомлення про помилку користувачу — це очікувана поведінка для звичайних DM-повідомлень боту поза контекстом задачі).
- Ідемпотентність: `syncId = event.client_msg_id || \`${channel}:${ts}\``, `claimSlackThreadCommentSync(syncId)` — Redis `SET ... NX EX 604800` — якщо вже클eймлено (наприклад, Slack retry доставив ту саму подію двічі) — тихо повертає `false`, подія повторно не обробляється.
- `resolveSlackAuthorName` — `client.users.info` (той самий підхід, що для requester — `real_name` → `display_name` → `real_name` → `name` → fallback userId).
- `createSlackThreadComment({pageId, authorName, text})` (`notion/comments.js`): формує `notion.comments.create({parent: {page_id: pageId}, rich_text: buildRichText(body)})`, де `body = "Slack thread · {authorName}\n\n{text}"` (буквально цей рядок — префікс, який поллер потім розпізнає як "mirror", розділ 10.2/12.2).
- При помилці — `releaseSync(syncId)` (звільняє claim, щоб можна було спробувати ще раз пізніше) + `notifySyncFailure` (постить у той самий Slack-тред: `` `Не зміг перенести цей коментар у Notion. Помилка: ${slackError}` ``).

**Що НЕ синкається (явно виключено, з README/докстрінгів):**
- Файли, завантажені в Slack (`files:read` scope навіть не запитується) — якщо користувачу потрібно передати матеріали, він додає посилання в тексті або йде напряму в Notion.
- Повідомлення поза DM-тредом бота (публічні/приватні канали, групові DM — `mpim` scope не запитується взагалі).
- Edits/deletes/thread-broadcasts (subtype-повідомлення).
- Власні повідомлення бота (bot_id/app_id filter).

### 12.2 Notion → Slack (антипетля, деталі)

Коли поллер (розділ 10.2, крок "коментарі") бачить новий коментар у Notion — перед відправкою в Slack перевіряє `isMirroredSlackThreadComment(comment)`: `normalizePersonName(comment.text).startsWith('slack thread ·')` — тобто **точний** текстовий маркер, записаний ботом самим у розділі 12.1. Якщо це такий коментар — лише `updateLastComment` checkpoint, **без** `sendCommentUpdate`. Це і є повний механізм захисту від "луна"-петлі: Slack-відповідь → Notion-коментар (з маркером) → поллер бачить цей коментар → розпізнає маркер → не відсилає назад у Slack.

⚠️ **Крихкість цього механізму**: розпізнавання суто текстове (префікс рядка, без жодного окремого "internal comment" флагу чи Notion comment metadata). Якщо коментар редагується вручну в Notion і префікс `Slack thread ·` лишається, а текст після нього змінюється — коментар усе одно вважатиметься mirror-ом і **не** дійде до Slack. Якщо людина в Notion **сама** починає коментар з тексту `Slack thread · ...` — цей коментар помилково буде проігнорований поллером. Це задокументований у Phase 1 checklist ризик ("mirror-loop case"), вирішений саме цим текстовим маркером — при переносі варто розглянути надійніший механізм (напр. окремий Notion custom property/tag на комент, якщо Notion API дозволить, або збереження ID створених ботом коментарів у Redis-set замість текстового пошуку).

---

## 13. Slack App налаштування, необхідні для роботи

### 13.1 OAuth scopes (точний список, з README і `docs/slack-app-long-description.md`)

| Scope | Навіщо (буквальне обґрунтування з README) |
|---|---|
| `commands` | `дозволяє користувачу викликати /new-task. Без цього Slack не доставить slash command payload у backend.` |
| `chat:write` | `дозволяє боту надсилати й оновлювати власні повідомлення: підтвердження створення задачі, статусні апдейти, повідомлення про помилки, тредові апдейти та quality survey. Incoming webhook не підходить, бо бот пише в персональні DM-треди, оновлює власні повідомлення та реагує на interactive actions.` |
| `im:write` | `дозволяє відкрити або отримати DM channel з користувачем, щоб доставити персональне повідомлення про його задачу. Scope використовується тільки для користувача, який створив задачу або пов'язаний зі збереженою Notion page.` |
| `im:history` | `дозволяє отримувати event message.im для текстових відповідей у DM-треді бота. Це потрібно, щоб користувач міг написати уточнення або коментар у треді задачі, а бот переніс цей текст у Notion-коментар. Бот ігнорує повідомлення поза DM і не читає group DM.` |
| `users:read` | `дозволяє отримати real_name / display_name користувача через users.info. Це потрібно, щоб у Notion було людське ім'я requester-а або автора коментаря, а не тільки Slack ID. Whitelist за поведінкою: тільки користувачі, які самі взаємодіють із ботом у межах створення або ведення задачі.` |
| `users:read.email` | `дозволяє отримати email requester-а через users.info. Бот використовує email лише під час створення задачі, щоб знайти Notion user з таким самим email і проставити його в people-property Owner; якщо збіг не знайдено, лишається дефолтний owner відділу.` |

**Явно НЕ запитуються** (і не потрібні поточній логіці): `im:read`, `mpim:history`, `files:read`, `app_mentions:read`.

### 13.2 Event Subscriptions

- `app_home_opened` — рендер App Home tab.
- `message.im` — вхідні DM-повідомлення (у тому числі тред-репл наі; бот сам фільтрує все, що не є тред-репл у DM, розділ 12.1).

### 13.3 Slash Commands

- `/new-task` — Request URL = `<host>/slack/events` (стандартний Bolt endpoint).
- `/event-request` — той самий endpoint (Bolt мультиплексує slash-команди по одному URL за `command`-полем payload-а).

### 13.4 Interactivity & Shortcuts

Той самий Request URL `<host>/slack/events` — обробляє всі `block_actions`/`view_submission`/`view_closed` payload-и (усі `app.action`/`app.view` реєстрації з розділу 3).

### 13.5 App Home

- **Messages Tab** має бути **увімкнений** і **не read-only** — інакше користувач не зможе писати тред-репл в DM-повідомлення бота (це саме той канал, яким переносяться коментарі в Notion, розділ 12.1). З README, точні кроки:
  1. Slack App settings → **App Home**.
  2. Увімкнути **Messages Tab**.
  3. Вимкнути read-only режим для Messages Tab.
  4. Після зміни scopes або App Home settings — **Reinstall to Workspace**.
- Home Tab сам рендериться (`app_home_opened`), містить статичний контент (розділ 3.4) — ⚠️ поточний текст App Home хардкоджено називає бота **"PR & Comms Bot"** і показує use-cases про PR/анонси/тексти/медіа-запити, що **не відповідає** фактичному функціоналу (Design/SMM/Event tasks bot) — очевидно, скопійований шаблон з іншого проєкту й не оновлений. При перенесенні в unified-бот цей текст потрібно або повністю переписати під реальний Tasks Bot use-case, або видалити взагалі, якщо unified-бот має власний Home Tab.

### 13.6 Довгий опис (Long Description) — буквальний текст для Slack App Display Information

```text
Tasks Bot допомагає командам швидко створювати запити зі Slack без ручного перенесення брифів у Notion.

Користувач відкриває App Home або викликає slash command /new-task, обирає відділ і тип задачі, заповнює короткий бриф у Slack modal, а бот створює відповідну сторінку в Notion database. Після створення задачі бот надсилає користувачу повідомлення в DM-треді з посиланням на Notion. Коли статус задачі або результат у Notion змінюється, бот оновлює Slack-тред і повідомляє автора задачі. Якщо користувач відповідає текстом у треді повідомлення бота, ця відповідь переноситься як коментар до відповідної Notion-сторінки.

Бот не читає публічні канали, приватні канали, групові DM або історію всього workspace. Бот не читає Slack-uploaded файли. Якщо користувачу потрібно передати матеріали, він додає посилання на Figma, Google Drive або інший ресурс у формі/треді, або відкриває створену задачу в Notion і додає матеріали там.
```

User whitelist / data boundary (буквально, для approval-процесу Slack):
```text
- users:read використовується тільки для користувача, який сам взаємодіє з ботом: створює задачу через /new-task або App Home, натискає кнопку в повідомленні бота, залишає текстову відповідь у DM-треді задачі.
- users:read.email використовується тільки для requester-а задачі під час створення Notion page; email не зберігається в Redis і потрібен лише для зіставлення з Notion user.
- im:history використовується тільки для DM-тредів повідомлень, які бот сам створив для конкретної задачі й зберіг у Redis як зв'язку Slack thread ↔ Notion page.
- chat:write та im:write використовуються тільки для повідомлень, пов'язаних із задачами цього бота.
```

---

## 14. Повний перелік змінних середовища (.env)

Групування за призначенням. "Default (код)" — фактичний fallback у коді, якщо env не заданий взагалі; "Default (.env.example)" — значення, з яким репозиторій постачається за замовчуванням у прикладі (може відрізнятись від дефолту в коді).

### 14.1 Slack / інфраструктура

| Env var | Default (код) | Опис |
|---|---|---|
| `SLACK_BOT_TOKEN` | — (stub-режим, якщо не задано / `placeholder`) | Bot User OAuth Token |
| `SLACK_SIGNING_SECRET` | — | Для перевірки підпису Slack-запитів |
| `PORT` | `3000` | HTTP port |
| `UPSTASH_REDIS_REST_URL` | — | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | — | Upstash Redis REST token |
| `REDIS_KEY_PREFIX` | `''` | Префікс усіх Redis-ключів (sandbox namespace) |
| `TEST_TASK_PREFIX` | `''` | Префікс назви тестових задач (напр. `[ТЕСТ]`) |
| `FAILED_SUBMISSION_TTL_SECONDS` | `2592000` (30 днів) | TTL чернеток невдалих сабмітів **і** елементів черги сабмітів (той самий helper) |

### 14.2 Notion — глобальні / загальні

| Env var | Default (код) | Опис |
|---|---|---|
| `NOTION_TOKEN` | — | Notion integration secret |
| `NOTION_DATABASE_ID` | — | Legacy fallback database id (design → smm → event усі можуть на нього фолбечити) |
| `NOTION_TEMPLATE_ID` | — | Legacy fallback template id (design fallback) |
| `NOTION_TEMPLATE_TIMEZONE` | `'Europe/Kiev'` | Timezone для `template_id` PATCH-запиту |
| `NOTION_STATUS_PROPERTY` | `'Design Status'` (через `LEGACY_STATUS_PROPERTY='Status'` фолбек-ланцюг) | Legacy fallback назви статусної властивості |
| `NOTION_POLL_COMPLETED_STATUSES` | `'Ready,Cancelled,Canceled'` | Legacy fallback для Design completedStatuses |
| `NOTION_FEEDBACK_DATABASE_ID` | — (у `feedbackDatabase.js` — code-level default `'164e70dbe0774b8ca7fa761ab2f0e6a5'`) | Fallback feedback database (якщо department-специфічний не заданий) |
| `NOTION_ACTIVITIES_DATABASE_ID` | `'b1ff9daa012c41c597e1d5ad5dd91917'` | SMM/Event спільна Activities database (fallback) |
| `NOTION_BRAND_DESIGN_HUB_URL` | — | Другорядний fallback для Design hub URL |
| `NOTION_REQUEST_MIN_INTERVAL_MS` | `1000` | Мінімальний інтервал між Notion API запитами (throttle) |
| `NOTION_REQUEST_MAX_RETRIES` | `4` | Максимум повторів при 429 у `notionRequest` |
| `NOTION_POLL_RATE_LIMIT_COOLDOWN_MS` | `600000` (10 хв) | Пауза всього поллінгу після rate limit у циклі |
| `NOTION_POLL_STARTUP_STAGGER_MS` | `10000` | Затримка старту поллінгу між департаментами |
| `NOTION_POLL_TASK_BATCH_SIZE` | `25` | Максимум задач, що опитуються за один цикл поллінгу (на департамент) |
| `NOTION_COMMENT_POLL_INTERVAL_MS` | `900000` (15 хв) | Мінімальний інтервал між comment-поллінгами однієї задачі |
| `NOTION_MAX_COMMENT_POLLS_PER_CYCLE` | `8` | Максимум задач з comment-поллінгом за один цикл |

### 14.3 Notion — sub-item / feedback properties (спільні для всіх департаментів)

| Env var | Default | Опис |
|---|---|---|
| `NOTION_PARENT_ITEM_PROPERTY` | `'Parent item'` | Relation-властивість sub-item → батько |
| `NOTION_SUB_TYPE_PROPERTY` | `'Sub-type'` | Select-властивість типу sub-item |
| `NOTION_FEEDBACK_SUB_TYPE` | `'правка'` | Значення `Sub-type` для feedback sub-items |
| `NOTION_DESCRIPTION_PROPERTY` | `'Description'` | Rich-text властивість опису sub-item |
| `NOTION_FEEDBACK_TYPE_PROPERTY` | `'Тип правки'` | Властивість типу фідбеку (об'єктивна/суб'єктивна) |

### 14.4 Design

| Env var | Default (код) | Default (.env.example) |
|---|---|---|
| `NOTION_DESIGN_DATABASE_ID` | fallback `NOTION_DATABASE_ID` | (порожньо) |
| `NOTION_DESIGN_TEMPLATE_ID` | fallback `NOTION_TEMPLATE_ID` | (порожньо) |
| `NOTION_DESIGN_HUB_URL` | fallback `NOTION_BRAND_DESIGN_HUB_URL` → `https://www.notion.so/Brand-Design-Hub-33cce9899cb7814488c0f439326aaf2a?source=copy_link` | (порожньо) |
| `NOTION_DESIGN_FEEDBACK_DATABASE_ID` | fallback `NOTION_FEEDBACK_DATABASE_ID` → `null` | (порожньо) |
| `NOTION_DESIGN_STATUS_PROPERTY` | fallback `NOTION_STATUS_PROPERTY` → `'Design Status'` | `Design Status` |
| `NOTION_DESIGN_INITIAL_STATUS` | `'To do'` | `To do` |
| `NOTION_DESIGN_COMPLETED_STATUSES` | fallback `NOTION_POLL_COMPLETED_STATUSES` → `'Ready,Cancelled,Canceled'` | `Ready` (⚠️ у .env.example лише `Ready`, без `Cancelled,Canceled` — але код все одно ловить "cancel"/"скас" підрядком, розділ 10.3) |
| `NOTION_DESIGN_QUALITY_SURVEY_STATUSES` | `'Ready'` | `Ready` |
| `NOTION_DESIGN_POLL_INTERVAL_SEC` | `180` | `180` |
| `DESIGN_CHANNEL_ID` | — | (заданий, значення не в прикладі) |
| `NOTION_DESIGN_OWNER_ID` | `'f342c30b-c5c1-4a52-8cdf-c8b636928364'` | `f342c30b-c5c1-4a52-8cdf-c8b636928364` |
| `NOTION_DESIGN_OWNER_LABEL` | `null` | (порожньо) |
| `NOTION_DESIGN_TEAM` | `'Brand Design'` | `Brand Design` |

Lead-time env vars — усі перелічено в розділі 6.1 (37 змінних, з них `identity`/`logo`/`other` без lead-time env).

### 14.5 SMM

| Env var | Default (код) | Default (.env.example) |
|---|---|---|
| `NOTION_SMM_DATABASE_ID` | fallback `NOTION_ACTIVITIES_DATABASE_ID` → `NOTION_DATABASE_ID` → `'b1ff9daa012c41c597e1d5ad5dd91917'` | (порожньо) |
| `NOTION_SMM_TEMPLATE_ID` / `NOTION_SMM_TASK_TEMPLATE_ID` | `null` | (порожньо, обидва) |
| `NOTION_SMM_HUB_URL` | `https://www.notion.so/SMM-Hub-375ce9899cb781aaab1ddb4c30833e23?source=copy_link` | той самий |
| `NOTION_SMM_FEEDBACK_DATABASE_ID` | `'025dce2c634e4a079ee7600ea8c63253'` | той самий |
| `NOTION_SMM_STATUS_PROPERTY` | `'SMM статус'` | `SMM статус` |
| `NOTION_SMM_INITIAL_STATUS` | `'To do'` | `To do` |
| `NOTION_SMM_COMPLETED_STATUSES` | `'Published,Canceled,Cancelled'` | той самий |
| `NOTION_SMM_QUALITY_SURVEY_STATUSES` | `'Published'` | `Published` |
| `NOTION_SMM_POLL_INTERVAL_SEC` | `180` | `180` |
| `NOTION_SMM_OWNER_ID` | `'77a3e7fe-a555-4c14-b794-d63a6e42a324'` | той самий |
| `NOTION_SMM_OWNER_LABEL` | `'Anna Gayuk'` | `Anna Gayuk` |
| `NOTION_SMM_TEAM` | `'SMM'` | `SMM` |
| `SMM_CHANNEL_ID` | `null` | (порожньо) |
| `SLACK_SMM_NOTIFY_CHANNEL` | `null` | (порожньо) |

Lead-time (14 змінних, розділ 6.2): `SMM_REELS_MIN_LEAD_DAYS` (4), `SMM_CAROUSEL_POST_MIN_LEAD_DAYS` (3), `SMM_ANNOUNCEMENT_POST_MIN_LEAD_DAYS` (2), `SMM_STORIES_MIN_LEAD_DAYS` (2), `SMM_LINKEDIN_NEWSLETTER_MIN_LEAD_DAYS` (4), `SMM_VIDEO_PRODUCTION_MIN_LEAD_DAYS` (7), `SMM_VIDEO_EDITING_MIN_LEAD_DAYS` (fallback на попередню, 7 — ⚠️ **немає** в `.env.example`, лише в коді як fallback-chain), `SMM_YOUTUBE_VIDEO_PUBLISH_MIN_LEAD_DAYS` (2), `SMM_VACANCY_PROMO_STATIC_MIN_LEAD_DAYS` (3), `SMM_VACANCY_PROMO_VIDEO_MIN_LEAD_DAYS` (7), `SMM_PUBLICATION_BOOST_MIN_LEAD_DAYS` (2), `SMM_BLOGGER_COLLAB_MIN_LEAD_DAYS` (7), `SMM_DRIVE_UPLOAD_MIN_LEAD_DAYS` (1), `SMM_EVENT_REPORT_MIN_LEAD_DAYS` (3).

### 14.6 Event

| Env var | Default (код) | Default (.env.example) |
|---|---|---|
| `EVENT_DEPARTMENT_ENABLED` | `false` | `false` |
| `NOTION_EVENT_DATABASE_ID` | fallback `NOTION_ACTIVITIES_DATABASE_ID` → `NOTION_DATABASE_ID` → `'b1ff9daa012c41c597e1d5ad5dd91917'` | (порожньо) — але саме його наявність теж активує департамент |
| `NOTION_EVENT_TEMPLATE_ID` | fallback `NOTION_EVENT_TASK_TEMPLATE_ID` → `'34ace9899cb780afb5b5e4ba36e1c2e2'` | `34ace9899cb780afb5b5e4ba36e1c2e2` |
| `NOTION_EVENT_TASK_TEMPLATE_ID` | — | (порожньо) |
| `NOTION_EVENT_HUB_URL` | `https://www.notion.so/Event-Manager-Hub-366ce9899cb7817580bccd4a2651f925?source=copy_link` | той самий |
| `NOTION_EVENT_FEEDBACK_DATABASE_ID` | `null` | не в `.env.example` (Event не має власної feedback-бази — фолбекне на глобальну/дефолтну) |
| `NOTION_EVENT_STATUS_PROPERTY` | `'Status'` | `Status` (⚠️ README текстово каже дефолт "SMM статус" — фактичне значення в `.env.example` — `Status`, а не `SMM статус`; підозра на розбіжність документації і прикладу — Потребує перевірки) |
| `NOTION_EVENT_INITIAL_STATUS` | `'Backlog'` | `Backlog` |
| `NOTION_EVENT_COMPLETED_STATUSES` | `'Done,Completed,Canceled,Cancelled'` | той самий |
| `NOTION_EVENT_QUALITY_SURVEY_STATUSES` | `''` (survey вимкнено, крім fallback на "ready"-підрядок) | не заданий у `.env.example` |
| `NOTION_EVENT_POLL_INTERVAL_SEC` | `180` | не в `.env.example` (значить використовується код-дефолт) |
| `NOTION_EVENT_OWNER_ID` | `'2cdd872b-594c-815b-acd7-000259d98a51'` | той самий |
| `NOTION_EVENT_OWNER_LABEL` | `'Mariia Tarasiuk'` | той самий |
| `SLACK_EVENT_OWNER_ID` | fallback `SLACK_MARIA_USER_ID` → `null` | `U0A2SF2NG8K` |
| `NOTION_EVENT_TEAM` | `'Event'` | `Event` |
| `EVENT_CHANNEL_ID` | `null` | (порожньо) |
| `SLACK_EVENT_NOTIFY_CHANNEL` | `null` | не в `.env.example` |

Lead-time прямих типів (розділ 6.3): `EVENT_MERCH_MIN_LEAD_DAYS` (45), `EVENT_GIFTS_READY_MIN_LEAD_DAYS` (1), `EVENT_ACTIVITY_MIN_LEAD_DAYS` (21), `EVENT_STAND_CONCEPT_SIMPLE_MIN_LEAD_DAYS` (21), `EVENT_STAND_CONCEPT_COMPLEX_MIN_LEAD_DAYS` (45), `EVENT_FIELD_CONFERENCE_MIN_LEAD_DAYS` (18), `EVENT_NEW_MIN_LEAD_DAYS` (30, недосяжний тип), `EVENT_SUPPORT_MIN_LEAD_DAYS` (14, недосяжний), `EVENT_MATERIALS_MIN_LEAD_DAYS` (7, недосяжний), `EVENT_REPORT_MIN_LEAD_DAYS` (3, недосяжний). Complexity-типи (`event_internal_*`, `event_external_*`, `conference_*`, `gifts_custom_*`) — **без** env vars, значення хардкоджені (розділ 6.3).

### 14.7 Черга сабмітів задач

| Env var | Default |
|---|---|
| `TASK_SUBMISSION_QUEUE_INTERVAL_MS` | `5000` |
| `TASK_SUBMISSION_QUEUE_MAX_ATTEMPTS` | `20` |
| `TASK_SUBMISSION_QUEUE_RETRY_DELAY_MS` | `60000` |
| `TASK_SUBMISSION_QUEUE_MAX_RETRY_DELAY_MS` | `600000` |

### 14.8 Скрипти (не потрапляють у продакшн-runtime, лише ручні прогони)

| Env var | Default | Скрипт |
|---|---|---|
| `BACKFILL_DETAIL_LIMIT` | `40` | `src/scripts/backfillSlackPersonPeople.js` |

---

## 15. Deployment / Railway

⚠️ Наведено лише **не-секретну** інформацію з README. Токени (`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `NOTION_TOKEN`, Redis token) **ніколи** не копіюються в цей чи будь-який інший документ як plain text — при перенесенні в unified-бот їх потрібно **повторно провіссіонити** через власне secret-хранилище нового бота (Railway variables / secret manager), а не переносити значення буквально з якогось джерела.

**Продакшн-сервер:**
- Railway project: `responsible-healing`
- Railway service: `slack-notion-bot`
- Environment: `production`
- Public URL: `https://slack-notion-bot-production-9fff.up.railway.app`
- Slack Request URL (Event Subscriptions, Interactivity & Shortcuts, `/new-task`): `https://slack-notion-bot-production-9fff.up.railway.app/slack/events`
- CLI link: `railway link --project de592e69-4110-49c8-ba64-bc6304f00b88 --environment production --service 0583990d-380b-48ea-8748-21d1ef14942e`

**Тестовий (Phase 1 sandbox) сервер:**
- Railway project: `design-tasks-bot-phase1-test`
- Railway service: `design-tasks-bot-phase1-test`
- Environment: `production`
- Public URL: `https://design-tasks-bot-phase1-test-production.up.railway.app`
- Slack Request URL (тестовий Slack app): `https://design-tasks-bot-phase1-test-production.up.railway.app/slack/events`
- CLI link: `railway link --project 100ff942-cd33-4cc8-8fe9-dfc27fe426ca --environment production --service e9a90e6b-10da-4e61-9945-3abaac66abdd`

Build/deploy config (`railway.json`): `builder: NIXPACKS`, `startCommand: npm start`, `restartPolicyType: ON_FAILURE`, `restartPolicyMaxRetries: 10`.

**Важливо перед будь-якою операцією**: завжди спершу `railway status`, щоб не змінити не той сервіс (у репозиторії два сервери, легко сплутати).

**Діагностика 401 на `/slack/events`**: `xoxb` токен перевіряється при вихідних Slack API-викликах; 401 на вхідний webhook зазвичай означає mismatch `SLACK_SIGNING_SECRET` між Slack app і Railway env.

---

## 16. Test/Sandbox conventions

- `REDIS_KEY_PREFIX=test:` — повна ізоляція Redis namespace для тестового прогону в тому самому Redis-інстансі.
- `TEST_TASK_PREFIX=[ТЕСТ]` — префікс, що автоматично додається до назви кожної створеної задачі (`applyTestTaskPrefix` — додає лише якщо назва ще не починається з цього префікса; сам префікс задається через env і має включати всі потрібні дужки/символи буквально, напр. `[ТЕСТ]`, з пробілом-роздільником, який код додає сам: `` `${prefix} ${name}`.trim() ``).
- Коли `TEST_TASK_PREFIX` заданий — `createNotionPage` додатково намагається виставити `Test` (checkbox) і `Tags`/`Tag` = `'Test'` (multi_select/select), якщо такі властивості існують у цільовій базі — це **додатковий** маркер поверх текстового префікса, не заміна йому.
- Ідентифікація тестових задач для очищення: у Notion — фільтр `Name contains [ТЕСТ]` (або який префікс задано); для SMM — додатково `Team=SMM`; для Event — фільтр по Activities/Event database.
- `EVENT_DEPARTMENT_ENABLED=true` — єдиний спосіб показати Event у продакшн-picker-і без задання реальної `NOTION_EVENT_DATABASE_ID` (корисно для сценарію "показати картку в picker-і, але БД ще тестова/шарена з Activities").
- Очищення: **вручну** видаляти тестові сторінки з Notion після кожного тестового прогону (немає автоматичного cleanup у коді) — інакше вони залишаться назавжди трекованими в Redis, доки поллер сам не побачить, що сторінка недоступна (лише якщо видалено з Notion — тоді трек-запис теж видаляється автоматично, розділ 10.2 п.5).
- Sandbox Railway-сервер (`design-tasks-bot-phase1-test`) використовує окремий тестовий Slack app/workspace token, але **той самий production Notion database** для Design (з ізольованим Redis-префіксом і `[ТЕСТ]`-префіксом назв) — це задокументований підхід Phase 1.
- Design designer-mentions у sandbox можуть виглядати "порожніми" (production Slack user ID рендериться в тестовому workspace, де цей ID не існує) — перевіряти варто через сам Notion relation і Redis `lastDesignerName`, а не через вигляд Slack-повідомлення.

---

## 17. Ризики і на що звернути увагу при перенесенні в єдиний бот компанії

1. **Колізії callback_id/action_id з хендлерами unified-бота.** Усі назви — узагальнені, без неймспейсу: `select_department`, `select_design_domain`, `select_task_type`, `select_task_complexity`, `submit_task`, `feedback_submission`, `quality_feedback_submission`, `accept_task_result`, `open_feedback_modal`, `open_new_task_from_home`, `platform`, а також regex `/^quality_rating(?:_\d+)?$/` і `/^(structure_choice|ready_texts|visual_source|link_needed|title_description|thumbnail|ad_goal|fixed_budget|source_materials)$/`. Якщо unified-бот вже має **власні** обробники з такими самими callback_id/action_id (особливо ймовірно для загальних слів `submit_task`, `select_department`, `platform`) — Bolt зареєструє **обидва** обробники на один callback_id/action_id і виконає **обидва** при спрацюванні (Bolt дозволяє множинну підписку на один listener matcher) — це призведе до подвійної обробки (два `ack()`, потенційно конфліктні side-effects, або помилка "already acknowledged"). **Рекомендація**: переносячи код, обов'язково доперейменувати всі callback_id/action_id під префікс цього функціоналу (напр. `tasksbot_submit_task`, `tasksbot_select_department`), і синхронно оновити всі місця, де ці рядки використовуються як **значення** (`private_metadata` JSON, побудова views) — вони розкидані по `taskEntry.js`, `submission.js`, `feedbackModal.js`, `index.js`.

2. **Redis-записи без `departmentKey` трактуються як `'design'`.** Це навмисний backward-compat механізм (`resolveDepartmentKey` фолбекає на `DEFAULT_DEPARTMENT_KEY = 'design'`, якщо ключ не в `departments` або неактивний). При перенесенні: якщо unified-бот має **власні** Redis-записи задач з полем на ім'я `departmentKey`, що означає щось інше (інший набір ключів), і той самий Redis instance/prefix використовується — старі задачі цього бота ризикують бути неправильно перекласифіковані. Або переносити Redis-дані з окремим/іншим key-namespace, або мігрувати всі старі записи явним скриптом (додаючи `departmentKey: 'design'` буквально) перед вимкненням старого коду.

3. **Singleton-guard черги сабмітів (`queueWorkerStarted`, module-scope boolean) несумісний з hot-reload/множинними інстансами.** `startTaskSubmissionQueueWorker` захищає лише від повторного виклику **всередині одного процесу** (модульна змінна). Якщо: (а) unified-бот запускається у кластері/декількох Node-процесах (напр. кілька Railway-реплік або PM2 cluster mode) — кожен процес підніме свій `setInterval`, і кожен воркер намагатиметься забрати той самий `task-submission-queue` з Redis — через `zrem`-after-read це не спричинить дублікат **виконання** одного й того ж item (тільки один процес успішно зробить `zrem`), але спричинить зайве навантаження (кожен процес постійно опитує черговий Redis) і M:1 конкуренцію за rate-limited Notion API (яка й так throttled лише **в межах одного процесу** — `notionRequest`-черга не спільна між процесами!); (б) якщо модуль `submission.js` імпортується/викликається двічі в одному процесі (напр. через дублювання реєстрації в новому app-фреймворку, або невдалий hot-reload у розробці) — `queueWorkerStarted` захистить від другого `setInterval`, **але** інші подібні module-scope прапорці в `pollStatus.js` (`pollingInProgressByDepartment`, `queuedPollingDepartmentKeys`, `pollingPausedUntil`, `commentPollingEnabled`) **не** мають подібного глобального guard на рівні `startPolling()` — повторний виклик `startPolling(app.client)` (наприклад, якщо `src/index.js`-еквівалент у unified-боті буде викликаний двічі) підніме **другий** незалежний набір `setInterval`, що призведе до дублювання всіх Slack-сповіщень і потенційних Notion rate-limit проблем. **Рекомендація**: явно перенести обидва воркери (submission queue + polling) під єдиний "чи цей модуль уже запущено в цьому процесі" guard, і за потреби — під розподілений lock (напр. Redis `SET NX`) якщо unified-бот справді працює в кількох Node-процесах одночасно.

4. **Rate-limiting Notion-токена — спільний ресурс, якщо unified-бот пише в Notion з інших фіч.** `notionRequest` throttle (`NOTION_REQUEST_MIN_INTERVAL_MS`) — це internal module-scope queue **лише для запитів, зроблених через цю конкретну функцію**. Якщо unified-бот має інші модулі, що звертаються до Notion API (той самий чи інший token) **без** проходження через цей самий throttle-wrapper — сумарний rate до Notion workspace може перевищувати ліміт, і 429 від однієї фічі може "з'їсти" бюджет retries іншої. Якщо унікальний бот справді ділить один Notion integration token з іншими функціями — усі Notion-виклики варто звести під єдиний shared rate-limiter (а не окремий на кожен модуль).

5. **OAuth scopes — потенційний конфлікт/надлишок з unified-ботом.** Список scopes цього бота (`commands`, `chat:write`, `im:write`, `im:history`, `users:read`, `users:read.email`) — досить мінімальний, конфлікту зі стандартними ботами малоймовірний, але:
   - `users:read.email` — чутливий scope, що потребує окремого Slack approval (workspace admin review) — README явно каже "Confirm `users:read.email` is approved and the Slack app is reinstalled after the scope change" (Phase 4 checklist). Якщо unified-бот уже має схвалений набір scopes без цього — додавання `users:read.email` вимагатиме нового approval-циклу і **обов'язкового reinstall workspace** (усі існуючі OAuth-токени користувачів/бота стають недійсними до reinstall — короткочасний downtime).
   - `im:history` разом із `message.im` event-підпискою — якщо unified-бот вже підписаний на `message.im` з іншою обробкою (напр. загальний AI-асистент, що реагує на всі DM) — обробники **обидва** спрацюють на кожне DM-повідомлення; важливо переконатись, що `handleSlackThreadCommentEvent` не "з'їдає" (не consume-ить) подію ексклюзивно (Bolt event listeners не є "first wins" — усі виконуються), і що дублювання логіки (напр. якщо unified-бот теж хоче відповідати на ці ж DM) свідомо узгоджено.

6. **App Home контент неактуальний/спотворений branding.** Хардкоджений текст "PR & Comms Bot" з use-cases про анонси/тексти/медіа-запити (розділ 13.5) явно не відповідає фактичному Design/SMM/Event tasks-функціоналу. Якщо unified-бот має власний, консолідований App Home — цей блок краще видалити повністю (замінити на `open_new_task_from_home` кнопку інтегровану в спільний Home Tab), а не переносити текст буквально.

7. **`fieldMapping` містить "мертві" block_id** (`accent_block`, `new_blocks_block`, `character_block`, `vacancy_block`, `promo_desc_block` — розділ 7.7), яких немає в жодному активному `specificBlocks`. Це не викликає помилок (просто ніколи не спрацьовує), але вказує на те, що набір Design task types **вже змінювався** з часу написання цієї мапи — при переносі не варто "магічно" відновлювати ці поля, вважаючи їх активними; варто або видалити ці записи, або залишити їх нешкідливо, якщо є план повернути відповідні типи задач.

8. **`event_new`/`event_support`/`event_materials`/`event_report` (Event-версія) — конфігурація без UI-доступу** (розділ 6.3) — потенційно недороблена фіча або залишок старого Event-бота (README згадує "Provide the old Event-bot repository as read-only reference and replace the TODO Event forms with exact old forms" у Phase 3 checklist — тобто нинішній набір Event task types, ймовірно, **не є** повним і остаточним відтворенням старого Event-бота). Перед перенесенням Event-функціоналу варто перевірити з бізнес-стороною (Event-командою), чи ці 4 типи мають бути доступні, чи це справді застарілий код.

9. **Event: `NOTION_EVENT_STATUS_PROPERTY` розбіжність між README-текстом і `.env.example`/code-default** (розділ 5.3, 14.6) — README стверджує дефолт `SMM статус` "для тестів у shared Activities", але і в коді (`department.js`), і в `.env.example` фактичний дефолт — `'Status'`. ⚠️ Потребує перевірки перед перенесенням — з якою насправді статусною властивістю Event зараз працює в проді/sandbox.

10. **Черга сабмітів і TTL.** `enqueueTaskSubmission`/`requeueTaskSubmission` використовують той самий `getFailedSubmissionTtlOptions()` (`FAILED_SUBMISSION_TTL_SECONDS`, default 30 днів) для `task-submission-queue-item:*` ключів. Це означає, що якщо елемент черги "застряг" (наприклад, worker довго не піднімався через деплой) довше 30 днів — Redis сам видалить STRING-запис, але `ZSET`-запис (`task-submission-queue`) залишиться "осиротілим" (member без відповідного item). `getDueTaskSubmission` в такому випадку прочитає `null` payload і поверне `null` — без явного видалення orphaned member з ZSET (⚠️ потенційний повільний ріст ZSET сміттям з дуже старих задач, якщо процес довго не запускався; варто додати періодичний cleanup при перенесенні).

11. **`KEYS`-команда в `getAllTasks()`/`recoverOrphanedTaskSubmissions()`** — блокуюча за своєю природою О(n) операція. Прийнятно для невеликої кількості трекованих задач/queue-items, але при масштабуванні (сотні одночасно активних задач у кількох департаментах) варто розглянути SCAN-based ітерацію або підтримку окремого Redis SET-індексу id'шників.

12. **Немає жодного автотесту** (в `package.json` немає test-залежностей чи скрипта) — увесь функціонал (валідація lead-time, поллінг, feedback rounds, quality survey, black-box поведінка Slack modal wizard-а) верифікований лише вручну через sandbox rollout checklist. При перенесенні варто розглянути додавання хоча б мінімальних unit-тестів на найкритичніші чисті функції (`getDaysUntil`/`getLeadTimeViolation`, `isCompletedStatus`/`isQualitySurveyStatus`, `getDepartmentTaskFields`, `buildRichText`) — вони чисті й легко тестуються без Slack/Notion API.

13. **Stub-режим (розділ 3.6) і App Home/поллінг вимкнені разом.** Якщо unified-бот запускається без `SLACK_BOT_TOKEN` під час поетапного розгортання (наприклад, чекаючи на затвердження app) — весь функціонал (включно з App Home і поллінгом) просто **не існує** в цьому режимі; це нормальна навмисна поведінка цього репозиторію, але при об'єднанні кодових баз потрібно чітко вирішити: чи unified-бот теж повинен мати stub-режим (і як тоді координувати частковий rollout нового функціоналу, доки інший функціонал unified-бота вже працює на реальному токені).

14. **Мапінг "Slack Person"/"Owner" на Notion people-property залежить від точного email-збігу і глобального кешу `notion.users.list()`** (`notionPeoplePromise`, module-scope, обчислюється один раз за життя процесу — розділ 8.1 п.11). Якщо в Notion workspace додається новий співробітник/змінюється email **після** старту процесу — цей кеш не інвалідується автоматично (тільки при помилці запиту), доки процес не перезапуститься. Це прийнятно для Railway (часті деплої природно оновлюють кеш), але варто явно задокументувати цю поведінку в unified-боті, якщо туди переноситься сама ідея кешування workspace-юзерів.

15. **Слух на `app.event('message', ...)` без фільтра по `subtype`/`channel_type` на рівні підписки** — увесь фільтр логіки (розділ 12.1) відбувається **всередині** обробника. Якщо unified-бот має **інші** причини слухати `message`-події (наприклад, для якогось спільного логування) — варто переконатись, що жодна інша частина коду не споживає той самий event і не викликає паралельних side-effects на одне і те саме повідомлення без потреби.


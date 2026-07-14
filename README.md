# Slack → Notion Tasks Bot

Slack-бот, який дозволяє командам швидко приймати задачі через короткі брифи у Slack і автоматично створює сторінки в Notion. Коли статус задачі змінюється або в задачі з'являється новий відкритий коментар у Notion — автор отримує сповіщення назад у Slack.

У Phase 2 всередині коду активні два відділи: `design` і `smm`. Design лишається поведінково сумісним зі старим ботом після вибору відділу: ті самі типи задач, ті самі форми й та сама Notion-база. SMM є greenfield-гілкою, що пише в Activities через `Team=SMM`.

## Як це працює

1. Користувач відкриває App Home або викликає команду `/new-task`.
2. Обирає відділ: `Design` або `SMM`.
3. Обирає тип задачі зі згрупованого списку відповідного відділу.
4. Заповнює короткий бриф у модалці — поля залежать від типу задачі.
5. Бот створює сторінку в заданій Notion-базі та повертає посилання.
6. Фоновий поллер раз на 3 хвилини опитує Notion і надсилає у Slack апдейти при зміні статусу або появі нового відкритого коментаря.
7. Текстові відповіді користувача у Slack-треді задачі автоматично додаються як коментарі до відповідної Notion-сторінки. Файли в Slack не читаються; для матеріалів користувач додає посилання або відкриває задачу в Notion.

## Стек

- Node.js (ESM, `type: module`)
- [`@slack/bolt`](https://slack.dev/bolt-js/) — Slack App (HTTP mode)
- [`@notionhq/client`](https://developers.notion.com/) — створення сторінок і опитування БД
- [`@upstash/redis`](https://upstash.com/) — збереження мапінгу `slackUser ↔ notionPage`, останнього статусу й останнього побаченого коментаря
- `dotenv` — змінні оточення

## Структура

```
src/
├── index.js                 # Точка входу, запуск Bolt App (є stub-режим без токена)
├── config/
│   └── departments.js       # Конфіг відділів design/smm і місце під event/pr/employer_brand
├── handlers/
│   ├── newTask.js           # /new-task — відкриває модалку з вибором відділу/типу
│   ├── feedbackModal.js     # Модалка для раундів правок
│   ├── feedbackSubmission.js # Обробка сабміту правок
│   ├── resultAcceptance.js   # Прийняття результату та quality survey
│   ├── modalBlocks.js       # Блоки полів для кожного типу задачі
│   └── submission.js        # Обробка сабмітів модалок
├── notion/
│   ├── createPage.js        # Створення сторінки в Notion
│   ├── createSubitem.js     # Створення sub-item для правок
│   └── pollStatus.js        # Поллінг статусів (Design = 3 хв)
├── slack/
│   ├── home.js              # App Home tab
│   ├── taskEntry.js         # Стартові модалки вибору відділу й типу задачі
│   ├── notify.js            # DM-сповіщення про зміну статусу та нові коментарі
│   ├── threadComments.js    # Перенесення текстових відповідей зі Slack-треду в Notion
│   └── designerMentions.js  # Форматування згадок дизайнерів
└── redis/
    └── store.js             # Збереження/читання трекінгу задач
```

## Змінні оточення

Створи `.env` у корені (він у `.gitignore`) на базі `.env.example`.

Legacy Design змінні лишаються сумісними: якщо `NOTION_DESIGN_DATABASE_ID` не заданий, бот використовує `NOTION_DATABASE_ID`; якщо `NOTION_DESIGN_TEMPLATE_ID` не заданий, використовує `NOTION_TEMPLATE_ID`.

Phase 2 додає SMM-змінні поверх Design aliases і тестових safety-змінних. Event route для sandbox вмикається окремо, щоб production picker не показував його випадково:

- `NOTION_DESIGN_DATABASE_ID`, `NOTION_DESIGN_TEMPLATE_ID`, `NOTION_DESIGN_STATUS_PROPERTY`
- `NOTION_DESIGN_COMPLETED_STATUSES`, `NOTION_DESIGN_POLL_INTERVAL_SEC`
- `NOTION_ACTIVITIES_DATABASE_ID` або `NOTION_SMM_DATABASE_ID`
- `NOTION_SMM_STATUS_PROPERTY=SMM статус`, `NOTION_SMM_INITIAL_STATUS=To do`
- `NOTION_SMM_HUB_URL`, default `https://www.notion.so/SMM-Hub-375ce9899cb781aaab1ddb4c30833e23?source=copy_link`
- `NOTION_SMM_TASK_TEMPLATE_ID` або `NOTION_SMM_TEMPLATE_ID` для SMM template
- `NOTION_SMM_COMPLETED_STATUSES=Published,Canceled,Cancelled`
- `NOTION_SMM_QUALITY_SURVEY_STATUSES=Published`
- `NOTION_SMM_FEEDBACK_DATABASE_ID=025dce2c634e4a079ee7600ea8c63253`
- `NOTION_SMM_OWNER_ID`, `NOTION_SMM_OWNER_LABEL`, `NOTION_SMM_TEAM=SMM`
- `EVENT_DEPARTMENT_ENABLED=true` або `NOTION_EVENT_DATABASE_ID` — показати `Event` у Slack picker
- `NOTION_EVENT_DATABASE_ID` або `NOTION_ACTIVITIES_DATABASE_ID`
- `NOTION_EVENT_STATUS_PROPERTY`, default `SMM статус` для shared Activities sandbox
- `NOTION_EVENT_INITIAL_STATUS=To do`
- `NOTION_EVENT_COMPLETED_STATUSES=Done,Completed,Canceled,Cancelled`
- `NOTION_EVENT_HUB_URL`, `NOTION_EVENT_TASK_TEMPLATE_ID` / `NOTION_EVENT_TEMPLATE_ID`
- `NOTION_EVENT_OWNER_ID`, `NOTION_EVENT_OWNER_LABEL`, `NOTION_EVENT_TEAM=Event`
- `EVENT_CHANNEL_ID` або `SLACK_EVENT_NOTIFY_CHANNEL`
- `DESIGN_*_MIN_LEAD_DAYS` і `SMM_*_MIN_LEAD_DAYS` для SLA/late-перевірки дедлайнів
- `EVENT_*_MIN_LEAD_DAYS` для sandbox Event SLA/late-перевірки
- `REDIS_KEY_PREFIX` для тестового Redis namespace
- `TEST_TASK_PREFIX` для sandbox задач, наприклад `[ТЕСТ]`

Якщо `SLACK_BOT_TOKEN` не заданий або дорівнює `placeholder`, бот стартує у stub-режимі (простий HTTP-сервер), щоб процес не падав, поки чекаєш на апрув Slack App.
`DESIGN_CHANNEL_ID`, `SMM_CHANNEL_ID` і `SLACK_SMM_NOTIFY_CHANNEL` опційні: якщо канал не заданий, бот створюватиме задачі й писатиме автору в DM-тред, але не дублюватиме нові задачі в командний канал. Для поточного SMM-флоу канал не потрібен.

## Локальний запуск

```bash
npm install
npm start
```

За замовчуванням слухає `PORT=3000`. Для розробки з публічним URL використай ngrok / Cloudflare Tunnel і вкажи Request URL у налаштуваннях Slack App:

- `Event Subscriptions` → `https://<host>/slack/events`
- `Interactivity & Shortcuts` → `https://<host>/slack/events`
- `Slash Commands` → `/new-task` → `https://<host>/slack/events`

Додатковий endpoint для запусків із Notion:

- `POST https://<host>/notion/design-task-launch`

Webhook приймає payload із Notion, шукає ID батьківської задачі (`№ ID`, `No ID`, `ID`, `parentTaskId` або схожі вкладені поля) і зберігає launch context у Redis.

## Railway сервери

У цього репозиторію є два Railway-сервери: основний production bot і тестовий sandbox. Перед будь-якими логами, env-змінами або деплоєм завжди перевір `railway status`, щоб не оновити не той сервіс.

Основний сервер:

- Railway project: `responsible-healing`
- Railway service: `slack-notion-bot`
- Environment: `production`
- Public URL: `https://slack-notion-bot-production-9fff.up.railway.app`
- Slack Request URL для `Event Subscriptions`, `Interactivity & Shortcuts` і `/new-task`: `https://slack-notion-bot-production-9fff.up.railway.app/slack/events`
- CLI link: `railway link --project de592e69-4110-49c8-ba64-bc6304f00b88 --environment production --service 0583990d-380b-48ea-8748-21d1ef14942e`

Тестовий сервер:

- Railway project: `design-tasks-bot-phase1-test`
- Railway service: `design-tasks-bot-phase1-test`
- Environment: `production`
- Public URL: `https://design-tasks-bot-phase1-test-production.up.railway.app`
- Slack Request URL для тестового Slack app: `https://design-tasks-bot-phase1-test-production.up.railway.app/slack/events`
- CLI link: `railway link --project 100ff942-cd33-4cc8-8fe9-dfc27fe426ca --environment production --service e9a90e6b-10da-4e61-9945-3abaac66abdd`

Не записуй у README `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `NOTION_TOKEN` або Redis token. Для діагностики Slack `401` памʼятай: `xoxb` token перевіряє Slack API calls, а `401` на `/slack/events` зазвичай означає mismatch `SLACK_SIGNING_SECRET` між Slack app і Railway.

## Departments

Активний `departments` layer живе у `src/config/departments.js`. Ядро бота спільне: черга, Redis tracking, Notion polling, коментарі Slack ↔ Notion, правки, quality survey і webhook. Відділ задає тільки свою базу, статус, owner/team, інтервал полінгу, канал нотифікації та типи задач.

`design` бере ті самі значення, що й старий код:

- `notionDataSourceId`: `NOTION_DESIGN_DATABASE_ID` або legacy `NOTION_DATABASE_ID`
- `statusProperty`: `NOTION_DESIGN_STATUS_PROPERTY` або legacy `NOTION_STATUS_PROPERTY`
- `completedStatuses`: `NOTION_DESIGN_COMPLETED_STATUSES` або legacy `NOTION_POLL_COMPLETED_STATUSES`
- `pollIntervalSec`: `NOTION_DESIGN_POLL_INTERVAL_SEC`, default `180`
- `notifyChannel`: `DESIGN_CHANNEL_ID`
- `ownerId`: `NOTION_DESIGN_OWNER_ID` або старий owner id
- `taskTypes`: старі Design task type relation IDs
- `minLeadDays`: SLA з політики роботи з дизайн-запитами; якщо дедлайн ближчий, модалка запропонує змінити дату або відправити задачу як `late`

`smm` налаштований як greenfield-гілка:

- `notionDataSourceId`: `NOTION_SMM_DATABASE_ID`, або `NOTION_ACTIVITIES_DATABASE_ID`, або legacy `NOTION_DATABASE_ID`
- `statusProperty`: `NOTION_SMM_STATUS_PROPERTY`, default `SMM статус`
- `initialStatus`: `NOTION_SMM_INITIAL_STATUS`, default `To do`
- `completedStatuses`: `NOTION_SMM_COMPLETED_STATUSES`, default `Published,Canceled,Cancelled`
- `qualitySurveyStatuses`: `NOTION_SMM_QUALITY_SURVEY_STATUSES`, default `Published`
- `hubUrl`: `NOTION_SMM_HUB_URL`, default SMM Hub page, so task links open inside SMM Hub
- `feedbackDatabaseId`: `NOTION_SMM_FEEDBACK_DATABASE_ID`, default SMM feedback database
- `pollIntervalSec`: `NOTION_SMM_POLL_INTERVAL_SEC`, default `180`
- `ownerId`: Anna Gayuk by default, можна перевизначити через `NOTION_SMM_OWNER_ID`
- `team`: `SMM`
- `Description`: для SMM пишеться коротке `Опис нижче в тілі задачі.`, а сам бриф додається у body сторінки з секціями `Базові поля` і `Специфічні поля`
- `Late`: ставиться тільки коли користувач підтвердив запізний дедлайн у модалці

`event` є sandbox route для Phase 3 і прихований, поки не задано `EVENT_DEPARTMENT_ENABLED=true` або `NOTION_EVENT_DATABASE_ID`:

- `notionDataSourceId`: `NOTION_EVENT_DATABASE_ID`, або `NOTION_ACTIVITIES_DATABASE_ID`, або legacy `NOTION_DATABASE_ID`
- `statusProperty`: `NOTION_EVENT_STATUS_PROPERTY`, default `SMM статус` для тестів у shared Activities
- `initialStatus`: `NOTION_EVENT_INITIAL_STATUS`, default `To do`
- `completedStatuses`: `NOTION_EVENT_COMPLETED_STATUSES`, default `Done,Completed,Canceled,Cancelled`
- `team`: `Event`
- `useBodyBrief`: Event бриф пишеться в body сторінки, а `Description` лишається коротким
- `Event date`, `$ EB Budget` і `EB Activity Type` заповнюються, якщо такі properties є у Notion database

Redis tracking records now include `departmentKey`. Old records without this field are treated as `design`, so in-flight Design tasks do not need migration.

## Налаштування Slack App

Потрібні OAuth-скоупи: `commands`, `chat:write`, `im:write`, `im:history`, `users:read`, `users:read.email`.
Events: `app_home_opened`, `message.im`.
Slash command: `/new-task`.

SMM не потребує окремих department-specific OAuth scopes. `users:read.email` потрібен глобально, щоб бот міг зіставити Slack requester-а з Notion user і поставити його в `Owner`. Якщо `SMM_CHANNEL_ID` не заданий, бот працює тільки через DM-тред requester-а.

Не запитуються і не потрібні для поточної логіки: `im:read`, `mpim:history`, `files:read`, `app_mentions:read`.

### Long description для Slack App

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

### Scope justification для approval

`commands` — дозволяє користувачу викликати `/new-task`. Без цього Slack не доставить slash command payload у backend.

`chat:write` — дозволяє боту надсилати й оновлювати власні повідомлення: підтвердження створення задачі, статусні апдейти, повідомлення про помилки, тредові апдейти та quality survey. Incoming webhook не підходить, бо бот пише в персональні DM-треди, оновлює власні повідомлення та реагує на interactive actions.

`im:write` — дозволяє відкрити або отримати DM channel з користувачем, щоб доставити персональне повідомлення про його задачу. Scope використовується тільки для користувача, який створив задачу або пов'язаний зі збереженою Notion page.

`im:history` — дозволяє отримувати event `message.im` для текстових відповідей у DM-треді бота. Це потрібно, щоб користувач міг написати уточнення або коментар у треді задачі, а бот переніс цей текст у Notion-коментар. Бот ігнорує повідомлення поза DM і не читає group DM.

`users:read` — дозволяє отримати `real_name` / `display_name` користувача через `users.info`. Це потрібно, щоб у Notion було людське ім'я requester-а або автора коментаря, а не тільки Slack ID. Whitelist за поведінкою: тільки користувачі, які самі взаємодіють із ботом у межах створення або ведення задачі.

`users:read.email` — дозволяє отримати email requester-а через `users.info`. Бот використовує email лише під час створення задачі, щоб знайти Notion user з таким самим email і проставити його в people-property `Owner`; якщо збіг не знайдено, лишається дефолтний owner відділу.

Щоб користувачі могли писати в треді повідомлення від бота в App Home / DM:

1. Відкрий Slack App settings → **App Home**.
2. Увімкни **Messages Tab**.
3. Вимкни read-only режим для Messages Tab: користувачі мають мати змогу надсилати повідомлення до app.
4. Після зміни scopes або App Home settings зроби **Reinstall to Workspace**.

## Налаштування Notion

- Створи інтеграцію на https://www.notion.so/my-integrations, скопіюй токен у `NOTION_TOKEN`.
- Розшар базу задач з цією інтеграцією.
- Скопіюй `NOTION_DATABASE_ID` з URL бази або задай новий alias `NOTION_DESIGN_DATABASE_ID`.
- У базі має бути властивість `Design Status` типу *Status*. Якщо поле називається інакше, задай `NOTION_STATUS_PROPERTY` або `NOTION_DESIGN_STATUS_PROPERTY`.
- Щоб не впиратися в rate limit Notion, бот тротлить усі Notion API запити через `NOTION_REQUEST_MIN_INTERVAL_MS` і повторює `429 rate_limited` через `NOTION_REQUEST_MAX_RETRIES`.
- Для сповіщень про коментарі з Notion треба увімкнути capability `Read comments`, інакше бот автоматично залишить тільки статусні нотифікації.
- Для перенесення відповідей зі Slack-треду в Notion інтеграція має мати право створювати коментарі.
- Якщо хочеш, щоб нові задачі створювалися з готового Notion template, задай `NOTION_TEMPLATE_ID` для Design або `NOTION_SMM_TASK_TEMPLATE_ID` / `NOTION_SMM_TEMPLATE_ID` для SMM.
- Template застосовується асинхронно одразу після створення page. Це зручно для кейсу, де в template вже є нативна кнопка `Add subtask`.
- Для Design і SMM late-флоу пише у властивість `Late` (checkbox) у цільовій Notion-базі.
- Для SMM у Activities потрібні властивості `Team` (select з опцією `SMM`), `SMM статус` (select), `Owner` (people), `Late` (checkbox), `Deadline` (date), `Publication date` (date), `Platform` або `Platforms`, `Description` (rich text).
- Для Design опитування якості роботи надсилається на `Ready`. Для SMM `Ready` не завершує поллінг і не показує дизайн-кнопки правок; опитування надсилається на `Published`, а поллінг зупиняється на `Published` або `Canceled`.
- Для задач-правок у базі мають бути властивості `Parent item` (relation), `Sub-type` (select), `Description` (rich text) і, за потреби, `Тип правки`. Їхні назви можна змінити через `NOTION_PARENT_ITEM_PROPERTY`, `NOTION_SUB_TYPE_PROPERTY`, `NOTION_DESCRIPTION_PROPERTY` і `NOTION_FEEDBACK_TYPE_PROPERTY`.
- `NOTION_FEEDBACK_DATABASE_ID` використовується для запису quality feedback. Якщо не заданий, бот використовує дефолтну базу з коду; якщо інтеграція не має доступу до неї, фідбек залишиться тільки в Redis.

## Поведінка поллера

`startPolling` (див. `src/notion/pollStatus.js`) запускає окремий цикл для кожного активного відділу:

1. Тягне трекові задачі з Redis.
2. Фільтрує задачі за `departmentKey`; старі Redis-записи без `departmentKey` читаються як `design`.
3. Запитує поточні статуси з Notion-бази відділу.
4. Якщо статус відрізняється від збереженого — шле DM автору і оновлює Redis.
5. Перевіряє останній відкритий коментар у кожній задачі.
6. Якщо з'явився новий коментар — шле окремий DM автору і оновлює Redis.

Інтервали задаються через `NOTION_DESIGN_POLL_INTERVAL_SEC` і `NOTION_SMM_POLL_INTERVAL_SEC`, default `180`.

## Чернетки невдалих сабмітів

Якщо користувач заповнив бриф, але Notion відхилив створення задачі, бот зберігає чернетку в Redis під ключем `failed-submission:<draftId>`.
Користувач отримує `draftId` у Slack, а адмін може витягнути payload із Redis і вручну відновити задачу без повторного заповнення форми.
За замовчуванням чернетки зберігаються 30 днів; змінити TTL можна через `FAILED_SUBMISSION_TTL_SECONDS`.
Якщо задано `REDIS_KEY_PREFIX`, ключі створюються з цим префіксом.

## Черга створення задач

Після сабміту Slack-форму бот не тримає відкритою, поки Notion відповідає. Він одразу зберігає payload у Redis sorted set `task-submission-queue`, повідомляє користувачу, що задачу прийнято в чергу, а фоновий worker створює Notion page окремо.

Якщо Notion повертає `429 rate_limited` або тимчасову 5xx-помилку, worker відкладає наступну спробу. Кількість спроб задається `TASK_SUBMISSION_QUEUE_MAX_ATTEMPTS`, інтервали — `TASK_SUBMISSION_QUEUE_RETRY_DELAY_MS` і `TASK_SUBMISSION_QUEUE_MAX_RETRY_DELAY_MS`.

Під час старту worker також відновлює queue items, які були збережені як `task-submission-queue-item:*`, але випали з sorted set під час рестарту або деплою. Це не дає задачам зависати у статусі “прийнято в чергу”.

## Тестування

Для sandbox запуску використовуй той самий код і тільки інші env:

- тестовий Slack app/workspace token
- `REDIS_KEY_PREFIX=test:`
- `TEST_TASK_PREFIX=[ТЕСТ]`
- для Event sandbox: `EVENT_DEPARTMENT_ENABLED=true`
- живі Notion database IDs
- для Design і SMM: у відповідній Notion database є `Late` checkbox для late-флоу
- для SMM: Activities database, `Team=SMM`, `SMM статус`
- для Event: Activities/Event database, `Team=Event`, `Event date`, `$ EB Budget`, `EB Activity Type`

Усі тестові задачі мають починатися з `[ТЕСТ]`; бот додає цей префікс до title, якщо `TEST_TASK_PREFIX` заданий. Якщо в Notion-базі є checkbox або tag `Test`, бот спробує виставити його автоматично, але для SMM зараз достатньо тільки title-префікса. Після тесту знайди записи через `Name contains [ТЕСТ]` і видали вручну.

Фазовий rollout checklist лежить у `docs/departments-rollout-checklist.md`.

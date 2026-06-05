# Slack → Notion Design Tasks Bot

Slack-бот, який дозволяє дизайн-команді швидко приймати задачі через короткі брифи у Slack і автоматично створює сторінки в Notion. Коли статус задачі змінюється або в задачі з'являється новий відкритий коментар у Notion — автор отримує сповіщення назад у Slack.

У Phase 1 всередині коду вже є шар `departments`, але активний тільки `design`. Для користувачів Design UX має залишитися без змін: та сама `/new-task`, той самий вибір типу задачі, ті самі форми й та сама Notion-база.

## Як це працює

1. Користувач відкриває App Home або викликає команду `/new-task`.
2. Обирає тип задачі зі згрупованого списку (SMM, Promo, Монтаж, Презентації, ШІ-контент, Веб, Email, Мерч, Брендинг, Фото, TV/Івент, Інше).
3. Заповнює короткий бриф у модалці — поля залежать від типу задачі.
4. Бот створює сторінку в заданій Notion-базі та повертає посилання.
5. Фоновий поллер раз на 3 хвилини опитує Notion і надсилає у Slack апдейти при зміні статусу або появі нового відкритого коментаря.
6. Текстові відповіді користувача у Slack-треді задачі автоматично додаються як коментарі до відповідної Notion-сторінки. Файли в Slack не читаються; для матеріалів користувач додає посилання або відкриває задачу в Notion.

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
│   └── departments.js       # Phase 1: внутрішній конфіг єдиного відділу design
├── handlers/
│   ├── newTask.js           # /new-task — відкриває модалку з вибором типу
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
│   ├── home.js              # App Home tab + групи типів задач
│   ├── notify.js            # DM-сповіщення про зміну статусу та нові коментарі
│   ├── threadComments.js    # Перенесення текстових відповідей зі Slack-треду в Notion
│   └── designerMentions.js  # Форматування згадок дизайнерів
└── redis/
    └── store.js             # Збереження/читання трекінгу задач
```

## Змінні оточення

Створи `.env` у корені (він у `.gitignore`) на базі `.env.example`.

Legacy Design змінні лишаються сумісними: якщо `NOTION_DESIGN_DATABASE_ID` не заданий, бот використовує `NOTION_DATABASE_ID`; якщо `NOTION_DESIGN_TEMPLATE_ID` не заданий, використовує `NOTION_TEMPLATE_ID`.

Phase 1 додає тільки Design aliases і тестові safety-змінні:

- `NOTION_DESIGN_DATABASE_ID`, `NOTION_DESIGN_TEMPLATE_ID`, `NOTION_DESIGN_STATUS_PROPERTY`
- `NOTION_DESIGN_COMPLETED_STATUSES`, `NOTION_DESIGN_POLL_INTERVAL_SEC`
- `REDIS_KEY_PREFIX` для тестового Redis namespace
- `TEST_TASK_PREFIX` для sandbox задач, наприклад `[ТЕСТ]`

Якщо `SLACK_BOT_TOKEN` не заданий або дорівнює `placeholder`, бот стартує у stub-режимі (простий HTTP-сервер), щоб процес не падав, поки чекаєш на апрув Slack App.
`DESIGN_CHANNEL_ID` опційний: якщо його не задати, бот створюватиме задачі й писатиме автору, але не дублюватиме нові задачі в командний дизайн-канал.

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

## Departments

Phase 1 має внутрішній `departments` layer у `src/config/departments.js`, але активний тільки `design`.

`design` бере ті самі значення, що й старий код:

- `notionDataSourceId`: `NOTION_DESIGN_DATABASE_ID` або legacy `NOTION_DATABASE_ID`
- `statusProperty`: `NOTION_DESIGN_STATUS_PROPERTY` або legacy `NOTION_STATUS_PROPERTY`
- `completedStatuses`: `NOTION_DESIGN_COMPLETED_STATUSES` або legacy `NOTION_POLL_COMPLETED_STATUSES`
- `pollIntervalSec`: `NOTION_DESIGN_POLL_INTERVAL_SEC`, default `180`
- `notifyChannel`: `DESIGN_CHANNEL_ID`
- `ownerId`: `NOTION_DESIGN_OWNER_ID` або старий owner id
- `taskTypes`: старі Design task type relation IDs

Redis tracking records now include `departmentKey`. Old records without this field are treated as `design`, so in-flight Design tasks do not need migration.

## Налаштування Slack App

Потрібні OAuth-скоупи: `commands`, `chat:write`, `im:write`, `im:history`, `users:read`.
Events: `app_home_opened`, `message.im`.
Slash command: `/new-task`.

Не запитуються і не потрібні для поточної логіки: `im:read`, `mpim:history`, `files:read`, `app_mentions:read`.

### Long description для Slack App

```text
Design Tasks Bot допомагає команді швидко створювати дизайн-задачі зі Slack без ручного перенесення брифів у Notion.

Користувач відкриває App Home або викликає slash command /new-task, обирає тип задачі, заповнює короткий бриф у Slack modal, а бот створює відповідну сторінку в Notion database. Після створення задачі бот надсилає користувачу повідомлення в DM-треді з посиланням на Notion. Коли статус задачі або результат у Notion змінюється, бот оновлює Slack-тред і повідомляє автора задачі. Якщо користувач відповідає текстом у треді повідомлення бота, ця відповідь переноситься як коментар до відповідної Notion-сторінки.

Бот не читає публічні канали, приватні канали, групові DM або історію всього workspace. Бот не читає Slack-uploaded файли. Якщо користувачу потрібно передати матеріали, він додає посилання на Figma, Google Drive або інший ресурс у формі/треді, або відкриває створену задачу в Notion і додає матеріали там.

Permissions:
- commands: потрібен тільки для slash command /new-task, який відкриває форму створення дизайн-задачі.
- chat:write: потрібен, щоб бот міг надсилати користувачу підтвердження, статусні апдейти, повідомлення в треді задачі, quality survey та оновлювати власні повідомлення.
- im:write: потрібен, щоб бот міг створити або знайти DM-канал з користувачем і доставити персональні повідомлення про його задачу.
- im:history: потрібен тільки для читання текстових відповідей користувача в DM-треді повідомлення бота, щоб перенести ці відповіді в Notion як коментарі до конкретної задачі.
- users:read: потрібен, щоб отримати ім'я/display name користувача, який створив задачу або написав коментар у треді, і записати це ім'я в Notion замість технічного Slack ID.

User whitelist / data boundary:
- users:read використовується тільки для користувача, який сам взаємодіє з ботом: створює задачу через /new-task або App Home, натискає кнопку в повідомленні бота, залишає текстову відповідь у DM-треді задачі.
- im:history використовується тільки для DM-тредів повідомлень, які бот сам створив для конкретної задачі й зберіг у Redis як зв'язку Slack thread ↔ Notion page.
- chat:write та im:write використовуються тільки для повідомлень, пов'язаних із задачами цього бота.
```

### Scope justification для approval

`commands` — дозволяє користувачу викликати `/new-task`. Без цього Slack не доставить slash command payload у backend.

`chat:write` — дозволяє боту надсилати й оновлювати власні повідомлення: підтвердження створення задачі, статусні апдейти, повідомлення про помилки, тредові апдейти та quality survey. Incoming webhook не підходить, бо бот пише в персональні DM-треди, оновлює власні повідомлення та реагує на interactive actions.

`im:write` — дозволяє відкрити або отримати DM channel з користувачем, щоб доставити персональне повідомлення про його задачу. Scope використовується тільки для користувача, який створив задачу або пов'язаний зі збереженою Notion page.

`im:history` — дозволяє отримувати event `message.im` для текстових відповідей у DM-треді бота. Це потрібно, щоб користувач міг написати уточнення або коментар у треді задачі, а бот переніс цей текст у Notion-коментар. Бот ігнорує повідомлення поза DM і не читає group DM.

`users:read` — дозволяє отримати `real_name` / `display_name` користувача через `users.info`. Це потрібно, щоб у Notion було людське ім'я requester-а або автора коментаря, а не тільки Slack ID. Whitelist за поведінкою: тільки користувачі, які самі взаємодіють із ботом у межах створення або ведення задачі.

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
- Якщо хочеш, щоб нові задачі створювалися з готового Notion template, задай `NOTION_TEMPLATE_ID`.
- Template застосовується асинхронно одразу після створення page. Це зручно для кейсу, де в template вже є нативна кнопка `Add subtask`.
- Опитування якості роботи надсилається тільки коли статус задачі стає `Ready`. Інші завершальні статуси з `NOTION_POLL_COMPLETED_STATUSES` / `NOTION_DESIGN_COMPLETED_STATUSES` можуть зупиняти поллінг, але не запускають оцінку.
- Для задач-правок у базі мають бути властивості `Parent item` (relation), `Sub-type` (select), `Description` (rich text) і, за потреби, `Тип правки`. Їхні назви можна змінити через `NOTION_PARENT_ITEM_PROPERTY`, `NOTION_SUB_TYPE_PROPERTY`, `NOTION_DESCRIPTION_PROPERTY` і `NOTION_FEEDBACK_TYPE_PROPERTY`.
- `NOTION_FEEDBACK_DATABASE_ID` використовується для запису quality feedback. Якщо не заданий, бот використовує дефолтну базу з коду; якщо інтеграція не має доступу до неї, фідбек залишиться тільки в Redis.

## Поведінка поллера

`startPolling` (див. `src/notion/pollStatus.js`) у Phase 1 запускає цикл для `departments.design`:

1. Тягне трекові задачі з Redis.
2. Фільтрує Design задачі; старі Redis-записи без `departmentKey` читаються як `design`.
3. Запитує поточні статуси з Design Notion-бази.
4. Якщо статус відрізняється від збереженого — шле DM автору і оновлює Redis.
5. Перевіряє останній відкритий коментар у кожній задачі.
6. Якщо з'явився новий коментар — шле окремий DM автору і оновлює Redis.

Інтервал задається через `NOTION_DESIGN_POLL_INTERVAL_SEC`, default `180`.

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
- живі Notion database IDs

Усі тестові задачі мають починатися з `[ТЕСТ]`; бот додає цей префікс до title, якщо `TEST_TASK_PREFIX` заданий. Якщо в Notion-базі є checkbox або tag `Test`, бот спробує виставити його автоматично. Після тесту знайди записи через `Name contains [ТЕСТ]` і видали вручну.

Фазовий rollout checklist лежить у `docs/departments-rollout-checklist.md`.

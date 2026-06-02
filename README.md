# Slack → Notion Design Tasks Bot

Slack-бот, який дозволяє дизайн-команді швидко приймати задачі через короткі брифи у Slack і автоматично створює сторінки в Notion. Коли статус задачі змінюється або в задачі з'являється новий відкритий коментар у Notion — автор отримує сповіщення назад у Slack.

## Як це працює

1. Користувач відкриває App Home або викликає команду `/new-task`.
2. Обирає тип задачі зі згрупованого списку (SMM, Promo, Монтаж, Презентації, ШІ-контент, Веб, Email, Мерч, Брендинг, Фото, TV/Івент, Інше).
3. Заповнює короткий бриф у модалці — поля залежать від типу задачі.
4. Бот створює сторінку в заданій Notion-базі та повертає посилання.
5. Фоновий поллер раз на 3 хвилини опитує Notion і надсилає у Slack апдейти при зміні статусу або появі нового відкритого коментаря.
6. Відповіді користувача у Slack-треді задачі автоматично додаються як коментарі до відповідної Notion-сторінки.

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
├── handlers/
│   ├── newTask.js           # /new-task — відкриває модалку з вибором типу
│   ├── feedbackModal.js     # Модалка для раундів правок
│   ├── feedbackSubmission.js # Обробка сабміту правок
│   ├── modalBlocks.js       # Блоки полів для кожного типу задачі
│   └── submission.js        # Обробка сабмітів модалок
├── notion/
│   ├── createPage.js        # Створення сторінки в Notion
│   ├── createSubitem.js     # Створення sub-item для правок
│   └── pollStatus.js        # Поллінг статусів (інтервал 3 хв)
├── slack/
│   ├── home.js              # App Home tab + групи типів задач
│   └── notify.js            # DM-сповіщення про зміну статусу та нові коментарі
└── redis/
    └── store.js             # Збереження/читання трекінгу задач
```

## Змінні оточення

Створи `.env` у корені (він у `.gitignore`):

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
NOTION_TOKEN=secret_...
NOTION_DATABASE_ID=...
NOTION_TEMPLATE_ID=<id_твоього_notion_template>
NOTION_TEMPLATE_TIMEZONE=Europe/Kiev
NOTION_STATUS_PROPERTY=Design Status
NOTION_REQUEST_MIN_INTERVAL_MS=500
NOTION_REQUEST_MAX_RETRIES=4
NOTION_POLL_RATE_LIMIT_COOLDOWN_MS=600000
NOTION_POLL_COMPLETED_STATUSES=Ready
NOTION_FEEDBACK_DATABASE_ID=
TASK_SUBMISSION_QUEUE_INTERVAL_MS=5000
TASK_SUBMISSION_QUEUE_MAX_ATTEMPTS=20
TASK_SUBMISSION_QUEUE_RETRY_DELAY_MS=60000
TASK_SUBMISSION_QUEUE_MAX_RETRY_DELAY_MS=600000
NOTION_BRAND_DESIGN_HUB_URL=https://www.notion.so/Brand-Design-Hub-33cce9899cb7814488c0f439326aaf2a?source=copy_link
OPS_LEAD_SLACK_ID=U0APPD32H6D
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
FAILED_SUBMISSION_TTL_SECONDS=2592000
PORT=3000
```

Якщо `SLACK_BOT_TOKEN` не заданий або дорівнює `placeholder`, бот стартує у stub-режимі (простий HTTP-сервер), щоб процес не падав, поки чекаєш на апрув Slack App.

## Локальний запуск

```bash
npm install
npm start
```

За замовчуванням слухає `PORT=3000`. Для розробки з публічним URL використай ngrok / Cloudflare Tunnel і вкажи Request URL у налаштуваннях Slack App:

- `Event Subscriptions` → `https://<host>/slack/events`
- `Interactivity & Shortcuts` → `https://<host>/slack/events`
- `Slash Commands` → `/new-task` → `https://<host>/slack/events`

## Налаштування Slack App

Потрібні OAuth-скоупи (як мінімум): `commands`, `chat:write`, `im:write`, `im:history`, `users:read`, `app_mentions:read`.
Events: `app_home_opened`, `message.im`.
Slash command: `/new-task`.

Щоб користувачі могли писати в треді повідомлення від бота в App Home / DM:

1. Відкрий Slack App settings → **App Home**.
2. Увімкни **Messages Tab**.
3. Вимкни read-only режим для Messages Tab: користувачі мають мати змогу надсилати повідомлення до app.
4. Після зміни scopes або App Home settings зроби **Reinstall to Workspace**.

## Налаштування Notion

- Створи інтеграцію на https://www.notion.so/my-integrations, скопіюй токен у `NOTION_TOKEN`.
- Розшар базу задач з цією інтеграцією.
- Скопіюй `NOTION_DATABASE_ID` з URL бази.
- У базі має бути властивість `Design Status` типу *Status*. Якщо поле називається інакше, задай `NOTION_STATUS_PROPERTY`.
- Щоб не впиратися в rate limit Notion, бот тротлить усі Notion API запити через `NOTION_REQUEST_MIN_INTERVAL_MS` і повторює `429 rate_limited` через `NOTION_REQUEST_MAX_RETRIES`.
- Для сповіщень про коментарі з Notion треба увімкнути capability `Read comments`, інакше бот автоматично залишить тільки статусні нотифікації.
- Для перенесення відповідей зі Slack-треду в Notion інтеграція має мати право створювати коментарі.
- Якщо хочеш, щоб нові задачі створювалися з готового Notion template, задай `NOTION_TEMPLATE_ID`.
- Template застосовується асинхронно одразу після створення page. Це зручно для кейсу, де в template вже є нативна кнопка `Add subtask`.
- Опитування якості роботи надсилається тільки коли статус задачі стає `Ready`. Інші завершальні статуси з `NOTION_POLL_COMPLETED_STATUSES` можуть зупиняти поллінг, але не запускають оцінку.

## Поведінка поллера

`startPolling` (див. `src/notion/pollStatus.js`) щохвилини × 3:

1. Тягне трекові задачі з Redis.
2. Запитує поточні статуси з Notion.
3. Якщо статус відрізняється від збереженого — шле DM автору і оновлює Redis.
4. Перевіряє останній відкритий коментар у кожній задачі.
5. Якщо з'явився новий коментар — шле окремий DM автору і оновлює Redis.

## Чернетки невдалих сабмітів

Якщо користувач заповнив бриф, але Notion відхилив створення задачі, бот зберігає чернетку в Redis під ключем `failed-submission:<draftId>`.
Користувач отримує `draftId` у Slack, а адмін може витягнути payload із Redis і вручну відновити задачу без повторного заповнення форми.
За замовчуванням чернетки зберігаються 30 днів; змінити TTL можна через `FAILED_SUBMISSION_TTL_SECONDS`.

## Черга створення задач

Після сабміту Slack-форму бот не тримає відкритою, поки Notion відповідає. Він одразу зберігає payload у Redis sorted set `task-submission-queue`, повідомляє користувачу, що задачу прийнято в чергу, а фоновий worker створює Notion page окремо.

Якщо Notion повертає `429 rate_limited` або тимчасову 5xx-помилку, worker відкладає наступну спробу. Кількість спроб задається `TASK_SUBMISSION_QUEUE_MAX_ATTEMPTS`, інтервали — `TASK_SUBMISSION_QUEUE_RETRY_DELAY_MS` і `TASK_SUBMISSION_QUEUE_MAX_RETRY_DELAY_MS`.

Під час старту worker також відновлює queue items, які були збережені як `task-submission-queue-item:*`, але випали з sorted set під час рестарту або деплою. Це не дає задачам зависати у статусі “прийнято в чергу”.

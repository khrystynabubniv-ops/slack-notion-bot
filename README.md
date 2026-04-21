# Slack → Notion Design Tasks Bot

Slack-бот, який дозволяє дизайн-команді швидко приймати задачі через короткі брифи у Slack і автоматично створює сторінки в Notion. Коли статус задачі змінюється в Notion — автор отримує сповіщення назад у Slack.

## Як це працює

1. Користувач відкриває App Home або викликає команду `/new-task`.
2. Обирає тип задачі зі згрупованого списку (SMM, Promo, Монтаж, Презентації, ШІ-контент, Веб, Email, Мерч, Брендинг, Фото, TV/Івент, Інше).
3. Заповнює короткий бриф у модалці — поля залежать від типу задачі.
4. Бот створює сторінку в заданій Notion-базі та повертає посилання.
5. Фоновий поллер раз на 3 хвилини опитує Notion і надсилає у Slack апдейти при зміні статусу.

## Стек

- Node.js (ESM, `type: module`)
- [`@slack/bolt`](https://slack.dev/bolt-js/) — Slack App (HTTP mode)
- [`@notionhq/client`](https://developers.notion.com/) — створення сторінок і опитування БД
- [`@upstash/redis`](https://upstash.com/) — збереження мапінгу `slackUser ↔ notionPage` і останнього статусу
- `dotenv` — змінні оточення

## Структура

```
src/
├── index.js                 # Точка входу, запуск Bolt App (є stub-режим без токена)
├── handlers/
│   ├── newTask.js           # /new-task — відкриває модалку з вибором типу
│   ├── modalBlocks.js       # Блоки полів для кожного типу задачі
│   └── submission.js        # Обробка сабмітів модалок
├── notion/
│   ├── createPage.js        # Створення сторінки в Notion
│   └── pollStatus.js        # Поллінг статусів (інтервал 3 хв)
├── slack/
│   ├── home.js              # App Home tab + групи типів задач
│   └── notify.js            # DM-сповіщення про зміну статусу
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
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
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

Потрібні OAuth-скоупи (як мінімум): `commands`, `chat:write`, `im:write`, `users:read`, `app_mentions:read`.
Events: `app_home_opened`.
Slash command: `/new-task`.

## Налаштування Notion

- Створи інтеграцію на https://www.notion.so/my-integrations, скопіюй токен у `NOTION_TOKEN`.
- Розшар базу задач з цією інтеграцією.
- Скопіюй `NOTION_DATABASE_ID` з URL бази.
- У базі має бути властивість `Status` типу *Status* (поллер фільтрує `does_not_equal: Done`).

## Поведінка поллера

`startPolling` (див. `src/notion/pollStatus.js`) щохвилини × 3:

1. Тягне трекові задачі з Redis.
2. Запитує поточні статуси з Notion (окрім `Done`).
3. Якщо статус відрізняється від збереженого — шле DM автору і оновлює Redis.

## Ліцензія

Internal / private.

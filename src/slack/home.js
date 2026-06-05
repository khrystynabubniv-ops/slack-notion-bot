import { DEFAULT_DEPARTMENT_KEY, getTaskTypeGroups as getConfiguredTaskTypeGroups } from '../config/departments.js'

export function registerHomeTab(app) {
  app.event('app_home_opened', async ({ event, client }) => {
    await client.views.publish({
      user_id: event.user,
      view: {
        type: 'home',
        blocks: [
          // Hero
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*👋 Привіт! Це Design Tasks Bot*\nЯ допоможу швидко поставити задачу дизайн-команді — без зайвих питань у Slack.',
            },
          },
          { type: 'divider' },

          // CTA button
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '🚀 *Постав нову задачу дизайнерам*\nЗаповни короткий бриф — команда отримає всю потрібну інформацію одразу.',
            },
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: '➕ Створити задачу', emoji: true },
              style: 'primary',
              action_id: 'open_new_task_from_home',
            },
          },
          { type: 'divider' },

          // How it works
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*⚙️ Як це працює?*',
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: '*1️⃣ Вибери тип задачі*\nСтатика, відео, презентація, мерч тощо' },
              { type: 'mrkdwn', text: '*2️⃣ Заповни бриф*\nТільки потрібні поля для твого типу задачі' },
            ],
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: '*3️⃣ Задача створюється в Notion*\nОтримаєш посилання одразу після відправки' },
              { type: 'mrkdwn', text: '*4️⃣ Отримуй апдейти в Slack*\nБот повідомить коли статус задачі зміниться' },
            ],
          },
          { type: 'divider' },

          // Categories
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*📋 Які задачі можна поставити?*',
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: '🖼 *SMM / Банери*\nСтатика, карусель, промо, ресайзи' },
              { type: 'mrkdwn', text: '📣 *Promo Creatives*\nПромо по шаблону, нові ідеї (Static / Mix / Video)' },
            ],
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: '🎬 *Монтаж / Анімація*\nПростий або складний монтаж відео' },
              { type: 'mrkdwn', text: '📊 *Презентації*\nКоригування, по шаблону, wow-презентація' },
            ],
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: '🤖 *ШІ-контент*\nСтатика і динаміка, проста і складна' },
              { type: 'mrkdwn', text: '🌐 *Веб*\nЛендинги, блог' },
            ],
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: '👕 *Мерч / Поліграфія*\nМерч, друковані матеріали (постер, флаєр, брошура)' },
              { type: 'mrkdwn', text: '🎯 *Брендинг*\nАйдентика, логотип' },
            ],
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: '📷 *Фото*\nПросте і складне редагування' },
              { type: 'mrkdwn', text: '📺 *TV / Івент*\nАнонси, UniTV, івенти' },
            ],
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: '📰 *Email / Дайджест*\nБазовий, wow, email-дайджест' },
              { type: 'mrkdwn', text: '💡 *Інше*\nБудь-яка нетипова задача' },
            ],
          },
          { type: 'divider' },

          // Tips
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*💡 Поради для швидкого брифу*\n• Додай посилання на референси — це прискорює роботу дизайнера\n• Вкажи дедлайн із запасом\n• Якщо маєш файли — додай посилання в брифі або відкрий задачу в Notion після створення',
            },
          },
          { type: 'divider' },

          // Footer
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: '🔧 Питання по боту? Звертайся до адміна · Design Tasks Bot v2.0',
              },
            ],
          },
        ],
      },
    })
  })

  // Handle button click from Home Tab
  app.action('open_new_task_from_home', async ({ ack, body, client }) => {
    await ack()
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'select_task_type',
        title: { type: 'plain_text', text: '🎨 Нова задача' },
        submit: { type: 'plain_text', text: 'Далі →' },
        close: { type: 'plain_text', text: 'Скасувати' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'Обери тип задачі — далі побачиш потрібні поля для брифу.',
            },
          },
          {
            type: 'input',
            block_id: 'task_type_block',
            label: { type: 'plain_text', text: 'Тип задачі' },
            element: getTaskTypeSelect(),
          },
        ],
      },
    })
  })
}

// Reusable task type select (same options as newTask.js)
export function getTaskTypeSelect(departmentKey = DEFAULT_DEPARTMENT_KEY) {
  return {
    type: 'static_select',
    action_id: 'task_type',
    placeholder: { type: 'plain_text', text: 'Вибери тип...' },
    option_groups: getTaskTypeGroups(departmentKey),
  }
}

export function getTaskTypeGroups(departmentKey = DEFAULT_DEPARTMENT_KEY) {
  return getConfiguredTaskTypeGroups(departmentKey)
}

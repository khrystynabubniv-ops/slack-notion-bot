import { DEFAULT_DEPARTMENT_KEY, getTaskTypeGroups as getConfiguredTaskTypeGroups } from '../config/departments.js'
import { buildInitialTaskEntryView } from './taskEntry.js'

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
              text: '*👋 Привіт! Це PR & Comms Bot*\nДопоможу швидко передати запит PR & Comms команді: зберу бриф, створю задачу в Notion і надішлю апдейти в Slack.',
            },
          },
          { type: 'divider' },

          // CTA button
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '🚀 *Створити новий запит*\nОбери тип задачі, заповни коротку форму — і команда одразу отримає потрібний контекст.',
            },
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: '➕ Створити запит', emoji: true },
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
              { type: 'mrkdwn', text: '*1️⃣ Обери тип запиту*\nАнонс, текст, медіа, івент або інше' },
              { type: 'mrkdwn', text: '*2️⃣ Заповни бриф*\nДодай контекст, дедлайн і матеріали' },
            ],
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: '*3️⃣ Отримай задачу в Notion*\nПісля відправки прийде посилання' },
              { type: 'mrkdwn', text: '*4️⃣ Слідкуй за апдейтами*\nСтатуси й коментарі прийдуть у Slack' },
            ],
          },
          { type: 'divider' },

          // Use cases
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*📋 З чим можна звернутися?*',
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: '📣 *Анонси та новини*\nЗапуски, оновлення, важливі повідомлення' },
              { type: 'mrkdwn', text: '✍️ *Тексти й редактура*\nПости, статті, описи, email-тексти' },
              { type: 'mrkdwn', text: '🎤 *PR та медіа-запити*\nПресрелізи, коментарі, публічні матеріали' },
              { type: 'mrkdwn', text: '💡 *Інше*\nНетипові PR/Comms задачі' },
            ],
          },
          { type: 'divider' },

          // Tips
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*💡 Для швидкого старту*\nДодай контекст, дедлайн, потрібний формат результату й посилання на матеріали.',
            },
          },
          { type: 'divider' },

          // Footer
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: '🔧 Питання по боту? Звертайся до адміна · PR & Comms Bot',
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
      view: buildInitialTaskEntryView(),
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

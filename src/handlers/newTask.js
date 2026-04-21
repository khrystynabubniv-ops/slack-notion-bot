import { getTaskTypeGroups } from '../slack/home.js'

export function registerNewTaskCommand(app) {
  app.command('/new-task', async ({ ack, client, body }) => {
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
            element: {
              type: 'static_select',
              action_id: 'task_type',
              placeholder: { type: 'plain_text', text: 'Вибери тип...' },
              option_groups: getTaskTypeGroups(),
            },
          },
        ],
      },
    })
  })
}

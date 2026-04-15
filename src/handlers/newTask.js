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
              option_groups: [
                {
                  label: { type: 'plain_text', text: '🖼 SMM / Банери' },
                  options: [
                    { text: { type: 'plain_text', text: 'Статична картинка проста' }, value: 'static_simple' },
                    { text: { type: 'plain_text', text: 'Статична картинка складна' }, value: 'static_complex' },
                    { text: { type: 'plain_text', text: 'SMM карусель' }, value: 'carousel' },
                    { text: { type: 'plain_text', text: 'SMM промо по шаблону' }, value: 'promo_template' },
                    { text: { type: 'plain_text', text: 'SMM промо нові ідеї' }, value: 'promo_new' },
                    { text: { type: 'plain_text', text: 'SMM ресайзи' }, value: 'resize' },
                  ],
                },
                {
                  label: { type: 'plain_text', text: '🎬 Відео' },
                  options: [
                    { text: { type: 'plain_text', text: 'Монтаж відео простий' }, value: 'video_simple' },
                    { text: { type: 'plain_text', text: 'Монтаж відео складний / ШІ' }, value: 'video_complex' },
                  ],
                },
                {
                  label: { type: 'plain_text', text: '📊 Презентації' },
                  options: [
                    { text: { type: 'plain_text', text: 'Презентація (коригування існуючого)' }, value: 'pres_edit' },
                    { text: { type: 'plain_text', text: 'Презентація по шаблону' }, value: 'pres_template' },
                    { text: { type: 'plain_text', text: 'Wow презентація' }, value: 'pres_wow' },
                  ],
                },
                {
                  label: { type: 'plain_text', text: '🤖 ШІ-контент' },
                  options: [
                    { text: { type: 'plain_text', text: 'ШІ статика проста' }, value: 'ai_static_simple' },
                    { text: { type: 'plain_text', text: 'ШІ статика складна' }, value: 'ai_static_complex' },
                    { text: { type: 'plain_text', text: 'ШІ динаміка проста' }, value: 'ai_dynamic_simple' },
                    { text: { type: 'plain_text', text: 'ШІ динаміка складна' }, value: 'ai_dynamic_complex' },
                  ],
                },
                {
                  label: { type: 'plain_text', text: '🌐 Веб' },
                  options: [
                    { text: { type: 'plain_text', text: 'Лендинг по шаблону' }, value: 'landing_template' },
                    { text: { type: 'plain_text', text: 'Wow лендинг з нуля' }, value: 'landing_wow' },
                    { text: { type: 'plain_text', text: 'Верстка блогу' }, value: 'blog' },
                  ],
                },
                {
                  label: { type: 'plain_text', text: '📰 Email / Дайджест' },
                  options: [
                    { text: { type: 'plain_text', text: 'Дайджест базовий по шаблону' }, value: 'digest_simple' },
                    { text: { type: 'plain_text', text: 'Wow дайджест' }, value: 'digest_wow' },
                    { text: { type: 'plain_text', text: 'Email дайджест' }, value: 'email_digest' },
                  ],
                },
                {
                  label: { type: 'plain_text', text: '👕 Мерч / Поліграфія' },
                  options: [
                    { text: { type: 'plain_text', text: 'Мерч простий' }, value: 'merch_simple' },
                    { text: { type: 'plain_text', text: 'Мерч по референсах' }, value: 'merch_ref' },
                    { text: { type: 'plain_text', text: 'Мерч з власним рісьорчем' }, value: 'merch_research' },
                  ],
                },
                {
                  label: { type: 'plain_text', text: '🎯 Брендинг' },
                  options: [
                    { text: { type: 'plain_text', text: 'Айдентика' }, value: 'identity' },
                    { text: { type: 'plain_text', text: 'Логотип' }, value: 'logo' },
                  ],
                },
                {
                  label: { type: 'plain_text', text: '📷 Фото' },
                  options: [
                    { text: { type: 'plain_text', text: 'Редагування фото просте' }, value: 'photo_simple' },
                    { text: { type: 'plain_text', text: 'Редагування фото складне' }, value: 'photo_complex' },
                  ],
                },
                {
                  label: { type: 'plain_text', text: '📺 TV / Івент' },
                  options: [
                    { text: { type: 'plain_text', text: 'Анонси TV' }, value: 'tv_announce' },
                    { text: { type: 'plain_text', text: 'Статика UniTV' }, value: 'tv_static' },
                    { text: { type: 'plain_text', text: 'Івент простий' }, value: 'event_simple' },
                    { text: { type: 'plain_text', text: 'Івент складний' }, value: 'event_complex' },
                  ],
                },
              ],
            },
          },
        ],
      },
    })
  })
}
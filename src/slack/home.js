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
              text: '*💡 Поради для швидкого брифу*\n• Додай посилання на референси — це прискорює роботу дизайнера\n• Вкажи дедлайн із запасом\n• Якщо маєш файли — поділись ними зі мною в DM після створення задачі',
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
export function getTaskTypeSelect() {
  return {
    type: 'static_select',
    action_id: 'task_type',
    placeholder: { type: 'plain_text', text: 'Вибери тип...' },
    option_groups: getTaskTypeGroups(),
  }
}

export function getTaskTypeGroups() {
  return [
    {
      label: { type: 'plain_text', text: '🖼 SMM / Банери' },
      options: [
        { text: { type: 'plain_text', text: 'Статична картинка проста' }, value: 'static_simple' },
        { text: { type: 'plain_text', text: 'Статична картинка складна' }, value: 'static_complex' },
        { text: { type: 'plain_text', text: 'SMM карусель' }, value: 'carousel' },
        { text: { type: 'plain_text', text: 'SMM ресайзи' }, value: 'resize' },
      ],
    },
    {
      label: { type: 'plain_text', text: '📣 Promo Creatives' },
      options: [
        { text: { type: 'plain_text', text: 'Promo Creo Static (по шаблону)' }, value: 'promo_creo_static_template' },
        { text: { type: 'plain_text', text: 'Promo Creo Static (нові ідеї)' }, value: 'promo_creo_static_ideas' },
        { text: { type: 'plain_text', text: 'Promo Creo Mix (по шаблону)' }, value: 'promo_creo_mix_template' },
        { text: { type: 'plain_text', text: 'Promo Creo Mix (нові ідеї)' }, value: 'promo_creo_mix_ideas' },
        { text: { type: 'plain_text', text: 'Promo Creo Video (по шаблону)' }, value: 'promo_creo_video_template' },
        { text: { type: 'plain_text', text: 'Promo Creo Video (нові ідеї)' }, value: 'promo_creo_video_ideas' },
      ],
    },
    {
      label: { type: 'plain_text', text: '🎬 Монтаж / Анімація' },
      options: [
        { text: { type: 'plain_text', text: 'Монтаж / Анімація простий' }, value: 'video_simple' },
        { text: { type: 'plain_text', text: 'Монтаж / Анімація складний' }, value: 'video_complex' },
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
        { text: { type: 'plain_text', text: 'Друковані матеріали (постер, флаєр, брошура)' }, value: 'print_materials' },
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
    {
      label: { type: 'plain_text', text: '💡 Інше' },
      options: [
        { text: { type: 'plain_text', text: 'Інша задача / нетиповий запит' }, value: 'other' },
      ],
    },
  ]
}

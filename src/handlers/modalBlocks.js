// Базові поля — є у всіх типах задач
function baseBlocks() {
  return [
    {
      type: 'input',
      block_id: 'name_block',
      label: { type: 'plain_text', text: '📌 Назва задачі *' },
      element: {
        type: 'plain_text_input',
        action_id: 'name',
        placeholder: { type: 'plain_text', text: 'Банер для посту про Summer Camp' },
      },
    },
    {
      type: 'input',
      block_id: 'priority_block',
      label: { type: 'plain_text', text: '🔥 Пріоритет *' },
      element: {
        type: 'static_select',
        action_id: 'priority',
        placeholder: { type: 'plain_text', text: 'Вибери пріоритет...' },
        options: [
          { text: { type: 'plain_text', text: 'Low' }, value: 'Low' },
          { text: { type: 'plain_text', text: 'Planned' }, value: 'Planned' },
          { text: { type: 'plain_text', text: 'This week' }, value: 'This week' },
          { text: { type: 'plain_text', text: 'Urgent' }, value: 'Urgent' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'deadline_block',
      label: { type: 'plain_text', text: '📅 Дедлайн *' },
      element: {
        type: 'datepicker',
        action_id: 'deadline',
        placeholder: { type: 'plain_text', text: 'Вибери дату...' },
      },
    },
    {
      type: 'input',
      block_id: 'context_block',
      label: { type: 'plain_text', text: '💬 Контекст *' },
      hint: { type: 'plain_text', text: 'Для чого це потрібно? Як буде використовуватись? Яка емоція?' },
      element: {
        type: 'plain_text_input',
        action_id: 'context',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Це для Instagram-посту до Дня компанії. Основна емоція — гордість і тепло. Ресурс — сторіс та пост.' },
      },
    },
    {
      type: 'input',
      block_id: 'style_block',
      label: { type: 'plain_text', text: '🎨 Стиль / Референси' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'style',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Референс: figma.com/... Хочемо щось у дусі цього, але з нашими кольорами' },
      },
    },
    {
      type: 'input',
      block_id: 'antiref_block',
      label: { type: 'plain_text', text: '🚫 Антиреференси' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'antiref',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Нічого занадто мінімалістичного, без чорного фону' },
      },
    },
    {
      type: 'input',
      block_id: 'can_edit_block',
      label: { type: 'plain_text', text: '✏️ Дизайнер може правити текст?' },
      optional: true,
      element: {
        type: 'static_select',
        action_id: 'can_edit',
        placeholder: { type: 'plain_text', text: 'Вибери...' },
        options: [
          { text: { type: 'plain_text', text: 'Так' }, value: 'Так' },
          { text: { type: 'plain_text', text: 'Ні' }, value: 'Ні' },
        ],
      },
    },
  ]
}

// Роздільник між базовими і специфічними полями
function divider() {
  return { type: 'divider' }
}

// Специфічні поля по типах
const specificBlocks = {

  static_simple: [
    {
      type: 'input',
      block_id: 'format_block',
      label: { type: 'plain_text', text: '📐 Формат і платформа *' },
      element: {
        type: 'static_select',
        action_id: 'format',
        placeholder: { type: 'plain_text', text: 'Вибери формат...' },
        options: [
          { text: { type: 'plain_text', text: 'Static Image' }, value: 'Static Image' },
          { text: { type: 'plain_text', text: 'Poster' }, value: 'Poster' },
          { text: { type: 'plain_text', text: 'Flyer' }, value: 'Flyer' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'platform_block',
      label: { type: 'plain_text', text: '📱 Платформа *' },
      element: {
        type: 'static_select',
        action_id: 'platform',
        placeholder: { type: 'plain_text', text: 'Вибери платформу...' },
        options: [
          { text: { type: 'plain_text', text: 'Instagram' }, value: 'Instagram' },
          { text: { type: 'plain_text', text: 'LinkedIn' }, value: 'LinkedIn' },
          { text: { type: 'plain_text', text: 'Facebook' }, value: 'Facebook' },
          { text: { type: 'plain_text', text: 'TikTok' }, value: 'TikTok' },
          { text: { type: 'plain_text', text: 'Email' }, value: 'Email' },
          { text: { type: 'plain_text', text: 'Print' }, value: 'Print' },
          { text: { type: 'plain_text', text: 'Corpsite' }, value: 'Corpsite' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'message_block',
      label: { type: 'plain_text', text: '💬 Ключове повідомлення / CTA *' },
      element: {
        type: 'plain_text_input',
        action_id: 'message',
        placeholder: { type: 'plain_text', text: 'Реєструйся до 20 квітня' },
      },
    },
    {
      type: 'input',
      block_id: 'size_block',
      label: { type: 'plain_text', text: '📏 Розміри або орієнтація' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'size',
        placeholder: { type: 'plain_text', text: '1080×1080 / квадрат / горизонталь' },
      },
    },
    {
      type: 'input',
      block_id: 'accent_block',
      label: { type: 'plain_text', text: '🎯 Основний акцент' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'accent',
        placeholder: { type: 'plain_text', text: 'фото спікера / заголовок / логотип' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_drive_block',
      label: { type: 'plain_text', text: '📎 Текст, фото, референси (Google Drive / Figma)' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_drive',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],

  static_complex: [
    {
      type: 'input',
      block_id: 'format_block',
      label: { type: 'plain_text', text: '📐 Формат *' },
      element: {
        type: 'static_select',
        action_id: 'format',
        placeholder: { type: 'plain_text', text: 'Вибери формат...' },
        options: [
          { text: { type: 'plain_text', text: 'Static Image' }, value: 'Static Image' },
          { text: { type: 'plain_text', text: 'Poster' }, value: 'Poster' },
          { text: { type: 'plain_text', text: 'Flyer' }, value: 'Flyer' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'platform_block',
      label: { type: 'plain_text', text: '📱 Платформа *' },
      element: {
        type: 'static_select',
        action_id: 'platform',
        placeholder: { type: 'plain_text', text: 'Вибери платформу...' },
        options: [
          { text: { type: 'plain_text', text: 'Instagram' }, value: 'Instagram' },
          { text: { type: 'plain_text', text: 'LinkedIn' }, value: 'LinkedIn' },
          { text: { type: 'plain_text', text: 'Facebook' }, value: 'Facebook' },
          { text: { type: 'plain_text', text: 'Print' }, value: 'Print' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'message_block',
      label: { type: 'plain_text', text: '💬 Ключове повідомлення *' },
      element: {
        type: 'plain_text_input',
        action_id: 'message',
        placeholder: { type: 'plain_text', text: 'Головний меседж банера' },
      },
    },
    {
      type: 'input',
      block_id: 'output_format_block',
      label: { type: 'plain_text', text: '📄 Формат файлу на виході *' },
      element: {
        type: 'static_select',
        action_id: 'output_format',
        placeholder: { type: 'plain_text', text: 'Вибери...' },
        options: [
          { text: { type: 'plain_text', text: 'PNG' }, value: 'PNG' },
          { text: { type: 'plain_text', text: 'JPG' }, value: 'JPG' },
          { text: { type: 'plain_text', text: 'PDF' }, value: 'PDF' },
          { text: { type: 'plain_text', text: 'SVG' }, value: 'SVG' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'color_model_block',
      label: { type: 'plain_text', text: '🎨 Кольорова модель' },
      optional: true,
      element: {
        type: 'static_select',
        action_id: 'color_model',
        placeholder: { type: 'plain_text', text: 'Вибери...' },
        options: [
          { text: { type: 'plain_text', text: 'RGB (digital)' }, value: 'RGB' },
          { text: { type: 'plain_text', text: 'CMYK (друк)' }, value: 'CMYK' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'artifact_drive_block',
      label: { type: 'plain_text', text: '📎 Текст, фото, референси (Google Drive / Figma)' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_drive',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],

  carousel: [
    {
      type: 'input',
      block_id: 'slides_count_block',
      label: { type: 'plain_text', text: '🔢 Кількість слайдів *' },
      element: {
        type: 'plain_text_input',
        action_id: 'slides_count',
        placeholder: { type: 'plain_text', text: '5' },
      },
    },
    {
      type: 'input',
      block_id: 'slides_text_block',
      label: { type: 'plain_text', text: '📝 Тема і текст по кожному слайду *' },
      element: {
        type: 'plain_text_input',
        action_id: 'slides_text',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Слайд 1: Заголовок\nСлайд 2: Текст про...' },
      },
    },
    {
      type: 'input',
      block_id: 'format_block',
      label: { type: 'plain_text', text: '📐 Формат' },
      optional: true,
      element: {
        type: 'static_select',
        action_id: 'format',
        placeholder: { type: 'plain_text', text: 'Вибери...' },
        options: [
          { text: { type: 'plain_text', text: 'Carousel' }, value: 'Carousel' },
        ],
        initial_option: { text: { type: 'plain_text', text: 'Carousel' }, value: 'Carousel' },
      },
    },
    {
      type: 'input',
      block_id: 'platform_block',
      label: { type: 'plain_text', text: '📱 Платформа' },
      optional: true,
      element: {
        type: 'static_select',
        action_id: 'platform',
        placeholder: { type: 'plain_text', text: 'Вибери...' },
        options: [
          { text: { type: 'plain_text', text: 'Instagram' }, value: 'Instagram' },
          { text: { type: 'plain_text', text: 'LinkedIn' }, value: 'LinkedIn' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'artifact_drive_block',
      label: { type: 'plain_text', text: '📎 Фото, референси (Google Drive)' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_drive',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],

  promo_template: [
    {
      type: 'input',
      block_id: 'slides_text_block',
      label: { type: 'plain_text', text: '📝 Текст для розміщення *' },
      element: {
        type: 'plain_text_input',
        action_id: 'slides_text',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Junior Python Developer · Remote · до 15 травня' },
      },
    },
    {
      type: 'input',
      block_id: 'platform_block',
      label: { type: 'plain_text', text: '📱 Платформа *' },
      element: {
        type: 'static_select',
        action_id: 'platform',
        placeholder: { type: 'plain_text', text: 'Вибери...' },
        options: [
          { text: { type: 'plain_text', text: 'Instagram' }, value: 'Instagram' },
          { text: { type: 'plain_text', text: 'LinkedIn' }, value: 'LinkedIn' },
        ],
      },
    },
  ],

  promo_new: [
    {
      type: 'input',
      block_id: 'vacancy_block',
      label: { type: 'plain_text', text: '💼 Назва вакансії та ключові умови *' },
      element: {
        type: 'plain_text_input',
        action_id: 'vacancy',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Junior Designer · Київ/Remote · до 1 травня · досвід від 1 року' },
      },
    },
    {
      type: 'input',
      block_id: 'platform_block',
      label: { type: 'plain_text', text: '📱 Платформа' },
      optional: true,
      element: {
        type: 'static_select',
        action_id: 'platform',
        placeholder: { type: 'plain_text', text: 'Вибери...' },
        options: [
          { text: { type: 'plain_text', text: 'Instagram' }, value: 'Instagram' },
          { text: { type: 'plain_text', text: 'LinkedIn' }, value: 'LinkedIn' },
        ],
      },
    },
  ],

  resize: [
    {
      type: 'input',
      block_id: 'formats_list_block',
      label: { type: 'plain_text', text: '📐 Перелік форматів на виході *' },
      element: {
        type: 'plain_text_input',
        action_id: 'formats_list',
        multiline: true,
        placeholder: { type: 'plain_text', text: '1080×1080\n1080×1920\n1200×628' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_figma_block',
      label: { type: 'plain_text', text: '📎 Посилання на вихідний макет у Figma *' },
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_figma',
        placeholder: { type: 'plain_text', text: 'figma.com/file/...' },
      },
    },
  ],

  video_simple: [
    {
      type: 'input',
      block_id: 'video_format_block',
      label: { type: 'plain_text', text: '🎬 Фінальний формат *' },
      element: {
        type: 'static_select',
        action_id: 'video_format',
        placeholder: { type: 'plain_text', text: 'Вибери...' },
        options: [
          { text: { type: 'plain_text', text: 'Reels / вертикальний (9:16)' }, value: 'Reels' },
          { text: { type: 'plain_text', text: 'Квадрат (1:1)' }, value: 'Square' },
          { text: { type: 'plain_text', text: 'Горизонталь (16:9)' }, value: 'Horizontal' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'subtitles_block',
      label: { type: 'plain_text', text: '💬 Потрібні субтитри? *' },
      element: {
        type: 'static_select',
        action_id: 'subtitles',
        placeholder: { type: 'plain_text', text: 'Вибери...' },
        options: [
          { text: { type: 'plain_text', text: 'Так' }, value: 'Так' },
          { text: { type: 'plain_text', text: 'Ні' }, value: 'Ні' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'cta_block',
      label: { type: 'plain_text', text: '📢 CTA наприкінці' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'cta',
        placeholder: { type: 'plain_text', text: 'Підписуйся на наш Instagram' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_video_block',
      label: { type: 'plain_text', text: '📎 Посилання на відеоматеріал *' },
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_video',
        placeholder: { type: 'plain_text', text: 'drive.google.com/... або dropbox.com/...' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_music_block',
      label: { type: 'plain_text', text: '📎 Музика (або напиши "підібрати самостійно")' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_music',
        placeholder: { type: 'plain_text', text: 'drive.google.com/... або "підібрати самостійно"' },
      },
    },
  ],

  video_complex: [
    {
      type: 'input',
      block_id: 'video_format_block',
      label: { type: 'plain_text', text: '🎬 Фінальний формат *' },
      element: {
        type: 'static_select',
        action_id: 'video_format',
        placeholder: { type: 'plain_text', text: 'Вибери...' },
        options: [
          { text: { type: 'plain_text', text: 'Reels / вертикальний (9:16)' }, value: 'Reels' },
          { text: { type: 'plain_text', text: 'Квадрат (1:1)' }, value: 'Square' },
          { text: { type: 'plain_text', text: 'Горизонталь (16:9)' }, value: 'Horizontal' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'mood_block',
      label: { type: 'plain_text', text: '🌀 Концепція / настрій *' },
      element: {
        type: 'plain_text_input',
        action_id: 'mood',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Динамічно, з музикою, акцент на людях, відчуття команди' },
      },
    },
    {
      type: 'input',
      block_id: 'edit_style_block',
      label: { type: 'plain_text', text: '✂️ Стиль монтажу' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'edit_style',
        placeholder: { type: 'plain_text', text: 'кінематографічний / швидка нарізка / cinematic' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_video_block',
      label: { type: 'plain_text', text: '📎 Посилання на відеоматеріал' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_video',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_ref_block',
      label: { type: 'plain_text', text: '📎 Референси відео' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_ref',
        placeholder: { type: 'plain_text', text: 'youtube.com/... або drive.google.com/...' },
      },
    },
  ],

  pres_edit: [
    {
      type: 'input',
      block_id: 'artifact_pres_block',
      label: { type: 'plain_text', text: '📎 Посилання на існуючу презентацію *' },
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_pres',
        placeholder: { type: 'plain_text', text: 'docs.google.com/presentation/... або figma.com/...' },
      },
    },
    {
      type: 'input',
      block_id: 'slide_list_block',
      label: { type: 'plain_text', text: '📋 Перелік слайдів для правок + коментарі *' },
      element: {
        type: 'plain_text_input',
        action_id: 'slide_list',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Слайд 3: замінити фото\nСлайд 7: оновити дату\nСлайд 12: прибрати блок' },
      },
    },
    {
      type: 'input',
      block_id: 'can_shorten_block',
      label: { type: 'plain_text', text: '✂️ Можна скорочувати текст якщо слайд перегружений?' },
      optional: true,
      element: {
        type: 'static_select',
        action_id: 'can_shorten',
        placeholder: { type: 'plain_text', text: 'Вибери...' },
        options: [
          { text: { type: 'plain_text', text: 'Так' }, value: 'Так' },
          { text: { type: 'plain_text', text: 'Ні' }, value: 'Ні' },
        ],
      },
    },
  ],

  pres_template: [
    {
      type: 'input',
      block_id: 'structure_block',
      label: { type: 'plain_text', text: '🗂 Структура (перелік слайдів) *' },
      element: {
        type: 'plain_text_input',
        action_id: 'structure',
        multiline: true,
        placeholder: { type: 'plain_text', text: '1. Вступ\n2. Проблема\n3. Рішення\n4. CTA' },
      },
    },
    {
      type: 'input',
      block_id: 'slides_text_block',
      label: { type: 'plain_text', text: '📝 Текст / тези по кожному слайду *' },
      element: {
        type: 'plain_text_input',
        action_id: 'slides_text',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Слайд 1: Текст вступу...\nСлайд 2: ...' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_drive_block',
      label: { type: 'plain_text', text: '📎 Фото, іконки (Google Drive)' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_drive',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],

  pres_wow: [
    {
      type: 'input',
      block_id: 'audience_block',
      label: { type: 'plain_text', text: '👥 Ціль і аудиторія *' },
      element: {
        type: 'plain_text_input',
        action_id: 'audience',
        placeholder: { type: 'plain_text', text: 'Для топ-менеджменту, ціль — затвердити Q3 бюджет' },
      },
    },
    {
      type: 'input',
      block_id: 'structure_block',
      label: { type: 'plain_text', text: '🗂 Структура *' },
      element: {
        type: 'plain_text_input',
        action_id: 'structure',
        multiline: true,
        placeholder: { type: 'plain_text', text: '1. Вступ\n2. Ринок\n3. Наше рішення\n4. Команда\n5. CTA' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_ref_block',
      label: { type: 'plain_text', text: '📎 Референси (обов\'язково)' },
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_ref',
        placeholder: { type: 'plain_text', text: 'drive.google.com/... або посилання на приклад' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_drive_block',
      label: { type: 'plain_text', text: '📎 Текст, фото, логотип, бренд-гайд' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_drive',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],

  ai_static_simple: [
    {
      type: 'input',
      block_id: 'ai_description_block',
      label: { type: 'plain_text', text: '🤖 Що має бути зображено *' },
      element: {
        type: 'plain_text_input',
        action_id: 'ai_description',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Жінка-програміст в офісі, стиль — кінематографічний, тепле світло, мінімум деталей' },
      },
    },
    {
      type: 'input',
      block_id: 'platform_block',
      label: { type: 'plain_text', text: '📱 Платформа використання *' },
      element: {
        type: 'static_select',
        action_id: 'platform',
        placeholder: { type: 'plain_text', text: 'Вибери...' },
        options: [
          { text: { type: 'plain_text', text: 'Instagram' }, value: 'Instagram' },
          { text: { type: 'plain_text', text: 'LinkedIn' }, value: 'LinkedIn' },
          { text: { type: 'plain_text', text: 'Corpsite' }, value: 'Corpsite' },
          { text: { type: 'plain_text', text: 'Email' }, value: 'Email' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'artifact_ref_block',
      label: { type: 'plain_text', text: '📎 Референс і що в ньому подобається' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_ref',
        placeholder: { type: 'plain_text', text: 'pinterest.com/... — подобається ця кольорова гама' },
      },
    },
  ],

  ai_static_complex: [
    {
      type: 'input',
      block_id: 'ai_description_block',
      label: { type: 'plain_text', text: '🤖 Що має бути зображено і для чого *' },
      element: {
        type: 'plain_text_input',
        action_id: 'ai_description',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Колаж: людина в костюмі астронавта в офісі, футуристичний стиль, для обкладинки дайджесту' },
      },
    },
    {
      type: 'input',
      block_id: 'platform_block',
      label: { type: 'plain_text', text: '📱 Платформа *' },
      element: {
        type: 'static_select',
        action_id: 'platform',
        placeholder: { type: 'plain_text', text: 'Вибери...' },
        options: [
          { text: { type: 'plain_text', text: 'Instagram' }, value: 'Instagram' },
          { text: { type: 'plain_text', text: 'LinkedIn' }, value: 'LinkedIn' },
          { text: { type: 'plain_text', text: 'Corpsite' }, value: 'Corpsite' },
          { text: { type: 'plain_text', text: 'Print' }, value: 'Print' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'artifact_ref_block',
      label: { type: 'plain_text', text: '📎 Референси стилю (обов\'язково)' },
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_ref',
        placeholder: { type: 'plain_text', text: 'pinterest.com/... або drive.google.com/...' },
      },
    },
  ],

  ai_dynamic_simple: [
    {
      type: 'input',
      block_id: 'ai_description_block',
      label: { type: 'plain_text', text: '🤖 Що має бути зображено *' },
      element: {
        type: 'plain_text_input',
        action_id: 'ai_description',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Анімований логотип з появою тексту, стиль мінімалістичний' },
      },
    },
    {
      type: 'input',
      block_id: 'platform_block',
      label: { type: 'plain_text', text: '📱 Платформа *' },
      element: {
        type: 'static_select',
        action_id: 'platform',
        placeholder: { type: 'plain_text', text: 'Вибери...' },
        options: [
          { text: { type: 'plain_text', text: 'Instagram' }, value: 'Instagram' },
          { text: { type: 'plain_text', text: 'TikTok' }, value: 'TikTok' },
          { text: { type: 'plain_text', text: 'YouTube' }, value: 'YouTube' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'artifact_ref_block',
      label: { type: 'plain_text', text: '📎 Референси' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_ref',
        placeholder: { type: 'plain_text', text: 'youtube.com/... або drive.google.com/...' },
      },
    },
  ],

  ai_dynamic_complex: [
    {
      type: 'input',
      block_id: 'ai_description_block',
      label: { type: 'plain_text', text: '🤖 Що має бути зображено *' },
      element: {
        type: 'plain_text_input',
        action_id: 'ai_description',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Повністю згенерована відеосцена: місто майбутнього, 15 сек, для TikTok' },
      },
    },
    {
      type: 'input',
      block_id: 'platform_block',
      label: { type: 'plain_text', text: '📱 Платформа *' },
      element: {
        type: 'static_select',
        action_id: 'platform',
        placeholder: { type: 'plain_text', text: 'Вибери...' },
        options: [
          { text: { type: 'plain_text', text: 'TikTok' }, value: 'TikTok' },
          { text: { type: 'plain_text', text: 'Instagram' }, value: 'Instagram' },
          { text: { type: 'plain_text', text: 'YouTube' }, value: 'YouTube' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'artifact_ref_block',
      label: { type: 'plain_text', text: '📎 Референси стилю (обов\'язково)' },
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_ref',
        placeholder: { type: 'plain_text', text: 'youtube.com/... або drive.google.com/...' },
      },
    },
  ],

  landing_template: [
    {
      type: 'input',
      block_id: 'structure_block',
      label: { type: 'plain_text', text: '🗂 Структура блоків *' },
      element: {
        type: 'plain_text_input',
        action_id: 'structure',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Hero → Про нас → Переваги → Команда → CTA' },
      },
    },
    {
      type: 'input',
      block_id: 'slides_text_block',
      label: { type: 'plain_text', text: '📝 Текст по кожному блоку *' },
      element: {
        type: 'plain_text_input',
        action_id: 'slides_text',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Hero: Заголовок і підзаголовок\nПро нас: ...' },
      },
    },
    {
      type: 'input',
      block_id: 'new_blocks_block',
      label: { type: 'plain_text', text: '➕ Нові блоки (якщо є)' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'new_blocks',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Блок з відгуками: структура — фото + ім\'я + текст відгуку' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_drive_block',
      label: { type: 'plain_text', text: '📎 Текст, фото, логотип (Google Drive)' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_drive',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],

  landing_wow: [
    {
      type: 'input',
      block_id: 'audience_block',
      label: { type: 'plain_text', text: '👥 Ціль і ЦА *' },
      element: {
        type: 'plain_text_input',
        action_id: 'audience',
        placeholder: { type: 'plain_text', text: 'Залучити студентів до стажування, ЦА — 18-25 років' },
      },
    },
    {
      type: 'input',
      block_id: 'structure_block',
      label: { type: 'plain_text', text: '🗂 Структура *' },
      element: {
        type: 'plain_text_input',
        action_id: 'structure',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Hero → Переваги → Програма → Команда → FAQ → CTA' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_ref_block',
      label: { type: 'plain_text', text: '📎 Референси (обов\'язково)' },
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_ref',
        placeholder: { type: 'plain_text', text: 'dribbble.com/... або awwwards.com/...' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_drive_block',
      label: { type: 'plain_text', text: '📎 Текст, фото, логотип, бренд-гайд' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_drive',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],

  blog: [
    {
      type: 'input',
      block_id: 'artifact_article_block',
      label: { type: 'plain_text', text: '📎 Посилання на статтю / текст *' },
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_article',
        placeholder: { type: 'plain_text', text: 'docs.google.com/... або notion.so/...' },
      },
    },
    {
      type: 'input',
      block_id: 'custom_images_block',
      label: { type: 'plain_text', text: '🖼 Потрібні кастомні картинки в текст?' },
      optional: true,
      element: {
        type: 'static_select',
        action_id: 'custom_images',
        placeholder: { type: 'plain_text', text: 'Вибери...' },
        options: [
          { text: { type: 'plain_text', text: 'Так' }, value: 'Так' },
          { text: { type: 'plain_text', text: 'Ні' }, value: 'Ні' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'artifact_photo_block',
      label: { type: 'plain_text', text: '📎 Фото для обкладинки' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_photo',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],

  digest_simple: [
    {
      type: 'input',
      block_id: 'structure_block',
      label: { type: 'plain_text', text: '🗂 Структура дайджесту *' },
      element: {
        type: 'plain_text_input',
        action_id: 'structure',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Блок 1: новини команди\nБлок 2: вакансії\nБлок 3: події місяця' },
      },
    },
    {
      type: 'input',
      block_id: 'slides_text_block',
      label: { type: 'plain_text', text: '📝 Текст по кожному блоку *' },
      element: {
        type: 'plain_text_input',
        action_id: 'slides_text',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Блок 1: текст...\nБлок 2: текст...' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_drive_block',
      label: { type: 'plain_text', text: '📎 Фото, логотип (Google Drive)' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_drive',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],

  digest_wow: [
    {
      type: 'input',
      block_id: 'audience_block',
      label: { type: 'plain_text', text: '👥 Ціль і аудиторія *' },
      element: {
        type: 'plain_text_input',
        action_id: 'audience',
        placeholder: { type: 'plain_text', text: 'Внутрішній дайджест для всіх співробітників, акцент на культуру' },
      },
    },
    {
      type: 'input',
      block_id: 'structure_block',
      label: { type: 'plain_text', text: '🗂 Структура *' },
      element: {
        type: 'plain_text_input',
        action_id: 'structure',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Обкладинка → Головна новина → Люди місяця → Події → Вакансії' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_ref_block',
      label: { type: 'plain_text', text: '📎 Референси обкладинки (обов\'язково)' },
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_ref',
        placeholder: { type: 'plain_text', text: 'pinterest.com/... або drive.google.com/...' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_drive_block',
      label: { type: 'plain_text', text: '📎 Всі тексти, фото, логотип' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_drive',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],

  email_digest: [
    {
      type: 'input',
      block_id: 'structure_block',
      label: { type: 'plain_text', text: '🗂 Структура email *' },
      element: {
        type: 'plain_text_input',
        action_id: 'structure',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Заголовок → 3 новини → CTA → Футер' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_drive_block',
      label: { type: 'plain_text', text: '📎 Тексти, фото (Google Drive)' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_drive',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],

  merch_simple: [
    {
      type: 'input',
      block_id: 'carrier_block',
      label: { type: 'plain_text', text: '👕 Тип носія *' },
      element: {
        type: 'plain_text_input',
        action_id: 'carrier',
        placeholder: { type: 'plain_text', text: 'футболка / худі / пляшка / шопер' },
      },
    },
    {
      type: 'input',
      block_id: 'print_zone_block',
      label: { type: 'plain_text', text: '📍 Зони нанесення *' },
      element: {
        type: 'plain_text_input',
        action_id: 'print_zone',
        placeholder: { type: 'plain_text', text: 'Передня частина по центру, розмір 20×20 см' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_logo_block',
      label: { type: 'plain_text', text: '📎 Логотип у векторі (AI / SVG)' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_logo',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],

  merch_ref: [
    {
      type: 'input',
      block_id: 'carrier_block',
      label: { type: 'plain_text', text: '👕 Тип носія *' },
      element: {
        type: 'plain_text_input',
        action_id: 'carrier',
        placeholder: { type: 'plain_text', text: 'футболка / худі / пляшка' },
      },
    },
    {
      type: 'input',
      block_id: 'variants_block',
      label: { type: 'plain_text', text: '🔄 Кількість варіантів макетів *' },
      element: {
        type: 'plain_text_input',
        action_id: 'variants',
        placeholder: { type: 'plain_text', text: '2' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_ref_block',
      label: { type: 'plain_text', text: '📎 Референси (обов\'язково)' },
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_ref',
        placeholder: { type: 'plain_text', text: 'pinterest.com/... або drive.google.com/...' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_logo_block',
      label: { type: 'plain_text', text: '📎 Логотип у векторі' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_logo',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],

  merch_research: [
    {
      type: 'input',
      block_id: 'carrier_block',
      label: { type: 'plain_text', text: '👕 Тип носія *' },
      element: {
        type: 'plain_text_input',
        action_id: 'carrier',
        placeholder: { type: 'plain_text', text: 'футболка / худі / шопер' },
      },
    },
    {
      type: 'input',
      block_id: 'concept_block',
      label: { type: 'plain_text', text: '💡 Концепція / меседж *' },
      element: {
        type: 'plain_text_input',
        action_id: 'concept',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Мерч для літнього табору, відчуття пригоди і молодості' },
      },
    },
    {
      type: 'input',
      block_id: 'restrictions_block',
      label: { type: 'plain_text', text: '🚫 Обмеження (кольори, слогани)' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'restrictions',
        placeholder: { type: 'plain_text', text: 'Тільки корпоративні кольори, без агресивних принтів' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_brand_block',
      label: { type: 'plain_text', text: '📎 Бренд-гайд, логотип' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_brand',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],

  identity: [
    {
      type: 'input',
      block_id: 'brand_name_block',
      label: { type: 'plain_text', text: '🏷 Назва бренду *' },
      element: {
        type: 'plain_text_input',
        action_id: 'brand_name',
        placeholder: { type: 'plain_text', text: 'UniWork — платформа для стажувань' },
      },
    },
    {
      type: 'input',
      block_id: 'business_block',
      label: { type: 'plain_text', text: '🏢 Опис бізнесу / продукту *' },
      element: {
        type: 'plain_text_input',
        action_id: 'business',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Платформа для пошуку стажувань для студентів у великих компаніях' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_ref_block',
      label: { type: 'plain_text', text: '📎 Референси + антиреференси (обов\'язково)' },
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_ref',
        placeholder: { type: 'plain_text', text: 'pinterest.com/... — що подобається і чому' },
      },
    },
    {
      type: 'input',
      block_id: 'target_block',
      label: { type: 'plain_text', text: '🎯 ЦА' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'target',
        placeholder: { type: 'plain_text', text: 'Студенти 18-25 і HR-менеджери корпорацій' },
      },
    },
    {
      type: 'input',
      block_id: 'competitors_block',
      label: { type: 'plain_text', text: '⚔️ Конкуренти' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'competitors',
        placeholder: { type: 'plain_text', text: 'Work.ua, Rabota.ua, LinkedIn Jobs' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_drive_block',
      label: { type: 'plain_text', text: '📎 Наявні матеріали' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_drive',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],

  logo: [
    {
      type: 'input',
      block_id: 'brand_name_block',
      label: { type: 'plain_text', text: '🏷 Назва *' },
      element: {
        type: 'plain_text_input',
        action_id: 'brand_name',
        placeholder: { type: 'plain_text', text: 'UniWork' },
      },
    },
    {
      type: 'input',
      block_id: 'sphere_block',
      label: { type: 'plain_text', text: '🏭 Сфера *' },
      element: {
        type: 'plain_text_input',
        action_id: 'sphere',
        placeholder: { type: 'plain_text', text: 'EdTech / HR / фінанси / ритейл' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_ref_block',
      label: { type: 'plain_text', text: '📎 Референси (обов\'язково)' },
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_ref',
        placeholder: { type: 'plain_text', text: 'pinterest.com/... — що подобається і чому' },
      },
    },
    {
      type: 'input',
      block_id: 'usage_block',
      label: { type: 'plain_text', text: '📍 Де буде використовуватись' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'usage',
        placeholder: { type: 'plain_text', text: 'соцмережі, сайт, мерч, документи' },
      },
    },
  ],

  photo_simple: [
    {
      type: 'input',
      block_id: 'what_to_fix_block',
      label: { type: 'plain_text', text: '🔧 Що саме прибрати / змінити *' },
      element: {
        type: 'plain_text_input',
        action_id: 'what_to_fix',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Видалити людину справа, вирізати фон' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_photo_block',
      label: { type: 'plain_text', text: '📎 Вихідне фото (Google Drive) *' },
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_photo',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],

  photo_complex: [
    {
      type: 'input',
      block_id: 'what_to_fix_block',
      label: { type: 'plain_text', text: '🔧 Детальний опис що зробити *' },
      element: {
        type: 'plain_text_input',
        action_id: 'what_to_fix',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Переодягнути людину в ділове вбрання, замінити фон на офісний, прибрати зморшки' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_photo_block',
      label: { type: 'plain_text', text: '📎 Вихідне фото *' },
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_photo',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_ref_block',
      label: { type: 'plain_text', text: '📎 Референс результату' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_ref',
        placeholder: { type: 'plain_text', text: 'drive.google.com/... або pinterest.com/...' },
      },
    },
  ],

  tv_announce: [
    {
      type: 'input',
      block_id: 'person_name_block',
      label: { type: 'plain_text', text: '👤 Ім\'я та посада *' },
      element: {
        type: 'plain_text_input',
        action_id: 'person_name',
        placeholder: { type: 'plain_text', text: 'Марія Коваль, Product Designer' },
      },
    },
    {
      type: 'input',
      block_id: 'event_date_block',
      label: { type: 'plain_text', text: '📅 Дата події *' },
      element: {
        type: 'datepicker',
        action_id: 'event_date',
      },
    },
    {
      type: 'input',
      block_id: 'artifact_photo_block',
      label: { type: 'plain_text', text: '📎 Фото людини (Google Drive або зі Slack) *' },
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_photo',
        placeholder: { type: 'plain_text', text: 'drive.google.com/... або посилання на фото у Slack' },
      },
    },
  ],

  tv_static: [
    {
      type: 'input',
      block_id: 'tv_text_block',
      label: { type: 'plain_text', text: '📺 Текст *' },
      element: {
        type: 'plain_text_input',
        action_id: 'tv_text',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Лекція «Дизайн-системи» о 18:00 в аудиторії 301' },
      },
    },
    {
      type: 'input',
      block_id: 'qr_block',
      label: { type: 'plain_text', text: '🔗 QR-код / посилання' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'qr',
        placeholder: { type: 'plain_text', text: 'forms.google.com/...' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_logo_block',
      label: { type: 'plain_text', text: '📎 Логотип (якщо потрібен)' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_logo',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],

  event_simple: [
    {
      type: 'input',
      block_id: 'event_name_block',
      label: { type: 'plain_text', text: '🎪 Назва івенту *' },
      element: {
        type: 'plain_text_input',
        action_id: 'event_name',
        placeholder: { type: 'plain_text', text: 'TechTalk #12' },
      },
    },
    {
      type: 'input',
      block_id: 'location_block',
      label: { type: 'plain_text', text: '📍 Локація *' },
      element: {
        type: 'plain_text_input',
        action_id: 'location',
        placeholder: { type: 'plain_text', text: 'UniHub, вул. Хрещатик 10' },
      },
    },
    {
      type: 'input',
      block_id: 'carriers_list_block',
      label: { type: 'plain_text', text: '📋 Перелік носіїв *' },
      element: {
        type: 'plain_text_input',
        action_id: 'carriers_list',
        placeholder: { type: 'plain_text', text: 'афіша A2, екран 1920×1080, Instagram stories' },
      },
    },
    {
      type: 'input',
      block_id: 'character_block',
      label: { type: 'plain_text', text: '🎭 Характер івенту' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'character',
        placeholder: { type: 'plain_text', text: 'Технічний, стриманий, акцент на нетворкінг' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_drive_block',
      label: { type: 'plain_text', text: '📎 Текст, логотип, фото' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_drive',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],

  event_complex: [
    {
      type: 'input',
      block_id: 'event_name_block',
      label: { type: 'plain_text', text: '🎪 Назва івенту *' },
      element: {
        type: 'plain_text_input',
        action_id: 'event_name',
        placeholder: { type: 'plain_text', text: 'Summer Camp 2025' },
      },
    },
    {
      type: 'input',
      block_id: 'location_block',
      label: { type: 'plain_text', text: '📍 Локація *' },
      element: {
        type: 'plain_text_input',
        action_id: 'location',
        placeholder: { type: 'plain_text', text: 'Карпати, база відпочинку «Едельвейс»' },
      },
    },
    {
      type: 'input',
      block_id: 'carriers_list_block',
      label: { type: 'plain_text', text: '📋 Перелік всіх носіїв *' },
      element: {
        type: 'plain_text_input',
        action_id: 'carriers_list',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Екран 1920×1080, постер A1, мерч (футболка), сторіс, банер на сайт' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_ref_block',
      label: { type: 'plain_text', text: '📎 Референси (обов\'язково)' },
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_ref',
        placeholder: { type: 'plain_text', text: 'pinterest.com/... або drive.google.com/...' },
      },
    },
    {
      type: 'input',
      block_id: 'artifact_drive_block',
      label: { type: 'plain_text', text: '📎 Текст, всі фото, логотип, бренд-гайд' },
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'artifact_drive',
        placeholder: { type: 'plain_text', text: 'drive.google.com/...' },
      },
    },
  ],
}

// Головна функція — повертає блоки для конкретного типу задачі
export function getModalBlocks(taskType) {
  const specific = specificBlocks[taskType] || []
  return [
    ...baseBlocks(),
    ...(specific.length ? [divider()] : []),
    ...specific,
  ]
}
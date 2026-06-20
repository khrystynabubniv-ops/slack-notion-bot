export const DEFAULT_DEPARTMENT_KEY = 'design'
export const DEFAULT_STATUS = 'To do'
export const DEFAULT_DESIGN_TEAM = 'Brand Design'
export const DEFAULT_DESIGN_OWNER_ID = 'f342c30b-c5c1-4a52-8cdf-c8b636928364'
export const DEFAULT_ACTIVITIES_DATABASE_ID = 'b1ff9daa012c41c597e1d5ad5dd91917'
export const DEFAULT_SMM_TEAM = 'SMM'
export const DEFAULT_SMM_OWNER_ID = '77a3e7fe-a555-4c14-b794-d63a6e42a324'
export const DEFAULT_SMM_HUB_URL = 'https://www.notion.so/SMM-Hub-375ce9899cb781aaab1ddb4c30833e23?source=copy_link'
export const DEFAULT_SMM_FEEDBACK_DATABASE_ID = '025dce2c634e4a079ee7600ea8c63253'
export const DEFAULT_EVENT_TEAM = 'Event'
export const DEFAULT_EVENT_OWNER_ID = '2cdd872b-594c-815b-acd7-000259d98a51'
export const DEFAULT_EVENT_OWNER_LABEL = 'Mariia Tarasiuk'
export const LEGACY_STATUS_PROPERTY = 'Status'

function env(name, fallback = null) {
  const value = process.env[name]?.trim()
  return value || fallback
}

function boolEnv(name, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase()
  if (!value) return fallback

  return ['1', 'true', 'yes', 'on'].includes(value)
}

function intEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || `${fallback}`, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function leadTimeEnv(name, fallback, fallbackLabel = null) {
  const rawValue = process.env[name]?.trim()
  const minLeadDays = intEnv(name, fallback)
  const rawDays = rawValue ? Number.parseInt(rawValue, 10) : null
  const shouldUseFallbackLabel = fallbackLabel && (!rawValue || rawDays === fallback)

  return {
    minLeadDays,
    ...(shouldUseFallbackLabel ? { minLeadLabel: fallbackLabel } : {}),
  }
}

function csvEnv(name, fallback) {
  const source = env(name, fallback)
  return String(source || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function option(text, value = text) {
  return { text, value }
}

function field(key, type, label, options = {}) {
  return {
    key,
    type,
    label,
    ...options,
  }
}

function selectOptions(values) {
  return values.map((value) => option(value))
}

const DESIGN_TASK_TYPE_RELATION_IDS = {
  static_simple: '752ce989-9cb7-82c6-97ad-81b4b8e8003c',
  static_complex: 'f5cce989-9cb7-838d-8f7c-0144b56d4a48',
  carousel: 'c82ce989-9cb7-820d-ba26-814f5aad916f',
  resize: '296ce989-9cb7-837b-a4db-0198dca40fc7',
  promo_creo_static: '349ce989-9cb7-8021-b677-c57985031659',
  promo_creo_static_template: '349ce989-9cb7-8021-b677-c57985031659',
  promo_creo_static_ideas: '349ce989-9cb7-8021-b677-c57985031659',
  promo_creo_mix: '349ce989-9cb7-802c-a7b7-d0a5d88bb981',
  promo_creo_mix_template: '349ce989-9cb7-802c-a7b7-d0a5d88bb981',
  promo_creo_mix_ideas: '349ce989-9cb7-802c-a7b7-d0a5d88bb981',
  promo_creo_video: '349ce989-9cb7-8099-b98a-da5724416b6a',
  promo_creo_video_template: '349ce989-9cb7-8099-b98a-da5724416b6a',
  promo_creo_video_ideas: '349ce989-9cb7-8099-b98a-da5724416b6a',
  video_simple: 'a03ce989-9cb7-8244-915d-816db55e2120',
  video_complex: 'aaece989-9cb7-83e8-8da6-811e658d9abc',
  pres_edit: 'c6bce989-9cb7-8334-b0b6-810890bbc828',
  pres_template: '29dce989-9cb7-837f-a3f5-812baee600fe',
  pres_wow: 'ed0ce989-9cb7-8295-9249-819159d83211',
  ai_static_simple: 'a33ce989-9cb7-83f3-8952-814aaab2dcc1',
  ai_static_complex: '375ce989-9cb7-8351-b0df-018fd1e42f11',
  ai_dynamic_simple: '343ce989-9cb7-81a4-bba2-d1009fd95515',
  ai_dynamic_complex: '343ce989-9cb7-813f-9728-e155c08a8f53',
  landing_template: '366ce989-9cb7-8386-8625-8190d6befc23',
  landing_wow: '8b4ce989-9cb7-8232-bcb6-015790e03b20',
  blog: 'b5fce989-9cb7-8225-81d9-816f4d760cc9',
  digest_simple: 'e5bce989-9cb7-8235-a612-81d4b445a8a1',
  digest_wow: 'dcace989-9cb7-83a9-ad38-816e3060a9c6',
  email_digest: '343ce989-9cb7-814b-81d5-ff0505cbe181',
  merch_simple: '4bbce989-9cb7-83a8-8516-8161b982a0a2',
  merch_ref: 'b6bce989-9cb7-82da-9c91-81720258436d',
  merch_research: 'c53ce989-9cb7-830f-93a7-81be6d1dd8cb',
  print_materials: '349ce989-9cb7-8045-8d52-facad67e1175',
  identity: '0fcce989-9cb7-827c-8b66-01cb5d7f5858',
  logo: '3eece989-9cb7-82cd-ac15-0142b897d94b',
  photo_simple: 'a55ce989-9cb7-820d-a866-010c7a9329bb',
  photo_complex: '226ce989-9cb7-8256-966e-0164ca4add44',
  tv_announce: '3d6ce989-9cb7-82ca-b830-013021cbce03',
  tv_static: '665ce989-9cb7-83ba-b05e-817d5cdc90e6',
  event_simple: '587ce989-9cb7-82dd-b8f7-81157ea44ebd',
  event_complex: '4dfce989-9cb7-8372-bc59-01222d1aaa29',
  other: '349ce989-9cb7-80f9-832f-c55be91be724',
}

const designTaskLeadTimes = {
  static_simple: leadTimeEnv('DESIGN_STATIC_SIMPLE_MIN_LEAD_DAYS', 2),
  static_complex: leadTimeEnv('DESIGN_STATIC_COMPLEX_MIN_LEAD_DAYS', 4),
  carousel: leadTimeEnv('DESIGN_CAROUSEL_MIN_LEAD_DAYS', 4),
  resize: leadTimeEnv('DESIGN_RESIZE_MIN_LEAD_DAYS', 2),
  promo_creo_static_template: leadTimeEnv('DESIGN_PROMO_CREO_STATIC_TEMPLATE_MIN_LEAD_DAYS', 2),
  promo_creo_static_ideas: leadTimeEnv('DESIGN_PROMO_CREO_STATIC_IDEAS_MIN_LEAD_DAYS', 4),
  promo_creo_mix_template: leadTimeEnv('DESIGN_PROMO_CREO_MIX_TEMPLATE_MIN_LEAD_DAYS', 3),
  promo_creo_mix_ideas: leadTimeEnv('DESIGN_PROMO_CREO_MIX_IDEAS_MIN_LEAD_DAYS', 11, '1.5 тижні'),
  promo_creo_video_template: leadTimeEnv('DESIGN_PROMO_CREO_VIDEO_TEMPLATE_MIN_LEAD_DAYS', 3),
  promo_creo_video_ideas: leadTimeEnv('DESIGN_PROMO_CREO_VIDEO_IDEAS_MIN_LEAD_DAYS', 11, '1.5 тижні'),
  video_simple: leadTimeEnv('DESIGN_VIDEO_SIMPLE_MIN_LEAD_DAYS', 3),
  video_complex: leadTimeEnv('DESIGN_VIDEO_COMPLEX_MIN_LEAD_DAYS', 11, '1.5 тижні'),
  pres_edit: leadTimeEnv('DESIGN_PRES_EDIT_MIN_LEAD_DAYS', 3),
  pres_template: leadTimeEnv('DESIGN_PRES_TEMPLATE_MIN_LEAD_DAYS', 7, '1 тиждень'),
  pres_wow: leadTimeEnv('DESIGN_PRES_WOW_MIN_LEAD_DAYS', 14, '2 тижні'),
  ai_static_simple: leadTimeEnv('DESIGN_AI_STATIC_SIMPLE_MIN_LEAD_DAYS', 2),
  ai_static_complex: leadTimeEnv('DESIGN_AI_STATIC_COMPLEX_MIN_LEAD_DAYS', 14, '2 тижні'),
  ai_dynamic_simple: leadTimeEnv('DESIGN_AI_DYNAMIC_SIMPLE_MIN_LEAD_DAYS', 2),
  ai_dynamic_complex: leadTimeEnv('DESIGN_AI_DYNAMIC_COMPLEX_MIN_LEAD_DAYS', 14, '2 тижні'),
  landing_template: leadTimeEnv('DESIGN_LANDING_TEMPLATE_MIN_LEAD_DAYS', 14, '2 тижні'),
  landing_wow: leadTimeEnv('DESIGN_LANDING_WOW_MIN_LEAD_DAYS', 42, '6 тижнів'),
  blog: leadTimeEnv('DESIGN_BLOG_MIN_LEAD_DAYS', 1),
  digest_simple: leadTimeEnv('DESIGN_DIGEST_SIMPLE_MIN_LEAD_DAYS', 7, '1 тиждень'),
  digest_wow: leadTimeEnv('DESIGN_DIGEST_WOW_MIN_LEAD_DAYS', 21, '3 тижні'),
  email_digest: leadTimeEnv('DESIGN_EMAIL_DIGEST_MIN_LEAD_DAYS', 7, '1 тиждень'),
  merch_simple: leadTimeEnv('DESIGN_MERCH_SIMPLE_MIN_LEAD_DAYS', 3),
  merch_ref: leadTimeEnv('DESIGN_MERCH_REF_MIN_LEAD_DAYS', 7, '1 тиждень'),
  merch_research: leadTimeEnv('DESIGN_MERCH_RESEARCH_MIN_LEAD_DAYS', 7, '1 тиждень'),
  print_materials: leadTimeEnv('DESIGN_PRINT_MATERIALS_MIN_LEAD_DAYS', 7, '1 тиждень'),
  photo_simple: leadTimeEnv('DESIGN_PHOTO_SIMPLE_MIN_LEAD_DAYS', 1),
  photo_complex: leadTimeEnv('DESIGN_PHOTO_COMPLEX_MIN_LEAD_DAYS', 3),
  tv_announce: leadTimeEnv('DESIGN_TV_ANNOUNCE_MIN_LEAD_DAYS', 2),
  tv_static: leadTimeEnv('DESIGN_TV_STATIC_MIN_LEAD_DAYS', 7, '1 тиждень'),
  event_simple: leadTimeEnv('DESIGN_EVENT_SIMPLE_MIN_LEAD_DAYS', 21, '3 тижні'),
  event_complex: leadTimeEnv('DESIGN_EVENT_COMPLEX_MIN_LEAD_DAYS', 60, '2 місяці'),
}

const designTaskTypeConfig = Object.fromEntries(
  Object.entries(DESIGN_TASK_TYPE_RELATION_IDS).map(([key, relationId]) => {
    return [
      key,
      {
        notionTaskTypeRelationId: relationId,
        ...(designTaskLeadTimes[key] || {}),
      },
    ]
  })
)

const designTaskTypeGroups = [
  {
    label: '🖼 SMM / Банери',
    options: [
      option('Статична картинка проста', 'static_simple'),
      option('Статична картинка складна', 'static_complex'),
      option('SMM карусель', 'carousel'),
      option('SMM ресайзи', 'resize'),
    ],
  },
  {
    label: '📣 Promo Creatives',
    options: [
      option('Promo Creo Static (по шаблону)', 'promo_creo_static_template'),
      option('Promo Creo Static (нові ідеї)', 'promo_creo_static_ideas'),
      option('Promo Creo Mix (по шаблону)', 'promo_creo_mix_template'),
      option('Promo Creo Mix (нові ідеї)', 'promo_creo_mix_ideas'),
      option('Promo Creo Video (по шаблону)', 'promo_creo_video_template'),
      option('Promo Creo Video (нові ідеї)', 'promo_creo_video_ideas'),
    ],
  },
  {
    label: '🎬 Монтаж / Анімація',
    options: [
      option('Монтаж / Анімація простий', 'video_simple'),
      option('Монтаж / Анімація складний', 'video_complex'),
    ],
  },
  {
    label: '📊 Презентації',
    options: [
      option('Презентація (коригування існуючого)', 'pres_edit'),
      option('Презентація по шаблону', 'pres_template'),
      option('Wow презентація', 'pres_wow'),
    ],
  },
  {
    label: '🤖 ШІ-контент',
    options: [
      option('ШІ статика проста', 'ai_static_simple'),
      option('ШІ статика складна', 'ai_static_complex'),
      option('ШІ динаміка проста', 'ai_dynamic_simple'),
      option('ШІ динаміка складна', 'ai_dynamic_complex'),
    ],
  },
  {
    label: '🌐 Веб',
    options: [
      option('Лендинг по шаблону', 'landing_template'),
      option('Wow лендинг з нуля', 'landing_wow'),
      option('Верстка блогу', 'blog'),
    ],
  },
  {
    label: '📰 Email / Дайджест',
    options: [
      option('Дайджест базовий по шаблону', 'digest_simple'),
      option('Wow дайджест', 'digest_wow'),
      option('Email дайджест', 'email_digest'),
    ],
  },
  {
    label: '👕 Мерч / Поліграфія',
    options: [
      option('Мерч простий', 'merch_simple'),
      option('Мерч по референсах', 'merch_ref'),
      option('Мерч з власним рісьорчем', 'merch_research'),
      option('Друковані матеріали (постер, флаєр, брошура)', 'print_materials'),
    ],
  },
  {
    label: '🎯 Брендинг',
    options: [
      option('Айдентика', 'identity'),
      option('Логотип', 'logo'),
    ],
  },
  {
    label: '📷 Фото',
    options: [
      option('Редагування фото просте', 'photo_simple'),
      option('Редагування фото складне', 'photo_complex'),
    ],
  },
  {
    label: '📺 TV / Івент',
    options: [
      option('Анонси TV', 'tv_announce'),
      option('Статика UniTV', 'tv_static'),
      option('Івент простий', 'event_simple'),
      option('Івент складний', 'event_complex'),
    ],
  },
  {
    label: '💡 Інше',
    options: [
      option('Інша задача / нетиповий запит', 'other'),
    ],
  },
]

const smmPlatformOptions = selectOptions([
  'Instagram',
  'LinkedIn',
  'YouTube',
  'Facebook',
])
const smmReelsPlatformOptions = selectOptions(['Instagram'])
const smmCarouselPlatformOptions = selectOptions(['Instagram', 'LinkedIn', 'Facebook'])
const smmPaidPromoPlatformOptions = selectOptions(['Meta', 'Google Ads', 'LinkedIn Ads'])
const SMM_ATTACHMENT_HINT = 'Якщо маєш лінки — встав їх сюди. Якщо у тебе файли, після завершення форми перейди в задачу в Notion і прикріпи всі файли туди.'

function smmPlatformsField(options = smmPlatformOptions) {
  const label = options.length === 1
    ? 'Для якої платформи? *'
    : 'Для якої платформи? (можна обрати кілька) *'

  return field('platforms', 'multi_select', label, {
    role: 'platforms',
    section: 'base',
    options,
  })
}

const smmCommonFields = [
  field('publication_date', 'date', 'Дата публікації / потрібна дата *', {
    role: 'deadline',
    section: 'base',
    notionProperties: ['Publication date', 'Deadline'],
  }),
  smmPlatformsField(),
  field('context', 'textarea', 'Контекст / ідея — для чого, про що (1–3 речення) *', {
    role: 'context',
    section: 'base',
  }),
  field('materials', 'text', 'Посилання на матеріали (лендинг, прес-реліз, вакансія, відео, фото)', {
    optional: true,
    section: 'base',
    placeholder: 'Якщо матеріалів ще немає, залиш поле порожнім',
  }),
  field('approver', 'slack_user', 'Хто погоджує з вашої сторони? *', {
    section: 'base',
  }),
]

const smmNoteField = field('note', 'textarea', 'Додаткова інформація / note', {
  optional: true,
  section: 'base',
  placeholder: 'Можеш додати будь-який контекст, уточнення, тексти, посилання або побажання, які не влізли в поля вище.',
})

const smmTaskFields = {
  reels: [
    field('talent_consent', 'textarea', 'Хто знімається + чи є згода *'),
    field('style_references', 'text', 'Референси стилю/монтажу *', {
      hint: SMM_ATTACHMENT_HINT,
      placeholder: 'Лінки на референси або короткий опис.',
    }),
    field('subtitles', 'select', 'Субтитри *', { options: selectOptions(['Так', 'Ні']) }),
  ],
  carousel_post: [
    field('structure_choice', 'select', 'Структура каруселі *', {
      options: selectOptions(['Є структура — опишу', 'SMM придумує']),
      hint: 'Якщо обереш «Є структура — опишу», нижче зʼявиться поле для опису структури.',
    }),
    field('slide_topics', 'textarea', 'Опис структури каруселі', {
      optional: true,
      placeholder: 'Опиши структуру або теми слайдів: слайд 1 — ..., слайд 2 — ...',
      showWhen: { fieldKey: 'structure_choice', values: ['Є структура — опишу'] },
    }),
    field('ready_texts', 'select', 'Готові тексти *', {
      options: selectOptions(['Так — посилання', 'Ні, писати з нуля']),
      hint: 'Якщо обереш «Так — посилання», нижче зʼявиться поле для готових текстів або лінку.',
    }),
    field('ready_texts_link', 'textarea', 'Готові тексти / посилання', {
      optional: true,
      placeholder: 'Встав готовий текст або лінк на документ з текстами.',
      showWhen: { fieldKey: 'ready_texts', values: ['Так — посилання'] },
    }),
    field('design_references', 'text', 'Референси дизайну', { optional: true }),
  ],
  announcement_post: [
    field('landing_link', 'text', 'Лінк на лендинг / прес-реліз *', { notionProperties: ['Ad link'] }),
    field('event_date', 'date', 'Дата події *', { notionProperties: ['Event date'] }),
    field('cta_link', 'textarea', 'CTA + посилання *', { notionProperties: ['Ad CTA'] }),
    field('visual_source', 'select', 'Візуал *', {
      options: selectOptions(['Є — посилання', 'Беремо з лендингу']),
      hint: 'Якщо обереш «Є — посилання», нижче зʼявиться поле для лінку на візуал.',
    }),
    field('visual_link', 'text', 'Лінк на візуал', {
      optional: true,
      placeholder: 'Встав лінк на готовий візуал.',
      showWhen: { fieldKey: 'visual_source', values: ['Є — посилання'] },
    }),
  ],
  stories: [
    field('goal', 'select', 'Мета *', {
      options: selectOptions(['Анонс', 'Охоплення', 'Голосування', 'Трафік на посилання']),
    }),
    field('link_needed', 'select', 'Посилання потрібне? *', {
      options: selectOptions(['Так', 'Ні']),
    }),
    field('story_link', 'text', 'Посилання', {
      optional: true,
      showWhen: { fieldKey: 'link_needed', values: ['Так'] },
    }),
    field('story_format', 'select', 'Формат *', {
      options: selectOptions(['Статика', 'Відео', 'Інтерактив']),
      notionProperties: ['Format'],
    }),
    field('ready_materials', 'text', 'Готові матеріали', {
      optional: true,
      hint: SMM_ATTACHMENT_HINT,
      placeholder: 'Лінки на готові матеріали.',
    }),
  ],
  linkedin_newsletter: [
    field('key_points', 'textarea', 'Список вакансій *'),
    field('ready_copy_link', 'text', 'Посилання на готовий текст *'),
  ],
  video_production: [
    field('video_idea', 'textarea', 'Що знімаємо / ідея *'),
    field('shoot_location_date', 'text', 'Локація і дата зйомки *'),
    field('frame_people_consent', 'textarea', 'Хто в кадрі + згода *'),
    field('video_references', 'text', 'Референси', {
      optional: true,
      hint: SMM_ATTACHMENT_HINT,
      placeholder: 'Лінки на референси.',
    }),
    field('duration', 'text', 'Орієнтовний хронометраж *'),
    field('editing_needed', 'select', 'Чи потрібен монтаж? *', {
      options: selectOptions(['Так', 'Ні']),
    }),
  ],
  video_editing: [
    field('video_materials', 'text', 'Посилання на відеоматеріали *', {
      hint: SMM_ATTACHMENT_HINT,
      placeholder: 'Лінк на папку або файл з матеріалами.',
    }),
    field('edit_brief', 'textarea', 'Що потрібно змонтувати / ідея *'),
    field('video_references', 'text', 'Референси', {
      optional: true,
      hint: SMM_ATTACHMENT_HINT,
      placeholder: 'Лінки на референси.',
    }),
    field('duration', 'text', 'Орієнтовний хронометраж *'),
    field('subtitles', 'select', 'Субтитри *', { options: selectOptions(['Так', 'Ні']) }),
  ],
  youtube_video_publish: [
    field('video_link', 'text', 'Готове відео *'),
    field('title_description', 'select', 'Назва + опис *', {
      options: selectOptions(['Є — додам', 'Треба допомога']),
    }),
    field('youtube_title_description_text', 'textarea', 'Назва + опис', {
      optional: true,
      showWhen: { fieldKey: 'title_description', values: ['Є — додам'] },
    }),
    field('thumbnail', 'select', 'Обкладинка *', {
      options: selectOptions(['Є — посилання', 'Треба зробити']),
    }),
    field('thumbnail_link', 'text', 'Посилання на обкладинку', {
      optional: true,
      showWhen: { fieldKey: 'thumbnail', values: ['Є — посилання'] },
    }),
    field('video_visibility', 'select', 'Видимість відео *', {
      options: selectOptions(['Публічне', 'Приховане']),
    }),
  ],
  vacancy_promo_static: [
    field('vacancies_list', 'textarea', 'Список вакансій або посилання на список вакансій *', {
      placeholder: 'Додай лінк на список або кілька вакансій окремими рядками.',
    }),
    field('targeting', 'textarea', 'Гео / аудиторія таргету *'),
    field('campaign_start_date', 'date', 'Період кампанії: від *'),
    field('campaign_end_date', 'date', 'Період кампанії: до *'),
  ],
  vacancy_promo_video: [
    field('vacancies_list', 'textarea', 'Список вакансій або посилання на список вакансій *', {
      placeholder: 'Додай лінк на список або кілька вакансій окремими рядками.',
    }),
    field('targeting', 'textarea', 'Гео / аудиторія таргету *'),
    field('campaign_start_date', 'date', 'Період кампанії: від *'),
    field('campaign_end_date', 'date', 'Період кампанії: до *'),
    field('video_asset_link', 'text', 'Посилання на відео', {
      optional: true,
      hint: SMM_ATTACHMENT_HINT,
      placeholder: 'Якщо відео вже готове, додай лінк.',
    }),
  ],
  publication_boost: [
    field('post_link', 'text', 'Посилання на пост *', { notionProperties: ['Ad link'] }),
    field('budget', 'text', 'Бюджет у доларах ($) *'),
    field('ad_goal', 'select', 'Ціль *', {
      options: selectOptions(['Охоплення', 'Кліки', 'Інше (напишу в коментарі)']),
    }),
    field('ad_goal_other', 'textarea', 'Коментар до цілі *', {
      showWhen: { fieldKey: 'ad_goal', values: ['Інше (напишу в коментарі)'] },
    }),
    field('success_kpi', 'textarea', 'KPI успішної кампанії *'),
    field('campaign_start_date', 'date', 'Період: від *'),
    field('campaign_end_date', 'date', 'Період: до *'),
    field('targeting', 'textarea', 'Гео / аудиторія *'),
  ],
  blogger_collab: [
    field('blogger_profile', 'text', 'Блогер / профіль *', { notionProperties: ['Ad link'] }),
    field('collab_goal', 'select', 'Ціль *', {
      options: selectOptions(['Промо вакансій', 'Промо івентів', 'Побудова знання']),
    }),
    field('collab_format', 'select', 'Формат *', {
      options: selectOptions(['Reels', 'Сторіз', 'Пост']),
    }),
    field('fixed_budget', 'select', 'Чи є фіксований бюджет? *', {
      options: selectOptions(['Так', 'Ні']),
    }),
    field('budget_amount', 'text', 'Бюджет *', {
      showWhen: { fieldKey: 'fixed_budget', values: ['Так'] },
    }),
    field('key_message', 'textarea', 'Ключове повідомлення *'),
    field('publish_deadline', 'date', 'Дедлайн виходу *', { role: 'deadline' }),
  ],
  drive_upload: [
    field('upload_content', 'textarea', 'Що завантажуємо *'),
    field('source_materials', 'select', 'Джерело матеріалів *', {
      options: selectOptions(['Посилання', 'Передам окремо']),
    }),
    field('source_link', 'text', 'Посилання на матеріали', {
      optional: true,
      showWhen: { fieldKey: 'source_materials', values: ['Посилання'] },
    }),
    field('destination_folder', 'text', 'Куди (папка/диск) *'),
    field('operation_deadline', 'date', 'Дедлайн *', {
      role: 'deadline',
      notionProperties: ['Deadline'],
    }),
  ],
  event_report: [
    field('event_name', 'text', 'Який івент *'),
    field('event_date', 'date', 'Дата івенту *', { notionProperties: ['Event date'] }),
    field('report_data', 'textarea', 'Які дані потрібні *'),
    field('report_format', 'select', 'Формат звіту *', {
      options: selectOptions(['Notion', 'Презентація', 'Таблиця']),
    }),
    field('report_deadline', 'date', 'Дедлайн *', {
      role: 'deadline',
      notionProperties: ['Deadline'],
    }),
  ],
}

const smmCommonFieldExclusions = {
  announcement_post: ['materials'],
  stories: ['platforms'],
  linkedin_newsletter: ['platforms', 'context', 'materials'],
  youtube_video_publish: ['platforms', 'materials'],
  vacancy_promo_static: ['materials', 'approver'],
  vacancy_promo_video: ['materials', 'approver'],
  publication_boost: ['approver'],
  blogger_collab: ['publication_date', 'materials'],
  drive_upload: ['publication_date', 'platforms', 'materials', 'approver'],
  event_report: ['publication_date', 'platforms', 'materials', 'approver'],
}

const smmCommonFieldOverrides = {
  reels: { platforms: smmPlatformsField(smmReelsPlatformOptions) },
  carousel_post: { platforms: smmPlatformsField(smmCarouselPlatformOptions) },
  vacancy_promo_static: { platforms: smmPlatformsField(smmPaidPromoPlatformOptions) },
  vacancy_promo_video: { platforms: smmPlatformsField(smmPaidPromoPlatformOptions) },
}

const smmTaskTypeGroups = [
  {
    label: '📱 Контент для публікації',
    options: [
      option('Reels', 'reels'),
      option('Пост-карусель', 'carousel_post'),
      option('Пост-анонс', 'announcement_post'),
      option('Сторіз', 'stories'),
      option('Newsletter LinkedIn', 'linkedin_newsletter'),
    ],
  },
  {
    label: '🎬 Відео виробництво',
    options: [
      option('Зйомка відео', 'video_production'),
      option('Монтаж відео', 'video_editing'),
      option('Публікація відео на YouTube', 'youtube_video_publish'),
    ],
  },
  {
    label: '💰 Платне просування',
    options: [
      option('Промо вакансій (статика)', 'vacancy_promo_static'),
      option('Промо вакансій (відео)', 'vacancy_promo_video'),
      option('Просування публікацій', 'publication_boost'),
      option('Колаборація з блогером', 'blogger_collab'),
    ],
  },
  {
    label: '📁 Операційне',
    options: [
      option('Завантаження фото/відео на диск', 'drive_upload'),
      option('Звіт з івенту', 'event_report'),
    ],
  },
]

const smmTaskTypeConfig = {
  reels: { minLeadDays: intEnv('SMM_REELS_MIN_LEAD_DAYS', 4), defaultProperties: { Format: 'Reels' } },
  carousel_post: { minLeadDays: intEnv('SMM_CAROUSEL_POST_MIN_LEAD_DAYS', 3), defaultProperties: { Format: 'Carousel' } },
  announcement_post: { minLeadDays: intEnv('SMM_ANNOUNCEMENT_POST_MIN_LEAD_DAYS', 2), defaultProperties: { Format: 'Static Image' } },
  stories: { minLeadDays: intEnv('SMM_STORIES_MIN_LEAD_DAYS', 2), defaultProperties: { Format: 'Stories' }, defaultPlatforms: ['Instagram'] },
  linkedin_newsletter: { minLeadDays: intEnv('SMM_LINKEDIN_NEWSLETTER_MIN_LEAD_DAYS', 4), defaultPlatforms: ['LinkedIn'] },
  video_production: { minLeadDays: intEnv('SMM_VIDEO_PRODUCTION_MIN_LEAD_DAYS', 7), defaultProperties: { Format: 'Video' } },
  video_editing: { minLeadDays: intEnv('SMM_VIDEO_EDITING_MIN_LEAD_DAYS', intEnv('SMM_VIDEO_PRODUCTION_MIN_LEAD_DAYS', 7)), defaultProperties: { Format: 'Video' } },
  youtube_video_publish: { minLeadDays: intEnv('SMM_YOUTUBE_VIDEO_PUBLISH_MIN_LEAD_DAYS', 2), defaultProperties: { Format: 'Video' }, defaultPlatforms: ['YouTube'] },
  vacancy_promo_static: { minLeadDays: intEnv('SMM_VACANCY_PROMO_STATIC_MIN_LEAD_DAYS', 3), defaultProperties: { Format: 'Static Image' } },
  vacancy_promo_video: { minLeadDays: intEnv('SMM_VACANCY_PROMO_VIDEO_MIN_LEAD_DAYS', 7), defaultProperties: { Format: 'Video' } },
  publication_boost: { minLeadDays: intEnv('SMM_PUBLICATION_BOOST_MIN_LEAD_DAYS', 2) },
  blogger_collab: { minLeadDays: intEnv('SMM_BLOGGER_COLLAB_MIN_LEAD_DAYS', 7) },
  drive_upload: { minLeadDays: intEnv('SMM_DRIVE_UPLOAD_MIN_LEAD_DAYS', 1) },
  event_report: { minLeadDays: intEnv('SMM_EVENT_REPORT_MIN_LEAD_DAYS', 3) },
}

const eventComplexityOptions = selectOptions(['Simple', 'Medium', 'Complex'])
const eventTypeOptions = selectOptions(['Партнерський', 'Власний'])
const locationConfirmedOptions = selectOptions(['Так, є адреса', 'Ні, треба шукати'])
const budgetPlaceholder = 'Наприклад: $500'
const eventInternalComplexityHint =
  'Simple - невелика подія в офісі без складного сетапу. Medium - потрібні кейтеринг, декор, подарунки або техніка. Complex - велика подія з кількома зонами, підрядниками, записом або повною координацією.'
const eventExternalComplexityHint =
  'Simple - локація вже зрозуміла, потрібна базова координація. Medium - треба допомогти з локацією, підрядниками, кейтерингом або логістикою. Complex - масштабна подія з бронюванням, кількома підрядниками, технікою, декором і повним супроводом.'
const conferenceComplexityHint =
  'Simple - базова підготовка команди та матеріалів. Medium - стенд, мерч, логістика або активність на місці. Complex - повний сетап участі: стенд, монтаж/демонтаж, логістика, активності, підрядники й багато айтемів.'
const giftsCustomComplexityHint =
  'Simple - готове рішення з мінімальною персоналізацією. Medium - індивідуальний набір, дизайн або кілька позицій. Complex - кастомне виробництво, складні матеріали, погодження макетів або довгий цикл виготовлення.'

const eventCommonFields = [
  field('event_date', 'date', 'Дата івенту *', {
    role: 'deadline',
    section: 'base',
    notionProperties: ['Event date', 'Deadline'],
  }),
  field('event_format', 'select', 'Формат івенту *', {
    section: 'base',
    options: selectOptions(['Online', 'Offline', 'Hybrid']),
    notionProperties: ['Format'],
  }),
  field('location', 'text', 'Локація / платформа', {
    optional: true,
    section: 'base',
    notionProperties: ['Location'],
  }),
  field('budget', 'text', 'Бюджет, $', {
    optional: true,
    section: 'base',
    placeholder: budgetPlaceholder,
    notionProperties: ['$ EB Budget', 'EB Budget', 'Budget'],
  }),
  field('context', 'textarea', 'Контекст / ціль івенту *', {
    role: 'context',
    section: 'base',
  }),
  field('audience', 'textarea', 'Аудиторія *', {
    section: 'base',
    notionProperties: ['Audience', 'Target audience'],
  }),
  field('materials', 'text', 'Посилання на матеріали', {
    optional: true,
    section: 'base',
    placeholder: 'Лендінг, Figma, Drive, референси або інші матеріали.',
  }),
  field('approver', 'slack_user', 'Хто погоджує з вашої сторони? *', {
    section: 'base',
  }),
]

const eventNoteField = field('note', 'textarea', 'Додаткова інформація / note', {
  optional: true,
  section: 'base',
  placeholder: 'Усе, що важливо для Event команди і не вмістилось у полях вище.',
})

const eventTaskFields = {
  merch: [
    field('project', 'text', 'Проєкт *'),
    field('quantity', 'number', 'Кількість *'),
    field('references', 'textarea', 'Референси', { optional: true }),
    field('budget', 'text', 'Бюджет, $ *', {
      placeholder: budgetPlaceholder,
      notionProperties: ['$ EB Budget', 'EB Budget', 'Budget'],
    }),
    field('audience', 'text', 'Аудиторія *'),
    field('context', 'textarea', 'Контекст - для чого потрібно *', { role: 'context' }),
    field('deadline_receive', 'date', 'Дедлайн отримання *', {
      role: 'deadline',
      notionProperties: ['Deadline'],
    }),
  ],
  event_internal: [
    field('event_date', 'date', 'Дата події *', {
      role: 'deadline',
      notionProperties: ['Event date', 'Deadline'],
    }),
    field('office_location', 'text', 'Локація в офісі *'),
    field('start_time', 'time', 'Час початку *'),
    field('event_type', 'select', 'Тип події *', { options: eventTypeOptions }),
    field('guests_count', 'number', 'Кількість гостей *'),
    field('budget', 'text', 'Бюджет, $ *', {
      placeholder: budgetPlaceholder,
      notionProperties: ['$ EB Budget', 'EB Budget', 'Budget'],
    }),
    field('complexity', 'select', 'Рівень складності *', {
      options: eventComplexityOptions,
      hint: eventInternalComplexityHint,
    }),
    field('concept', 'textarea', 'Концепція заходу *'),
    field('design_concept', 'text', 'Дизайн-концепт', { optional: true }),
    field('audience', 'text', 'Аудиторія *'),
    field('context', 'textarea', 'Загальний контекст *', { role: 'context' }),
    field('welcome_packs', 'checkbox', 'Потрібні велком-паки?', { optional: true }),
    field('gifts_needed', 'checkbox', 'Потрібні подарунки?', { optional: true }),
    field('gifts_quantity', 'number', 'Якщо подарунки потрібні - кількість', { optional: true }),
    field('catering', 'text', 'Кейтеринг', { optional: true }),
    field('photographer', 'checkbox', 'Потрібен фотограф?', { optional: true }),
    field('recording', 'checkbox', 'Потрібен запис події?', { optional: true }),
    field('badges', 'checkbox', 'Потрібні бейджі?', { optional: true }),
    field('tech_setup', 'text', 'Технічний сетап', { optional: true }),
  ],
  event_external: [
    field('event_date', 'date', 'Дата події *', {
      role: 'deadline',
      notionProperties: ['Event date', 'Deadline'],
    }),
    field('location', 'text', 'Локація *', {
      placeholder: 'Назва локації або район',
      notionProperties: ['Location'],
    }),
    field('location_confirmed', 'radio', 'Підтверджена локація? *', { options: locationConfirmedOptions }),
    field('location_address', 'text', 'Якщо так - адреса локації', {
      optional: true,
      placeholder: 'Адреса локації',
    }),
    field('start_time', 'time', 'Час початку *'),
    field('event_type', 'select', 'Тип події *', { options: eventTypeOptions }),
    field('guests_count', 'number', 'Кількість гостей *'),
    field('budget', 'text', 'Бюджет, $ *', {
      placeholder: budgetPlaceholder,
      notionProperties: ['$ EB Budget', 'EB Budget', 'Budget'],
    }),
    field('complexity', 'select', 'Рівень складності *', {
      options: eventComplexityOptions,
      hint: eventExternalComplexityHint,
    }),
    field('concept', 'textarea', 'Концепція заходу *', {
      placeholder: 'Опишіть ідею, формат і ключові активності',
    }),
    field('design_concept', 'text', 'Дизайн-концепт', {
      optional: true,
      placeholder: 'Посилання або короткий опис',
    }),
    field('audience', 'text', 'Аудиторія *', { placeholder: 'Для кого подія' }),
    field('context', 'textarea', 'Загальний контекст *', {
      role: 'context',
      placeholder: 'Навіщо подія і який очікуваний результат',
    }),
    field('welcome_packs', 'checkbox', 'Потрібні велком-паки?', { optional: true }),
    field('gifts_needed', 'checkbox', 'Потрібні подарунки?', { optional: true }),
    field('gifts_quantity', 'number', 'Якщо подарунки потрібні - кількість', { optional: true }),
    field('catering', 'text', 'Кейтеринг', {
      optional: true,
      placeholder: 'Кава, снеки, обід або інші потреби',
    }),
    field('photographer', 'checkbox', 'Потрібен фотограф?', { optional: true }),
    field('recording', 'checkbox', 'Потрібен запис події?', { optional: true }),
    field('badges', 'checkbox', 'Потрібні бейджі?', { optional: true }),
    field('tech_setup', 'text', 'Технічний сетап', {
      optional: true,
      placeholder: 'Мікрофони, екран, звук, стрим тощо',
    }),
  ],
  conference: [
    field('event_date', 'date', 'Дата події *', {
      role: 'deadline',
      notionProperties: ['Event date', 'Deadline'],
    }),
    field('location', 'text', 'Локація *', { notionProperties: ['Location'] }),
    field('setup_date', 'date', 'Дата монтажу *'),
    field('setup_time', 'time', 'Час монтажу *'),
    field('teardown_date', 'date', 'Дата демонтажу *'),
    field('teardown_time', 'time', 'Час демонтажу *'),
    field('participants_count', 'number', 'Кількість учасників від Universe *', {
      notionProperties: ['Participants', 'Attendees'],
    }),
    field('event_attendees_count', 'number', 'Кількість учасників події', { optional: true }),
    field('budget', 'text', 'Бюджет, $ *', {
      placeholder: budgetPlaceholder,
      notionProperties: ['$ EB Budget', 'EB Budget', 'Budget'],
    }),
    field('complexity', 'select', 'Рівень складності *', {
      options: eventComplexityOptions,
      hint: conferenceComplexityHint,
    }),
    field('team_look', 'text', 'Зовнішній вигляд команди *'),
    field('context', 'textarea', 'Загальний контекст *', { role: 'context' }),
    field('stand_logistics', 'checkbox', 'Потрібна логістика стенду?', { optional: true }),
    field('merch_packaging', 'textarea', 'Мерч для пакування', { optional: true }),
    field('stand_activity', 'textarea', 'Активність на стенді', { optional: true }),
    field('extra_items', 'textarea', 'Додаткові айтеми для замовлення', { optional: true }),
  ],
  gifts_ready: [
    field('items', 'textarea', 'Перелік айтемів для відправки *'),
    field('recipient_details', 'textarea', 'Реквізити отримувача - ПІБ, адреса, телефон *'),
    field('payer', 'text', 'Хто платник за відправку *'),
    field('gift_deadline', 'date', 'Дедлайн отримання подарунку *', {
      role: 'deadline',
      notionProperties: ['Deadline'],
    }),
  ],
  gifts_custom: [
    field('quantity', 'number', 'Кількість *'),
    field('budget', 'text', 'Бюджет, $ *', {
      placeholder: budgetPlaceholder,
      notionProperties: ['$ EB Budget', 'EB Budget', 'Budget'],
    }),
    field('references', 'textarea', 'Референси *'),
    field('complexity', 'select', 'Рівень складності *', {
      options: eventComplexityOptions,
      hint: giftsCustomComplexityHint,
    }),
    field('context', 'textarea', 'Загальний контекст *', { role: 'context' }),
    field('deadline_receive', 'date', 'Дедлайн отримання *', {
      role: 'deadline',
      notionProperties: ['Deadline'],
    }),
  ],
  activity: [
    field('date', 'date', 'Дата *', {
      role: 'deadline',
      notionProperties: ['Event date', 'Deadline'],
    }),
    field('location', 'text', 'Локація *', {
      placeholder: 'Вкажіть локацію',
      notionProperties: ['Location'],
    }),
    field('work_time', 'time_range', 'Час роботи *'),
    field('references', 'textarea', 'Референси *'),
    field('budget', 'text', 'Бюджет, $ *', {
      placeholder: budgetPlaceholder,
      notionProperties: ['$ EB Budget', 'EB Budget', 'Budget'],
    }),
    field('context', 'textarea', 'Загальний контекст *', { role: 'context' }),
  ],
  stand_concept_simple: [
    field('project_date', 'date', 'Дата проєкту *', {
      role: 'deadline',
      section: 'base',
      notionProperties: ['Event date', 'Deadline'],
    }),
    field('location', 'text', 'Локація *', {
      section: 'base',
      notionProperties: ['Location'],
    }),
    field('stand_size', 'text', 'Розмір стенду *', {
      section: 'base',
      notionProperties: ['Stand size', 'Size'],
    }),
    field('participants_count', 'number', 'Кількість учасників *', {
      section: 'base',
      notionProperties: ['Participants', 'Attendees'],
    }),
    field('merch_needed', 'select', 'Чи потрібен мерч *', {
      section: 'base',
      options: selectOptions(['Так', 'Ні', 'Потрібно обговорити']),
      notionProperties: ['Merch needed', 'Merch'],
    }),
    field('team_look', 'textarea', 'Зовнішній вигляд команди *', {
      section: 'base',
      notionProperties: ['Team look', 'Team appearance'],
    }),
    field('activity_goal', 'textarea', 'Мета активності *', {
      role: 'context',
      section: 'base',
    }),
    field('context', 'textarea', 'Загальний контекст / напрацьовані ідеї / напрямок *', {
      section: 'base',
    }),
    field('budget', 'text', 'Бюджет, $ *', {
      section: 'base',
      placeholder: budgetPlaceholder,
      notionProperties: ['$ EB Budget', 'EB Budget', 'Budget'],
    }),
  ],
  stand_concept_complex: [
    field('project_date', 'date', 'Дата проєкту *', {
      role: 'deadline',
      section: 'base',
      notionProperties: ['Event date', 'Deadline'],
    }),
    field('location', 'text', 'Локація *', {
      section: 'base',
      notionProperties: ['Location'],
    }),
    field('stand_size', 'text', 'Розмір стенду *', {
      section: 'base',
      notionProperties: ['Stand size', 'Size'],
    }),
    field('participants_count', 'number', 'Кількість учасників *', {
      section: 'base',
      notionProperties: ['Participants', 'Attendees'],
    }),
    field('merch_needed', 'select', 'Чи потрібен мерч *', {
      section: 'base',
      options: selectOptions(['Так', 'Ні', 'Потрібно обговорити']),
      notionProperties: ['Merch needed', 'Merch'],
    }),
    field('team_look', 'textarea', 'Зовнішній вигляд команди *', {
      section: 'base',
      notionProperties: ['Team look', 'Team appearance'],
    }),
    field('activity_goal', 'textarea', 'Мета активності *', {
      role: 'context',
      section: 'base',
    }),
    field('context', 'textarea', 'Загальний контекст / напрацьовані ідеї / напрямок *', {
      section: 'base',
    }),
    field('budget', 'text', 'Бюджет, $ *', {
      section: 'base',
      placeholder: budgetPlaceholder,
      notionProperties: ['$ EB Budget', 'EB Budget', 'Budget'],
    }),
  ],
  field_conference: [
    field('project_date', 'date', 'Дата проєкту *', {
      role: 'deadline',
      section: 'base',
      notionProperties: ['Event date', 'Deadline'],
    }),
    field('location', 'text', 'Локація *', {
      section: 'base',
      notionProperties: ['Location'],
    }),
    field('setup_date', 'date', 'Дата монтажу *', {
      section: 'base',
      notionProperties: ['Mounting date', 'Installation date'],
    }),
    field('setup_time', 'time', 'Час монтажу *', {
      section: 'base',
      notionProperties: ['Mounting time', 'Installation time'],
    }),
    field('teardown_date', 'date', 'Дата демонтажу *', {
      section: 'base',
      notionProperties: ['Demounting date', 'Teardown date'],
    }),
    field('teardown_time', 'time', 'Час демонтажу *', {
      section: 'base',
      notionProperties: ['Demounting time', 'Teardown time'],
    }),
    field('logistics_needed', 'select', 'Чи потрібна логістика *', {
      section: 'base',
      options: selectOptions(['Так', 'Ні', 'Потрібно обговорити']),
      notionProperties: ['Logistics needed', 'Logistics'],
    }),
    field('participants_count', 'number', 'Кількість учасників від Universe *', {
      section: 'base',
      notionProperties: ['Participants', 'Attendees'],
    }),
    field('team_look', 'textarea', 'Зовнішній вигляд команди *', {
      section: 'base',
      notionProperties: ['Team look', 'Team appearance'],
    }),
    field('context', 'textarea', 'Загальний контекст *', {
      role: 'context',
      section: 'base',
    }),
    field('budget', 'text', 'Бюджет, $ *', {
      section: 'base',
      placeholder: budgetPlaceholder,
      notionProperties: ['$ EB Budget', 'EB Budget', 'Budget'],
    }),
  ],
  event_new: [
    field('event_goal', 'textarea', 'Що має відбутися / короткий опис *'),
    field('expected_attendees', 'text', 'Орієнтовна кількість учасників', {
      optional: true,
      notionProperties: ['Attendees', 'Participants'],
    }),
    field('deliverables', 'textarea', 'Що потрібно від Event команди *'),
  ],
  event_support: [
    field('current_status', 'textarea', 'Що вже готово *'),
    field('support_needed', 'textarea', 'Яка підтримка потрібна *'),
  ],
  event_materials: [
    field('materials_needed', 'textarea', 'Які матеріали потрібні *'),
    field('sizes_formats', 'textarea', 'Формати / розміри', {
      optional: true,
      notionProperties: ['Formats', 'Sizes'],
    }),
  ],
  event_report: [
    field('report_data', 'textarea', 'Які дані потрібні *'),
    field('report_format', 'select', 'Формат звіту *', {
      options: selectOptions(['Notion', 'Презентація', 'Таблиця']),
      notionProperties: ['Format'],
    }),
    field('report_deadline', 'date', 'Дедлайн звіту *', {
      role: 'deadline',
      notionProperties: ['Deadline'],
    }),
  ],
}

const eventTaskFieldsWithoutCommon = new Set([
  'merch',
  'event_internal',
  'event_external',
  'conference',
  'gifts_ready',
  'gifts_custom',
  'activity',
  'stand_concept_simple',
  'stand_concept_complex',
  'field_conference',
])
const eventTaskFieldsWithoutNote = new Set([
  'merch',
  'event_internal',
  'event_external',
  'conference',
  'gifts_ready',
  'gifts_custom',
  'activity',
  'stand_concept_simple',
  'stand_concept_complex',
  'field_conference',
])

const eventTaskTypeGroups = [
  {
    label: '🎪 Event',
    options: [
      option('Виготовлення мерчу', 'merch'),
      option('Організація події (внутрішня локація)', 'event_internal'),
      option('Організація події (зовнішня локація)', 'event_external'),
      option('Підготовка до виїзної конференції / ярмарку', 'conference'),
      option('Підготовка та відправка подарунків (готова продукція)', 'gifts_ready'),
      option('Підготовка та відправка подарунків (індивідуальне виготовлення)', 'gifts_custom'),
      option('Організація активності на зовнішній локації', 'activity'),
      option('Підготовка концепту стенду', 'stand_concept'),
      option('Підготовка до виїзних конференцій/ярмарків', 'field_conference'),
    ],
  },
]

const eventTaskTypeConfig = {
  merch: {
    label: 'Виготовлення мерчу',
    nameLabel: 'Вид продукції *',
    namePlaceholder: 'Вкажіть вид продукції',
    shortTitle: 'Мерч',
    secondaryTitleFieldKey: 'project',
    minLeadDays: intEnv('EVENT_MERCH_MIN_LEAD_DAYS', 45),
    minLeadLabel: '45 днів',
    recommendedLeadLabel: '2 місяці',
    defaultProperties: { 'EB Activity Type': 'Merch' },
  },
  event_internal: {
    label: 'Організація події (внутрішня локація)',
    nameLabel: 'Назва події *',
    namePlaceholder: 'Вкажіть назву події',
    shortTitle: 'Подія в офісі',
    leadTimeFieldKey: 'complexity',
    minLeadDaysByValue: {
      Simple: { minLeadDays: 7, minLeadLabel: '1 тиждень' },
      Medium: { minLeadDays: 14, minLeadLabel: '2 тижні' },
      Complex: { minLeadDays: 21, minLeadLabel: '3 тижні' },
    },
    defaultProperties: { 'EB Activity Type': 'Event Internal' },
  },
  event_external: {
    label: 'Організація події (зовнішня локація)',
    nameLabel: 'Назва події *',
    namePlaceholder: 'Наприклад: Team meetup',
    shortTitle: 'Зовнішня подія',
    leadTimeFieldKey: 'complexity',
    minLeadDaysByValue: {
      Simple: { minLeadDays: 14, minLeadLabel: '2 тижні' },
      Medium: { minLeadDays: 21, minLeadLabel: '3 тижні' },
      Complex: { minLeadDays: 28, minLeadLabel: '4 тижні' },
    },
    defaultProperties: { 'EB Activity Type': 'Event External' },
  },
  conference: {
    label: 'Підготовка до виїзної конференції / ярмарку',
    nameLabel: 'Назва проєкту / конференції *',
    namePlaceholder: 'Вкажіть назву проєкту або конференції',
    shortTitle: 'Конференція',
    leadTimeFieldKey: 'complexity',
    minLeadDaysByValue: {
      Simple: { minLeadDays: 14, minLeadLabel: '2 тижні' },
      Medium: { minLeadDays: 30, minLeadLabel: '1 місяць' },
      Complex: { minLeadDays: 60, minLeadLabel: '2 місяці' },
    },
    defaultProperties: { 'EB Activity Type': 'Conference' },
  },
  gifts_ready: {
    label: 'Підготовка та відправка подарунків (готова продукція)',
    nameLabel: 'Назва проєкту *',
    namePlaceholder: 'Вкажіть назву проєкту',
    shortTitle: 'Готові подарунки',
    minLeadDays: intEnv('EVENT_GIFTS_READY_MIN_LEAD_DAYS', 1),
    minLeadLabel: '1 день',
    recommendedLeadLabel: '3 дні',
    defaultProperties: { 'EB Activity Type': 'Ready Gifts' },
  },
  gifts_custom: {
    label: 'Підготовка та відправка подарунків (індивідуальне виготовлення)',
    nameLabel: 'Для кого подарунок *',
    namePlaceholder: 'Вкажіть отримувача або групу отримувачів',
    shortTitle: 'Інд. подарунки',
    leadTimeFieldKey: 'complexity',
    minLeadDaysByValue: {
      Simple: { minLeadDays: 2, minLeadLabel: '2 дні' },
      Medium: { minLeadDays: 10, minLeadLabel: '1,5 тижні' },
      Complex: { minLeadDays: 60, minLeadLabel: '2 місяці' },
    },
    defaultProperties: { 'EB Activity Type': 'Custom Gifts' },
  },
  activity: {
    label: 'Організація активності на зовнішній локації',
    nameLabel: 'Назва проєкту *',
    namePlaceholder: 'Вкажіть назву проєкту',
    shortTitle: 'Активність',
    minLeadDays: intEnv('EVENT_ACTIVITY_MIN_LEAD_DAYS', 21),
    minLeadLabel: '3 тижні',
    defaultProperties: { 'EB Activity Type': 'External Activity' },
  },
  stand_concept: {
    complexityOptions: [
      {
        value: 'simple',
        label: 'SIMPLE',
        taskType: 'stand_concept_simple',
        description: 'Невелика активність, що є причиною збирати анкети та дарувати подарунки.',
      },
      {
        value: 'complex',
        label: 'COMPLEX',
        taskType: 'stand_concept_complex',
        description: 'Активність є визначною частиною стенду, навколо чого будується вся концепція.',
      },
    ],
  },
  stand_concept_simple: {
    label: 'Підготовка концепту стенду — SIMPLE',
    nameLabel: 'Назва проєкту *',
    namePlaceholder: 'Назва проєкту або події',
    category: '🎪 Event',
    minLeadDays: intEnv('EVENT_STAND_CONCEPT_SIMPLE_MIN_LEAD_DAYS', 21),
    minLeadLabel: '3 тижні',
    recommendedLeadLabel: '1 місяць',
    defaultProperties: {
      'EB Activity Type': 'Підготовка концепту стенду',
      Complexity: 'SIMPLE',
    },
  },
  stand_concept_complex: {
    label: 'Підготовка концепту стенду — COMPLEX',
    nameLabel: 'Назва проєкту *',
    namePlaceholder: 'Назва проєкту або події',
    category: '🎪 Event',
    minLeadDays: intEnv('EVENT_STAND_CONCEPT_COMPLEX_MIN_LEAD_DAYS', 45),
    minLeadLabel: '1,5 місяці',
    recommendedLeadLabel: '2 місяці',
    defaultProperties: {
      'EB Activity Type': 'Підготовка концепту стенду',
      Complexity: 'COMPLEX',
    },
  },
  field_conference: {
    label: 'Підготовка до виїзних конференцій/ярмарків',
    nameLabel: 'Назва проєкту *',
    namePlaceholder: 'Назва проєкту або події',
    minLeadDays: intEnv('EVENT_FIELD_CONFERENCE_MIN_LEAD_DAYS', 18),
    minLeadLabel: '2,5 тижні',
    recommendedLeadLabel: '3 тижні',
    defaultProperties: {
      'EB Activity Type': 'Підготовка до виїзних конференцій/ярмарків',
    },
  },
  event_new: {
    minLeadDays: intEnv('EVENT_NEW_MIN_LEAD_DAYS', 30),
    defaultProperties: { 'EB Activity Type': 'Event' },
  },
  event_support: {
    minLeadDays: intEnv('EVENT_SUPPORT_MIN_LEAD_DAYS', 14),
    defaultProperties: { 'EB Activity Type': 'Event support' },
  },
  event_materials: {
    minLeadDays: intEnv('EVENT_MATERIALS_MIN_LEAD_DAYS', 7),
    defaultProperties: { 'EB Activity Type': 'Event materials' },
  },
  event_report: {
    minLeadDays: intEnv('EVENT_REPORT_MIN_LEAD_DAYS', 3),
    defaultProperties: { 'EB Activity Type': 'Event report' },
  },
}

function buildTaskTypesFromGroups(groups, extraConfigByKey = {}) {
  const taskTypes = {}

  for (const group of groups) {
    for (const item of group.options) {
      taskTypes[item.value] = {
        key: item.value,
        label: item.text,
        category: group.label,
        ...(extraConfigByKey[item.value] || {}),
      }
    }
  }

  for (const [key, config] of Object.entries(extraConfigByKey)) {
    if (!taskTypes[key] && config.label) {
      taskTypes[key] = {
        key,
        category: config.category || null,
        ...config,
      }
    }
  }

  return taskTypes
}

function isEventDepartmentEnabled() {
  return boolEnv('EVENT_DEPARTMENT_ENABLED') || Boolean(env('NOTION_EVENT_DATABASE_ID'))
}

export const departments = {
  design: {
    key: 'design',
    label: 'Design',
    emoji: '🎨',
    notionDataSourceId: env('NOTION_DESIGN_DATABASE_ID', env('NOTION_DATABASE_ID')),
    notionTemplateId: env('NOTION_DESIGN_TEMPLATE_ID', env('NOTION_TEMPLATE_ID')),
    hubUrl: env('NOTION_DESIGN_HUB_URL', env('NOTION_BRAND_DESIGN_HUB_URL', null)),
    feedbackDatabaseId: env('NOTION_DESIGN_FEEDBACK_DATABASE_ID', env('NOTION_FEEDBACK_DATABASE_ID', null)),
    statusProperty: env('NOTION_DESIGN_STATUS_PROPERTY', env('NOTION_STATUS_PROPERTY', 'Design Status')),
    initialStatus: env('NOTION_DESIGN_INITIAL_STATUS', DEFAULT_STATUS),
    completedStatuses: csvEnv('NOTION_DESIGN_COMPLETED_STATUSES', env('NOTION_POLL_COMPLETED_STATUSES', 'Ready')),
    qualitySurveyStatuses: csvEnv('NOTION_DESIGN_QUALITY_SURVEY_STATUSES', 'Ready'),
    supportsFeedbackRounds: true,
    pollIntervalSec: intEnv('NOTION_DESIGN_POLL_INTERVAL_SEC', 180),
    notifyChannel: env('DESIGN_CHANNEL_ID'),
    ownerId: env('NOTION_DESIGN_OWNER_ID', DEFAULT_DESIGN_OWNER_ID),
    ownerLabel: env('NOTION_DESIGN_OWNER_LABEL', null),
    team: env('NOTION_DESIGN_TEAM', DEFAULT_DESIGN_TEAM),
    taskTypeGroups: designTaskTypeGroups,
    taskTypes: buildTaskTypesFromGroups(designTaskTypeGroups, designTaskTypeConfig),
  },
  smm: {
    key: 'smm',
    label: 'SMM',
    emoji: '📱',
    notionDataSourceId: env(
      'NOTION_SMM_DATABASE_ID',
      env('NOTION_ACTIVITIES_DATABASE_ID', env('NOTION_DATABASE_ID', DEFAULT_ACTIVITIES_DATABASE_ID))
    ),
    notionTemplateId: env('NOTION_SMM_TEMPLATE_ID', env('NOTION_SMM_TASK_TEMPLATE_ID', null)),
    hubUrl: env('NOTION_SMM_HUB_URL', DEFAULT_SMM_HUB_URL),
    feedbackDatabaseId: env('NOTION_SMM_FEEDBACK_DATABASE_ID', DEFAULT_SMM_FEEDBACK_DATABASE_ID),
    statusProperty: env('NOTION_SMM_STATUS_PROPERTY', 'SMM статус'),
    initialStatus: env('NOTION_SMM_INITIAL_STATUS', 'To do'),
    completedStatuses: csvEnv('NOTION_SMM_COMPLETED_STATUSES', 'Published,Canceled,Cancelled'),
    qualitySurveyStatuses: csvEnv('NOTION_SMM_QUALITY_SURVEY_STATUSES', 'Published'),
    supportsFeedbackRounds: false,
    useBodyBrief: true,
    pollIntervalSec: intEnv('NOTION_SMM_POLL_INTERVAL_SEC', 180),
    notifyChannel: env('SMM_CHANNEL_ID', env('SLACK_SMM_NOTIFY_CHANNEL', null)),
    ownerId: env('NOTION_SMM_OWNER_ID', DEFAULT_SMM_OWNER_ID),
    ownerLabel: env('NOTION_SMM_OWNER_LABEL', 'Anna Gayuk'),
    team: env('NOTION_SMM_TEAM', DEFAULT_SMM_TEAM),
    defaultProperties: {
      'SMM needed': true,
      'SMM briefed': true,
    },
    taskTypeGroups: smmTaskTypeGroups,
    taskTypes: buildTaskTypesFromGroups(smmTaskTypeGroups, smmTaskTypeConfig),
  },
  event: {
    key: 'event',
    label: 'Event',
    emoji: '🎪',
    active: isEventDepartmentEnabled(),
    notionDataSourceId: env(
      'NOTION_EVENT_DATABASE_ID',
      env('NOTION_ACTIVITIES_DATABASE_ID', env('NOTION_DATABASE_ID', DEFAULT_ACTIVITIES_DATABASE_ID))
    ),
    notionTemplateId: env('NOTION_EVENT_TEMPLATE_ID', env('NOTION_EVENT_TASK_TEMPLATE_ID', null)),
    hubUrl: env('NOTION_EVENT_HUB_URL', null),
    feedbackDatabaseId: env('NOTION_EVENT_FEEDBACK_DATABASE_ID', null),
    statusProperty: env('NOTION_EVENT_STATUS_PROPERTY', 'Status'),
    initialStatus: env('NOTION_EVENT_INITIAL_STATUS', 'Backlog'),
    completedStatuses: csvEnv('NOTION_EVENT_COMPLETED_STATUSES', 'Done,Completed,Canceled,Cancelled'),
    qualitySurveyStatuses: csvEnv('NOTION_EVENT_QUALITY_SURVEY_STATUSES', ''),
    supportsFeedbackRounds: false,
    useBodyBrief: true,
    pollIntervalSec: intEnv('NOTION_EVENT_POLL_INTERVAL_SEC', 180),
    notifyChannel: env('EVENT_CHANNEL_ID', env('SLACK_EVENT_NOTIFY_CHANNEL', null)),
    ownerId: env('NOTION_EVENT_OWNER_ID', DEFAULT_EVENT_OWNER_ID),
    ownerLabel: env('NOTION_EVENT_OWNER_LABEL', DEFAULT_EVENT_OWNER_LABEL),
    ownerSlackId: env('SLACK_EVENT_OWNER_ID', env('SLACK_MARIA_USER_ID', null)),
    team: env('NOTION_EVENT_TEAM', DEFAULT_EVENT_TEAM),
    defaultProperties: {
      'Event needed': true,
      'Event briefed': true,
      'Brief received': false,
    },
    taskTypeGroups: eventTaskTypeGroups,
    taskTypes: buildTaskTypesFromGroups(eventTaskTypeGroups, eventTaskTypeConfig),
  },
}

export const RESERVED_DEPARTMENT_KEYS = ['pr', 'employer_brand']

function isDepartmentActive(department) {
  return Boolean(department && department.active !== false)
}

export function resolveDepartmentKey(departmentKey) {
  const department = departments[departmentKey]
  return isDepartmentActive(department) ? department.key : DEFAULT_DEPARTMENT_KEY
}

export function getDepartment(departmentKey) {
  return departments[resolveDepartmentKey(departmentKey)]
}

export function getAllDepartments() {
  return Object.values(departments).filter(isDepartmentActive)
}

export function getTaskTypeGroups(departmentKey = DEFAULT_DEPARTMENT_KEY) {
  return getDepartment(departmentKey).taskTypeGroups.map((group) => ({
    label: { type: 'plain_text', text: group.label },
    options: group.options.map((item) => ({
      text: { type: 'plain_text', text: item.text },
      value: item.value,
    })),
  }))
}

export function getDepartmentTaskType(departmentKey, taskType) {
  return getDepartment(departmentKey).taskTypes[taskType] || null
}

export function getTaskTypeComplexityOptions(departmentKey, taskType) {
  return getDepartmentTaskType(departmentKey, taskType)?.complexityOptions || []
}

export function resolveTaskTypeComplexity(departmentKey, taskType, complexityValue) {
  const complexityOption = getTaskTypeComplexityOptions(departmentKey, taskType)
    .find((option) => option.value === complexityValue)

  return complexityOption?.taskType || taskType
}

export function getDepartmentTaskFields(departmentKey = DEFAULT_DEPARTMENT_KEY, taskType = null) {
  const department = getDepartment(departmentKey)
  if (department.key === 'smm' && taskType) {
    const excludedCommonFields = new Set(smmCommonFieldExclusions[taskType] || [])
    const commonFieldOverrides = smmCommonFieldOverrides[taskType] || {}
    const commonFields = smmCommonFields.filter((fieldConfig) => {
      return !excludedCommonFields.has(fieldConfig.key)
    }).map((fieldConfig) => {
      return commonFieldOverrides[fieldConfig.key] || fieldConfig
    })

    return [
      ...commonFields,
      ...(smmTaskFields[taskType] || []),
      smmNoteField,
    ]
  }

  if (department.key === 'event' && taskType) {
    const commonFields = eventTaskFieldsWithoutCommon.has(taskType) ? [] : eventCommonFields
    const noteFields = eventTaskFieldsWithoutNote.has(taskType) ? [] : [eventNoteField]

    return [
      ...commonFields,
      ...(eventTaskFields[taskType] || []),
      ...noteFields,
    ]
  }

  return []
}

export function getTaskTypeRelationId(departmentKey, taskType) {
  return getDepartmentTaskType(departmentKey, taskType)?.notionTaskTypeRelationId || null
}

export function getTestTaskPrefix() {
  return env('TEST_TASK_PREFIX', '')
}

export function applyTestTaskPrefix(taskName) {
  const prefix = getTestTaskPrefix()
  const normalizedName = String(taskName || '').trim()

  if (!prefix) return normalizedName
  if (normalizedName.startsWith(prefix)) return normalizedName

  return `${prefix} ${normalizedName}`.trim()
}

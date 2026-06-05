export const DEFAULT_DEPARTMENT_KEY = 'design'
export const DEFAULT_STATUS = 'To do'
export const DEFAULT_DESIGN_TEAM = 'Brand Design'
export const DEFAULT_DESIGN_OWNER_ID = 'f342c30b-c5c1-4a52-8cdf-c8b636928364'
export const DEFAULT_ACTIVITIES_DATABASE_ID = 'b1ff9daa012c41c597e1d5ad5dd91917'
export const DEFAULT_SMM_TEAM = 'SMM'
export const DEFAULT_SMM_OWNER_ID = '77a3e7fe-a555-4c14-b794-d63a6e42a324'
export const LEGACY_STATUS_PROPERTY = 'Status'

function env(name, fallback = null) {
  const value = process.env[name]?.trim()
  return value || fallback
}

function intEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || `${fallback}`, 10)
  return Number.isFinite(parsed) ? parsed : fallback
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
  'TikTok',
])

const smmCommonFields = [
  field('publication_date', 'date', 'Дата публікації / потрібна дата *', {
    role: 'deadline',
    notionProperties: ['Publication date', 'Deadline'],
  }),
  field('platforms', 'multi_select', 'Для якої платформи? (можна обрати кілька) *', {
    role: 'platforms',
    options: smmPlatformOptions,
  }),
  field('context', 'textarea', 'Контекст / ідея — для чого, про що (1–3 речення) *', {
    role: 'context',
  }),
  field('materials', 'text', 'Посилання на матеріали (лендинг, прес-реліз, відео, фото)', {
    optional: true,
    placeholder: 'Якщо матеріалів ще немає, залиш поле порожнім',
  }),
  field('approver', 'slack_user', 'Хто погоджує з вашої сторони? *'),
]

const smmTaskFields = {
  reels: [
    field('talent_consent', 'textarea', 'Хто знімається + чи є згода *'),
    field('talent_availability', 'text', 'Коли герой доступний (дата/вікно) *'),
    field('style_references', 'text', 'Референси стилю/монтажу', { optional: true }),
    field('subtitles', 'select', 'Субтитри *', { options: selectOptions(['Так', 'Ні']) }),
  ],
  carousel_post: [
    field('structure_choice', 'select', 'Структура каруселі *', {
      options: selectOptions(['Є структура — опишу', 'SMM придумує']),
    }),
    field('slide_topics', 'textarea', 'Опис тем слайдів', {
      optional: true,
      showWhen: { fieldKey: 'structure_choice', values: ['Є структура — опишу'] },
    }),
    field('ready_texts', 'select', 'Готові тексти *', {
      options: selectOptions(['Так — посилання', 'Ні, писати з нуля']),
    }),
    field('ready_texts_link', 'text', 'Посилання на готові тексти', {
      optional: true,
      showWhen: { fieldKey: 'ready_texts', values: ['Так — посилання'] },
    }),
    field('design_references', 'text', 'Референси дизайну', { optional: true }),
  ],
  announcement_post: [
    field('landing_link', 'text', 'Лендинг / прес-реліз *', { notionProperties: ['Ad link'] }),
    field('event_date', 'date', 'Дата події *', { notionProperties: ['Event date'] }),
    field('cta_link', 'textarea', 'CTA + посилання *', { notionProperties: ['Ad CTA'] }),
    field('visual_source', 'select', 'Візуал *', {
      options: selectOptions(['Є — посилання', 'Беремо з лендингу']),
    }),
    field('visual_link', 'text', 'Посилання на візуал', {
      optional: true,
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
    field('ready_materials', 'text', 'Готові матеріали', { optional: true }),
  ],
  linkedin_newsletter: [
    field('issue_topic', 'text', 'Тема випуску *'),
    field('key_points', 'textarea', 'Ключові тези / структура *'),
    field('ready_copy', 'select', 'Готовий текст *', {
      options: selectOptions(['Так — посилання', 'Ні, писати з нуля']),
    }),
    field('ready_copy_link', 'text', 'Посилання на готовий текст', {
      optional: true,
      showWhen: { fieldKey: 'ready_copy', values: ['Так — посилання'] },
    }),
  ],
  video_production: [
    field('video_idea', 'textarea', 'Що знімаємо / ідея *'),
    field('shoot_location_date', 'text', 'Локація і дата зйомки *'),
    field('frame_people_consent', 'textarea', 'Хто в кадрі + згода *'),
    field('video_references', 'text', 'Референси', { optional: true }),
    field('duration', 'text', 'Орієнтовний хронометраж *'),
    field('publish_where', 'multi_select', 'Де публікуємо? *', {
      options: selectOptions(['Instagram', 'YouTube', 'LinkedIn', 'TikTok', 'інше']),
    }),
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
    field('tags_category', 'text', 'Теги / категорія *'),
  ],
  vacancy_promo_static: [
    field('vacancy_link', 'text', 'Вакансія / лендинг *', { notionProperties: ['Ad link'] }),
    field('budget', 'text', 'Бюджет *'),
    field('targeting', 'textarea', 'Гео / аудиторія таргету *'),
    field('campaign_period', 'text', 'Період кампанії *'),
    field('creative', 'select', 'Готовий креатив *', {
      options: selectOptions(['Є — посилання', 'Треба зробити']),
    }),
    field('creative_link', 'text', 'Посилання на креатив', {
      optional: true,
      showWhen: { fieldKey: 'creative', values: ['Є — посилання'] },
    }),
  ],
  vacancy_promo_video: [
    field('vacancy_link', 'text', 'Вакансія / лендинг *', { notionProperties: ['Ad link'] }),
    field('budget', 'text', 'Бюджет *'),
    field('targeting', 'textarea', 'Гео / аудиторія таргету *'),
    field('campaign_period', 'text', 'Період кампанії *'),
    field('creative', 'select', 'Готовий креатив *', {
      options: selectOptions(['Є — посилання', 'Треба зробити']),
    }),
    field('video_asset', 'select', 'Готове відео *', {
      options: selectOptions(['Є — посилання', 'Треба зняти/змонтувати']),
    }),
    field('video_asset_link', 'text', 'Посилання на відео', {
      optional: true,
      showWhen: { fieldKey: 'video_asset', values: ['Є — посилання'] },
    }),
  ],
  publication_boost: [
    field('post_link', 'text', 'Посилання на пост *', { notionProperties: ['Ad link'] }),
    field('budget', 'text', 'Бюджет *'),
    field('ad_goal', 'select', 'Ціль *', {
      options: selectOptions(['Охоплення', 'Трафік', 'Залучення']),
    }),
    field('campaign_period', 'text', 'Період *'),
    field('targeting', 'textarea', 'Гео / аудиторія *'),
  ],
  blogger_collab: [
    field('blogger_profile', 'text', 'Блогер / профіль *', { notionProperties: ['Ad link'] }),
    field('collab_format', 'select', 'Формат *', {
      options: selectOptions(['Reels', 'Сторіз', 'Пост', 'Інтеграція']),
    }),
    field('terms_budget', 'textarea', 'Бюджет / умови *'),
    field('key_message', 'textarea', 'Ключове повідомлення *'),
    field('publish_deadline', 'date', 'Дедлайн виходу *'),
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
    field('operation_deadline', 'date', 'Дедлайн *', { notionProperties: ['Deadline'] }),
  ],
  event_report: [
    field('event_name', 'text', 'Який івент *'),
    field('event_date', 'date', 'Дата івенту *', { notionProperties: ['Event date'] }),
    field('report_data', 'textarea', 'Які дані потрібні *'),
    field('report_format', 'select', 'Формат звіту *', {
      options: selectOptions(['Notion', 'Презентація', 'Таблиця']),
    }),
    field('report_deadline', 'date', 'Дедлайн *', { notionProperties: ['Deadline'] }),
  ],
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
      option('Зйомка і монтаж відео', 'video_production'),
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
  stories: { minLeadDays: intEnv('SMM_STORIES_MIN_LEAD_DAYS', 2), defaultProperties: { Format: 'Stories' } },
  linkedin_newsletter: { minLeadDays: intEnv('SMM_LINKEDIN_NEWSLETTER_MIN_LEAD_DAYS', 4) },
  video_production: { minLeadDays: intEnv('SMM_VIDEO_PRODUCTION_MIN_LEAD_DAYS', 7), defaultProperties: { Format: 'Video' } },
  youtube_video_publish: { minLeadDays: intEnv('SMM_YOUTUBE_VIDEO_PUBLISH_MIN_LEAD_DAYS', 2), defaultProperties: { Format: 'Video' } },
  vacancy_promo_static: { minLeadDays: intEnv('SMM_VACANCY_PROMO_STATIC_MIN_LEAD_DAYS', 3), defaultProperties: { Format: 'Static Image' } },
  vacancy_promo_video: { minLeadDays: intEnv('SMM_VACANCY_PROMO_VIDEO_MIN_LEAD_DAYS', 7), defaultProperties: { Format: 'Video' } },
  publication_boost: { minLeadDays: intEnv('SMM_PUBLICATION_BOOST_MIN_LEAD_DAYS', 2) },
  blogger_collab: { minLeadDays: intEnv('SMM_BLOGGER_COLLAB_MIN_LEAD_DAYS', 7) },
  drive_upload: { minLeadDays: intEnv('SMM_DRIVE_UPLOAD_MIN_LEAD_DAYS', 1) },
  event_report: { minLeadDays: intEnv('SMM_EVENT_REPORT_MIN_LEAD_DAYS', 3) },
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

  return taskTypes
}

export const departments = {
  design: {
    key: 'design',
    label: 'Design',
    emoji: '🎨',
    notionDataSourceId: env('NOTION_DESIGN_DATABASE_ID', env('NOTION_DATABASE_ID')),
    notionTemplateId: env('NOTION_DESIGN_TEMPLATE_ID', env('NOTION_TEMPLATE_ID')),
    statusProperty: env('NOTION_DESIGN_STATUS_PROPERTY', env('NOTION_STATUS_PROPERTY', 'Design Status')),
    initialStatus: env('NOTION_DESIGN_INITIAL_STATUS', DEFAULT_STATUS),
    completedStatuses: csvEnv('NOTION_DESIGN_COMPLETED_STATUSES', env('NOTION_POLL_COMPLETED_STATUSES', 'Ready')),
    pollIntervalSec: intEnv('NOTION_DESIGN_POLL_INTERVAL_SEC', 180),
    notifyChannel: env('DESIGN_CHANNEL_ID'),
    ownerId: env('NOTION_DESIGN_OWNER_ID', DEFAULT_DESIGN_OWNER_ID),
    ownerLabel: env('NOTION_DESIGN_OWNER_LABEL', null),
    team: env('NOTION_DESIGN_TEAM', DEFAULT_DESIGN_TEAM),
    taskTypeGroups: designTaskTypeGroups,
    taskTypes: buildTaskTypesFromGroups(
      designTaskTypeGroups,
      Object.fromEntries(Object.entries(DESIGN_TASK_TYPE_RELATION_IDS).map(([key, relationId]) => {
        return [key, { notionTaskTypeRelationId: relationId }]
      }))
    ),
  },
  smm: {
    key: 'smm',
    label: 'SMM',
    emoji: '📱',
    notionDataSourceId: env(
      'NOTION_SMM_DATABASE_ID',
      env('NOTION_ACTIVITIES_DATABASE_ID', env('NOTION_DATABASE_ID', DEFAULT_ACTIVITIES_DATABASE_ID))
    ),
    notionTemplateId: env('NOTION_SMM_TEMPLATE_ID', null),
    statusProperty: env('NOTION_SMM_STATUS_PROPERTY', 'SMM статус'),
    initialStatus: env('NOTION_SMM_INITIAL_STATUS', 'to do'),
    completedStatuses: csvEnv('NOTION_SMM_COMPLETED_STATUSES', 'ready,опубліковано'),
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
}

export const RESERVED_DEPARTMENT_KEYS = ['event', 'pr', 'employer_brand']

export function resolveDepartmentKey(departmentKey) {
  return departments[departmentKey]?.key || DEFAULT_DEPARTMENT_KEY
}

export function getDepartment(departmentKey) {
  return departments[resolveDepartmentKey(departmentKey)]
}

export function getAllDepartments() {
  return Object.values(departments)
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

export function getDepartmentTaskFields(departmentKey = DEFAULT_DEPARTMENT_KEY, taskType = null) {
  const department = getDepartment(departmentKey)
  if (department.key === 'smm' && taskType) {
    return [
      ...smmCommonFields,
      ...(smmTaskFields[taskType] || []),
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

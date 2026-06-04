export const DEFAULT_DEPARTMENT_KEY = 'design'
export const DEFAULT_STATUS = 'To do'
export const DEFAULT_DESIGN_TEAM = 'Brand Design'
export const DEFAULT_DESIGN_OWNER_ID = 'f342c30b-c5c1-4a52-8cdf-c8b636928364'
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
    completedStatuses: csvEnv('NOTION_DESIGN_COMPLETED_STATUSES', env('NOTION_POLL_COMPLETED_STATUSES', 'Ready')),
    pollIntervalSec: intEnv('NOTION_DESIGN_POLL_INTERVAL_SEC', 180),
    notifyChannel: env('DESIGN_CHANNEL_ID'),
    ownerId: env('NOTION_DESIGN_OWNER_ID', DEFAULT_DESIGN_OWNER_ID),
    team: env('NOTION_DESIGN_TEAM', DEFAULT_DESIGN_TEAM),
    taskTypeGroups: designTaskTypeGroups,
    taskTypes: buildTaskTypesFromGroups(
      designTaskTypeGroups,
      Object.fromEntries(Object.entries(DESIGN_TASK_TYPE_RELATION_IDS).map(([key, relationId]) => {
        return [key, { notionTaskTypeRelationId: relationId }]
      }))
    ),
  },
}

export const RESERVED_DEPARTMENT_KEYS = ['event', 'smm', 'pr', 'employer_brand']

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

export function getDepartmentTaskFields() {
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

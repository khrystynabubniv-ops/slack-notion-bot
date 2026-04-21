export const DEFAULT_TEAM = 'Brand Design'
export const DEFAULT_OWNER_ID = 'f342c30b-c5c1-4a52-8cdf-c8b636928364'
export const DEFAULT_ACTIVITY_TYPE = 'Brand Design'

const TASK_TYPE_PAGE_IDS = {
  static_simple: '752ce989-9cb7-82c6-97ad-81b4b8e8003c',
  static_complex: 'f5cce989-9cb7-838d-8f7c-0144b56d4a48',
  carousel: 'c82ce989-9cb7-820d-ba26-814f5aad916f',
  resize: '296ce989-9cb7-837b-a4db-0198dca40fc7',
  promo_creo_static: '349ce989-9cb7-8021-b677-c57985031659',
  promo_creo_mix: '349ce989-9cb7-802c-a7b7-d0a5d88bb981',
  promo_creo_video: '349ce989-9cb7-8099-b98a-da5724416b6a',
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

const DEFAULT_FORMAT_BY_TASK_TYPE = {
  carousel: 'Carousel',
  resize: 'Static Image',
  promo_creo_static: 'Static Image',
  promo_creo_mix: 'Animation',
  pres_edit: 'Presentation',
  pres_template: 'Presentation',
  pres_wow: 'Presentation',
  ai_static_simple: 'Static Image',
  ai_static_complex: 'Static Image',
  ai_dynamic_simple: 'Animation',
  ai_dynamic_complex: 'Animation',
  landing_template: 'Web',
  landing_wow: 'Web',
  blog: 'Blog',
  digest_simple: 'Other',
  digest_wow: 'Other',
  email_digest: 'Other',
  merch_simple: 'Merch',
  merch_ref: 'Merch',
  merch_research: 'Merch',
  identity: 'Other',
  logo: 'Other',
  event_simple: 'Event design',
  event_complex: 'Event design',
  other: 'Other',
}

const PRINT_FORMAT_MAP = {
  Постер: 'Poster',
  Флаєр: 'Flyer',
  Брошура: 'Print',
  Листівка: 'Print',
  Дошка: 'Print',
  Інше: 'Print',
}

const VIDEO_FORMAT_MAP = {
  Reels: 'Reels',
  Square: 'Square',
  Horizontal: 'Horizontal',
}

const PLATFORM_MAP = {
  Meta: 'Meta',
}

export function getTaskTypeRelationId(taskType) {
  return TASK_TYPE_PAGE_IDS[taskType] || null
}

export function resolveFormat({ taskType, format, videoFormat, printType }) {
  if (format) return format
  if (videoFormat) return VIDEO_FORMAT_MAP[videoFormat] || videoFormat
  if (printType) return PRINT_FORMAT_MAP[printType] || 'Print'

  return DEFAULT_FORMAT_BY_TASK_TYPE[taskType] || null
}

export function resolvePlatform(platform) {
  if (!platform) return null
  return PLATFORM_MAP[platform] || platform
}

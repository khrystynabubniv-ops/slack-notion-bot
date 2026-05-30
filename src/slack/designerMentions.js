export const PENDING_DESIGNER_TEXT = 'Асайн дизайнера is coooming!'

const DESIGNER_MENTIONS = [
  {
    slackId: 'U02RU97BS9K',
    aliases: ['віра', 'вiра', 'vira', 'vera'],
  },
  {
    slackId: 'U09HWU4E95Z',
    aliases: ['олександра колосок', 'oleksandra kolosok', 'alexandra kolosok'],
  },
]

const PLACEHOLDER_NAMES = new Set([
  'дизайнер',
  'дизайн команда',
  'дизайн-команда',
  'design team',
  'designer',
  'не призначено',
].map(normalizeName))

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeMrkdwn(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function getDesignerName(designer) {
  if (!designer) return ''
  if (typeof designer === 'string') return designer

  return designer.name || ''
}

function getDesignerNames(designer) {
  const name = getDesignerName(designer)
  if (!name) return []

  return name
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !PLACEHOLDER_NAMES.has(normalizeName(part)))
}

function containsAlias(normalizedName, normalizedAlias) {
  if (!normalizedName || !normalizedAlias) return false

  return ` ${normalizedName} `.includes(` ${normalizedAlias} `)
}

export function getDesignerSlackId(designerName) {
  const normalizedName = normalizeName(designerName)
  if (!normalizedName || PLACEHOLDER_NAMES.has(normalizedName)) return null

  const match = DESIGNER_MENTIONS.find(({ aliases }) => {
    return aliases.some((alias) => containsAlias(normalizedName, normalizeName(alias)))
  })

  return match?.slackId || null
}

export function formatDesignerForSlack(designer, { fallback = PENDING_DESIGNER_TEXT } = {}) {
  const names = getDesignerNames(designer)
  if (!names.length) return fallback

  return names
    .map((name) => {
      const slackId = getDesignerSlackId(name)
      return slackId ? `<@${slackId}>` : escapeMrkdwn(name)
    })
    .join(', ')
}

export const RICH_TEXT_CONTENT_LIMIT = 2000
export const RICH_TEXT_OBJECT_LIMIT = 100

const RICH_TEXT_TRUNCATED_NOTICE = '\n\n[Обрізано: Notion має ліміт на довжину rich text поля.]'
const URL_PATTERN = /\b(?:(?:https?:\/\/|www\.)[^\s<>"'|]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:[/?#][^\s<>"'|]*)?)/gi
const TRAILING_URL_PUNCTUATION = new Set(['.', ',', ';', ':', '!', ')', ']', '}'])

function createTextObject(content, linkUrl = null) {
  const text = { content }
  if (linkUrl) text.link = { url: linkUrl }

  return {
    type: 'text',
    text,
  }
}

function normalizeLinkUrl(value) {
  const candidate = value.trim()
  if (!candidate) return null

  const linkUrl = /^https?:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`

  try {
    const url = new URL(linkUrl)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch (_) {
    return null
  }
}

function splitTrailingPunctuation(value) {
  let core = value
  let trailing = ''

  while (core && TRAILING_URL_PUNCTUATION.has(core.at(-1))) {
    trailing = `${core.at(-1)}${trailing}`
    core = core.slice(0, -1)
  }

  return { core, trailing }
}

function pushChunkedText(objects, content, linkUrl, limit) {
  if (!content) return

  for (let index = 0; index < content.length; index += limit) {
    objects.push(createTextObject(content.slice(index, index + limit), linkUrl))
  }
}

function truncateSource(value, limit, maxObjects) {
  const maxLength = limit * maxObjects
  if (value.length <= maxLength) return value

  return `${value.slice(0, Math.max(0, maxLength - RICH_TEXT_TRUNCATED_NOTICE.length))}${RICH_TEXT_TRUNCATED_NOTICE}`
}

function limitObjects(objects, maxObjects, limit) {
  if (objects.length <= maxObjects) return objects
  if (maxObjects <= 0) return []

  const keptObjects = objects.slice(0, Math.max(0, maxObjects - 1))
  keptObjects.push(createTextObject(RICH_TEXT_TRUNCATED_NOTICE.slice(0, limit)))

  return keptObjects
}

export function buildRichText(value, {
  limit = RICH_TEXT_CONTENT_LIMIT,
  maxObjects = RICH_TEXT_OBJECT_LIMIT,
  emptyText = '',
} = {}) {
  const text = String(value || '')

  if (!text) {
    return emptyText ? [createTextObject(emptyText.slice(0, limit))] : []
  }

  const source = truncateSource(text, limit, maxObjects)
  const objects = []
  let lastIndex = 0

  URL_PATTERN.lastIndex = 0

  for (const match of source.matchAll(URL_PATTERN)) {
    const candidate = match[0]
    const index = match.index
    const previousCharacter = index > 0 ? source[index - 1] : ''

    if (previousCharacter === '@') continue

    const { core, trailing } = splitTrailingPunctuation(candidate)
    const linkUrl = normalizeLinkUrl(core)
    if (!linkUrl) continue

    pushChunkedText(objects, source.slice(lastIndex, index), null, limit)
    pushChunkedText(objects, core, linkUrl, limit)
    pushChunkedText(objects, trailing, null, limit)
    lastIndex = index + candidate.length
  }

  pushChunkedText(objects, source.slice(lastIndex), null, limit)

  const limitedObjects = limitObjects(objects, maxObjects, limit)
  return limitedObjects.length
    ? limitedObjects
    : emptyText
      ? [createTextObject(emptyText.slice(0, limit))]
      : []
}

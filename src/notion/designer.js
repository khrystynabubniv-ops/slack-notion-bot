import { notionRequest } from './request.js'

const relationPageCache = new Map()
const SLACK_ID_PROPERTY_NAMES = [
  'Slack ID',
  'Slack User ID',
  'Slack user id',
  'Slack',
  'SlackId',
]

function getPlainText(richText = []) {
  return richText
    .map((item) => item.plain_text || item.text?.content || '')
    .join('')
    .trim()
}

function getPropertyText(property) {
  if (!property) return ''

  if (property.title?.length) return getPlainText(property.title)
  if (property.rich_text?.length) return getPlainText(property.rich_text)
  if (property.select?.name) return property.select.name
  if (property.email) return property.email
  if (property.url) return property.url

  return ''
}

function extractPageTitle(page) {
  const titleProperty = Object.values(page.properties || {})
    .find((property) => property?.type === 'title')

  return getPropertyText(titleProperty)
}

function extractPageEmail(page) {
  const emailProperty = Object.values(page.properties || {})
    .find((property) => property?.type === 'email' && property.email)

  if (emailProperty?.email) return emailProperty.email

  const emailLikeText = Object.values(page.properties || {})
    .map(getPropertyText)
    .find((text) => /\S+@\S+\.\S+/.test(text))

  return emailLikeText?.match(/\S+@\S+\.\S+/)?.[0] || null
}

function extractPageSlackId(page) {
  for (const propertyName of SLACK_ID_PROPERTY_NAMES) {
    const text = getPropertyText(page.properties?.[propertyName]).trim()
    if (/^[UW][A-Z0-9]+$/.test(text)) return text
  }

  return null
}

async function retrieveRelationPage(notion, pageId) {
  if (relationPageCache.has(pageId)) {
    return relationPageCache.get(pageId)
  }

  const page = await notionRequest(
    () => notion.pages.retrieve({ page_id: pageId }),
    'designer relation page retrieve'
  )
  relationPageCache.set(pageId, page)
  return page
}

async function extractRelationDesigner(property, notion) {
  const relationIds = property.relation
    ?.map((item) => item.id)
    .filter(Boolean) || []
  if (!relationIds.length || !notion) return null

  const designers = await Promise.all(
    relationIds.map(async (pageId) => {
      try {
        const page = await retrieveRelationPage(notion, pageId)
        const name = extractPageTitle(page)
        const email = extractPageEmail(page)
        const slackId = extractPageSlackId(page)

        return name || email || slackId
          ? { name, email, slackId }
          : null
      } catch (error) {
        console.warn(`Failed to resolve designer relation page ${pageId}:`, error)
        return null
      }
    })
  )
  const resolvedDesigners = designers.filter(Boolean)
  if (!resolvedDesigners.length) return null

  return {
    name: resolvedDesigners.map((designer) => designer.name).filter(Boolean).join(', '),
    email: resolvedDesigners.find((designer) => designer.email)?.email || null,
    slackId: resolvedDesigners.find((designer) => designer.slackId)?.slackId || null,
  }
}

export async function extractDesignerFromProperties(properties, notion) {
  const property = properties?.Designer || properties?.['Дизайнер']
  if (!property) return null

  if (property.people?.length) {
    const names = property.people
      .map((person) => person.name)
      .filter(Boolean)
    const emails = property.people
      .map((person) => person.person?.email)
      .filter(Boolean)

    return {
      name: names.join(', '),
      userId: property.people[0]?.id || null,
      email: emails[0] || null,
    }
  }

  if (property.relation?.length) {
    return await extractRelationDesigner(property, notion)
  }

  if (property.title?.length) {
    return {
      name: getPlainText(property.title),
      userId: null,
    }
  }

  if (property.rich_text?.length) {
    return {
      name: getPlainText(property.rich_text),
      userId: null,
    }
  }

  if (property.select?.name) {
    return {
      name: property.select.name,
      userId: null,
    }
  }

  return null
}

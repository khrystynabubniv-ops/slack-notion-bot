import { Client } from '@notionhq/client'
import { notionRequest } from './request.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DATABASE_ID = process.env.NOTION_DATABASE_ID
const PARENT_ITEM_PROPERTY = process.env.NOTION_PARENT_ITEM_PROPERTY?.trim() || 'Parent item'
const SUB_TYPE_PROPERTY = process.env.NOTION_SUB_TYPE_PROPERTY?.trim() || 'Sub-type'
const FEEDBACK_SUB_TYPE = process.env.NOTION_FEEDBACK_SUB_TYPE?.trim() || 'правка'
const RICH_TEXT_CONTENT_LIMIT = 2000
const RICH_TEXT_OBJECT_LIMIT = 100
const RICH_TEXT_TRUNCATED_NOTICE = '\n\n[Обрізано: Notion має ліміт на довжину rich text поля.]'
let databasePropertiesPromise = null

function clampText(value, limit = RICH_TEXT_CONTENT_LIMIT) {
  return value?.slice(0, limit) || ''
}

function buildRichText(value) {
  const text = value || ''
  const maxLength = RICH_TEXT_CONTENT_LIMIT * RICH_TEXT_OBJECT_LIMIT
  const source = text.length > maxLength
    ? `${text.slice(0, maxLength - RICH_TEXT_TRUNCATED_NOTICE.length)}${RICH_TEXT_TRUNCATED_NOTICE}`
    : text
  const chunks = []

  for (let index = 0; index < source.length && chunks.length < RICH_TEXT_OBJECT_LIMIT; index += RICH_TEXT_CONTENT_LIMIT) {
    chunks.push({
      type: 'text',
      text: {
        content: source.slice(index, index + RICH_TEXT_CONTENT_LIMIT),
      },
    })
  }

  return chunks.length ? chunks : [{ type: 'text', text: { content: ' ' } }]
}

async function getDatabaseProperties() {
  if (!DATABASE_ID) {
    throw new Error('NOTION_DATABASE_ID is required to create feedback sub-items.')
  }

  if (!databasePropertiesPromise) {
    databasePropertiesPromise = notionRequest(
      () => notion.databases.retrieve({ database_id: DATABASE_ID }),
      'database schema retrieve for feedback subitem'
    )
      .then((database) => database.properties || {})
      .catch((error) => {
        databasePropertiesPromise = null
        throw error
      })
  }

  return databasePropertiesPromise
}

function hasPropertyType(databaseProperties, propertyName, expectedTypes) {
  return expectedTypes.includes(databaseProperties[propertyName]?.type)
}

function resolveTitlePropertyName(databaseProperties) {
  if (hasPropertyType(databaseProperties, 'Name', ['title'])) return 'Name'

  return Object.entries(databaseProperties)
    .find(([, propertyConfig]) => propertyConfig?.type === 'title')
    ?.[0]
}

export async function createFeedbackSubitem({ parentPageId, taskName, roundNumber, feedbackText }) {
  if (!parentPageId) {
    throw new Error('parentPageId is required')
  }

  const databaseProperties = await getDatabaseProperties()
  const titlePropertyName = resolveTitlePropertyName(databaseProperties)

  if (!titlePropertyName) {
    throw new Error('Notion database is missing a title property for feedback sub-items.')
  }

  if (!hasPropertyType(databaseProperties, PARENT_ITEM_PROPERTY, ['relation'])) {
    throw new Error(`Notion database is missing relation property "${PARENT_ITEM_PROPERTY}" for feedback sub-items.`)
  }

  if (!hasPropertyType(databaseProperties, SUB_TYPE_PROPERTY, ['select'])) {
    throw new Error(`Notion database is missing select property "${SUB_TYPE_PROPERTY}" for feedback sub-items.`)
  }

  const safeTaskName = clampText(taskName || 'Без назви', 1000)
  const safeRoundNumber = Number.isFinite(Number(roundNumber)) && Number(roundNumber) > 0
    ? Number(roundNumber)
    : 1

  return await notionRequest(
    () => notion.pages.create({
      parent: { database_id: DATABASE_ID },
      properties: {
        [titlePropertyName]: {
          title: [{ text: { content: `Правка ${safeRoundNumber} — ${safeTaskName}` } }],
        },
        [PARENT_ITEM_PROPERTY]: {
          relation: [{ id: parentPageId }],
        },
        [SUB_TYPE_PROPERTY]: {
          select: { name: FEEDBACK_SUB_TYPE },
        },
      },
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: buildRichText(feedbackText),
          },
        },
      ],
    }),
    'feedback subitem create'
  )
}

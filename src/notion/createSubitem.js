import { Client } from '@notionhq/client'
import { buildTaskPageUrl } from './pageUrl.js'
import { notionRequest } from './request.js'
import { DEFAULT_STATUS, resolveStatusPropertyName } from './taskConfig.js'
import { extractDesignerFromProperties } from './designer.js'
import { getDepartment } from '../config/departments.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const PARENT_ITEM_PROPERTY = process.env.NOTION_PARENT_ITEM_PROPERTY?.trim() || 'Parent item'
const SUB_TYPE_PROPERTY = process.env.NOTION_SUB_TYPE_PROPERTY?.trim() || 'Sub-type'
const FEEDBACK_SUB_TYPE = process.env.NOTION_FEEDBACK_SUB_TYPE?.trim() || 'правка'
const DESCRIPTION_PROPERTY = process.env.NOTION_DESCRIPTION_PROPERTY?.trim() || 'Description'
const FEEDBACK_TYPE_PROPERTY = process.env.NOTION_FEEDBACK_TYPE_PROPERTY?.trim() || 'Тип правки'
const RICH_TEXT_CONTENT_LIMIT = 2000
const RICH_TEXT_OBJECT_LIMIT = 100
const RICH_TEXT_TRUNCATED_NOTICE = '\n\n[Обрізано: Notion має ліміт на довжину rich text поля.]'
const COPIED_PARENT_PROPERTIES = [
  'Team',
  'Priority',
  'Deadline',
  'Task Type',
  'Designer',
  'Slack Person',
  'Final project',
]
const databasePropertiesPromises = new Map()

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

async function getDatabaseProperties(department) {
  const databaseId = department.notionDataSourceId
  if (!databaseId) {
    throw new Error(`Notion database id is required to create feedback sub-items for ${department.key}.`)
  }

  if (!databasePropertiesPromises.has(databaseId)) {
    const schemaPromise = notionRequest(
      () => notion.databases.retrieve({ database_id: databaseId }),
      `database schema retrieve for feedback subitem (${department.key})`
    )
      .then((database) => database.properties || {})
      .catch((error) => {
        databasePropertiesPromises.delete(databaseId)
        throw error
      })

    databasePropertiesPromises.set(databaseId, schemaPromise)
  }

  return databasePropertiesPromises.get(databaseId)
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

function getPlainText(richText = []) {
  return richText
    .map((item) => item.plain_text || item.text?.content || '')
    .join('')
    .trim()
}

function buildPropertyValue(property, expectedType) {
  if (!property) return null

  switch (expectedType) {
    case 'select':
      return property.select?.name
        ? { select: { name: property.select.name } }
        : null
    case 'multi_select':
      return property.multi_select?.length
        ? { multi_select: property.multi_select.map((option) => ({ name: option.name })) }
        : null
    case 'date':
      return property.date
        ? { date: property.date }
        : null
    case 'relation':
      return property.relation?.length
        ? { relation: property.relation.map((item) => ({ id: item.id })) }
        : null
    case 'people':
      return property.people?.length
        ? { people: property.people.map((person) => ({ id: person.id })) }
        : null
    case 'rich_text': {
      const text = getPlainText(property.rich_text)
      return text
        ? { rich_text: buildRichText(text) }
        : null
    }
    case 'url': {
      const url = typeof property.url === 'string' ? property.url.trim() : ''
      return url ? { url } : null
    }
    default:
      return null
  }
}

function addCopiedParentProperty(properties, databaseProperties, parentProperties, propertyName) {
  const expectedType = databaseProperties[propertyName]?.type
  if (!expectedType) return

  const value = buildPropertyValue(parentProperties[propertyName], expectedType)
  if (value) properties[propertyName] = value
}

function addDesignerOwner(properties, databaseProperties, parentProperties) {
  if (!hasPropertyType(databaseProperties, 'Owner', ['people'])) return

  const designerPeople = parentProperties.Designer?.people || parentProperties['Дизайнер']?.people || []
  const ownerPeople = designerPeople.length ? designerPeople : parentProperties.Owner?.people || []
  const value = buildPropertyValue({ people: ownerPeople }, 'people')

  if (value) properties.Owner = value
}

function normalizeFeedbackType(feedbackType) {
  if (!feedbackType?.value && !feedbackType?.label) return null

  return {
    value: feedbackType.value || null,
    label: feedbackType.label || feedbackType.value || null,
  }
}

function addFeedbackTypeProperty(properties, databaseProperties, feedbackType) {
  if (!feedbackType?.label) return

  const propertyType = databaseProperties[FEEDBACK_TYPE_PROPERTY]?.type
  if (!propertyType) return

  if (propertyType === 'select') {
    properties[FEEDBACK_TYPE_PROPERTY] = { select: { name: feedbackType.label } }
  } else if (propertyType === 'status') {
    properties[FEEDBACK_TYPE_PROPERTY] = { status: { name: feedbackType.label } }
  } else if (propertyType === 'multi_select') {
    properties[FEEDBACK_TYPE_PROPERTY] = { multi_select: [{ name: feedbackType.label }] }
  } else if (propertyType === 'rich_text') {
    properties[FEEDBACK_TYPE_PROPERTY] = { rich_text: buildRichText(feedbackType.label) }
  }
}

export async function createFeedbackSubitem({
  departmentKey = 'design',
  parentPageId,
  taskName,
  roundNumber,
  feedbackText,
  feedbackType,
}) {
  if (!parentPageId) {
    throw new Error('parentPageId is required')
  }

  const department = getDepartment(departmentKey)
  const [databaseProperties, parentPage] = await Promise.all([
    getDatabaseProperties(department),
    notionRequest(
      () => notion.pages.retrieve({ page_id: parentPageId }),
      'parent task retrieve for feedback subitem'
    ),
  ])
  const parentProperties = parentPage.properties || {}
  const titlePropertyName = resolveTitlePropertyName(databaseProperties)
  const designer = await extractDesignerFromProperties(parentProperties, notion)

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
  const feedbackTaskName = `Правка ${safeRoundNumber} — ${safeTaskName}`
  const statusPropertyName = resolveStatusPropertyName(databaseProperties, department.key)
  const normalizedFeedbackType = normalizeFeedbackType(feedbackType)
  const properties = {
    [titlePropertyName]: {
      title: [{ text: { content: feedbackTaskName } }],
    },
    [PARENT_ITEM_PROPERTY]: {
      relation: [{ id: parentPageId }],
    },
    [SUB_TYPE_PROPERTY]: {
      select: { name: FEEDBACK_SUB_TYPE },
    },
  }

  for (const propertyName of COPIED_PARENT_PROPERTIES) {
    addCopiedParentProperty(properties, databaseProperties, parentProperties, propertyName)
  }

  addDesignerOwner(properties, databaseProperties, parentProperties)
  addFeedbackTypeProperty(properties, databaseProperties, normalizedFeedbackType)

  if (hasPropertyType(databaseProperties, DESCRIPTION_PROPERTY, ['rich_text'])) {
    properties[DESCRIPTION_PROPERTY] = {
      rich_text: buildRichText(feedbackText),
    }
  }

  if (hasPropertyType(databaseProperties, statusPropertyName, ['status'])) {
    properties[statusPropertyName] = {
      status: { name: DEFAULT_STATUS },
    }
  }

  const response = await notionRequest(
    () => notion.pages.create({
      parent: { database_id: department.notionDataSourceId },
      properties: {
        ...properties,
      },
    }),
    `feedback subitem create (${department.key})`
  )

  return {
    pageId: response.id,
    pageUrl: buildTaskPageUrl(response.id, response.url),
    taskName: feedbackTaskName,
    initialStatus: DEFAULT_STATUS,
    finalProjectUrl: parentProperties['Final project']?.url || null,
    designer,
  }
}

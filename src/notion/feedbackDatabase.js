import { Client } from '@notionhq/client'
import { notionRequest } from './request.js'
import { getDepartment } from '../config/departments.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DEFAULT_FEEDBACK_DATABASE_ID = '164e70dbe0774b8ca7fa761ab2f0e6a5'
const fallbackFeedbackDatabaseId = process.env.NOTION_FEEDBACK_DATABASE_ID?.trim() || DEFAULT_FEEDBACK_DATABASE_ID
const feedbackDatabasePropertiesPromises = new Map()

function getFeedbackDatabaseId(departmentKey) {
  const department = getDepartment(departmentKey)
  return department.feedbackDatabaseId || fallbackFeedbackDatabaseId
}

async function getFeedbackDatabaseProperties(databaseId) {
  if (!databaseId) return null

  if (!feedbackDatabasePropertiesPromises.has(databaseId)) {
    const schemaPromise = notionRequest(
      () => notion.databases.retrieve({ database_id: databaseId }),
      `feedback database schema retrieve (${databaseId})`
    )
      .then((database) => database.properties || {})
      .catch((error) => {
        feedbackDatabasePropertiesPromises.delete(databaseId)
        throw error
      })

    feedbackDatabasePropertiesPromises.set(databaseId, schemaPromise)
  }

  return feedbackDatabasePropertiesPromises.get(databaseId)
}

function resolveTitlePropertyName(databaseProperties = {}) {
  return Object.entries(databaseProperties)
    .find(([, propertyConfig]) => propertyConfig?.type === 'title')
    ?.[0]
}

function findProperty(databaseProperties, names, expectedTypes) {
  return names.find((name) => {
    const property = databaseProperties[name]
    return property && expectedTypes.includes(property.type)
  })
}

function addTextProperty(properties, databaseProperties, names, value) {
  if (!value) return

  const propertyName = findProperty(databaseProperties, names, ['rich_text', 'title'])
  if (!propertyName) return

  if (databaseProperties[propertyName].type === 'title') {
    properties[propertyName] = {
      title: [{ text: { content: String(value).slice(0, 2000) } }],
    }
    return
  }

  properties[propertyName] = {
    rich_text: [{ text: { content: String(value).slice(0, 2000) } }],
  }
}

function addUrlProperty(properties, databaseProperties, names, value) {
  if (!value) return

  const propertyName = findProperty(databaseProperties, names, ['url', 'rich_text'])
  if (!propertyName) return

  if (databaseProperties[propertyName].type === 'url') {
    properties[propertyName] = { url: value }
    return
  }

  properties[propertyName] = {
    rich_text: [{ text: { content: String(value).slice(0, 2000) } }],
  }
}

function addDateProperty(properties, databaseProperties, names, value) {
  if (!value) return

  const propertyName = findProperty(databaseProperties, names, ['date'])
  if (!propertyName) return

  properties[propertyName] = {
    date: { start: value },
  }
}

function addNumberOrSelectProperty(properties, databaseProperties, names, value) {
  if (value === null || value === undefined) return

  const propertyName = findProperty(databaseProperties, names, ['number', 'select', 'rich_text'])
  if (!propertyName) return

  const type = databaseProperties[propertyName].type
  if (type === 'number') {
    properties[propertyName] = { number: Number(value) }
  } else if (type === 'select') {
    properties[propertyName] = { select: { name: String(value) } }
  } else {
    properties[propertyName] = {
      rich_text: [{ text: { content: String(value).slice(0, 2000) } }],
    }
  }
}

function addSelectOrTextProperty(properties, databaseProperties, names, value) {
  if (!value) return

  const propertyName = findProperty(databaseProperties, names, ['select', 'rich_text'])
  if (!propertyName) return

  if (databaseProperties[propertyName].type === 'select') {
    properties[propertyName] = { select: { name: String(value).slice(0, 100) } }
    return
  }

  properties[propertyName] = {
    rich_text: [{ text: { content: String(value).slice(0, 2000) } }],
  }
}

function addMultiSelectOrTextProperty(properties, databaseProperties, names, values) {
  if (!values?.length) return

  const propertyName = findProperty(databaseProperties, names, ['multi_select', 'rich_text'])
  if (!propertyName) return

  if (databaseProperties[propertyName].type === 'multi_select') {
    properties[propertyName] = {
      multi_select: values.map((value) => ({ name: String(value).slice(0, 100) })),
    }
    return
  }

  properties[propertyName] = {
    rich_text: [{ text: { content: values.join(', ').slice(0, 2000) } }],
  }
}

export async function syncQualityFeedbackToNotion(record) {
  const feedbackDatabaseId = getFeedbackDatabaseId(record.departmentKey)

  if (!feedbackDatabaseId) {
    console.warn('NOTION_FEEDBACK_DATABASE_ID is not set; quality feedback saved only in Redis.')
    return { skipped: true }
  }

  const databaseProperties = await getFeedbackDatabaseProperties(feedbackDatabaseId)
  const titlePropertyName = resolveTitlePropertyName(databaseProperties)

  if (!titlePropertyName) {
    throw new Error('Feedback database is missing a title property.')
  }

  const properties = {
    [titlePropertyName]: {
      title: [{ text: { content: `Фідбек — ${record.taskName || record.pageId || 'задача'}`.slice(0, 2000) } }],
    },
  }

  addNumberOrSelectProperty(properties, databaseProperties, ['Rating', 'Оцінка'], record.rating)
  addTextProperty(properties, databaseProperties, ['Comment', 'Коментар'], record.comment)
  addTextProperty(properties, databaseProperties, ['Request ID', 'Request Id', 'Page ID', 'ID задачі'], record.pageId)
  addUrlProperty(properties, databaseProperties, ['Request URL', 'Request Url', 'URL', 'Посилання на задачу'], record.requestUrl)
  addTextProperty(properties, databaseProperties, ['Requester', 'Замовник'], record.requesterName)
  addTextProperty(properties, databaseProperties, ['Slack User ID', 'Slack user id', 'Slack ID'], record.slackUserId)
  addSelectOrTextProperty(properties, databaseProperties, ['Team', 'Команда'], record.team)
  addSelectOrTextProperty(properties, databaseProperties, ['Hub'], record.hub)
  addSelectOrTextProperty(properties, databaseProperties, ['Request Type', 'Тип задачі'], record.requestType)
  addMultiSelectOrTextProperty(properties, databaseProperties, ['Categories', 'Причини', 'Що не вистачило'], record.categories)
  addDateProperty(properties, databaseProperties, ['Submitted At', 'Submitted at', 'Дата фідбеку'], record.feedbackSubmittedAt)
  addDateProperty(properties, databaseProperties, ['Completed At', 'Completed at', 'Завершено'], record.completedAt)

  const response = await notionRequest(
    () => notion.pages.create({
      parent: { database_id: feedbackDatabaseId },
      properties,
    }),
    'quality feedback create'
  )

  return { skipped: false, pageId: response.id, url: response.url }
}

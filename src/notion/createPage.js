import { Client } from '@notionhq/client'
import {
  DEFAULT_STATUS,
  getTaskTypeRelationId,
  resolveStatusPropertyName,
  resolvePlatform,
} from './taskConfig.js'
import { getDepartment, getTestTaskPrefix } from '../config/departments.js'
import { buildTaskPageUrl } from './pageUrl.js'
import { notionRequest } from './request.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const notionTemplateApi = new Client({
  auth: process.env.NOTION_TOKEN,
  notionVersion: '2026-03-11',
})
const TEMPLATE_TIMEZONE = process.env.NOTION_TEMPLATE_TIMEZONE?.trim() || 'Europe/Kiev'
const RICH_TEXT_CONTENT_LIMIT = 2000
const RICH_TEXT_OBJECT_LIMIT = 100
const RICH_TEXT_TRUNCATED_NOTICE = '\n\n[Обрізано: Notion має ліміт на довжину rich text поля.]'
const databaseSchemaPromises = new Map()

function clampText(value, limit = 2000) {
  return value?.slice(0, limit) || ''
}

function buildRichText(value, limit = RICH_TEXT_CONTENT_LIMIT, maxObjects = RICH_TEXT_OBJECT_LIMIT) {
  if (!value) return []

  const maxLength = limit * maxObjects
  const source = value.length > maxLength
    ? `${value.slice(0, maxLength - RICH_TEXT_TRUNCATED_NOTICE.length)}${RICH_TEXT_TRUNCATED_NOTICE}`
    : value
  const chunks = []
  for (let index = 0; index < source.length && chunks.length < maxObjects; index += limit) {
    chunks.push({
      text: {
        content: source.slice(index, index + limit),
      },
    })
  }

  return chunks
}

function buildRichTextLink(content, url) {
  return {
    type: 'text',
    text: {
      content: clampText(content),
      link: { url },
    },
  }
}

async function applyTemplateToPage(pageId, department) {
  if (!department.notionTemplateId) return false

  await notionRequest(
    () => notionTemplateApi.request({
      path: `pages/${pageId}`,
      method: 'patch',
      body: {
        template: {
          type: 'template_id',
          template_id: department.notionTemplateId,
          timezone: TEMPLATE_TIMEZONE,
        },
        erase_content: true,
      },
    }),
    'template apply'
  )

  return true
}

async function getDatabaseProperties(department) {
  const databaseId = department.notionDataSourceId
  if (!databaseId) {
    throw new Error(`Notion database id is not configured for department "${department.key}".`)
  }

  if (!databaseSchemaPromises.has(databaseId)) {
    const schemaPromise = notionRequest(
      () => notion.databases.retrieve({ database_id: databaseId }),
      `database schema retrieve (${department.key})`
    )
      .then((database) => database.properties || {})
      .catch((error) => {
        databaseSchemaPromises.delete(databaseId)
        throw error
      })

    databaseSchemaPromises.set(databaseId, schemaPromise)
  }

  return databaseSchemaPromises.get(databaseId)
}

function buildSlackPersonProperty(propertyConfig, slackPersonName) {
  if (!propertyConfig || !slackPersonName) return null

  switch (propertyConfig.type) {
    case 'title':
      return {
        title: [{ text: { content: slackPersonName.slice(0, 2000) } }],
      }
    case 'rich_text':
      return {
        rich_text: [{ text: { content: slackPersonName.slice(0, 2000) } }],
      }
    case 'select':
      return {
        select: { name: slackPersonName.slice(0, 100) },
      }
    default:
      return null
  }
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

function addPropertyIfType(properties, databaseProperties, propertyName, expectedTypes, value) {
  if (!propertyName || !hasPropertyType(databaseProperties, propertyName, expectedTypes)) {
    return false
  }

  properties[propertyName] = value
  return true
}

function buildPropertyForDatabaseType(propertyType, value) {
  if (value === null || value === undefined || value === '') return null

  const values = Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean)
  const firstValue = values[0]
  if (!firstValue) return null

    switch (propertyType) {
    case 'rich_text':
      return { rich_text: buildRichText(values.join(', ')) }
    case 'url': {
      const url = String(firstValue).trim()
      try {
        return { url: new URL(url).toString() }
      } catch (_) {
        try {
          return { url: new URL(`https://${url}`).toString() }
        } catch (_) {
          return null
        }
      }
    }
    case 'select':
      return { select: { name: String(firstValue).slice(0, 100) } }
    case 'multi_select':
      return {
        multi_select: values.map((item) => ({ name: String(item).slice(0, 100) })),
      }
    case 'date': {
      const dateValue = String(firstValue).trim()
      return /^\d{4}-\d{2}-\d{2}/.test(dateValue)
        ? { date: { start: dateValue } }
        : null
    }
    case 'checkbox':
      return { checkbox: Boolean(firstValue) }
    case 'number': {
      const parsed = Number.parseFloat(String(firstValue).replace(',', '.'))
      return Number.isFinite(parsed) ? { number: parsed } : null
    }
    case 'status':
      return { status: { name: String(firstValue).slice(0, 100) } }
    default:
      return null
  }
}

function addPropertyByDatabaseType(properties, databaseProperties, propertyNames, value) {
  for (const propertyName of propertyNames.filter(Boolean)) {
    const propertyType = databaseProperties[propertyName]?.type
    if (!propertyType) continue

    const propertyValue = buildPropertyForDatabaseType(propertyType, value)
    if (!propertyValue) continue

    properties[propertyName] = propertyValue
    return true
  }

  return false
}

function buildTitle(name) {
  return [{ text: { content: clampText(name) || 'Untitled' } }]
}

function buildDescription({
  fullName,
  context,
  style,
  antiref,
  canEditText,
  platformOther,
  specificFields,
  fieldAnswers,
  artifacts,
}) {
  const lines = []

  if (fullName) lines.push(`📌 Повна назва: ${fullName}`)
  if (context) lines.push(`📌 Контекст: ${context}`)
  if (style) lines.push(`🎨 Стиль/Референси: ${style}`)
  if (antiref) lines.push(`🚫 Антиреференси: ${antiref}`)
  if (canEditText !== undefined) lines.push(`✏️ Дизайнер може правити текст: ${canEditText}`)
  if (platformOther) lines.push(`📱 Platform (other): ${platformOther}`)

  if (specificFields && Object.keys(specificFields).length > 0) {
    lines.push('\n— СПЕЦИФІЧНІ ПОЛЯ —')
    for (const [label, value] of Object.entries(specificFields)) {
      if (value) lines.push(`${label}: ${value}`)
    }
  } else if (fieldAnswers?.length) {
    lines.push('\n— ПОЛЯ БРИФУ —')
    for (const field of fieldAnswers) {
      if (field.formattedValue) lines.push(`${field.label}: ${field.formattedValue}`)
    }
  }

  if (artifacts && Object.keys(artifacts).length > 0) {
    lines.push('\n— АРТЕФАКТИ —')
    for (const [label, value] of Object.entries(artifacts)) {
      if (value) lines.push(`📎 ${label}: ${value}`)
    }
  }

  return lines.join('\n')
}

export async function createNotionPage({
  departmentKey = 'design',
  name,
  priority,
  deadline,
  videoFormat,
  platform,
  platforms = [],
  platformOther,
  taskType,
  context,
  style,
  antiref,
  canEditText,
  specificFields = {},
  fieldAnswers = [],
  artifacts = {},
  slackPersonName,
}) {
  const department = getDepartment(departmentKey)
  const truncatedTitle = clampText(name)
  const description = buildDescription({
    fullName: truncatedTitle !== name ? name : null,
    context,
    style,
    antiref,
    canEditText,
    platformOther,
    specificFields,
    fieldAnswers,
    artifacts,
  })
  const taskTypeRelationId = getTaskTypeRelationId(taskType, department.key)
  const notionPlatform = resolvePlatform(platform)
  const databaseProperties = await getDatabaseProperties(department)
  const titlePropertyName = resolveTitlePropertyName(databaseProperties)
  const statusPropertyName = resolveStatusPropertyName(databaseProperties, department.key)

  if (!titlePropertyName) {
    throw new Error('Notion database is missing a title property for task name.')
  }

  const properties = {
    [titlePropertyName]: {
      title: buildTitle(name),
    },
  }

  addPropertyIfType(properties, databaseProperties, statusPropertyName, ['status'], {
    status: { name: DEFAULT_STATUS },
  })
  if (department.key === 'design') {
    addPropertyIfType(properties, databaseProperties, 'Design needed', ['checkbox'], {
      checkbox: true,
    })
  }
  addPropertyIfType(properties, databaseProperties, 'Team', ['select'], {
    select: { name: department.team },
  })
  if (department.ownerId) {
    addPropertyIfType(properties, databaseProperties, 'Owner', ['people'], {
      people: [{ id: department.ownerId }],
    })
  }

  if (priority) {
    addPropertyIfType(properties, databaseProperties, 'Priority', ['select'], {
      select: { name: priority },
    })
  }

  if (deadline) {
    addPropertyIfType(properties, databaseProperties, 'Deadline', ['date'], {
      date: { start: deadline },
    })
  }

  const normalizedPlatforms = platforms.length ? platforms.map(resolvePlatform).filter(Boolean) : [notionPlatform].filter(Boolean)
  if (normalizedPlatforms.length) {
    if (!addPropertyByDatabaseType(properties, databaseProperties, ['Platform', 'Platforms'], normalizedPlatforms)) {
      addPropertyIfType(properties, databaseProperties, 'Platform', ['select'], {
        select: { name: normalizedPlatforms[0] },
      })
    }
  }

  if (taskTypeRelationId) {
    addPropertyIfType(properties, databaseProperties, 'Task Type', ['relation'], {
      relation: [{ id: taskTypeRelationId }],
    })
  } else {
    addPropertyByDatabaseType(
      properties,
      databaseProperties,
      ['Task Type', 'Request type', 'Type'],
      department.taskTypes[taskType]?.label || taskType
    )
  }

  for (const field of fieldAnswers) {
    const propertyValue = field.type === 'slack_user' ? field.formattedValue : field.value
    addPropertyByDatabaseType(
      properties,
      databaseProperties,
      field.notionProperties || [],
      propertyValue
    )
  }

  if (getTestTaskPrefix()) {
    addPropertyByDatabaseType(properties, databaseProperties, ['Test'], true)
    addPropertyByDatabaseType(properties, databaseProperties, ['Tags', 'Tag'], 'Test')
  }

  const slackPersonProperty = buildSlackPersonProperty(databaseProperties['Slack Person'], slackPersonName)
  if (slackPersonProperty) properties['Slack Person'] = slackPersonProperty

  if (description) {
    addPropertyIfType(properties, databaseProperties, 'Description', ['rich_text'], {
      rich_text: buildRichText(description),
    })
  }

  const response = await notionRequest(
    () => notion.pages.create({
      parent: { database_id: department.notionDataSourceId },
      properties,
    }),
    `page create (${department.key})`
  )

  let templateApplied = false

  try {
    templateApplied = await applyTemplateToPage(response.id, department)
  } catch (error) {
    console.error('Notion template apply failed:', error)
  }

  return {
    pageId: response.id,
    pageUrl: buildTaskPageUrl(response.id, response.url),
    templateApplied,
  }
}

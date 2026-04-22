import { Client } from '@notionhq/client'
import {
  DEFAULT_ACTIVITY_TYPE,
  DEFAULT_OWNER_ID,
  DEFAULT_TEAM,
  getTaskTypeRelationId,
  resolvePlatform,
} from './taskConfig.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DATABASE_ID = process.env.NOTION_DATABASE_ID
let databaseSchemaPromise = null

async function getDatabaseProperties() {
  if (!databaseSchemaPromise) {
    databaseSchemaPromise = notion.databases
      .retrieve({ database_id: DATABASE_ID })
      .then((database) => database.properties || {})
      .catch((error) => {
        databaseSchemaPromise = null
        throw error
      })
  }

  return databaseSchemaPromise
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

function buildDescription({ context, style, antiref, canEditText, platformOther, specificFields, artifacts }) {
  const lines = []

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
  name,
  priority,
  deadline,
  videoFormat,
  platform,
  platformOther,
  taskType,
  context,
  style,
  antiref,
  canEditText,
  specificFields = {},
  artifacts = {},
  slackPersonName,
}) {
  const description = buildDescription({
    context,
    style,
    antiref,
    canEditText,
    platformOther,
    specificFields,
    artifacts,
  })
  const taskTypeRelationId = getTaskTypeRelationId(taskType)
  const notionPlatform = resolvePlatform(platform)
  const databaseProperties = await getDatabaseProperties()

  const properties = {
    Name: {
      title: [{ text: { content: name } }],
    },
    Status: {
      status: { name: 'To do' },
    },
    'Design needed': {
      checkbox: true,
    },
    Team: {
      select: { name: DEFAULT_TEAM },
    },
    Owner: {
      people: [{ id: DEFAULT_OWNER_ID }],
    },
    Type: {
      select: { name: DEFAULT_ACTIVITY_TYPE },
    },
  }

  if (priority) properties.Priority = { select: { name: priority } }
  if (deadline) properties.Deadline = { date: { start: deadline } }
  if (notionPlatform) properties.Platform = { select: { name: notionPlatform } }
  if (taskTypeRelationId) properties['Task Type'] = { relation: [{ id: taskTypeRelationId }] }

  const slackPersonProperty = buildSlackPersonProperty(databaseProperties['Slack Person'], slackPersonName)
  if (slackPersonProperty) properties['Slack Person'] = slackPersonProperty

  if (description) {
    properties.Description = {
      rich_text: [{ text: { content: description.slice(0, 2000) } }],
    }
  }

  const response = await notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties,
  })

  return {
    pageId: response.id,
    pageUrl: response.url,
  }
}

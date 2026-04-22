import { Client } from '@notionhq/client'
import {
  DEFAULT_ACTIVITY_TYPE,
  DEFAULT_OWNER_ID,
  DEFAULT_TEAM,
  getTaskTypeRelationId,
  resolvePlatform,
} from './taskConfig.js'
import { buildTaskPageUrl } from './pageUrl.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const notionTemplateApi = new Client({
  auth: process.env.NOTION_TOKEN,
  notionVersion: '2026-03-11',
})
const DATABASE_ID = process.env.NOTION_DATABASE_ID
let databaseSchemaPromise = null
const TEMPLATE_ID = process.env.NOTION_TEMPLATE_ID?.trim()
const TEMPLATE_TIMEZONE = process.env.NOTION_TEMPLATE_TIMEZONE?.trim() || 'Europe/Kiev'

function clampText(value, limit = 2000) {
  return value?.slice(0, limit) || ''
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

async function applyTemplateToPage(pageId) {
  if (!TEMPLATE_ID) return false

  await notionTemplateApi.request({
    path: `pages/${pageId}`,
    method: 'patch',
    body: {
      template: {
        type: 'template_id',
        template_id: TEMPLATE_ID,
        timezone: TEMPLATE_TIMEZONE,
      },
      erase_content: true,
    },
  })

  return true
}

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
      rich_text: [{ text: { content: clampText(description) } }],
    }
  }

  const response = await notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties,
  })

  let templateApplied = false

  try {
    templateApplied = await applyTemplateToPage(response.id)
  } catch (error) {
    console.error('Notion template apply failed:', error)
  }

  return {
    pageId: response.id,
    pageUrl: buildTaskPageUrl(response.id, response.url),
    templateApplied,
  }
}

import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DATABASE_ID = process.env.NOTION_DATABASE_ID

function buildDescription({ context, style, antiref, canEditText, specificFields, artifacts }) {
  const lines = []

  if (context) lines.push(`📌 Контекст: ${context}`)
  if (style) lines.push(`🎨 Стиль/Референси: ${style}`)
  if (antiref) lines.push(`🚫 Антиреференси: ${antiref}`)
  if (canEditText !== undefined) lines.push(`✏️ Дизайнер може правити текст: ${canEditText}`)

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
  format,
  platform,
  team,
  type,
  context,
  style,
  antiref,
  canEditText,
  specificFields = {},
  artifacts = {},
}) {
  const description = buildDescription({ context, style, antiref, canEditText, specificFields, artifacts })

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
  }

  if (priority) properties.Priority = { select: { name: priority } }
  if (deadline) properties.Deadline = { date: { start: deadline } }
  if (format) properties.Format = { select: { name: format } }
  if (platform) properties.Platform = { select: { name: platform } }
  if (team) properties.Team = { select: { name: team } }
  if (type) properties.Type = { select: { name: type } }

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
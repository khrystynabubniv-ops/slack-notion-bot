import { Client } from '@notionhq/client'
import { notionRequest } from './request.js'
import { buildRichText } from './richText.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

export async function createSlackThreadComment({ pageId, authorName, text }) {
  if (!pageId) {
    throw new Error('pageId is required')
  }

  const normalizedAuthorName = normalizeText(authorName) || 'невідомий автор'
  const normalizedText = normalizeText(text)

  const body = [
    `Slack thread · ${normalizedAuthorName}`,
    '',
    normalizedText || 'Без тексту.',
  ]
    .filter(Boolean)
    .join('\n')

  return await notionRequest(
    () => notion.comments.create({
      parent: { page_id: pageId },
      rich_text: buildRichText(body, { emptyText: ' ' }),
    }),
    'slack thread comment create'
  )
}

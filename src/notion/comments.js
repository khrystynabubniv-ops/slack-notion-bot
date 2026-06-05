import { Client } from '@notionhq/client'
import { notionRequest } from './request.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const NOTION_RICH_TEXT_LIMIT = 2000

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

function chunkText(value) {
  const text = normalizeText(value)
  if (!text) return ['']

  const chunks = []
  for (let index = 0; index < text.length; index += NOTION_RICH_TEXT_LIMIT) {
    chunks.push(text.slice(index, index + NOTION_RICH_TEXT_LIMIT))
  }

  return chunks
}

function buildRichText(value) {
  return chunkText(value).map((content) => ({
    type: 'text',
    text: {
      content,
    },
  }))
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
      rich_text: buildRichText(body),
    }),
    'slack thread comment create'
  )
}

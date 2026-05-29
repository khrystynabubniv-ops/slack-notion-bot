import { Client } from '@notionhq/client'
import { notionRequest } from './request.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const RICH_TEXT_CONTENT_LIMIT = 2000
const RICH_TEXT_OBJECT_LIMIT = 100
const RICH_TEXT_TRUNCATED_NOTICE = '\n\n[Обрізано: Notion має ліміт на довжину rich text поля.]'

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

export async function createFeedbackSubitem({ parentPageId, taskName, roundNumber, feedbackText }) {
  if (!parentPageId) {
    throw new Error('parentPageId is required')
  }

  const safeTaskName = clampText(taskName || 'Без назви', 1000)
  const safeRoundNumber = Number.isFinite(Number(roundNumber)) && Number(roundNumber) > 0
    ? Number(roundNumber)
    : 1

  return await notionRequest(
    () => notion.pages.create({
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{ text: { content: `Правка ${safeRoundNumber} — ${safeTaskName}` } }],
        },
        'Sub-type': {
          select: { name: 'правка' },
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

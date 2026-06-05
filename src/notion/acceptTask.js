import { Client } from '@notionhq/client'
import { notionRequest } from './request.js'
import { resolveStatusPropertyName } from './taskConfig.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })

function extractDesigner(page) {
  const property = page.properties?.['Дизайнер'] || page.properties?.Designer
  if (!property) return null

  if (property.people?.length) {
    const names = property.people
      .map((person) => person.name)
      .filter(Boolean)

    return {
      name: names.join(', '),
      userId: property.people[0]?.id || null,
    }
  }

  if (property.title?.length) {
    return {
      name: property.title.map((item) => item.plain_text).join('').trim(),
      userId: null,
    }
  }

  if (property.rich_text?.length) {
    return {
      name: property.rich_text.map((item) => item.plain_text).join('').trim(),
      userId: null,
    }
  }

  if (property.select?.name) {
    return {
      name: property.select.name,
      userId: null,
    }
  }

  return null
}

function buildFallbackDesignerHandle(designerName) {
  if (!designerName) return ''

  const handle = designerName
    .toLowerCase()
    .replace(/[^a-zа-яіїєґ0-9\s._-]/gi, '')
    .trim()
    .replace(/\s+/g, '_')

  return handle ? `@${handle} ` : ''
}

function buildAcceptanceCommentRichText({
  designerUserId,
  designerName,
  acceptedStatus = 'Ready',
  taskKind = 'task',
}) {
  const richText = []

  if (designerUserId) {
    richText.push({
      type: 'mention',
      mention: {
        type: 'user',
        user: {
          id: designerUserId,
        },
      },
    })
    richText.push({
      type: 'text',
      text: {
        content: ' ',
      },
    })
  } else {
    const fallbackHandle = buildFallbackDesignerHandle(designerName)
    if (fallbackHandle) {
      richText.push({
        type: 'text',
        text: {
          content: fallbackHandle,
        },
      })
    }
  }

  const acceptedText = taskKind === 'feedback'
    ? `замовник прийняв правку, статус оновлено на «${acceptedStatus}».`
    : 'замовник прийняв задачу, позначено як готово!'

  richText.push({
    type: 'text',
    text: {
      content: acceptedText,
    },
  })

  return richText
}

export async function acceptTaskResult({
  departmentKey = 'design',
  pageId,
  designerName,
  designerUserId,
  acceptedStatus = 'Ready',
  taskKind = 'task',
}) {
  if (!pageId) {
    throw new Error('pageId is required')
  }

  const page = await notionRequest(
    () => notion.pages.retrieve({ page_id: pageId }),
    'task retrieve before accept'
  )
  const statusPropertyName = resolveStatusPropertyName(page.properties || {}, departmentKey)
  const pageDesigner = extractDesigner(page)
  const resolvedDesigner = {
    name: designerName || pageDesigner?.name || null,
    userId: designerUserId || pageDesigner?.userId || null,
  }

  await notionRequest(
    () => notion.pages.update({
      page_id: pageId,
      properties: {
        [statusPropertyName]: {
          status: { name: acceptedStatus },
        },
      },
    }),
    'task accept status update'
  )

  try {
    await notionRequest(
      () => notion.comments.create({
        parent: { page_id: pageId },
        rich_text: buildAcceptanceCommentRichText({
          designerUserId: resolvedDesigner.userId,
          designerName: resolvedDesigner.name,
          acceptedStatus,
          taskKind,
        }),
      }),
      'task accept comment create'
    )

    return { designer: resolvedDesigner, commentCreated: true }
  } catch (error) {
    console.error(`Failed to add acceptance comment for page ${pageId}:`, error)
    return {
      designer: resolvedDesigner,
      commentCreated: false,
      commentError: error?.message || String(error),
    }
  }
}

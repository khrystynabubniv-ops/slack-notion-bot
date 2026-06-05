import { createSlackThreadComment } from '../notion/comments.js'
import {
  claimSlackThreadCommentSync,
  getTaskBySlackThread,
  releaseSlackThreadCommentSync,
  updateLastComment,
} from '../redis/store.js'

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeSlackEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function formatSlackText(value) {
  return decodeSlackEntities(value)
    .replace(/<([^>|]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<([^>]+)>/g, '$1')
    .trim()
}

function getSlackEventSyncId(event) {
  return event.client_msg_id || `${event.channel}:${event.ts}`
}

function getSlackThreadTs(event) {
  return event.thread_ts || null
}

function isHumanThreadReply(event) {
  if (!event) return false
  if (event.subtype || event.bot_id || event.app_id) return false
  if (!event.user || !event.channel || !event.ts) return false

  const threadTs = getSlackThreadTs(event)
  if (!threadTs || threadTs === event.ts) return false

  if (event.channel_type && event.channel_type !== 'im') return false

  return true
}

async function resolveSlackAuthorName(client, userId) {
  if (!client || !userId) return userId || null

  try {
    const response = await client.users.info({ user: userId })
    const profile = response.user?.profile

    return (
      profile?.real_name ||
      profile?.display_name ||
      response.user?.real_name ||
      response.user?.name ||
      userId
    )
  } catch (error) {
    console.error(`Failed to resolve Slack user ${userId} for Notion comment sync:`, error)
    return userId
  }
}

async function notifySyncFailure(client, event, error) {
  if (!client || !event?.channel || !event?.thread_ts) return

  const slackError = error?.data?.error || error?.code || error?.message || String(error)

  try {
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts,
      text: `Не зміг перенести цей коментар у Notion. Помилка: ${slackError}`,
    })
  } catch (notifyError) {
    console.error('Failed to notify Slack thread about Notion comment sync failure:', notifyError)
  }
}

export async function handleSlackThreadCommentEvent({
  event,
  client,
  findTaskBySlackThread = getTaskBySlackThread,
  createComment = createSlackThreadComment,
  checkpointComment = updateLastComment,
  claimSync = claimSlackThreadCommentSync,
  releaseSync = releaseSlackThreadCommentSync,
}) {
  if (!isHumanThreadReply(event)) return false

  const text = formatSlackText(event.text)
  if (!text) return false

  const task = await findTaskBySlackThread({
    channelId: event.channel,
    threadTs: getSlackThreadTs(event),
    slackUserId: event.user,
  })

  if (!task?.pageId) return false

  const syncId = getSlackEventSyncId(event)
  const claimed = await claimSync(syncId)
  if (!claimed) return false

  try {
    const authorName = await resolveSlackAuthorName(client, event.user)
    const comment = await createComment({
      pageId: task.pageId,
      authorName,
      text,
    })

    await checkpointComment(task.pageId, {
      id: comment?.id || syncId,
      createdTime: comment?.created_time || new Date().toISOString(),
    })

    console.log(`💬 Synced Slack thread comment ${event.channel}/${event.ts} to Notion page ${task.pageId}`)
    return true
  } catch (error) {
    await releaseSync(syncId)
    console.error(`Failed to sync Slack thread comment ${event.channel}/${event.ts} to Notion:`, error)
    await notifySyncFailure(client, event, error)
    return false
  }
}

export function registerThreadCommentSync(app) {
  app.event('message', async ({ event, client }) => {
    await handleSlackThreadCommentEvent({ event, client })
  })
}

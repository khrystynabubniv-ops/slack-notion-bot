import { Client } from '@notionhq/client'
import { getAllTasks, updateLastComment, updateStatus } from '../redis/store.js'
import { sendCommentUpdate, sendStatusUpdate } from '../slack/notify.js'
import { buildTaskPageUrl } from './pageUrl.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DATABASE_ID = process.env.NOTION_DATABASE_ID
let commentPollingEnabled = true

function extractAssignee(page) {
  const people = page.properties.Owner?.people || []
  const names = people
    .map((person) => person.name)
    .filter(Boolean)

  if (names.length) return names.join(', ')

  const slackPerson = page.properties['Slack Person']
  if (slackPerson?.title?.length) {
    return slackPerson.title.map((item) => item.plain_text).join('').trim()
  }

  if (slackPerson?.rich_text?.length) {
    return slackPerson.rich_text.map((item) => item.plain_text).join('').trim()
  }

  if (slackPerson?.select?.name) return slackPerson.select.name

  return null
}

async function getCurrentTaskSnapshots() {
  const tasks = {}

  let hasMore = true
  let startCursor

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      start_cursor: startCursor,
    })

    for (const page of response.results) {
      const status = page.properties.Status?.status?.name
      if (!status) continue

      tasks[page.id] = {
        status,
        assignee: extractAssignee(page),
        deadline: page.properties.Deadline?.date?.start || null,
      }
    }

    hasMore = response.has_more
    startCursor = response.next_cursor ?? undefined
  }

  return tasks
}

async function getLatestOpenComment(pageId) {
  if (!commentPollingEnabled) return null

  let hasMore = true
  let startCursor
  let latestComment = null

  try {
    while (hasMore) {
      const response = await notion.comments.list({
        block_id: pageId,
        start_cursor: startCursor,
        page_size: 100,
      })

      const currentLatest = response.results.at(-1)
      if (currentLatest) latestComment = currentLatest

      hasMore = response.has_more
      startCursor = response.next_cursor ?? undefined
    }
  } catch (error) {
    const restricted = error?.code === 'restricted_resource' || error?.status === 403
    if (restricted) {
      commentPollingEnabled = false
      console.warn(
        '⚠️ Comment polling disabled. Enable "Read comments" capability for the Notion integration.'
      )
      return null
    }

    throw error
  }

  if (!latestComment) return null

  return {
    id: latestComment.id,
    createdTime: latestComment.created_time,
    author: latestComment.created_by?.name || latestComment.created_by?.id || null,
    text: latestComment.rich_text
      ?.map((item) => item.plain_text || item.text?.content || '')
      .join('')
      .trim() || '',
  }
}

function isNewerComment(latestComment, task) {
  if (!task.lastCommentId && !task.lastCommentCreatedTime) return false
  if (latestComment.id === task.lastCommentId) return false
  if (!task.lastCommentCreatedTime) return true

  const latestTimestamp = Date.parse(latestComment.createdTime)
  const savedTimestamp = Date.parse(task.lastCommentCreatedTime)

  if (Number.isNaN(latestTimestamp) || Number.isNaN(savedTimestamp)) return true
  return latestTimestamp > savedTimestamp
}

function normalizePersonName(value) {
  return (value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function isOwnComment(latestComment, task) {
  if (!task.requesterName || !latestComment.author) return false
  return normalizePersonName(task.requesterName) === normalizePersonName(latestComment.author)
}

export async function startPolling(slackClient) {
  console.log('🔄 Polling started — every 3 minutes')

  setInterval(async () => {
    try {
      const trackedTasks = await getAllTasks()
      if (!trackedTasks.length) return

      const currentTasks = await getCurrentTaskSnapshots()

      for (const task of trackedTasks) {
        const currentTask = currentTasks[task.pageId]
        if (!currentTask?.status) continue
        const pageUrl = buildTaskPageUrl(task.pageId)

        if (task.lastStatus && currentTask.status !== task.lastStatus) {
          try {
            console.log(
              `📣 Sending status update for page ${task.pageId}: ${task.lastStatus} -> ${currentTask.status} (user ${task.slackUserId})`
            )

            await sendStatusUpdate({
              slackClient,
              slackUserId: task.slackUserId,
              taskName: task.taskName,
              oldStatus: task.lastStatus,
              newStatus: currentTask.status,
              assignee: currentTask.assignee,
              deadline: currentTask.deadline,
              pageUrl,
            })

            await updateStatus(task.pageId, currentTask.status)
            console.log(`✅ Status updated: ${task.taskName} → ${currentTask.status}`)
          } catch (error) {
            console.error(
              `❌ Failed to notify about status change for page ${task.pageId} (${task.taskName}) and user ${task.slackUserId}:`,
              error
            )
          }
        }

        try {
          const latestComment = await getLatestOpenComment(task.pageId)
          if (!latestComment) continue

          if (!task.lastCommentId && !task.lastCommentCreatedTime) {
            await updateLastComment(task.pageId, latestComment)
            continue
          }

          if (!isNewerComment(latestComment, task)) continue

          if (isOwnComment(latestComment, task)) {
            await updateLastComment(task.pageId, latestComment)
            continue
          }

          console.log(
            `💬 Sending comment update for page ${task.pageId}: ${latestComment.id} (user ${task.slackUserId})`
          )

          await sendCommentUpdate({
            slackClient,
            slackUserId: task.slackUserId,
            taskName: task.taskName,
            commentAuthor: latestComment.author,
            commentText: latestComment.text,
            pageUrl,
          })

          await updateLastComment(task.pageId, latestComment)
          console.log(`✅ Comment checkpoint updated: ${task.taskName} → ${latestComment.id}`)
        } catch (error) {
          console.error(
            `❌ Failed to notify about comments for page ${task.pageId} (${task.taskName}) and user ${task.slackUserId}:`,
            error
          )
        }
      }
    } catch (err) {
      console.error('Polling error:', err)
    }
  }, 3 * 60 * 1000)
}

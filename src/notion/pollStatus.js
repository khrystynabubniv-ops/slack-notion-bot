import { Client } from '@notionhq/client'
import { getAllTasks, updateLastComment, updateStatus } from '../redis/store.js'
import { sendCommentUpdate, sendStatusUpdate } from '../slack/notify.js'
import { buildTaskPageUrl } from './pageUrl.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DATABASE_ID = process.env.NOTION_DATABASE_ID
let commentPollingEnabled = true
const notionUserNameCache = new Map()

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

function extractUrlProperty(page, propertyName) {
  const property = page.properties[propertyName]
  if (!property) return null

  if (typeof property.url === 'string') {
    const url = property.url.trim()
    return url || null
  }

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
        finalProjectUrl: extractUrlProperty(page, 'Final project'),
      }
    }

    hasMore = response.has_more
    startCursor = response.next_cursor ?? undefined
  }

  return tasks
}

async function getOpenComments(pageId) {
  if (!commentPollingEnabled) return []

  let hasMore = true
  let startCursor
  const comments = []

  try {
    while (hasMore) {
      const response = await notion.comments.list({
        block_id: pageId,
        start_cursor: startCursor,
        page_size: 100,
      })

      comments.push(...response.results)

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
      return []
    }

    throw error
  }

  return Promise.all(comments.map(formatComment))
}

async function formatComment(comment) {
  const author = await resolveNotionUserName(comment.created_by)
  return {
    id: comment.id,
    createdTime: comment.created_time,
    author,
    text: comment.rich_text
      ?.map((item) => item.plain_text || item.text?.content || '')
      .join('')
      .trim() || '',
  }
}

async function resolveNotionUserName(createdBy) {
  if (!createdBy) return null
  if (createdBy.name) return createdBy.name

  const userId = createdBy.id
  if (!userId) return null

  if (notionUserNameCache.has(userId)) {
    return notionUserNameCache.get(userId)
  }

  try {
    const user = await notion.users.retrieve({ user_id: userId })
    const resolvedName = user?.name || user?.person?.email || userId
    notionUserNameCache.set(userId, resolvedName)
    return resolvedName
  } catch (error) {
    console.warn(`Failed to resolve Notion user name for ${userId}:`, error)
    notionUserNameCache.set(userId, userId)
    return userId
  }
}

function getNewComments(comments, task) {
  if (!comments.length) return []
  if (!task.lastCommentId && !task.lastCommentCreatedTime) return []

  if (task.lastCommentId) {
    const savedIndex = comments.findIndex((comment) => comment.id === task.lastCommentId)
    if (savedIndex >= 0) return comments.slice(savedIndex + 1)
  }

  if (!task.lastCommentCreatedTime) return comments

  const savedTimestamp = Date.parse(task.lastCommentCreatedTime)
  if (Number.isNaN(savedTimestamp)) return comments

  return comments.filter((comment) => {
    if (comment.id === task.lastCommentId) return false

    const commentTimestamp = Date.parse(comment.createdTime)
    if (Number.isNaN(commentTimestamp)) return true

    return commentTimestamp > savedTimestamp
  })
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

        if (!task.lastStatus) {
          await updateStatus(task.pageId, currentTask.status)
          console.log(`ℹ️ Status checkpoint initialized: ${task.taskName} → ${currentTask.status}`)
        } else if (currentTask.status !== task.lastStatus) {
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
              finalProjectUrl: currentTask.finalProjectUrl,
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
          const comments = await getOpenComments(task.pageId)
          if (!comments.length) continue

          if (!task.lastCommentId && !task.lastCommentCreatedTime) {
            const latestComment = comments.at(-1)
            await updateLastComment(task.pageId, latestComment)
            continue
          }

          const newComments = getNewComments(comments, task)
          if (!newComments.length) continue

          for (const comment of newComments) {
            if (isOwnComment(comment, task)) {
              await updateLastComment(task.pageId, comment)
              continue
            }

            console.log(
              `💬 Sending comment update for page ${task.pageId}: ${comment.id} (user ${task.slackUserId})`
            )

            await sendCommentUpdate({
              slackClient,
              slackUserId: task.slackUserId,
              taskName: task.taskName,
              commentAuthor: comment.author,
              commentText: comment.text,
              pageUrl,
            })

            await updateLastComment(task.pageId, comment)
            console.log(`✅ Comment checkpoint updated: ${task.taskName} → ${comment.id}`)
          }
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

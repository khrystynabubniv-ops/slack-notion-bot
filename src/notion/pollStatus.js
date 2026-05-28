import { Client } from '@notionhq/client'
import { deleteTask, getAllTasks, updateLastComment, updateStatus } from '../redis/store.js'
import { sendCommentUpdate, sendStatusUpdate } from '../slack/notify.js'
import { buildTaskPageUrl } from './pageUrl.js'
import { notionRequest } from './request.js'
import { getStatusPropertyNames } from './taskConfig.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DATABASE_ID = process.env.NOTION_DATABASE_ID
const POLLING_RATE_LIMIT_COOLDOWN_MS = Number.parseInt(
  process.env.NOTION_POLL_RATE_LIMIT_COOLDOWN_MS || `${10 * 60 * 1000}`,
  10
)
const COMPLETED_STATUS_NAMES = (
  process.env.NOTION_POLL_COMPLETED_STATUSES || 'Ready'
)
  .split(',')
  .map((status) => status.trim().toLowerCase())
  .filter(Boolean)
let commentPollingEnabled = true
let pollingInProgress = false
let pollingPausedUntil = 0
const notionUserNameCache = new Map()

function isRateLimited(error) {
  return error?.code === 'rate_limited' || error?.status === 429 || error?.statusCode === 429
}

function getHeader(headers, headerName) {
  if (!headers) return null
  if (typeof headers.get === 'function') return headers.get(headerName)

  const normalizedHeaderName = headerName.toLowerCase()
  return Object.entries(headers)
    .find(([key]) => key.toLowerCase() === normalizedHeaderName)
    ?.[1]
}

function getPollingCooldownMs(error) {
  const retryAfter = getHeader(error?.headers, 'retry-after')
  const retryAfterSeconds = Number.parseFloat(Array.isArray(retryAfter) ? retryAfter[0] : retryAfter)
  const configuredCooldown =
    Number.isFinite(POLLING_RATE_LIMIT_COOLDOWN_MS) && POLLING_RATE_LIMIT_COOLDOWN_MS > 0
      ? POLLING_RATE_LIMIT_COOLDOWN_MS
      : 10 * 60 * 1000

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.max(Math.ceil(retryAfterSeconds * 1000), configuredCooldown)
  }

  return configuredCooldown
}

function pausePollingAfterRateLimit(error, context) {
  const cooldownMs = getPollingCooldownMs(error)
  pollingPausedUntil = Date.now() + cooldownMs
  console.warn(
    `Notion polling paused for ${cooldownMs}ms after rate limit during ${context}.`
  )
}

function isCompletedStatus(status) {
  return status && COMPLETED_STATUS_NAMES.includes(status.toLowerCase())
}

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

function extractStatus(page) {
  for (const propertyName of getStatusPropertyNames()) {
    const status = page.properties[propertyName]?.status?.name
    if (status) return status
  }

  return null
}

async function getCurrentTaskSnapshots() {
  const tasks = {}

  let hasMore = true
  let startCursor

  while (hasMore) {
    const response = await notionRequest(
      () => notion.databases.query({
        database_id: DATABASE_ID,
        start_cursor: startCursor,
      }),
      'database query'
    )

    for (const page of response.results) {
      const status = extractStatus(page)
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
      const response = await notionRequest(
        () => notion.comments.list({
          block_id: pageId,
          start_cursor: startCursor,
          page_size: 100,
        }),
        'comments list'
      )

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
    const user = await notionRequest(
      () => notion.users.retrieve({ user_id: userId }),
      'user retrieve'
    )
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
    if (pollingInProgress) {
      console.warn('Notion polling skipped because the previous cycle is still running.')
      return
    }

    if (Date.now() < pollingPausedUntil) {
      console.log(`Notion polling paused until ${new Date(pollingPausedUntil).toISOString()}`)
      return
    }

    pollingInProgress = true

    try {
      const trackedTasks = await getAllTasks()
      if (!trackedTasks.length) return

      const activeTrackedTasks = []
      for (const task of trackedTasks) {
        if (isCompletedStatus(task.lastStatus)) {
          await deleteTask(task.pageId)
          console.log(`🧹 Stopped polling completed task: ${task.taskName} → ${task.lastStatus}`)
        } else {
          activeTrackedTasks.push(task)
        }
      }

      if (!activeTrackedTasks.length) return

      const currentTasks = await getCurrentTaskSnapshots()

      for (const task of activeTrackedTasks) {
        const currentTask = currentTasks[task.pageId]
        if (!currentTask?.status) continue
        const pageUrl = buildTaskPageUrl(task.pageId)
        const completed = isCompletedStatus(currentTask.status)

        if (!task.lastStatus) {
          if (completed) {
            await deleteTask(task.pageId)
            console.log(`🧹 Completed task removed from polling: ${task.taskName} → ${currentTask.status}`)
            continue
          } else {
            await updateStatus(task.pageId, currentTask.status)
            console.log(`ℹ️ Status checkpoint initialized: ${task.taskName} → ${currentTask.status}`)
          }
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

            if (completed) {
              await deleteTask(task.pageId)
              console.log(`🧹 Completed task removed from polling: ${task.taskName} → ${currentTask.status}`)
              continue
            } else {
              await updateStatus(task.pageId, currentTask.status)
              console.log(`✅ Status updated: ${task.taskName} → ${currentTask.status}`)
            }
          } catch (error) {
            console.error(
              `❌ Failed to notify about status change for page ${task.pageId} (${task.taskName}) and user ${task.slackUserId}:`,
              error
            )

            if (completed) {
              await deleteTask(task.pageId)
              console.log(
                `🧹 Completed task removed from polling after notification failure: ${task.taskName} → ${currentTask.status}`
              )
              continue
            }
          }
        }

        if (completed) {
          await deleteTask(task.pageId)
          console.log(`🧹 Completed task removed from polling: ${task.taskName} → ${currentTask.status}`)
          continue
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
          if (isRateLimited(error)) {
            pausePollingAfterRateLimit(error, 'comments list')
            break
          }

          console.error(
            `❌ Failed to notify about comments for page ${task.pageId} (${task.taskName}) and user ${task.slackUserId}:`,
            error
          )
        }
      }
    } catch (err) {
      if (isRateLimited(err)) {
        pausePollingAfterRateLimit(err, 'polling cycle')
      }

      console.error('Polling error:', err)
    } finally {
      pollingInProgress = false
    }
  }, 3 * 60 * 1000)
}

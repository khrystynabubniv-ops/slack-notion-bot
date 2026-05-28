import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

const SAVE_TASK_RETRY_DELAYS_MS = [300, 1000]
const DEFAULT_FAILED_SUBMISSION_TTL_SECONDS = 60 * 60 * 24 * 30
const TASK_SUBMISSION_QUEUE_KEY = 'task-submission-queue'
const TASK_SUBMISSION_QUEUE_ITEM_PREFIX = 'task-submission-queue-item:'
const FAILED_SUBMISSION_TTL_SECONDS = Number.parseInt(
  process.env.FAILED_SUBMISSION_TTL_SECONDS || `${DEFAULT_FAILED_SUBMISSION_TTL_SECONDS}`,
  10
)

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function saveWithRetry(key, value, options) {
  let lastError

  for (let attempt = 0; attempt <= SAVE_TASK_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return options ? await redis.set(key, value, options) : await redis.set(key, value)
    } catch (error) {
      lastError = error
      const retryDelay = SAVE_TASK_RETRY_DELAYS_MS[attempt]

      if (retryDelay === undefined) break

      console.warn(`Redis save failed for ${key}, retrying in ${retryDelay}ms:`, error)
      await wait(retryDelay)
    }
  }

  throw lastError
}

function getFailedSubmissionTtlOptions() {
  if (Number.isFinite(FAILED_SUBMISSION_TTL_SECONDS) && FAILED_SUBMISSION_TTL_SECONDS > 0) {
    return { ex: FAILED_SUBMISSION_TTL_SECONDS }
  }

  return undefined
}

function parseStoredTask(data) {
  if (!data) return null
  if (typeof data === 'string') return JSON.parse(data)
  if (typeof data === 'object') return data
  return null
}

export async function saveTask({ pageId, slackUserId, slackChannelId, taskName, requesterName }) {
  await saveWithRetry(`notion:${pageId}`, JSON.stringify({
    slackUserId,
    slackChannelId,
    taskName,
    requesterName: requesterName || null,
    lastStatus: 'To do',
    lastCommentId: null,
    lastCommentCreatedTime: null,
  }))
}

export async function saveFailedSubmission(payload) {
  const createdAt = new Date().toISOString()
  const draftId = `failed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const key = `failed-submission:${draftId}`

  await saveWithRetry(
    key,
    JSON.stringify({
      id: draftId,
      createdAt,
      ...payload,
    }),
    getFailedSubmissionTtlOptions()
  )

  return { draftId, key, createdAt }
}

export async function enqueueTaskSubmission(payload, { delayMs = 0, queueId } = {}) {
  const now = Date.now()
  const id = queueId || `queued-${now}-${Math.random().toString(36).slice(2, 8)}`
  const key = `${TASK_SUBMISSION_QUEUE_ITEM_PREFIX}${id}`
  const createdAt = payload.createdAt || new Date(now).toISOString()
  const nextAttemptAt = new Date(now + delayMs).toISOString()
  const item = {
    id,
    createdAt,
    nextAttemptAt,
    attempts: payload.attempts || 0,
    payload,
  }

  await saveWithRetry(
    key,
    JSON.stringify(item),
    getFailedSubmissionTtlOptions()
  )
  await redis.zadd(TASK_SUBMISSION_QUEUE_KEY, { score: now + delayMs, member: id })

  return { queueId: id, key, createdAt, nextAttemptAt }
}

export async function getDueTaskSubmission(now = Date.now()) {
  const queueIds = await redis.zrange(TASK_SUBMISSION_QUEUE_KEY, 0, now, {
    byScore: true,
    offset: 0,
    count: 1,
  })
  const queueId = queueIds?.[0]

  if (!queueId) return null

  const removed = await redis.zrem(TASK_SUBMISSION_QUEUE_KEY, queueId)
  if (!removed) return null

  const key = `${TASK_SUBMISSION_QUEUE_ITEM_PREFIX}${queueId}`
  const data = await redis.get(key)
  const parsed = parseStoredTask(data)

  if (!parsed) return null

  return { ...parsed, key }
}

export async function requeueTaskSubmission(item, { delayMs, error }) {
  const attempts = (item.attempts || 0) + 1
  const now = Date.now()
  const nextAttemptAt = new Date(now + delayMs).toISOString()
  const updatedItem = {
    ...item,
    attempts,
    nextAttemptAt,
    lastError: error || null,
    payload: {
      ...item.payload,
      attempts,
    },
  }

  await saveWithRetry(
    item.key,
    JSON.stringify(updatedItem),
    getFailedSubmissionTtlOptions()
  )
  await redis.zadd(TASK_SUBMISSION_QUEUE_KEY, { score: now + delayMs, member: item.id })

  return updatedItem
}

export async function completeTaskSubmission(queueId) {
  await redis.del(`${TASK_SUBMISSION_QUEUE_ITEM_PREFIX}${queueId}`)
  await redis.zrem(TASK_SUBMISSION_QUEUE_KEY, queueId)
}

export async function getTask(pageId) {
  const data = await redis.get(`notion:${pageId}`)
  return parseStoredTask(data)
}

export async function updateStatus(pageId, newStatus) {
  const data = await redis.get(`notion:${pageId}`)
  if (!data) return
  const parsed = parseStoredTask(data)
  if (!parsed) return

  await redis.set(`notion:${pageId}`, JSON.stringify({
    ...parsed,
    lastStatus: newStatus,
  }))
}

export async function deleteTask(pageId) {
  await redis.del(`notion:${pageId}`)
}

export async function updateLastComment(pageId, { id, createdTime, commentId }) {
  const data = await redis.get(`notion:${pageId}`)
  if (!data) return
  const parsed = parseStoredTask(data)
  if (!parsed) return

  await redis.set(`notion:${pageId}`, JSON.stringify({
    ...parsed,
    lastCommentId: commentId || id || null,
    lastCommentCreatedTime: createdTime || null,
  }))
}

export async function getAllTasks() {
  const keys = await redis.keys('notion:*')
  if (!keys.length) return []
  const tasks = await Promise.all(
    keys.map(async (key) => {
      const data = await redis.get(key)
      const pageId = key.replace('notion:', '')
      const parsed = parseStoredTask(data)
      return parsed ? { pageId, ...parsed } : null
    })
  )

  return tasks.filter(Boolean)
}

export async function saveLaunchContext({ parentTaskId, parentPageName, payload }) {
  if (!parentTaskId) {
    throw new Error('parentTaskId is required')
  }

  await redis.set(
    `notion-launch:${parentTaskId}`,
    JSON.stringify({
      parentTaskId,
      parentPageName: parentPageName || null,
      payload: payload || null,
      createdAt: new Date().toISOString(),
    })
  )
}

export async function getLaunchContext(parentTaskId) {
  const data = await redis.get(`notion-launch:${parentTaskId}`)
  return parseStoredTask(data)
}

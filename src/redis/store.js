import { Redis } from '@upstash/redis'
import { DEFAULT_DEPARTMENT_KEY, resolveDepartmentKey } from '../config/departments.js'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

const SAVE_TASK_RETRY_DELAYS_MS = [300, 1000]
const DEFAULT_FAILED_SUBMISSION_TTL_SECONDS = 60 * 60 * 24 * 30
const REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX?.trim() || ''
const TASK_SUBMISSION_QUEUE_KEY = redisKey('task-submission-queue')
const TASK_SUBMISSION_QUEUE_ITEM_PREFIX = redisKey('task-submission-queue-item:')
const FEEDBACK_KEY_PREFIX = redisKey('feedback:')
const SLACK_THREAD_COMMENT_SYNC_PREFIX = redisKey('slack-thread-comment-sync:')
const SLACK_THREAD_COMMENT_SYNC_TTL_SECONDS = 60 * 60 * 24 * 7
const FAILED_SUBMISSION_TTL_SECONDS = Number.parseInt(
  process.env.FAILED_SUBMISSION_TTL_SECONDS || `${DEFAULT_FAILED_SUBMISSION_TTL_SECONDS}`,
  10
)

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function redisKey(key) {
  return `${REDIS_KEY_PREFIX}${key}`
}

function stripRedisKeyPrefix(key) {
  if (!REDIS_KEY_PREFIX) return key
  return key.startsWith(REDIS_KEY_PREFIX) ? key.slice(REDIS_KEY_PREFIX.length) : key
}

function taskKey(pageId) {
  return redisKey(`notion:${pageId}`)
}

function launchKey(parentTaskId) {
  return redisKey(`notion-launch:${parentTaskId}`)
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

export async function saveTask({
  pageId,
  departmentKey = DEFAULT_DEPARTMENT_KEY,
  slackUserId,
  slackChannelId,
  slackMessageTs,
  slackThreadTs,
  taskName,
  requesterName,
  taskKind = 'task',
  parentPageId = null,
  pageUrl = null,
  team = null,
  hub = null,
  requestType = null,
  lastStatus = 'To do',
  lastAssignee = null,
  lastDesignerName = null,
  lastDesignerUserId = null,
  lastDeadline = null,
  lastFinalProjectUrl = null,
  snapshotInitialized = false,
}) {
  const trackedAt = new Date().toISOString()

  await saveWithRetry(taskKey(pageId), JSON.stringify({
    departmentKey: resolveDepartmentKey(departmentKey),
    slackUserId,
    slackChannelId,
    slackMessageTs: slackMessageTs || null,
    slackThreadTs: slackThreadTs || slackMessageTs || null,
    taskName,
    requesterName: requesterName || null,
    taskKind,
    parentPageId,
    pageUrl,
    team,
    hub,
    requestType,
    lastStatus,
    lastAssignee,
    lastDesignerName,
    lastDesignerUserId,
    lastDeadline,
    lastFinalProjectUrl,
    snapshotInitialized,
    trackedAt,
    lastCommentId: null,
    lastCommentCreatedTime: trackedAt,
    roundsCount: 0,
  }))
}

export async function saveFailedSubmission(payload) {
  const createdAt = new Date().toISOString()
  const draftId = `failed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const key = redisKey(`failed-submission:${draftId}`)

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

export async function recoverOrphanedTaskSubmissions({ excludeIds = [] } = {}) {
  const keys = await redis.keys(`${TASK_SUBMISSION_QUEUE_ITEM_PREFIX}*`)
  if (!keys.length) return 0

  const excluded = new Set(excludeIds)
  let recoveredCount = 0

  for (const key of keys) {
    const queueId = key.replace(TASK_SUBMISSION_QUEUE_ITEM_PREFIX, '')
    if (!queueId || excluded.has(queueId)) continue

    const score = await redis.zscore(TASK_SUBMISSION_QUEUE_KEY, queueId)
    if (score !== null && score !== undefined) continue

    const item = parseStoredTask(await redis.get(key))
    if (!item) continue

    const nextAttemptTime = Date.parse(item.nextAttemptAt)
    const scoreTime = Number.isFinite(nextAttemptTime) ? nextAttemptTime : Date.now()

    await redis.zadd(TASK_SUBMISSION_QUEUE_KEY, {
      score: Math.min(scoreTime, Date.now()),
      member: queueId,
    })
    recoveredCount += 1
  }

  return recoveredCount
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
  const task = parseStoredTask(await redis.get(taskKey(pageId)))
  return task ? { ...task, departmentKey: resolveDepartmentKey(task.departmentKey) } : null
}

export async function updateStatus(pageId, newStatus) {
  const data = await redis.get(taskKey(pageId))
  if (!data) return
  const parsed = parseStoredTask(data)
  if (!parsed) return

  await redis.set(taskKey(pageId), JSON.stringify({
    ...parsed,
    departmentKey: resolveDepartmentKey(parsed.departmentKey),
    lastStatus: newStatus,
  }))
}

export async function updateTaskSnapshot(pageId, snapshot) {
  const data = await redis.get(taskKey(pageId))
  if (!data) return
  const parsed = parseStoredTask(data)
  if (!parsed) return

  await redis.set(taskKey(pageId), JSON.stringify({
    ...parsed,
    departmentKey: resolveDepartmentKey(parsed.departmentKey),
    ...snapshot,
  }))
}

export async function deleteTask(pageId) {
  await redis.del(taskKey(pageId))
}

export async function markFeedbackSurveySent({
  pageId,
  slackUserId,
  departmentKey,
  taskName,
  requesterName,
  requestUrl,
  team,
  hub,
  requestType,
  completedAt,
}) {
  const key = `${FEEDBACK_KEY_PREFIX}${pageId}`
  const existing = parseStoredTask(await redis.get(key)) || {}

  if (existing.feedbackSurveySentAt) {
    return { alreadySent: true, record: existing }
  }

  const feedbackSurveySentAt = new Date().toISOString()
  const record = {
    ...existing,
    pageId,
    departmentKey: resolveDepartmentKey(departmentKey || existing.departmentKey),
    slackUserId: slackUserId || existing.slackUserId || null,
    taskName: taskName || existing.taskName || null,
    requesterName: requesterName || existing.requesterName || null,
    requestUrl: requestUrl || existing.requestUrl || null,
    team: team || existing.team || null,
    hub: hub || existing.hub || null,
    requestType: requestType || existing.requestType || null,
    completedAt: completedAt || existing.completedAt || null,
    feedbackSurveySentAt,
  }

  await redis.set(key, JSON.stringify(record))

  const taskData = await redis.get(taskKey(pageId))
  const task = parseStoredTask(taskData)
  if (task) {
    await redis.set(taskKey(pageId), JSON.stringify({
      ...task,
      departmentKey: resolveDepartmentKey(task.departmentKey),
      feedbackSurveySentAt,
    }))
  }

  return { alreadySent: false, record }
}

export async function getQualityFeedback(pageId) {
  const data = await redis.get(`${FEEDBACK_KEY_PREFIX}${pageId}`)
  return parseStoredTask(data)
}

export async function saveQualityFeedback({
  pageId,
  rating,
  comment,
  categories,
  slackUserId,
  departmentKey,
  taskName,
  requesterName,
  requestUrl,
  team,
  hub,
  requestType,
  completedAt,
}) {
  const key = `${FEEDBACK_KEY_PREFIX}${pageId}`
  const existing = parseStoredTask(await redis.get(key)) || {}
  const submittedAt = new Date().toISOString()
  const record = {
    ...existing,
    pageId,
    departmentKey: resolveDepartmentKey(departmentKey || existing.departmentKey),
    slackUserId: slackUserId || existing.slackUserId || null,
    taskName: taskName || existing.taskName || null,
    requesterName: requesterName || existing.requesterName || null,
    requestUrl: requestUrl || existing.requestUrl || null,
    team: team || existing.team || null,
    hub: hub || existing.hub || null,
    requestType: requestType || existing.requestType || null,
    completedAt: completedAt || existing.completedAt || null,
    rating,
    comment: comment || null,
    categories: Array.isArray(categories) ? categories : [],
    feedbackSubmittedAt: submittedAt,
  }

  await redis.set(key, JSON.stringify(record))

  const taskData = await redis.get(taskKey(pageId))
  const task = parseStoredTask(taskData)
  if (task) {
    await redis.set(taskKey(pageId), JSON.stringify({
      ...task,
      departmentKey: resolveDepartmentKey(task.departmentKey),
      feedbackRating: rating,
      feedbackSubmittedAt: submittedAt,
    }))
  }

  return record
}

export async function updateLastComment(pageId, { id, createdTime, commentId }) {
  const data = await redis.get(taskKey(pageId))
  if (!data) return
  const parsed = parseStoredTask(data)
  if (!parsed) return

  await redis.set(taskKey(pageId), JSON.stringify({
    ...parsed,
    departmentKey: resolveDepartmentKey(parsed.departmentKey),
    lastCommentId: commentId || id || null,
    lastCommentCreatedTime: createdTime || null,
  }))
}

function normalizeThreadValue(value) {
  return String(value || '').trim()
}

function isSameThread(task, { channelId, threadTs, slackUserId }) {
  const normalizedThreadTs = normalizeThreadValue(threadTs)
  if (!normalizedThreadTs) return false

  const taskThreadTs = normalizeThreadValue(task.slackThreadTs || task.slackMessageTs)
  if (taskThreadTs !== normalizedThreadTs) return false

  const taskChannelId = normalizeThreadValue(task.slackChannelId)
  const normalizedChannelId = normalizeThreadValue(channelId)
  const normalizedSlackUserId = normalizeThreadValue(slackUserId)

  return Boolean(
    taskChannelId &&
      (taskChannelId === normalizedChannelId || taskChannelId === normalizedSlackUserId)
  )
}

export async function getTaskBySlackThread({ channelId, threadTs, slackUserId }) {
  const tasks = await getAllTasks()
  const matches = tasks.filter((task) => isSameThread(task, { channelId, threadTs, slackUserId }))
  if (!matches.length) return null

  const normalizedThreadTs = normalizeThreadValue(threadTs)
  const rootTask = matches.find((task) => normalizeThreadValue(task.slackMessageTs) === normalizedThreadTs)

  return rootTask || matches[0]
}

export async function claimSlackThreadCommentSync(syncId) {
  const normalizedSyncId = normalizeThreadValue(syncId)
  if (!normalizedSyncId) return false

  const result = await redis.set(
    `${SLACK_THREAD_COMMENT_SYNC_PREFIX}${normalizedSyncId}`,
    new Date().toISOString(),
    {
      nx: true,
      ex: SLACK_THREAD_COMMENT_SYNC_TTL_SECONDS,
    }
  )

  return Boolean(result)
}

export async function releaseSlackThreadCommentSync(syncId) {
  const normalizedSyncId = normalizeThreadValue(syncId)
  if (!normalizedSyncId) return

  await redis.del(`${SLACK_THREAD_COMMENT_SYNC_PREFIX}${normalizedSyncId}`)
}

export async function incrementRoundsCount(pageId) {
  const data = await redis.get(taskKey(pageId))
  if (!data) return 0
  const parsed = parseStoredTask(data)
  if (!parsed) return 0

  const newCount = (parsed.roundsCount || 0) + 1
  await redis.set(taskKey(pageId), JSON.stringify({
    ...parsed,
    departmentKey: resolveDepartmentKey(parsed.departmentKey),
    roundsCount: newCount,
  }))
  return newCount
}

export async function getRoundsCount(pageId) {
  const data = await redis.get(taskKey(pageId))
  if (!data) return 0
  const parsed = parseStoredTask(data)
  return parsed?.roundsCount || 0
}

export async function getAllTasks() {
  const keys = await redis.keys(redisKey('notion:*'))
  if (!keys.length) return []
  const tasks = await Promise.all(
    keys.map(async (key) => {
      const data = await redis.get(key)
      const pageId = stripRedisKeyPrefix(key).replace('notion:', '')
      const parsed = parseStoredTask(data)
      return parsed ? { pageId, ...parsed, departmentKey: resolveDepartmentKey(parsed.departmentKey) } : null
    })
  )

  return tasks.filter(Boolean)
}

export async function saveLaunchContext({ parentTaskId, parentPageName, payload }) {
  if (!parentTaskId) {
    throw new Error('parentTaskId is required')
  }

  await redis.set(
    launchKey(parentTaskId),
    JSON.stringify({
      parentTaskId,
      parentPageName: parentPageName || null,
      payload: payload || null,
      createdAt: new Date().toISOString(),
    })
  )
}

export async function getLaunchContext(parentTaskId) {
  const data = await redis.get(launchKey(parentTaskId))
  return parseStoredTask(data)
}

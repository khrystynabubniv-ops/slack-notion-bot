import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

const SAVE_TASK_RETRY_DELAYS_MS = [300, 1000]

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function saveWithRetry(key, value) {
  let lastError

  for (let attempt = 0; attempt <= SAVE_TASK_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await redis.set(key, value)
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

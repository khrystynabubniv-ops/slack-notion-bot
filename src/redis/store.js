import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

function parseStoredTask(data) {
  if (!data) return null
  if (typeof data === 'string') return JSON.parse(data)
  if (typeof data === 'object') return data
  return null
}

export async function saveTask({ pageId, slackUserId, slackChannelId, taskName }) {
  await redis.set(`notion:${pageId}`, JSON.stringify({
    slackUserId,
    slackChannelId,
    taskName,
    lastStatus: 'To do',
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

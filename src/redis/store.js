import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

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
  return data ? JSON.parse(data) : null
}

export async function updateStatus(pageId, newStatus) {
  const data = await redis.get(`notion:${pageId}`)
  if (!data) return
  const parsed = JSON.parse(data)
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
      return { pageId, ...JSON.parse(data) }
    })
  )
  return tasks
}
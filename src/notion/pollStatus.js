import { Client } from '@notionhq/client'
import { getAllTasks, updateStatus } from '../redis/store.js'
import { sendStatusUpdate } from '../slack/notify.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DATABASE_ID = process.env.NOTION_DATABASE_ID

async function getCurrentStatuses() {
  const statuses = {}

  let hasMore = true
  let startCursor

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      start_cursor: startCursor,
    })

    for (const page of response.results) {
      const status = page.properties.Status?.status?.name
      if (status) statuses[page.id] = status
    }

    hasMore = response.has_more
    startCursor = response.next_cursor ?? undefined
  }

  return statuses
}

export async function startPolling(slackClient) {
  console.log('🔄 Polling started — every 3 minutes')

  setInterval(async () => {
    try {
      const trackedTasks = await getAllTasks()
      if (!trackedTasks.length) return

      const currentStatuses = await getCurrentStatuses()

      for (const task of trackedTasks) {
        const current = currentStatuses[task.pageId]
        if (!current) continue
        if (!task.lastStatus) continue
        if (current === task.lastStatus) continue

        await sendStatusUpdate({
          slackClient,
          slackUserId: task.slackUserId,
          taskName: task.taskName,
          oldStatus: task.lastStatus,
          newStatus: current,
          pageUrl: `https://notion.so/${task.pageId.replace(/-/g, '')}`,
        })

        await updateStatus(task.pageId, current)
        console.log(`✅ Status updated: ${task.taskName} → ${current}`)
      }
    } catch (err) {
      console.error('Polling error:', err)
    }
  }, 3 * 60 * 1000)
}

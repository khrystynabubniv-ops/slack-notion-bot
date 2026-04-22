import { Client } from '@notionhq/client'
import { getAllTasks, updateStatus } from '../redis/store.js'
import { sendStatusUpdate } from '../slack/notify.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DATABASE_ID = process.env.NOTION_DATABASE_ID

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
        if (!task.lastStatus) continue
        if (currentTask.status === task.lastStatus) continue

        await sendStatusUpdate({
          slackClient,
          slackUserId: task.slackUserId,
          taskName: task.taskName,
          oldStatus: task.lastStatus,
          newStatus: currentTask.status,
          assignee: currentTask.assignee,
          deadline: currentTask.deadline,
          pageUrl: `https://notion.so/${task.pageId.replace(/-/g, '')}`,
        })

        await updateStatus(task.pageId, currentTask.status)
        console.log(`✅ Status updated: ${task.taskName} → ${currentTask.status}`)
      }
    } catch (err) {
      console.error('Polling error:', err)
    }
  }, 3 * 60 * 1000)
}

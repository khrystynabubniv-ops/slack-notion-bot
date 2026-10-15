import { getDepartment } from '../config/departments.js'
import { ACTION_IDS } from '../config/interactionIds.js'
import {
  claimFailedSubmissionRestore,
  enqueueTaskSubmission,
  getFailedSubmission,
  markFailedSubmissionRestored,
} from '../redis/store.js'

// Slack ID адмінів (через кому), яким бот пише в особисті, коли задача не
// створилась і бриф збережено як чернетку. Кнопка «Відновити» в цьому
// повідомленні ставить бриф назад у чергу — без ручної роботи з Redis.
const ADMIN_SLACK_IDS = (process.env.FAILED_SUBMISSION_ADMIN_SLACK_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)

export function hasFailedSubmissionAdmins() {
  return ADMIN_SLACK_IDS.length > 0
}

function buildAdminMessageBlocks(draft, { statusText = null } = {}) {
  const task = draft.task || {}
  const department = task.departmentKey ? getDepartment(task.departmentKey) : null
  const errorMessage = draft.error?.message || 'невідома помилка'

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `❌ *Задача не створилась у Notion* — бриф збережено як чернетку.`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Від:*\n<@${draft.slackUserId}>` },
        { type: 'mrkdwn', text: `*Задача:*\n${task.name || '—'}` },
        { type: 'mrkdwn', text: `*Команда / тип:*\n${department?.label || task.departmentKey || '—'} · ${task.taskTypeLabel || task.taskType || '—'}` },
        { type: 'mrkdwn', text: `*Код чернетки:*\n\`${draft.id}\`` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Помилка:*\n\`\`\`${errorMessage.slice(0, 2500)}\`\`\`` },
    },
  ]

  if (statusText) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: statusText }] })
  } else {
    blocks.push(
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: 'Якщо помилка в коді чи в налаштуваннях Notion — спершу виправ причину, інакше задача впаде знову.',
        }],
      },
      {
        type: 'actions',
        elements: [{
          type: 'button',
          text: { type: 'plain_text', text: '🔁 Відновити задачу' },
          style: 'primary',
          action_id: ACTION_IDS.restoreFailedSubmission,
          value: draft.id,
        }],
      }
    )
  }

  return blocks
}

export async function notifyAdminsAboutFailedSubmission(client, draft) {
  for (const adminId of ADMIN_SLACK_IDS) {
    try {
      await client.chat.postMessage({
        channel: adminId,
        text: `❌ Задача «${draft.task?.name || draft.id}» не створилась у Notion — чернетка ${draft.id}`,
        blocks: buildAdminMessageBlocks(draft),
      })
    } catch (error) {
      console.error(`Failed to notify admin ${adminId} about failed submission ${draft.id}:`, error)
    }
  }
}

// Чернетки до появи `submissionPayload` зберігали лише людиночитні поля —
// збираємо з них payload черги. Domain у них не зберігався, тож він
// загубиться; масиви/об'єкти обов'язково [] / {}, а не null (createNotionPage
// має дефолти лише для undefined — null.length валить створення).
function buildLegacySubmissionPayload(draft) {
  const task = draft.task || {}
  const answers = draft.answers || {}

  return {
    departmentKey: task.departmentKey,
    userId: draft.slackUserId,
    userName: draft.slackUserName,
    slackPersonName: draft.requesterName || draft.slackUserName,
    taskType: task.taskType,
    taskTypeLabel: task.taskTypeLabel,
    name: task.name,
    priority: task.priority,
    deadline: task.deadline,
    context: answers.context,
    style: answers.style,
    antiref: answers.antiref,
    canEditText: answers.canEditText,
    videoFormat: task.videoFormat,
    platform: task.platform,
    platforms: task.platform ? [task.platform] : [],
    platformOther: task.platformOther,
    specificFields: answers.specificFields || {},
    fieldAnswers: answers.fieldAnswers || [],
    artifacts: answers.artifacts || {},
    isLate: Boolean(task.isLate),
    leadTimeWarning: null,
    domain: null,
    values: draft.rawSlackValues || {},
  }
}

async function updateAdminMessage(client, body, draft, statusText) {
  try {
    await client.chat.update({
      channel: body.channel?.id || body.container?.channel_id,
      ts: body.message?.ts || body.container?.message_ts,
      text: statusText,
      blocks: buildAdminMessageBlocks(draft, { statusText }),
    })
  } catch (error) {
    console.error(`Failed to update admin message for failed submission ${draft.id}:`, error)
  }
}

async function handleRestoreClick({ body, client }) {
  const draftId = body.actions?.[0]?.value
  const adminId = body.user?.id

  if (!ADMIN_SLACK_IDS.includes(adminId)) {
    console.warn(`Ignoring failed-submission restore from non-admin ${adminId} (${draftId}).`)
    return
  }

  const draft = draftId ? await getFailedSubmission(draftId) : null
  if (!draft) {
    await updateAdminMessage(client, body, { id: draftId }, '⚠️ Чернетку не знайдено — можливо, минуло 30 днів і вона видалилась.')
    return
  }

  if (draft.restoredAt || !(await claimFailedSubmissionRestore(draftId))) {
    await updateAdminMessage(client, body, draft, `ℹ️ Цю чернетку вже відновлювали${draft.restoredAt ? ` (${draft.restoredAt})` : ''}.`)
    return
  }

  const payload = draft.submissionPayload || buildLegacySubmissionPayload(draft)
  const { queueId } = await enqueueTaskSubmission(payload)
  await markFailedSubmissionRestored(draft, { restoredBy: adminId, restoredQueueId: queueId })

  console.log(`Failed submission ${draftId} re-queued by ${adminId} as ${queueId}.`)
  await updateAdminMessage(
    client,
    body,
    draft,
    `⏳ Задачу поставлено назад у чергу (<@${adminId}>). Автор отримає звичайне повідомлення, щойно задача створиться; якщо знову впаде — прийде нове сповіщення сюди.`
  )
}

export function registerFailedSubmissionRestoreHandler(app) {
  app.action(ACTION_IDS.restoreFailedSubmission, async ({ ack, body, client }) => {
    await ack()

    try {
      await handleRestoreClick({ body, client })
    } catch (error) {
      console.error('Failed to restore failed submission:', error)
    }
  })
}

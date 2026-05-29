import { createFeedbackSubitem } from '../notion/createSubitem.js'
import { getRoundsCount, getTask, incrementRoundsCount, saveTask } from '../redis/store.js'

const DEFAULT_OPS_LEAD_SLACK_ID = 'U0APPD32H6D'

function parsePrivateMetadata(privateMetadata) {
  if (!privateMetadata) return {}

  try {
    return JSON.parse(privateMetadata)
  } catch {
    return {}
  }
}

function normalizeRoundNumber(roundNumber) {
  const parsed = Number.parseInt(roundNumber, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function normalizeMaxRounds(maxRounds) {
  if (maxRounds === null || maxRounds === undefined) return null

  const parsed = Number.parseInt(maxRounds, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function getOpsLeadMention() {
  const slackId = process.env.OPS_LEAD_SLACK_ID?.trim() || DEFAULT_OPS_LEAD_SLACK_ID
  if (/^[UW][A-Z0-9]+$/.test(slackId || '')) return `<@${slackId}>`

  return 'ops-lead'
}

function getFeedbackText(view) {
  return view.state.values.feedback_text?.feedback_input?.value?.trim() || ''
}

async function notifyUser(client, userId, text) {
  if (!userId) return

  await client.chat.postMessage({
    channel: userId,
    text,
  })
}

function buildFeedbackThreadText({
  taskName,
  status = 'To do',
  responsible = 'дизайнер',
}) {
  return [
    'Готово, твоя правка вже в дизайн-команді ✨',
    `*${taskName}*`,
    '',
    `🟢 *Статус:* ${status}`,
    `🧭 *Відповідальний:* ${responsible}`,
    '',
    '💬 Цей тред — робоче місце правки. Пиши сюди все, що допоможе рухатись далі: контекст, апдейти, посилання, файли. Оновлення з Notion також прийдуть сюди.',
  ].join('\n')
}

async function postFeedbackTaskCreatedMessage({ client, userId, taskName, pageUrl }) {
  const text = buildFeedbackThreadText({ taskName })

  return await client.chat.postMessage({
    channel: userId,
    text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '📋 Відкрити в Notion / додати файли' },
            url: pageUrl,
            style: 'primary',
          },
        ],
      },
    ],
  })
}

export async function handleFeedbackSubmission({ body, view, client }) {
  const metadata = parsePrivateMetadata(view.private_metadata)
  const pageId = metadata.pageId
  const taskName = metadata.taskName || 'Без назви'
  const maxRounds = normalizeMaxRounds(metadata.maxRounds)
  const userId = body.user?.id
  const feedbackText = getFeedbackText(view)

  if (!pageId) {
    console.error('Feedback submission is missing pageId metadata.')
    await notifyUser(
      client,
      userId,
      '❌ Не вдалося визначити задачу для правок. Спробуй відкрити форму ще раз.'
    )
    return
  }

  try {
    const roundsCount = await getRoundsCount(pageId)
    const roundNumber = Math.max(normalizeRoundNumber(metadata.roundNumber), roundsCount + 1)

    if (maxRounds !== null && roundNumber > maxRounds) {
      await notifyUser(
        client,
        userId,
        `⛔ Ліміт раундів правок вичерпано. Напишіть ${getOpsLeadMention()} для вирішення.`
      )
      return
    }

    const parentTask = await getTask(pageId)
    const feedbackTask = await createFeedbackSubitem({
      parentPageId: pageId,
      taskName,
      roundNumber,
      feedbackText,
    })
    await incrementRoundsCount(pageId)

    let feedbackMessage = null

    try {
      feedbackMessage = await postFeedbackTaskCreatedMessage({
        client,
        userId,
        taskName: feedbackTask.taskName,
        pageUrl: feedbackTask.pageUrl,
      })
    } catch (notifyError) {
      console.error(`Failed to send feedback task notification to ${userId}:`, notifyError)
    }

    try {
      await saveTask({
        pageId: feedbackTask.pageId,
        slackUserId: userId,
        slackChannelId: feedbackMessage?.channel || userId,
        slackMessageTs: feedbackMessage?.ts || null,
        slackThreadTs: feedbackMessage?.ts || null,
        taskName: feedbackTask.taskName,
        requesterName: parentTask?.requesterName || body.user?.name || userId,
        taskKind: 'feedback',
        parentPageId: pageId,
        pageUrl: feedbackTask.pageUrl,
        lastStatus: feedbackTask.initialStatus,
      })
    } catch (redisError) {
      console.error(`Redis saveTask failed for feedback task ${feedbackTask.pageId}:`, redisError)

      await notifyUser(
        client,
        userId,
        `⚠️ Правки #${roundNumber} створено, але автоапдейти по статусу цієї правки зараз не підключилися.`
      )
    }
  } catch (error) {
    console.error(`Failed to handle feedback submission for page ${pageId}:`, error)

    try {
      await notifyUser(
        client,
        userId,
        '❌ Не вдалося передати правки дизайнеру. Спробуй ще раз або напиши ops-lead.'
      )
    } catch (notifyError) {
      console.error(`Failed to notify ${userId} about feedback submission failure:`, notifyError)
    }
  }
}

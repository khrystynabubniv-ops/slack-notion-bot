import { createFeedbackSubitem } from '../notion/createSubitem.js'
import { getRoundsCount, getTask, incrementRoundsCount, saveTask } from '../redis/store.js'
import { formatDesignerForSlackAsync } from '../slack/designerMentions.js'
import { updateRootTaskMessage } from '../slack/notify.js'

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

function getFeedbackText(view) {
  return view.state.values.feedback_text?.feedback_input?.value?.trim() || ''
}

function formatFeedbackPreview(feedbackText) {
  const normalized = (feedbackText || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return 'Без тексту'
  if (normalized.length <= 240) return `«${normalized}»`
  return `«${normalized.slice(0, 237)}...»`
}

function escapeMrkdwn(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function notifyUser(client, userId, text) {
  if (!userId) return

  await client.chat.postMessage({
    channel: userId,
    text,
  })
}

function buildClosedReviewPromptText({ taskName, roundNumber, alreadySubmitted = false }) {
  return [
    alreadySubmitted
      ? `✏️ *Правки #${roundNumber} вже передано дизайнеру*`
      : `✏️ *Правки #${roundNumber} передано дизайнеру*`,
    `*${escapeMrkdwn(taskName)}*`,
    "Кнопки цього рев'ю вимкнено. Коли статус задачі знову стане «Comments», актуальні кнопки зʼявляться в головному повідомленні задачі.",
  ].join('\n\n')
}

async function updateReviewPromptAfterFeedback(client, metadata, options) {
  const channel = metadata.sourceChannelId
  const ts = metadata.sourceMessageTs

  if (!channel || !ts) return

  const text = buildClosedReviewPromptText(options)

  try {
    await client.chat.update({
      channel,
      ts,
      text,
      blocks: [
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '*Design Bot*',
            },
            {
              type: 'mrkdwn',
              text: 'щойно',
            },
          ],
        },
        {
          type: 'divider',
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text,
          },
        },
      ],
    })
  } catch (error) {
    console.error('Failed to remove feedback buttons from review prompt:', error)
  }
}

function isRootTaskSource(metadata, parentTask) {
  return Boolean(
    parentTask?.slackMessageTs &&
      metadata.sourceMessageTs &&
      parentTask.slackMessageTs === metadata.sourceMessageTs
  )
}

function getParentDesigner(parentTask) {
  if (parentTask?.lastDesignerName || parentTask?.lastDesignerUserId) {
    return {
      name: parentTask.lastDesignerName || null,
      userId: parentTask.lastDesignerUserId || null,
    }
  }

  return null
}

async function updateReviewSourceAfterFeedback(client, metadata, {
  parentTask,
  taskName,
  roundNumber,
  alreadySubmitted = false,
  roundsCount = null,
}) {
  if (!isRootTaskSource(metadata, parentTask)) {
    await updateReviewPromptAfterFeedback(client, metadata, {
      taskName,
      roundNumber,
      alreadySubmitted,
    })
    return
  }

  const completedRounds = roundsCount ?? parentTask.roundsCount ?? 0

  await updateRootTaskMessage(client, {
    channelId: parentTask.slackChannelId,
    messageTs: parentTask.slackMessageTs,
    taskName: parentTask.taskName || taskName,
    status: parentTask.lastStatus || 'Comments',
    responsible: parentTask?.lastAssignee || null,
    pageUrl: parentTask.pageUrl,
    resultUrl: parentTask.lastFinalProjectUrl,
    taskKind: parentTask.taskKind || 'task',
    completedRounds,
    pageId: metadata.pageId,
    roundNumber: completedRounds + 1,
    designer: getParentDesigner(parentTask),
    statusNote: alreadySubmitted
      ? `Правки #${roundNumber} уже передано дизайнеру. Якщо потрібно, додай наступну правку з актуальної кнопки нижче.`
      : `Правки #${roundNumber} передано дизайнеру. Якщо потрібно, можеш одразу додати ще одну правку з кнопки нижче.`,
    canAcceptResult: false,
  })
}

function buildFeedbackThreadText({
  taskName,
  status = 'To do',
  designerText,
  feedbackText = null,
}) {
  return [
    `*${taskName}*`,
    `⚪ *Статус правки:* ${status}`,
    `🎨 *Дизайнер:* ${designerText}`,
    `📝 *Правка:* ${formatFeedbackPreview(feedbackText)}`,
    '',
    'Правку передано дизайнеру.',
  ].join('\n')
}

async function postFeedbackTaskCreatedMessage({
  client,
  userId,
  channelId,
  threadTs,
  taskName,
  pageUrl,
  designer,
  feedbackText,
}) {
  const designerText = await formatDesignerForSlackAsync(client, designer)
  const text = buildFeedbackThreadText({ taskName, designerText, feedbackText })

  return await client.chat.postMessage({
    channel: channelId || userId,
    ...(threadTs ? { thread_ts: threadTs } : {}),
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
  const metadataTaskName = metadata.taskName || 'Без назви'
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
    const roundNumber = normalizeRoundNumber(metadata.roundNumber)
    const expectedRoundNumber = roundsCount + 1
    const parentTask = await getTask(pageId)
    const taskName = parentTask?.taskName || metadataTaskName

    if (roundNumber !== expectedRoundNumber) {
      await updateReviewSourceAfterFeedback(client, metadata, {
        parentTask,
        taskName,
        roundNumber,
        alreadySubmitted: true,
        roundsCount,
      })
      await notifyUser(
        client,
        userId,
        "⚠️ Це рев'ю вже неактуальне. Дочекайся оновлення головного повідомлення, коли статус знову стане «Comments»."
      )
      return
    }

    const feedbackTask = await createFeedbackSubitem({
      parentPageId: pageId,
      taskName,
      roundNumber,
      feedbackText,
    })
    const updatedRoundsCount = await incrementRoundsCount(pageId)
    await updateReviewSourceAfterFeedback(client, metadata, {
      parentTask,
      taskName,
      roundNumber,
      roundsCount: updatedRoundsCount,
    })

    let feedbackMessage = null
    const parentChannelId = parentTask?.slackChannelId || userId
    const parentThreadTs = parentTask?.slackThreadTs || parentTask?.slackMessageTs || null

    try {
      feedbackMessage = await postFeedbackTaskCreatedMessage({
        client,
        userId,
        channelId: parentChannelId,
        threadTs: parentThreadTs,
        taskName: feedbackTask.taskName,
        pageUrl: feedbackTask.pageUrl,
        designer: feedbackTask.designer,
        feedbackText,
      })
    } catch (notifyError) {
      console.error(`Failed to send feedback task notification to ${userId}:`, notifyError)
    }

    try {
      const feedbackChannelId = feedbackMessage?.channel || parentChannelId || userId
      const feedbackThreadTs = parentThreadTs || feedbackMessage?.ts || null

      await saveTask({
        pageId: feedbackTask.pageId,
        slackUserId: userId,
        slackChannelId: feedbackChannelId,
        slackMessageTs: feedbackMessage?.ts || null,
        slackThreadTs: feedbackThreadTs,
        taskName: feedbackTask.taskName,
        requesterName: parentTask?.requesterName || body.user?.name || userId,
        taskKind: 'feedback',
        parentPageId: pageId,
        pageUrl: feedbackTask.pageUrl,
        lastStatus: feedbackTask.initialStatus,
        lastFinalProjectUrl: feedbackTask.finalProjectUrl || null,
        lastDesignerName: feedbackTask.designer?.name || null,
        lastDesignerUserId: feedbackTask.designer?.userId || null,
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

import { formatDesignerForSlack } from './designerMentions.js'

const STATUS_EMOJI = {
  'To do': '⚪',
  'In progress': '🔵',
  Comments: '🟠',
  Ready: '🟢',
  Done: '✅',
}

function getNormalizedStatus(status) {
  return String(status || '').trim().toLowerCase()
}

function isCommentsStatus(status) {
  const normalized = getNormalizedStatus(status)
  return normalized === 'comments' || normalized.includes('comment') || normalized.includes('комент')
}

function isReadyStatus(status) {
  const normalized = getNormalizedStatus(status)
  return normalized === 'ready' || normalized.includes('ready') || normalized.includes('реді')
}

function shouldShowResultAction(status) {
  return isCommentsStatus(status) || isReadyStatus(status)
}

function isDoneStatus(status) {
  const normalized = getNormalizedStatus(status)
  return normalized.includes('done')
}

function isInProgressStatus(status) {
  const normalized = getNormalizedStatus(status)
  return normalized.includes('progress') || normalized.includes('в робот')
}

function isToDoStatus(status) {
  const normalized = getNormalizedStatus(status)
  return normalized.includes('to do') || normalized.includes('todo') || normalized.includes('ту ду')
}

export async function sendStatusUpdate({
  slackClient,
  taskName,
  oldStatus,
  newStatus,
  assignee,
  finalProjectUrl,
  pageUrl,
  pageId,
  slackChannelId,
  slackMessageTs,
  slackThreadTs,
  taskKind = 'task',
  roundsLeft = null,
  roundNumber = 1,
  completedRounds = null,
  designer,
}) {
  const resultUrl = normalizeUrl(finalProjectUrl)

  await updateRootTaskMessage(slackClient, {
    channelId: slackChannelId,
    messageTs: slackMessageTs,
    taskName,
    status: newStatus,
    responsible: designer || assignee,
    pageUrl,
    resultUrl,
    taskKind,
    completedRounds: completedRounds ?? Math.max(normalizePositiveInteger(roundNumber, 1) - 1, 0),
    pageId,
    roundsLeft,
    roundNumber,
    designer: designer || assignee,
  })

  await postThreadStatusMovement(slackClient, {
    channelId: slackChannelId,
    threadTs: slackThreadTs || slackMessageTs,
    oldStatus,
    newStatus,
    taskKind,
  })
}

export async function sendTaskFieldUpdate({
  slackClient,
  taskName,
  status,
  responsible,
  finalProjectUrl,
  pageUrl,
  slackChannelId,
  slackMessageTs,
  taskKind = 'task',
  pageId = null,
  roundsLeft = null,
  roundNumber = 1,
  designer = null,
}) {
  const resultUrl = normalizeUrl(finalProjectUrl)

  await updateRootTaskMessage(slackClient, {
    channelId: slackChannelId,
    messageTs: slackMessageTs,
    taskName,
    status,
    responsible: designer || responsible,
    pageUrl,
    resultUrl,
    taskKind,
    pageId,
    roundsLeft,
    roundNumber,
    designer: designer || responsible,
  })
}

export async function sendReviewRequest({
  slackClient,
  taskName,
  status,
  assignee,
  finalProjectUrl,
  pageUrl,
  pageId,
  slackChannelId,
  slackMessageTs,
  slackThreadTs,
  taskKind = 'task',
  roundsLeft = null,
  roundNumber = 1,
  designer,
}) {
  const resultUrl = normalizeUrl(finalProjectUrl)

  await updateRootTaskMessage(slackClient, {
    channelId: slackChannelId,
    messageTs: slackMessageTs,
    taskName,
    status,
    responsible: designer || assignee,
    pageUrl,
    resultUrl,
    taskKind,
    pageId,
    roundsLeft,
    roundNumber,
    designer: designer || assignee,
  })

  await postThreadReviewMovement(slackClient, {
    channelId: slackChannelId,
    threadTs: slackThreadTs || slackMessageTs,
    taskKind,
  })
}

function getStatusEmoji(status) {
  if (STATUS_EMOJI[status]) return STATUS_EMOJI[status]

  const normalized = getNormalizedStatus(status)
  if (normalized.includes('done')) return STATUS_EMOJI.Done
  if (normalized.includes('ready') || normalized.includes('реді')) return STATUS_EMOJI.Ready
  if (normalized.includes('comment') || normalized.includes('комент')) return STATUS_EMOJI.Comments
  if (normalized.includes('progress')) return STATUS_EMOJI['In progress']
  if (normalized.includes('to do')) return STATUS_EMOJI['To do']

  return '▪️'
}

export async function updateRootTaskMessage(slackClient, {
  channelId,
  messageTs,
  taskName,
  status,
  responsible = null,
  pageUrl,
  resultUrl,
  taskKind = 'task',
  completedRounds = 0,
  pageId = null,
  roundsLeft = null,
  roundNumber = 1,
  designer = null,
  statusNote = null,
  suppressStatusActions = false,
}) {
  if (!channelId || !messageTs) return

  const text = buildRootTaskText({
    taskName,
    status,
    statusEmoji: getStatusEmoji(status),
    responsible,
    taskKind,
    completedRounds,
    statusNote,
  })
  const actionElements = suppressStatusActions
    ? getPassiveActionElements({ pageUrl, resultUrl, status })
    : getStatusActionElements({
        newStatus: status,
        pageUrl,
        resultUrl,
        pageId,
        rootMessageTs: messageTs,
        taskName,
        roundsLeft,
        roundNumber,
        designer: designer || responsible,
        taskKind,
      })

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text,
      },
    },
  ]

  if (actionElements.length) {
    blocks.push({
      type: 'actions',
      elements: actionElements,
    })
  }

  try {
    await slackClient.chat.update({
      channel: channelId,
      ts: messageTs,
      text,
      blocks,
    })
  } catch (error) {
    console.error(`Failed to update root Slack task message ${channelId}/${messageTs}:`, error)
  }
}

function buildRootTaskText({
  taskName,
  status,
  statusEmoji,
  responsible,
  taskKind,
  completedRounds = 0,
  statusNote = null,
}) {
  const isFeedback = taskKind === 'feedback'
  const feedbackDone = isFeedback && isDoneStatus(status)
  const feedbackReady = isFeedback && isReadyStatus(status)
  const taskReady = !isFeedback && isReadyStatus(status)
  const ready = feedbackReady || taskReady
  const normalizedCompletedRounds = normalizeNonNegativeInteger(completedRounds, 0)
  const responsibleText = formatDesignerForSlack(responsible)

  return [
    isFeedback ? null : 'Ми отримали твій запит!',
    `*${taskName}*`,
    `${statusEmoji} *Статус${isFeedback ? ' правки' : ''}:* ${status}`,
    ready ? null : `🎨 *Дизайнер:* ${responsibleText}`,
    taskReady ? `✏️ *Раундів правок:* ${normalizedCompletedRounds}` : null,
    '',
    getRootTaskStatusText({
      status,
      isFeedback,
      feedbackDone,
      feedbackReady,
      taskReady,
      completedRounds: normalizedCompletedRounds,
      statusNote,
    }),
  ].filter((line) => line !== null).join('\n')
}

function getRootTaskStatusText({
  status,
  isFeedback,
  feedbackDone,
  feedbackReady,
  taskReady,
  completedRounds,
  statusNote,
}) {
  if (statusNote) return statusNote

  if (feedbackDone) {
    return 'Правки внесено, апрув зафіксовано :white_check_mark:'
  }

  if (feedbackReady) {
    return 'Правка готова до ревʼю. Переглянь результат і прийми її, якщо все ок.'
  }

  if (taskReady) {
    return completedRounds > 0
      ? 'Готово, результат прийнято після правок :white_check_mark:'
      : 'Готово, результат прийнято без правок :white_check_mark:'
  }

  if (isCommentsStatus(status)) {
    return 'Задача перебуває на етапі ревʼю або правок. Заглянь у задачу, щоб мати актуальний статус.'
  }

  if (isInProgressStatus(status)) {
    return 'Твоя задача вже в роботі у дизайнера. Коли вона буде готова до ревʼю, статус і кнопки оновляться тут.'
  }

  if (isToDoStatus(status)) {
    return isFeedback
      ? 'Правку передано дизайнеру.'
      : 'Задачу передано в дизайн-команду. Щойно дизайнер візьме її в роботу, ти побачиш оновлення в цьому треді.'
  }

  return isFeedback
    ? 'Оновлення по правці зафіксовано. Слідкуй за цим тредом, щоб не пропустити наступний апдейт.'
    : 'Оновлення по задачі зафіксовано. Слідкуй за цим тредом, щоб не пропустити наступний апдейт.'
}

export async function sendQualitySurvey({
  slackClient,
  slackUserId,
  taskName,
  pageId,
  requesterName,
  requestUrl,
  team,
  hub,
  requestType,
  completedAt,
  slackChannelId,
  slackThreadTs,
}) {
  const ratings = [1, 2, 3, 4, 5]
  const baseValue = {
    pageId,
    taskName: String(taskName || 'Без назви').slice(0, 1000),
    requesterName: requesterName || null,
    requestUrl: requestUrl || null,
    team: team || null,
    hub: hub || null,
    requestType: requestType || null,
    completedAt: completedAt || null,
  }

  return await postNotification(slackClient, slackUserId, {
    text: `Оціни якість виконання задачі «${taskName}».`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `⭐ *Оціни якість виконання роботи*\n*${escapeMrkdwn(taskName)}*\nНаскільки тобі ок результат?`,
        },
      },
      {
        type: 'actions',
        elements: ratings.map((rating) => ({
          type: 'button',
          text: { type: 'plain_text', text: `⭐ ${rating}` },
          action_id: `quality_rating_${rating}`,
          value: JSON.stringify({
            ...baseValue,
            rating,
          }),
        })),
      },
    ],
  }, {
    channelId: slackChannelId,
    threadTs: slackThreadTs,
  })
}

export async function sendCommentUpdate({
  slackClient,
  slackUserId,
  taskName,
  commentAuthor,
  commentText,
  pageUrl,
  slackChannelId,
  slackThreadTs,
}) {
  if (!slackChannelId || !slackThreadTs) return

  const preview = formatCommentPreview(commentText)

  await postNotification(slackClient, slackUserId, {
    text: `💬 У задачі «${taskName}» з'явився новий коментар.`,
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
          text: [
            '💬 *Новий коментар у задачі*',
            `🏷️ Задача: ${taskName}`,
            `👤 Автор: ${commentAuthor || 'невідомий автор'}`,
            `📝 Коментар: ${preview}`,
          ].join('\n\n'),
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '📋 Відкрити в Notion' },
            url: pageUrl,
            style: 'primary',
          },
        ],
      },
    ],
  }, {
    channelId: slackChannelId,
    threadTs: slackThreadTs,
  })
}

async function postThreadStatusMovement(slackClient, {
  channelId,
  threadTs,
  oldStatus,
  newStatus,
  taskKind = 'task',
}) {
  if (!channelId || !threadTs) return

  const isFeedback = taskKind === 'feedback'
  const label = isFeedback ? 'Статус правки' : 'Статус'
  const text = [
    isFeedback ? '*Є рух по правці* 🔄' : '*Є рух по задачі* 🔄',
    oldStatus
      ? `*${label}:* ${escapeMrkdwn(oldStatus)} → ${escapeMrkdwn(newStatus)}`
      : `*${label}:* ${escapeMrkdwn(newStatus)}`,
  ].join('\n')

  try {
    await slackClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      reply_broadcast: true,
      text,
      blocks: [
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
    console.error(`Failed to post short status movement ${channelId}/${threadTs}:`, error)
  }
}

async function postThreadReviewMovement(slackClient, {
  channelId,
  threadTs,
  taskKind = 'task',
}) {
  if (!channelId || !threadTs) return

  const text = [
    taskKind === 'feedback' ? '*Є рух по правці* 🔄' : '*Є рух по задачі* 🔄',
    taskKind === 'feedback'
      ? 'Результат правки оновлено для ревʼю.'
      : 'Результат оновлено для ревʼю.',
  ].join('\n')

  try {
    await slackClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      reply_broadcast: true,
      text,
      blocks: [
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
    console.error(`Failed to post short review movement ${channelId}/${threadTs}:`, error)
  }
}

async function postNotification(slackClient, slackUserId, message, { channelId, threadTs } = {}) {
  if (channelId) {
    try {
      return await slackClient.chat.postMessage({
        ...message,
        channel: channelId,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      })
    } catch (error) {
      if (!shouldTryNextChannel(error)) {
        throw error
      }

      console.warn(`Failed to post threaded notification to ${channelId}, trying fallback DM:`, error)
    }
  }

  const channels = await resolveNotificationChannels(slackClient, slackUserId)
  let lastError

  for (const channel of channels) {
    try {
      return await slackClient.chat.postMessage({
        ...message,
        channel,
      })
    } catch (error) {
      lastError = error

      if (!shouldTryNextChannel(error)) {
        throw error
      }

      console.warn(`Failed to post notification to ${channel}, trying fallback channel:`, error)
    }
  }

  throw lastError
}

async function resolveNotificationChannels(slackClient, slackUserId) {
  const channels = []

  try {
    const response = await slackClient.conversations.open({
      users: slackUserId,
    })

    const channelId = response.channel?.id
    if (channelId) channels.push(channelId)
  } catch (error) {
    console.warn(`Failed to open DM channel for ${slackUserId}, fallback to user ID delivery:`, error)
  }

  channels.push(slackUserId)

  return [...new Set(channels.filter(Boolean))]
}

function shouldTryNextChannel(error) {
  const slackError = error?.data?.error || error?.message
  return ['channel_not_found', 'not_in_channel', 'is_archived'].includes(slackError)
}

function normalizeUrl(value) {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    return new URL(trimmed).toString()
  } catch (_) {
    try {
      return new URL(`https://${trimmed}`).toString()
    } catch (_) {
      return null
    }
  }
}

function getStatusActionElements({
  newStatus,
  pageUrl,
  resultUrl,
  pageId,
  rootMessageTs,
  taskName,
  roundsLeft,
  roundNumber,
  designer,
  taskKind,
}) {
  if (isCommentsStatus(newStatus) && taskKind === 'feedback') {
    const elements = []

    if (pageId) {
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: '✅ Прийняти правку' },
        action_id: 'accept_task_result',
        style: 'primary',
        value: buildAcceptActionValue({
          pageId,
          taskName,
          designer,
          requestUrl: pageUrl,
          resultUrl,
          rootMessageTs,
          taskKind,
          roundNumber,
        }),
      })
    }

    if (resultUrl) {
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: '🔗 Відкрити результат' },
        url: resultUrl,
      })
    }

    return elements
  }

  if (isCommentsStatus(newStatus)) {
    const elements = []
    const completedRounds = Math.max(normalizePositiveInteger(roundNumber, 1) - 1, 0)

    if (pageId) {
      elements.push({
        type: 'button',
        text: {
          type: 'plain_text',
          text: completedRounds > 0
            ? '✅ Приймаю, більше правок немає'
            : '✅ Приймаю, правок немає',
        },
        action_id: 'accept_task_result',
        style: 'primary',
        value: buildAcceptActionValue({
          pageId,
          taskName,
          designer,
          requestUrl: pageUrl,
          resultUrl,
          rootMessageTs,
          taskKind,
          roundNumber,
        }),
      })
    }

    if (pageId && !isRoundsLimitReached(roundsLeft)) {
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: '✏️ Дати правки' },
        action_id: 'open_feedback_modal',
        value: buildFeedbackActionValue({ pageId, taskName, roundsLeft, roundNumber }),
      })
    }

    if (resultUrl) {
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: '🔗 Відкрити результат' },
        url: resultUrl,
      })
    }

    return elements
  }

  if (isReadyStatus(newStatus)) {
    return getPassiveActionElements({ pageUrl, resultUrl, status: newStatus })
  }

  const elements = []

  if (pageUrl) {
    elements.push({
      type: 'button',
      text: { type: 'plain_text', text: '📋 Відкрити в Notion' },
      url: pageUrl,
      style: 'primary',
    })
  }

  return elements
}

function getPassiveActionElements({ pageUrl, resultUrl, status }) {
  const elements = []

  if (pageUrl) {
    elements.push({
      type: 'button',
      text: { type: 'plain_text', text: '📋 Відкрити в Notion / додати файли' },
      url: pageUrl,
      style: resultUrl ? undefined : 'primary',
    })
  }

  if (resultUrl && shouldShowResultAction(status)) {
    elements.push({
      type: 'button',
      text: {
        type: 'plain_text',
        text: isReadyStatus(status) ? '🔍 Переглянути результат' : '🔗 Відкрити результат',
      },
      url: resultUrl,
      style: isReadyStatus(status) ? 'primary' : undefined,
    })
  }

  return elements
}

function buildAcceptActionValue({
  pageId,
  taskName,
  designer,
  requestUrl,
  resultUrl,
  rootMessageTs,
  taskKind,
  roundNumber,
}) {
  return JSON.stringify({
    pageId,
    taskName: String(taskName || 'Без назви').slice(0, 1000),
    designerName: designer?.name || null,
    designerUserId: designer?.userId || null,
    requestUrl: requestUrl || null,
    resultUrl: resultUrl || null,
    rootMessageTs: rootMessageTs || null,
    taskKind: taskKind || 'task',
    completedRounds: Math.max(normalizePositiveInteger(roundNumber, 1) - 1, 0),
  })
}

function buildFeedbackActionValue({ pageId, taskName, roundsLeft, roundNumber }) {
  const normalizedRoundNumber = normalizePositiveInteger(roundNumber, 1)
  const normalizedRoundsLeft = normalizeRoundsLeft(roundsLeft)
  const maxRounds = normalizedRoundsLeft === null
    ? null
    : normalizedRoundNumber + normalizedRoundsLeft - 1

  return JSON.stringify({
    pageId,
    taskName: String(taskName || 'Без назви').slice(0, 1000),
    roundNumber: normalizedRoundNumber,
    maxRounds,
  })
}

function isRoundsLimitReached(roundsLeft) {
  const normalizedRoundsLeft = normalizeRoundsLeft(roundsLeft)
  return normalizedRoundsLeft !== null && normalizedRoundsLeft <= 0
}

function normalizeRoundsLeft(roundsLeft) {
  if (roundsLeft === null || roundsLeft === undefined) return null

  const parsed = Number.parseInt(roundsLeft, 10)
  if (!Number.isFinite(parsed)) return null

  return Math.max(parsed, 0)
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function escapeMrkdwn(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatCommentPreview(commentText) {
  const normalized = (commentText || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return 'Без тексту'
  if (normalized.length <= 220) return `«${normalized}»`
  return `«${normalized.slice(0, 217)}...»`
}

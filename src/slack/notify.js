const DEFAULT_OPS_LEAD_SLACK_ID = 'U0APPD32H6D'

export async function sendStatusUpdate({
  slackClient,
  slackUserId,
  taskName,
  oldStatus,
  newStatus,
  assignee,
  deadline,
  finalProjectUrl,
  pageUrl,
  pageId,
  slackChannelId,
  slackThreadTs,
  roundsLeft = null,
  roundNumber = 1,
  designer,
}) {
  const statusEmoji = {
    'To do': '⬜',
    'In progress': '🔵',
    Comments: '🟠',
    Ready: '🟢',
    Done: '✅',
  }
  const infoEmoji = {
    status: '🔄',
    task: '🏷️',
    assignee: '👤',
    deadline: '📅',
  }

  const formattedDeadline = formatDeadline(deadline)
  const resultUrl = normalizeUrl(finalProjectUrl)
  const designerName = designer?.name || assignee || 'не призначено'
  const summaryLines = [
    `${infoEmoji.status} Статус: «${newStatus}»`,
    `${infoEmoji.task} Задача: ${taskName}`,
    `${infoEmoji.assignee} Виконавець: ${assignee || 'не призначено'}`,
    `${infoEmoji.deadline} Дедлайн: ${formattedDeadline}`,
  ]
  const resultBlocks = resultUrl && newStatus === 'Ready'
    ? [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: getResultText(newStatus, resultUrl),
          },
        },
      ]
    : []
  const feedbackNoticeBlocks = getFeedbackNoticeBlocks(newStatus, roundsLeft)
  const actionElements = getStatusActionElements({
    newStatus,
    pageUrl,
    resultUrl,
    pageId,
    taskName,
    roundsLeft,
    roundNumber,
    designer,
  })
  const blocks = newStatus === 'Comments'
    ? buildCommentsReviewBlocks({
        taskName,
        newStatus,
        designerName,
        resultUrl,
        feedbackNoticeBlocks,
        actionElements,
      })
    : buildDefaultStatusBlocks({
        summaryLines,
        resultBlocks,
        feedbackNoticeBlocks,
        oldStatus,
        oldStatusEmoji: statusEmoji[oldStatus] || '▪️',
        actionElements,
      })

  await postNotification(slackClient, slackUserId, {
    text: `${statusEmoji[newStatus] || '▪️'} Статус задачі «${taskName}» змінено на «${newStatus}».`,
    blocks,
  }, {
    channelId: slackChannelId,
    threadTs: slackThreadTs,
  })
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

  await postNotification(slackClient, slackUserId, {
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
          action_id: 'quality_rating',
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

function getResultText(status, resultUrl) {
  if (status === 'Ready') {
    return `✨ *Результат готовий:* <${resultUrl}|відкрити фінальний проєкт>\nПереглянь фінальну версію.`
  }

  return `✨ *Ось результати:* <${resultUrl}|відкрити фінальний проєкт>\nПереглянь і за потреби залиш правки.`
}

function buildCommentsReviewBlocks({
  taskName,
  newStatus,
  designerName,
  resultUrl,
  feedbackNoticeBlocks,
  actionElements,
}) {
  const blocks = [
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
          "👀 *Твоя задача очікує твоє рев'ю*",
          `*${escapeMrkdwn(taskName)}*`,
          `Оновлено статус: «${newStatus}»`,
          `Дизайнер: ${escapeMrkdwn(designerName)}`,
          resultUrl ? `:sparkles: Ось результати: <${resultUrl}|відкрити!>` : ':sparkles: Ось результати: посилання ще не додано.',
        ].join('\n\n'),
      },
    },
    ...feedbackNoticeBlocks,
  ]

  if (actionElements.length) {
    blocks.push({
      type: 'actions',
      elements: actionElements,
    })
  }

  return blocks
}

function buildDefaultStatusBlocks({
  summaryLines,
  resultBlocks,
  feedbackNoticeBlocks,
  oldStatus,
  oldStatusEmoji,
  actionElements,
}) {
  const blocks = [
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
        text: summaryLines.join('\n\n'),
      },
    },
    ...resultBlocks,
    ...feedbackNoticeBlocks,
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Було: ${oldStatusEmoji} ${oldStatus}`,
        },
      ],
    },
  ]

  if (actionElements.length) {
    blocks.push({
      type: 'actions',
      elements: actionElements,
    })
  }

  return blocks
}

function getStatusActionElements({
  newStatus,
  pageUrl,
  resultUrl,
  pageId,
  taskName,
  roundsLeft,
  roundNumber,
  designer,
}) {
  if (newStatus === 'Comments') {
    const elements = []

    if (pageId) {
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: '✅ Приймаю, правок немає' },
        action_id: 'accept_task_result',
        style: 'primary',
        value: buildAcceptActionValue({ pageId, taskName, designer, requestUrl: pageUrl }),
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

    return elements
  }

  if (newStatus === 'Ready') {
    return resultUrl
      ? [
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔍 Переглянути результат' },
            url: resultUrl,
            style: 'primary',
          },
        ]
      : []
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

  if (resultUrl) {
    elements.push({
      type: 'button',
      text: { type: 'plain_text', text: '🔗 Відкрити результат' },
      url: resultUrl,
    })
  }

  return elements
}

function buildAcceptActionValue({ pageId, taskName, designer, requestUrl }) {
  return JSON.stringify({
    pageId,
    taskName: String(taskName || 'Без назви').slice(0, 1000),
    designerName: designer?.name || null,
    designerUserId: designer?.userId || null,
    requestUrl: requestUrl || null,
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

function getFeedbackNoticeBlocks(status, roundsLeft) {
  if (status !== 'Comments') return []

  const normalizedRoundsLeft = normalizeRoundsLeft(roundsLeft)
  if (normalizedRoundsLeft === null) return []

  if (normalizedRoundsLeft <= 0) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `⛔ Ліміт раундів правок вичерпано. Напишіть ${getOpsLeadMention()} для вирішення.`,
        },
      },
    ]
  }

  if (normalizedRoundsLeft === 1) {
    return [
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '⚠️ Це останній раунд правок.',
          },
        ],
      },
    ]
  }

  return []
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

function getOpsLeadMention() {
  const slackId = process.env.OPS_LEAD_SLACK_ID?.trim() || DEFAULT_OPS_LEAD_SLACK_ID
  if (/^[UW][A-Z0-9]+$/.test(slackId || '')) return `<@${slackId}>`

  return 'ops-lead'
}

function escapeMrkdwn(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatDeadline(deadline) {
  if (!deadline) return 'не вказано'

  const date = new Date(`${deadline}T00:00:00`)
  if (Number.isNaN(date.getTime())) return deadline

  const now = new Date()
  const sameYear = date.getFullYear() === now.getFullYear()

  return new Intl.DateTimeFormat('uk-UA', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date)
}

function formatCommentPreview(commentText) {
  const normalized = (commentText || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return 'Без тексту'
  if (normalized.length <= 220) return `«${normalized}»`
  return `«${normalized.slice(0, 217)}...»`
}

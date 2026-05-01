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
  const summaryLines = [
    `${infoEmoji.status} Статус: «${newStatus}»`,
    `${infoEmoji.task} Задача: ${taskName}`,
    `${infoEmoji.assignee} Виконавець: ${assignee || 'не призначено'}`,
    `${infoEmoji.deadline} Дедлайн: ${formattedDeadline}`,
  ]
  const resultBlocks = resultUrl
    ? [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✨ *Ось результати:* <${resultUrl}|відкрити фінальний проєкт>\nПереглянь і повернися до дизайнера з фідбеком.`,
          },
        },
      ]
    : []
  const actionElements = [
    {
      type: 'button',
      text: { type: 'plain_text', text: '📋 Відкрити в Notion' },
      url: pageUrl,
      style: 'primary',
    },
  ]

  if (resultUrl) {
    actionElements.push({
      type: 'button',
      text: { type: 'plain_text', text: '🔗 Відкрити результат' },
      url: resultUrl,
    })
  }

  await postNotification(slackClient, slackUserId, {
    text: `${statusEmoji[newStatus] || '▪️'} Статус задачі «${taskName}» змінено на «${newStatus}».`,
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
          text: summaryLines.join('\n\n'),
        },
      },
      ...resultBlocks,
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Було: ${statusEmoji[oldStatus] || '▪️'} ${oldStatus}`,
          },
        ],
      },
      {
        type: 'actions',
        elements: actionElements,
      },
    ],
  })
}

export async function sendCommentUpdate({
  slackClient,
  slackUserId,
  taskName,
  commentAuthor,
  commentText,
  pageUrl,
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
  })
}

async function postNotification(slackClient, slackUserId, message) {
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

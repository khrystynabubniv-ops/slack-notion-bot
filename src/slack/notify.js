export async function sendStatusUpdate({
  slackClient,
  slackUserId,
  taskName,
  oldStatus,
  newStatus,
  assignee,
  deadline,
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
  const summaryLines = [
    `${infoEmoji.status} Статус: «${newStatus}»`,
    `${infoEmoji.task} Задача: ${taskName}`,
    `${infoEmoji.assignee} Виконавець: ${assignee || 'не призначено'}`,
    `${infoEmoji.deadline} Дедлайн: ${formattedDeadline}`,
  ]
  const dmChannelId = await resolveDmChannelId(slackClient, slackUserId)

  await slackClient.chat.postMessage({
    channel: dmChannelId,
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

async function resolveDmChannelId(slackClient, slackUserId) {
  const response = await slackClient.conversations.open({
    users: slackUserId,
  })

  const channelId = response.channel?.id
  if (!channelId) {
    throw new Error(`Unable to open DM channel for user ${slackUserId}`)
  }

  return channelId
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

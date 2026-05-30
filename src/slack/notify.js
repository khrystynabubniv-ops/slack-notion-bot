import { formatDesignerForSlack } from './designerMentions.js'

const DEFAULT_OPS_LEAD_SLACK_ID = 'U0APPD32H6D'
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
  slackMessageTs,
  slackThreadTs,
  taskKind = 'task',
  roundsLeft = null,
  roundNumber = 1,
  completedRounds = null,
  designer,
}) {
  const infoEmoji = {
    status: '🔄',
    task: '🏷️',
    assignee: '👤',
    deadline: '📅',
  }

  const formattedDeadline = formatDeadline(deadline)
  const resultUrl = normalizeUrl(finalProjectUrl)
  const assigneeDisplay = formatDesignerForSlack(designer || assignee)
  const commentsStatus = isCommentsStatus(newStatus)
  const readyStatus = isReadyStatus(newStatus)
  const feedbackDoneStatus = taskKind === 'feedback' && isDoneStatus(newStatus)
  const summaryLines = [
    `${infoEmoji.status} Статус: «${newStatus}»`,
    `${infoEmoji.task} Задача: ${taskName}`,
    `${infoEmoji.assignee} Виконавець: ${assigneeDisplay}`,
    `${infoEmoji.deadline} Дедлайн: ${formattedDeadline}`,
  ]
  const resultBlocks = resultUrl && readyStatus
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
    rootMessageTs: slackMessageTs,
    taskName,
    roundsLeft,
    roundNumber,
    designer,
    taskKind,
  })
  const blocks = feedbackDoneStatus
    ? buildFeedbackDoneBlocks({
        taskName,
        newStatus,
        designerDisplay: assigneeDisplay,
        pageUrl,
      })
    : commentsStatus
      ? taskKind === 'feedback'
        ? buildFeedbackReviewBlocks({
            taskName,
            newStatus,
            designerDisplay: assigneeDisplay,
            resultUrl,
            feedbackNoticeBlocks,
            actionElements,
          })
        : buildCommentsReviewBlocks({
            taskName,
            newStatus,
            designerDisplay: assigneeDisplay,
            resultUrl,
            feedbackNoticeBlocks,
            actionElements,
          })
      : buildDefaultStatusBlocks({
          summaryLines,
          resultBlocks,
          feedbackNoticeBlocks,
          oldStatus,
          oldStatusEmoji: getStatusEmoji(oldStatus),
          actionElements,
        })

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
  })

  if (feedbackDoneStatus) return

  await postNotification(slackClient, slackUserId, {
    text: `${getStatusEmoji(newStatus)} Статус задачі «${taskName}» змінено на «${newStatus}».`,
    blocks,
  }, {
    channelId: slackChannelId,
    threadTs: slackThreadTs,
  })
}

export async function sendTaskFieldUpdate({
  slackClient,
  slackUserId,
  taskName,
  status,
  responsible,
  finalProjectUrl,
  pageUrl,
  changes,
  slackChannelId,
  slackMessageTs,
  slackThreadTs,
  taskKind = 'task',
}) {
  const resultUrl = normalizeUrl(finalProjectUrl)
  const normalizedChanges = Array.isArray(changes) ? changes.filter(Boolean) : []
  if (!normalizedChanges.length) return

  await updateRootTaskMessage(slackClient, {
    channelId: slackChannelId,
    messageTs: slackMessageTs,
    taskName,
    status,
    responsible,
    pageUrl,
    resultUrl,
    taskKind,
  })

  await postNotification(slackClient, slackUserId, {
    text: `Оновлено задачу «${taskName}».`,
    blocks: buildFieldUpdateBlocks({
      taskName,
      status,
      changes: normalizedChanges,
      pageUrl,
      resultUrl,
    }),
  }, {
    channelId: slackChannelId,
    threadTs: slackThreadTs,
  })
}

export async function sendReviewRequest({
  slackClient,
  slackUserId,
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
  const assigneeDisplay = formatDesignerForSlack(designer || assignee)
  const feedbackNoticeBlocks = getFeedbackNoticeBlocks(status, roundsLeft)
  const actionElements = getStatusActionElements({
    newStatus: status,
    pageUrl,
    resultUrl,
    pageId,
    rootMessageTs: slackMessageTs,
    taskName,
    roundsLeft,
    roundNumber,
    designer,
    taskKind,
  })

  await updateRootTaskMessage(slackClient, {
    channelId: slackChannelId,
    messageTs: slackMessageTs,
    taskName,
    status,
    responsible: designer || assignee,
    pageUrl,
    resultUrl,
    taskKind,
  })

  await postNotification(slackClient, slackUserId, {
    text: `Потрібне рев'ю задачі «${taskName}».`,
    blocks: taskKind === 'feedback'
      ? buildFeedbackReviewBlocks({
          taskName,
          newStatus: status,
          designerDisplay: assigneeDisplay,
          resultUrl,
          feedbackNoticeBlocks,
          actionElements,
        })
      : buildCommentsReviewBlocks({
          taskName,
          newStatus: status,
          designerDisplay: assigneeDisplay,
          resultUrl,
          feedbackNoticeBlocks,
          actionElements,
        }),
  }, {
    channelId: slackChannelId,
    threadTs: slackThreadTs,
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
}) {
  if (!channelId || !messageTs) return

  const text = buildRootTaskText({
    taskName,
    status,
    statusEmoji: getStatusEmoji(status),
    responsible,
    taskKind,
    completedRounds,
  })
  const actionElements = []

  if (pageUrl) {
    actionElements.push({
      type: 'button',
      text: { type: 'plain_text', text: '📋 Відкрити в Notion / додати файли' },
      url: pageUrl,
      style: 'primary',
    })
  }

  if (resultUrl && shouldShowResultAction(status)) {
    actionElements.push({
      type: 'button',
      text: { type: 'plain_text', text: '🔗 Відкрити результат' },
      url: resultUrl,
    })
  }

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
}) {
  const isFeedback = taskKind === 'feedback'
  const feedbackDone = isFeedback && isDoneStatus(status)
  const feedbackReady = isFeedback && isReadyStatus(status)
  const taskReady = !isFeedback && isReadyStatus(status)
  const ready = feedbackReady || taskReady
  const normalizedCompletedRounds = normalizeNonNegativeInteger(completedRounds, 0)
  const responsibleText = formatDesignerForSlack(responsible)

  return [
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
}) {
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
    return 'Твоя задача вже в роботі у дизайнера. Ти отримаєш сповіщення, коли вона буде готова до ревʼю.'
  }

  if (isToDoStatus(status)) {
    return isFeedback
      ? 'Правку передано дизайнеру. Апдейти по ній приходитимуть у цей тред.'
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
  if (isReadyStatus(status)) {
    return `✨ *Результат готовий:* <${resultUrl}|відкрити фінальний проєкт>\nПереглянь фінальну версію.`
  }

  return `✨ *Ось результати:* <${resultUrl}|відкрити фінальний проєкт>\nПереглянь і за потреби залиш правки.`
}

function buildCommentsReviewBlocks({
  taskName,
  newStatus,
  designerDisplay,
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
          `Дизайнер: ${designerDisplay}`,
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

function buildFeedbackReviewBlocks({
  taskName,
  newStatus,
  designerDisplay,
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
          "👀 *Правка очікує твоє рев'ю*",
          `*${escapeMrkdwn(taskName)}*`,
          `Оновлено статус: «${newStatus}»`,
          `Дизайнер: ${designerDisplay}`,
          resultUrl ? `✨ Результат правки: <${resultUrl}|відкрити>` : '✨ Посилання на результат ще не додано.',
          'Переглянь внесені зміни. Якщо все ок, натисни «Прийняти правку», щоб зафіксувати апрув.',
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

function buildFeedbackDoneBlocks({
  taskName,
  newStatus,
  designerDisplay,
  pageUrl,
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
          '✅ *Правки внесено, апрув зафіксовано*',
          `*${escapeMrkdwn(taskName)}*`,
          `Статус правки: «${newStatus}»`,
          `Дизайнер: ${designerDisplay}`,
          'Цю правку можна вважати закритою: зміни внесені, погодження отримано.',
        ].join('\n\n'),
      },
    },
  ]

  if (pageUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '📋 Відкрити в Notion' },
          url: pageUrl,
          style: 'primary',
        },
      ],
    })
  }

  return blocks
}

function buildFieldUpdateBlocks({
  taskName,
  status,
  changes,
  pageUrl,
  resultUrl,
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
          '🔄 *Оновлення по задачі*',
          `*${escapeMrkdwn(taskName)}*`,
          `Поточний статус: ${getStatusEmoji(status)} «${status}»`,
          ...changes.map(({ label, oldValue, newValue }) => {
            return `*${label}:* ${oldValue || 'не вказано'} → ${newValue || 'не вказано'}`
          }),
        ].join('\n\n'),
      },
    },
  ]

  const actionElements = []
  if (pageUrl) {
    actionElements.push({
      type: 'button',
      text: { type: 'plain_text', text: '📋 Відкрити в Notion' },
      url: pageUrl,
      style: 'primary',
    })
  }

  if (resultUrl && shouldShowResultAction(status)) {
    actionElements.push({
      type: 'button',
      text: { type: 'plain_text', text: '🔗 Відкрити результат' },
      url: resultUrl,
    })
  }

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

function getFeedbackNoticeBlocks(status, roundsLeft) {
  if (!isCommentsStatus(status)) return []

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

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
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

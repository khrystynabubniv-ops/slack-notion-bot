import { formatDesignerForSlackAsync } from './designerMentions.js'
import { getDepartment } from '../config/departments.js'
import { ACTION_IDS, buildQualityRatingActionId } from '../config/interactionIds.js'

const STATUS_EMOJI = {
  Backlog: '🔄',
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

function isBacklogStatus(status) {
  const normalized = getNormalizedStatus(status)
  return normalized === 'backlog' || normalized.includes('backlog')
}

function formatDateUk(dateString) {
  if (!dateString) return null

  const [year, month, day] = String(dateString).split('-')
  return year && month && day ? `${day}.${month}.${year}` : dateString
}

export async function sendStatusUpdate({
  slackClient,
  slackUserId,
  taskName,
  departmentKey = 'design',
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
  roundNumber = 1,
  completedRounds = null,
  designer,
  canAcceptResult = true,
  requestType = null,
  deadline = null,
}) {
  const resultUrl = normalizeUrl(finalProjectUrl)

  await updateRootTaskMessage(slackClient, {
    channelId: slackChannelId,
    messageTs: slackMessageTs,
    taskName,
    departmentKey,
    status: newStatus,
    responsible: assignee,
    pageUrl,
    resultUrl,
    taskKind,
    completedRounds: completedRounds ?? Math.max(normalizePositiveInteger(roundNumber, 1) - 1, 0),
    pageId,
    roundNumber,
    designer,
    canAcceptResult,
    requestType,
    deadline,
  })

  await postThreadStatusMovement(slackClient, {
    channelId: slackChannelId,
    threadTs: slackThreadTs || slackMessageTs,
    oldStatus,
    newStatus,
    taskKind,
    slackUserId,
  })
}

export async function sendTaskFieldUpdate({
  slackClient,
  slackUserId,
  taskName,
  departmentKey = 'design',
  status,
  responsible,
  finalProjectUrl,
  pageUrl,
  slackChannelId,
  slackMessageTs,
  slackThreadTs,
  taskKind = 'task',
  pageId = null,
  roundNumber = 1,
  designer = null,
  canAcceptResult = true,
  requestType = null,
  deadline = null,
}) {
  const resultUrl = normalizeUrl(finalProjectUrl)

  await updateRootTaskMessage(slackClient, {
    channelId: slackChannelId,
    messageTs: slackMessageTs,
    taskName,
    departmentKey,
    status,
    responsible,
    pageUrl,
    resultUrl,
    taskKind,
    pageId,
    roundNumber,
    designer,
    canAcceptResult,
    requestType,
    deadline,
  })

  if (!slackChannelId || !slackMessageTs) {
    await postTaskFieldMovement(slackClient, {
      channelId: slackChannelId,
      threadTs: slackThreadTs || slackMessageTs,
      taskName,
      status,
      pageUrl,
      resultUrl,
      taskKind,
      slackUserId,
    })
  }
}

export async function sendReviewRequest({
  slackClient,
  slackUserId,
  taskName,
  departmentKey = 'design',
  status,
  assignee,
  finalProjectUrl,
  pageUrl,
  pageId,
  slackChannelId,
  slackMessageTs,
  slackThreadTs,
  taskKind = 'task',
  roundNumber = 1,
  designer,
  canAcceptResult = true,
  requestType = null,
  deadline = null,
}) {
  const resultUrl = normalizeUrl(finalProjectUrl)

  await updateRootTaskMessage(slackClient, {
    channelId: slackChannelId,
    messageTs: slackMessageTs,
    taskName,
    departmentKey,
    status,
    responsible: assignee,
    pageUrl,
    resultUrl,
    taskKind,
    pageId,
    roundNumber,
    designer,
    canAcceptResult,
    requestType,
    deadline,
  })

  await postThreadReviewMovement(slackClient, {
    channelId: slackChannelId,
    threadTs: slackThreadTs || slackMessageTs,
    taskKind,
    slackUserId,
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
  departmentKey = 'design',
  status,
  responsible = null,
  pageUrl,
  resultUrl,
  taskKind = 'task',
  completedRounds = 0,
  pageId = null,
  roundNumber = 1,
  designer = null,
  statusNote = null,
  suppressStatusActions = false,
  canAcceptResult = true,
  requestType = null,
  deadline = null,
}) {
  if (!channelId || !messageTs) return

  const text = await buildRootTaskText(slackClient, {
    taskName,
    departmentKey,
    status,
    statusEmoji: getStatusEmoji(status),
    responsible,
    designer,
    taskKind,
    completedRounds,
    statusNote,
    requestType,
    deadline,
  })
  const actionElements = suppressStatusActions
    ? getPassiveActionElements({ pageUrl, resultUrl, status })
    : getStatusActionElements({
        newStatus: status,
        departmentKey,
        pageUrl,
        resultUrl,
        pageId,
        rootMessageTs: messageTs,
        taskName,
        roundNumber,
        designer,
        taskKind,
        canAcceptResult,
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

  const channels = await resolveMessageChannels(slackClient, channelId)
  let lastError

  for (const channel of channels) {
    try {
      await slackClient.chat.update({
        channel,
        ts: messageTs,
        text,
        blocks,
      })
      return
    } catch (error) {
      lastError = error

      if (!shouldTryNextChannel(error)) {
        break
      }

      console.warn(`Failed to update root Slack task message ${channel}/${messageTs}, trying next channel:`, error)
    }
  }

  if (lastError) {
    console.error(`Failed to update root Slack task message ${channelId}/${messageTs}:`, lastError)
  }
}

async function buildRootTaskText(slackClient, {
  taskName,
  departmentKey = 'design',
  status,
  statusEmoji,
  responsible = null,
  designer,
  taskKind,
  completedRounds = 0,
  statusNote = null,
  requestType = null,
  deadline = null,
}) {
  const isFeedback = taskKind === 'feedback'
  const feedbackDone = isFeedback && isDoneStatus(status)
  const feedbackReady = isFeedback && isReadyStatus(status)
  const taskReady = !isFeedback && isReadyStatus(status)
  const ready = feedbackReady || taskReady
  const normalizedCompletedRounds = normalizeNonNegativeInteger(completedRounds, 0)
  const isDesignDepartment = departmentKey === 'design'
  const isEventDepartment = departmentKey === 'event'
  const department = getDepartment(departmentKey)
  const supportsFeedbackRounds = isDesignDepartment
  const defaultResponsible = isEventDepartment && department?.ownerSlackId
    ? { name: department.ownerLabel || null, userId: department.ownerSlackId }
    : null
  const responsiblePerson = isDesignDepartment ? designer : (designer || responsible || defaultResponsible)
  const responsibleText = await formatDesignerForSlackAsync(slackClient, responsiblePerson, {
    fallback: isDesignDepartment ? undefined : 'не призначено',
  })
  const responsibleLabel = isDesignDepartment ? 'Дизайнер' : isEventDepartment ? 'Відповідальна' : 'Відповідальний'
  const responsibleIcon = isDesignDepartment ? '🎨' : isEventDepartment ? '👤' : '🎨'

  if (isEventDepartment && !isFeedback) {
    return [
      '🎪 *Твій запит прийнято!*',
      '',
      `*${taskName}*`,
      requestType ? `📋 Тип: ${requestType}` : null,
      deadline ? `📅 Дедлайн: ${formatDateUk(deadline)}` : null,
      `${statusEmoji} *Статус:* ${status}`,
      `${responsibleIcon} *${responsibleLabel}:* ${responsibleText}`,
      '',
      getRootTaskStatusText({
        status,
        departmentKey,
        isFeedback,
        feedbackDone,
        feedbackReady,
        taskReady,
        completedRounds: normalizedCompletedRounds,
        statusNote,
      }),
    ].filter((line) => line !== null).join('\n')
  }

  return [
    isFeedback ? null : 'Ми отримали твій запит!',
    `*${taskName}*`,
    `${statusEmoji} *Статус${isFeedback ? ' правки' : ''}:* ${status}`,
    ready ? null : `${responsibleIcon} *${responsibleLabel}:* ${responsibleText}`,
    taskReady && supportsFeedbackRounds ? `✏️ *Раундів правок:* ${normalizedCompletedRounds}` : null,
    '',
    getRootTaskStatusText({
      status,
      departmentKey,
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
  departmentKey = 'design',
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
    if (departmentKey !== 'design') {
      return 'Задача готова до наступного кроку. Слідкуй за цим тредом: статус оновиться після публікації або скасування.'
    }

    return completedRounds > 0
      ? 'Готово, результат прийнято після правок :white_check_mark:'
      : 'Готово, результат прийнято без правок :white_check_mark:'
  }

  if (isCommentsStatus(status)) {
    return 'Задача перебуває на етапі ревʼю або правок. Заглянь у задачу, щоб мати актуальний статус.'
  }

  if (isInProgressStatus(status)) {
    return departmentKey === 'design'
      ? 'Твоя задача вже в роботі у дизайнера. Коли вона буде готова до ревʼю, статус і кнопки оновляться тут.'
      : 'Твоя задача вже в роботі. Коли буде апдейт, статус оновиться тут.'
  }

  if (isToDoStatus(status)) {
    return isFeedback
      ? 'Правку передано дизайнеру.'
      : departmentKey === 'design'
        ? 'Задачу передано в дизайн-команду. Щойно дизайнер візьме її в роботу, ти побачиш оновлення в цьому треді.'
        : departmentKey === 'event'
          ? 'Заявку створено й передано далі. Я оновлюватиму статус у цьому повідомленні й окремо напишу, коли він зміниться.'
          : 'Задачу передано в SMM. Щойно відповідальний візьме її в роботу, ти побачиш оновлення в цьому треді.'
  }

  if (departmentKey === 'event' && isBacklogStatus(status)) {
    return 'Заявку створено й передано далі. Я оновлюватиму статус у цьому повідомленні й окремо напишу, коли він зміниться.'
  }

  return isFeedback
    ? 'Оновлення по правці зафіксовано. Слідкуй за цим тредом, щоб не пропустити наступний апдейт.'
    : 'Оновлення по задачі зафіксовано. Слідкуй за цим тредом, щоб не пропустити наступний апдейт.'
}

export async function sendQualitySurvey({
  slackClient,
  slackUserId,
  departmentKey = 'design',
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
    departmentKey,
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
          action_id: buildQualityRatingActionId(rating),
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
  departmentKey = 'design',
  taskName,
  commentAuthor,
  commentText,
  pageUrl,
  slackChannelId,
  slackThreadTs,
}) {
  if (!slackChannelId && !slackUserId) return

  const preview = formatCommentPreview(commentText)
  const department = getDepartment(departmentKey)
  const botLabel = department.key === 'event'
    ? 'Event Bot'
    : department.key === 'smm'
      ? 'SMM Bot'
      : 'Design Bot'
  const message = {
    text: `💬 Новий коментар у задачі ${taskName}.`,
    blocks: [
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*${botLabel}*`,
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
            `💬 *Новий коментар у задачі ${taskName}*`,
            `💬 *Відповідь від ${commentAuthor || 'невідомий автор'}:*`,
            preview,
            'Можеш відповісти тут або перейти в Notion.',
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
  }

  try {
    await postNotification(slackClient, slackUserId, message, {
      channelId: slackChannelId,
      threadTs: slackThreadTs,
    })
  } catch (error) {
    if (!slackUserId || !slackThreadTs || !shouldPostUnthreadedDmFallback(error)) {
      throw error
    }

    console.warn(
      `Failed to post threaded comment update ${slackChannelId || slackUserId}/${slackThreadTs}; ` +
        'posting unthreaded DM fallback:',
      error
    )
    await postNotification(slackClient, slackUserId, message, {
      channelId: slackUserId,
    })
  }
}

async function postThreadStatusMovement(slackClient, {
  channelId,
  threadTs,
  oldStatus,
  newStatus,
  taskKind = 'task',
  slackUserId = null,
}) {
  if (!channelId && !slackUserId) return

  const isFeedback = taskKind === 'feedback'
  const label = isFeedback ? 'Статус правки' : 'Статус'
  const mention = formatUserMention(slackUserId)
  const text = [
    `${mention ? `${mention} ` : ''}${isFeedback ? '*Є рух по правці* 🔄' : '*Є рух по задачі* 🔄'}`,
    oldStatus
      ? `*${label}:* ${escapeMrkdwn(oldStatus)} → ${escapeMrkdwn(newStatus)}`
      : `*${label}:* ${escapeMrkdwn(newStatus)}`,
  ].join('\n')

  try {
    await postNotification(slackClient, slackUserId, {
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
    }, {
      channelId,
      threadTs,
    })
  } catch (error) {
    console.error(`Failed to post short status movement ${channelId || slackUserId}/${threadTs || 'dm'}:`, error)
    throw error
  }
}

async function postThreadReviewMovement(slackClient, {
  channelId,
  threadTs,
  taskKind = 'task',
  slackUserId = null,
}) {
  if (!channelId && !slackUserId) return

  const mention = formatUserMention(slackUserId)
  const text = [
    `${mention ? `${mention} ` : ''}${taskKind === 'feedback' ? '*Є рух по правці* 🔄' : '*Є рух по задачі* 🔄'}`,
    taskKind === 'feedback'
      ? 'Результат правки оновлено для ревʼю.'
      : 'Результат оновлено для ревʼю.',
  ].join('\n')

  try {
    await postNotification(slackClient, slackUserId, {
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
    }, {
      channelId,
      threadTs,
    })
  } catch (error) {
    console.error(`Failed to post short review movement ${channelId || slackUserId}/${threadTs || 'dm'}:`, error)
    throw error
  }
}

async function postTaskFieldMovement(slackClient, {
  channelId,
  threadTs,
  taskName,
  status,
  pageUrl,
  resultUrl,
  taskKind = 'task',
  slackUserId = null,
}) {
  if (!channelId && !slackUserId) return

  const mention = formatUserMention(slackUserId)
  const isFeedback = taskKind === 'feedback'
  const lines = [
    `${mention ? `${mention} ` : ''}${isFeedback ? '*Є оновлення по правці* 🔄' : '*Є оновлення по задачі* 🔄'}`,
    taskName ? `*${escapeMrkdwn(taskName)}*` : null,
    status ? `*Статус:* ${escapeMrkdwn(status)}` : null,
    resultUrl ? `*Результат:* <${resultUrl}|відкрити>` : null,
    pageUrl ? `*Notion:* <${pageUrl}|відкрити>` : null,
  ].filter(Boolean)
  const text = lines.join('\n')

  try {
    await postNotification(slackClient, slackUserId, {
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
    }, {
      channelId,
      threadTs,
    })
  } catch (error) {
    console.error(`Failed to post task field movement ${channelId || slackUserId}/${threadTs || 'dm'}:`, error)
    throw error
  }
}

export async function postNotification(slackClient, slackUserId, message, { channelId, threadTs } = {}) {
  const channels = await resolveNotificationChannels(slackClient, slackUserId, { channelId, threadTs })
  let lastError

  for (const channel of channels) {
    try {
      return await slackClient.chat.postMessage({
        ...message,
        channel,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      })
    } catch (error) {
      lastError = error

      if (!shouldTryNextChannel(error)) {
        throw error
      }

      console.warn(`Failed to post notification to ${channel}${threadTs ? ` in thread ${threadTs}` : ''}, trying next channel:`, error)
    }
  }

  if (lastError) throw lastError

  throw new Error(
    threadTs
      ? `No Slack channel available for threaded notification ${threadTs}.`
      : 'No Slack channel available for notification.'
  )
}

async function resolveMessageChannels(slackClient, channelId) {
  const normalizedChannelId = normalizeSlackId(channelId)
  if (!normalizedChannelId) return []

  const channels = []

  if (isSlackUserId(normalizedChannelId)) {
    const dmChannelId = await openDmChannel(slackClient, normalizedChannelId)
    if (dmChannelId) channels.push(dmChannelId)
  }

  channels.push(normalizedChannelId)

  return uniqueChannels(channels)
}

async function resolveNotificationChannels(slackClient, slackUserId, { channelId, threadTs } = {}) {
  const normalizedChannelId = normalizeSlackId(channelId)
  const normalizedSlackUserId = normalizeSlackId(slackUserId)
  const channelIsUserId = isSlackUserId(normalizedChannelId)
  const userIdForDm = normalizedSlackUserId || (channelIsUserId ? normalizedChannelId : null)
  const channels = []

  if (normalizedChannelId && !channelIsUserId) {
    channels.push(normalizedChannelId)
  }

  if (userIdForDm && (channelIsUserId || !normalizedChannelId || !threadTs)) {
    const dmChannelId = await openDmChannel(slackClient, userIdForDm)
    if (dmChannelId) channels.push(dmChannelId)
  }

  if (!threadTs && normalizedChannelId && channelIsUserId) {
    channels.push(normalizedChannelId)
  }

  if (!threadTs && normalizedSlackUserId) {
    channels.push(normalizedSlackUserId)
  }

  return uniqueChannels(channels)
}

async function openDmChannel(slackClient, slackUserId) {
  const normalizedSlackUserId = normalizeSlackId(slackUserId)
  if (!normalizedSlackUserId) return null

  try {
    const response = await slackClient.conversations.open({
      users: normalizedSlackUserId,
    })
    const channelId = response.channel?.id
    return channelId || null
  } catch (error) {
    console.warn(`Failed to open DM channel for ${normalizedSlackUserId}:`, error)
    return null
  }
}

function normalizeSlackId(value) {
  return String(value || '').trim()
}

function isSlackUserId(value) {
  return /^[UW][A-Z0-9]+$/.test(normalizeSlackId(value))
}

function uniqueChannels(channels) {
  return [...new Set(channels.map(normalizeSlackId).filter(Boolean))]
}

function shouldTryNextChannel(error) {
  const slackError = error?.data?.error || error?.message
  return ['channel_not_found', 'not_in_channel', 'is_archived'].includes(slackError)
}

function shouldPostUnthreadedDmFallback(error) {
  const slackError = error?.data?.error || error?.message
  return [
    'channel_not_found',
    'not_in_channel',
    'is_archived',
    'thread_not_found',
  ].includes(slackError)
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
  departmentKey = 'design',
  pageUrl,
  resultUrl,
  pageId,
  rootMessageTs,
  taskName,
  roundNumber,
  designer,
  taskKind,
  canAcceptResult,
}) {
  if (isCommentsStatus(newStatus) && taskKind === 'feedback') {
    const elements = []

    if (pageId && canAcceptResult) {
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: '✅ Прийняти правку' },
        action_id: ACTION_IDS.acceptTaskResult,
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

    if (pageUrl) {
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: '📋 Відкрити правку' },
        url: pageUrl,
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
    if (departmentKey !== 'design') {
      return getPassiveActionElements({ pageUrl, resultUrl, status: newStatus })
    }

    const elements = []
    const completedRounds = Math.max(normalizePositiveInteger(roundNumber, 1) - 1, 0)

    if (pageId && canAcceptResult) {
      elements.push({
        type: 'button',
        text: {
          type: 'plain_text',
          text: completedRounds > 0
            ? '✅ Приймаю, більше правок немає'
            : '✅ Приймаю, правок немає',
        },
        action_id: ACTION_IDS.acceptTaskResult,
        style: 'primary',
        value: buildAcceptActionValue({
          pageId,
          taskName,
          departmentKey,
          designer,
          requestUrl: pageUrl,
          resultUrl,
          rootMessageTs,
          taskKind,
          roundNumber,
        }),
      })
    }

    if (pageId) {
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: '✏️ Дати правки' },
        action_id: ACTION_IDS.openFeedbackModal,
        style: 'primary',
        value: buildFeedbackActionValue({ pageId, taskName, roundNumber }),
      })
    }

    if (pageUrl) {
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: '📋 Відкрити задачу' },
        url: pageUrl,
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
  departmentKey = 'design',
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
    departmentKey,
    designerName: designer?.name || null,
    designerUserId: designer?.userId || null,
    designerEmail: designer?.email || null,
    requestUrl: requestUrl || null,
    resultUrl: resultUrl || null,
    rootMessageTs: rootMessageTs || null,
    taskKind: taskKind || 'task',
    completedRounds: Math.max(normalizePositiveInteger(roundNumber, 1) - 1, 0),
  })
}

function buildFeedbackActionValue({ pageId, taskName, roundNumber }) {
  const normalizedRoundNumber = normalizePositiveInteger(roundNumber, 1)

  return JSON.stringify({
    pageId,
    taskName: clampActionValueText(taskName || 'Без назви', 200),
    roundNumber: normalizedRoundNumber,
  })
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function clampActionValueText(value, maxLength) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized
}

function formatUserMention(slackUserId) {
  const normalized = String(slackUserId || '').trim()
  return /^[UW][A-Z0-9]+$/.test(normalized) ? `<@${normalized}>` : ''
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

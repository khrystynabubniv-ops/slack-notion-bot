import { createNotionPage } from '../notion/createPage.js'
import {
  DEFAULT_DEPARTMENT_KEY,
  applyTestTaskPrefix,
  getDepartment,
  getDepartmentTaskFields,
  getDepartmentTaskType,
  getTaskTypeComplexityOptions,
  resolveTaskTypeComplexity,
  resolveDepartmentKey,
} from '../config/departments.js'
import {
  completeTaskSubmission,
  enqueueTaskSubmission,
  getDueTaskSubmission,
  recoverOrphanedTaskSubmissions,
  requeueTaskSubmission,
  saveFailedSubmission,
  saveTask,
} from '../redis/store.js'
import { formatDesignerForSlack } from '../slack/designerMentions.js'
import {
  buildDesignDomainPickerView,
  buildTaskComplexityPickerView,
  buildTaskTypePickerView,
} from '../slack/taskEntry.js'
import { getModalBlocks } from './modalBlocks.js'

const QUEUE_WORKER_INTERVAL_MS = Number.parseInt(
  process.env.TASK_SUBMISSION_QUEUE_INTERVAL_MS || '5000',
  10
)
const QUEUE_MAX_ATTEMPTS = Number.parseInt(
  process.env.TASK_SUBMISSION_QUEUE_MAX_ATTEMPTS || '20',
  10
)
const QUEUE_BASE_RETRY_DELAY_MS = Number.parseInt(
  process.env.TASK_SUBMISSION_QUEUE_RETRY_DELAY_MS || `${60 * 1000}`,
  10
)
const QUEUE_MAX_RETRY_DELAY_MS = Number.parseInt(
  process.env.TASK_SUBMISSION_QUEUE_MAX_RETRY_DELAY_MS || `${10 * 60 * 1000}`,
  10
)

let queueWorkerStarted = false
let queueWorkerProcessing = false
const queueWorkerActiveItemIds = new Set()

function parseJsonBody(body) {
  if (!body || typeof body !== 'string') return null

  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

function serializeTaskCreationError(error) {
  const parsedBody = parseJsonBody(error?.body)

  return {
    message: error?.message || String(error),
    code: error?.code || null,
    status: error?.status || error?.statusCode || null,
    notionError: parsedBody?.message || error?.body?.message || error?.data?.error || null,
  }
}

function buildFailedSubmissionPayload({
  departmentKey = DEFAULT_DEPARTMENT_KEY,
  userId,
  userName,
  slackPersonName,
  taskType,
  taskTypeLabel,
  name,
  priority,
  deadline,
  context,
  style,
  antiref,
  canEditText,
  videoFormat,
  platform,
  platformOther,
  specificFields,
  fieldAnswers,
  artifacts,
  isLate,
  values,
  error,
}) {
  return {
    slackUserId: userId,
    slackUserName: userName || null,
    requesterName: slackPersonName || userName || null,
    task: {
      departmentKey,
      name: name || taskTypeLabel,
      taskType,
      taskTypeLabel,
      priority: priority || null,
      deadline: deadline || null,
      videoFormat: videoFormat || null,
      platform: platform || null,
      platformOther: platformOther || null,
      isLate: Boolean(isLate),
    },
    answers: {
      context: context || null,
      style: style || null,
      antiref: antiref || null,
      canEditText: canEditText || null,
      specificFields,
      fieldAnswers,
      artifacts,
    },
    rawSlackValues: values,
    error: serializeTaskCreationError(error),
  }
}

function isRetriableTaskCreationError(error) {
  const status = error?.status || error?.statusCode

  return error?.code === 'rate_limited' || status === 429 || status >= 500
}

function getHeader(headers, headerName) {
  if (!headers) return null
  if (typeof headers.get === 'function') return headers.get(headerName)

  const normalizedHeaderName = headerName.toLowerCase()
  return Object.entries(headers)
    .find(([key]) => key.toLowerCase() === normalizedHeaderName)
    ?.[1]
}

function getTaskCreationRetryDelayMs(error, attempts) {
  const retryAfter = getHeader(error?.headers, 'retry-after')
  const retryAfterSeconds = Number.parseFloat(Array.isArray(retryAfter) ? retryAfter[0] : retryAfter)

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(Math.ceil(retryAfterSeconds * 1000) + 30 * 1000, QUEUE_MAX_RETRY_DELAY_MS)
  }

  return Math.min(QUEUE_BASE_RETRY_DELAY_MS * 2 ** Math.min(attempts, 4), QUEUE_MAX_RETRY_DELAY_MS)
}

function shouldNotifyQueueDelay(attempts) {
  return attempts === 1 || attempts % 5 === 0
}

function formatQueueRetryTime(delayMs) {
  return new Date(Date.now() + delayMs).toLocaleTimeString('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Kiev',
  })
}

function formatDateUk(dateString) {
  if (!dateString) return 'не вказано'

  const [year, month, day] = String(dateString).split('-')
  return year && month && day ? `${day}.${month}.${year}` : dateString
}

function formatEventOwner(department) {
  if (department?.ownerSlackId) return `<@${department.ownerSlackId}>`
  if (department?.ownerLabel) return department.ownerLabel

  return 'не призначено'
}

function buildEventDeadlineWarning({ deadline, taskConfig, isLate, leadTimeWarning }) {
  const minLeadDays = leadTimeWarning?.minLeadDays || taskConfig?.minLeadDays
  if (!isLate || !deadline || !minLeadDays) return null

  const daysUntil = Number.isFinite(leadTimeWarning?.providedLeadDays)
    ? leadTimeWarning.providedLeadDays
    : getDaysUntil(deadline)
  const submittedTiming = daysUntil < 0
    ? `дедлайн уже минув на ${formatDaysUk(daysUntil)}`
    : `твій запит подано за ${formatDaysUk(daysUntil)} до дедлайну`

  return (
    '⚠️ Зверни увагу: за внутрішньою політикою мінімальний термін ' +
    `для цього типу задачі - ${formatDaysUk(minLeadDays)}. ${submittedTiming}.\n` +
    'Запит переглянуть окремо, а апдейт прийде в це повідомлення.'
  )
}

function buildEventTaskThreadText({
  taskName,
  department,
  status,
  taskTypeLabel,
  deadline,
  taskConfig,
  isLate,
  leadTimeWarning,
}) {
  const warning = buildEventDeadlineWarning({ deadline, taskConfig, isLate, leadTimeWarning })

  return [
    '🎪 *Твій запит прийнято!*',
    '',
    `*${taskName}*`,
    `📋 Тип: ${taskTypeLabel || taskConfig?.label || 'не вказано'}`,
    `📅 Дедлайн: ${formatDateUk(deadline)}`,
    `🔄 Статус: *${status || 'Backlog'}*`,
    `👤 Відповідальна: ${formatEventOwner(department)}`,
    warning ? '' : null,
    warning,
    '',
    'Заявку створено й передано далі. Я оновлюватиму статус у цьому повідомленні й окремо напишу, коли він зміниться.',
  ].filter((line) => line !== null).join('\n')
}

function buildTaskThreadText({
  taskName,
  department,
  status = 'To do',
  responsible = null,
  taskTypeLabel = null,
  deadline = null,
  taskConfig = null,
  isLate = false,
  leadTimeWarning = null,
}) {
  if (department?.key === 'event') {
    return buildEventTaskThreadText({
      taskName,
      department,
      status,
      taskTypeLabel,
      deadline,
      taskConfig,
      isLate,
      leadTimeWarning,
    })
  }

  const defaultResponsible = department?.ownerLabel ? { name: department.ownerLabel } : null
  const responsibleText = formatDesignerForSlack(responsible || defaultResponsible)
  const responsibleLabel = department?.key === DEFAULT_DEPARTMENT_KEY ? 'Дизайнер' : 'Відповідальний'

  return [
    'Ми отримали твій запит!',
    `*${taskName}*`,
    `⚪ *Статус:* ${status}`,
    `🎨 *${responsibleLabel}:* ${responsibleText}`,
    '',
    department?.key === DEFAULT_DEPARTMENT_KEY
      ? 'Задачу передано в дизайн-команду. Щойно дизайнер візьме її в роботу, ти побачиш оновлення в цьому треді.'
      : `Задачу передано в ${department?.label || 'команду'}. Щойно відповідальний візьме її в роботу, ти побачиш оновлення в цьому треді.`,
  ].join('\n')
}

function getFieldAnswerValue(fieldAnswers = [], key) {
  return fieldAnswers.find((field) => field.key === key)?.formattedValue || null
}

function buildSubmittedTaskName({
  department,
  taskConfig,
  name,
  taskTypeLabel,
  fieldAnswers,
}) {
  const primaryName = String(name || taskTypeLabel || 'Новий запит').trim()

  if (department?.key !== 'event' || !taskConfig?.shortTitle) {
    return primaryName
  }

  const secondaryName = taskConfig.secondaryTitleFieldKey
    ? getFieldAnswerValue(fieldAnswers, taskConfig.secondaryTitleFieldKey)
    : null

  return secondaryName
    ? `[${taskConfig.shortTitle}] ${primaryName} / ${secondaryName}`
    : `[${taskConfig.shortTitle}] ${primaryName}`
}

async function resolveSlackPerson(client, { userId, userName }) {
  try {
    const userInfo = await client.users.info({ user: userId })

    return {
      name: getSlackUserDisplayName(userInfo.user, userName || userId),
      email: normalizeEmail(userInfo.user?.profile?.email),
    }
  } catch (slackUserErr) {
    const reason = slackUserErr?.data?.error
    if (reason === 'missing_scope') {
      console.error(
        'Slack users.info missing_scope — users:read.email is likely not authorized/reinstalled yet, Slack Person matching will fail:',
        slackUserErr
      )
    } else {
      console.error('Slack users.info failed, fallback to body.user.name:', slackUserErr)
    }
    return {
      name: userName || userId,
      email: null,
    }
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase() || null
}

function getSlackUserDisplayName(user, fallback) {
  const profile = user?.profile

  return (
    profile?.real_name ||
    profile?.display_name ||
    user?.real_name ||
    user?.name ||
    fallback
  )
}

async function resolveSelectedSlackUserName(client, slackUserId) {
  if (!slackUserId) return null

  try {
    const userInfo = await client.users.info({ user: slackUserId })
    return getSlackUserDisplayName(userInfo.user, slackUserId)
  } catch (slackUserErr) {
    console.error(`Slack users.info failed for selected user ${slackUserId}:`, slackUserErr)
    return slackUserId
  }
}

function parsePrivateMetadata(privateMetadata) {
  if (!privateMetadata) return {}

  try {
    return JSON.parse(privateMetadata)
  } catch {
    return {}
  }
}

function logModalStepError(step, error, details = {}) {
  console.error(`${step} modal step failed: ${JSON.stringify({
    ...details,
    error: error?.message || String(error),
  })}`)
}

function extractElementValue(element) {
  if (!element) return null
  if (element.value) return element.value
  if (element.selected_date) return element.selected_date
  if (element.selected_time) return element.selected_time
  if (element.selected_user) return element.selected_user
  if (element.selected_option?.value) return element.selected_option.value
  if (Array.isArray(element.selected_options)) {
    return element.selected_options.map((option) => option.value).filter(Boolean)
  }

  return null
}

function formatFieldValue(value, field) {
  if (field?.type === 'checkbox') return value ? 'Так' : 'Ні'
  if (Array.isArray(value)) return value.join(', ')
  if (field?.type === 'slack_user' && value) return `<@${value}>`
  return value || null
}

async function formatDynamicFieldValue(client, value, field) {
  if (field?.type === 'slack_user') {
    return await resolveSelectedSlackUserName(client, value)
  }

  return formatFieldValue(value, field)
}

function getFieldElement(values, fieldKey) {
  return values?.[`${fieldKey}_block`]?.[fieldKey] || null
}

function extractDynamicFieldValue(values, field) {
  if (field.type === 'time_range') {
    const startTime = extractElementValue(getFieldElement(values, `${field.key}_from`))
    const endTime = extractElementValue(getFieldElement(values, `${field.key}_to`))

    return startTime && endTime ? `${startTime} - ${endTime}` : null
  }

  if (field.type === 'checkbox') {
    return extractElementValue(getFieldElement(values, field.key))?.length > 0
  }

  return extractElementValue(getFieldElement(values, field.key))
}

async function extractDynamicSubmissionFields({ client, departmentKey, taskType, values }) {
  const fields = getDepartmentTaskFields(departmentKey, taskType)
  const fieldAnswers = []
  const specificFields = {}
  let deadline = null
  let context = null
  let platforms = []

  for (const field of fields) {
    const rawValue = extractDynamicFieldValue(values, field)
    if (field.type === 'checkbox' && field.optional && rawValue === false) continue

    const formattedValue = await formatDynamicFieldValue(client, rawValue, field)
    if (!formattedValue) continue

    fieldAnswers.push({
      key: field.key,
      label: field.label.replace(/\s+\*$/, ''),
      type: field.type,
      value: rawValue,
      formattedValue,
      notionProperties: field.notionProperties || [],
      role: field.role || null,
      section: field.section || 'specific',
    })

    specificFields[field.label.replace(/\s+\*$/, '')] = formattedValue

    if (field.role === 'deadline') deadline = rawValue
    if (field.role === 'context') context = formattedValue
    if (field.role === 'platforms') platforms = Array.isArray(rawValue) ? rawValue : [rawValue].filter(Boolean)
  }

  return {
    deadline,
    context,
    platforms,
    platform: platforms[0] || null,
    specificFields,
    fieldAnswers,
  }
}

function getLeadTimeOverride(values) {
  return values.lead_time_override_block?.lead_time_override?.selected_option?.value || null
}

function getDaysUntil(dateString) {
  if (!dateString) return null

  const target = new Date(`${dateString}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return Math.ceil((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
}

function formatDaysUk(days) {
  const normalizedDays = Number.isFinite(days) ? days : 0
  const absoluteDays = Math.abs(normalizedDays)
  const lastTwoDigits = absoluteDays % 100
  const lastDigit = absoluteDays % 10
  const suffix = lastTwoDigits >= 11 && lastTwoDigits <= 14
    ? 'днів'
    : lastDigit === 1
      ? 'день'
      : [2, 3, 4].includes(lastDigit)
        ? 'дні'
        : 'днів'

  return `${normalizedDays} ${suffix}`
}

function getLeadTimeText(leadTimeViolation) {
  return leadTimeViolation.taskConfig?.minLeadLabel || formatDaysUk(leadTimeViolation.minLeadDays)
}

function getConfiguredLeadTime(taskConfig, values) {
  const defaultLeadTime = {
    minLeadDays: taskConfig?.minLeadDays || 0,
    minLeadLabel: taskConfig?.minLeadLabel || null,
    recommendedLeadLabel: taskConfig?.recommendedLeadLabel || null,
  }

  if (!taskConfig?.leadTimeFieldKey || !taskConfig?.minLeadDaysByValue) {
    return defaultLeadTime
  }

  const leadTimeValue = extractElementValue(getFieldElement(values, taskConfig.leadTimeFieldKey))
  const leadTimeConfig = taskConfig.minLeadDaysByValue[leadTimeValue]
  if (!leadTimeConfig) return defaultLeadTime

  if (typeof leadTimeConfig === 'number') {
    return {
      minLeadDays: leadTimeConfig,
      minLeadLabel: null,
      recommendedLeadLabel: null,
    }
  }

  return {
    minLeadDays: leadTimeConfig.minLeadDays || 0,
    minLeadLabel: leadTimeConfig.minLeadLabel || null,
    recommendedLeadLabel: leadTimeConfig.recommendedLeadLabel || null,
  }
}

function getLeadTimeViolation({ departmentKey, taskType, deadline, values }) {
  const taskConfig = getDepartmentTaskType(departmentKey, taskType)
  const {
    minLeadDays,
    minLeadLabel,
    recommendedLeadLabel,
  } = getConfiguredLeadTime(taskConfig, values)
  if (!minLeadDays || !deadline) return null

  const providedLeadDays = getDaysUntil(deadline)
  if (providedLeadDays === null || providedLeadDays >= minLeadDays) return null

  return {
    taskConfig,
    minLeadDays,
    minLeadLabel,
    recommendedLeadLabel,
    providedLeadDays,
    override: getLeadTimeOverride(values),
  }
}

async function createTaskFromSubmissionPayload(client, payload) {
  const {
    departmentKey: rawDepartmentKey = DEFAULT_DEPARTMENT_KEY,
    userId,
    userName,
    taskType,
    taskTypeLabel,
    name,
    priority,
    deadline,
    context,
    style,
    antiref,
    canEditText,
    videoFormat,
    platform,
    platforms,
    platformOther,
    specificFields,
    fieldAnswers,
    artifacts,
    isLate,
    leadTimeWarning,
    domain,
  } = payload
  const departmentKey = resolveDepartmentKey(rawDepartmentKey)
  const department = getDepartment(departmentKey)
  const taskConfig = getDepartmentTaskType(departmentKey, taskType)
  const slackPerson = await resolveSlackPerson(client, { userId, userName })
  let notificationTrackingEnabled = true
  const taskName = applyTestTaskPrefix(buildSubmittedTaskName({
    department,
    taskConfig,
    name,
    taskTypeLabel,
    fieldAnswers,
  }))

  const { pageId, pageUrl } = await createNotionPage({
    departmentKey,
    name: taskName,
    priority,
    deadline,
    videoFormat,
    platform,
    platforms,
    platformOther,
    taskType,
    context,
    style,
    antiref,
    canEditText,
    specificFields,
    fieldAnswers,
    artifacts,
    isLate,
    domain,
    slackPersonName: slackPerson.name,
    slackPersonEmail: slackPerson.email,
  })

  const requesterNotificationText = buildTaskThreadText({
    taskName,
    department,
    status: department.initialStatus,
    taskTypeLabel,
    deadline,
    taskConfig,
    isLate,
    leadTimeWarning,
  })
  let requesterMessage = null

  try {
    requesterMessage = await client.chat.postMessage({
      channel: userId,
      text: requesterNotificationText,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: requesterNotificationText,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: departmentKey === 'event' ? 'Відкрити в Notion' : '📋 Відкрити в Notion / додати файли',
              },
              url: pageUrl,
              style: 'primary',
            },
          ],
        },
      ],
    })
  } catch (error) {
    console.error(`Failed to send requester task-created notification to ${userId}:`, error)
  }

  try {
    await saveTask({
      pageId,
      slackUserId: userId,
      slackChannelId: requesterMessage?.channel || userId,
      slackMessageTs: requesterMessage?.ts || null,
      slackThreadTs: requesterMessage?.ts || null,
      taskName,
      requesterName: slackPerson.name,
      pageUrl,
      departmentKey,
      team: department.team,
      hub: department.label,
      requestType: taskTypeLabel,
      lastStatus: department.initialStatus,
    })
  } catch (redisErr) {
    notificationTrackingEnabled = false
    console.error('Redis saveTask failed; status/comment notifications will not be tracked:', redisErr)
  }

  if (!notificationTrackingEnabled) {
    try {
      await client.chat.postMessage({
        channel: userId,
        text: `⚠️ *${taskName}* створено, але автоапдейти по статусу зараз не підключилися.`,
      })
    } catch (error) {
      console.error(`Failed to notify ${userId} about disabled tracking for page ${pageId}:`, error)
    }
  }

  if (!department.notifyChannel) {
    console.warn(`${department.key} notify channel is not set; skipping department task notification.`)
  } else {
    try {
      await client.chat.postMessage({
        channel: department.notifyChannel,
        text: department.key === DEFAULT_DEPARTMENT_KEY
          ? `Нова задача від <@${userId}>: ${taskName}`
          : `Нова задача ${department.label} від <@${userId}>: ${taskName}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: department.key === DEFAULT_DEPARTMENT_KEY
                ? `🆕 *Нова задача від <@${userId}>*`
                : `🆕 *Нова задача ${department.label} від <@${userId}>*`,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Задача:*\n${taskName}` },
              { type: 'mrkdwn', text: `*Тип:*\n${taskTypeLabel}` },
              { type: 'mrkdwn', text: `*Пріоритет:*\n${priority || 'не вказано'}` },
              { type: 'mrkdwn', text: `*Дедлайн:*\n${deadline || 'не вказано'}` },
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
    } catch (error) {
      console.error(`Failed to send ${department.key} task notification for page ${pageId}:`, error)
    }
  }

  return { pageId, pageUrl }
}

async function failQueuedSubmission(client, payload, error) {
  const failedSubmissionPayload = buildFailedSubmissionPayload({
    ...payload,
    slackPersonName: payload.slackPersonName || payload.userName,
    error,
  })
  const failedDraft = await saveFailedSubmission(failedSubmissionPayload)

  try {
    await client.chat.postMessage({
      channel: payload.userId,
      text:
        `❌ Не вдалося створити задачу в Notion після повторних спроб.\n` +
        `Бриф збережено як чернетку: \`${failedDraft.draftId}\`. Напиши адміну цей код, і ми відновимо задачу без повторного заповнення.`,
    })
  } catch (slackErr) {
    console.error(`Failed to notify ${payload.userId} about failed queued submission:`, slackErr)
  }

  console.error(
    `Task submission draft saved after queued create failure: ${failedDraft.key}`,
    failedSubmissionPayload.error
  )
}

async function notifyQueuedSubmissionDelayed(client, item, { delayMs, attempts, error }) {
  if (!shouldNotifyQueueDelay(attempts)) return

  const retryTime = formatQueueRetryTime(delayMs)
  const taskName = item.payload.name || item.payload.taskTypeLabel
  const reason = error?.code === 'rate_limited'
    ? 'Notion зараз лімітує запити'
    : 'Notion тимчасово не відповів'

  try {
    await client.chat.postMessage({
      channel: item.payload.userId,
      text:
        `⏳ *${taskName}* ще в черзі.\n` +
        `${reason}. Наступна спроба приблизно о ${retryTime}. Я напишу сюди, коли задача буде створена.`,
    })
  } catch (slackErr) {
    console.error(`Failed to notify ${item.payload.userId} about delayed queued submission:`, slackErr)
  }
}

async function processQueuedTaskSubmissions(client) {
  if (queueWorkerProcessing) return
  queueWorkerProcessing = true

  try {
    const recoveredCount = await recoverOrphanedTaskSubmissions({
      excludeIds: [...queueWorkerActiveItemIds],
    })
    if (recoveredCount > 0) {
      console.warn(`Recovered ${recoveredCount} orphaned task submission queue item(s).`)
    }

    while (true) {
      const item = await getDueTaskSubmission()
      if (!item) break

      queueWorkerActiveItemIds.add(item.id)
      try {
        await createTaskFromSubmissionPayload(client, item.payload)
        await completeTaskSubmission(item.id)
        console.log(`Queued task submission completed: ${item.id}`)
      } catch (error) {
        const attempts = item.attempts || 0

        if (isRetriableTaskCreationError(error) && attempts < QUEUE_MAX_ATTEMPTS) {
          const delayMs = getTaskCreationRetryDelayMs(error, attempts)
          const errorSummary = serializeTaskCreationError(error)
          const requeuedItem = await requeueTaskSubmission(item, { delayMs, error: errorSummary })
          console.warn(
            `Queued task submission ${item.id} delayed for ${delayMs}ms ` +
              `(attempt ${attempts + 1}/${QUEUE_MAX_ATTEMPTS}):`,
            errorSummary
          )
          await notifyQueuedSubmissionDelayed(client, requeuedItem, {
            delayMs,
            attempts: requeuedItem.attempts,
            error: errorSummary,
          })
          continue
        }

        await failQueuedSubmission(client, item.payload, error)
        await completeTaskSubmission(item.id)
      } finally {
        queueWorkerActiveItemIds.delete(item.id)
      }
    }
  } catch (error) {
    console.error('Task submission queue worker failed:', error)
  } finally {
    queueWorkerProcessing = false
  }
}

function startTaskSubmissionQueueWorker(client) {
  if (queueWorkerStarted) return
  queueWorkerStarted = true

  const intervalMs =
    Number.isFinite(QUEUE_WORKER_INTERVAL_MS) && QUEUE_WORKER_INTERVAL_MS > 0
      ? QUEUE_WORKER_INTERVAL_MS
      : 5000

  console.log(`Task submission queue worker started — every ${intervalMs}ms`)
  setTimeout(() => processQueuedTaskSubmissions(client), 1000)
  setInterval(() => processQueuedTaskSubmissions(client), intervalMs)
}

export function registerSubmissionHandlers(app) {
  startTaskSubmissionQueueWorker(app.client)

  function buildTaskModalView({
    departmentKey = DEFAULT_DEPARTMENT_KEY,
    taskType,
    taskTypeLabel,
    domain = null,
    values = {},
    leadTimeWarning = false,
  }) {
    const department = getDepartment(departmentKey)

    return {
      type: 'modal',
      callback_id: 'submit_task',
      private_metadata: JSON.stringify({ departmentKey: department.key, taskType, taskTypeLabel, domain }),
      title: { type: 'plain_text', text: '📋 Бриф задачі' },
      submit: { type: 'plain_text', text: 'Створити задачу' },
      close: { type: 'plain_text', text: 'Скасувати' },
      blocks: getModalBlocks(taskType, values, {
        departmentKey: department.key,
        leadTimeWarning,
      }),
    }
  }

  app.view('select_department', async ({ ack, view }) => {
    try {
      const selectedDepartment = view.state.values.department_block?.department?.selected_option
      if (!selectedDepartment?.value) {
        await ack({
          response_action: 'errors',
          errors: {
            department_block: 'Обери команду.',
          },
        })
        return
      }

      const departmentKey = resolveDepartmentKey(selectedDepartment.value)

      await ack({
        response_action: 'update',
        view: departmentKey === DEFAULT_DEPARTMENT_KEY
          ? buildDesignDomainPickerView({ departmentKey })
          : buildTaskTypePickerView(departmentKey),
      })
    } catch (error) {
      logModalStepError('select_department', error, {
        viewId: view?.id || null,
        callbackId: view?.callback_id || null,
      })

      await ack({
        response_action: 'errors',
        errors: {
          department_block: 'Не вдалося перейти далі. Спробуй ще раз або напиши адміну.',
        },
      })
    }
  })

  // Крок 1.5 (тільки Design) — юзер обрав напрямок, з якого прийшов запит
  app.view('select_design_domain', async ({ ack, view }) => {
    try {
      const metadata = parsePrivateMetadata(view.private_metadata)
      const departmentKey = resolveDepartmentKey(metadata.departmentKey)
      const selectedDomain = view.state.values.domain_block?.domain?.selected_option
      if (!selectedDomain?.value) {
        await ack({
          response_action: 'errors',
          errors: {
            domain_block: 'Обери напрямок.',
          },
        })
        return
      }

      await ack({
        response_action: 'update',
        view: buildTaskTypePickerView(departmentKey, { domain: selectedDomain.value }),
      })
    } catch (error) {
      logModalStepError('select_design_domain', error, {
        viewId: view?.id || null,
        callbackId: view?.callback_id || null,
      })

      await ack({
        response_action: 'errors',
        errors: {
          domain_block: 'Не вдалося перейти далі. Спробуй ще раз або напиши адміну.',
        },
      })
    }
  })

  // Крок 1 — юзер вибрав тип задачі, відкриваємо форму з полями
  app.view('select_task_type', async ({ ack, body, client, view }) => {
    try {
      const metadata = parsePrivateMetadata(view.private_metadata)
      const departmentKey = resolveDepartmentKey(metadata.departmentKey)
      const domain = metadata.domain || null
      const selectedTaskType = view.state.values.task_type_block?.task_type?.selected_option
      if (!selectedTaskType?.value) {
        await ack({
          response_action: 'errors',
          errors: {
            task_type_block: 'Обери тип запиту.',
          },
        })
        return
      }

      const taskType = selectedTaskType.value
      const taskTypeLabel = selectedTaskType.text.text
      const complexityOptions = getTaskTypeComplexityOptions(departmentKey, taskType)

      if (complexityOptions.length > 0) {
        await ack({
          response_action: 'update',
          view: buildTaskComplexityPickerView({ departmentKey, taskType, taskTypeLabel, domain }),
        })
        return
      }

      await ack({
        response_action: 'update',
        view: buildTaskModalView({ departmentKey, taskType, taskTypeLabel, domain }),
      })
    } catch (error) {
      logModalStepError('select_task_type', error, {
        viewId: view?.id || null,
        callbackId: view?.callback_id || null,
      })

      await ack({
        response_action: 'errors',
        errors: {
          task_type_block: 'Не вдалося відкрити бриф. Спробуй ще раз або напиши адміну.',
        },
      })
    }
  })

  app.view('select_task_complexity', async ({ ack, view }) => {
    try {
      const metadata = parsePrivateMetadata(view.private_metadata)
      const departmentKey = resolveDepartmentKey(metadata.departmentKey)
      const domain = metadata.domain || null
      const categoryTaskType = metadata.taskType
      const categoryTaskTypeLabel = metadata.taskTypeLabel
      const selectedComplexity = view.state.values.complexity_block?.complexity?.selected_option
      if (!selectedComplexity?.value) {
        await ack({
          response_action: 'errors',
          errors: {
            complexity_block: 'Обери рівень складності.',
          },
        })
        return
      }

      const taskType = resolveTaskTypeComplexity(departmentKey, categoryTaskType, selectedComplexity.value)
      const taskConfig = getDepartmentTaskType(departmentKey, taskType)
      const taskTypeLabel = taskConfig?.label || `${categoryTaskTypeLabel} — ${selectedComplexity.text.text}`

      await ack({
        response_action: 'update',
        view: buildTaskModalView({ departmentKey, taskType, taskTypeLabel, domain }),
      })
    } catch (error) {
      logModalStepError('select_task_complexity', error, {
        viewId: view?.id || null,
        callbackId: view?.callback_id || null,
      })

      await ack({
        response_action: 'errors',
        errors: {
          complexity_block: 'Не вдалося відкрити бриф. Спробуй ще раз або напиши адміну.',
        },
      })
    }
  })

  app.action('platform', async ({ ack, body, client }) => {
    await ack()

    const { departmentKey = DEFAULT_DEPARTMENT_KEY, taskType, taskTypeLabel, domain } = parsePrivateMetadata(body.view.private_metadata)
    const values = {
      ...body.view.state.values,
      platform_block: {
        ...body.view.state.values.platform_block,
        platform: {
          ...body.actions[0],
          selected_option: body.actions[0].selected_option,
        },
      },
    }

    await client.views.update({
      view_id: body.view.id,
      hash: body.view.hash,
      view: buildTaskModalView({ departmentKey, taskType, taskTypeLabel, domain, values }),
    })
  })

  app.action(
    /^(structure_choice|ready_texts|visual_source|link_needed|title_description|thumbnail|ad_goal|fixed_budget|source_materials)$/,
    async ({ ack, body, client }) => {
      await ack()
      if (body.view?.callback_id !== 'submit_task') return

      const { departmentKey = DEFAULT_DEPARTMENT_KEY, taskType, taskTypeLabel, domain } = parsePrivateMetadata(body.view.private_metadata)
      if (resolveDepartmentKey(departmentKey) === DEFAULT_DEPARTMENT_KEY) return

      const action = body.actions?.[0]
      if (!action?.block_id || !action?.action_id) return

      const values = {
        ...body.view.state.values,
        [action.block_id]: {
          ...body.view.state.values[action.block_id],
          [action.action_id]: action,
        },
      }

      await client.views.update({
        view_id: body.view.id,
        hash: body.view.hash,
        view: buildTaskModalView({ departmentKey, taskType, taskTypeLabel, domain, values }),
      })
    }
  )

  // Крок 2 — юзер заповнив бриф і натиснув "Створити задачу"
  app.view('submit_task', async ({ ack, body, client, view }) => {
    const {
      departmentKey: rawDepartmentKey = DEFAULT_DEPARTMENT_KEY,
      taskType,
      taskTypeLabel,
      domain,
    } = parsePrivateMetadata(view.private_metadata)
    const departmentKey = resolveDepartmentKey(rawDepartmentKey)
    const department = getDepartment(departmentKey)
    const values = view.state.values
    const userId = body.user.id
    const userName = body.user.name

    let priority = null
    let deadline = null
    let context = null
    let style = null
    let antiref = null
    let canEditText = null
    let videoFormat = null
    let platform = null
    let platforms = []
    let platformOther = null
    let fieldAnswers = []
    let specificFields = {}
    let isLate = false
    const artifacts = {}

    const name = values.name_block?.name?.value

    if (departmentKey === DEFAULT_DEPARTMENT_KEY) {
      priority = values.priority_block?.priority?.selected_option?.value
      deadline = values.deadline_block?.deadline?.selected_date
      context = values.context_block?.context?.value
      style = values.style_block?.style?.value
      antiref = values.antiref_block?.antiref?.value
      canEditText = values.can_edit_block?.can_edit?.selected_option?.value
      videoFormat = values.video_format_block?.video_format?.selected_option?.value
      platform = values.platform_block?.platform?.selected_option?.value
      platformOther = values.platform_other_block?.platform_other?.value
      platforms = platform ? [platform] : []

      const fieldMapping = {
        size_block: '📐 Розміри',
        print_size_block: '📐 Розміри',
        message_block: '💬 Ключове повідомлення',
        accent_block: '🎯 Основний акцент',
        color_model_block: '🎨 Кольорова модель',
        output_format_block: '📄 Формат файлу на виході',
        video_format_block: '🎬 Фінальний формат відео',
        subtitles_block: '💬 Субтитри',
        cta_block: '📢 CTA',
        mood_block: '🌀 Концепція / настрій',
        edit_style_block: '✂️ Стиль монтажу',
        slides_count_block: '🔢 Кількість слайдів',
        slides_text_block: '📝 Текст по слайдах',
        structure_block: '🗂 Структура',
        audience_block: '👥 Ціль і аудиторія',
        ai_description_block: '🤖 Що зобразити',
        new_blocks_block: '➕ Нові блоки',
        custom_images_block: '🖼 Кастомні картинки',
        carrier_block: '👕 Тип носія',
        print_zone_block: '📍 Зони нанесення',
        variants_block: '🔄 Кількість варіантів',
        concept_block: '💡 Концепція / меседж',
        restrictions_block: '🚫 Обмеження',
        brand_name_block: '🏷 Назва бренду',
        business_block: '🏢 Опис бізнесу',
        target_block: '🎯 ЦА',
        competitors_block: '⚔️ Конкуренти',
        usage_block: '📍 Де використовуватись',
        sphere_block: '🏭 Сфера',
        what_to_fix_block: '🔧 Що прибрати / змінити',
        person_name_block: '👤 Ім\'я та посада',
        event_date_block: '📅 Дата події',
        tv_text_block: '📺 Текст',
        qr_block: '🔗 QR / посилання',
        event_name_block: '🎪 Назва івенту',
        location_block: '📍 Локація',
        character_block: '🎭 Характер івенту',
        carriers_list_block: '📋 Перелік носіїв',
        slide_list_block: '📋 Перелік слайдів для правок',
        can_shorten_block: '✂️ Можна скорочувати текст',
        vacancy_block: '💼 Назва вакансії та умови',
        formats_list_block: '📐 Перелік форматів',
        promo_desc_block: '💡 Опис задачі',
        selected_concept_block: '🎯 Обраний концепт',
        new_text_block: '📝 Новий текст',
        concept_only_block: '💡 Концепція',
        hooks_block: '🪝 Хуки',
        desired_dynamics_block: '🎞 Мінімальний опис бажаної динаміки',
        construction_block: '🧩 Конструкція',
        file_packaging_block: '📦 Як передавати елементи',
        print_effect_block: '✨ Ефект нанесення',
        other_desc_block: '📝 Опис задачі',
      }

      for (const [blockId, label] of Object.entries(fieldMapping)) {
        const block = values[blockId]
        if (!block) continue
        const actionId = Object.keys(block)[0]
        const element = block[actionId]
        const val = extractElementValue(element)
        if (val) specificFields[label] = formatFieldValue(val)
      }

      const artifactMapping = {
        artifact_figma_block: 'Figma / макет',
        artifact_drive_block: 'Google Drive',
        artifact_video_block: 'Відеоматеріал',
        artifact_music_block: 'Музика',
        artifact_photo_block: 'Фото',
        artifact_logo_block: 'Логотип',
        artifact_ref_block: 'Референси',
        artifact_brand_block: 'Бренд-гайд',
        artifact_pres_block: 'Презентація',
        artifact_article_block: 'Стаття / текст',
      }

      for (const [blockId, label] of Object.entries(artifactMapping)) {
        const block = values[blockId]
        if (!block) continue
        const actionId = Object.keys(block)[0]
        const val = block[actionId]?.value || null
        if (val) artifacts[label] = val
      }
    } else {
      const dynamicFields = await extractDynamicSubmissionFields({ client, departmentKey, taskType, values })
      deadline = dynamicFields.deadline
      context = dynamicFields.context
      platforms = dynamicFields.platforms
      platform = dynamicFields.platform
      fieldAnswers = dynamicFields.fieldAnswers
      specificFields = dynamicFields.specificFields
      priority = null
    }

    const leadTimeViolation = getLeadTimeViolation({ departmentKey, taskType, deadline, values })
    if (leadTimeViolation && leadTimeViolation.override !== 'late') {
      if (leadTimeViolation.override === 'change_date') {
        await ack({
          response_action: 'errors',
          errors: {
            [`${getDepartmentTaskFields(departmentKey, taskType).find((field) => field.role === 'deadline')?.key || 'deadline'}_block`]:
              `Зміни дату: для цього типу мінімальний термін — ${getLeadTimeText(leadTimeViolation)}.`,
          },
        })
        return
      }

      await ack({
        response_action: 'update',
        view: buildTaskModalView({
          departmentKey,
          taskType,
          taskTypeLabel,
          values,
          leadTimeWarning: leadTimeViolation,
        }),
      })
      return
    }
    isLate = Boolean(leadTimeViolation && leadTimeViolation.override === 'late')

    await ack()

    const submissionPayload = {
      departmentKey,
      userId,
      userName,
      slackPersonName: userName,
      taskType,
      taskTypeLabel,
      name,
      priority,
      deadline,
      context,
      style,
      antiref,
      canEditText,
      videoFormat,
      platform,
      platforms,
      platformOther,
      specificFields,
      fieldAnswers,
      artifacts,
      isLate,
      domain: domain || null,
      leadTimeWarning: isLate
        ? {
            minLeadDays: leadTimeViolation.minLeadDays,
            minLeadLabel: leadTimeViolation.minLeadLabel,
            recommendedLeadLabel: leadTimeViolation.recommendedLeadLabel,
            providedLeadDays: leadTimeViolation.providedLeadDays,
          }
        : null,
      values,
    }

    let queuedSubmission

    try {
      queuedSubmission = await enqueueTaskSubmission(submissionPayload)
    } catch (err) {
      console.error('Failed to queue task submission:', err)

      const failedSubmissionPayload = buildFailedSubmissionPayload({
        ...submissionPayload,
        error: err,
      })

      try {
        const failedDraft = await saveFailedSubmission(failedSubmissionPayload)

        await client.chat.postMessage({
          channel: userId,
          text:
            `❌ Не вдалося поставити задачу в чергу.\n` +
            `Бриф збережено як чернетку: \`${failedDraft.draftId}\`. Напиши адміну цей код, і ми відновимо задачу без повторного заповнення.`,
        })
      } catch (draftErr) {
        console.error('Failed to save task submission draft:', draftErr)
        console.error('Unsaved task submission draft:', JSON.stringify(failedSubmissionPayload))

        await client.chat.postMessage({
          channel: userId,
          text: '❌ Не вдалося поставити задачу в чергу. Адмін може перевірити server logs.',
        })
      }

      return
    }

    try {
      await client.chat.postMessage({
        channel: userId,
        text:
          `🕐 Задачу прийнято в чергу.\n` +
          `${name || taskTypeLabel}\n` +
          `Зараз у боті багато запитів, тому створення задачі може зайняти трохи більше часу. Напишу тут, щойно задача буде готова.`,
      })
    } catch (slackErr) {
      console.error(`Failed to notify ${userId} about queued task submission:`, slackErr)
    }

    console.log(`Task submission queued: ${queuedSubmission.queueId}`)
    setTimeout(() => processQueuedTaskSubmissions(client), 0)
  })
}

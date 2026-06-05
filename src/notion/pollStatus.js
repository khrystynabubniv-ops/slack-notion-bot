import { Client } from '@notionhq/client'
import {
  deleteTask,
  getAllTasks,
  getQualityFeedback,
  getRoundsCount,
  markFeedbackSurveySent,
  updateLastComment,
  updateStatus,
  updateTaskSnapshot,
} from '../redis/store.js'
import {
  canAcceptTaskResult,
  extractParentPageIds,
  isCommentsStatus,
  extractStatus,
  normalizePageId,
} from './taskAcceptanceReadiness.js'
import {
  sendCommentUpdate,
  sendQualitySurvey,
  sendReviewRequest,
  sendStatusUpdate,
  sendTaskFieldUpdate,
  updateRootTaskMessage,
} from '../slack/notify.js'
import { buildTaskPageUrl } from './pageUrl.js'
import { notionRequest } from './request.js'
import { extractDesignerFromProperties } from './designer.js'
import { getAllDepartments, getDepartment, resolveDepartmentKey } from '../config/departments.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const POLLING_RATE_LIMIT_COOLDOWN_MS = Number.parseInt(
  process.env.NOTION_POLL_RATE_LIMIT_COOLDOWN_MS || `${10 * 60 * 1000}`,
  10
)
let commentPollingEnabled = true
const pollingInProgressByDepartment = new Set()
let pollingPausedUntil = 0
const notionUserNameCache = new Map()

function normalizeStatusName(status) {
  return String(status || '').trim().toLowerCase()
}

function isRateLimited(error) {
  return error?.code === 'rate_limited' || error?.status === 429 || error?.statusCode === 429
}

function getHeader(headers, headerName) {
  if (!headers) return null
  if (typeof headers.get === 'function') return headers.get(headerName)

  const normalizedHeaderName = headerName.toLowerCase()
  return Object.entries(headers)
    .find(([key]) => key.toLowerCase() === normalizedHeaderName)
    ?.[1]
}

function getPollingCooldownMs(error) {
  const retryAfter = getHeader(error?.headers, 'retry-after')
  const retryAfterSeconds = Number.parseFloat(Array.isArray(retryAfter) ? retryAfter[0] : retryAfter)
  const configuredCooldown =
    Number.isFinite(POLLING_RATE_LIMIT_COOLDOWN_MS) && POLLING_RATE_LIMIT_COOLDOWN_MS > 0
      ? POLLING_RATE_LIMIT_COOLDOWN_MS
      : 10 * 60 * 1000

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.max(Math.ceil(retryAfterSeconds * 1000), configuredCooldown)
  }

  return configuredCooldown
}

function pausePollingAfterRateLimit(error, context) {
  const cooldownMs = getPollingCooldownMs(error)
  pollingPausedUntil = Date.now() + cooldownMs
  console.warn(
    `Notion polling paused for ${cooldownMs}ms after rate limit during ${context}.`
  )
}

function getCompletedStatusNames(department) {
  return (department.completedStatuses || [])
    .map(normalizeStatusName)
    .filter(Boolean)
}

function getQualitySurveyStatusNames(department) {
  return (department.qualitySurveyStatuses || [])
    .map(normalizeStatusName)
    .filter(Boolean)
}

function isCompletedStatus(status, department) {
  const normalizedStatus = normalizeStatusName(status)
  const completedStatusNames = getCompletedStatusNames(department)

  return Boolean(
    normalizedStatus &&
      (completedStatusNames.includes(normalizedStatus) ||
        normalizedStatus.includes('done'))
  )
}

function isQualitySurveyStatus(status, department) {
  const normalizedStatus = normalizeStatusName(status)
  const surveyStatusNames = getQualitySurveyStatusNames(department)

  return Boolean(
    normalizedStatus &&
      (surveyStatusNames.includes(normalizedStatus) ||
        (!surveyStatusNames.length && (
          normalizedStatus === 'ready' ||
          normalizedStatus.includes('ready') ||
          normalizedStatus.includes('реді')
        )))
  )
}

function shouldSendQualitySurvey(task, status, department) {
  return isQualitySurveyStatus(status, department) && task.taskKind !== 'feedback'
}

async function sendQualitySurveyOnce(slackClient, task, { pageUrl, completedAt, status, department }) {
  if (!shouldSendQualitySurvey(task, status, department)) return false

  const existingFeedback = await getQualityFeedback(task.pageId)
  if (existingFeedback?.feedbackSurveySentAt) return false

  await sendQualitySurvey({
    slackClient,
    slackUserId: task.slackUserId,
    departmentKey: task.departmentKey,
    taskName: task.taskName,
    pageId: task.pageId,
    requesterName: task.requesterName,
    requestUrl: pageUrl,
    team: task.team,
    hub: task.hub,
    requestType: task.requestType,
    completedAt,
    slackChannelId: task.slackChannelId,
    slackThreadTs: task.slackThreadTs || task.slackMessageTs,
  })

  await markFeedbackSurveySent({
    pageId: task.pageId,
    slackUserId: task.slackUserId,
    departmentKey: task.departmentKey,
    taskName: task.taskName,
    requesterName: task.requesterName,
    requestUrl: pageUrl,
    team: task.team,
    hub: task.hub,
    requestType: task.requestType,
    completedAt,
  })

  return true
}

async function stopPollingCompletedTask(
  slackClient,
  task,
  { pageUrl, completedAt = new Date().toISOString(), status, department }
) {
  try {
    await updateStatus(task.pageId, status)
  } catch (error) {
    console.error(
      `❌ Failed to checkpoint completed task ${task.pageId} (${task.taskName}) as ${status}:`,
      error
    )
  }

  try {
    await sendQualitySurveyOnce(slackClient, task, {
      pageUrl,
      completedAt,
      status,
      department,
    })
  } catch (error) {
    console.error(
      `❌ Failed to send Ready quality survey for completed task ${task.pageId} (${task.taskName}); keeping task for retry:`,
      error
    )
    if (shouldSendQualitySurvey(task, status, department)) {
      return
    }
  }

  await deleteTask(task.pageId)
  console.log(`🧹 Completed task removed from polling: ${task.taskName} → ${status}`)
}

function extractAssignee(page) {
  const people = page.properties.Owner?.people || []
  const names = people
    .map((person) => person.name)
    .filter(Boolean)

  if (names.length) return names.join(', ')

  const slackPerson = page.properties['Slack Person']
  if (slackPerson?.title?.length) {
    return slackPerson.title.map((item) => item.plain_text).join('').trim()
  }

  if (slackPerson?.rich_text?.length) {
    return slackPerson.rich_text.map((item) => item.plain_text).join('').trim()
  }

  if (slackPerson?.select?.name) return slackPerson.select.name

  return null
}

function extractUrlProperty(page, propertyName) {
  const property = page.properties[propertyName]
  if (!property) return null

  if (typeof property.url === 'string') {
    const url = property.url.trim()
    return url || null
  }

  return null
}

async function getCurrentTaskSnapshots(department) {
  if (!department.notionDataSourceId) return {}

  const tasks = {}

  let hasMore = true
  let startCursor

  while (hasMore) {
    const response = await notionRequest(
      () => notion.databases.query({
        database_id: department.notionDataSourceId,
        start_cursor: startCursor,
      }),
      `database query (${department.key})`
    )

    for (const page of response.results) {
      const status = extractStatus(page, department.key)
      if (!status) continue

      tasks[page.id] = {
        status,
        assignee: extractAssignee(page),
        designer: await extractDesignerFromProperties(page.properties, notion),
        deadline: page.properties.Deadline?.date?.start || null,
        finalProjectUrl: extractUrlProperty(page, 'Final project'),
        parentPageIds: extractParentPageIds(page),
      }
    }

    hasMore = response.has_more
    startCursor = response.next_cursor ?? undefined
  }

  return tasks
}

function getCurrentTaskSnapshot(currentTasks, pageId) {
  const directMatch = currentTasks[pageId]
  if (directMatch) return directMatch

  const normalizedPageId = normalizePageId(pageId)
  if (!normalizedPageId) return null

  return Object.entries(currentTasks)
    .find(([currentPageId]) => normalizePageId(currentPageId) === normalizedPageId)
    ?.[1] || null
}

async function getOpenComments(pageId) {
  if (!commentPollingEnabled) return []

  let hasMore = true
  let startCursor
  const comments = []

  try {
    while (hasMore) {
      const response = await notionRequest(
        () => notion.comments.list({
          block_id: pageId,
          start_cursor: startCursor,
          page_size: 100,
        }),
        'comments list'
      )

      comments.push(...response.results)

      hasMore = response.has_more
      startCursor = response.next_cursor ?? undefined
    }
  } catch (error) {
    const restricted = error?.code === 'restricted_resource' || error?.status === 403
    if (restricted) {
      commentPollingEnabled = false
      console.warn(
        '⚠️ Comment polling disabled. Enable "Read comments" capability for the Notion integration.'
      )
      return []
    }

    throw error
  }

  return Promise.all(comments.map(formatComment))
}

async function formatComment(comment) {
  const author = await resolveNotionUserName(comment.created_by)
  return {
    id: comment.id,
    createdTime: comment.created_time,
    author,
    text: comment.rich_text
      ?.map((item) => item.plain_text || item.text?.content || '')
      .join('')
      .trim() || '',
  }
}

async function resolveNotionUserName(createdBy) {
  if (!createdBy) return null
  if (createdBy.name) return createdBy.name

  const userId = createdBy.id
  if (!userId) return null

  if (notionUserNameCache.has(userId)) {
    return notionUserNameCache.get(userId)
  }

  try {
    const user = await notionRequest(
      () => notion.users.retrieve({ user_id: userId }),
      'user retrieve'
    )
    const resolvedName = user?.name || user?.person?.email || userId
    notionUserNameCache.set(userId, resolvedName)
    return resolvedName
  } catch (error) {
    console.warn(`Failed to resolve Notion user name for ${userId}:`, error)
    notionUserNameCache.set(userId, userId)
    return userId
  }
}

function getNewComments(comments, task) {
  if (!comments.length) return []
  if (!task.lastCommentId && !task.lastCommentCreatedTime) return []

  if (task.lastCommentId) {
    const savedIndex = comments.findIndex((comment) => comment.id === task.lastCommentId)
    if (savedIndex >= 0) return comments.slice(savedIndex + 1)
  }

  if (!task.lastCommentCreatedTime) return comments

  const savedTimestamp = Date.parse(task.lastCommentCreatedTime)
  if (Number.isNaN(savedTimestamp)) return comments

  return comments.filter((comment) => {
    if (comment.id === task.lastCommentId) return false

    const commentTimestamp = Date.parse(comment.createdTime)
    if (Number.isNaN(commentTimestamp)) return true

    return commentTimestamp > savedTimestamp
  })
}

function normalizePersonName(value) {
  return (value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function isSlackThreadMirrorComment(comment) {
  return normalizePersonName(comment?.text).startsWith('slack thread ·')
}

function isOwnComment(latestComment, task) {
  if (isSlackThreadMirrorComment(latestComment)) return true
  if (!task.requesterName || !latestComment.author) return false
  return normalizePersonName(task.requesterName) === normalizePersonName(latestComment.author)
}

function normalizeTrackedValue(value) {
  return String(value || '').trim()
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeTrackedUrl(value) {
  const trimmed = normalizeTrackedValue(value)
  if (!trimmed) return ''

  try {
    return new URL(trimmed).toString()
  } catch (_) {
    try {
      return new URL(`https://${trimmed}`).toString()
    } catch (_) {
      return trimmed
    }
  }
}

function getCurrentResponsible(currentTask) {
  return currentTask.designer || currentTask.assignee || null
}

function getCurrentResponsibleLabel(currentTask) {
  return currentTask.designer?.name || currentTask.assignee || null
}

function getStoredResponsibleLabel(task) {
  return task.lastDesignerName || task.lastAssignee || null
}

function getCurrentResponsibleKey(currentTask) {
  return [
    normalizeTrackedValue(currentTask.designer?.name),
    normalizeTrackedValue(currentTask.designer?.userId),
    normalizeTrackedValue(currentTask.assignee),
  ].join('|')
}

function getStoredResponsibleKey(task) {
  return [
    normalizeTrackedValue(task.lastDesignerName),
    normalizeTrackedValue(task.lastDesignerUserId),
    normalizeTrackedValue(task.lastAssignee),
  ].join('|')
}

function hasStoredSnapshot(task) {
  return task.snapshotInitialized === true
}

function hasSlackThread(task) {
  return Boolean(task.slackChannelId && (task.slackThreadTs || task.slackMessageTs))
}

function isInitialStatus(status) {
  const normalizedStatus = normalizeStatusName(status)
  return normalizedStatus === 'to do' ||
    normalizedStatus === 'todo' ||
    normalizedStatus.includes('ту ду')
}

function getFallbackStatusNotificationKey(status) {
  return normalizeStatusName(status)
}

function getMissingThreadRestoreKey(status) {
  return normalizeStatusName(status)
}

function shouldSendMissingThreadStatusRecovery(task, currentTask) {
  const notificationKey = getFallbackStatusNotificationKey(currentTask.status)
  const restoreKey = getMissingThreadRestoreKey(currentTask.status)
  const department = getDepartment(task.departmentKey)

  return Boolean(
    task.slackUserId &&
      !hasSlackThread(task) &&
      notificationKey &&
      !isInitialStatus(currentTask.status) &&
      !isCompletedStatus(currentTask.status, department) &&
      (task.fallbackStatusNotifiedFor !== notificationKey ||
        task.missingThreadRestoreAttemptedFor !== restoreKey)
  )
}

function isFallbackStatusRecoveryMessage(message) {
  const text = normalizeSearchText(message?.text)

  return Boolean(
    message?.bot_id &&
      !message.thread_ts &&
      text.includes('є рух по задачі') &&
      text.includes('статус')
  )
}

function isRootTaskMessageCandidate(message, taskName) {
  const text = normalizeSearchText(message?.text)
  const normalizedTaskName = normalizeSearchText(taskName)

  if (!message?.bot_id || !text || !normalizedTaskName) return false
  if (!text.includes(normalizedTaskName)) return false
  if (isFallbackStatusRecoveryMessage(message)) return false

  return text.includes('задача створена') || text.includes('ми отримали твій запит')
}

async function getSlackDmHistory(slackClient, slackUserId) {
  if (!slackClient?.conversations?.open || !slackClient?.conversations?.history) return null

  const opened = await slackClient.conversations.open({ users: slackUserId })
  const channelId = opened.channel?.id
  if (!channelId) return null

  const messages = []
  let cursor

  for (let page = 0; page < 10; page += 1) {
    const response = await slackClient.conversations.history({
      channel: channelId,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    })

    messages.push(...(response.messages || []))
    cursor = response.response_metadata?.next_cursor
    if (!cursor) break
  }

  return { channelId, messages }
}

async function tryRestoreMissingSlackThread(slackClient, task, currentTask) {
  const restoreKey = getMissingThreadRestoreKey(currentTask.status)
  const restoreAttemptPatch = {
    missingThreadRestoreAttemptedFor: restoreKey,
    missingThreadRestoreAttemptedAt: new Date().toISOString(),
  }

  try {
    const dmHistory = await getSlackDmHistory(slackClient, task.slackUserId)
    const rootMessage = dmHistory?.messages
      ?.find((message) => isRootTaskMessageCandidate(message, task.taskName))

    if (!dmHistory?.channelId || !rootMessage?.ts) {
      await updateTaskSnapshot(task.pageId, restoreAttemptPatch)
      return null
    }

    const restoredAt = new Date().toISOString()
    const restoredTask = {
      ...task,
      slackChannelId: dmHistory.channelId,
      slackMessageTs: rootMessage.ts,
      slackThreadTs: rootMessage.ts,
      threadRestoredAt: restoredAt,
      missingThreadRestoreAttemptedFor: restoreKey,
      missingThreadRestoreAttemptedAt: restoredAt,
    }

    await updateTaskSnapshot(task.pageId, {
      slackChannelId: restoredTask.slackChannelId,
      slackMessageTs: restoredTask.slackMessageTs,
      slackThreadTs: restoredTask.slackThreadTs,
      threadRestoredAt: restoredAt,
      missingThreadRestoreAttemptedFor: restoreKey,
      missingThreadRestoreAttemptedAt: restoredAt,
    })

    console.log(
      `🧵 Restored Slack task thread for page ${task.pageId}: ${dmHistory.channelId}/${rootMessage.ts}`
    )

    return restoredTask
  } catch (error) {
    await updateTaskSnapshot(task.pageId, restoreAttemptPatch)
    console.error(`❌ Failed to restore Slack task thread for page ${task.pageId}:`, error)
    return null
  }
}

function getTaskSnapshotPatch(currentTask) {
  return {
    lastStatus: currentTask.status,
    lastAssignee: currentTask.assignee || null,
    lastDesignerName: currentTask.designer?.name || null,
    lastDesignerUserId: currentTask.designer?.userId || null,
    lastDeadline: currentTask.deadline || null,
    lastFinalProjectUrl: currentTask.finalProjectUrl || null,
    snapshotInitialized: true,
  }
}

function formatTextChangeValue(value) {
  const text = normalizeTrackedValue(value)
  if (!text) return null

  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatUrlChangeValue(value) {
  const url = normalizeTrackedUrl(value)
  return url ? `<${url}|відкрити>` : null
}

function getTrackedFieldChanges(task, currentTask) {
  const changes = []
  const responsibleChanged = getCurrentResponsibleKey(currentTask) !== getStoredResponsibleKey(task)
  const finalProjectChanged =
    normalizeTrackedUrl(currentTask.finalProjectUrl) !== normalizeTrackedUrl(task.lastFinalProjectUrl)

  if (responsibleChanged) {
    changes.push({
      type: 'responsible',
      label: 'Відповідальний',
      oldValue: formatTextChangeValue(getStoredResponsibleLabel(task)),
      newValue: formatTextChangeValue(getCurrentResponsibleLabel(currentTask)),
    })
  }

  if (finalProjectChanged) {
    changes.push({
      type: 'finalProject',
      label: 'Фінальний проєкт',
      oldValue: formatUrlChangeValue(task.lastFinalProjectUrl),
      newValue: formatUrlChangeValue(currentTask.finalProjectUrl),
    })
  }

  return changes
}

async function checkpointTaskSnapshot(pageId, currentTask) {
  await updateTaskSnapshot(pageId, getTaskSnapshotPatch(currentTask))
}

async function checkpointMissingThreadStatusNotification(pageId, status) {
  await updateTaskSnapshot(pageId, {
    fallbackStatusNotifiedFor: getFallbackStatusNotificationKey(status),
    fallbackStatusNotifiedAt: new Date().toISOString(),
  })
}

async function refreshRootTaskMessage(slackClient, task, currentTask, pageUrl, currentTasks) {
  const roundsCount = await getRoundsCount(task.pageId)
  const canAcceptResult = canAcceptTaskResult(currentTasks, task.pageId)

  await updateRootTaskMessage(slackClient, {
    channelId: task.slackChannelId,
    messageTs: task.slackMessageTs,
    taskName: task.taskName,
    departmentKey: task.departmentKey,
    status: currentTask.status,
    responsible: getCurrentResponsible(currentTask),
    pageUrl,
    resultUrl: currentTask.finalProjectUrl,
    taskKind: task.taskKind,
    pageId: task.pageId,
    roundNumber: roundsCount + 1,
    designer: currentTask.designer,
    canAcceptResult,
  })
}

async function sendMissingThreadStatusRecovery(slackClient, task, currentTask, pageUrl, currentTasks) {
  const roundsCount = await getRoundsCount(task.pageId)
  const canAcceptResult = canAcceptTaskResult(currentTasks, task.pageId)
  const restoredTask = await tryRestoreMissingSlackThread(slackClient, task, currentTask)
  const notificationTask = restoredTask || task
  const notificationKey = getFallbackStatusNotificationKey(currentTask.status)

  if (!restoredTask && task.fallbackStatusNotifiedFor === notificationKey) {
    return
  }

  console.log(
    restoredTask
      ? `📣 Sending restored-thread status recovery for page ${task.pageId}: ${currentTask.status} (user ${task.slackUserId})`
      : `📣 Sending fallback status recovery for page ${task.pageId}: ${currentTask.status} (user ${task.slackUserId})`
  )

  await sendStatusUpdate({
    slackClient,
    slackUserId: notificationTask.slackUserId,
    taskName: notificationTask.taskName,
    departmentKey: notificationTask.departmentKey,
    oldStatus: null,
    newStatus: currentTask.status,
    assignee: currentTask.assignee,
    finalProjectUrl: currentTask.finalProjectUrl,
    pageUrl,
    pageId: notificationTask.pageId,
    slackChannelId: notificationTask.slackChannelId,
    slackMessageTs: notificationTask.slackMessageTs,
    slackThreadTs: notificationTask.slackThreadTs || notificationTask.slackMessageTs,
    taskKind: notificationTask.taskKind,
    roundNumber: roundsCount + 1,
    completedRounds: roundsCount,
    designer: currentTask.designer,
    canAcceptResult,
  })

  await checkpointMissingThreadStatusNotification(task.pageId, currentTask.status)
}

async function runPollingCycle(slackClient, department) {
  if (pollingInProgressByDepartment.has(department.key)) {
    console.warn(`Notion polling skipped for ${department.key} because the previous cycle is still running.`)
    return
  }

  if (Date.now() < pollingPausedUntil) {
    console.log(`Notion polling paused until ${new Date(pollingPausedUntil).toISOString()}`)
    return
  }

  pollingInProgressByDepartment.add(department.key)

  try {
    const trackedTasks = (await getAllTasks()).filter((task) => {
      return resolveDepartmentKey(task.departmentKey) === department.key
    })
    if (!trackedTasks.length) return

    const activeTrackedTasks = []
    for (const task of trackedTasks) {
      const pageUrl = task.pageUrl || buildTaskPageUrl(task.pageId, null, task.departmentKey)

      if (isCompletedStatus(task.lastStatus, department)) {
        try {
          await stopPollingCompletedTask(slackClient, task, {
            pageUrl,
            completedAt: new Date().toISOString(),
            status: task.lastStatus,
            department,
          })
        } catch (error) {
          activeTrackedTasks.push(task)
          console.error(
            `❌ Failed to remove completed task ${task.pageId} (${task.taskName}) from polling; keeping it for retry:`,
            error
          )
        }
      } else {
        activeTrackedTasks.push(task)
      }
    }

    if (!activeTrackedTasks.length) return

    const currentTasks = await getCurrentTaskSnapshots(department)

    for (const task of activeTrackedTasks) {
      const currentTask = getCurrentTaskSnapshot(currentTasks, task.pageId)
      if (!currentTask?.status) continue
      const pageUrl = task.pageUrl || buildTaskPageUrl(task.pageId, null, task.departmentKey)
      const completed = isCompletedStatus(currentTask.status, department)
      let rootMessageRefreshed = false

      if (!task.lastStatus) {
        if (completed) {
          await stopPollingCompletedTask(slackClient, task, {
            pageUrl,
            completedAt: new Date().toISOString(),
            status: currentTask.status,
            department,
          })
          continue
        } else {
          await refreshRootTaskMessage(slackClient, task, currentTask, pageUrl, currentTasks)
          rootMessageRefreshed = true
          await checkpointTaskSnapshot(task.pageId, currentTask)
          console.log(`ℹ️ Task snapshot initialized: ${task.taskName} → ${currentTask.status}`)
        }
      } else if (currentTask.status !== task.lastStatus) {
        if (normalizeStatusName(currentTask.status) === normalizeStatusName(task.lastStatus)) {
          await checkpointTaskSnapshot(task.pageId, currentTask)
          console.log(`ℹ️ Status casing normalized without notification: ${task.taskName} → ${currentTask.status}`)
        } else {
          try {
            const roundsCount = await getRoundsCount(task.pageId)
            const canAcceptResult = canAcceptTaskResult(currentTasks, task.pageId)

            console.log(
              `📣 Sending status update for page ${task.pageId}: ${task.lastStatus} -> ${currentTask.status} (user ${task.slackUserId})`
            )

            await sendStatusUpdate({
              slackClient,
              slackUserId: task.slackUserId,
              taskName: task.taskName,
              departmentKey: task.departmentKey,
              oldStatus: task.lastStatus,
              newStatus: currentTask.status,
              assignee: currentTask.assignee,
              finalProjectUrl: currentTask.finalProjectUrl,
              pageUrl,
              pageId: task.pageId,
              slackChannelId: task.slackChannelId,
              slackMessageTs: task.slackMessageTs,
              slackThreadTs: task.slackThreadTs || task.slackMessageTs,
              taskKind: task.taskKind,
              roundNumber: roundsCount + 1,
              completedRounds: roundsCount,
              designer: currentTask.designer,
              canAcceptResult,
            })
            rootMessageRefreshed = true
            if (!hasSlackThread(task)) {
              await checkpointMissingThreadStatusNotification(task.pageId, currentTask.status)
            }

            if (completed) {
              await stopPollingCompletedTask(slackClient, task, {
                pageUrl,
                completedAt: new Date().toISOString(),
                status: currentTask.status,
                department,
              })
              continue
            } else {
              await checkpointTaskSnapshot(task.pageId, currentTask)
              console.log(`✅ Status snapshot updated: ${task.taskName} → ${currentTask.status}`)
            }
          } catch (error) {
            console.error(
              `❌ Failed to notify about status change for page ${task.pageId} (${task.taskName}) and user ${task.slackUserId}:`,
              error
            )

            if (completed) {
              await stopPollingCompletedTask(slackClient, task, {
                pageUrl,
                completedAt: new Date().toISOString(),
                status: currentTask.status,
                department,
              })
              continue
            }
          }
        }
      } else if (!hasStoredSnapshot(task)) {
        await refreshRootTaskMessage(slackClient, task, currentTask, pageUrl, currentTasks)
        rootMessageRefreshed = true
        await checkpointTaskSnapshot(task.pageId, currentTask)
        console.log(`ℹ️ Task field snapshot initialized: ${task.taskName}`)
      } else {
        const fieldChanges = getTrackedFieldChanges(task, currentTask)

        if (fieldChanges.length) {
          try {
            const roundsCount = await getRoundsCount(task.pageId)
            const canAcceptResult = canAcceptTaskResult(currentTasks, task.pageId)
            const finalProjectChanged = fieldChanges.some((change) => change.type === 'finalProject')
            const canRequestReviewFromResultChange = roundsCount === 0
            const shouldSendReviewRequest =
              finalProjectChanged &&
              isCommentsStatus(currentTask.status) &&
              Boolean(normalizeTrackedUrl(currentTask.finalProjectUrl)) &&
              canRequestReviewFromResultChange
            const regularFieldChanges = shouldSendReviewRequest
              ? fieldChanges.filter((change) => change.type !== 'finalProject')
              : fieldChanges

            if (regularFieldChanges.length) {
              await sendTaskFieldUpdate({
                slackClient,
                slackUserId: task.slackUserId,
                taskName: task.taskName,
                departmentKey: task.departmentKey,
                status: currentTask.status,
                responsible: getCurrentResponsible(currentTask),
                finalProjectUrl: currentTask.finalProjectUrl,
                pageUrl,
                slackChannelId: task.slackChannelId,
                slackMessageTs: task.slackMessageTs,
                slackThreadTs: task.slackThreadTs || task.slackMessageTs,
                taskKind: task.taskKind,
                pageId: task.pageId,
                roundNumber: roundsCount + 1,
                designer: currentTask.designer,
                canAcceptResult,
              })
              rootMessageRefreshed = true
            }

            if (shouldSendReviewRequest) {
              await sendReviewRequest({
                slackClient,
                slackUserId: task.slackUserId,
                taskName: task.taskName,
                departmentKey: task.departmentKey,
                status: currentTask.status,
                assignee: currentTask.assignee,
                finalProjectUrl: currentTask.finalProjectUrl,
                pageUrl,
                pageId: task.pageId,
                slackChannelId: task.slackChannelId,
                slackMessageTs: task.slackMessageTs,
                slackThreadTs: task.slackThreadTs || task.slackMessageTs,
                taskKind: task.taskKind,
                roundNumber: roundsCount + 1,
                designer: currentTask.designer,
                canAcceptResult,
              })
              rootMessageRefreshed = true
            }

            await checkpointTaskSnapshot(task.pageId, currentTask)
            console.log(`✅ Field snapshot updated: ${task.taskName}`)
          } catch (error) {
            console.error(
              `❌ Failed to notify about field change for page ${task.pageId} (${task.taskName}) and user ${task.slackUserId}:`,
              error
            )
          }
        }
      }

      if (shouldSendMissingThreadStatusRecovery(task, currentTask)) {
        try {
          await sendMissingThreadStatusRecovery(slackClient, task, currentTask, pageUrl, currentTasks)
          rootMessageRefreshed = true
        } catch (error) {
          console.error(
            `❌ Failed to send fallback status recovery for page ${task.pageId} (${task.taskName}) and user ${task.slackUserId}:`,
            error
          )
        }
      }

      if (
        !completed &&
        task.taskKind !== 'feedback' &&
        isCommentsStatus(currentTask.status) &&
        !rootMessageRefreshed
      ) {
        await refreshRootTaskMessage(slackClient, task, currentTask, pageUrl, currentTasks)
      }

      if (completed) {
        await stopPollingCompletedTask(slackClient, task, {
          pageUrl,
          completedAt: new Date().toISOString(),
          status: currentTask.status,
          department,
        })
        continue
      }

      try {
        const comments = await getOpenComments(task.pageId)
        if (!comments.length) continue

        if (!task.lastCommentId && !task.lastCommentCreatedTime) {
          const latestComment = comments.at(-1)
          await updateLastComment(task.pageId, latestComment)
          continue
        }

        const newComments = getNewComments(comments, task)
        if (!newComments.length) continue

        for (const comment of newComments) {
          if (isOwnComment(comment, task)) {
            await updateLastComment(task.pageId, comment)
            continue
          }

          console.log(
            `💬 Sending comment update for page ${task.pageId}: ${comment.id} (user ${task.slackUserId})`
          )

          await sendCommentUpdate({
            slackClient,
            slackUserId: task.slackUserId,
            taskName: task.taskName,
            commentAuthor: comment.author,
            commentText: comment.text,
            pageUrl,
            slackChannelId: task.slackChannelId,
            slackThreadTs: task.slackThreadTs || task.slackMessageTs,
          })

          await updateLastComment(task.pageId, comment)
          console.log(`✅ Comment checkpoint updated: ${task.taskName} → ${comment.id}`)
        }
      } catch (error) {
        if (isRateLimited(error)) {
          pausePollingAfterRateLimit(error, 'comments list')
          break
        }

        console.error(
          `❌ Failed to notify about comments for page ${task.pageId} (${task.taskName}) and user ${task.slackUserId}:`,
          error
        )
      }
    }
  } catch (err) {
    if (isRateLimited(err)) {
      pausePollingAfterRateLimit(err, 'polling cycle')
    }

    console.error('Polling error:', err)
  } finally {
    pollingInProgressByDepartment.delete(department.key)
  }
}

export async function startPolling(slackClient) {
  for (const department of getAllDepartments()) {
    const intervalMs = Math.max(Number(department.pollIntervalSec || 180), 1) * 1000

    console.log(`🔄 Polling started for ${department.key} — every ${Math.round(intervalMs / 1000)}s`)
    setInterval(() => runPollingCycle(slackClient, department), intervalMs)
  }
}

import { createNotionPage } from '../notion/createPage.js'
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
import { getModalBlocks } from './modalBlocks.js'

const DESIGN_CHANNEL = process.env.DESIGN_CHANNEL_ID?.trim() || null
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
  artifacts,
  values,
  error,
}) {
  return {
    slackUserId: userId,
    slackUserName: userName || null,
    requesterName: slackPersonName || userName || null,
    task: {
      name: name || taskTypeLabel,
      taskType,
      taskTypeLabel,
      priority: priority || null,
      deadline: deadline || null,
      videoFormat: videoFormat || null,
      platform: platform || null,
      platformOther: platformOther || null,
    },
    answers: {
      context: context || null,
      style: style || null,
      antiref: antiref || null,
      canEditText: canEditText || null,
      specificFields,
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

function buildTaskThreadText({ taskName, status = 'To do', responsible = null }) {
  const responsibleText = formatDesignerForSlack(responsible)

  return [
    `*${taskName}*`,
    `⚪ *Статус:* ${status}`,
    `🎨 *Дизайнер:* ${responsibleText}`,
    '',
    'Задачу передано в дизайн-команду. Щойно дизайнер візьме її в роботу, ти побачиш оновлення в цьому треді.',
  ].join('\n')
}

async function resolveSlackPersonName(client, { userId, userName }) {
  try {
    const userInfo = await client.users.info({ user: userId })
    const profile = userInfo.user?.profile

    return (
      profile?.real_name ||
      profile?.display_name ||
      userInfo.user?.real_name ||
      userName ||
      userId
    )
  } catch (slackUserErr) {
    console.error('Slack users.info failed, fallback to body.user.name:', slackUserErr)
    return userName || userId
  }
}

async function createTaskFromSubmissionPayload(client, payload) {
  const {
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
    platformOther,
    specificFields,
    artifacts,
  } = payload
  const slackPersonName = await resolveSlackPersonName(client, { userId, userName })
  let notificationTrackingEnabled = true

  const { pageId, pageUrl } = await createNotionPage({
    name: name || taskTypeLabel,
    priority,
    deadline,
    videoFormat,
    platform,
    platformOther,
    taskType,
    context,
    style,
    antiref,
    canEditText,
    specificFields,
    artifacts,
    slackPersonName,
  })

  const requesterNotificationText = buildTaskThreadText({
    taskName: name || taskTypeLabel,
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
              text: { type: 'plain_text', text: '📋 Відкрити в Notion / додати файли' },
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
      taskName: name || taskTypeLabel,
      requesterName: slackPersonName,
      pageUrl,
    })
  } catch (redisErr) {
    notificationTrackingEnabled = false
    console.error('Redis saveTask failed; status/comment notifications will not be tracked:', redisErr)
  }

  if (!notificationTrackingEnabled) {
    try {
      await client.chat.postMessage({
        channel: userId,
        text: `⚠️ *${name || taskTypeLabel}* створено, але автоапдейти по статусу зараз не підключилися.`,
      })
    } catch (error) {
      console.error(`Failed to notify ${userId} about disabled tracking for page ${pageId}:`, error)
    }
  }

  if (!DESIGN_CHANNEL) {
    console.warn('DESIGN_CHANNEL_ID is not set; skipping design-channel task notification.')
  } else {
    try {
      await client.chat.postMessage({
        channel: DESIGN_CHANNEL,
        text: `Нова задача від <@${userId}>: ${name || taskTypeLabel}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🆕 *Нова задача від <@${userId}>*`,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Задача:*\n${name || taskTypeLabel}` },
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
      console.error(`Failed to send design-channel task notification for page ${pageId}:`, error)
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

  function buildTaskModalView(taskType, taskTypeLabel, values = {}) {
    return {
      type: 'modal',
      callback_id: 'submit_task',
      private_metadata: JSON.stringify({ taskType, taskTypeLabel }),
      title: { type: 'plain_text', text: '📋 Бриф задачі' },
      submit: { type: 'plain_text', text: 'Створити задачу' },
      close: { type: 'plain_text', text: 'Скасувати' },
      blocks: getModalBlocks(taskType, values),
    }
  }

  // Крок 1 — юзер вибрав тип задачі, відкриваємо форму з полями
  app.view('select_task_type', async ({ ack, body, client, view }) => {
    const taskType = view.state.values.task_type_block.task_type.selected_option.value
    const taskTypeLabel = view.state.values.task_type_block.task_type.selected_option.text.text

    await ack({
      response_action: 'update',
      view: buildTaskModalView(taskType, taskTypeLabel),
    })
  })

  app.action('platform', async ({ ack, body, client }) => {
    await ack()

    const { taskType, taskTypeLabel } = JSON.parse(body.view.private_metadata)
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
      view: buildTaskModalView(taskType, taskTypeLabel, values),
    })
  })

  // Крок 2 — юзер заповнив бриф і натиснув "Створити задачу"
  app.view('submit_task', async ({ ack, body, client, view }) => {
    await ack()

    const { taskType, taskTypeLabel } = JSON.parse(view.private_metadata)
    const values = view.state.values
    const userId = body.user.id
    const userName = body.user.name

    // Базові поля
    const name = values.name_block?.name?.value
    const priority = values.priority_block?.priority?.selected_option?.value
    const deadline = values.deadline_block?.deadline?.selected_date
    const context = values.context_block?.context?.value
    const style = values.style_block?.style?.value
    const antiref = values.antiref_block?.antiref?.value
    const canEditText = values.can_edit_block?.can_edit?.selected_option?.value

    const specificFields = {}
    const artifacts = {}

    const videoFormat = values.video_format_block?.video_format?.selected_option?.value
    const platform = values.platform_block?.platform?.selected_option?.value
    const platformOther = values.platform_other_block?.platform_other?.value

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
      let val = element?.value || element?.selected_option?.value || element?.selected_date || null
      if (val) specificFields[label] = val
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

    const submissionPayload = {
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
      platformOther,
      specificFields,
      artifacts,
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
          `Зараз у дизайн-боті багато запитів, тому створення задачі може зайняти трохи більше часу. Напишу тут, щойно задача буде готова.`,
      })
    } catch (slackErr) {
      console.error(`Failed to notify ${userId} about queued task submission:`, slackErr)
    }

    console.log(`Task submission queued: ${queuedSubmission.queueId}`)
    setTimeout(() => processQueuedTaskSubmissions(client), 0)
  })
}

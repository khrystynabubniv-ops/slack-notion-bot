import { acceptTaskResult } from '../notion/acceptTask.js'
import { syncQualityFeedbackToNotion } from '../notion/feedbackDatabase.js'
import {
  deleteTask,
  getQualityFeedback,
  markFeedbackSurveySent,
  saveQualityFeedback,
} from '../redis/store.js'
import { sendQualitySurvey } from '../slack/notify.js'

function parseActionValue(value) {
  if (!value) return {}

  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

async function postUserMessage(client, userId, text) {
  if (!userId) return

  await client.chat.postMessage({
    channel: userId,
    text,
  })
}

async function updateSourceMessage(client, body, text) {
  const channel = body.channel?.id
  const ts = body.message?.ts
  if (!channel || !ts) return

  try {
    await client.chat.update({
      channel,
      ts,
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
    console.error('Failed to update acceptance source message:', error)
  }
}

function getQualityFeedbackModal(payload) {
  return {
    type: 'modal',
    callback_id: 'quality_feedback_submission',
    private_metadata: JSON.stringify(payload),
    title: { type: 'plain_text', text: 'Фідбек по задачі' },
    submit: { type: 'plain_text', text: 'Зберегти' },
    close: { type: 'plain_text', text: 'Скасувати' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `⭐ *Оцінка: ${payload.rating}/5*\n*${payload.taskName || 'Без назви'}*`,
        },
      },
      {
        type: 'input',
        block_id: 'feedback_categories',
        optional: true,
        label: { type: 'plain_text', text: 'Що можна покращити?' },
        element: {
          type: 'checkboxes',
          action_id: 'categories',
          options: [
            {
              text: { type: 'plain_text', text: 'Контекст' },
              value: 'context',
            },
            {
              text: { type: 'plain_text', text: 'Темп' },
              value: 'pace',
            },
            {
              text: { type: 'plain_text', text: 'Ясність' },
              value: 'clarity',
            },
            {
              text: { type: 'plain_text', text: 'Результат' },
              value: 'result',
            },
          ],
        },
      },
      {
        type: 'input',
        block_id: 'feedback_comment',
        optional: true,
        label: { type: 'plain_text', text: 'Коментар' },
        element: {
          type: 'plain_text_input',
          action_id: 'comment',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Можна залишити порожнім або описати, що покращити.' },
        },
      },
    ],
  }
}

async function saveAndSyncFeedback(payload, { slackUserId, comment = null, categories = [] }) {
  const record = await saveQualityFeedback({
    pageId: payload.pageId,
    rating: payload.rating,
    comment,
    categories,
    slackUserId,
    taskName: payload.taskName,
    requesterName: payload.requesterName,
    requestUrl: payload.requestUrl,
    team: payload.team,
    hub: payload.hub,
    requestType: payload.requestType,
    completedAt: payload.completedAt,
  })

  try {
    await syncQualityFeedbackToNotion(record)
  } catch (error) {
    console.error(`Failed to sync quality feedback for page ${payload.pageId}:`, error)
  }

  return record
}

export async function handleTaskAcceptance({ body, client }) {
  const payload = parseActionValue(body.actions?.[0]?.value)
  const pageId = payload.pageId
  const taskName = payload.taskName || 'Без назви'
  const userId = body.user?.id

  if (!pageId) {
    await postUserMessage(client, userId, '❌ Не вдалося визначити задачу. Спробуй відкрити повідомлення ще раз.')
    return
  }

  try {
    const result = await acceptTaskResult({
      pageId,
      designerName: payload.designerName,
      designerUserId: payload.designerUserId,
    })

    const completedAt = new Date().toISOString()
    const existingFeedback = await getQualityFeedback(pageId)

    await updateSourceMessage(
      client,
      body,
      `✅ *${taskName}* прийнято без правок. Статус у Notion оновлено на «Ready».`
    )

    if (!result.commentCreated) {
      await postUserMessage(
        client,
        userId,
        '✅ Задачу прийнято і позначено як готову, але коментар для дизайнера не вдалося додати автоматично.'
      )
    }

    if (!existingFeedback?.feedbackSurveySentAt) {
      await sendQualitySurvey({
        slackClient: client,
        slackUserId: userId,
        taskName,
        pageId,
        requestUrl: payload.requestUrl,
        completedAt,
      })

      await markFeedbackSurveySent({
        pageId,
        slackUserId: userId,
        taskName,
        requestUrl: payload.requestUrl,
        completedAt,
      })
    }

    await deleteTask(pageId)
  } catch (error) {
    console.error(`Failed to accept task result for page ${pageId}:`, error)

    await postUserMessage(
      client,
      userId,
      '❌ Не вдалося прийняти задачу автоматично. Спробуй ще раз або напиши ops-lead.'
    )
  }
}

export async function handleQualityRating({ body, client }) {
  const payload = parseActionValue(body.actions?.[0]?.value)
  const rating = Number.parseInt(payload.rating, 10)
  const userId = body.user?.id

  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    await updateSourceMessage(client, body, '❌ Не вдалося прочитати оцінку. Спробуй ще раз.')
    return
  }

  const normalizedPayload = {
    ...payload,
    rating,
  }

  if (rating === 5) {
    await saveAndSyncFeedback(normalizedPayload, { slackUserId: userId })
    await updateSourceMessage(client, body, '✅ Фідбек прийняли. Дякую за оцінку 5/5!')
    return
  }

  await client.views.open({
    trigger_id: body.trigger_id,
    view: getQualityFeedbackModal(normalizedPayload),
  })
}

export async function handleQualityFeedbackSubmission({ body, view, client }) {
  const payload = parseActionValue(view.private_metadata)
  const values = view.state.values
  const categories = values.feedback_categories?.categories?.selected_options
    ?.map((option) => option.value) || []
  const comment = values.feedback_comment?.comment?.value?.trim() || null
  const userId = body.user?.id

  await saveAndSyncFeedback(payload, {
    slackUserId: userId,
    comment,
    categories,
  })

  await postUserMessage(client, userId, '✅ Фідбек прийняли. Дякую, це допоможе покращити наступні задачі.')
}

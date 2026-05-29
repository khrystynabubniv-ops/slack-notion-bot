import { createFeedbackSubitem } from '../notion/createSubitem.js'
import { getRoundsCount, incrementRoundsCount } from '../redis/store.js'

const DEFAULT_OPS_LEAD_SLACK_ID = 'U0APPD32H6D'

function parsePrivateMetadata(privateMetadata) {
  if (!privateMetadata) return {}

  try {
    return JSON.parse(privateMetadata)
  } catch {
    return {}
  }
}

function normalizeRoundNumber(roundNumber) {
  const parsed = Number.parseInt(roundNumber, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function normalizeMaxRounds(maxRounds) {
  if (maxRounds === null || maxRounds === undefined) return null

  const parsed = Number.parseInt(maxRounds, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function getOpsLeadMention() {
  const slackId = process.env.OPS_LEAD_SLACK_ID?.trim() || DEFAULT_OPS_LEAD_SLACK_ID
  if (/^[UW][A-Z0-9]+$/.test(slackId || '')) return `<@${slackId}>`

  return 'ops-lead'
}

function getFeedbackText(view) {
  return view.state.values.feedback_text?.feedback_input?.value?.trim() || ''
}

async function notifyUser(client, userId, text) {
  if (!userId) return

  await client.chat.postMessage({
    channel: userId,
    text,
  })
}

export async function handleFeedbackSubmission({ body, view, client }) {
  const metadata = parsePrivateMetadata(view.private_metadata)
  const pageId = metadata.pageId
  const taskName = metadata.taskName || 'Без назви'
  const maxRounds = normalizeMaxRounds(metadata.maxRounds)
  const userId = body.user?.id
  const feedbackText = getFeedbackText(view)

  if (!pageId) {
    console.error('Feedback submission is missing pageId metadata.')
    await notifyUser(
      client,
      userId,
      '❌ Не вдалося визначити задачу для правок. Спробуй відкрити форму ще раз.'
    )
    return
  }

  try {
    const roundsCount = await getRoundsCount(pageId)
    const roundNumber = Math.max(normalizeRoundNumber(metadata.roundNumber), roundsCount + 1)

    if (maxRounds !== null && roundNumber > maxRounds) {
      await notifyUser(
        client,
        userId,
        `⛔ Ліміт раундів правок вичерпано. Напишіть ${getOpsLeadMention()} для вирішення.`
      )
      return
    }

    await createFeedbackSubitem({
      parentPageId: pageId,
      taskName,
      roundNumber,
      feedbackText,
    })
    await incrementRoundsCount(pageId)

    await notifyUser(
      client,
      userId,
      `✅ Правки #${roundNumber} прийнято і передано дизайнеру`
    )
  } catch (error) {
    console.error(`Failed to handle feedback submission for page ${pageId}:`, error)

    try {
      await notifyUser(
        client,
        userId,
        '❌ Не вдалося передати правки дизайнеру. Спробуй ще раз або напиши ops-lead.'
      )
    } catch (notifyError) {
      console.error(`Failed to notify ${userId} about feedback submission failure:`, notifyError)
    }
  }
}

import 'dotenv/config'
import pkg from '@slack/bolt'
const { App, ExpressReceiver } = pkg
import express from 'express'
import { buildInitialTaskEntryView } from './slack/taskEntry.js'
import { openFeedbackModal } from './handlers/feedbackModal.js'
import { handleFeedbackSubmission } from './handlers/feedbackSubmission.js'
import { registerNewTaskCommand } from './handlers/newTask.js'
import {
  handleQualityFeedbackSubmission,
  handleQualityRating,
  handleTaskAcceptance,
} from './handlers/resultAcceptance.js'
import { registerSubmissionHandlers } from './handlers/submission.js'
import {
  ACTION_IDS,
  LEGACY_ACTION_IDS,
  VIEW_CALLBACK_IDS,
  currentAndLegacyActionIdPattern,
  qualityRatingActionIdPattern,
} from './config/interactionIds.js'
import { registerNotionLaunchWebhook } from './notion/launchWebhook.js'
import { registerHomeTab } from './slack/home.js'
import { registerThreadCommentSync } from './slack/threadComments.js'
import { startPolling } from './notion/pollStatus.js'

const token = process.env.SLACK_BOT_TOKEN
console.log('TOKEN CHECK:', token ? `starts with ${token.substring(0, 8)}...` : 'MISSING')
const signingSecret = process.env.SLACK_SIGNING_SECRET

function getSlackRequestContext(req) {
  const body = req.body || {}
  const payload = body.payload ? JSON.parse(body.payload) : body
  const user = payload.user || body.user || {}

  return {
    url: req.url,
    retryNum: req.headers['x-slack-retry-num'] || null,
    retryReason: req.headers['x-slack-retry-reason'] || null,
    bodyType: payload.type || body.type || null,
    callbackId: payload.callback_id || payload.view?.callback_id || null,
    actionId: payload.actions?.[0]?.action_id || null,
    command: body.command || null,
    userId: user.id || body.user_id || null,
  }
}

function logSlackReceiverIssue(message, req, error) {
  let context

  try {
    context = getSlackRequestContext(req)
  } catch (contextError) {
    context = { url: req?.url || null, contextError: contextError?.message || String(contextError) }
  }

  console.error(`${message} ${JSON.stringify({
    ...context,
    error: error?.message || String(error || ''),
  })}`)
}

function parseFeedbackActionValue(value) {
  if (!value) return {}

  try {
    const parsed = JSON.parse(value)
    if (typeof parsed === 'string') return { pageId: parsed }
    return parsed || {}
  } catch {
    return { pageId: value }
  }
}

function getActionMessageSource(body) {
  return {
    channelId: body.channel?.id || body.container?.channel_id || null,
    messageTs: body.message?.ts || body.container?.message_ts || null,
  }
}

async function notifyFeedbackModalOpenFailure(client, body) {
  const channel = body.channel?.id || body.container?.channel_id
  const user = body.user?.id
  const threadTs = body.message?.thread_ts || body.message?.ts || body.container?.message_ts

  if (!channel || !user) return

  try {
    await client.chat.postEphemeral({
      channel,
      user,
      ...(threadTs ? { thread_ts: threadTs } : {}),
      text: 'Не вдалося відкрити форму правок. Натисни кнопку ще раз або онови повідомлення задачі.',
    })
  } catch (error) {
    console.error('Failed to notify user about feedback modal open failure:', error)
  }
}

if (!token || token.trim() === '' || token.trim() === 'placeholder') {
  console.log('⚠️  SLACK_BOT_TOKEN not set — waiting for approval. Server starting in stub mode.')
  const { createServer } = await import('http')
  const server = createServer((req, res) => {
    if (req.method === 'POST') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body)
          if (parsed.type === 'url_verification') {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ challenge: parsed.challenge }))
          }
        } catch (_) {}
        res.writeHead(200)
        res.end('Bot is waiting for Slack token approval.')
      })
    } else {
      res.writeHead(200)
      res.end('Bot is waiting for Slack token approval.')
    }
  })
  server.listen(process.env.PORT || 3000, () => {
    console.log(`🕐 Stub server running on port ${process.env.PORT || 3000}`)
  })
} else {
  const receiver = new ExpressReceiver({
    signingSecret,
    processEventErrorHandler: async ({ error, request, response }) => {
      logSlackReceiverIssue('Slack event processing failed.', request, error)
      if (!response.headersSent) {
        response.writeHead(500)
        response.end()
      }
      return false
    },
    unhandledRequestHandler: ({ request, response }) => {
      logSlackReceiverIssue('Slack request was not acknowledged within the timeout.', request)
      if (!response.headersSent) {
        response.writeHead(404)
        response.end()
      }
    },
  })
  receiver.router.get('/', (req, res) => {
    res.send('OK')
  })
  receiver.router.post('/', (req, res, next) => {
    if (req.body?.type === 'url_verification') {
      res.json({ challenge: req.body.challenge })
    } else {
      next()
    }
  })
  registerNotionLaunchWebhook(receiver.router)

  const app = new App({ token, receiver })

  registerHomeTab(app)
  registerNewTaskCommand(app)
  registerSubmissionHandlers(app)
  registerThreadCommentSync(app)

  // accept_task_result / open_feedback_modal / quality_rating_N слухаються і під
  // старим (пре-namespace), і під новим id: ці action_id "заморожені" всередині
  // вже надісланих DM-повідомлень задач, які можуть бути в роботі тижнями
  // (lead time для деяких типів задач — до 45-60 днів). Легасі-гілку прибрати,
  // коли в Redis не лишиться жодної задачі, створеної до цього релізу.
  // Див. src/config/interactionIds.js.
  app.action(
    currentAndLegacyActionIdPattern(ACTION_IDS.openFeedbackModal, LEGACY_ACTION_IDS.openFeedbackModal),
    async ({ ack, body, client }) => {
      await ack()

      const payload = parseFeedbackActionValue(body.actions?.[0]?.value)
      if (!payload.pageId) {
        console.error('Cannot open feedback modal: missing pageId in action value.')
        return
      }

      try {
        await openFeedbackModal({
          client,
          triggerId: body.trigger_id,
          pageId: payload.pageId,
          taskName: payload.taskName,
          roundNumber: payload.roundNumber,
          sourceMessage: getActionMessageSource(body),
        })
      } catch (error) {
        console.error('Failed to open feedback modal:', error)
        await notifyFeedbackModalOpenFailure(client, body)
      }
    }
  )

  app.view(VIEW_CALLBACK_IDS.feedbackSubmission, async ({ ack, body, view, client }) => {
    await ack()
    await handleFeedbackSubmission({ body, view, client })
  })

  app.action(
    currentAndLegacyActionIdPattern(ACTION_IDS.acceptTaskResult, LEGACY_ACTION_IDS.acceptTaskResult),
    async ({ ack, body, client }) => {
      await ack()
      await handleTaskAcceptance({ body, client })
    }
  )

  app.action(qualityRatingActionIdPattern(), async ({ ack, body, client }) => {
    await ack()
    await handleQualityRating({ body, client })
  })

  app.view(VIEW_CALLBACK_IDS.qualityFeedbackSubmission, async ({ ack, body, view, client }) => {
    await ack()
    await handleQualityFeedbackSubmission({ body, view, client })
  })

  // ── Unity Hub Bot proxy ──────────────────────────────────────────────────────
  // Slack більше не звертається до цього сервісу напряму: єдине Socket Mode
  // з'єднання тримає Unity Hub Bot, який форвардить сюди релевантні payload'и.
  //
  // ВАЖЛИВО про express.json(): ExpressReceiver навішує свій body-parser (з
  // перевіркою Slack-підпису) ТІЛЬКИ на endpoint /slack/events. Інші роути на
  // receiver.router не отримують парсера взагалі, тому він потрібен тут явно.
  const UNITYHUB_PROXY_SECRET = process.env.UNITYHUB_PROXY_SECRET

  receiver.router.post('/internal/unityhub/slack', express.json({ limit: '1mb' }), async (req, res) => {
    if (!UNITYHUB_PROXY_SECRET || req.get('X-Proxy-Secret') !== UNITYHUB_PROXY_SECRET) {
      return res.status(401).json({ ok: false })
    }

    const { kind, payload } = req.body || {}

    // Вхідна точка: Unity Hub Bot показує «PR&Comms Team» у своєму дропдауні і
    // просить у нас перший view вашого візарда, щоб зробити views.update на
    // вже відкритій модалці (trigger_id/view_id лишаються на його боці).
    if (kind === 'entry') {
      try {
        return res.json({ ok: true, view: buildInitialTaskEntryView() })
      } catch (error) {
        console.error('Unity Hub proxy: failed to build entry view:', error)
        return res.status(500).json({ ok: false })
      }
    }

    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ ok: false, error: 'missing payload' })
    }

    // Відповідаємо на момент ack(), а НЕ на завершення processEvent():
    // processEvent резолвиться лише після того, як хендлер добіг до кінця
    // (у tasksbot_submit_task це ще enqueue + chat.postMessage вже ПІСЛЯ ack),
    // а Unity Hub Bot має вкластися у 3-секундне вікно Slack.
    let resolveAck
    const ackPromise = new Promise((resolve) => { resolveAck = resolve })
    let acked = false
    const ack = async (response) => {
      if (acked) return
      acked = true
      resolveAck(response ?? {})
    }

    // .catch() обов'язковий: без нього помилка хендлера стане unhandled
    // rejection і вб'є процес (у цього репо немає process.on('unhandledRejection')).
    const processing = app.processEvent({ body: payload, ack }).catch((error) => {
      console.error('Unity Hub proxy: processEvent failed:', error)
      resolveAck({})
    })

    const guard = new Promise((resolve) => setTimeout(() => resolve({}), 2000))
    const ackBody = await Promise.race([ackPromise, guard])

    void processing // решта хендлера доїжджає у фоні
    return res.json({ ok: true, ack: ackBody })
  })

  const port = process.env.PORT || 3000
  await app.start(port)
  console.log(`⚡ Bot is running on port ${port}`)
  startPolling(app.client)
}

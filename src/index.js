import 'dotenv/config'
import pkg from '@slack/bolt'
const { App, ExpressReceiver } = pkg
import { openFeedbackModal } from './handlers/feedbackModal.js'
import { handleFeedbackSubmission } from './handlers/feedbackSubmission.js'
import { registerNewTaskCommand } from './handlers/newTask.js'
import {
  handleQualityFeedbackSubmission,
  handleQualityRating,
  handleTaskAcceptance,
} from './handlers/resultAcceptance.js'
import { registerSubmissionHandlers } from './handlers/submission.js'
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

  app.action('open_feedback_modal', async ({ ack, body, client }) => {
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
  })

  app.view('feedback_submission', async ({ ack, body, view, client }) => {
    await ack()
    await handleFeedbackSubmission({ body, view, client })
  })

  app.action('accept_task_result', async ({ ack, body, client }) => {
    await ack()
    await handleTaskAcceptance({ body, client })
  })

  app.action(/^quality_rating(?:_\d+)?$/, async ({ ack, body, client }) => {
    await ack()
    await handleQualityRating({ body, client })
  })

  app.view('quality_feedback_submission', async ({ ack, body, view, client }) => {
    await ack()
    await handleQualityFeedbackSubmission({ body, view, client })
  })

  const port = process.env.PORT || 3000
  await app.start(port)
  console.log(`⚡ Bot is running on port ${port}`)
  startPolling(app.client)
}

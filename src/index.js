import 'dotenv/config'
import pkg from '@slack/bolt'
const { App, ExpressReceiver } = pkg
import { registerNewTaskCommand } from './handlers/newTask.js'
import { registerSubmissionHandlers } from './handlers/submission.js'
import { registerHomeTab } from './slack/home.js'
import { startPolling } from './notion/pollStatus.js'

const token = process.env.SLACK_BOT_TOKEN
console.log('TOKEN CHECK:', token ? `starts with ${token.substring(0, 8)}...` : 'MISSING')
const signingSecret = process.env.SLACK_SIGNING_SECRET

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
  const receiver = new ExpressReceiver({ signingSecret })
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

  const app = new App({ token, receiver })

  registerHomeTab(app)
  registerNewTaskCommand(app)
  registerSubmissionHandlers(app)

  const port = process.env.PORT || 3000
  await app.start(port)
  console.log(`⚡ Bot is running on port ${port}`)
  startPolling(app.client)
}

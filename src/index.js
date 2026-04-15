import 'dotenv/config'
import pkg from '@slack/bolt'
const { App } = pkg

import { registerNewTaskCommand } from './handlers/newTask.js'
import { registerSubmissionHandlers } from './handlers/submission.js'
import { startPolling } from './notion/pollStatus.js'

const token = process.env.SLACK_BOT_TOKEN
const signingSecret = process.env.SLACK_SIGNING_SECRET

if (!token || token === 'placeholder') {
  console.log('⚠️  SLACK_BOT_TOKEN not set — waiting for approval. Server starting in stub mode.')
  const { createServer } = await import('http')
  const server = createServer((req, res) => {
    res.writeHead(200)
    res.end('Bot is waiting for Slack token approval.')
  })
  server.listen(process.env.PORT || 3000, () => {
    console.log(`🕐 Stub server running on port ${process.env.PORT || 3000}`)
  })
} else {
  const app = new App({
    token,
    signingSecret,
    socketMode: false,
  })

  registerNewTaskCommand(app)
  registerSubmissionHandlers(app)

  const port = process.env.PORT || 3000
  await app.start(port)
  console.log(`⚡ Bot is running on port ${port}`)
  startPolling(app.client)
}
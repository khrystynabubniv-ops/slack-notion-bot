import 'dotenv/config'
import pkg from '@slack/bolt'
const { App } = pkg

import { registerNewTaskCommand } from './handlers/newTask.js'
import { registerSubmissionHandlers } from './handlers/submission.js'
import { startPolling } from './notion/pollStatus.js'

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
})

registerNewTaskCommand(app)
registerSubmissionHandlers(app)

;(async () => {
  const port = process.env.PORT || 3000
  await app.start(port)
  console.log(`⚡ Bot is running on port ${port}`)
  startPolling(app.client)
})()
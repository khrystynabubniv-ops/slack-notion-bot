import { buildInitialTaskEntryView } from '../slack/taskEntry.js'

export function registerNewTaskCommand(app) {
  app.command('/new-task', async ({ ack, client, body }) => {
    await ack()

    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildInitialTaskEntryView(),
    })
  })
}

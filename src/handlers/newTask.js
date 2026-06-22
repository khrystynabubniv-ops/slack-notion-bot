import { buildInitialTaskEntryView, buildTaskTypePickerView } from '../slack/taskEntry.js'

export function registerNewTaskCommand(app) {
  app.command('/new-task', async ({ ack, client, body }) => {
    await ack()

    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildInitialTaskEntryView(),
    })
  })

  app.command('/event-request', async ({ ack, client, body }) => {
    await ack()

    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildTaskTypePickerView('event'),
    })
  })
}

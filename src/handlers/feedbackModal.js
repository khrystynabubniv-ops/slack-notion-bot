function escapeMrkdwn(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function normalizeRoundNumber(roundNumber) {
  const parsed = Number.parseInt(roundNumber, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export async function openFeedbackModal({
  client,
  triggerId,
  pageId,
  taskName,
  roundNumber,
  sourceMessage,
}) {
  const normalizedRoundNumber = normalizeRoundNumber(roundNumber)
  const normalizedTaskName = taskName || 'Без назви'

  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: 'modal',
      callback_id: 'feedback_submission',
      private_metadata: JSON.stringify({
        pageId,
        taskName: normalizedTaskName,
        roundNumber: normalizedRoundNumber,
        sourceChannelId: sourceMessage?.channelId || null,
        sourceMessageTs: sourceMessage?.messageTs || null,
      }),
      title: { type: 'plain_text', text: `Правка #${normalizedRoundNumber}` },
      submit: { type: 'plain_text', text: 'Надіслати правки' },
      close: { type: 'plain_text', text: 'Скасувати' },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Задача:* ${escapeMrkdwn(normalizedTaskName)}\n*Раунд правок:* ${normalizedRoundNumber}`,
          },
        },
        {
          type: 'input',
          block_id: 'feedback_text',
          element: {
            type: 'plain_text_input',
            action_id: 'feedback_input',
            multiline: true,
            placeholder: { type: 'plain_text', text: 'Опиши зміни максимально детально...' },
          },
          label: { type: 'plain_text', text: 'Правки' },
        },
      ],
    },
  })
}

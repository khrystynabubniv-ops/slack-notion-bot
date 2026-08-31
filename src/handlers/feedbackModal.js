import { VIEW_CALLBACK_IDS } from '../config/interactionIds.js'

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

const FEEDBACK_TYPE_OPTIONS = [
  {
    text: { type: 'plain_text', text: "Об'єктивна" },
    description: { type: 'plain_text', text: 'Є відхилення від ТЗ, формату, факту або вимоги.' },
    value: 'objective',
  },
  {
    text: { type: 'plain_text', text: "Суб'єктивна" },
    description: { type: 'plain_text', text: 'Не зайшов напрям, змінилися очікування або смак.' },
    value: 'subjective',
  },
]

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
      callback_id: VIEW_CALLBACK_IDS.feedbackSubmission,
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
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Перед відправкою перевір, чи ця правка допоможе бізнес-результату: конверсії, клікам, довірі, зрозумілості або швидшому рішенню користувача. Якщо зміна радше про смак чи нове бачення, познач її як субʼєктивну.',
          },
        },
        {
          type: 'input',
          block_id: 'feedback_type',
          element: {
            type: 'radio_buttons',
            action_id: 'feedback_type_input',
            options: FEEDBACK_TYPE_OPTIONS,
          },
          label: { type: 'plain_text', text: 'Тип правки' },
        },
        {
          type: 'input',
          block_id: 'feedback_text',
          element: {
            type: 'plain_text_input',
            action_id: 'feedback_input',
            multiline: true,
            placeholder: { type: 'plain_text', text: 'Що змінити, навіщо це потрібно і який результат очікуємо...' },
          },
          label: { type: 'plain_text', text: 'Правка і очікуваний результат' },
        },
      ],
    },
  })
}

export async function sendStatusUpdate({
  slackClient,
  slackUserId,
  taskName,
  oldStatus,
  newStatus,
  pageUrl,
}) {
  const statusEmoji = {
    'To do': '⬜',
    'In progress': '🔵',
    Comments: '🟠',
    Ready: '🟢',
  }

  await slackClient.chat.postMessage({
    channel: slackUserId,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Оновлення по задачі*\n*${taskName}*`,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Було:*\n${statusEmoji[oldStatus] || '▪️'} ${oldStatus}`,
          },
          {
            type: 'mrkdwn',
            text: `*Стало:*\n${statusEmoji[newStatus] || '▪️'} ${newStatus}`,
          },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '📋 Відкрити в Notion' },
            url: pageUrl,
            style: 'primary',
          },
        ],
      },
    ],
  })
}

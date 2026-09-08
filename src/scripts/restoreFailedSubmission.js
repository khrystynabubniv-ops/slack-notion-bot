// Відновлює задачу з чернетки невдалого сабміту (Redis-ключ
// `failed-submission:<draftId>`, див. saveFailedSubmission() у
// src/redis/store.js та docs/unified-bot-migration-handover.md, розділ 2.7).
//
// Чернетка зберігає payload у "згорнутому" вигляді (`task.*`, `answers.*`),
// а не в тому "плоскому" вигляді, який очікує createTaskFromSubmissionPayload()
// (src/handlers/submission.js) — цей скрипт розгортає її назад.
//
// ВАЖЛИВО: чернетки, збережені ДО фіксу buildFailedSubmissionPayload() (яка
// раніше губила поля domain/platforms/leadTimeWarning), не міститимуть
// `task.domain` — якщо оригінальна задача була в Design і мала обраний
// напрямок ("З якого ти напрямку?"), передай його вручну через --domain.
//
// Запуск:
//   node src/scripts/restoreFailedSubmission.js <draftId>                  — dry-run, друкує розгорнутий payload
//   node src/scripts/restoreFailedSubmission.js <draftId> --domain="..."   — dry-run з підстановкою domain
//   node src/scripts/restoreFailedSubmission.js <draftId> --write          — реально створює Notion-сторінку,
//                                                                             шле Slack-нотифікації, видаляє чернетку
//
// Безпечно: без --write нічого не пишеться і нічого не надсилається.

import 'dotenv/config'
import pkg from '@slack/web-api'
const { WebClient } = pkg
import { deleteFailedSubmission, getFailedSubmission } from '../redis/store.js'
import { createTaskFromSubmissionPayload } from '../handlers/submission.js'

const draftId = process.argv[2]
const WRITE = process.argv.includes('--write')
const domainOverride = process.argv
  .find((arg) => arg.startsWith('--domain='))
  ?.slice('--domain='.length)

if (!draftId) {
  console.error('Usage: node src/scripts/restoreFailedSubmission.js <draftId> [--domain="..."] [--write]')
  process.exit(1)
}

function buildFlatPayload(draft) {
  const { task = {}, answers = {} } = draft

  return {
    departmentKey: task.departmentKey,
    userId: draft.slackUserId,
    userName: draft.slackUserName,
    taskType: task.taskType,
    taskTypeLabel: task.taskTypeLabel,
    name: task.name,
    priority: task.priority,
    deadline: task.deadline,
    context: answers.context,
    style: answers.style,
    antiref: answers.antiref,
    canEditText: answers.canEditText,
    videoFormat: task.videoFormat,
    platform: task.platform,
    platforms: task.platforms || [],
    platformOther: task.platformOther,
    specificFields: answers.specificFields || {},
    fieldAnswers: answers.fieldAnswers || [],
    artifacts: answers.artifacts || {},
    isLate: Boolean(task.isLate),
    domain: domainOverride || task.domain || null,
    leadTimeWarning: draft.leadTimeWarning || null,
  }
}

async function main() {
  const draft = await getFailedSubmission(draftId)

  if (!draft) {
    console.error(`Чернетку не знайдено (можливо, TTL уже сплив): failed-submission:${draftId}`)
    process.exitCode = 1
    return
  }

  const payload = buildFlatPayload(draft)

  console.log(`Мод: ${WRITE ? 'WRITE (реально створить задачу)' : 'dry-run'}`)
  console.log('Розгорнутий payload:')
  console.log(JSON.stringify(payload, null, 2))

  if (!payload.departmentKey || !payload.userId || !payload.taskType) {
    console.error('\nПропущені обов\'язкові поля (departmentKey/userId/taskType) — не можу продовжити.')
    process.exitCode = 1
    return
  }

  if (!WRITE) {
    console.log('\nЦе був dry-run. Запусти з --write, щоб реально створити задачу в Notion і надіслати Slack-нотифікації.')
    return
  }

  const client = new WebClient(process.env.SLACK_BOT_TOKEN)
  const { pageId, pageUrl } = await createTaskFromSubmissionPayload(client, payload)

  console.log(`\nСтворено: ${pageUrl} (pageId: ${pageId})`)

  await deleteFailedSubmission(draftId)
  console.log(`Чернетку failed-submission:${draftId} видалено.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

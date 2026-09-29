// Відновлення задачі з чернетки невдалого сабміту (failed-submission:<draftId>).
//
// Коли Notion остаточно відхилив створення задачі, користувач отримує в Slack
// код чернетки на кшталт `failed-1790684611384-vy8w7u`. Цей скрипт читає
// чернетку з Redis, показує причину помилки і (з --write) ставить бриф назад у
// звичайну чергу task-submission-queue. Далі все робить worker запущеного
// бота: створює сторінку в Notion і пише користувачу в DM, як при звичайному
// сабміті.
//
// Запуск (з тими самими env, що й бот — напр. `railway run ...`):
//   npm run restore:failed-submission -- <draftId>            — dry-run: показує помилку і payload
//   npm run restore:failed-submission -- <draftId> --write    — ставить задачу в чергу
//
// Додаткові прапорці:
//   --domain <value>  — задати напрямок Design, якщо його немає в старій чернетці
//   --force           — відновити ще раз, навіть якщо чернетку вже відновлювали
//
// Чернетки, збережені до появи поля submissionPayload, не містять domain,
// platforms (крім першої платформи) і leadTimeWarning — скрипт відтворює
// payload зі структурованих полів task/answers і попереджає про це.
//
// Якщо причина помилки не тимчасова (напр. validation_error від Notion через
// неіснуючу опцію select), спершу виправ її в Notion або в конфігу — інакше
// відновлена задача знову впаде в нову чернетку.

import 'dotenv/config'
import {
  getFailedSubmission,
  enqueueTaskSubmission,
  markFailedSubmissionRestored,
} from '../redis/store.js'

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const FORCE = args.includes('--force')
const domainFlagIndex = args.indexOf('--domain')
const DOMAIN_OVERRIDE = domainFlagIndex >= 0 ? args[domainFlagIndex + 1] : null
const draftId = args.find(
  (arg, index) => !arg.startsWith('--') && (domainFlagIndex < 0 || index !== domainFlagIndex + 1)
)

function rebuildLegacySubmissionPayload(draft) {
  const task = draft.task || {}
  const answers = draft.answers || {}

  return {
    departmentKey: task.departmentKey,
    userId: draft.slackUserId,
    userName: draft.slackUserName,
    slackPersonName: draft.requesterName || draft.slackUserName,
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
    platforms: task.platform ? [task.platform] : [],
    platformOther: task.platformOther,
    specificFields: answers.specificFields,
    fieldAnswers: answers.fieldAnswers,
    artifacts: answers.artifacts,
    isLate: Boolean(task.isLate),
    domain: null,
    leadTimeWarning: null,
    values: draft.rawSlackValues,
  }
}

async function main() {
  if (!draftId) {
    console.error('Usage: npm run restore:failed-submission -- <draftId> [--write] [--domain <value>] [--force]')
    process.exit(1)
  }

  const draft = await getFailedSubmission(draftId)
  if (!draft) {
    console.error(
      `Чернетку ${draftId} не знайдено в Redis. Перевір REDIS_KEY_PREFIX ` +
        `(prod/test) і чи не сплив FAILED_SUBMISSION_TTL_SECONDS.`
    )
    process.exit(1)
  }

  console.log(`Чернетка: ${draftId} (створена ${draft.createdAt})`)
  console.log(`Автор: ${draft.requesterName || draft.slackUserName} (${draft.slackUserId})`)
  console.log(`Задача: ${draft.task?.name} [${draft.task?.departmentKey} / ${draft.task?.taskType}]`)
  console.log('Помилка при створенні:', JSON.stringify(draft.error, null, 2))

  if (draft.restoredAt && !FORCE) {
    console.error(
      `Чернетку вже відновлено ${draft.restoredAt} (queueId ${draft.restoredQueueId}). ` +
        `Перевір Notion; щоб поставити в чергу ще раз — додай --force.`
    )
    process.exit(1)
  }

  const isLegacyDraft = !draft.submissionPayload
  // attempts з попередньої черги не переносимо — відновлена задача отримує
  // повний набір ретраїв заново.
  const { attempts: _previousAttempts, ...basePayload } = isLegacyDraft
    ? rebuildLegacySubmissionPayload(draft)
    : draft.submissionPayload
  const submissionPayload = {
    ...basePayload,
    ...(DOMAIN_OVERRIDE ? { domain: DOMAIN_OVERRIDE } : {}),
  }

  if (isLegacyDraft) {
    console.warn(
      'Стара чернетка без submissionPayload: domain, додаткові platforms і leadTimeWarning ' +
        'не збережені. Для Design-задачі передай --domain <value>, якщо напрямок важливий.'
    )
  }

  console.log('Payload для черги:', JSON.stringify(submissionPayload, null, 2))

  if (!WRITE) {
    console.log('\nDry-run: нічого не записано. Додай --write, щоб поставити задачу в чергу.')
    return
  }

  const { queueId } = await enqueueTaskSubmission(submissionPayload)
  await markFailedSubmissionRestored(draftId, { queueId })
  console.log(
    `\nЗадачу поставлено в чергу: ${queueId}. Запущений бот створить її в Notion ` +
      `і напише автору в DM протягом кількох секунд.`
  )
}

main().catch((error) => {
  console.error('Restore failed:', error)
  process.exit(1)
})

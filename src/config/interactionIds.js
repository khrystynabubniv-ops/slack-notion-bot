// Централізований реєстр Slack callback_id / action_id цього бота.
//
// Навіщо: усі view callback_id і action_id раніше були "голими" загальними
// словами (submit_task, select_department, platform, accept_task_result...).
// Якщо цей код зливають/переносять в інший (unified) Slack-бот, який має
// власні обробники з такими самими іменами — Bolt викличе ОБИДВА обробники
// на один і той самий callback_id/action_id (подвійний ack, конфліктні
// side-effects, а для `platform` — навіть перезапис чужої відкритої модалки).
// Див. docs/unified-bot-migration-handover.md, розділ 17, пункт 1.
//
// Тому всі id цього бота тепер живуть під одним префіксом NAMESPACE і в
// одному файлі — щоб (а) зменшити ймовірність колізії з іншим ботом і
// (б) унеможливити клас багів "перейменували в одному місці, забули в
// іншому" (так уже траплялося: guard на submission.js:1051 звіряв
// callback_id окремим хардкодженим рядком-дублікатом).
//
// Legacy-секція нижче — тимчасова: три action_id (accept_task_result,
// open_feedback_modal, quality_rating_N) "заморожені" всередині вже
// надісланих Slack DM-повідомлень (кнопки на задачах, які вже в роботі).
// Перейменування коду не змінює ці повідомлення заднім числом, тож без
// legacy-підтримки кнопки на них стануть мертвими одразу після деплою.
// View callback_id (модалки) такої проблеми не мають — модалка живе лише
// в межах однієї сесії користувача, тому для них legacy-варіант не потрібен.

const NAMESPACE = 'tasksbot'

export const VIEW_CALLBACK_IDS = Object.freeze({
  selectDepartment: `${NAMESPACE}_select_department`,
  selectDesignDomain: `${NAMESPACE}_select_design_domain`,
  selectTaskType: `${NAMESPACE}_select_task_type`,
  selectTaskComplexity: `${NAMESPACE}_select_task_complexity`,
  submitTask: `${NAMESPACE}_submit_task`,
  feedbackSubmission: `${NAMESPACE}_feedback_submission`,
  qualityFeedbackSubmission: `${NAMESPACE}_quality_feedback_submission`,
})

export const ACTION_IDS = Object.freeze({
  openNewTaskFromHome: `${NAMESPACE}_open_new_task_from_home`,
  openFeedbackModal: `${NAMESPACE}_open_feedback_modal`,
  acceptTaskResult: `${NAMESPACE}_accept_task_result`,
  qualityRatingPrefix: `${NAMESPACE}_quality_rating`,
  platform: `${NAMESPACE}_platform`,
})

// ---- Legacy (пре-namespace) action_id — ТІЛЬКИ для прослуховування (backward-compat) ----
// Ніколи не використовуй їх для нових кнопок. Видали цю секцію і відповідні
// regex-матчі в index.js/notify.js/home.js, коли в Redis (getAllTasks())
// не залишиться жодної задачі, створеної до релізу з перейменуванням —
// тобто коли всі активні кнопки на старих DM-повідомленнях фізично зникли.
export const LEGACY_ACTION_IDS = Object.freeze({
  openNewTaskFromHome: 'open_new_task_from_home',
  openFeedbackModal: 'open_feedback_modal',
  acceptTaskResult: 'accept_task_result',
  qualityRatingPrefix: 'quality_rating',
})

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Regex-матчер, що приймає і новий (namespaced), і legacy action_id —
// для кнопок, які могли бути надіслані до перейменування.
export function currentAndLegacyActionIdPattern(currentId, legacyId) {
  return new RegExp(`^(?:${escapeRegExp(currentId)}|${escapeRegExp(legacyId)})$`)
}

export function buildQualityRatingActionId(rating) {
  return `${ACTION_IDS.qualityRatingPrefix}_${rating}`
}

// Приймає і tasksbot_quality_rating_5, і старий quality_rating_5.
export function qualityRatingActionIdPattern() {
  return new RegExp(
    `^(?:${escapeRegExp(ACTION_IDS.qualityRatingPrefix)}|${escapeRegExp(LEGACY_ACTION_IDS.qualityRatingPrefix)})(?:_\\d+)?$`
  )
}

export function isSubmitTaskView(callbackId) {
  return callbackId === VIEW_CALLBACK_IDS.submitTask
}

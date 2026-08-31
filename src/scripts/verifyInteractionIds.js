// Автономна (без Slack/Notion/Redis) перевірка перейменування callback_id/action_id
// під namespace `tasksbot_*` — див. src/config/interactionIds.js і
// docs/unified-bot-migration-handover.md, розділ 17, пункт 1.
//
// Запуск: node src/scripts/verifyInteractionIds.js  (або npm run verify:ids)
//
// Що перевіряє:
//   1. Кожна view-білдер-функція повертає саме namespaced callback_id
//      (а не старий "голий" рядок і не помилково інший).
//   2. Legacy-regex-матчери приймають і старий, і новий action_id, і НЕ
//      приймають довільний сторонній action_id (щоб не стати надто широким
//      патерном, який сам створює нову колізію).
//   3. Design-модалка справді генерує блок з action_id = ACTION_IDS.platform
//      (а не залишковий 'platform') для типів задач, де є поле "Платформа".
//   4. Guard isSubmitTaskView коректно відрізняє "наш" submit_task view від
//      чужого.
//
// Це НЕ інтеграційний тест (Slack/Notion API не викликаються) — лише
// статична перевірка, що обидва боки кожного перейменування (визначення id
// і місце, де він звіряється) залишились синхронізовані. Саме такий клас
// багів і стався один раз з guard-ом на submission.js:1051 до рефакторингу.

import assert from 'node:assert/strict'
import {
  ACTION_IDS,
  LEGACY_ACTION_IDS,
  VIEW_CALLBACK_IDS,
  buildQualityRatingActionId,
  currentAndLegacyActionIdPattern,
  isSubmitTaskView,
  qualityRatingActionIdPattern,
} from '../config/interactionIds.js'
import {
  buildDepartmentPickerView,
  buildDesignDomainPickerView,
  buildTaskComplexityPickerView,
  buildTaskTypePickerView,
} from '../slack/taskEntry.js'
import { getModalBlocks } from '../handlers/modalBlocks.js'

let passed = 0

function check(label, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${label}`)
  } catch (error) {
    console.error(`  ✗ ${label}`)
    console.error(`    ${error.message}`)
    process.exitCode = 1
  }
}

console.log('1) Namespace — усі id справді під префіксом "tasksbot_"')
check('VIEW_CALLBACK_IDS', () => {
  for (const [key, value] of Object.entries(VIEW_CALLBACK_IDS)) {
    assert.match(value, /^tasksbot_/, `${key} = "${value}" не має tasksbot_ префіксу`)
  }
})
check('ACTION_IDS', () => {
  for (const [key, value] of Object.entries(ACTION_IDS)) {
    assert.match(value, /^tasksbot_/, `${key} = "${value}" не має tasksbot_ префіксу`)
  }
})

console.log('\n2) View-білдери повертають саме namespaced callback_id (Група A)')
check('buildDepartmentPickerView → tasksbot_select_department', () => {
  assert.equal(buildDepartmentPickerView().callback_id, VIEW_CALLBACK_IDS.selectDepartment)
})
check('buildDesignDomainPickerView → tasksbot_select_design_domain', () => {
  assert.equal(buildDesignDomainPickerView({ departmentKey: 'design' }).callback_id, VIEW_CALLBACK_IDS.selectDesignDomain)
})
check('buildTaskTypePickerView → tasksbot_select_task_type', () => {
  assert.equal(buildTaskTypePickerView('design').callback_id, VIEW_CALLBACK_IDS.selectTaskType)
})
check('buildTaskComplexityPickerView → tasksbot_select_task_complexity', () => {
  const view = buildTaskComplexityPickerView({
    departmentKey: 'event',
    taskType: 'event_internal',
    taskTypeLabel: 'Організація події (внутрішня локація)',
  })
  assert.equal(view.callback_id, VIEW_CALLBACK_IDS.selectTaskComplexity)
})

console.log('\n3) Design-блок "Платформа" використовує ACTION_IDS.platform, не старий "platform" (Група C)')
for (const taskType of ['static_simple', 'static_complex', 'ai_static_simple', 'ai_static_complex', 'ai_dynamic_simple', 'ai_dynamic_complex']) {
  check(`getModalBlocks('${taskType}') → platform_block.element.action_id === ACTION_IDS.platform`, () => {
    const blocks = getModalBlocks(taskType, {}, { departmentKey: 'design' })
    const platformBlock = blocks.find((block) => block.block_id === 'platform_block')
    assert.ok(platformBlock, `platform_block відсутній у блоках для ${taskType}`)
    assert.equal(platformBlock.element.action_id, ACTION_IDS.platform)
    assert.notEqual(platformBlock.element.action_id, 'platform', 'action_id все ще старий "platform" — колізія Групи C не виправлена')
  })
}
check('carousel має опційне platform_block з ACTION_IDS.platform', () => {
  const blocks = getModalBlocks('carousel', {}, { departmentKey: 'design' })
  const platformBlock = blocks.find((block) => block.block_id === 'platform_block')
  assert.ok(platformBlock)
  assert.equal(platformBlock.element.action_id, ACTION_IDS.platform)
})

console.log('\n4) isSubmitTaskView guard (Група C і D)')
check('true для нашого view', () => {
  assert.equal(isSubmitTaskView(VIEW_CALLBACK_IDS.submitTask), true)
})
check('false для legacy "submit_task" (guard навмисно НЕ підтримує legacy — модалки ефемерні)', () => {
  assert.equal(isSubmitTaskView('submit_task'), false)
})
check('false для чужого/сторонього callback_id', () => {
  assert.equal(isSubmitTaskView('some_other_bots_view'), false)
})
check('false для undefined (view відсутній)', () => {
  assert.equal(isSubmitTaskView(undefined), false)
})

console.log('\n5) Backward-compat regex для message-persisted action_id (Група B)')
check('accept_task_result: приймає і новий, і legacy id', () => {
  const pattern = currentAndLegacyActionIdPattern(ACTION_IDS.acceptTaskResult, LEGACY_ACTION_IDS.acceptTaskResult)
  assert.ok(pattern.test(ACTION_IDS.acceptTaskResult), 'не приймає новий id')
  assert.ok(pattern.test(LEGACY_ACTION_IDS.acceptTaskResult), 'не приймає legacy id (зламає старі кнопки на задачах у роботі)')
  assert.ok(!pattern.test('accept_task_result_extra'), 'патерн занадто широкий — приймає зайве')
  assert.ok(!pattern.test('some_unrelated_action'), 'патерн занадто широкий — приймає сторонній action_id')
})
check('open_feedback_modal: приймає і новий, і legacy id', () => {
  const pattern = currentAndLegacyActionIdPattern(ACTION_IDS.openFeedbackModal, LEGACY_ACTION_IDS.openFeedbackModal)
  assert.ok(pattern.test(ACTION_IDS.openFeedbackModal))
  assert.ok(pattern.test(LEGACY_ACTION_IDS.openFeedbackModal))
  assert.ok(!pattern.test('open_feedback_modal_v2'))
})
check('open_new_task_from_home: приймає і новий, і legacy id', () => {
  const pattern = currentAndLegacyActionIdPattern(ACTION_IDS.openNewTaskFromHome, LEGACY_ACTION_IDS.openNewTaskFromHome)
  assert.ok(pattern.test(ACTION_IDS.openNewTaskFromHome))
  assert.ok(pattern.test(LEGACY_ACTION_IDS.openNewTaskFromHome))
})
check('quality_rating_N: приймає новий і legacy для рейтингів 1-5, відхиляє сторонні', () => {
  const pattern = qualityRatingActionIdPattern()
  for (let rating = 1; rating <= 5; rating += 1) {
    assert.ok(pattern.test(buildQualityRatingActionId(rating)), `не приймає новий ${buildQualityRatingActionId(rating)}`)
    assert.ok(pattern.test(`${LEGACY_ACTION_IDS.qualityRatingPrefix}_${rating}`), `не приймає legacy quality_rating_${rating}`)
  }
  assert.ok(!pattern.test('quality_rating_extra_thing'), 'патерн занадто широкий')
  assert.ok(!pattern.test('some_quality_rating_5_suffix'), 'патерн не має матчити підрядок')
})
check('buildQualityRatingActionId(5) === "tasksbot_quality_rating_5"', () => {
  assert.equal(buildQualityRatingActionId(5), 'tasksbot_quality_rating_5')
})

console.log(`\n${process.exitCode ? '❌ Є провалені перевірки' : `✅ Усі ${passed} перевірок пройшли`}`)

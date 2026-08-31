// Автономна (без Slack/Notion/Redis) перевірка чистих функцій, які
// migration-handover.md (розділ 17, пункт 12) називає найкритичнішими
// кандидатами на unit-тести: getDaysUntil / getLeadTimeViolation
// (src/handlers/submission.js), isCompletedStatus / isQualitySurveyStatus
// (src/notion/pollStatus.js), buildRichText (src/notion/richText.js).
//
// Це не заміна повного тестового фреймворку (в package.json його й досі
// немає) — просто credential-free baseline, який ловить регресії в логіці,
// що безпосередньо впливає на реальну поведінку бота: чи вважається дедлайн
// "запізнім", чи вважається статус "завершеним"/"вартим quality survey", і
// чи коректно збирається rich_text для Notion-коментарів/body.
//
// Запуск: node src/scripts/verifyPureHelpers.js (або npm run verify:pure-helpers)

import assert from 'node:assert/strict'
import { getDaysUntil, getLeadTimeViolation } from '../handlers/submission.js'
import { isCompletedStatus, isQualitySurveyStatus } from '../notion/pollStatus.js'
import { getDepartment } from '../config/departments.js'
import { buildRichText } from '../notion/richText.js'

let passed = 0
let failed = false

function check(label, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${label}`)
  } catch (error) {
    failed = true
    console.error(`  ✗ ${label}`)
    console.error(`    ${error.message}`)
  }
}

function dateStringOffsetFromToday(days) {
  // getDaysUntil() parses "YYYY-MM-DDT00:00:00" as LOCAL midnight — must build
  // the string from local Y/M/D components, NOT toISOString() (UTC), or this
  // silently shifts by a day whenever the local timezone isn't UTC.
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + days)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

console.log('1) getDaysUntil')
check('null для порожнього значення', () => {
  assert.equal(getDaysUntil(null), null)
  assert.equal(getDaysUntil(undefined), null)
  assert.equal(getDaysUntil(''), null)
})
check('null для невалідної дати', () => {
  assert.equal(getDaysUntil('не дата'), null)
})
check('0 для сьогодні, 1 для завтра, -1 для вчора', () => {
  assert.equal(getDaysUntil(dateStringOffsetFromToday(0)), 0)
  assert.equal(getDaysUntil(dateStringOffsetFromToday(1)), 1)
  assert.equal(getDaysUntil(dateStringOffsetFromToday(-1)), -1)
})

console.log('\n2) getLeadTimeViolation (на прикладі design/static_simple, minLeadDays=2 за замовчуванням)')
check('дедлайн далеко попереду (5 днів) — без порушення', () => {
  const result = getLeadTimeViolation({
    departmentKey: 'design',
    taskType: 'static_simple',
    deadline: dateStringOffsetFromToday(5),
    values: {},
  })
  assert.equal(result, null)
})
check('дедлайн рівно на межі SLA (2 дні = minLeadDays) — без порушення', () => {
  const result = getLeadTimeViolation({
    departmentKey: 'design',
    taskType: 'static_simple',
    deadline: dateStringOffsetFromToday(2),
    values: {},
  })
  assert.equal(result, null)
})
check('дедлайн ближче за SLA (сьогодні, 0 днів) — порушення з правильними полями', () => {
  const result = getLeadTimeViolation({
    departmentKey: 'design',
    taskType: 'static_simple',
    deadline: dateStringOffsetFromToday(0),
    values: {},
  })
  assert.ok(result, 'мало бути порушення')
  assert.equal(result.minLeadDays, 2)
  assert.equal(result.providedLeadDays, 0)
  assert.equal(result.override, null)
})
check('override "late" з lead_time_override_block читається коректно', () => {
  const result = getLeadTimeViolation({
    departmentKey: 'design',
    taskType: 'static_simple',
    deadline: dateStringOffsetFromToday(0),
    values: {
      lead_time_override_block: {
        lead_time_override: { selected_option: { value: 'late' } },
      },
    },
  })
  assert.equal(result.override, 'late')
})
check('без дедлайна — null (нема що перевіряти)', () => {
  assert.equal(getLeadTimeViolation({ departmentKey: 'design', taskType: 'static_simple', deadline: null, values: {} }), null)
})
check('невідомий/без-lead-time тип задачі — ніколи не порушення', () => {
  assert.equal(
    getLeadTimeViolation({
      departmentKey: 'design',
      taskType: 'totally_unknown_task_type',
      deadline: dateStringOffsetFromToday(0),
      values: {},
    }),
    null
  )
})

console.log('\n3) isCompletedStatus / isQualitySurveyStatus')
const designDepartment = getDepartment('design')
const smmDepartment = getDepartment('smm')
check('Design "Ready" — completed', () => {
  assert.equal(isCompletedStatus('Ready', designDepartment), true)
})
check('Design "To do" — НЕ completed', () => {
  assert.equal(isCompletedStatus('To do', designDepartment), false)
})
check('будь-який департамент: статус, що містить "cancel"/"скас" — completed (навіть якщо не в списку)', () => {
  assert.equal(isCompletedStatus('Cancelled by requester', designDepartment), true)
  assert.equal(isCompletedStatus('Скасовано', smmDepartment), true)
})
check('SMM "Published" — completed', () => {
  assert.equal(isCompletedStatus('Published', smmDepartment), true)
})
check('SMM "Published" — саме той статус, що тригерить quality survey', () => {
  assert.equal(isQualitySurveyStatus('Published', smmDepartment), true)
})
check('Design "Ready" — тригерить quality survey', () => {
  assert.equal(isQualitySurveyStatus('Ready', designDepartment), true)
})
check('регістр і зайві пробіли не впливають (" ready ")', () => {
  assert.equal(isQualitySurveyStatus(' ready ', designDepartment), true)
  assert.equal(isCompletedStatus(' READY ', designDepartment), true)
})

console.log('\n4) buildRichText')
check('порожній рядок без emptyText → []', () => {
  assert.deepEqual(buildRichText(''), [])
})
check('порожній рядок з emptyText → один текстовий обʼєкт з emptyText', () => {
  const result = buildRichText('', { emptyText: ' ' })
  assert.equal(result.length, 1)
  assert.equal(result[0].text.content, ' ')
})
check('звичайний текст без URL — один текстовий обʼєкт без link', () => {
  const result = buildRichText('Просто текст без посилань')
  assert.equal(result.length, 1)
  assert.equal(result[0].text.content, 'Просто текст без посилань')
  assert.equal(result[0].text.link, undefined)
})
check('URL у тексті стає окремим text-об\'єктом з link.url', () => {
  const result = buildRichText('Деталі тут: https://example.com/path подивись')
  const linkObject = result.find((object) => object.text.link)
  assert.ok(linkObject, 'мав бути хоча б один об\'єкт з link')
  assert.equal(linkObject.text.link.url, 'https://example.com/path')
})
check('кінцева пунктуація після URL НЕ входить у сам лінк', () => {
  const result = buildRichText('Дивись https://example.com.')
  const linkObject = result.find((object) => object.text.link)
  assert.ok(linkObject)
  assert.equal(linkObject.text.link.url, 'https://example.com/')
})
check('домен в email (user@example.com) НЕ перетворюється на лінк', () => {
  const result = buildRichText('Пиши на user@example.com будь ласка')
  const hasLink = result.some((object) => object.text.link)
  assert.equal(hasLink, false)
})
check('дуже довгий текст обрізається з приміткою, а не падає', () => {
  const hugeText = 'а'.repeat(500000)
  const result = buildRichText(hugeText)
  assert.ok(result.length > 0)
  assert.ok(result.length <= 100, 'не має перевищувати RICH_TEXT_OBJECT_LIMIT')
})

console.log(`\n${failed ? '❌ Є провалені перевірки' : `✅ Усі ${passed} перевірок пройшли`}`)
process.exitCode = failed ? 1 : 0

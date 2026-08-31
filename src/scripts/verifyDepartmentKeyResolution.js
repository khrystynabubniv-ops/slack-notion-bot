// Автономна (без Slack/Notion/Redis) перевірка resolveDepartmentKey() —
// зокрема нової поведінки: "поле відсутнє" (безпечний legacy-кейс, тихо) vs
// "значення задане, але не розпізнається" (підозріліший кейс, тепер з
// попередженням у лог). Див. docs/unified-bot-migration-handover.md,
// розділ 17, пункт 2.
//
// Запуск: node src/scripts/verifyDepartmentKeyResolution.js
//         (або npm run verify:department-key)

import assert from 'node:assert/strict'
import { DEFAULT_DEPARTMENT_KEY, resolveDepartmentKey } from '../config/departments.js'

let passed = 0

function withCapturedWarnings(fn) {
  const originalWarn = console.warn
  const warnings = []
  console.warn = (...args) => warnings.push(args.join(' '))

  try {
    const result = fn()
    return { result, warnings }
  } finally {
    console.warn = originalWarn
  }
}

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

console.log('1) Відсутнє значення (legacy-записи до Phase 2) — тихий fallback, БЕЗ warning')
for (const missingValue of [undefined, null, '']) {
  check(`resolveDepartmentKey(${JSON.stringify(missingValue)}) === "${DEFAULT_DEPARTMENT_KEY}", без warning`, () => {
    const { result, warnings } = withCapturedWarnings(() => resolveDepartmentKey(missingValue))
    assert.equal(result, DEFAULT_DEPARTMENT_KEY)
    assert.equal(warnings.length, 0, `не мало бути warning, отримали: ${JSON.stringify(warnings)}`)
  })
}

console.log('\n2) Розпізнані активні відділи — без warning, повертають самі себе')
check('resolveDepartmentKey("design") === "design", без warning', () => {
  const { result, warnings } = withCapturedWarnings(() => resolveDepartmentKey('design'))
  assert.equal(result, 'design')
  assert.equal(warnings.length, 0)
})
check('resolveDepartmentKey("smm") === "smm", без warning', () => {
  const { result, warnings } = withCapturedWarnings(() => resolveDepartmentKey('smm'))
  assert.equal(result, 'smm')
  assert.equal(warnings.length, 0)
})

console.log('\n3) Значення задане, але НЕ розпізнається — тепер з явним warning (раніше — тихо)')
check('resolveDepartmentKey("totally_bogus_key") === design + рівно 1 warning', () => {
  const bogusKey = `bogus_${Date.now()}`
  const { result, warnings } = withCapturedWarnings(() => resolveDepartmentKey(bogusKey))
  assert.equal(result, DEFAULT_DEPARTMENT_KEY)
  assert.equal(warnings.length, 1, `очікували рівно 1 warning, отримали ${warnings.length}`)
  assert.match(warnings[0], new RegExp(bogusKey))
})
check('той самий невідомий ключ вдруге — warning НЕ дублюється (дедуп per-process)', () => {
  const bogusKey = `bogus-dedup-${Date.now()}`
  withCapturedWarnings(() => resolveDepartmentKey(bogusKey)) // перший виклик — це і є перша поява
  const { warnings } = withCapturedWarnings(() => resolveDepartmentKey(bogusKey)) // другий виклик
  assert.equal(warnings.length, 0, 'другий виклик з тим самим bogus-ключем не мав повторно логувати')
})
check('resolveDepartmentKey("event") без EVENT_DEPARTMENT_ENABLED — визнаний, але неактивний відділ, з warning', () => {
  // У чистому середовищі (без .env/EVENT_DEPARTMENT_ENABLED) event неактивний —
  // це саме той "визнаний, але не active" кейс, який раніше зливався з legacy.
  if (process.env.EVENT_DEPARTMENT_ENABLED || process.env.NOTION_EVENT_DATABASE_ID) {
    console.log('    (пропущено: EVENT_DEPARTMENT_ENABLED/NOTION_EVENT_DATABASE_ID заданий у цьому середовищі)')
    return
  }

  const { result, warnings } = withCapturedWarnings(() => resolveDepartmentKey('event'))
  assert.equal(result, DEFAULT_DEPARTMENT_KEY)
  assert.equal(warnings.length, 1)
})

console.log(`\n${process.exitCode ? '❌ Є провалені перевірки' : `✅ Усі ${passed} перевірок пройшли`}`)

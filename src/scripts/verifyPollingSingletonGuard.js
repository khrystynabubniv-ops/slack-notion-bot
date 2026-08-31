// Автономна (без Slack/Notion/Redis) перевірка guard'а в startPolling() —
// другий виклик у тому самому процесі має бути безпечним no-op, а не
// другим незалежним набором setTimeout/setInterval per department.
// Див. docs/unified-bot-migration-handover.md, розділ 17, пункт 3.
//
// Запуск: node src/scripts/verifyPollingSingletonGuard.js
//         (або npm run verify:polling-guard)
//
// Примітка: startPolling() лише ПЛАНУЄ таймери (перший реальний прогін —
// щонайменше через pollIntervalSec, за замовчуванням 180с) — до жодного
// Notion/Slack API запиту тут не доходить. Скрипт завершується явним
// process.exit(), щоб не чекати на ці таймери.

import assert from 'node:assert/strict'
import { getAllDepartments } from '../config/departments.js'
import { startPolling } from '../notion/pollStatus.js'

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

function withCapturedConsole(fn) {
  const originalLog = console.log
  const originalWarn = console.warn
  const logs = []
  const warnings = []
  console.log = (...args) => logs.push(args.join(' '))
  console.warn = (...args) => warnings.push(args.join(' '))

  try {
    fn()
    return { logs, warnings }
  } finally {
    console.log = originalLog
    console.warn = originalWarn
  }
}

const fakeSlackClient = {}
const activeDepartmentCount = getAllDepartments().length

console.log(`1) Перший виклик startPolling() планує таймери для всіх ${activeDepartmentCount} активних відділів`)
const firstCall = withCapturedConsole(() => startPolling(fakeSlackClient))
check(`рівно ${activeDepartmentCount} рядків "Polling scheduled", 0 warning`, () => {
  const scheduledLines = firstCall.logs.filter((line) => line.includes('Polling scheduled for'))
  assert.equal(scheduledLines.length, activeDepartmentCount)
  assert.equal(firstCall.warnings.length, 0)
})

console.log('\n2) Другий виклик у тому самому процесі — no-op, БЕЗ нового набору таймерів')
const secondCall = withCapturedConsole(() => startPolling(fakeSlackClient))
check('0 нових "Polling scheduled" рядків, рівно 1 warning про повторний виклик', () => {
  const scheduledLines = secondCall.logs.filter((line) => line.includes('Polling scheduled for'))
  assert.equal(scheduledLines.length, 0, 'другий виклик не мав планувати нові таймери')
  assert.equal(secondCall.warnings.length, 1)
  assert.match(secondCall.warnings[0], /startPolling\(\) called again/)
})

console.log('\n3) Третій виклик — так само тихий no-op (guard не одноразовий, а стійкий)')
const thirdCall = withCapturedConsole(() => startPolling(fakeSlackClient))
check('0 нових таймерів, рівно 1 warning', () => {
  const scheduledLines = thirdCall.logs.filter((line) => line.includes('Polling scheduled for'))
  assert.equal(scheduledLines.length, 0)
  assert.equal(thirdCall.warnings.length, 1)
})

console.log(`\n${failed ? '❌ Є провалені перевірки' : `✅ Усі ${passed} перевірок пройшли`}`)

// startPolling() (перший виклик) реально запланував setTimeout на ~хвилини
// вперед — не чекаємо на них.
process.exit(failed ? 1 : 0)

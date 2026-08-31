// Статична (без мережевих викликів) перевірка контракту: КОЖЕН виклик
// Notion API в цьому кодовому дереві має проходити через notionRequest()
// (src/notion/request.js) — єдиний спільний throttle+retry чергувальник
// на процес. Сам notionRequest() уже коректно шерить свій internal queue
// між усіма своїми викликами в межах ОДНОГО модуля/процесу — ризик не в
// ньому, а в тому, що НІЩО не заважає майбутньому коду (своєму чи, після
// перенесення в unified-бот, чужому) викликати `notion.pages.create(...)`
// напряму, в обхід цієї черги. Тоді сумарний rate до Notion API вже не
// контролюється єдиним лічильником, і 429 з однієї фічі "з'їдає" retry-
// бюджет іншої. Див. docs/unified-bot-migration-handover.md, розділ 17,
// пункт 4.
//
// Це НЕ повноцінний AST-лінтер — проста текстова евристика: для кожного
// рядка з "сирим" викликом notion.<domain>.<method>(...) перевіряє, чи є
// notionRequest( у цьому ж рядку або в кількох попередніх (типовий у цьому
// репо ідіом — `notionRequest(() => notion.pages.retrieve(...), 'label')`).
// Може пропустити нетиповий стиль коду — це прийнятно для baseline-guard,
// не заміна ручного рев'ю.
//
// Запуск: node src/scripts/verifyNotionThrottleUsage.js
//         (або npm run verify:notion-throttle)

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname
const SRC_DIR = join(ROOT, 'src')
const LOOKBACK_LINES = 4
const RAW_CALL_PATTERN = /\bnotion\w*\.(pages|databases|blocks|comments|users)\.\w+\s*\(/
const WRAPPER_PATTERN = /\bnotionRequest\s*\(/
const CLIENT_INSTANTIATION_PATTERN = /\bnew Client\s*\(/

function listJsFiles(dir) {
  const files = []

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stats = statSync(fullPath)

    if (stats.isDirectory()) {
      files.push(...listJsFiles(fullPath))
    } else if (entry.endsWith('.js')) {
      files.push(fullPath)
    }
  }

  return files
}

// Груба відсічка коментарів — не парсер, просто щоб "// notion.pages.create(...)"
// у прозі/докстрінгах не рахувалось як реальний виклик. Не обробляє
// багаторядкові /* */ коментарі і рядки з "//" усередині рядкового літералу,
// але для стилю коду в цьому репо (де такого немає) цього достатньо.
function stripLineComment(line) {
  const trimmed = line.trim()
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return ''

  const commentIndex = line.indexOf('//')
  return commentIndex === -1 ? line : line.slice(0, commentIndex)
}

function checkFile(filePath) {
  const relativePath = relative(ROOT, filePath)
  const rawLines = readFileSync(filePath, 'utf8').split('\n')
  const codeLines = rawLines.map(stripLineComment)
  const violations = []
  let clientInstantiations = 0

  codeLines.forEach((line, index) => {
    if (CLIENT_INSTANTIATION_PATTERN.test(line)) clientInstantiations += 1

    if (!RAW_CALL_PATTERN.test(line)) return

    const windowStart = Math.max(0, index - LOOKBACK_LINES)
    const window = codeLines.slice(windowStart, index + 1).join('\n')

    if (!WRAPPER_PATTERN.test(window)) {
      violations.push({ line: index + 1, text: rawLines[index].trim() })
    }
  })

  return { relativePath, violations, clientInstantiations }
}

function main() {
  const files = listJsFiles(SRC_DIR)
  const results = files.map(checkFile)
  const filesWithViolations = results.filter((result) => result.violations.length > 0)
  const totalClientInstantiations = results.reduce((sum, result) => sum + result.clientInstantiations, 0)
  const totalCheckedFiles = results.length

  console.log(`Перевірено ${totalCheckedFiles} .js файлів у src/.`)
  console.log(`Знайдено ${totalClientInstantiations} інстанціювань "new Client(...)" (інформаційно — кілька інстансів SDK це нормально, доки всі виклики йдуть через notionRequest).`)

  if (!filesWithViolations.length) {
    console.log('\n✅ Жодного "сирого" виклику notion.<domain>.<method>(...) поза notionRequest() не знайдено.')
    return
  }

  console.log(`\n❌ Знайдено ${filesWithViolations.length} файл(и) з викликом Notion API в обхід notionRequest():`)
  for (const { relativePath, violations } of filesWithViolations) {
    for (const violation of violations) {
      console.log(`  ${relativePath}:${violation.line}: ${violation.text}`)
    }
  }
  console.log('\nЗагорни ці виклики в notionRequest(() => ..., "label") — інакше вони не тротляться спільною чергою.')
  process.exitCode = 1
}

main()

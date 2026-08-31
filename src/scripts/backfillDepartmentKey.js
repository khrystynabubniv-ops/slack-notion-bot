// Одноразовий backfill: перетворює НЕЯВНИЙ fallback ("немає departmentKey в
// Redis → трактуємо як design") на ЯВНИЙ ("departmentKey: 'design' реально
// записано в Redis").
//
// Навіщо: resolveDepartmentKey() (src/config/departments.js) мовчки лікує
// відсутнє поле, підставляючи 'design'. Це safe, поки цей бот живе сам —
// але якщо його переносять в unified-бот з іншою обробкою "departmentKey"
// на тому самому Redis instance/prefix, легше й безпечніше матеріалізувати
// цей fallback у дані ДО перенесення, ніж покладатись, що нова система
// відтворить точно ту саму implicit-логіку.
// Див. docs/unified-bot-migration-handover.md, розділ 17, пункт 2.
//
// Що робить: читає всі task-tracking записи (notion:*), і для тих, де
// departmentKey відсутній у самому Redis (не там, де він заданий, але не
// розпізнається — це інший, навмисно НЕ зачіпаний тут кейс, див.
// resolveDepartmentKey), записує departmentKey: 'design' буквально.
//
// Запуск:
//   node src/scripts/backfillDepartmentKey.js            — dry-run (нічого не пише)
//   node src/scripts/backfillDepartmentKey.js --write     — реально записує
//
// Безпечно перезапускати повторно (ідемпотентний: чіпає лише записи, де
// поле й досі відсутнє) і безпечно ганяти на production Redis — інші поля
// запису не чіпаються.

import 'dotenv/config'
import { getAllTaskRecordsRaw, setDepartmentKeyIfMissing } from '../redis/store.js'
import { DEFAULT_DEPARTMENT_KEY } from '../config/departments.js'

const DRY_RUN = !process.argv.includes('--write')

async function main() {
  const records = await getAllTaskRecordsRaw()
  const summary = {
    mode: DRY_RUN ? 'dry-run' : 'write',
    totalRecords: records.length,
    missingDepartmentKey: 0,
    updated: 0,
    alreadyPresent: 0,
  }
  const missingPageIds = []

  for (const { pageId, key, raw } of records) {
    if (raw.departmentKey) {
      summary.alreadyPresent += 1
      continue
    }

    summary.missingDepartmentKey += 1
    missingPageIds.push(pageId)

    if (DRY_RUN) continue

    const wasUpdated = await setDepartmentKeyIfMissing(key, DEFAULT_DEPARTMENT_KEY)
    if (wasUpdated) summary.updated += 1
  }

  console.log(JSON.stringify(summary, null, 2))

  if (missingPageIds.length) {
    console.log(`\n${DRY_RUN ? 'Would backfill' : 'Backfilled'} departmentKey="${DEFAULT_DEPARTMENT_KEY}" for:`)
    for (const pageId of missingPageIds) console.log(`- ${pageId}`)
  }

  if (DRY_RUN && summary.missingDepartmentKey > 0) {
    console.log('\nЦе був dry-run. Запусти з --write, щоб реально записати.')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

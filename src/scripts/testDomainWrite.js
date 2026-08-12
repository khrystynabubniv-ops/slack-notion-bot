// Manual smoke test for the new "З якого ти напрямку?" step.
// Creates one [ТЕСТ]-prefixed page in the Design Notion database via the same
// createNotionPage() the bot uses, so you can confirm the multi_select `domain`
// property (lowercase — that's its real name in the Activities database) picks
// up a brand-new option (and reuses it on the next run).
//
// Usage (run where real NOTION_TOKEN / NOTION_DESIGN_DATABASE_ID env vars exist):
//   node src/scripts/testDomainWrite.js "PR"
//   node src/scripts/testDomainWrite.js "Команда Офісу"
//
// Delete the created test page from Notion after checking it.

import 'dotenv/config'
import { createNotionPage } from '../notion/createPage.js'
import { applyTestTaskPrefix } from '../config/departments.js'

const domain = process.argv[2] || 'PR'

async function main() {
  if (!process.env.TEST_TASK_PREFIX) {
    console.warn(
      '⚠️  TEST_TASK_PREFIX не встановлено — задача створиться без [ТЕСТ] префіксу.\n' +
      '   Раджу зупинитись і задати TEST_TASK_PREFIX=[ТЕСТ] перед запуском.'
    )
  }

  const { pageId, pageUrl } = await createNotionPage({
    departmentKey: 'design',
    name: applyTestTaskPrefix('Domain field smoke test'),
    priority: 'Low',
    taskType: 'other',
    context: 'Перевірка запису поля Domain (multi_select) для кроку "З якого ти напрямку?".',
    domain,
    slackPersonName: 'Test Script',
    slackPersonEmail: null,
  })

  console.log(`✅ Created page ${pageId}`)
  console.log(`   ${pageUrl}`)
  console.log(`   Перевір поле domain — там має з'явитись/перевикористатись опція "${domain}".`)
  console.log('   Не забудь видалити цю тестову сторінку після перевірки.')
}

main().catch((error) => {
  console.error('❌ Test failed:', error)
  process.exitCode = 1
})

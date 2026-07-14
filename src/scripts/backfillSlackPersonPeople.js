import 'dotenv/config'
import { Client } from '@notionhq/client'
import { getAllTasks } from '../redis/store.js'
import { notionRequest } from '../notion/request.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DRY_RUN = !process.argv.includes('--write')
const FORCE = process.argv.includes('--force')
const DETAIL_LIMIT = Number.parseInt(process.env.BACKFILL_DETAIL_LIMIT || '40', 10)
let notionPeoplePromise = null
const slackUserCache = new Map()

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase() || null
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ') || null
}

function isSlackUserId(value) {
  return /^[UW][A-Z0-9]+$/.test(String(value || '').trim())
}

function pushDetail(details, message) {
  if (details.length < DETAIL_LIMIT) details.push(message)
}

function getSlackDisplayNames(user) {
  return [
    user?.profile?.real_name,
    user?.profile?.display_name,
    user?.real_name,
    user?.name,
  ].filter(Boolean)
}

async function fetchSlackUser(slackUserId) {
  const normalizedSlackUserId = String(slackUserId || '').trim()
  if (!process.env.SLACK_BOT_TOKEN || !isSlackUserId(normalizedSlackUserId)) return null

  if (slackUserCache.has(normalizedSlackUserId)) {
    return slackUserCache.get(normalizedSlackUserId)
  }

  const params = new URLSearchParams({ user: normalizedSlackUserId })
  const response = await fetch(`https://slack.com/api/users.info?${params}`, {
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
  })
  const payload = await response.json()

  if (!payload.ok) {
    throw new Error(`Slack users.info failed for ${normalizedSlackUserId}: ${payload.error}`)
  }

  const resolvedUser = {
    email: normalizeEmail(payload.user?.profile?.email),
    names: getSlackDisplayNames(payload.user),
  }
  slackUserCache.set(normalizedSlackUserId, resolvedUser)
  return resolvedUser
}

async function listNotionPeople() {
  const people = []
  let startCursor

  do {
    const response = await notionRequest(
      () => notion.users.list({
        start_cursor: startCursor,
        page_size: 100,
      }),
      'notion users list'
    )

    people.push(
      ...(response.results || [])
        .filter((user) => user?.type === 'person')
        .map((user) => ({
          id: user.id,
          name: user.name || null,
          normalizedName: normalizeName(user.name),
          email: normalizeEmail(user.person?.email),
        }))
    )

    startCursor = response.has_more ? response.next_cursor : null
  } while (startCursor)

  return people
}

async function getNotionPeople() {
  if (!notionPeoplePromise) notionPeoplePromise = listNotionPeople()
  return notionPeoplePromise
}

async function resolveNotionPerson({ email, names = [] }) {
  const people = await getNotionPeople()
  const normalizedEmail = normalizeEmail(email)

  if (normalizedEmail) {
    const match = people.find((person) => person.email === normalizedEmail)
    if (match) return { person: match, matchedBy: 'email' }
  }

  const normalizedNames = [...new Set(names.map(normalizeName).filter(Boolean))]
  for (const normalizedName of normalizedNames) {
    const matches = people.filter((person) => person.normalizedName === normalizedName)
    if (matches.length === 1) return { person: matches[0], matchedBy: 'name' }
  }

  return { person: null, matchedBy: null }
}

async function retrievePage(pageId) {
  return await notionRequest(
    () => notion.pages.retrieve({ page_id: pageId }),
    'page retrieve for Slack Person backfill'
  )
}

async function updateSlackPerson(pageId, notionPersonId) {
  await notionRequest(
    () => notion.pages.update({
      page_id: pageId,
      properties: {
        'Slack Person': {
          people: [{ id: notionPersonId }],
        },
      },
    }),
    'Slack Person backfill update'
  )
}

async function buildCandidate(task) {
  let slackUser = null

  try {
    slackUser = await fetchSlackUser(task.slackUserId)
  } catch (error) {
    return {
      error,
      email: null,
      names: [task.requesterName, task.slackUserName].filter(Boolean),
    }
  }

  return {
    error: null,
    email: slackUser?.email || null,
    names: [
      ...(slackUser?.names || []),
      task.requesterName,
      task.slackUserName,
    ].filter(Boolean),
  }
}

async function backfillTask(task, summary, details) {
  const page = await retrievePage(task.pageId)
  if (page.archived || page.in_trash) {
    summary.skippedArchived += 1
    pushDetail(details, `skip archived ${task.pageId}`)
    return
  }

  const slackPersonProperty = page.properties?.['Slack Person']

  if (!slackPersonProperty) {
    summary.skippedMissingProperty += 1
    return
  }

  if (slackPersonProperty.type !== 'people') {
    summary.skippedWrongType += 1
    pushDetail(details, `skip ${task.pageId}: Slack Person type is ${slackPersonProperty.type}`)
    return
  }

  if (slackPersonProperty.people?.length && !FORCE) {
    summary.skippedAlreadySet += 1
    return
  }

  const candidate = await buildCandidate(task)
  if (candidate.error) {
    summary.slackLookupWarnings += 1
    pushDetail(details, candidate.error.message)
  }

  const { person, matchedBy } = await resolveNotionPerson(candidate)
  if (!person) {
    summary.skippedUnresolved += 1
    pushDetail(details, `unresolved ${task.pageId}: ${candidate.names.join(' / ') || task.slackUserId || 'no name'}`)
    return
  }

  summary.matched[matchedBy] += 1

  if (DRY_RUN) {
    summary.wouldUpdate += 1
    pushDetail(details, `would update ${task.pageId}: ${person.name || person.email || person.id} (${matchedBy})`)
    return
  }

  await updateSlackPerson(task.pageId, person.id)
  summary.updated += 1
  pushDetail(details, `updated ${task.pageId}: ${person.name || person.email || person.id} (${matchedBy})`)
}

async function main() {
  if (!process.env.NOTION_TOKEN) {
    throw new Error('NOTION_TOKEN is required.')
  }

  const tasks = await getAllTasks()
  const rootTasks = tasks.filter((task) => {
    return !task.taskKind || task.taskKind === 'task'
  })
  const summary = {
    mode: DRY_RUN ? 'dry-run' : 'write',
    force: FORCE,
    totalTrackedTasks: tasks.length,
    totalRootTasks: rootTasks.length,
    wouldUpdate: 0,
    updated: 0,
    skippedAlreadySet: 0,
    skippedMissingProperty: 0,
    skippedWrongType: 0,
    skippedArchived: 0,
    skippedUnresolved: 0,
    failed: 0,
    slackLookupWarnings: 0,
    matched: {
      email: 0,
      name: 0,
    },
  }
  const details = []

  for (const task of rootTasks) {
    try {
      await backfillTask(task, summary, details)
    } catch (error) {
      summary.failed += 1
      pushDetail(details, `failed ${task.pageId}: ${error.message || String(error)}`)
    }
  }

  console.log(JSON.stringify(summary, null, 2))
  if (details.length) {
    console.log('\nDetails:')
    for (const detail of details) console.log(`- ${detail}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

import { Client } from '@notionhq/client'
import {
  DEFAULT_STATUS,
  getTaskTypeRelationId,
  resolveStatusPropertyName,
  resolvePlatform,
} from './taskConfig.js'
import { getDepartment, getTestTaskPrefix } from '../config/departments.js'
import { buildTaskPageUrl } from './pageUrl.js'
import { notionRequest } from './request.js'
import { buildRichText } from './richText.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const notionTemplateApi = new Client({
  auth: process.env.NOTION_TOKEN,
  notionVersion: '2026-03-11',
})
const TEMPLATE_TIMEZONE = process.env.NOTION_TEMPLATE_TIMEZONE?.trim() || 'Europe/Kiev'
const databaseSchemaPromises = new Map()
let notionPeoplePromise = null

function clampText(value, limit = 2000) {
  return value?.slice(0, limit) || ''
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase() || null
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ') || null
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
          normalizedName: normalizeName(user.name),
          email: normalizeEmail(user.person?.email),
        }))
    )

    startCursor = response.has_more ? response.next_cursor : null
  } while (startCursor)

  return people
}

// Cached at module scope: the workspace member list rarely changes within a run,
// so every task created during this process reuses the same lookup instead of
// re-paginating notion.users.list() per submission.
async function getNotionPeople() {
  if (!notionPeoplePromise) {
    notionPeoplePromise = listNotionPeople().catch((error) => {
      notionPeoplePromise = null
      throw error
    })
  }
  return notionPeoplePromise
}

// Matches a Slack requester to a Notion workspace member. Tries email first
// (requires the Notion integration to have the "read email addresses"
// capability enabled), then falls back to a unique display-name match so a
// missing/mismatched email doesn't leave the requester completely unmatched.
// Mirrors the fallback already used by scripts/backfillSlackPersonPeople.js.
async function resolveNotionUserId({ email, names = [] } = {}) {
  try {
    const people = await getNotionPeople()
    const normalizedEmail = normalizeEmail(email)

    if (normalizedEmail) {
      const match = people.find((person) => person.email === normalizedEmail)
      if (match) return match.id
    }

    const normalizedNames = [...new Set(names.map(normalizeName).filter(Boolean))]
    for (const normalizedName of normalizedNames) {
      const matches = people.filter((person) => person.normalizedName === normalizedName)
      if (matches.length === 1) return matches[0].id
    }

    return null
  } catch (error) {
    console.warn('Failed to resolve Notion user for Slack Person/Owner:', error)
    return null
  }
}

async function applyTemplateToPage(pageId, department) {
  if (!department.notionTemplateId) return false

  await notionRequest(
    () => notionTemplateApi.request({
      path: `pages/${pageId}`,
      method: 'patch',
      body: {
        template: {
          type: 'template_id',
          template_id: department.notionTemplateId,
          timezone: TEMPLATE_TIMEZONE,
        },
        erase_content: true,
      },
    }),
    'template apply'
  )

  return true
}

async function getDatabaseProperties(department) {
  const databaseId = department.notionDataSourceId
  if (!databaseId) {
    throw new Error(`Notion database id is not configured for department "${department.key}".`)
  }

  if (!databaseSchemaPromises.has(databaseId)) {
    const schemaPromise = notionRequest(
      () => notion.databases.retrieve({ database_id: databaseId }),
      `database schema retrieve (${department.key})`
    )
      .then((database) => database.properties || {})
      .catch((error) => {
        databaseSchemaPromises.delete(databaseId)
        throw error
      })

    databaseSchemaPromises.set(databaseId, schemaPromise)
  }

  return databaseSchemaPromises.get(databaseId)
}

// Notion (current API version) rejects writing a select/multi_select value that
// isn't already one of the property's configured options — it no longer
// auto-creates missing options on page write, it requires the database schema
// to be updated first. This adds any genuinely new option names to the
// property's schema before the page create/update call that uses them, then
// invalidates the cached schema so the caller re-fetches it with the option in place.
async function ensureSelectOptionsExist(department, databaseProperties, propertyName, values) {
  const propertyConfig = databaseProperties[propertyName]
  const propertyType = propertyConfig?.type
  if (!propertyType || !['select', 'multi_select'].includes(propertyType)) return databaseProperties

  const existingNames = new Set(getDatabaseOptionNames(databaseProperties, propertyName))
  const missingNames = [...new Set((Array.isArray(values) ? values : [values]).filter(Boolean))]
    .filter((name) => !existingNames.has(name))
  if (!missingNames.length) return databaseProperties

  const existingOptions = propertyConfig[propertyType]?.options || []
  const nextOptions = [
    ...existingOptions,
    ...missingNames.map((name) => ({ name: String(name).slice(0, 100) })),
  ]

  await notionRequest(
    () => notion.databases.update({
      database_id: department.notionDataSourceId,
      properties: {
        [propertyName]: {
          [propertyType]: { options: nextOptions },
        },
      },
    }),
    `add "${propertyName}" option(s) (${department.key})`
  )

  databaseSchemaPromises.delete(department.notionDataSourceId)
  return getDatabaseProperties(department)
}

function buildSlackPersonProperty(propertyConfig, { slackPersonName, notionUserId } = {}) {
  if (!propertyConfig) return null

  switch (propertyConfig.type) {
    case 'people':
      return notionUserId
        ? { people: [{ id: notionUserId }] }
        : null
    case 'title':
      if (!slackPersonName) return null
      return {
        title: [{ text: { content: slackPersonName.slice(0, 2000) } }],
      }
    case 'rich_text':
      if (!slackPersonName) return null
      return {
        rich_text: [{ text: { content: slackPersonName.slice(0, 2000) } }],
      }
    case 'select':
      if (!slackPersonName) return null
      return {
        select: { name: slackPersonName.slice(0, 100) },
      }
    default:
      return null
  }
}

function hasPropertyType(databaseProperties, propertyName, expectedTypes) {
  return expectedTypes.includes(databaseProperties[propertyName]?.type)
}

function resolveTitlePropertyName(databaseProperties) {
  if (hasPropertyType(databaseProperties, 'Name', ['title'])) return 'Name'

  return Object.entries(databaseProperties)
    .find(([, propertyConfig]) => propertyConfig?.type === 'title')
    ?.[0]
}

function addPropertyIfType(properties, databaseProperties, propertyName, expectedTypes, value) {
  if (!propertyName || !hasPropertyType(databaseProperties, propertyName, expectedTypes)) {
    return false
  }

  properties[propertyName] = value
  return true
}

function buildPropertyForDatabaseType(propertyType, value) {
  if (value === null || value === undefined || value === '') return null

  if (propertyType === 'checkbox') {
    return { checkbox: Boolean(value) }
  }

  const values = Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean)
  const firstValue = values[0]
  if (!firstValue) return null

  switch (propertyType) {
    case 'rich_text':
      return { rich_text: buildRichText(values.join(', ')) }
    case 'url': {
      const url = String(firstValue).trim()
      try {
        return { url: new URL(url).toString() }
      } catch (_) {
        try {
          return { url: new URL(`https://${url}`).toString() }
        } catch (_) {
          return null
        }
      }
    }
    case 'select':
      return { select: { name: String(firstValue).slice(0, 100) } }
    case 'multi_select':
      return {
        multi_select: values.map((item) => ({ name: String(item).slice(0, 100) })),
      }
    case 'date': {
      const dateValue = String(firstValue).trim()
      return /^\d{4}-\d{2}-\d{2}/.test(dateValue)
        ? { date: { start: dateValue } }
        : null
    }
    case 'number': {
      const parsed = Number.parseFloat(String(firstValue).replace(',', '.'))
      return Number.isFinite(parsed) ? { number: parsed } : null
    }
    case 'status':
      return { status: { name: String(firstValue).slice(0, 100) } }
    default:
      return null
  }
}

function addPropertyByDatabaseType(properties, databaseProperties, propertyNames, value) {
  for (const propertyName of propertyNames.filter(Boolean)) {
    const propertyType = databaseProperties[propertyName]?.type
    if (!propertyType) continue

    const propertyValue = buildPropertyForDatabaseType(propertyType, value)
    if (!propertyValue) continue

    properties[propertyName] = propertyValue
    return true
  }

  return false
}

function getDatabaseOptionNames(databaseProperties, propertyName) {
  const propertyConfig = databaseProperties[propertyName]
  const optionSource = propertyConfig?.[propertyConfig.type]
  return (optionSource?.options || [])
    .map((option) => option.name)
    .filter(Boolean)
}

function resolveStatusValue(databaseProperties, statusPropertyName, preferredStatus) {
  const propertyType = databaseProperties[statusPropertyName]?.type
  if (!['select', 'status'].includes(propertyType)) return preferredStatus

  const optionNames = getDatabaseOptionNames(databaseProperties, statusPropertyName)
  if (!optionNames.length || optionNames.includes(preferredStatus)) return preferredStatus

  const fallbackStatus = optionNames.find((optionName) => optionName.toLowerCase() === 'to do') ||
    optionNames[0]

  console.warn(
    `Configured status "${preferredStatus}" is missing from Notion property "${statusPropertyName}". ` +
    `Using "${fallbackStatus}" instead.`
  )

  return fallbackStatus
}

function buildTitle(name) {
  return [{ text: { content: clampText(name) || 'Untitled' } }]
}

function buildDescription({
  department,
  fullName,
  context,
  style,
  antiref,
  canEditText,
  platformOther,
  specificFields,
  fieldAnswers,
  artifacts,
}) {
  if (department?.useBodyBrief) {
    return 'Опис нижче в тілі задачі.'
  }

  const lines = []

  if (fullName) lines.push(`📌 Повна назва: ${fullName}`)
  if (context) lines.push(`📌 Контекст: ${context}`)
  if (style) lines.push(`🎨 Стиль/Референси: ${style}`)
  if (antiref) lines.push(`🚫 Антиреференси: ${antiref}`)
  if (canEditText !== undefined) lines.push(`✏️ Дизайнер може правити текст: ${canEditText}`)
  if (platformOther) lines.push(`📱 Platform (other): ${platformOther}`)

  if (specificFields && Object.keys(specificFields).length > 0) {
    lines.push('\n— СПЕЦИФІЧНІ ПОЛЯ —')
    for (const [label, value] of Object.entries(specificFields)) {
      if (value) lines.push(`${label}: ${value}`)
    }
  } else if (fieldAnswers?.length) {
    lines.push('\n— ПОЛЯ БРИФУ —')
    for (const field of fieldAnswers) {
      if (field.formattedValue) lines.push(`${field.label}: ${field.formattedValue}`)
    }
  }

  if (artifacts && Object.keys(artifacts).length > 0) {
    lines.push('\n— АРТЕФАКТИ —')
    for (const [label, value] of Object.entries(artifacts)) {
      if (value) lines.push(`📎 ${label}: ${value}`)
    }
  }

  return lines.join('\n')
}

function buildBlockRichText(value) {
  const text = String(value || '')
  if (!text) return []

  return buildRichText(text)
}

function buildHeadingBlock(text, level = 2) {
  const type = level === 3 ? 'heading_3' : 'heading_2'

  return {
    object: 'block',
    type,
    [type]: {
      rich_text: buildBlockRichText(text),
    },
  }
}

function buildParagraphBlock(text) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: buildBlockRichText(text),
    },
  }
}

function buildBulletedListItem(text) {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: buildBlockRichText(text),
    },
  }
}

function getFieldSection(field) {
  return field.section === 'base' ? 'base' : 'specific'
}

function buildFieldSummaryBlock(field) {
  return buildBulletedListItem(`${field.label}: ${field.formattedValue}`)
}

function buildBriefBodyBlocks({ department, taskConfig, fieldAnswers = [], artifacts = {} }) {
  if (!department?.useBodyBrief) return []

  const baseFields = fieldAnswers.filter((field) => getFieldSection(field) === 'base')
  const specificFields = fieldAnswers.filter((field) => getFieldSection(field) === 'specific')
  const artifactEntries = Object.entries(artifacts || {}).filter(([, value]) => value)
  const blocks = [
    buildHeadingBlock(`Бриф ${department.label}`),
    buildParagraphBlock(`Тип задачі: ${taskConfig.label || taskConfig.key || 'не вказано'}`),
  ]

  if (baseFields.length) {
    blocks.push(buildHeadingBlock('Базові поля', 3))
    blocks.push(...baseFields.map(buildFieldSummaryBlock))
  }

  if (specificFields.length) {
    blocks.push(buildHeadingBlock('Специфічні поля', 3))
    blocks.push(...specificFields.map(buildFieldSummaryBlock))
  }

  if (artifactEntries.length) {
    blocks.push(buildHeadingBlock('Матеріали', 3))
    blocks.push(...artifactEntries.map(([label, value]) => buildBulletedListItem(`${label}: ${value}`)))
  }

  return blocks
}

async function appendBriefBodyBlocks(pageId, blocks) {
  if (!blocks.length) return false

  for (let index = 0; index < blocks.length; index += 100) {
    const children = blocks.slice(index, index + 100)
    await notionRequest(
      () => notion.blocks.children.append({
        block_id: pageId,
        children,
      }),
      'brief body append'
    )
  }

  return true
}

export async function createNotionPage({
  departmentKey = 'design',
  name,
  priority,
  deadline,
  videoFormat,
  platform,
  platforms = [],
  platformOther,
  taskType,
  context,
  style,
  antiref,
  canEditText,
  specificFields = {},
  fieldAnswers = [],
  artifacts = {},
  isLate = false,
  domain = null,
  slackPersonName,
  slackPersonEmail,
}) {
  const department = getDepartment(departmentKey)
  const truncatedTitle = clampText(name)
  const taskConfig = department.taskTypes[taskType] || {}
  const description = buildDescription({
    department,
    fullName: truncatedTitle !== name ? name : null,
    context,
    style,
    antiref,
    canEditText,
    platformOther,
    specificFields,
    fieldAnswers,
    artifacts,
  })
  const briefBodyBlocks = buildBriefBodyBlocks({
    department,
    taskConfig,
    fieldAnswers,
    artifacts,
  })
  const taskTypeRelationId = getTaskTypeRelationId(taskType, department.key)
  const notionPlatform = resolvePlatform(platform)
  let databaseProperties = await getDatabaseProperties(department)
  const titlePropertyName = resolveTitlePropertyName(databaseProperties)
  const statusPropertyName = resolveStatusPropertyName(databaseProperties, department.key)

  if (!titlePropertyName) {
    throw new Error('Notion database is missing a title property for task name.')
  }

  const properties = {
    [titlePropertyName]: {
      title: buildTitle(name),
    },
  }

  addPropertyByDatabaseType(
    properties,
    databaseProperties,
    [statusPropertyName],
    resolveStatusValue(
      databaseProperties,
      statusPropertyName,
      department.initialStatus || DEFAULT_STATUS
    )
  )
  if (department.key === 'design') {
    addPropertyIfType(properties, databaseProperties, 'Design needed', ['checkbox'], {
      checkbox: true,
    })
  }
  for (const [propertyName, value] of Object.entries(department.defaultProperties || {})) {
    addPropertyByDatabaseType(properties, databaseProperties, [propertyName], value)
  }
  for (const [propertyName, value] of Object.entries(taskConfig.defaultProperties || {})) {
    addPropertyByDatabaseType(properties, databaseProperties, [propertyName], value)
  }
  addPropertyIfType(properties, databaseProperties, 'Team', ['select'], {
    select: { name: department.team },
  })
  if (domain) {
    databaseProperties = await ensureSelectOptionsExist(department, databaseProperties, 'domain', domain)
    addPropertyByDatabaseType(properties, databaseProperties, ['domain'], domain)
  }
  const requesterNotionUserId = await resolveNotionUserId({
    email: slackPersonEmail,
    names: [slackPersonName].filter(Boolean),
  })
  const ownerId = requesterNotionUserId || department.ownerId
  if (ownerId) {
    addPropertyIfType(properties, databaseProperties, 'Owner', ['people'], {
      people: [{ id: ownerId }],
    })
  }

  if (priority) {
    addPropertyIfType(properties, databaseProperties, 'Priority', ['select'], {
      select: { name: priority },
    })
  }

  if (deadline) {
    addPropertyIfType(properties, databaseProperties, 'Deadline', ['date'], {
      date: { start: deadline },
    })
  }

  if (isLate) {
    addPropertyByDatabaseType(properties, databaseProperties, ['Late'], true)
  }

  const defaultPlatforms = Array.isArray(taskConfig.defaultPlatforms)
    ? taskConfig.defaultPlatforms
    : [taskConfig.defaultPlatforms].filter(Boolean)
  const platformSource = platforms.length
    ? platforms
    : defaultPlatforms.length
      ? defaultPlatforms
      : [notionPlatform].filter(Boolean)
  const normalizedPlatforms = platformSource.map(resolvePlatform).filter(Boolean)
  if (normalizedPlatforms.length) {
    if (!addPropertyByDatabaseType(properties, databaseProperties, ['Platforms', 'Platform'], normalizedPlatforms)) {
      addPropertyIfType(properties, databaseProperties, 'Platform', ['select'], {
        select: { name: normalizedPlatforms[0] },
      })
    }
  }

  if (taskTypeRelationId) {
    addPropertyIfType(properties, databaseProperties, 'Task Type', ['relation'], {
      relation: [{ id: taskTypeRelationId }],
    })
  } else {
    addPropertyByDatabaseType(
      properties,
      databaseProperties,
      ['Task Type', 'Request type', 'Type'],
      taskConfig.label || taskType
    )
  }

  for (const field of fieldAnswers) {
    const propertyValue = field.type === 'slack_user' ? field.formattedValue : field.value
    addPropertyByDatabaseType(
      properties,
      databaseProperties,
      field.notionProperties || [],
      propertyValue
    )
  }

  if (getTestTaskPrefix()) {
    addPropertyByDatabaseType(properties, databaseProperties, ['Test'], true)
    addPropertyByDatabaseType(properties, databaseProperties, ['Tags', 'Tag'], 'Test')
  }

  const slackPersonProperty = buildSlackPersonProperty(databaseProperties['Slack Person'], {
    slackPersonName,
    notionUserId: requesterNotionUserId,
  })
  if (slackPersonProperty) properties['Slack Person'] = slackPersonProperty

  // If "Slack Person" is a `people` property and we couldn't match the Slack
  // requester to a Notion account (no email/name match), buildSlackPersonProperty
  // returns null above and the property is skipped entirely — there's no way to
  // put raw text into a `people` property. Keep the requester's name/email from
  // being lost by noting it in the page body instead, so it can be triaged later.
  const slackPersonUnmatched = Boolean(
    databaseProperties['Slack Person']?.type === 'people' &&
    !requesterNotionUserId &&
    (slackPersonName || slackPersonEmail)
  )

  if (description) {
    addPropertyIfType(properties, databaseProperties, 'Description', ['rich_text'], {
      rich_text: buildRichText(description),
    })
  }

  const response = await notionRequest(
    () => notion.pages.create({
      parent: { database_id: department.notionDataSourceId },
      properties,
    }),
    `page create (${department.key})`
  )

  // Applying a Notion page template re-seeds the page's properties from the
  // template's own defaults, which silently wipes out values we just set on
  // create (most importantly 'Slack Person' and 'Owner') whenever the template
  // itself leaves those properties empty. Re-apply them in a follow-up patch
  // so a configured template can't erase the requester match.
  const propertiesToRestoreAfterTemplate = {}
  if (properties['Owner']) propertiesToRestoreAfterTemplate['Owner'] = properties['Owner']
  if (properties['Slack Person']) propertiesToRestoreAfterTemplate['Slack Person'] = properties['Slack Person']

  let templateApplied = false

  try {
    templateApplied = await applyTemplateToPage(response.id, department)
  } catch (error) {
    console.error('Notion template apply failed:', error)
  }

  if (templateApplied && Object.keys(propertiesToRestoreAfterTemplate).length) {
    try {
      await notionRequest(
        () => notion.pages.update({
          page_id: response.id,
          properties: propertiesToRestoreAfterTemplate,
        }),
        'restore properties after template apply'
      )
    } catch (error) {
      console.error('Notion restore-properties-after-template-apply failed:', error)
    }
  }

  try {
    await appendBriefBodyBlocks(response.id, briefBodyBlocks)
  } catch (error) {
    console.error('Notion brief body append failed:', error)
  }

  if (slackPersonUnmatched) {
    try {
      await appendBriefBodyBlocks(response.id, [
        buildParagraphBlock(
          `⚠️ Slack requester not matched to a Notion account: ${slackPersonName || '—'} (${slackPersonEmail || 'email unknown'})`
        ),
      ])
    } catch (error) {
      console.error('Notion unmatched-requester note append failed:', error)
    }
  }

  return {
    pageId: response.id,
    pageUrl: buildTaskPageUrl(response.id, response.url, department.key),
    templateApplied,
  }
}

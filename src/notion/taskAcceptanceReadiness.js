import { Client } from '@notionhq/client'
import { getStatusPropertyNames } from './taskConfig.js'
import { notionRequest } from './request.js'
import { getDepartment } from '../config/departments.js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
export const PARENT_ITEM_PROPERTY = process.env.NOTION_PARENT_ITEM_PROPERTY?.trim() || 'Parent item'

export function normalizePageId(pageId) {
  return String(pageId || '').replace(/-/g, '').toLowerCase()
}

export function extractParentPageIds(page) {
  const relation = page.properties?.[PARENT_ITEM_PROPERTY]?.relation || []

  return relation
    .map((item) => item.id)
    .filter(Boolean)
}

export function isCommentsStatus(status) {
  const normalizedStatus = String(status || '').trim().toLowerCase()

  return normalizedStatus === 'comments' ||
    normalizedStatus.includes('comment') ||
    normalizedStatus.includes('комент')
}

export function isAcceptableSubtaskStatus(status) {
  const normalizedStatus = String(status || '').trim().toLowerCase()

  return normalizedStatus === 'ready' ||
    normalizedStatus.includes('ready') ||
    normalizedStatus.includes('реді') ||
    normalizedStatus === 'done' ||
    normalizedStatus.includes('done') ||
    normalizedStatus.includes('complete') ||
    normalizedStatus.includes('готов') ||
    normalizedStatus.includes('виконан') ||
    normalizedStatus === 'правка done' ||
    (normalizedStatus.includes('правк') && normalizedStatus.includes('done'))
}

export function getChildTasks(currentTasks, parentPageId) {
  const normalizedParentPageId = normalizePageId(parentPageId)
  if (!normalizedParentPageId) return []

  return Object.entries(currentTasks)
    .filter(([pageId, task]) => {
      if (normalizePageId(pageId) === normalizedParentPageId) return false

      return task.parentPageIds?.some((parentId) => {
        return normalizePageId(parentId) === normalizedParentPageId
      })
    })
    .map(([, task]) => task)
}

export function canAcceptTaskResult(currentTasks, pageId) {
  const childTasks = getChildTasks(currentTasks, pageId)

  return !childTasks.length || childTasks.every((task) => isAcceptableSubtaskStatus(task.status))
}

export function extractStatus(page, departmentKey = 'design') {
  for (const propertyName of getStatusPropertyNames(departmentKey)) {
    const property = page.properties?.[propertyName]
    const status = property?.status?.name || property?.select?.name
    if (status) return status
  }

  return null
}

async function getChildTaskStatuses(parentPageId, departmentKey = 'design') {
  const department = getDepartment(departmentKey)
  if (!department.notionDataSourceId || !parentPageId) return []

  const childTasks = []
  let hasMore = true
  let startCursor

  while (hasMore) {
    const response = await notionRequest(
      () => notion.databases.query({
        database_id: department.notionDataSourceId,
        start_cursor: startCursor,
        filter: {
          property: PARENT_ITEM_PROPERTY,
          relation: {
            contains: parentPageId,
          },
        },
      }),
      'child tasks query before accept'
    )

    childTasks.push(...response.results.map((page) => ({
      pageId: page.id,
      status: extractStatus(page, departmentKey),
    })))

    hasMore = response.has_more
    startCursor = response.next_cursor ?? undefined
  }

  return childTasks
}

export async function getTaskAcceptanceReadiness(pageId, departmentKey = 'design') {
  const [page, childTasks] = await Promise.all([
    notionRequest(
      () => notion.pages.retrieve({ page_id: pageId }),
      'task retrieve before acceptance readiness check'
    ),
    getChildTaskStatuses(pageId, departmentKey),
  ])
  const status = extractStatus(page, departmentKey)
  const hasBlockingSubtasks = childTasks.some((task) => !isAcceptableSubtaskStatus(task.status))

  return {
    canAccept: isCommentsStatus(status) && !hasBlockingSubtasks,
    status,
    childTasks,
    hasBlockingSubtasks,
  }
}

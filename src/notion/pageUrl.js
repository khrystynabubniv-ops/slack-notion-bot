import { DEFAULT_DESIGN_HUB_URL, getDepartment } from '../config/departments.js'

function normalizePageId(pageId) {
  return pageId?.replace(/-/g, '') || ''
}

function buildDirectPageUrl(pageId, fallbackUrl) {
  if (fallbackUrl) return fallbackUrl

  const normalizedPageId = normalizePageId(pageId)
  if (!normalizedPageId) return null

  return `https://www.notion.so/${normalizedPageId}`
}

export function buildTaskPageUrl(pageId, fallbackUrl, departmentKey = 'design') {
  const normalizedPageId = normalizePageId(pageId)
  if (!normalizedPageId) return fallbackUrl || null

  const department = getDepartment(departmentKey)
  const hubUrl = department.hubUrl || DEFAULT_DESIGN_HUB_URL

  if (!hubUrl) {
    return buildDirectPageUrl(pageId, fallbackUrl)
  }

  try {
    const url = new URL(hubUrl)

    // Notion opens a database item inside the current hub/page when `p` is set.
    url.searchParams.set('p', normalizedPageId)
    url.searchParams.set('pm', 's')

    return url.toString()
  } catch (error) {
    console.error(`Failed to build ${department.key} hub URL, fallback to direct Notion page URL:`, error)
    return buildDirectPageUrl(pageId, fallbackUrl)
  }
}

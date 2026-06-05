import { getDepartment } from '../config/departments.js'

const BRAND_DESIGN_HUB_URL =
  process.env.NOTION_BRAND_DESIGN_HUB_URL?.trim() ||
  'https://www.notion.so/Brand-Design-Hub-33cce9899cb7814488c0f439326aaf2a?source=copy_link'

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
  const hubUrl = department.hubUrl || BRAND_DESIGN_HUB_URL

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

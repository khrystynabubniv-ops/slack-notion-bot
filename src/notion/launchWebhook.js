import { saveLaunchContext } from '../redis/store.js'

function normalizeString(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function flattenPayload(value, prefix = '', target = {}) {
  if (value === null || value === undefined) {
    return target
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flattenPayload(item, prefix ? `${prefix}.${index}` : String(index), target)
    })
    return target
  }

  if (typeof value === 'object') {
    for (const [key, nestedValue] of Object.entries(value)) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key
      flattenPayload(nestedValue, nextPrefix, target)
    }
    return target
  }

  target[prefix] = value
  return target
}

function getFirstDefined(payload, keys) {
  for (const key of keys) {
    const value = payload?.[key]
    if (value !== undefined && value !== null && value !== '') {
      return value
    }
  }

  return null
}

function extractLaunchContext(payload) {
  const flattened = flattenPayload(payload)
  const flattenedEntries = Object.entries(flattened)

  const parentTaskId = normalizeString(getFirstDefined(payload, [
    '№ ID',
    'No ID',
    'ID',
    'parentTaskId',
    'parent_task_id',
    'Variable 1',
  ])) || normalizeString(
    flattenedEntries.find(([key, value]) => {
      if (typeof value !== 'string' && typeof value !== 'number') return false
      const normalizedKey = key.toLowerCase()
      return normalizedKey.includes('№ id') || normalizedKey.includes('no id') || normalizedKey.endsWith('.id')
    })?.[1]?.toString()
  )

  const parentPageName = normalizeString(getFirstDefined(payload, [
    'Name',
    'parentPageName',
    'parent_page_name',
    'Variable 2',
  ])) || normalizeString(
    flattenedEntries.find(([key, value]) => {
      if (typeof value !== 'string') return false
      const normalizedKey = key.toLowerCase()
      return normalizedKey === 'name' || normalizedKey.endsWith('.name')
    })?.[1]
  )

  return { parentTaskId, parentPageName, flattened }
}

export function registerNotionLaunchWebhook(router) {
  router.post('/notion/design-task-launch', async (req, res) => {
    const payload = req.body || {}

    try {
      const { parentTaskId, parentPageName, flattened } = extractLaunchContext(payload)

      console.log('Notion launch webhook payload:', JSON.stringify(payload))
      console.log('Notion launch webhook flattened payload:', JSON.stringify(flattened))

      if (!parentTaskId) {
        return res.status(400).json({
          ok: false,
          error: 'Missing parent task id in webhook payload',
          receivedKeys: Object.keys(payload),
          flattenedKeys: Object.keys(flattened),
        })
      }

      await saveLaunchContext({
        parentTaskId,
        parentPageName,
        payload,
      })

      return res.status(200).json({
        ok: true,
        parentTaskId,
        parentPageName,
      })
    } catch (error) {
      console.error('Failed to process Notion launch webhook:', error)
      return res.status(500).json({
        ok: false,
        error: 'Failed to process Notion launch webhook',
      })
    }
  })
}

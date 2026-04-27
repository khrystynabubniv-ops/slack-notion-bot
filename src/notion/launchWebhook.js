import { saveLaunchContext } from '../redis/store.js'

function normalizeString(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
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
  const parentTaskId = normalizeString(getFirstDefined(payload, [
    '№ ID',
    'No ID',
    'ID',
    'parentTaskId',
    'parent_task_id',
    'Variable 1',
  ]))

  const parentPageName = normalizeString(getFirstDefined(payload, [
    'Name',
    'parentPageName',
    'parent_page_name',
    'Variable 2',
  ]))

  return { parentTaskId, parentPageName }
}

export function registerNotionLaunchWebhook(router) {
  router.post('/notion/design-task-launch', async (req, res) => {
    const payload = req.body || {}

    try {
      const { parentTaskId, parentPageName } = extractLaunchContext(payload)

      if (!parentTaskId) {
        return res.status(400).json({
          ok: false,
          error: 'Missing parent task id in webhook payload',
          receivedKeys: Object.keys(payload),
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

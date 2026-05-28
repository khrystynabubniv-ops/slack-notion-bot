const DEFAULT_MIN_INTERVAL_MS = 500
const DEFAULT_MAX_RETRIES = 4
const DEFAULT_RETRY_DELAY_MS = 1500
const MAX_RETRY_DELAY_MS = 30000

const configuredMinInterval = Number.parseInt(
  process.env.NOTION_REQUEST_MIN_INTERVAL_MS || `${DEFAULT_MIN_INTERVAL_MS}`,
  10
)
const configuredMaxRetries = Number.parseInt(
  process.env.NOTION_REQUEST_MAX_RETRIES || `${DEFAULT_MAX_RETRIES}`,
  10
)

const NOTION_REQUEST_MIN_INTERVAL_MS =
  Number.isFinite(configuredMinInterval) && configuredMinInterval >= 0
    ? configuredMinInterval
    : DEFAULT_MIN_INTERVAL_MS
const NOTION_REQUEST_MAX_RETRIES =
  Number.isFinite(configuredMaxRetries) && configuredMaxRetries >= 0
    ? configuredMaxRetries
    : DEFAULT_MAX_RETRIES

let queue = Promise.resolve()
let lastRequestStartedAt = 0

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRateLimited(error) {
  return error?.code === 'rate_limited' || error?.status === 429 || error?.statusCode === 429
}

function getHeader(headers, headerName) {
  if (!headers) return null
  if (typeof headers.get === 'function') return headers.get(headerName)

  const normalizedHeaderName = headerName.toLowerCase()
  return Object.entries(headers)
    .find(([key]) => key.toLowerCase() === normalizedHeaderName)
    ?.[1]
}

function getRetryDelayMs(error, attempt) {
  const retryAfter = getHeader(error?.headers, 'retry-after')
  const retryAfterSeconds = Number.parseFloat(Array.isArray(retryAfter) ? retryAfter[0] : retryAfter)

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(Math.ceil(retryAfterSeconds * 1000), MAX_RETRY_DELAY_MS)
  }

  return Math.min(DEFAULT_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS)
}

async function runQueued(fn) {
  const run = async () => {
    const elapsedMs = Date.now() - lastRequestStartedAt
    const waitMs = NOTION_REQUEST_MIN_INTERVAL_MS - elapsedMs

    if (waitMs > 0) await wait(waitMs)

    lastRequestStartedAt = Date.now()
    return fn()
  }

  const result = queue.then(run, run)
  queue = result.catch(() => {})
  return result
}

export async function notionRequest(fn, operationName = 'request') {
  for (let attempt = 0; attempt <= NOTION_REQUEST_MAX_RETRIES; attempt += 1) {
    try {
      return await runQueued(fn)
    } catch (error) {
      if (!isRateLimited(error) || attempt >= NOTION_REQUEST_MAX_RETRIES) {
        throw error
      }

      const retryDelayMs = getRetryDelayMs(error, attempt)
      console.warn(
        `Notion rate limit during ${operationName}; retrying in ${retryDelayMs}ms ` +
          `(attempt ${attempt + 1}/${NOTION_REQUEST_MAX_RETRIES})`
      )
      await wait(retryDelayMs)
    }
  }

  throw new Error(`Notion ${operationName} failed after retries`)
}

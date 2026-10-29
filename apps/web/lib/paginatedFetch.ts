// Shared, hardened replacement for the `if (error || !data?.length) hasMore = false`
// pagination pattern repeated across this codebase, which silently stopped on ANY
// error (network blip, statement timeout, etc.) and returned whatever had been
// accumulated so far as if it were the complete result. Confirmed live: this let
// /api/analytics/trades and /api/analytics/publications intermittently return tens
// of thousands fewer rows than exist, as HTTP 200, with zero server-side logging.

export class PaginationError extends Error {
  constructor(message: string, public readonly label: string, public readonly page: number) {
    super(message)
    this.name = 'PaginationError'
  }
}

export interface FetchAllPagesOptions {
  label: string
  pageSize?: number
  maxRetries?: number
  retryDelayMs?: number
  // Caller-side safety valve (e.g. MAX_ROWS) -- stops requesting further pages once
  // this many rows worth of pages have been requested, same semantics as the old
  // `if (all.length >= MAX_ROWS) break` guards this replaces.
  maxRows?: number
}

const DEFAULT_PAGE_SIZE = 1000
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_DELAY_MS = 250

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Fetches every page of a Supabase/PostgREST range query (`.range(page*pageSize,
 * page*pageSize+pageSize-1)`, same shape the old inline loops used).
 *
 * On a page error: retries that same page up to `maxRetries` times with exponential
 * backoff, logging the page index and row range on every attempt. If every retry for
 * a page fails, throws PaginationError instead of returning a partial array --
 * callers MUST let this propagate (e.g. into a non-200 response) rather than
 * catching it and continuing with whatever was accumulated so far, which would
 * reintroduce the exact silent-truncation bug this replaces.
 */
export async function fetchAllPages<T>(
  queryPage: (page: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  options: FetchAllPagesOptions,
): Promise<T[]> {
  const { label, pageSize = DEFAULT_PAGE_SIZE, maxRetries = DEFAULT_MAX_RETRIES, retryDelayMs = DEFAULT_RETRY_DELAY_MS, maxRows } = options
  const results: T[] = []
  let page = 0

  while (true) {
    if (maxRows !== undefined && page * pageSize >= maxRows) break

    let lastError: { message: string } | null = null
    let data: T[] | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await queryPage(page)
      if (!result.error) {
        data = result.data
        lastError = null
        break
      }
      lastError = result.error
      const rangeStart = page * pageSize
      const rangeEnd = rangeStart + pageSize - 1
      console.error(
        `[fetchAllPages:${label}] page ${page} (range ${rangeStart}-${rangeEnd}) failed, attempt ${attempt + 1}/${maxRetries + 1}:`,
        result.error.message,
      )
      if (attempt < maxRetries) await sleep(retryDelayMs * 2 ** attempt)
    }

    if (lastError) {
      throw new PaginationError(
        `Failed to fetch ${label} (page ${page}, range ${page * pageSize}-${page * pageSize + pageSize - 1}) after ${maxRetries + 1} attempts: ${lastError.message}`,
        label,
        page,
      )
    }

    if (!data?.length) break
    results.push(...data)
    if (data.length < pageSize) break
    page++
  }

  return results
}

/**
 * Compares an accumulated row count against an independent `count` query and throws
 * PaginationError on a mismatch -- catches the case where pagination completed with
 * no error per-page but still missed rows overall (e.g. a concurrent write shifting
 * offsets mid-scan). `actual` should be the pre-cap row count (don't pass a count
 * truncated by a caller-side MAX_ROWS safety valve, or every large dataset will
 * "mismatch" against its own deliberate cap).
 */
export async function verifyExpectedCount(
  actual: number,
  countQuery: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
  label: string,
): Promise<void> {
  const { count, error } = await countQuery()
  if (error) {
    console.error(`[fetchAllPages:${label}] count check query failed:`, error.message)
    throw new PaginationError(`Count check query failed for ${label}: ${error.message}`, label, -1)
  }
  if (count !== null && count !== actual) {
    throw new PaginationError(
      `Row count mismatch for ${label}: count query reports ${count} rows, pagination returned ${actual}`,
      label,
      -1,
    )
  }
}

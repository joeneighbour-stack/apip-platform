import cron from 'node-cron'

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const OWNER = 'joeneighbour-stack'
const REPO = 'apip-platform'

// workflow defaults to engine-daily.yml (every job below except import-actual-trades
// and shadow-monitor dispatches into it, with `job` selecting which step to run --
// see engine-daily.yml's workflow_dispatch inputs). import-trades.yml and
// shadow-monitor.yml are standalone single-job workflows with no inputs, so they're
// dispatched with a bare { ref } body instead.
async function triggerWorkflow(job, workflow = 'engine-daily.yml') {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${workflow}/dispatches`

  const body = workflow === 'engine-daily.yml'
    ? JSON.stringify({ ref: 'master', inputs: { job } })
    : JSON.stringify({ ref: 'master' })

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body,
  })

  if (res.status === 204) {
    console.log(`[${new Date().toISOString()}] Triggered: ${job}`)
  } else {
    const text = await res.text()
    console.error(`[${new Date().toISOString()}] Failed to trigger ${job}: ${res.status} ${text}`)
  }
}

// All times UTC
// preallocate-day: 04:20 -- before populate-daily, before derive-regime, before
// any session's engine run. Scores off yesterday's regime (today's hasn't been
// derived yet) so analysts have a full-day coverage forecast before the day's
// real data exists. See preallocateDay.ts's own header comment.
cron.schedule('20 4 * * 1-5', () => triggerWorkflow('preallocate-day'))

// populate-daily: 04:28
cron.schedule('28 4 * * 1-5', () => triggerWorkflow('populate-daily'))

// derive-regime: 04:33
cron.schedule('33 4 * * 1-5', () => triggerWorkflow('derive-regime'))

// snapshot-european: 04:43
cron.schedule('43 4 * * 1-5', () => triggerWorkflow('snapshot-european'))

// engine-european: 04:48
cron.schedule('48 4 * * 1-5', () => triggerWorkflow('engine-european'))

// snapshot-us: 08:43
cron.schedule('43 8 * * 1-5', () => triggerWorkflow('snapshot-us'))

// engine-us: 08:48
cron.schedule('48 8 * * 1-5', () => triggerWorkflow('engine-us'))

// snapshot-apac: 13:00 UTC (14:00 UK) Mon-Thu -- fresh prices ahead of engine-apac
// below. Moved from the old 05:30 UTC slot: APAC analysts actually publish
// ~15:00-18:00 UTC, so a 05:30 run was 9-13 hours stale by publish time (see the
// trade-linking window fix and migrations/053_shadow_trades_monitor_from.sql,
// both written to cover that same gap). Mon-Thu only, Friday intentionally
// skipped -- matches engine-apac's belt-and-suspenders Friday guard in
// engine-daily.yml for manual triggers.
cron.schedule('0 13 * * 1-4', () => triggerWorkflow('snapshot-apac'))

// engine-apac: 13:05 UTC (14:05 UK) Mon-Thu -- same afternoon-publishing
// reasoning and Mon-Thu-only scope as snapshot-apac above.
cron.schedule('5 13 * * 1-4', () => triggerWorkflow('engine-apac'))

// populate-daily evening: 21:58
cron.schedule('58 21 * * 1-5', () => triggerWorkflow('populate-daily'))

// derive-regime evening: 22:13
cron.schedule('13 22 * * 1-5', () => triggerWorkflow('derive-regime'))

// post-trade reviews: 22:28
cron.schedule('28 22 * * 1-5', () => triggerWorkflow('generate-post-trade-reviews'))

// Import actual trades: every 15 minutes, 04:00-20:00 UTC Mon-Fri -- moved here from
// import-trades.yml's own on.schedule trigger (now removed from that file, keeping
// only its off-hours cron) since GitHub Actions' native schedule is best-effort and
// can be delayed or silently skipped under platform load (the same reason
// import-watchdog.yml exists as a backstop) -- Railway's cron is the reliable trigger
// for every other job in this file already.
cron.schedule('*/15 4-20 * * 1-5', () => triggerWorkflow('import-actual-trades', 'import-trades.yml'))

// Shadow monitor: every 5 minutes, 05:00-21:00 UTC Mon-Fri -- moved here from
// shadow-monitor.yml's own on.schedule trigger (now removed from that file entirely,
// leaving only workflow_dispatch), same reliability reasoning as import-actual-trades
// above.
cron.schedule('*/5 5-21 * * 1-5', () => triggerWorkflow('shadow-monitor', 'shadow-monitor.yml'))

// ── Weekly Monday jobs (mirrors engine-daily.yml's remaining on.schedule entries) ──
// generate-profiles: Monday 04:58 UTC
cron.schedule('58 4 * * 1', () => triggerWorkflow('generate-profiles'))

// derive-regime Monday: 05:15 UTC (after weekly profiles)
cron.schedule('15 5 * * 1', () => triggerWorkflow('derive-regime'))

// calculate-kpis: Monday 05:28 UTC
cron.schedule('28 5 * * 1', () => triggerWorkflow('calculate-kpis'))

// calculate-shadow-kpis: Monday 05:29 UTC
cron.schedule('29 5 * * 1', () => triggerWorkflow('calculate-shadow-kpis'))

// generate-atr-profiles: Monday 05:43 UTC
cron.schedule('43 5 * * 1', () => triggerWorkflow('generate-atr-profiles'))

// run-shadow-trigger-probability: Monday 05:45 UTC -- after generate-profiles,
// per that script's own header comment.
cron.schedule('45 5 * * 1', () => triggerWorkflow('run-shadow-trigger-probability'))

console.log('APIP Engine Trigger running — waiting for scheduled times (UTC)')
console.log('Schedules:')
console.log('  04:20 preallocate-day')
console.log('  04:28 populate-daily')
console.log('  04:33 derive-regime')
console.log('  04:43 snapshot-european')
console.log('  04:48 engine-european')
console.log('  08:43 snapshot-us')
console.log('  08:48 engine-us')
console.log('  13:00 snapshot-apac (Mon-Thu)')
console.log('  13:05 engine-apac (Mon-Thu)')
console.log('  21:58 populate-daily (evening)')
console.log('  22:13 derive-regime (evening)')
console.log('  22:28 post-trade-reviews')
console.log('  04:00-20:00 every 15 min: import-actual-trades')
console.log('  05:00-21:00 every 5 min: shadow-monitor')
console.log('  Monday only:')
console.log('  04:58 generate-profiles')
console.log('  05:15 derive-regime (weekly)')
console.log('  05:28 calculate-kpis')
console.log('  05:29 calculate-shadow-kpis')
console.log('  05:43 generate-atr-profiles')
console.log('  05:45 run-shadow-trigger-probability')

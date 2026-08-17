import cron from 'node-cron'

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const OWNER = 'joeneighbour-stack'
const REPO = 'apip-platform'
const WORKFLOW = 'engine-daily.yml'

async function triggerWorkflow(job) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ref: 'master',
      inputs: { job }
    })
  })

  if (res.status === 204) {
    console.log(`[${new Date().toISOString()}] Triggered: ${job}`)
  } else {
    const text = await res.text()
    console.error(`[${new Date().toISOString()}] Failed to trigger ${job}: ${res.status} ${text}`)
  }
}

// All times UTC
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

// snapshot-apac: 05:30 Mon-Thu -- ahead of the Asian market close, not after it
// (the old 12:23 slot landed once APAC trading had already wound down for the
// day). Mon-Thu only, Friday intentionally skipped -- matches engine-apac's
// belt-and-suspenders Friday guard in engine-daily.yml for manual triggers.
cron.schedule('30 5 * * 1-4', () => triggerWorkflow('snapshot-apac'))

// engine-apac: 05:35 Mon-Thu -- same before-close reasoning and Mon-Thu-only
// scope as snapshot-apac above.
cron.schedule('35 5 * * 1-4', () => triggerWorkflow('engine-apac'))

// populate-daily evening: 21:58
cron.schedule('58 21 * * 1-5', () => triggerWorkflow('populate-daily'))

// derive-regime evening: 22:13
cron.schedule('13 22 * * 1-5', () => triggerWorkflow('derive-regime'))

// post-trade reviews: 22:28
cron.schedule('28 22 * * 1-5', () => triggerWorkflow('generate-post-trade-reviews'))

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

console.log('APIP Engine Trigger running — waiting for scheduled times (UTC)')
console.log('Schedules:')
console.log('  04:28 populate-daily')
console.log('  04:33 derive-regime')
console.log('  04:43 snapshot-european')
console.log('  04:48 engine-european')
console.log('  08:43 snapshot-us')
console.log('  08:48 engine-us')
console.log('  05:30 snapshot-apac (Mon-Thu)')
console.log('  05:35 engine-apac (Mon-Thu)')
console.log('  21:58 populate-daily (evening)')
console.log('  22:13 derive-regime (evening)')
console.log('  22:28 post-trade-reviews')
console.log('  Monday only:')
console.log('  04:58 generate-profiles')
console.log('  05:15 derive-regime (weekly)')
console.log('  05:28 calculate-kpis')
console.log('  05:29 calculate-shadow-kpis')
console.log('  05:43 generate-atr-profiles')

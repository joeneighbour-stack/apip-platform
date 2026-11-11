// Dev check of the signal-performance n8n webhook. Credentials from env only:
//   N8N_WEBHOOK_USERNAME=... N8N_WEBHOOK_PASSWORD=... node test-webhook.mjs
const WEBHOOK_URL = process.env.N8N_WEBHOOK_URL ?? 'https://n8n.srv1104653.hstgr.cloud/webhook/signal-performance'
const { N8N_WEBHOOK_USERNAME, N8N_WEBHOOK_PASSWORD } = process.env
if (!N8N_WEBHOOK_USERNAME || !N8N_WEBHOOK_PASSWORD) {
  console.error('Missing required env vars: N8N_WEBHOOK_USERNAME, N8N_WEBHOOK_PASSWORD')
  process.exit(1)
}
const creds = Buffer.from(`${N8N_WEBHOOK_USERNAME}:${N8N_WEBHOOK_PASSWORD}`).toString('base64')
const res = await fetch(WEBHOOK_URL, {
  method: 'POST',
  headers: {'Content-Type':'application/json','Authorization':'Basic '+creds},
  body: JSON.stringify({from:'2026-04-05',to:'2026-04-07'})
})
const data = await res.json()
const cac = data.filter(t => t.Analyst === 'Ian' && t.Symbol === 'CAC')
console.log(JSON.stringify(cac, null, 2))

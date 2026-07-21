const WEBHOOK_URL = 'https://n8n.srv1104653.hstgr.cloud/webhook/signal-performance'
const creds = Buffer.from('product:barcelona123').toString('base64')
const res = await fetch(WEBHOOK_URL, {
  method: 'POST',
  headers: {'Content-Type':'application/json','Authorization':'Basic '+creds},
  body: JSON.stringify({from:'2026-04-05',to:'2026-04-07'})
})
const data = await res.json()
const cac = data.filter(t => t.Analyst === 'Ian' && t.Symbol === 'CAC')
console.log(JSON.stringify(cac, null, 2))

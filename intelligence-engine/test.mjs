const from = Math.floor(new Date('2026-07-14T22:00:00Z').getTime()/1000);
const to = Math.floor(Date.now()/1000);
const res = await fetch('https://finnhub.io/api/v1/forex/candle?symbol=OANDA:GBP_USD&resolution=D&from=' + from + '&to=' + to + '&token=ct3lpbpr01qj3a3bpg5gct3lpbpr01qj3a3bpg60');
const d = await res.json();
console.log(res.status, JSON.stringify(d));

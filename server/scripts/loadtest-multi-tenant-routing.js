#!/usr/bin/env node
const args = Object.fromEntries(process.argv.slice(2).map(x => x.replace(/^--/, '').split('=')));
const tenants = Number(args.tenants || 2), stores = Number(args.stores || 2), rpm = Number(args.rpm || 5), minutes = Number(args.minutes || 1);
const base = String(process.env.LOADTEST_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const total = Math.max(1, tenants * stores * rpm * minutes);
const started = Date.now(); let ok = 0; let failed = 0; const durations = [];
for (let i = 0; i < total; i++) {
  const t = Date.now();
  try { const r = await fetch(base + '/api/growth/payment-rules'); if (r.ok) ok++; else failed++; } catch (_) { failed++; }
  durations.push(Date.now() - t);
}
durations.sort((a,b) => a-b); const pct = p => durations[Math.min(durations.length - 1, Math.floor(durations.length * p))] || 0;
console.log(JSON.stringify({ total, ok, failed, elapsed_ms: Date.now() - started, avg_ms: Math.round(durations.reduce((a,b)=>a+b,0)/durations.length), p95_ms: pct(.95), p99_ms: pct(.99), tenants, stores, rpm, minutes }, null, 2));
process.exitCode = failed ? 1 : 0;

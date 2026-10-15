// probe-cdp.mjs - minimal CDP connectivity probe with step logging
import { execFileSync } from 'node:child_process';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
console.error('[1] creating tab via curl');
const raw = execFileSync('curl.exe', ['-s', '--max-time', '15', '-X', 'PUT',
  'http://127.0.0.1:9223/json/new?http://localhost:4173/'], { encoding: 'utf8' });
console.error('[2] curl returned, len=' + raw.length);
const tab = JSON.parse(raw);
console.error('[3] tab id=' + tab.id);
const ws = new WebSocket(tab.webSocketDebuggerUrl);
console.error('[4] ws object created, connecting...');
const openResult = await Promise.race([
  new Promise((res) => { ws.onopen = () => res('open'); ws.onerror = () => res('error'); }),
  sleep(8000).then(() => 'timeout'),
]);
console.error('[5] ws result: ' + openResult);
if (openResult !== 'open') process.exit(1);
let msgId = 0; const pending = new Map();
ws.onmessage = (ev2) => { const m = JSON.parse(ev2.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
console.error('[6] sending Runtime.evaluate');
const r = await Promise.race([
  send('Runtime.evaluate', { expression: '1+1', returnByValue: true }),
  sleep(8000).then(() => null),
]);
console.error('[7] evaluate result: ' + JSON.stringify(r?.result?.result ?? 'TIMEOUT'));
// close tab
execFileSync('curl.exe', ['-s', '--max-time', '8', 'http://127.0.0.1:9223/json/close/' + tab.id]);
console.error('[8] tab closed, PROBE OK');
process.exit(0);


// test-glog-panel.mjs - 验证日志面板：📤 pointerup 打开全屏面板
const CDP_PORT = '9223';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.error('WATCHDOG TIMEOUT'); process.exit(2); }, 60000);
const { execFileSync } = await import('node:child_process');

const raw = execFileSync('curl.exe', ['-s', '--max-time', '15', '-X', 'PUT',
  `http://localhost:${CDP_PORT}/json/new?${encodeURIComponent('http://localhost:4173/')}`], { encoding: 'utf8' });
const tab = JSON.parse(raw);
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('ws timeout')), 10000); ws.onopen = () => { clearTimeout(t); res(); }; ws.onerror = () => rej(new Error('ws error')); });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (ex) => { const r = await send('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };

for (let i = 0; i < 20; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(500); }
const out = {};
out.btnExists = await ev(`!!document.getElementById('glogBtn')`);
await ev(`document.getElementById('glogBtn').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))`);
await sleep(300);
out.panelOpened = await ev(`(function(){ const ps=[...document.querySelectorAll('#modelPage > div')]; const p=ps.find(d=>d.style.zIndex==='100'); return p ? p.style.display : 'missing'; })()`);
out.logEntries = await ev(`window.__svGlog ? window.__svGlog().length : 0`);
out.taHasContent = await ev(`(function(){ const tas=[...document.querySelectorAll('#modelPage textarea')]; return tas.length && tas[0].value.length > 50; })()`);
console.log(JSON.stringify(out));
ws.close(); process.exit(0);

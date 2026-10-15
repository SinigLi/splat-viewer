// diag-buttons.mjs - capture console errors on load + check button bindings
const CDP_PORT = '9228';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const tab = await (await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent('http://localhost:4173/')}`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
const errors = [];
let msgId = 0; const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    errors.push(m.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errors.push('EXC: ' + (d.exception?.description || d.text));
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
await send('Runtime.enable');
await send('Page.enable');
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r.result?.result?.value; };
for (let i = 0; i < 20; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(500); }
await sleep(2000);
const out = {};
out.errors = errors.slice(0, 6);
out.moduleLoaded = await ev(`!!window.__sv`);
out.openBtnText = await ev(`document.getElementById('openBtn')?.textContent`);
out.btnVisible = await ev(`JSON.stringify(['openBtn','openProjBtn','saveBtn'].map(id => { const b = document.getElementById(id); const r = b.getBoundingClientRect(); return { id, w: r.width, h: r.height, top: r.top }; }))`);
console.log(JSON.stringify(out, null, 1));
ws.close(); process.exit(0);

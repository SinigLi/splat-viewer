// test-settings.mjs - verify settings panel: open, sensitivity slider, grid/axes toggles
const CDP_PORT = '9223';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tab = await (await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent('http://localhost:4173/')}`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
let msgId = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r.result?.result?.value; };

for (let i = 0; i < 20; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(500); }

const out = {};
// panel elements exist
out.elements = await ev(`JSON.stringify({btn:!!document.getElementById('settingsBtn'),panel:!!document.getElementById('settingsPanel'),sens:!!document.getElementById('sensRange'),grid:!!document.getElementById('gridToggle'),axes:!!document.getElementById('axesToggle')})`);

// load model
const doc = await send('DOM.getDocument', { depth: 1 });
const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#fileInput' });
await send('DOM.setFileInputFiles', { files: ['E:\\opensource\\workdatas\\20261004-131022_002cut\\final.ply'], nodeId: q.result.nodeId });
await sleep(10000);

// open panel + set sensitivity 0.6 + toggle grid & axes
await ev(`document.getElementById('settingsBtn').click()`);
out.panelOpen = await ev(`document.getElementById('settingsPanel').classList.contains('open')`);
await ev(`const r=document.getElementById('sensRange'); r.value='0.6'; r.dispatchEvent(new Event('input'))`);
out.sensApplied = await ev(`(()=>{const p=[...document.querySelectorAll('#hud .chip')];return p.length})()`);
// verify orbit uses new sensitivity: drag 100px should rotate 60deg at 0.6
const az0 = await ev(`window.__sv.orbit.azim`);
for (let i = 0; i < 10; i++) { await ev(`window.__sv && 0`); } // noop
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 450, id: 1 }] });
for (let i = 1; i <= 10; i++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300 + i * 10, y: 450, id: 1 }] }); await sleep(16); }
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(300);
const az1 = await ev(`window.__sv.orbit.azim`);
out.sensDelta = Math.abs(az1 - az0).toFixed(4); // expect ~1.0472 (100px * 0.6deg)

// toggles
await ev(`const g=document.getElementById('gridToggle'); g.checked=true; g.dispatchEvent(new Event('change'))`);
await ev(`const a=document.getElementById('axesToggle'); a.checked=true; a.dispatchEvent(new Event('change'))`);
await sleep(800);
out.gridVisible = await ev(`window.__sv.helpersScene.children[0].visible`);
out.axesVisible = await ev(`window.__sv.helpersScene.children[1].visible`);
out.helpersPos = await ev(`JSON.stringify(window.__sv.helpersScene.position.toArray().map(x=>+x.toFixed(2)))`);
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync('F:/openclawhome/openclaw/fullstack_workspace/media/splat-settings-test.png', Buffer.from(shot.result.data, 'base64'));
  out.shot = true;
}
out.loopErr = await ev(`window.__svLoopError || null`);
console.log(JSON.stringify(out, null, 1));
ws.close(); process.exit(0);


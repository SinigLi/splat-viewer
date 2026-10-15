// test-xform.mjs - verify toggle defaults, transform mode: move + scale mesh
const CDP_PORT = '9228';
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
// default states should match unchecked boxes
out.defaults = await ev(`JSON.stringify({grid: window.__sv.helpersScene.children[0].visible, axes: window.__sv.helpersScene.children[1].visible, xformToggleChecked: document.getElementById('xformToggle').checked})`);

const doc = await send('DOM.getDocument', { depth: 1 });
const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#fileInput' });
await send('DOM.setFileInputFiles', { files: ['E:\\opensource\\workdatas\\20261004-131022_002cut\\final.ply'], nodeId: q.result.nodeId });
await sleep(10000);

out.meshPos0 = await ev(`JSON.stringify(window.__sv.viewer.splatMesh.position.toArray().map(x=>+x.toFixed(3)))`);
out.meshScale0 = await ev(`window.__sv.viewer.splatMesh.scale.x`);

// enable transform mode
await ev(`const x=document.getElementById('xformToggle'); x.checked=true; x.dispatchEvent(new Event('change'))`);

// single-finger drag: move mesh right 100px
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 400, y: 450, id: 1 }] });
for (let i = 1; i <= 10; i++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 400 + i * 10, y: 450, id: 1 }] }); await sleep(16); }
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(400);
out.meshPos1 = await ev(`JSON.stringify(window.__sv.viewer.splatMesh.position.toArray().map(x=>+x.toFixed(3)))`);
out.azimUnchanged = await ev(`window.__sv.orbit.azim`); // should stay initial (not orbiting)

// pinch: scale mesh up
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 350, y: 450, id: 1 }, { x: 450, y: 450, id: 2 }] });
for (let step = 1; step <= 8; step++) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 350 - step * 15, y: 450, id: 1 }, { x: 450 + step * 15, y: 450, id: 2 }] });
  await sleep(16);
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(400);
out.meshScale1 = await ev(`window.__sv.viewer.splatMesh.scale.x`);
out.loopErr = await ev(`window.__svLoopError || null`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync('F:/openclawhome/openclaw/fullstack_workspace/media/splat-xform-test.png', Buffer.from(shot.result.data, 'base64'));
  out.shot = true;
}
console.log(JSON.stringify(out, null, 1));
ws.close(); process.exit(0);

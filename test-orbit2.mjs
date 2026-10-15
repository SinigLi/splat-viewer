// test-orbit.mjs - simulate drag gestures via CDP Input.dispatchTouchEvent, verify orbit/pan/zoom
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
const doc = await send('DOM.getDocument', { depth: 1 });
const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#fileInput' });
await send('DOM.setFileInputFiles', { files: ['E:\\opensource\\workdatas\\20261004-131022_002cut\\final.ply'], nodeId: q.result.nodeId });
await sleep(10000);

const out = {};
out.before = await ev(`JSON.stringify(window.__sv.orbit)`);

// single-finger drag: 200px right (should change azim)
const touchPoints = [];
for (let i = 0; i <= 10; i++) touchPoints.push({ x: 400 + i * 20, y: 450 });
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 400, y: 450, id: 1 }] });
for (let i = 1; i < touchPoints.length; i++) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchPoints[i].x, y: touchPoints[i].y, id: 1 }] });
  await sleep(16);
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(500);
out.afterDrag = await ev(`JSON.stringify(window.__sv.orbit)`);

// pinch: two fingers spread (should change dist)
const p1 = { x: 350, y: 450, id: 1 }, p2 = { x: 450, y: 450, id: 2 };
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p1, p2] });
for (let step = 1; step <= 8; step++) {
  const a = { x: 350 - step * 15, y: 450, id: 1 };
  const b = { x: 450 + step * 15, y: 450, id: 2 };
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [a, b] });
  await sleep(16);
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(500);
out.afterPinch = await ev(`JSON.stringify(window.__sv.orbit)`);

// camera actually moved?
out.camPos = await ev(`JSON.stringify(window.__sv.camera.position.toArray().map(x=>+x.toFixed(2)))`);
out.loopErr = await ev(`window.__svLoopError || null`);

console.log(JSON.stringify(out, null, 1));
ws.close(); process.exit(0);

// test-project.mjs - verify .svproj save/open round-trip:
// session1: load model, transform mesh + orbit + settings -> collectProject -> write file
// session2: fresh page -> open project -> pick model -> verify state restored
import { writeFileSync } from 'node:fs';
const CDP_PORT = '9223';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const mkTab = async () => {
  const tab = await (await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent('http://localhost:4173/')}`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  let msgId = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r.result?.result?.value; };
  for (let i = 0; i < 20; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(500); }
  return { ws, send, ev };
};
const setFiles = async (send, selector, files) => {
  const doc = await send('DOM.getDocument', { depth: 1 });
  const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
  await send('DOM.setFileInputFiles', { files, nodeId: q.result.nodeId });
};

const out = {};
// ---- session 1: load + modify state ----
const s1 = await mkTab();
await setFiles(s1.send, '#fileInput', ['E:\\opensource\\workdatas\\20261004-131022_002cut\\final.ply']);
await sleep(10000);
// transform mode on, drag right 100px (mesh move), pinch handled separately: just set scale via drag not needed - use moveMeshBy
await s1.ev(`const x=document.getElementById('xformToggle'); x.checked=true; x.dispatchEvent(new Event('change'))`);
await s1.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 400, y: 450, id: 1 }] });
for (let i = 1; i <= 10; i++) { await s1.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 400 + i * 10, y: 450, id: 1 }] }); await sleep(16); }
await s1.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(300);
// orbit: azim change via normal mode drag? keep simple: set orbit + settings directly then collect
await s1.ev(`document.getElementById('xformToggle').checked=false; document.getElementById('xformToggle').dispatchEvent(new Event('change'))`);
await s1.ev(`window.__sv.orbit.azim = 1.234; window.__sv.orbit.elev = -0.5; window.__sv.orbit.dist = 12; window.__sv.orbit.focal.set(1,2,3)`);
await s1.ev(`const r=document.getElementById('sensRange'); r.value='0.5'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change'))`);
await s1.ev(`const g=document.getElementById('gridToggle'); g.checked=true; g.dispatchEvent(new Event('change'))`);
await sleep(300);
const projJson = await s1.ev(`JSON.stringify(window.__sv.collectProject())`);
out.collectOk = !!projJson && projJson.includes('final.ply');
writeFileSync(process.env.TEMP + '\\test.svproj', projJson);
out.meshMoved = await s1.ev(`window.__sv.viewer.splatMesh.position.x.toFixed(3)`);
s1.ws.close();

// ---- session 2: fresh page, open project, pick model ----
const s2 = await mkTab();
out.freshDefaults = await s2.ev(`JSON.stringify({azim:+window.__sv.orbit.azim.toFixed(3), sens:document.getElementById('sensRange').value})`);
await setFiles(s2.send, '#projInput', [process.env.TEMP + '\\test.svproj']);
await sleep(800);
out.projHint = await s2.ev(`[...document.querySelectorAll('#hud .chip')].map(c=>c.textContent).join(' | ')`);
await setFiles(s2.send, '#fileInput', ['E:\\opensource\\workdatas\\20261004-131022_002cut\\final.ply']);
await sleep(10000);
out.restored = await s2.ev(`JSON.stringify({
  azim: +window.__sv.orbit.azim.toFixed(3),
  elev: +window.__sv.orbit.elev.toFixed(3),
  dist: +window.__sv.orbit.dist.toFixed(2),
  focal: window.__sv.orbit.focal.toArray().map(x=>+x.toFixed(2)),
  meshX: +window.__sv.viewer.splatMesh.position.x.toFixed(3),
  meshScale: +window.__sv.viewer.splatMesh.scale.x.toFixed(3),
  sens: document.getElementById('sensRange').value,
  grid: window.__sv.helpersScene.children[0].visible
})`);
out.loopErr = await s2.ev(`window.__svLoopError || null`);
const shot = await s2.send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  writeFileSync('F:/openclawhome/openclaw/fullstack_workspace/media/splat-project-test.png', Buffer.from(shot.result.data, 'base64'));
  out.shot = true;
}
console.log(JSON.stringify(out, null, 1));
s2.ws.close(); process.exit(0);


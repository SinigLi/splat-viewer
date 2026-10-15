// test-zip-project.mjs - v2 zip project round-trip via UI:
// session1: load model, change state, save (intercept download blob bytes)
// session2: fresh page, open .svproj -> verify auto-load (no second file pick)
import { writeFileSync } from 'node:fs';
const CDP_PORT = '9228';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const mkTab = async () => {
  const tab = await (await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent('http://localhost:4173/')}`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  let msgId = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r.result?.result?.value; };
  await send('Runtime.enable');
  await send('Page.enable');
  for (let i = 0; i < 20; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(500); }
  return { ws, send, ev };
};
const setFiles = async (send, selector, files) => {
  const doc = await send('DOM.getDocument', { depth: 1 });
  const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
  await send('DOM.setFileInputFiles', { files, nodeId: q.result.nodeId });
};
// capture blob URL downloads by patching createElement before clicking save
const installBlobTrap = async (ev) => {
  await ev(`window.__svSaved = null; const _c = document.createElement.bind(document); document.createElement = function(tag) { const el = _c(tag); if (tag === 'a') { const _click = el.click.bind(el); let _href=''; Object.defineProperty(el, 'href', { set(v){ _href = v; }, get(){ return _href; } }); el.click = async () => { try { const b = await (await fetch(_href)).blob(); window.__svSaved = new Uint8Array(await b.arrayBuffer()); } catch(e) { window.__svSavedErr = e.message; } _click(); }; } return el; }`);
};

const out = {};
// ---- session 1: load + modify + save ----
const s1 = await mkTab();
await setFiles(s1.send, '#fileInput', ['E:\\opensource\\workdatas\\20261004-131022_002cut\\final.ply']);
await sleep(10000);
out.s1Loaded = await s1.ev(`!!window.__sv && window.__sv.viewer.splatMesh ? document.getElementById('hud').children[1].textContent : 'FAIL'`);
await s1.ev(`window.__sv.orbit.azim = 0.99; window.__sv.orbit.dist = 15; window.__sv.orbit.focal.set(0.5, 0.5, 0.5)`);
await installBlobTrap(s1.ev);
await s1.ev(`document.getElementById('saveBtn').click()`);
await sleep(2500);
out.savedBytes = await s1.ev(`window.__svSaved ? window.__svSaved.length : (window.__svSavedErr || 'null')`);
out.savedMagic = await s1.ev(`window.__svSaved ? [window.__svSaved[0], window.__svSaved[1]].join(',') : 'null'`); // expect 80,75 (PK)
const b64 = await s1.ev(`window.__svSaved ? btoa(String.fromCharCode(...window.__svSaved.slice(0, 1000000))) : 'null'`);
// zip may exceed 1MB chunks; use full b64 in chunks
const fullB64 = await s1.ev(`(function(){ const u = window.__svSaved; let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); })()`);
writeFileSync(process.env.TEMP + '\\test-v2.svproj', Buffer.from(fullB64, 'base64'));
out.fileOnDisk = (await import('node:fs')).statSync(process.env.TEMP + '\\test-v2.svproj').size;
s1.ws.close();

// ---- session 2: fresh page, open project -> auto restore ----
const s2 = await mkTab();
out.freshNoModel = await s2.ev(`window.__sv.viewer ? (window.__sv.viewer.splatMesh ? 'loaded' : 'empty') : 'noviewer'`);
await setFiles(s2.send, '#projInput', [process.env.TEMP + '\\test-v2.svproj']);
await sleep(13000); // auto load model from zip
out.restored = await s2.ev(`JSON.stringify({
  azim: +window.__sv.orbit.azim.toFixed(3),
  dist: +window.__sv.orbit.dist.toFixed(2),
  focal: window.__sv.orbit.focal.toArray().map(x=>+x.toFixed(2)),
  meshLoaded: !!(window.__sv.viewer && window.__sv.viewer.splatMesh),
  hud: document.getElementById('hud').children[1] ? document.getElementById('hud').children[1].textContent : ''
})`);
out.loopErr = await s2.ev(`window.__svLoopError || null`);
const shot = await s2.send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  writeFileSync('F:/openclawhome/openclaw/fullstack_workspace/media/splat-zip-project-test.png', Buffer.from(shot.result.data, 'base64'));
  out.shot = true;
}
console.log(JSON.stringify(out, null, 1));
s2.ws.close(); process.exit(0);

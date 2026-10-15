// test-project-manager.mjs - E2E: new project -> import -> save -> back -> list -> reopen
import { writeFileSync } from 'node:fs';
const CDP_PORT = '9223';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 全局看门狗：任何卡死都能退出并输出已有进度
setTimeout(() => { console.error('WATCHDOG TIMEOUT'); process.exit(2); }, 100000);

const mkTab = async (tag) => {
  console.error('[step] mkTab ' + tag);
  // node fetch 在本机对 CDP 会挂起，改用 curl 子进程（已验证可用）
  const { execFileSync } = await import('node:child_process');
  const raw = execFileSync('curl.exe', ['-s', '--max-time', '15', '-X', 'PUT',
    `http://localhost:${CDP_PORT}/json/new?${encodeURIComponent('http://localhost:4173/')}`], { encoding: 'utf8' });
  const tab = JSON.parse(raw);
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ws open timeout')), 10000);
    ws.onopen = () => { clearTimeout(t); res(); };
    ws.onerror = () => { clearTimeout(t); rej(new Error('ws error')); };
  });
  let msgId = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r.result?.result?.value; };
  const evT = (expr, ms = 15000) => Promise.race([
    ev(expr),
    new Promise((r) => setTimeout(() => r('<<TIMEOUT>>'), ms)),
  ]);
  for (let i = 0; i < 20; i++) { if (await evT('document.readyState') === 'complete') break; await sleep(500); }
  return { ws, send, ev, evT };
};
const setFiles = async (send, selector, files) => {
  const doc = await send('DOM.getDocument', { depth: 1 });
  const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
  await send('DOM.setFileInputFiles', { files, nodeId: q.result.nodeId });
};
// stub confirm() to auto-accept deletes
const stubConfirm = async (ev) => { await evT(`window.confirm = () => true`); };

const out = {};
const s1 = await mkTab('session1');
out.errors0 = await s1.evT(`window.__svLoopError || null`);
out.moduleLoaded = await s1.evT(`!!window.__sv`);

// 1. new project
await s1.evT(`document.getElementById('newProjBtn').click()`);
await s1.evT(`document.getElementById('newProjName').value='娴嬭瘯鎭愰緳'`);
await s1.evT(`document.getElementById('newProjConfirm').click()`);
await sleep(500);
out.onModelPage = await s1.evT(`document.getElementById('modelPage').classList.contains('active')`);
out.projName = await s1.evT(`window.__sv.currentProjectName`);
out.hudText = await s1.evT(`document.getElementById('hud').children[1].textContent`);

// 2. import model
await setFiles(s1.send, '#fileInput', ['E:\\opensource\\workdatas\\20261004-131022_002cut\\final.ply']);
await sleep(11000);
out.modelLoaded = await s1.evT(`!!(window.__sv.viewer && window.__sv.viewer.splatMesh)`);

// 3. change view + save
await s1.evT(`window.__sv.orbit.azim = 0.77; window.__sv.orbit.dist = 13`);
await sleep(300);
await s1.evT(`document.getElementById('saveProjBtn').click()`);
await sleep(2000);
out.saveHud = await s1.evT(`document.getElementById('hud').children[1].textContent`);

// 4. back to list (should NOT prompt dirty since just saved)
await s1.evT(`document.getElementById('backBtn').click()`);
await sleep(800);
out.backOnList = await s1.evT(`document.getElementById('projectsPage').classList.contains('active')`);
out.exitDialogShown = await s1.evT(`document.getElementById('exitDialog').classList.contains('open')`);
out.cardCount = await s1.evT(`document.querySelectorAll('.projCard').length`);
out.cardName = await s1.evT(`document.querySelector('.projName') ? document.querySelector('.projName').textContent : 'none'`);
// thumb loaded?
await sleep(800);
out.thumbImg = await s1.evT(`!!document.querySelector('img.projThumb')`);
s1.ws.close();

// 5. fresh session: reopen project -> auto restore
const s2 = await mkTab('session2');
out.cardCount2 = await s2.evT(`document.querySelectorAll('.projCard').length`);
await s2.evT(`document.querySelector('.projCard').click()`);
await sleep(12000);
out.reopened = await s2.evT(`JSON.stringify({
  proj: window.__sv.currentProjectName,
  azim: +window.__sv.orbit.azim.toFixed(3),
  dist: +window.__sv.orbit.dist.toFixed(2),
  modelLoaded: !!(window.__sv.viewer && window.__sv.viewer.splatMesh)
})`);

// 6. dirty check: rotate then back -> exit dialog appears
await s2.evT(`window.__sv.orbit.azim = 2.22`);
await sleep(300);
await s2.evT(`document.getElementById('backBtn').click()`);
await sleep(400);
out.dirtyPrompt = await s2.evT(`document.getElementById('exitDialog').classList.contains('open')`);
await s2.evT(`document.getElementById('exitCancel').click()`);
out.loopErr = await s2.evT(`window.__svLoopError || null`);
const shot = await s2.send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  writeFileSync('F:/openclawhome/openclaw/fullstack_workspace/media/splat-projmgr-test.png', Buffer.from(shot.result.data, 'base64'));
  out.shot = true;
}
console.log(JSON.stringify(out, null, 1));
s2.ws.close(); process.exit(0);




// Video Messaging for Muse — Instagram video call driver.
// Places a video call in an Instagram DM thread through the call browser
// (Chrome DevTools Protocol). The click lands on the "Video call" SVG's own
// rect; the call UI may open as a new target (instagram.com/call/) OR as an
// in-page lobby in the thread tab — both are detected. Then: Start call ->
// poll for connect -> screenshot -> hold ~55s -> End call.
// Requires the media permission pre-seed first (drivers/preseed-permissions.mjs)
// and the endpoint running (scripts/start-endpoint.sh).
// Env: VB_CDP_HTTP (call browser CDP base, default http://127.0.0.1:9230),
//      IG_THREAD_URL (required, e.g. https://www.instagram.com/direct/t/<id>/)
import { writeFileSync } from 'node:fs';
const wait = ms => new Promise(r => setTimeout(r, ms));
const THREAD = process.env.IG_THREAD_URL;
if (!THREAD) { console.log('STOP: set IG_THREAD_URL to your Instagram DM thread URL'); process.exit(1); }
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
const version = await (await fetch((process.env.VB_CDP_HTTP || 'http://127.0.0.1:9230') + '/json/version')).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}, sessionId) => new Promise(res => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) })); });
const attach = async tid => { const r = await send('Target.attachToTarget', { targetId: tid, flatten: true }); const sid = r.result.sessionId; await send('Page.enable', {}, sid); await send('Runtime.enable', {}, sid); return sid; };
const evIn = sid => async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid); if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 200); return r.result?.result?.value; };
const shotIn = sid => async name => { const s = await send('Page.captureScreenshot', { format: 'png' }, sid); if (s.result?.data) { writeFileSync('./' + name, Buffer.from(s.result.data, 'base64')); return true; } return false; };
const clickAt = async (sid, x, y) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sid); await wait(250); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sid); await wait(120); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sid); };
const result = { answered: false, connectAtSec: null, hintPresent: null, loadingStuck: null, uiHost: null, finalState: null };

// thread tab (must already be on the thread)
const ts0 = (await send('Target.getTargets')).result.targetInfos;
const thread = ts0.find(t => t.type === 'page' && (t.url || '').includes(new URL(THREAD).pathname));
if (!thread) { console.log('STOP: thread tab not found'); process.exit(0); }
const tsid = await attach(thread.targetId); const ev = evIn(tsid); const shot = shotIn(tsid);
console.log('[' + stamp() + '] thread tab attached');

// precise Video call click: the SVG's own rect
const vc = await ev(`(() => {
  const svg = [...document.querySelectorAll('svg')].find(s => (s.getAttribute('aria-label') || '') === 'Video call');
  if (!svg) return null;
  const r = svg.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
})()`);
console.log('[' + stamp() + '] Video call SVG rect:', JSON.stringify(vc));
if (!vc) { console.log('STOP: Video call svg not found'); await shot('ig-stop.png'); process.exit(0); }
await clickAt(tsid, vc.x, vc.y);
console.log('[' + stamp() + '] CLICKED Video call (precise)');

// detect call UI host: new target or in-page Start call
let csid = null, callTargetId = null;
const startBtnIn = sid => evIn(sid)(`(() => { const b = [...document.querySelectorAll('[role=button], button')].find(x => (x.innerText || '').trim() === 'Start call'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`).catch(() => null);
for (let i = 0; i < 12 && !csid; i++) {
  await wait(2500);
  const ts = (await send('Target.getTargets')).result.targetInfos;
  const ct = ts.find(t => t.type === 'page' && (t.url || '').includes('instagram.com/call/'));
  if (ct) { callTargetId = ct.targetId; csid = await attach(ct.targetId); result.uiHost = 'popup:' + ct.url; console.log('[' + stamp() + '] call UI = popup target'); break; }
  const sb = await startBtnIn(tsid);
  if (sb) { csid = tsid; result.uiHost = 'in-page'; console.log('[' + stamp() + '] call UI = in-page lobby'); break; }
  console.log('[' + stamp() + '] waiting for call UI...');
}
if (!csid) { console.log('STOP: no call UI (no popup, no in-page lobby)'); await shot('ig-stop2.png'); process.exit(0); }
const cev = evIn(csid); const cshot = shotIn(csid);

// Start call
let sc = null;
for (let i = 0; i < 12 && !sc; i++) { sc = await startBtnIn(csid); if (!sc) await wait(2000); }
if (!sc) { console.log('STOP: Start call button never appeared'); await cshot('ig-stop2.png'); process.exit(0); }
await clickAt(csid, sc.x, sc.y);
const startAt = Date.now();
console.log('[' + stamp() + '] CLICKED Start call — RINGING');

// poll for connect
const readState = async () => cev(`(() => {
  const vids = [...document.querySelectorAll('video')].map(v => ({ w: v.videoWidth, h: v.videoHeight, paused: v.paused, rs: v.readyState }));
  const txt = (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400);
  const btns = [...document.querySelectorAll('[role=button], button')].map(b => b.getAttribute('aria-label') || (b.innerText || '').trim()).filter(Boolean);
  return { vids, txt, btns: [...new Set(btns)].slice(0, 16) };
})()`).catch(() => null);
let connected = null;
for (let i = 0; i < 30 && !connected; i++) {
  await wait(5000);
  const st = await readState();
  if (!st) { console.log('[' + stamp() + '] state read failed'); continue; }
  const remote = (st.vids || []).find(v => v.w > 0 && !v.paused && !(v.w === 448 && v.h === 720));
  const ringSec = ((Date.now() - startAt) / 1000).toFixed(0);
  console.log('[' + stamp() + '] ring+' + ringSec + 's vids=' + JSON.stringify(st.vids) + ' hint=' + /allow microphone access/i.test(st.txt) + ' loading=' + /Loading\.\.\./.test(st.txt) + ' txt=' + JSON.stringify(st.txt.slice(0, 140)));
  if (remote) connected = st;
}
if (connected) {
  result.answered = true;
  result.connectAtSec = ((Date.now() - startAt) / 1000).toFixed(0);
  result.hintPresent = /allow microphone access/i.test(connected.txt);
  result.loadingStuck = /Loading\.\.\./.test(connected.txt);
  console.log('[' + stamp() + '] CONNECTED:', JSON.stringify(connected));
  await cshot('ig-incall.png');
  console.log('[' + stamp() + '] screenshot ig-incall.png; HOLDING ~55s');
  await wait(55000);
  const st2 = await readState();
  result.finalState = st2;
  console.log('[' + stamp() + '] post-hold state:', JSON.stringify(st2));
  await cshot('ig-incall2.png');
} else {
  console.log('[' + stamp() + '] NO CONNECT within ring window');
  await cshot('ig-noconnect.png');
}
// End call
const endBtn = await cev(`(() => {
  const cands = [...document.querySelectorAll('[role=button], button')];
  const b = cands.find(x => /end call|leave call|hang up|end video/i.test(x.getAttribute('aria-label') || '') || /^(end call|leave call)$/i.test((x.innerText || '').trim()));
  if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`).catch(() => null);
if (endBtn && endBtn.x) { await clickAt(csid, endBtn.x, endBtn.y); console.log('[' + stamp() + '] clicked End call'); await wait(3000); }
else if (callTargetId) { await send('Target.closeTarget', { targetId: callTargetId }); console.log('[' + stamp() + '] closed call popup to end'); await wait(2000); }
else { console.log('[' + stamp() + '] no End control found (in-page UI)'); }
console.log('RESULT_IG:', JSON.stringify(result));
process.exit(0);

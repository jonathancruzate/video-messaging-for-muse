// Video Messaging for Muse — Messenger video call driver.
// Places a video call in a Messenger (E2EE) thread through the call browser
// (Chrome DevTools Protocol). Watches the thread page AND any new call
// popout for answer state (self preview = the virtual camera's frame size;
// remote video differs; a call timer or End-call control also signals
// connection), holds ~60s if answered, screenshots, ends the call.
// Media permission must be secured BEFORE dialing (see
// drivers/preseed-permissions.mjs): this driver deliberately does not try
// to grant or work around permissions from inside the page.
// Env: VB_CDP_HTTP (call browser CDP base, default http://127.0.0.1:9230),
//      MSGR_THREAD_URL (required, e.g. https://www.messenger.com/e2ee/t/<id>/)
import { writeFileSync } from 'node:fs';
const wait = ms => new Promise(r => setTimeout(r, ms));
const THREAD = process.env.MSGR_THREAD_URL;
if (!THREAD) { console.log('STOP: set MSGR_THREAD_URL to your Messenger thread URL'); process.exit(1); }
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
const version = await (await fetch((process.env.VB_CDP_HTTP || 'http://127.0.0.1:9230') + '/json/version')).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}, sessionId) => new Promise(res => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) })); });

const targets0 = (await send('Target.getTargets')).result.targetInfos;
const byCtx = {};
for (const t of targets0) { const c = t.browserContextId || 'NONE'; (byCtx[c] ||= []).push(t); }
let p6ctx = null;
for (const [ctx, ts] of Object.entries(byCtx)) {
  const urls = ts.filter(t => t.type === 'page').map(t => t.url || '');
  if (urls.some(u => u.includes('instagram.com/direct')) ||
      urls.some(u => u.includes('messenger.com'))) { p6ctx = ctx; break; }
}
if (!p6ctx) { console.log('STOP: Profile 6 context NOT identified'); process.exit(0); }
console.log('[' + stamp() + '] call browser ctx:', p6ctx);
// NOTE: no grantPermissions here on purpose. It does not persist for call
// popups; the working play is the Browser.setPermission pre-seed
// (drivers/preseed-permissions.mjs) or answering the real prompt once.

const attach = async tid => {
  const { result } = await send('Target.attachToTarget', { targetId: tid, flatten: true });
  await send('Page.enable', {}, result.sessionId); await send('Runtime.enable', {}, result.sessionId);
  return result.sessionId;
};
const evIn = sid => async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 200);
  return r.result?.result?.value;
};
const shotIn = sid => async name => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
  if (s.result?.data) { writeFileSync('./' + name, Buffer.from(s.result.data, 'base64')); return true; }
  return false;
};
const clickAt = async (sid, x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sid);
  await wait(200);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sid);
  await wait(110);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sid);
};

let page = (byCtx[p6ctx] || []).find(t => t.type === 'page' && (t.url || '').includes('messenger.com'));
let threadId = page?.targetId;
if (!threadId) {
  const r = await send('Target.createTarget', { url: THREAD, browserContextId: p6ctx });
  threadId = r.result?.targetId;
  console.log('[' + stamp() + '] created messenger tab:', threadId);
  await wait(7000);
} else console.log('[' + stamp() + '] existing messenger tab:', page.url);
const tsid = await attach(threadId);
const ev = evIn(tsid); const shot = shotIn(tsid);
let url = await ev('location.href');
if (!url.startsWith(THREAD)) { await send('Page.navigate', { url: THREAD }, tsid); await wait(9000); url = await ev('location.href'); }
console.log('[' + stamp() + '] thread url:', url);
if (/login|checkpoint|challenge/.test(url)) { console.log('STOP: login/checkpoint wall at', url); await shot('msgr-stop.png'); process.exit(0); }
await wait(2500);

// PIN modal: Escape only (never create/enter a PIN)
const pinPresent = await ev(`(() => (document.body.innerText || '').includes('Create a PIN'))()`);
console.log('[' + stamp() + '] Create-a-PIN modal present:', !!pinPresent);
if (pinPresent) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, tsid);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, tsid);
  await wait(2500);
  console.log('[' + stamp() + '] PIN modal after Escape:', await ev(`(() => (document.body.innerText || '').includes('Create a PIN'))()`));
}

// Find "Start a video call"
const vc = await ev(`(() => { const b = [...document.querySelectorAll('[role=button], button')].find(x => (x.getAttribute('aria-label') || '') === 'Start a video call'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
console.log('[' + stamp() + '] Start-a-video-call button:', JSON.stringify(vc));
if (!vc) { console.log('STOP: video call button not found'); await shot('msgr-stop.png'); process.exit(0); }

const baseTargets = new Set((await send('Target.getTargets')).result.targetInfos.map(t => t.targetId));
await clickAt(tsid, vc.x, vc.y);
console.log('[' + stamp() + '] CLICKED Start a video call — ringing');
await wait(3000);

const stateExpr = `(() => {
  const vids = [...document.querySelectorAll('video')].map(v => ({ w: v.videoWidth, h: v.videoHeight, paused: v.paused, rs: v.readyState }));
  const btns = [...document.querySelectorAll('[role=button], button')].map(b => b.getAttribute('aria-label') || (b.innerText || '').trim()).filter(Boolean);
  const txt = (document.body.innerText || '').replace(/\\s+/g, ' ');
  const callTxt = /ringing|calling|connecting|end-to-end encrypted calling|please allow|allow access|microphone and camera/i.test(txt) ? txt.slice(0, 300) : '';
  return { url: location.href.slice(0, 85), vids, btns: [...new Set(btns)].filter(b => /call|mute|camera|speaker|video/i.test(b)).slice(0, 12), timer: /\\b\\d{1,2}:\\d{2}\\b/.test(txt.slice(-1500)), callTxt };
})()`;
let callSid = null, callTargetId = null, answered = false, answerAt = null, gone = false, stuckPerm = false;
const deadline = Date.now() + 115000;
let lastLine = '';
while (Date.now() < deadline) {
  await wait(3000);
  if (!callSid) {
    const ts = (await send('Target.getTargets')).result.targetInfos;
    const nt = ts.find(t => t.type === 'page' && t.browserContextId === p6ctx && !baseTargets.has(t.targetId));
    if (nt) { try { callSid = await attach(nt.targetId); callTargetId = nt.targetId; console.log('[' + stamp() + '] call surface appeared:', nt.url); } catch { /* retry */ } }
  }
  const states = [];
  if (callSid) { const s = await evIn(callSid)(stateExpr).catch(() => null); if (s) states.push({ where: 'callwin', s }); }
  const ts2 = await ev(stateExpr).catch(() => null);
  if (ts2 && (ts2.vids.length || /call/i.test(ts2.callTxt || ''))) states.push({ where: 'thread', s: ts2 });
  for (const { where, s } of states) {
    const line = where + ':' + JSON.stringify(s);
    if (line !== lastLine) { console.log('[' + stamp() + '] STATE:', line.slice(0, 550)); lastLine = line; }
    const remoteLive = (s.vids || []).some(v => v.w > 0 && !v.paused && !(v.w === 448 && v.h === 720));
    const playingCount = (s.vids || []).filter(v => v.w > 0 && !v.paused).length;
    const hasEndBtn = (s.btns || []).some(b => /end call|leave call/i.test(b));
    if (!answered && (remoteLive || playingCount >= 2 || (hasEndBtn && s.timer))) { answered = true; answerAt = Date.now(); console.log('[' + stamp() + '] ANSWERED — remote media live (' + where + ')'); }
    if (/please allow|allow access to your camera|allow access to your microphone/i.test(s.callTxt || '')) stuckPerm = true;
  }
  if (answered && Date.now() - answerAt > 60000) break;
}
console.log('[' + stamp() + '] poll done. answered =', answered, 'permissionStuck =', stuckPerm);
const shotSid = callSid || tsid;
console.log('[' + stamp() + '] screenshot:', await shotIn(shotSid)(answered ? 'msgr-incall.png' : 'msgr-unanswered.png'));

// End the call
const endExpr = `(() => {
  const cands = [...document.querySelectorAll('[role=button], button')];
  const b = cands.find(x => /end call|leave call|hang up/i.test(x.getAttribute('aria-label') || '') || /^(end call|leave call)$/i.test((x.innerText || '').trim()));
  if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: b.getAttribute('aria-label') || (b.innerText || '').trim() };
})()`;
let endInfo = null;
if (callSid) endInfo = await evIn(callSid)(endExpr).catch(() => null);
if (!endInfo) endInfo = await ev(endExpr).catch(() => null);
console.log('[' + stamp() + '] End control:', JSON.stringify(endInfo));
if (endInfo && endInfo.x) {
  await clickAt(callSid || tsid, endInfo.x, endInfo.y);
  console.log('[' + stamp() + '] clicked End');
  await wait(3000);
} else if (callTargetId) {
  await send('Target.closeTarget', { targetId: callTargetId });
  console.log('[' + stamp() + '] closed call window target to end call');
  await wait(2000);
}
console.log('RESULT_MSGR:', JSON.stringify({ answered, permissionStuck: stuckPerm, ringSeconds: answered ? Math.round((answerAt - t0) / 1000) : null }));
ws.close(); process.exit(0);

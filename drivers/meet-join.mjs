// Video Messaging for Muse — Google Meet driver (see docs/architecture.md).
// Env: VB_CDP_HTTP (call browser CDP base, default http://127.0.0.1:9230)
// Meet phase G: close Settings, verify mic/camera ON in pre-join, click
// "Join now", verify in-call state, screenshot to meet-in-call.png.
// Usage: node meet-join.mjs <targetId>
import { writeFileSync } from 'node:fs';
const wait = ms => new Promise(r => setTimeout(r, ms));
const CDP_BASE = process.env.VB_CDP_HTTP || 'http://127.0.0.1:9230';
const targetId = process.argv[2];
const version = await (await fetch(CDP_BASE + '/json/version')).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}, sessionId) => new Promise(res => {
  const mid = ++id; pending.set(mid, res);
  ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 300);
  return r.result?.result?.value;
};
const shot = async (path) => {
  const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  if (r.result?.data) { writeFileSync(path, Buffer.from(r.result.data, 'base64')); return true; }
  return false;
};
const clickAria = async (label) => {
  const loc = await ev(`(() => {
    const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const el = [...document.querySelectorAll('button, [role=button]')].filter(vis).find(e => (e.getAttribute('aria-label') || '') === ${JSON.stringify(label)});
    if (!el) return 'NOT FOUND: ' + ${JSON.stringify(label)};
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (typeof loc === 'string') { console.log(loc); return false; }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: loc.x, y: loc.y }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: loc.x, y: loc.y, button: 'left', clickCount: 1 }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: loc.x, y: loc.y, button: 'left', clickCount: 1 }, sessionId);
  console.log('clicked aria:', label);
  return true;
};
const clickText = async (text) => {
  const loc = await ev(`(() => {
    const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const el = [...document.querySelectorAll('button, [role=button]')].filter(vis).find(e => ((e.getAttribute('aria-label') || '') + ' ' + (e.innerText || '')).trim().replace(/\\s+/g, ' ').includes(${JSON.stringify(text)}));
    if (!el) return 'NOT FOUND: ' + ${JSON.stringify(text)};
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (typeof loc === 'string') { console.log(loc); return false; }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: loc.x, y: loc.y }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: loc.x, y: loc.y, button: 'left', clickCount: 1 }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: loc.x, y: loc.y, button: 'left', clickCount: 1 }, sessionId);
  console.log('clicked text:', text);
  return true;
};

// 1. Close settings dialog
await clickAria('Close dialog');
await wait(2000);
// 2. Pre-join toggle states: "Turn off X" means X is currently ON
const pre = await ev(`(() => {
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const arias = [...document.querySelectorAll('button, [role=button]')].filter(vis).map(b => b.getAttribute('aria-label') || '').filter(Boolean);
  return { micOn: arias.some(a => /turn off microphone/i.test(a)), micOff: arias.some(a => /turn on microphone/i.test(a)),
           camOn: arias.some(a => /turn off camera/i.test(a)), camOff: arias.some(a => /turn on camera/i.test(a)),
           hasJoinNow: arias.some(a => /join now/i.test(a)) || (document.body.innerText || '').includes('Join now'),
           hasAskToJoin: (document.body.innerText || '').includes('Ask to join') };
})()`);
console.log('PREJOIN TOGGLES:', JSON.stringify(pre));
// 3. Join
await clickText('Join now');
await wait(9000);
const post = await ev(`(() => {
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const arias = [...document.querySelectorAll('button, [role=button]')].filter(vis).map(b => b.getAttribute('aria-label') || '').filter(Boolean);
  const vids = [...document.querySelectorAll('video')].map(v => ({ w: v.videoWidth, h: v.videoHeight, paused: v.paused, tracks: v.srcObject ? v.srcObject.getTracks().map(t => t.kind + ':' + t.label + ':' + t.readyState) : [] }));
  return { url: location.href,
    leaveCall: arias.some(a => /leave call/i.test(a)),
    micOn: arias.some(a => /turn off microphone/i.test(a)),
    camOn: arias.some(a => /turn off camera/i.test(a)),
    videos: vids,
    text: (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 700) };
})()`);
console.log('IN-CALL STATE:', JSON.stringify(post, null, 1).slice(0, 2500));
await shot('./meet-in-call.png');
console.log('screenshot: ~/workspace/voicebridge/meet-in-call.png');
ws.close();

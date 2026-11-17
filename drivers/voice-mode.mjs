// Video Messaging for Muse — voice-mode starter.
// Starts (or restarts) the assistant's voice-mode call in the voice browser:
// reloads the page (drops earlier hooks), attaches console/network listeners
// only (non-invasive; never wrap RTCPeerConnection when testing), clicks
// Call, and polls the DOM until the call controls appear.
// The voice call drops when left idle, so run this immediately before
// dialing on the call side, and verify outbound capture in pactl.
// Env: VB_VOICE_CDP_HTTP (voice browser CDP base, default http://127.0.0.1:9452)
import { writeFileSync } from 'node:fs';
const wait = ms => new Promise(r => setTimeout(r, ms));
const version = await (await fetch((process.env.VB_VOICE_CDP_HTTP || 'http://127.0.0.1:9452') + '/json/version')).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); const consoleMsgs = []; const netReqs = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') consoleMsgs.push(m.params.type + ': ' + (m.params.args || []).map(a => { try { return a.value !== undefined ? String(a.value) : (a.description || ''); } catch { return ''; } }).join(' ').slice(0, 200));
  if (m.method === 'Runtime.exceptionThrown') consoleMsgs.push('EXC: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 200));
  if (m.method === 'Network.webSocketCreated') netReqs.push('WS: ' + (m.params.url || '').slice(0, 130));
  if (m.method === 'Network.requestWillBeSent') { const u = m.params.request?.url || ''; if (/voice|call|rtc|livekit|twilio|daily|agora|earcon/i.test(u)) netReqs.push(u.slice(0, 130)); }
});
const send = (method, params = {}, sessionId) => new Promise(res => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) })); });
const targets = (await send('Target.getTargets')).result.targetInfos;
const page = targets.find(t => t.type === 'page' && (t.url || '').includes('muse.ai'));
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Runtime.enable', {}, sessionId); await send('Page.enable', {}, sessionId); await send('Network.enable', {}, sessionId);
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 200);
  return r.result?.result?.value;
};
const shot = async path => { const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId); if (r.result?.data) writeFileSync(path, Buffer.from(r.result.data, 'base64')); };

await send('Page.reload', {}, sessionId);
await wait(9000);
console.log('cert API after reload:', await ev(`typeof RTCPeerConnection.generateCertificate`));
let found = null;
for (let i = 0; i < 12 && !found; i++) {
  found = await ev(`(() => {
    const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.disabled; };
    const btns = [...document.querySelectorAll('button, [role=button], a')].filter(vis);
    const call = btns.find(b => (b.getAttribute('aria-label') || '').trim() === 'Call' || (b.innerText || '').trim() === 'Call');
    if (!call) return null;
    const r = call.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!found) await wait(2000);
}
console.log('Call button:', JSON.stringify(found));
if (found) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: found.x, y: found.y }, sessionId);
  await wait(250);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: found.x, y: found.y, button: 'left', clickCount: 1 }, sessionId);
  await wait(120);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: found.x, y: found.y, button: 'left', clickCount: 1 }, sessionId);
}
for (let i = 0; i < 7; i++) {
  await wait(3500);
  const snap = await ev(`(() => ({
    interesting: [...document.querySelectorAll('button,[role=button],[role=dialog]')].map(b => (b.getAttribute('aria-label') || b.innerText || '').trim().replace(/\\s+/g, ' ')).filter(t => /end call|mute|unmute|hang up|leave call|disconnect|connecting|listening/i.test(t)).slice(0, 8),
    selects: [...document.querySelectorAll('select')].map(s => [...s.options].map(o => o.text).join('|')).slice(0, 4)
  }))()`);
  console.log(`poll ${i + 1}:`, JSON.stringify(snap));
  if (snap && snap.interesting && snap.interesting.length) break;
}
await shot('./voice-mode.png');
console.log('NET:', JSON.stringify(netReqs.slice(-12)));
console.log('CONSOLE:', JSON.stringify(consoleMsgs.slice(-12)));
ws.close();

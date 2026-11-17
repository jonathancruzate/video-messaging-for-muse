// Video Messaging for Muse — Google Meet driver (see docs/architecture.md).
// Env: VB_CDP_HTTP (call browser CDP base, default http://127.0.0.1:9230)
// Meet phase F: in the open Settings dialog, set Microphone=VB_VoiceMic,
// Speaker=VB_CallOut (Audio tab), Camera=VB_Camera (Video tab). Read back.
// Usage: node meet-set-devices.mjs <targetId>
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
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
};
// Find the dropdown control for a labelled row: the clickable element showing
// the current value, located below the label text within the dialog.
const findPicker = (label) => ev(`(() => {
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const dlg = document.querySelector('[role=dialog]');
  if (!dlg) return 'NO DIALOG';
  // text node with exact label
  const walker = document.createTreeWalker(dlg, NodeFilter.SHOW_TEXT);
  let lab = null, node;
  while ((node = walker.nextNode())) { if (node.nodeValue.trim() === ${JSON.stringify(label)}) { lab = node.parentElement; break; } }
  if (!lab) return 'LABEL NOT FOUND: ' + ${JSON.stringify(label)};
  const lr = lab.getBoundingClientRect();
  // candidate controls: elements with arrow_drop_down under the label, in dialog
  const cands = [...dlg.querySelectorAll('button, [role=button], [role=listbox], [aria-haspopup]')].filter(vis)
    .filter(el => (el.innerText || '').includes('arrow_drop_down'))
    .map(el => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.top >= lr.top - 4 && r.top <= lr.bottom + 70)
    .sort((a, b) => a.r.top - b.r.top);
  if (!cands.length) return 'NO PICKER for ' + ${JSON.stringify(label)};
  const c = cands[0];
  return { x: c.r.x + c.r.width / 2, y: c.r.y + c.r.height / 2, current: (c.el.innerText || '').trim().replace(/\\s+/g, ' ').replace('arrow_drop_down', '').trim() };
})()`);
const clickOption = (name) => ev(`(() => {
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const els = [...document.querySelectorAll('[role=option], [role=menuitem], li, [role=listbox] *')].filter(vis);
  const el = els.find(e => (e.innerText || '').trim().replace(/\\s+/g, ' ') === ${JSON.stringify(name)}) ||
             els.find(e => (e.innerText || '').trim().replace(/\\s+/g, ' ').includes(${JSON.stringify(name)}));
  if (!el) {
    const all = els.map(e => (e.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 60)).filter(Boolean);
    return 'OPTION NOT FOUND; visible options: ' + JSON.stringify([...new Set(all)].slice(0, 20));
  }
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.innerText || '').trim().slice(0, 60) };
})()`);
async function pick(label, device) {
  const p = await findPicker(label);
  console.log(`picker ${label}:`, JSON.stringify(p));
  if (typeof p === 'string') return false;
  console.log(`  current value: ${p.current}`);
  if (p.current === device) { console.log('  already set'); return true; }
  await clickAt(p.x, p.y);
  await wait(1500);
  const o = await clickOption(device);
  console.log(`  option ${device}:`, JSON.stringify(o));
  if (typeof o === 'string') { await shot('/tmp/meet-picker-fail.png'); return false; }
  await clickAt(o.x, o.y);
  await wait(1500);
  const p2 = await findPicker(label);
  console.log(`  after:`, JSON.stringify(p2));
  return typeof p2 === 'object' && p2.current === device;
}
console.log('MIC ->', await pick('Microphone', 'VB_VoiceMic'));
console.log('SPEAKER ->', await pick('Speaker', 'VB_CallOut'));
await shot('/tmp/meet-settings-audio-set.png');
// Video tab
const tabLoc = await ev(`(() => {
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const els = [...document.querySelectorAll('[role=tab], li, button')].filter(vis);
  const el = els.find(e => (e.innerText || '').trim().replace(/\\s+/g, ' ').includes('Video'));
  if (!el) return 'NO VIDEO TAB';
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`);
console.log('video tab:', JSON.stringify(tabLoc));
if (typeof tabLoc === 'object') {
  await clickAt(tabLoc.x, tabLoc.y);
  await wait(2000);
  console.log('CAMERA ->', await pick('Camera', 'VB_Camera'));
  await shot('/tmp/meet-settings-video-set.png');
}
ws.close();

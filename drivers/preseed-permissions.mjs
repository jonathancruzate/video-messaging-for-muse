// Video Messaging for Muse — media permission pre-seed.
// THE core trick of this project: secure the browser-level media grant for
// a call origin BEFORE dialing, via CDP Browser.setPermission, then verify
// with permissions.query AND a real getUserMedia call in a tab on that
// origin. Browser.grantPermissions is NOT equivalent: it does not persist
// for the call popups these sites open. Fighting the permission prompt from
// inside the page burns the call; pre-seeding makes getUserMedia succeed
// immediately, labeled with the virtual camera.
//
// Usage: node drivers/preseed-permissions.mjs [origin]
//   origin defaults to https://www.instagram.com
// Env: VB_CDP_HTTP (call browser CDP base, default http://127.0.0.1:9230)
const wait = ms => new Promise(r => setTimeout(r, ms));
const ORIGIN = process.argv[2] || 'https://www.instagram.com';
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
const version = await (await fetch((process.env.VB_CDP_HTTP || 'http://127.0.0.1:9230') + '/json/version')).json();
console.log('browser:', version.Browser);
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}, sessionId) => new Promise(res => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) })); });

// Identify the browser context that holds the call profile: the one with a
// page on the target origin's host (or any page on a related call site).
const host = new URL(ORIGIN).hostname.replace(/^www\./, '');
const targets0 = (await send('Target.getTargets')).result.targetInfos;
const byCtx = {};
for (const t of targets0) { const c = t.browserContextId || 'NONE'; (byCtx[c] ||= []).push(t); }
let ctx = null;
for (const [c, ts] of Object.entries(byCtx)) {
  const urls = ts.filter(t => t.type === 'page').map(t => t.url || '');
  if (urls.some(u => u.includes(host) || u.includes('messenger.com') || u.includes('instagram.com'))) { ctx = c; break; }
}
if (!ctx) { console.log('STOP: call browser context NOT identified'); process.exit(0); }
console.log('[' + stamp() + '] call browser ctx:', ctx);

// Browser.setPermission for camera + microphone on the origin
for (const name of ['camera', 'microphone']) {
  const r = await send('Browser.setPermission', {
    permission: { name },
    setting: 'granted',
    origin: ORIGIN,
    browserContextId: ctx,
  });
  console.log('[' + stamp() + '] setPermission ' + name + ':', r.error ? 'ERROR ' + JSON.stringify(r.error).slice(0, 250) : 'ok');
}

// Find or create a tab on the origin and verify for real
let page = ((await send('Target.getTargets')).result.targetInfos.filter(t => t.browserContextId === ctx))
  .find(t => t.type === 'page' && (t.url || '').includes(host));
let tabId = page?.targetId;
if (!tabId) {
  const r = await send('Target.createTarget', { url: ORIGIN + '/', browserContextId: ctx });
  tabId = r.result?.targetId;
  console.log('[' + stamp() + '] created tab:', tabId);
  await wait(6000);
} else {
  console.log('[' + stamp() + '] existing tab:', page.url);
}
const { result: att } = await send('Target.attachToTarget', { targetId: tabId, flatten: true });
const sid = att.sessionId;
await send('Page.enable', {}, sid); await send('Runtime.enable', {}, sid);
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid);
  if (r.result?.exceptionDetails) return 'EXC: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300);
  return r.result?.result?.value;
};
console.log('[' + stamp() + '] tab origin:', await ev('location.origin'));
console.log('[' + stamp() + '] permissions.query camera:', await ev(`navigator.permissions.query({name:'camera'}).then(p=>p.state).catch(e=>'ERR '+e.message)`));
console.log('[' + stamp() + '] permissions.query microphone:', await ev(`navigator.permissions.query({name:'microphone'}).then(p=>p.state).catch(e=>'ERR '+e.message)`));
const gum = await ev(`(async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({audio:true, video:true});
    const tr = s.getTracks().map(t => t.kind + '|' + t.label + '|' + t.readyState + '|enabled=' + t.enabled + '|muted=' + t.muted);
    window.__preseedTestStream = s;
    return 'GUM_OK ' + JSON.stringify(tr);
  } catch (e) { return 'GUM_FAIL ' + e.name + ': ' + e.message; }
})()`);
console.log('[' + stamp() + '] getUserMedia:', gum);
await wait(1500);
console.log('[' + stamp() + '] stop test stream:', await ev(`(() => { if (window.__preseedTestStream) { window.__preseedTestStream.getTracks().forEach(t=>t.stop()); return 'stopped'; } return 'none'; })()`));
console.log('[' + stamp() + '] DONE preseed+verify');
process.exit(0);

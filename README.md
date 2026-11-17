# Video Messaging for Muse

Give a personal AI assistant a seat in real video calls.

Video Messaging for Muse is a working bridge that lets an AI assistant join and place voice and video calls as herself, with her own live voice and an avatar video feed, on the platforms people actually use: **Google Meet**, **Instagram**, and **Facebook Messenger**.

It was built and verified live in November 2026: the assistant held real two-way video calls with her human on Messenger and Instagram, and joined Google Meet with verified two-way audio and video.

## Why this exists

Voice assistants usually live in their own app. The people in your life are on Meet, Instagram, and Messenger. This project connects the two worlds: the assistant's voice mode runs in one browser, the call runs in another, and a virtual audio/video graph cross-wires them so each side hears and sees the other, with no echo and no feedback loop.

## How it works

Two browsers on one Linux host, joined by virtual devices:

- **Voice browser**: a dedicated Chrome running the assistant's voice surface, audio pinned to the bridge graph.
- **Call browser**: a Chrome profile signed in as the assistant on Meet, Instagram, and Messenger.
- **Audio**: a PipeWire/PulseAudio mix-minus graph. Four virtual devices (`vb_voice`, `vb_call`, `vb_voice_mic`, `vb_call_mic`) route each browser's output to the other's microphone, so neither side hears itself.
- **Video**: a `v4l2loopback` virtual camera (`VB_Camera`) fed by an ffmpeg loop of the assistant's avatar animation.

Call control is plain Chrome DevTools Protocol from Node scripts: no patched browsers, no injected WebRTC hooks.

```
                 ┌──────────────────────── host ─────────────────────────┐
                 │                                                       │
  voice surface  │   voice browser ──► vb_voice ──► vb_voice_mic ──► call browser ──► Meet / IG / Messenger
  (assistant)    │        ▲                                               │
                 │        └────── vb_call_mic ◄── vb_call ◄──────────────┘
                 │                                                       │
  avatar loop ───┼──► ffmpeg ──► /dev/video0 (VB_Camera) ──► call browser camera
                 └───────────────────────────────────────────────────────┘
```

## Platform status (verified live, November 2026)

| Platform | Result | Notes |
|---|---|---|
| Facebook Messenger | Two-way video call passed | Her own Facebook profile as identity, Messenger as the call surface |
| Instagram | Two-way video call passed | Needed the permission pre-seed below; now the most reliable leg |
| Google Meet | Joined with two-way audio and video verified | Meet has in-page device pickers, so no default-device swap is needed |

## The one trick that makes it work

**Secure the browser's media permission before dialing.** Instagram and Messenger calls die on a permission interstitial if the browser has not already granted camera and microphone to the site. `Browser.grantPermissions` over CDP does not persist for the call popups these sites open. What works is a `Browser.setPermission` pre-seed for the origin, verified with a real `getUserMedia` call before anyone dials. See [drivers/preseed-permissions.mjs](drivers/preseed-permissions.mjs) and [docs/lessons-learned.md](docs/lessons-learned.md).

## Repository layout

- `scripts/`: endpoint bring-up (audio graph, camera feeder, voice browser, all-in-one starter)
- `drivers/`: CDP call drivers (permission pre-seed, voice-mode starter, Meet join and device selection, Instagram call, Messenger call)
- `docs/architecture.md`: the design in depth
- `docs/setup.md`: step-by-step setup
- `docs/lessons-learned.md`: the failure modes, and the verification standard a call has to meet before it counts as working
- `systemd/`: optional user unit that brings the endpoint up at login

## Quick start

1. Clone this repo to `~/voicebridge` on a Linux host with PipeWire (or PulseAudio), Chrome, ffmpeg, and `v4l2loopback`.
2. Put an avatar animation loop at `~/voicebridge/avatar-feed.mp4`.
3. Sign the call browser's profile into the assistant's accounts; sign the voice browser into the assistant's voice surface.
4. Run `scripts/start-endpoint.sh`.
5. Pre-seed permissions for your call origin: `node drivers/preseed-permissions.mjs https://www.instagram.com`
6. Start the voice call fresh (`node drivers/voice-mode.mjs`), verify outbound capture in `pactl`, then dial with the platform driver.

Full detail in [docs/setup.md](docs/setup.md).

## Honest limits

- Calls are placed and joined only when a human asks for them. This is a presence bridge, not an autodialer.
- The assistant always joins as herself, under her own accounts, never impersonating her human.
- The voice surface idles out: start the voice call immediately before dialing, every time.
- Session sign-ins are browser-profile state. Nothing in this repo handles credentials, and no credentials are stored in it.

## License

MIT. See [LICENSE](LICENSE).

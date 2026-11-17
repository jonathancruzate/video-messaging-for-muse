# Architecture

## The endpoint

Everything runs on one ordinary Linux host (a small VPS in the reference build). The host needs three things: a browser that can stay signed in, a virtual audio graph, and a virtual camera. No special hardware, no patched browser, no native app.

Placement matters more than it looks. The host must be able to reach the assistant's voice surface and load a virtual camera kernel module. In the reference build, two candidate hosts failed for exactly those reasons (one could not reach the voice surface through its egress proxy and could not load `v4l2loopback` in its container kernel), and the build settled on the host that satisfied both.

## Two browsers, two jobs

**Voice browser.** A dedicated Chrome profile whose only job is the assistant's voice-mode session. It is launched with its audio pinned:

- `PULSE_SINK=vb_voice` (what the assistant says goes to the bridge)
- `PULSE_SOURCE=vb_call_mic` (what the assistant hears is the call side)

**Call browser.** A Chrome profile signed in as the assistant on the call platforms (her own Google account for Meet, her own Instagram, her own Facebook profile for Messenger). All call driving happens here over CDP.

The split is the whole design. The voice session never touches the call page, and the call page never touches the voice session. Each can be restarted without disturbing the other, and the call side can be swapped per platform without reworking the voice side.

## The audio graph (mix-minus)

Four virtual devices, created by `scripts/start-graph.sh` with plain `pactl` module loads, so the same script works on PulseAudio and on PipeWire's pulse compatibility layer:

| Device | Kind | Carries |
|---|---|---|
| `vb_voice` | null sink | assistant's voice output |
| `vb_voice_mic` | remap of `vb_voice.monitor` | assistant's voice, presented as a microphone to the call browser |
| `vb_call` | null sink | call side's audio output |
| `vb_call_mic` | remap of `vb_call.monitor` | call audio, presented as a microphone to the voice browser |

Because each microphone is a remap of the *other* side's sink monitor, nobody hears their own voice back. That is the mix-minus property, and it is what makes the bridge usable for real conversation instead of an echo chamber.

### Device selection per platform

- **Google Meet** exposes microphone, speaker, and camera pickers in its settings. Set them to `VB_VoiceMic`, `VB_CallOut`, and `VB_Camera` in the call itself (`drivers/meet-set-devices.mjs`). No system defaults change.
- **Instagram and Messenger** offer no picker. For those calls, the session's default sink and source are swapped to `vb_call` / `vb_voice_mic` for the duration of the call, and restored afterwards. Whatever the host's resting defaults are (in the reference build, an unrelated telephony pair), they are read before the call and put back after, with a read-back check.

## The virtual camera

`v4l2loopback` provides `/dev/video0`, labeled `VB_Camera`. An ffmpeg process loops a short avatar animation into it (`scripts/start-feeder.sh`). Chrome enumerates `VB_Camera` only while the feeder is running, which is also the cheapest health check: if the camera is missing from a call's device list, check the feeder first.

## Call control

Drivers are small Node scripts speaking CDP over a WebSocket: find the right browser context and tab, attach, evaluate DOM expressions, dispatch real mouse events at real element coordinates, poll call state, screenshot for evidence. Two rules keep them honest:

1. **Never wrap or hook `RTCPeerConnection`** while testing. Instrumentation changes the behavior you are trying to measure.
2. **Real clicks at real coordinates.** Synthetic `.click()` calls miss the controls that matter (Instagram's video-call button is an SVG; the driver clicks the SVG's own bounding rect).

## Identity

The assistant calls under her own accounts and her own name on every platform. On Meta platforms that means her own profile on the same Meta account, friend and follower relationships established openly, and a first message that says who she is. The bridge gives her presence; it does not give her anyone else's identity.

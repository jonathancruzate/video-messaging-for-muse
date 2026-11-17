# Setup

## Prerequisites

- A Linux host that stays on. The reference build uses a small VPS.
- PipeWire with `pipewire-pulse` (or PulseAudio). The graph scripts use `pactl` either way.
- Google Chrome (the drivers talk CDP; Chromium works if the flags match).
- `ffmpeg`, `Xvfb`, Node 18 or newer.
- `v4l2loopback` kernel module available to load (`sudo modprobe v4l2loopback`).
- Two sets of accounts for the assistant: a voice-surface account, and her own accounts on the call platforms you want (Google for Meet, Instagram, Facebook for Messenger).

## 1. Lay out the install

```bash
git clone https://github.com/jonathancruzate/video-messaging-for-muse.git ~/voicebridge
mkdir -p ~/voicebridge/profiles
```

The scripts assume this layout (`VB_HOME` overrides it): scripts in `~/voicebridge/scripts`, the voice profile in `~/voicebridge/profiles/voice`, the avatar loop at `~/voicebridge/avatar-feed.mp4`.

Prepare the avatar loop: a short, seamless animation of the assistant, portrait orientation works best for call tiles.

```bash
cp your-avatar-loop.mp4 ~/voicebridge/avatar-feed.mp4
```

## 2. Sign in (human step)

Drivers never handle credentials. Sign in by hand, once, in the real browser windows:

- **Call profile**: open Chrome with the call profile and sign in to the assistant's Google, Instagram, and Facebook accounts. Establish the relationships the calls need (for Messenger, the other person must accept the assistant's friend request before call buttons unlock; for Instagram, follow each other).
- **Voice profile**: the voice browser (step 3 launches it) must hold a signed-in session for the assistant's voice surface. If your voice surface supports session transfer, a cookie transplant from a signed-in browser works; otherwise sign in inside the voice browser window directly.

## 3. Bring the endpoint up

```bash
~/voicebridge/scripts/start-endpoint.sh
```

This creates the audio graph, loads `VB_Camera`, starts the avatar feeder, and launches the voice browser on CDP port 9452 under Xvfb. It is idempotent; run it any time something looks down.

Check the graph:

```bash
pactl list sinks short | grep vb_
pactl list sources short | grep vb_
```

## 4. Expose the call browser's CDP

The call profile needs a Chrome running with `--remote-debugging-port=9230` (or set `VB_CDP_HTTP` to wherever it lives; the reference build reaches it through an SSH tunnel to the host, which is why the drivers take a base URL instead of assuming localhost).

## 5. Pre-seed media permissions

For each origin you will call from:

```bash
node drivers/preseed-permissions.mjs https://www.instagram.com
node drivers/preseed-permissions.mjs https://www.messenger.com
```

Meet does not need this; its in-call grant persists and its device pickers do the rest.

## 6. Make a call

Order matters:

```bash
# 1. Start the voice call fresh, and confirm it is alive in pactl
node drivers/voice-mode.mjs
pactl list sink-inputs | grep -A2 vb_voice

# 2. Dial immediately
IG_THREAD_URL=https://www.instagram.com/direct/t/<thread-id>/ node drivers/instagram-call.mjs
MSGR_THREAD_URL=https://www.messenger.com/e2ee/t/<thread-id>/ node drivers/messenger-call.mjs
```

For Meet, open or create the meeting in the call browser, set devices with `drivers/meet-set-devices.mjs` (VB_VoiceMic, VB_CallOut, VB_Camera), verify them on the pre-join screen, then join with `drivers/meet-join.mjs`.

For Instagram and Messenger calls, remember the default-device swap from [architecture.md](architecture.md): point the session defaults at `vb_call` / `vb_voice_mic` before dialing and restore them after.

## 7. Optional: start at login

```bash
cp systemd/voicebridge-endpoint.service ~/.config/systemd/user/
systemctl --user enable --now voicebridge-endpoint.service
```

The unit runs the same idempotent starter, so a reboot returns the endpoint to ready without touching anything by hand.

## Troubleshooting

| Symptom | First check |
|---|---|
| Camera missing from the call's device list | Feeder running? `pgrep -f ffmpeg`, `/dev/video0` present? Re-run `start-endpoint.sh` |
| Other side hears nothing | Voice call actually live? It idles out; restart `voice-mode.mjs` and redial. Then check outbound capture in `pactl list source-outputs` |
| Permission interstitial on Instagram or Messenger | Re-run the pre-seed for that origin and verify `getUserMedia` succeeds before dialing |
| Echo or feedback | A browser is pinned to the wrong device. Voice browser must be `vb_voice` / `vb_call_mic`; call side the mirror image |
| Everything worked yesterday | Host rebooted and the systemd unit is not installed, or a browser updated and signed a profile out. Re-run the starter, then check sign-ins |

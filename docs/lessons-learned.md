# Lessons learned

Every one of these cost at least one failed call. They are the difference between a demo and a bridge you can rely on.

## 1. Grant the permission before dialing (the Messenger play)

Browser call popups do not inherit a media grant given through CDP `Browser.grantPermissions`; the grant looks successful and the call still dies on a permission interstitial. The play that works, for every call origin:

1. Pre-seed the origin with CDP `Browser.setPermission` for `camera` and `microphone`, set to granted, in the call profile's browser context (`drivers/preseed-permissions.mjs`).
2. Verify in a tab on that origin: `permissions.query` says granted **and** a real `getUserMedia({audio, video})` returns live tracks, the video labeled with the virtual camera.
3. Only then dial.

Fallback when CDP pre-seeding is unavailable: answer the browser's real permission prompt once in the actual browser window. The grant persists for the profile. Either way, never fight the permission from inside the call page; that is how calls get burned.

## 2. A self-preview proves nothing

The most seductive failure mode: the call UI shows the assistant's avatar in her own preview tile, everything looks alive, and the other side sees nothing. Local preview only proves the camera feeds the page. Outbound media is a separate claim, and it needs separate evidence.

## 3. The verification standard

A call counts as working only when all three hold:

1. **Outbound capture exists.** While the call is live, the audio server shows a capture stream from the call browser on the bridge microphone (`pactl list source-outputs`). Grep wide: a narrow pattern misses the stream and cries dead on a healthy call.
2. **In-call UI evidence.** The remote participant's video is playing and the assistant's self-view is present as an inset, from a screenshot or DOM read taken mid-call.
3. **Callee confirmation.** For a test call, the human on the other side says they saw and heard the assistant. One platform's pass rests partly on this because the call ended from the far side before a mid-call capture snapshot landed, and the record says so.

Anything less is a hypothesis, not a result.

## 4. The voice call dies when idle

The assistant's voice-mode session drops if it sits unused. Start it fresh immediately before dialing, confirm the voice browser's audio is moving in `pactl`, and dial right away. A voice session started "to be ready" ten minutes early is a dead session.

A related flakiness: the voice surface sometimes reports that the voice connected but the audio connection failed. The fix is a full page reload and a fresh Call click (`drivers/voice-mode.mjs` does exactly this). Budget a couple of attempts.

## 5. Platform quirks worth knowing

- **Instagram**: clicking "Video call" opens a pre-call lobby. Nothing rings until "Start call" is clicked. A "Loading..." string lingering in the DOM is present on healthy calls too; it is not a failure signal. The failure signal is the "allow microphone access" hint staying up.
- **Messenger**: call buttons on a profile can stay locked until the relationship is mutual (in the reference build, until the human accepted the assistant's friend request). End-to-end encrypted threads may prompt about a sync PIN: never create or change a PIN from a driver; dismiss and report.
- **Meet**: the friendliest surface. In-page device pickers mean no default-device swapping, and the pre-join screen shows the actual selected devices, so verify them there before joining.

## 6. Restore the resting state

Calls borrow the host's audio defaults. Put them back afterwards and read them back. A bridge that leaves the host's defaults pointing at virtual devices breaks whatever else the host does with audio, quietly, later, in a way that is miserable to diagnose.

## 7. Keep the evidence

Each platform verdict in this project rests on a written findings record: what was tried, what the audio server showed, what the UI showed, what the callee reported, timestamped. When a later attempt contradicts an earlier one, the record is what tells you which claim to retire. Write yours as you go.

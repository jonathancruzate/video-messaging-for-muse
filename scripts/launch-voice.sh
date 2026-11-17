#!/bin/bash
# Video Messaging for Muse — voice browser launcher.
# Headful Chrome under Xvfb :98, running the assistant's voice surface,
# audio pinned to the vb_* graph:
#   output -> vb_voice sink (the call side hears this via vb_voice_mic)
#   mic    <- vb_call_mic source (the assistant hears the call side)
set -u
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DISPLAY=:98
export PULSE_SINK=vb_voice
export PULSE_SOURCE=vb_call_mic
VB="${VB_HOME:-$HOME/voicebridge}"
UDD="$VB/profiles/voice"
PORT="${VB_VOICE_CDP:-9452}"
URL="${VB_VOICE_URL:-https://muse.ai/}"
mkdir -p "$UDD"
pgrep -f "Xvfb :98" >/dev/null || { nohup Xvfb :98 -screen 0 1280x800x24 >>"$VB/xvfb98.log" 2>&1 & sleep 1; }
if curl -s -m 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "voice chrome already running on CDP $PORT"
  exit 0
fi
if ! pgrep -f "user-data-dir=$UDD" >/dev/null; then
  rm -f "$UDD/SingletonLock" "$UDD/SingletonCookie" "$UDD/SingletonSocket"
fi
nohup google-chrome --user-data-dir="$UDD" \
  --remote-debugging-port="$PORT" \
  --no-first-run --no-default-browser-check \
  --use-fake-ui-for-media-stream \
  --autoplay-policy=no-user-gesture-required \
  --window-size=1280,760 \
  "$URL" >>"$VB/voice-chrome.log" 2>&1 &
echo "voice chrome launched"

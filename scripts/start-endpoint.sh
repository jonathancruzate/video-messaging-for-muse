#!/bin/bash
# Video Messaging for Muse — idempotent endpoint starter.
# Safe to run repeatedly: every leg checks before acting.
# Layout: clone this repo to $VB_HOME (default ~/voicebridge); the scripts
# live in $VB_HOME/scripts, state and media in $VB_HOME itself.
set -u
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
VB="${VB_HOME:-$HOME/voicebridge}"

# 1. vb_* audio graph (start-graph.sh is itself idempotent).
bash "$VB/scripts/start-graph.sh" start >/dev/null && echo "audio graph: ok"

# 2. Virtual camera device (v4l2loopback, label VB_Camera).
if [ ! -e /dev/video0 ]; then
  sudo modprobe v4l2loopback devices=1 video_nr=0 card_label=VB_Camera exclusive_caps=1
  sudo chmod 666 /dev/video0
  echo "v4l2loopback: loaded"
else
  echo "v4l2loopback: already present (/dev/video0)"
fi

# 3. Camera feeder (avatar loop -> /dev/video0).
bash "$VB/scripts/start-feeder.sh"

# 4. Voice browser, pinned vb_voice / vb_call_mic.
bash "$VB/scripts/launch-voice.sh"

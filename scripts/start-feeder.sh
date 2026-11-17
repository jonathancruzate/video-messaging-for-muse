#!/bin/bash
# Video Messaging for Muse — virtual camera feeder.
# Loops the assistant's avatar video into /dev/video0 (VB_Camera) if the
# feeder is not already running. Chrome only lists VB_Camera while the
# feeder is running.
set -u
VB="${VB_HOME:-$HOME/voicebridge}"
FEED="${VB_FEED:-$VB/avatar-feed.mp4}"
if pgrep -f "ffmpeg.*$(basename "$FEED")" >/dev/null; then
  echo "feeder: already running"
  exit 0
fi
nohup ffmpeg -re -stream_loop -1 -i "$FEED" \
  -f v4l2 -pix_fmt yuv420p /dev/video0 >>"$VB/feeder.log" 2>&1 &
echo "feeder: started"

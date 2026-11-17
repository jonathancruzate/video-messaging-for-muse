#!/bin/bash
# Video Messaging for Muse — virtual audio graph (PulseAudio / PipeWire-pulse).
#
# Topology (mix-minus, no loops):
#   Voice browser (the assistant's voice mode) OUTPUT -> sink vb_voice
#   Call browser (Meet / Instagram / Messenger) MIC   <- source vb_voice_mic
#        (vb_voice_mic is a remap of vb_voice.monitor: the call hears the assistant)
#   Call browser OUTPUT                               -> sink vb_call
#   Voice browser MICROPHONE                          <- source vb_call_mic
#        (vb_call_mic is a remap of vb_call.monitor: the assistant hears the call)
#
# Each browser must be pinned to its own sink/source (pavucontrol, or
# PULSE_SINK / PULSE_SOURCE env at launch). For call surfaces with no
# in-page device picker (Instagram, Messenger), the session default
# sink/source are swapped to vb_call / vb_voice_mic for the call's duration
# and restored afterwards. Nothing here permanently changes the defaults.
#
# Usage: start-graph.sh [start|stop|status]
set -u
ACT="${1:-start}"

ensure_server() {
  # No systemd / no session bus on this VM: give pulse a private runtime dir.
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/pulse-runtime}"
  mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
  if ! pactl info >/dev/null 2>&1; then
    pulseaudio --start --exit-idle-time=-1 2>/dev/null || \
      pulseaudio -D --exit-idle-time=-1
    for i in $(seq 1 20); do pactl info >/dev/null 2>&1 && break; sleep 0.5; done
  fi
  pactl info >/dev/null 2>&1
}

load_mod() { # name, module, args...
  local name="$1" mod="$2"; shift 2
  if pactl list short modules | grep -q "$name\|$mod.*$1" 2>/dev/null && \
     pactl list sinks short | grep -q "$name"; then :; fi
  pactl load-module "$mod" "$@" >/dev/null
}

case "$ACT" in
  start)
    ensure_server || { echo "FAIL: pulseaudio server not reachable"; exit 1; }
    # Sinks (skip if already present)
    pactl list sinks short | grep -q "vb_voice" || \
      pactl load-module module-null-sink sink_name=vb_voice \
        sink_properties=device.description=VB_VoiceOut >/dev/null
    pactl list sinks short | grep -q "vb_call" || \
      pactl load-module module-null-sink sink_name=vb_call \
        sink_properties=device.description=VB_CallOut >/dev/null
    # Virtual sources = remaps of each sink's monitor
    pactl list sources short | grep -q "vb_voice_mic" || \
      pactl load-module module-remap-source master=vb_voice.monitor \
        source_name=vb_voice_mic \
        source_properties=device.description=VB_VoiceMic >/dev/null
    pactl list sources short | grep -q "vb_call_mic" || \
      pactl load-module module-remap-source master=vb_call.monitor \
        source_name=vb_call_mic \
        source_properties=device.description=VB_CallMic >/dev/null
    echo "Bridge audio up:"
    pactl list sinks short | grep -E "vb_" || true
    pactl list sources short | grep -E "vb_" || true
    ;;
  stop)
    # Unload by module name pattern (null sinks + remaps created above)
    for m in $(pactl list short modules | grep -E "module-remap-source|module-null-sink" | cut -f1 | sort -r); do
      pactl unload-module "$m" >/dev/null 2>&1 || true
    done
    echo "Bridge audio modules unloaded."
    ;;
  status)
    ensure_server || { echo "pulseaudio not running"; exit 1; }
    pactl list sinks short; echo; pactl list sources short
    ;;
esac

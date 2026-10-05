#!/usr/bin/env bash
# Save one frame from the pier camera into tests/fixtures/series/ for checking the gauge reader.
# Usage: scripts/capture-fixture.sh
set -euo pipefail
mkdir -p tests/fixtures/series
ffmpeg -hide_banner -loglevel error -y -rw_timeout 30000000 -live_start_index -1 \
  -i "https://stream.firsttech.co.th/live/nakornnont.stream/playlist.m3u8" \
  -frames:v 1 "tests/fixtures/series/$(date +%Y%m%d-%H%M).png"

#!/usr/bin/env bash
# Smoke test of the Android app on a running emulator (the Android workflow
# runs it inside reactivecircus/android-emulator-runner):
#
#   scripts/android-emulator-smoke.sh <apk> <output folder>
#
# 1. Installs the APK and starts Hippo.
# 2. Waits for the first screen of the web app (setup's opening screen, which
#    has "Skip setup") in the UI tree that Android's uiautomator dumps. Fails if
#    it never appears.
# 3. The logo intro finishes: within about five seconds of the first screen the
#    "Hippo" logo is small and at the top (never left large). Required.
# 4. The setup slide control works with real touch input in the real WebView:
#    `input swipe` along it moves to the next step (the drag); Back, then
#    `input tap` on it moves on again (the tap). Required.
# 5. Shares a product link into Hippo the way a browser does (ACTION_SEND,
#    text/plain) and checks that Add a wish opens. Reported, not required.
#
# Animations are switched back on for the app (the emulator runner turns them
# off, which makes the WebView report reduced motion), so the intro really plays.
# Every check polls with a deadline and prints the UI dump when it fails.
# Leaves screenshots, UI dumps and the app's log lines in the output folder.
set -euo pipefail

APK="${1:?apk path}"
OUT="${2:-emulator-smoke}"
PKG="io.github.thekozugroup.hippo"
mkdir -p "$OUT"

adb wait-for-device
adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done'
adb install -r -g "$APK"
# The runner sets these to 0 (disable-animations); with 0 Android WebView reports reduced motion and
# the logo intro would not run at all. Turn them on so the check below sees the real intro.
for k in window_animation_scale transition_animation_scale animator_duration_scale; do adb shell settings put global "$k" 1 || true; done
adb logcat -c || true
adb shell am start -W -n "$PKG/.MainActivity"

# Looks for a pattern in a fresh UI dump, for up to $2 seconds; keeps the last dump as $3.
wait_for_text() {
  local pattern="$1" seconds="$2" file="$3"
  local end=$((SECONDS + seconds))
  while [ "$SECONDS" -lt "$end" ]; do
    if adb shell uiautomator dump /sdcard/hippo-window.xml >/dev/null 2>&1 && adb pull /sdcard/hippo-window.xml "$file" >/dev/null 2>&1; then
      if grep -q -E "$pattern" "$file"; then return 0; fi
    fi
    sleep 3
  done
  return 1
}

status=0
if wait_for_text 'Skip setup|Make a wishlist' 180 "$OUT/first-screen.xml"; then
  echo "PASS: the web app rendered its first screen inside the app."
  grep -o -E 'text="(Skip setup|Make a wishlist[^"]*)"' "$OUT/first-screen.xml" | head -3 || true
else
  echo "FAIL: the first screen did not appear within 3 minutes."
  status=1
fi
adb exec-out screencap -p > "$OUT/first-screen.png" || true

# Bounds of the first node whose text or description matches, as "x1 y1 x2 y2", from a dump file.
bounds_of() {
  python3 - "$1" "$2" <<'PY'
import re, sys
import xml.etree.ElementTree as ET
pattern = re.compile(sys.argv[2])
try:
    root = ET.parse(sys.argv[1]).getroot()
except Exception:
    sys.exit(1)
for n in root.iter('node'):
    label = (n.get('text') or '') + '|' + (n.get('content-desc') or '')
    if pattern.search(label):
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', n.get('bounds', ''))
        if m:
            print(*m.groups())
            sys.exit(0)
sys.exit(1)
PY
}

dump() {
  adb shell uiautomator dump /sdcard/hippo-window.xml >/dev/null 2>&1 && adb pull /sdcard/hippo-window.xml "$1" >/dev/null 2>&1
}

fail_with_dump() {
  echo "FAIL: $1"
  echo "---- UI dump ($2) ----"
  cat "$2" 2>/dev/null | sed 's/<node /\n<node /g' | grep -E 'text="[^"]+"|content-desc="[^"]+"' | head -60 || true
  echo "----------------------"
}

read -r SCREEN_W SCREEN_H < <(adb shell wm size | tr -d '\r' | sed -n 's/.*: \([0-9]*\)x\([0-9]*\).*/\1 \2/p' | tail -1)
echo "Screen: ${SCREEN_W}x${SCREEN_H}"

intro="skipped"
drag="skipped"
tap="skipped"
if [ "$status" -eq 0 ]; then
  # 3. The logo lands: small and near the top within ~5 s (polled to 8 s for a slow emulator).
  intro="FAILED"
  end=$((SECONDS + 8))
  while [ "$SECONDS" -lt "$end" ]; do
    if dump "$OUT/logo.xml" && b="$(bounds_of "$OUT/logo.xml" '^Hippo\|')"; then
      read -r x1 y1 x2 y2 <<<"$b"
      if [ $((x2 - x1)) -lt $((SCREEN_W * 2 / 5)) ] && [ "$y1" -lt $((SCREEN_H / 6)) ]; then intro="passed"; break; fi
    fi
    sleep 1
  done
  adb exec-out screencap -p > "$OUT/logo.png" || true
  if [ "$intro" = "passed" ]; then echo "PASS: the logo is small and at the top ($b)."; else fail_with_dump "the logo was not at rest within 8 seconds (last bounds: ${b:-none})" "$OUT/logo.xml"; status=1; fi

  # 4a. Drag: swipe the knob along the slide control to its end.
  drag="FAILED"
  if dump "$OUT/step1.xml" && c="$(bounds_of "$OUT/step1.xml" 'Get started')"; then
    read -r x1 y1 x2 y2 <<<"$c"
    h=$((y2 - y1)); y=$(((y1 + y2) / 2))
    adb exec-out screencap -p > "$OUT/before-drag.png" || true
    adb shell input swipe $((x1 + h / 2)) "$y" $((x2 - h / 2)) "$y" 700
    if wait_for_text 'call you' 15 "$OUT/after-drag.xml"; then drag="passed"; echo "PASS: dragging the slide control moved to the next step."; else fail_with_dump "dragging the slide control did not move to the next step" "$OUT/after-drag.xml"; status=1; fi
    adb exec-out screencap -p > "$OUT/after-drag.png" || true
  else
    fail_with_dump "no Get started control in the UI tree" "$OUT/step1.xml"; status=1
  fi

  # 4b. Back to step 1, then tap the control.
  tap="FAILED"
  adb shell input keyevent KEYCODE_BACK
  if wait_for_text 'Get started' 15 "$OUT/back.xml" && c="$(bounds_of "$OUT/back.xml" 'Get started')"; then
    read -r x1 y1 x2 y2 <<<"$c"
    adb shell input tap $(((x1 + x2) / 2)) $(((y1 + y2) / 2))
    if wait_for_text 'call you' 15 "$OUT/after-tap.xml"; then tap="passed"; echo "PASS: tapping the slide control moved to the next step."; else fail_with_dump "tapping the slide control did not move to the next step" "$OUT/after-tap.xml"; status=1; fi
    adb exec-out screencap -p > "$OUT/after-tap.png" || true
  else
    fail_with_dump "Back did not return to the first step" "$OUT/back.xml"; status=1
  fi
fi

share="skipped"
if [ "$status" -eq 0 ]; then
  adb shell am start -W -a android.intent.action.SEND -t text/plain \
    --es android.intent.extra.SUBJECT "Red wool scarf" \
    --es android.intent.extra.TEXT "https://example.com/products/red-wool-scarf?utm_source=share" \
    -n "$PKG/.MainActivity" || true
  if wait_for_text 'Add a wish' 60 "$OUT/after-share.xml"; then
    share="passed"
    echo "PASS: sharing a link into Hippo opened Add a wish."
  else
    share="did not open Add a wish"
    echo "NOTE: sharing a link into Hippo did not open Add a wish (reported, not required)."
  fi
  adb exec-out screencap -p > "$OUT/after-share.png" || true
fi

# The app's own log lines only (Capacitor logging is off; this shows crashes and WebView errors).
pid="$(adb shell pidof "$PKG" | tr -d '\r' || true)"
if [ -n "$pid" ]; then adb logcat -d --pid="$pid" > "$OUT/app-log.txt" || true; fi
adb logcat -d -b crash > "$OUT/crash-log.txt" || true

{
  echo "first screen: $([ -f "$OUT/first-screen.xml" ] && grep -q -E 'Skip setup|Make a wishlist' "$OUT/first-screen.xml" && echo passed || echo FAILED)"
  echo "logo intro finished (small, at the top, within 8 s, animations on): $intro"
  echo "slide control, drag with input swipe: $drag"
  echo "slide control, tap with input tap: $tap"
  echo "share into Hippo: $share"
} > "$OUT/result.txt"
exit "$status"

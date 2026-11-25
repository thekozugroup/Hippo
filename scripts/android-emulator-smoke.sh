#!/usr/bin/env bash
# Checks of the Android app on a running emulator (the Android workflow runs it
# inside reactivecircus/android-emulator-runner):
#
#   scripts/android-emulator-smoke.sh <apk> <output folder>
#
# Measurements inside the WebView come from scripts/android-webview-checks.mjs
# (Playwright attached to the app's WebView over adb; needs `npm ci` first).
#
# 1. Installs the APK, turns animations on (the runner turns them off, which
#    makes the WebView report reduced motion) and starts Hippo.
# 2. Logo intro (WebView): the glyph is sampled from launch and must end small in
#    its header; whether a large phase was seen is reported.
# 3. Edge to edge on setup (WebView and screenshot): the WebView covers the whole
#    window, the insets the layout uses match the system bars, the page is at
#    the very top-left, and the pixels in both bar strips are the page's own.
# 4. The first screen in Android's UI tree (uiautomator).
# 5. The setup slide control with real touch input: `input swipe` along it moves
#    to the next step (the drag); Back, then `input tap` moves on again (the tap).
# 6. Keyboard (WebView): with the keyboard open the WebView ends at its top and
#    the field and the step's actions are above it. Reported when the emulator
#    shows no keyboard.
# 7. Home (WebView and screenshot): edge to edge again; then with the light sheet
#    scrolled under the status bar, the fade layer and dark status bar icons.
# 8. Shares product links into Hippo the way a browser does (ACTION_SEND,
#    text/plain): with the app in the foreground, again straight after, from the
#    background, not running (cold start), and as the first launch after the
#    app's data is cleared. Each must end on Add a wish with the link field
#    holding the shared address without tracking parameters, read inside the
#    WebView, and the on-device page lookup started or answered without
#    blocking the form. Also: after Android recreates the app with the share
#    that started it, Add a wish does not open again.
# 9. "Open in the Hippo app": hippo://open/lists (as a browser's intent link
#    sends it, VIEW and BROWSABLE) ends on Lists, and a route that is not
#    allowed (hippo://open/item/new) ends on Home, both while the app is running
#    and from a cold start (read inside the WebView).
#
# Every check polls with a deadline and writes a PASS, FAIL or INFO line with
# its numbers to <output>/checks.txt. Leaves screenshots at each point, UI dumps,
# window manager dumps and the app's log lines in the output folder.
set -euo pipefail

APK="${1:?apk path}"
OUT="${2:-emulator-smoke}"
PKG="io.github.thekozugroup.hippo"
mkdir -p "$OUT"

adb wait-for-device
adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done'
adb install -r -g "$APK"
# The runner sets these to 0 (disable-animations); with 0 Android WebView reports reduced motion and
# the logo intro would not run at all. Turn them on before launch so the check sees the real intro
# (the WebView check reports what matchMedia('(prefers-reduced-motion: reduce)') says).
for k in window_animation_scale transition_animation_scale animator_duration_scale; do adb shell settings put global "$k" 1 || true; done
# Show the on-screen keyboard even though the emulator has a hardware keyboard.
adb shell settings put secure show_ime_with_hard_keyboard 1 || true
# A slow emulator sometimes shows "Pixel Launcher isn't responding" over the app; such dialogs are
# about other apps, not Hippo, so they are hidden (and dismissed with Wait if one shows anyway).
adb shell settings put global hide_error_dialogs 1 || true
adb logcat -c || true
rm -f "$OUT/checks.txt"

status=0
webview() { timeout 240 node scripts/android-webview-checks.mjs "$1" "$OUT"; }

# 2 and 3: starts the app itself, so the logo is sampled from launch.
if webview launch; then launch="passed"; else launch="FAILED"; status=1; fi

# Taps Wait on another app's "isn't responding" dialog in a UI dump, if there is one.
dismiss_not_responding() {
  grep -q "isn't responding" "$1" 2>/dev/null || return 0
  local c
  c="$(python3 - "$1" <<'PY'
import re, sys
import xml.etree.ElementTree as ET
try:
    root = ET.parse(sys.argv[1]).getroot()
except Exception:
    sys.exit(1)
for n in root.iter('node'):
    if (n.get('text') or '') == 'Wait':
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', n.get('bounds', ''))
        if m:
            x1, y1, x2, y2 = map(int, m.groups())
            print((x1 + x2) // 2, (y1 + y2) // 2)
            sys.exit(0)
sys.exit(1)
PY
)" || return 0
  echo "NOTE: another app's \"isn't responding\" dialog was dismissed with Wait."
  # shellcheck disable=SC2086
  adb shell input tap $c || true
}

# Looks for a pattern in a fresh UI dump, for up to $2 seconds; keeps the last dump as $3.
wait_for_text() {
  local pattern="$1" seconds="$2" file="$3"
  local end=$((SECONDS + seconds))
  while [ "$SECONDS" -lt "$end" ]; do
    if adb shell uiautomator dump /sdcard/hippo-window.xml >/dev/null 2>&1 && adb pull /sdcard/hippo-window.xml "$file" >/dev/null 2>&1; then
      if grep -q -E "$pattern" "$file"; then return 0; fi
      dismiss_not_responding "$file"
    fi
    sleep 3
  done
  return 1
}

first="FAILED"
if wait_for_text 'Skip setup|Make a wishlist' 180 "$OUT/first-screen.xml"; then
  first="passed"
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

drag="skipped"
tap="skipped"
if [ "$first" = "passed" ]; then
  # 5a. Drag: swipe the knob along the slide control to its end.
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

  # 5b. Back to step 1, then tap the control.
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

keyboard="skipped"
home="skipped"
if [ "$tap" = "passed" ]; then
  # 6: on the name step the slide control led to.
  if webview keyboard; then keyboard="passed"; else keyboard="FAILED"; status=1; fi
fi
if [ "$drag" != "skipped" ]; then
  # 7: leaves setup.
  if webview home; then home="passed"; else home="FAILED"; status=1; fi
fi

# 8: shares into Hippo. The am command goes to the device's shell as one string: adb joins its
# arguments with spaces and the device shell splits them again, so a quoted subject passed as
# separate arguments would arrive as several words (the share's subject would become a package).
send_share() {
  local subject="$1" text="$2" output
  output="$(adb shell "am start -W -a android.intent.action.SEND -t text/plain --es android.intent.extra.SUBJECT '$subject' --es android.intent.extra.TEXT '$text' -n $PKG/.MainActivity" 2>&1 | tr -d '\r')" || true
  echo "$output"
  if echo "$output" | grep -q -E '^Error|Exception'; then return 1; fi
}

# Runs one share case: sends it, then checks the form inside the WebView. Sets the named result variable.
share_case() {
  local var="$1" label="$2" subject="$3" text="$4" expected="$5" shot="${6:-}"
  local result="FAILED"
  if dump "$OUT/before-share.xml"; then dismiss_not_responding "$OUT/before-share.xml"; fi
  if send_share "$subject" "$text"; then
    if webview_share share "$label" "$expected" "$shot"; then result="passed"; fi
  else
    echo "FAIL $label: the share intent was not delivered" | tee -a "$OUT/checks.txt"
  fi
  if [ "$result" != "passed" ]; then status=1; fi
  printf -v "$var" '%s' "$result"
}
webview_share() { timeout 240 node scripts/android-webview-checks.mjs "$1" "$OUT" "${@:2}"; }

# 9: "Open in the Hippo app". Sends the VIEW intent a browser's intent link sends, then checks the
# route inside the WebView. Sets the named result variable.
open_route() {
  local var="$1" label="$2" uri="$3" expected="$4" heading="$5"
  local result="FAILED" output
  if dump "$OUT/before-route.xml"; then dismiss_not_responding "$OUT/before-route.xml"; fi
  output="$(adb shell "am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d '$uri' $PKG" 2>&1 | tr -d '\r')" || true
  echo "$output"
  if echo "$output" | grep -q -E '^Error|Exception'; then
    echo "FAIL $label: the intent was not delivered" | tee -a "$OUT/checks.txt"
  elif webview_share route "$label" "$expected" "$heading"; then
    result="passed"
  fi
  if [ "$result" != "passed" ]; then status=1; fi
  printf -v "$var" '%s' "$result"
}

share_running="skipped"
share_again="skipped"
share_background="skipped"
share_cold="skipped"
share_redelivery="skipped"
route_running="skipped"
route_denied_running="skipped"
route_cold="skipped"
route_denied_cold="skipped"
share_first="skipped"
if [ "$first" = "passed" ]; then
  # 8a. The app in the foreground (on Home after the checks above).
  share_case share_running "share while running" "Red wool scarf" \
    "https://example.com/products/red-wool-scarf?utm_source=share" "https://example.com/products/red-wool-scarf"
  # 8b. Straight after, a second share: the form must show the second one.
  share_case share_again "second share while running" "Blue kite" \
    "Look at this kite https://example.com/products/blue-kite?gclid=abc&size=2" "https://example.com/products/blue-kite?size=2"
  # 8c. The app in the background.
  adb shell input keyevent KEYCODE_HOME; sleep 2
  share_case share_background "share from the background" "Green mug" \
    "https://example.com/products/green-mug" "https://example.com/products/green-mug"
  # 8d. The app not running (cold start).
  adb shell am force-stop "$PKG"; sleep 1
  share_case share_cold "cold-start share" "Yellow raincoat" \
    "https://example.com/products/yellow-raincoat?utm_campaign=autumn" "https://example.com/products/yellow-raincoat" share-cold-start
  dump "$OUT/after-share.xml" || true
  adb exec-out screencap -p > "$OUT/after-share.png" || true
  # 8e. Android recreates the app with the share that started it (the process was stopped in the
  #     background, then the person returns to Hippo from the launcher): Add a wish must not open again.
  adb shell input keyevent KEYCODE_HOME; sleep 2
  adb shell am kill "$PKG" || true; sleep 2
  if [ -z "$(adb shell pidof "$PKG" | tr -d '\r')" ]; then
    adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
    if webview_share share-none "recreated after a share"; then share_redelivery="passed"; else share_redelivery="FAILED"; status=1; fi
    adb exec-out screencap -p > "$OUT/after-recreate.png" || true
  else
    share_redelivery="not run (the process was not stopped in the background)"
    echo "INFO recreated after a share: am kill did not stop the process; not checked" | tee -a "$OUT/checks.txt"
  fi
  # 9. "Open in the Hippo app", while running (from Lists, so Home is a real move) and from a cold start.
  open_route route_running "open lists while running" "hippo://open/lists" "/lists" "^Lists$"
  open_route route_denied_running "disallowed route while running" "hippo://open/item/new" "/" "wishlist"
  adb shell am force-stop "$PKG"; sleep 1
  open_route route_cold "open lists from a cold start" "hippo://open/lists" "/lists" "^Lists$"
  adb shell am force-stop "$PKG"; sleep 1
  open_route route_denied_cold "disallowed route from a cold start" "hippo://open/item/new" "/" "wishlist"
  # 8f. A first-ever launch that begins with a share (the app's data cleared, as after installing).
  adb shell pm clear "$PKG" >/dev/null || true; sleep 1
  share_case share_first "first-launch share" "Red wool scarf" \
    "https://example.com/products/red-wool-scarf?utm_source=share" "https://example.com/products/red-wool-scarf" share-first-launch
fi

# The app's own log lines only (Capacitor logging is off; this shows crashes and WebView errors).
pid="$(adb shell pidof "$PKG" | tr -d '\r' || true)"
if [ -n "$pid" ]; then adb logcat -d --pid="$pid" > "$OUT/app-log.txt" || true; fi
adb logcat -d -b crash > "$OUT/crash-log.txt" || true

{
  echo "first screen: $first"
  echo "launch, logo intro and edge to edge on setup (WebView): $launch"
  echo "slide control, drag with input swipe: $drag"
  echo "slide control, tap with input tap: $tap"
  echo "keyboard (WebView): $keyboard"
  echo "Home edge to edge, fade layer and status bar icons (WebView): $home"
  echo "share while running: $share_running"
  echo "second share while running: $share_again"
  echo "share from the background: $share_background"
  echo "cold-start share: $share_cold"
  echo "no second form after Android recreates the app: $share_redelivery"
  echo "first-launch share: $share_first"
  echo "open in the app, hippo://open/lists while running: $route_running"
  echo "open in the app, a disallowed route while running ends on Home: $route_denied_running"
  echo "open in the app, hippo://open/lists from a cold start: $route_cold"
  echo "open in the app, a disallowed route from a cold start ends on Home: $route_denied_cold"
} > "$OUT/result.txt"
exit "$status"

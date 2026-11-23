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
# 3. Shares a product link into Hippo the way a browser does (ACTION_SEND,
#    text/plain) and checks that Add a wish opens. Reported, not required.
#
# Leaves a screenshot, the UI dump and the app's log lines in the output folder.
set -euo pipefail

APK="${1:?apk path}"
OUT="${2:-emulator-smoke}"
PKG="io.github.thekozugroup.hippo"
mkdir -p "$OUT"

adb wait-for-device
adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done'
adb install -r -g "$APK"
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
  echo "first screen: $([ "$status" -eq 0 ] && echo passed || echo FAILED)"
  echo "share into Hippo: $share"
} > "$OUT/result.txt"
exit "$status"

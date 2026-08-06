#!/bin/bash
# Baut Focus Co-Pilot und installiert es nach /Applications.
# Aufruf: npm run install-app
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Baue Focus Co-Pilot..."
npx electron-builder --mac --dir

APP_SRC="dist/mac-arm64/Focus Co-Pilot.app"
if [ ! -d "$APP_SRC" ]; then
  APP_SRC="dist/mac/Focus Co-Pilot.app"
fi
if [ ! -d "$APP_SRC" ]; then
  echo "Build-Ausgabe nicht gefunden unter dist/mac-arm64 oder dist/mac." >&2
  exit 1
fi

if pgrep -f "/Applications/Focus Co-Pilot.app/Contents/MacOS/Focus Co-Pilot" > /dev/null 2>&1; then
  echo "Focus Co-Pilot läuft gerade — wird zum Aktualisieren beendet..."
  osascript -e 'tell application "Focus Co-Pilot" to quit' 2>/dev/null || true
  sleep 2
fi

echo "Installiere nach /Applications..."
rm -rf "/Applications/Focus Co-Pilot.app"
cp -R "$APP_SRC" "/Applications/"

echo "Fertig. Focus Co-Pilot liegt jetzt in /Applications und lässt sich über Finder, Spotlight oder Launchpad starten."

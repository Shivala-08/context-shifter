#!/usr/bin/env bash
# Builds Context Transfer.app without a full Xcode project.
# Usage: ./Scripts/build-app.sh
set -euo pipefail

APP_NAME="Context Transfer"
EXECUTABLE="ContextTransfer"
CONFIG="release"

# Optional: pass SIGN_IDENTITY="Developer ID Application: <name>" for a
# distributable build. Default is ad-hoc (fine for running on this machine).
SIGN_IDENTITY="${SIGN_IDENTITY:--}"

cd "$(dirname "$0")/.."

echo "==> swift build (-c $CONFIG)"
swift build -c "$CONFIG"

BIN=".build/$CONFIG/$EXECUTABLE"
APP=".build/app/$APP_NAME.app"

echo "==> Bundling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/$EXECUTABLE"
cp Resources/Info.plist "$APP/Contents/Info.plist"

# Signed so the entitlements apply. Ad-hoc by default; set SIGN_IDENTITY to
# a "Developer ID Application" identity for a build you can share/notarize.
codesign --force --sign "$SIGN_IDENTITY" --entitlements Resources/ContextTransfer.entitlements "$APP"

echo
echo "Built: $APP"
echo "Run:   open \"$APP\""

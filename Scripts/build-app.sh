#!/usr/bin/env bash
# Builds Context Transfer.app without a full Xcode project.
# Usage: ./Scripts/build-app.sh
set -euo pipefail

APP_NAME="Context Transfer"
EXECUTABLE="ContextTransfer"
CONFIG="release"

# Optional: pass SIGN_IDENTITY="Developer ID Application: <name>" for a
# distributable build. Default: auto-use the first trusted codesigning
# identity (e.g. a local ContextTransferDev cert) so rebuilds keep a stable
# code identity and the Accessibility grant survives; ad-hoc only if none.
if [ -z "${SIGN_IDENTITY:-}" ]; then
  SIGN_IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/1)/{print $2; exit}')"
  if [ -n "$SIGN_IDENTITY" ]; then
    echo "==> Using codesigning identity: $SIGN_IDENTITY"
  else
    SIGN_IDENTITY="-"
  fi
fi

cd "$(dirname "$0")/.."

echo "==> swift build (-c $CONFIG)"
swift build -c "$CONFIG"

if [ "$SIGN_IDENTITY" = "-" ]; then # no identity on this machine — warn
  cat <<'HINT'
WARNING: signing ad-hoc. Every rebuild changes the app's code identity, and
macOS TCC binds Accessibility grants to that identity — so after each rebuild
the capture shortcut silently dies until you re-grant permission.
One-time fix (~2 min): create a self-signed code-signing certificate so
rebuilds keep the same identity:
  1. Open "Keychain Access" → menu "Keychain Certificate Assistant" →
     "Create a Certificate…"
  2. Name: ContextTransferDev   Identity Type: Self-Signed Root
     Certificate Type: Code Signing   → Create
  3. Rebuild with: SIGN_IDENTITY="ContextTransferDev" ./Scripts/build-app.sh
Grant Accessibility once after that; later rebuilds keep the grant.
HINT
fi

BIN=".build/$CONFIG/$EXECUTABLE"
APP=".build/app/$APP_NAME.app"

# App icon: generated once via CoreGraphics (Scripts/make-icon.swift), cached
# in .build/icon and refreshed only when missing.
if [ ! -f .build/icon/AppIcon.icns ]; then
  echo "==> Generating app icon"
  mkdir -p .build/icon/AppIcon.iconset
  swift Scripts/make-icon.swift .build/icon/AppIcon_1024.png
  (
    cd .build/icon
    for s in 16 32 128 256 512; do
      sips -z $s $s AppIcon_1024.png --out AppIcon.iconset/icon_${s}x${s}.png >/dev/null
      d=$((s * 2))
      sips -z $d $d AppIcon_1024.png --out AppIcon.iconset/icon_${s}x${s}@2x.png >/dev/null
    done
    iconutil -c icns AppIcon.iconset -o AppIcon.icns
  )
fi

echo "==> Bundling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/$EXECUTABLE"
cp Resources/Info.plist "$APP/Contents/Info.plist"
cp .build/icon/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

# Signed so the entitlements apply. Ad-hoc by default; set SIGN_IDENTITY to
# a "Developer ID Application" identity for a build you can share/notarize.
codesign --force --sign "$SIGN_IDENTITY" --entitlements Resources/ContextTransfer.entitlements "$APP"

echo
echo "Built: $APP"
echo "Run:   open \"$APP\""

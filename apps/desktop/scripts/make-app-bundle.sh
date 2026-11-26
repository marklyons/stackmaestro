#!/usr/bin/env bash
# Produces a real, correctly-named StackMaestro.app on macOS by copying Electron's own
# prebuilt bundle and relabeling it — not via electron-packager, whose postinstall
# dependency (@electron-internal/extract-zip) doesn't resolve cleanly under this repo's
# strict pnpm layout. Our esbuild output is fully self-contained (no runtime node_modules
# needed inside the bundle), so this is just: copy the shell, drop our build in, relabel.
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="StackMaestro"
OUT_DIR="$DESKTOP_DIR/release"
APP="$OUT_DIR/$APP_NAME.app"

ELECTRON_BIN="$(cd "$DESKTOP_DIR" && node -e "console.log(require('electron'))")"
ELECTRON_APP="${ELECTRON_BIN%/Contents/MacOS/Electron}"
if [ ! -d "$ELECTRON_APP" ]; then
  echo "Couldn't locate Electron.app from: $ELECTRON_BIN" >&2
  exit 1
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp -R "$ELECTRON_APP" "$APP"
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/$APP_NAME"
rm -f "$APP/Contents/Resources/electron.icns"
cp "$DESKTOP_DIR/build/icon.icns" "$APP/Contents/Resources/icon.icns"

mkdir -p "$APP/Contents/Resources/app"
cp "$DESKTOP_DIR/package.json" "$APP/Contents/Resources/app/package.json"
cp -R "$DESKTOP_DIR/dist" "$APP/Contents/Resources/app/dist"
cp -R "$DESKTOP_DIR/renderer" "$APP/Contents/Resources/app/renderer"
cp -R "$DESKTOP_DIR/build" "$APP/Contents/Resources/app/build"

PLIST="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName $APP_NAME" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $APP_NAME" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable $APP_NAME" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.stackmaestro.desktop" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile icon.icns" "$PLIST"

# Renaming the executable invalidates Electron's own signature — ad-hoc re-sign so
# Gatekeeper doesn't refuse to launch it as "damaged".
xattr -cr "$APP"
codesign --force --deep --sign - "$APP"

echo "Built: $APP"

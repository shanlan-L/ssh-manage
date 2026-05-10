#!/usr/bin/env bash
set -euo pipefail

APP_NAME="vps-manage"
INSTALL_DIR="${VPS_MANAGE_INSTALL_DIR:-$HOME/.local/bin}"
APP_DIR="${VPS_MANAGE_APP_DIR:-$HOME/.local/share/$APP_NAME}"
TARGET_BIN="$INSTALL_DIR/$APP_NAME"
DEFAULT_REPO="shanlan-L/vps-manage"
DEFAULT_REF="main"
REPO="${VPS_MANAGE_REPO:-$DEFAULT_REPO}"
REF="${VPS_MANAGE_REF:-$DEFAULT_REF}"

if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  SCRIPT_DIR=""
fi

LOCAL_SOURCE_BIN=""
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/bin/vps-manage.js" ]; then
  LOCAL_SOURCE_BIN="$SCRIPT_DIR/bin/vps-manage.js"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required but was not found in PATH." >&2
  echo "Install Node.js 18 or newer, then run this installer again." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Error: Node.js 18 or newer is required. Current version: $(node --version)" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
mkdir -p "$APP_DIR"

if [ -n "$LOCAL_SOURCE_BIN" ]; then
  cp "$LOCAL_SOURCE_BIN" "$APP_DIR/$APP_NAME.js"
else
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "https://raw.githubusercontent.com/$REPO/$REF/bin/vps-manage.js" -o "$APP_DIR/$APP_NAME.js"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$APP_DIR/$APP_NAME.js" "https://raw.githubusercontent.com/$REPO/$REF/bin/vps-manage.js"
  else
    echo "Error: curl or wget is required for remote installation." >&2
    exit 1
  fi
fi

chmod +x "$APP_DIR/$APP_NAME.js"
ln -sf "$APP_DIR/$APP_NAME.js" "$TARGET_BIN"

echo "Installed $APP_NAME -> $TARGET_BIN"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo
    echo "Add this to your shell profile if '$APP_NAME' is not found:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac

echo
echo "Run:"
echo "  $APP_NAME"

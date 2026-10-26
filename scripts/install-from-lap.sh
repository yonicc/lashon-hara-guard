#!/usr/bin/env bash
# Install the published extension from https://lap.ysho.uk into an unpacked
# extension directory (default: YONI-PC's active copy), after verifying the
# ZIP's SHA-256 against /downloads/version.json. Keeps a backup of the old copy.
#   bash install-from-lap.sh [target-dir] [owner]
# Run as root (or as the owner). Afterwards reload the extension in
# chrome://extensions and refresh the supported tabs.
set -euo pipefail
DEST="${1:-/home/yoni/lashon-hara-guard-gmail/extension}"
OWNER="${2:-yoni}"
BASE="https://lap.ysho.uk/downloads"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsS -A lhg-install "$BASE/version.json" -o "$TMP/version.json"
curl -fsS -A lhg-install "$BASE/lap-extension.zip" -o "$TMP/ext.zip"
python3 -I - "$TMP" <<'PY'
import hashlib, json, sys, zipfile, pathlib
tmp = pathlib.Path(sys.argv[1])
meta = json.loads((tmp / "version.json").read_text())
digest = hashlib.sha256((tmp / "ext.zip").read_bytes()).hexdigest()
if digest != meta["sha256"]:
    sys.exit(f"sha256 mismatch: {digest} != {meta['sha256']}")
out = tmp / "unpacked"
with zipfile.ZipFile(tmp / "ext.zip") as z:
    for n in z.namelist():
        if n.startswith("/") or ".." in pathlib.PurePosixPath(n).parts:
            sys.exit(f"unsafe path in zip: {n}")
    z.extractall(out)
json.loads((out / "manifest.json").read_text())
print(f"verified {meta['version']} @ {meta['commit']} sha256={digest}")
PY
if [ -d "$DEST" ]; then cp -a "$DEST" "$DEST.bak-$(date +%Y%m%d%H%M%S)"; fi
mkdir -p "$DEST"
cp -f "$TMP"/unpacked/* "$DEST"/
chown -R "$OWNER:$OWNER" "$DEST" 2>/dev/null || true
python3 -c "import json,sys;print('installed version', json.load(open(sys.argv[1]))['version'])" "$DEST/manifest.json"

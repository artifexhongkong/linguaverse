#!/bin/bash
# ============================================================
# Download sherpa-onnx Android AAR only (no models).
# ------------------------------------------------------------
# Model files are NOT bundled in the APK — users download them
# on-demand via the Settings page (downloadModels() plugin method).
# This keeps the APK lightweight (~3MB instead of 266MB).
# ============================================================
set -e

SHERPA_VERSION="1.10.40"
LIBS_DIR="android/app/libs"

AAR_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v${SHERPA_VERSION}/sherpa-onnx-${SHERPA_VERSION}.aar"

mkdir -p "$LIBS_DIR"

echo "=== Downloading sherpa-onnx AAR v${SHERPA_VERSION} ==="
AAR_DEST="$LIBS_DIR/sherpa-onnx.aar"
if [ -f "$AAR_DEST" ] && [ -s "$AAR_DEST" ]; then
  echo "  SKIP (exists): $AAR_DEST"
else
  echo "  Downloading from $AAR_URL ..."
  if ! curl -L --fail --retry 3 -o "$AAR_DEST" "$AAR_URL"; then
    echo ""
    echo "ERROR: Could not download AAR from $AAR_URL"
    echo ""
    echo "Manual fallback:"
    echo "  1. Go to https://github.com/k2-fsa/sherpa-onnx/releases"
    echo "  2. Find version v${SHERPA_VERSION}"
    echo "  3. Download sherpa-onnx-${SHERPA_VERSION}.aar"
    echo "  4. Save it as: $AAR_DEST"
    exit 1
  fi
  echo "  OK: $(du -h "$AAR_DEST" | cut -f1)"
fi

echo ""
echo "=== Download complete ==="
echo "AAR in: $LIBS_DIR/sherpa-onnx.aar"

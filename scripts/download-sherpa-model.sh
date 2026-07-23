#!/bin/bash
# ============================================================
# Download sherpa-onnx Android AAR + offline speech models
# ------------------------------------------------------------
# Models:
#   1. SenseVoiceSmall (int8 quantized, ~234MB)
#      - Supports: zh, en, ja, ko, yue (Cantonese)
#      - Built-in punctuation
#      - Perfect for LinguaVerse (Cantonese + Taiwanese Mandarin)
#   2. Silero VAD (~1.8MB)
#      - Voice Activity Detection for segmenting speech
#
# AAR:
#   sherpa-onnx Android bindings with native .so for arm64-v8a,
#   armeabi-v7a, x86_64
# ============================================================
set -e

# --- Config ---
SHERPA_VERSION="1.10.40"
MODEL_DIR="android/app/src/main/assets/sherpa-models"
LIBS_DIR="android/app/libs"

# SenseVoiceSmall (int8 quantized — 234MB instead of 900MB)
SENSE_VOICE_URL="https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main"
SENSE_VOICE_FILES=(
  "model.int8.onnx"
  "tokens.txt"
)

# Silero VAD
VAD_URL="https://github.com/k2-fsa/sherpa-onnx/raw/master/sherpa-onnx/csrc/vad-models/silero_vad.onnx"

# sherpa-onnx AAR
AAR_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v${SHERPA_VERSION}/sherpa-onnx-v${SHERPA_VERSION}.aar"

# --- Create directories ---
mkdir -p "$MODEL_DIR/sense-voice"
mkdir -p "$MODEL_DIR/silero-vad"
mkdir -p "$LIBS_DIR"

# --- Download SenseVoiceSmall ---
echo "=== Downloading SenseVoiceSmall model (int8, ~234MB) ==="
for FILE in "${SENSE_VOICE_FILES[@]}"; do
  DEST="$MODEL_DIR/sense-voice/$FILE"
  if [ -f "$DEST" ] && [ -s "$DEST" ]; then
    echo "  SKIP (exists): $DEST"
  else
    echo "  Downloading $FILE ..."
    curl -L --fail --retry 3 -o "$DEST" "${SENSE_VOICE_URL}/${FILE}"
    echo "  OK: $(du -h "$DEST" | cut -f1)"
  fi
done

# --- Download Silero VAD ---
echo ""
echo "=== Downloading Silero VAD model (~1.8MB) ==="
VAD_DEST="$MODEL_DIR/silero-vad/silero_vad.onnx"
if [ -f "$VAD_DEST" ] && [ -s "$VAD_DEST" ]; then
  echo "  SKIP (exists): $VAD_DEST"
else
  curl -L --fail --retry 3 -o "$VAD_DEST" "$VAD_URL"
  echo "  OK: $(du -h "$VAD_DEST" | cut -f1)"
fi

# --- Download sherpa-onnx AAR ---
echo ""
echo "=== Downloading sherpa-onnx AAR v${SHERPA_VERSION} ==="
AAR_DEST="$LIBS_DIR/sherpa-onnx.aar"
if [ -f "$AAR_DEST" ] && [ -s "$AAR_DEST" ]; then
  echo "  SKIP (exists): $AAR_DEST"
else
  echo "  Trying: $AAR_URL"
  if ! curl -L --fail --retry 3 -o "$AAR_DEST" "$AAR_URL"; then
    echo ""
    echo "ERROR: Could not download AAR from $AAR_URL"
    echo ""
    echo "Manual fallback:"
    echo "  1. Go to https://github.com/k2-fsa/sherpa-onnx/releases"
    echo "  2. Find version v${SHERPA_VERSION} (or latest)"
    echo "  3. Download the .aar file"
    echo "  4. Save it as: $AAR_DEST"
    exit 1
  fi
  echo "  OK: $(du -h "$AAR_DEST" | cut -f1)"
fi

# --- Summary ---
echo ""
echo "=== Download complete ==="
echo "Models in:  $MODEL_DIR/"
echo "AAR in:     $LIBS_DIR/"
echo ""
echo "Total size: $(du -sh "$MODEL_DIR" "$LIBS_DIR/sherpa-onnx.aar" | tail -1 | cut -f1)"
echo ""
echo "These files are git-ignored (too large for git). The CI workflow"
echo "will download them automatically on each build (cached)."

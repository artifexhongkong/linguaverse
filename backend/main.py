"""LinguaVerse FastAPI backend.

Exposes:
- ``GET  /health``           — basic liveness check
- ``POST /translate``        — proxies translation requests to the Agnes API
                                using the ``agnes-2.0-flash`` model.
- ``POST /api/v1/stt``       — speech-to-text via OpenAI-compatible Whisper.
                                Tuned for Cantonese, Taiwanese Mandarin, and
                                code-mixed (Chinese + English) speech.

The API key is read from ``config.settings`` and never sent back to the
client.
"""

from __future__ import annotations

import io
from typing import Optional

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config import settings

app = FastAPI(title="LinguaVerse API", version="1.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Translation endpoint
# ---------------------------------------------------------------------------

class TranslateRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    sourceLang: str = "auto"
    targetLang: str = "en"
    systemPrompt: Optional[str] = None
    temperature: float = 0.3


class TranslateResponse(BaseModel):
    text: str
    confidence: float
    engine: str = "agnes"
    model: str


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "api_base": settings.AGNES_BASE_URL,
        "model": settings.AGNES_MODEL,
        "configured": settings.is_configured,
        "stt_configured": settings.is_stt_configured,
    }


@app.post("/translate", response_model=TranslateResponse)
async def translate(req: TranslateRequest) -> TranslateResponse:
    if not settings.is_configured:
        raise HTTPException(
            status_code=500,
            detail="AGNES_API_KEY is not configured on the server.",
        )

    lang_directive = (
        f"請將以下文字翻譯為{req.targetLang}"
        if req.sourceLang == "auto"
        else f"請將以下{req.sourceLang}文字翻譯為{req.targetLang}"
    )

    system_prompt = (
        f"{req.systemPrompt}\n\n{lang_directive}。只輸出譯文，不附加任何解釋。"
        if req.systemPrompt
        else f"你是專業翻譯專家。{lang_directive}。只輸出譯文，不附加任何解釋。"
    )

    payload = {
        "model": settings.AGNES_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": req.text},
        ],
        "temperature": req.temperature,
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.AGNES_API_KEY}",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                settings.chat_completions_url,
                json=payload,
                headers=headers,
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Agnes request failed: {exc}")

    if resp.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Agnes API error: {resp.status_code} {resp.text[:200]}",
        )

    data = resp.json()
    translated_text = ""
    choices = data.get("choices") or []
    if choices:
        translated_text = choices[0].get("message", {}).get("content", "") or ""

    return TranslateResponse(
        text=translated_text.strip(),
        confidence=0.95,
        engine="agnes",
        model=settings.AGNES_MODEL,
    )


# ---------------------------------------------------------------------------
# Speech-to-Text endpoint — /api/v1/stt
# ---------------------------------------------------------------------------
#
# Tuned for Hong Kong Cantonese, Taiwanese Mandarin, and code-mixed
# Chinese-English speech. The dialect hint is passed via Whisper's `prompt`
# parameter, which biases the decoder toward vocabulary that Whisper's
# baseline often misrecognises (e.g. 嘅/咗/咁/嘢 in Cantonese, local TW
# phrasing, VFX industry jargon).

# Dialect hint — passed verbatim to Whisper as the `prompt` field.
# Whisper uses this as decoder bias, so it must be in the SAME script
# the user is expected to speak.
STT_DIALECT_PROMPT = (
    "這是一段包含粵語口語（如嘅、咗、咁、嘢、點解、唔該、冇、咩）、"
    "台灣口語（如欸、超、宅、揪、靠北、機車）以及影視 VFX 專業術語"
    "（如 keying、tracking、roto、composite、render、matchmove、HDRI、"
    "rigging、particle simulation、color grading、look development）"
    "的中英夾雜日常對話。"
)

# Accept the audio formats Whisper typically handles.
# (kept as a tuple for fast membership checks)
_ALLOWED_AUDIO_TYPES = {
    "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave",
    "audio/webm", "audio/ogg", "audio/m4a", "audio/x-m4a", "audio/mp4",
    "audio/aac", "audio/flac", "audio/x-flac",
}
_ALLOWED_AUDIO_EXTS = {
    ".mp3", ".wav", ".webm", ".ogg", ".m4a", ".mp4", ".aac", ".flac", ".opus",
}
# Hard cap on upload size — 25 MB matches OpenAI's Whisper limit.
_MAX_AUDIO_BYTES = 25 * 1024 * 1024


class STTResponse(BaseModel):
    text: str
    model: str
    duration: Optional[float] = None
    language: Optional[str] = None


@app.post("/api/v1/stt", response_model=STTResponse)
async def speech_to_text(
    file: UploadFile = File(..., description="Audio file to transcribe"),
) -> STTResponse:
    """Transcribe an uploaded audio file via Whisper.

    Tuned for:
      - **Cantonese** (HK colloquial: 嘅/咗/咁/嘢/點解/唔該/冇/咩)
      - **Taiwanese Mandarin** (欸/超/宅/揪/靠北/機車)
      - **Code-mixed Chinese + English** (esp. VFX/film jargon)

    The dialect hint is injected via Whisper's ``prompt`` parameter, which
    biases the decoder toward the listed vocabulary — dramatically
    improving accuracy on dialect words and industry terms that the
    baseline model often misrecognises.

    Returns ``{"text": "識別後的文字內容"}``.
    """
    if not settings.is_stt_configured:
        raise HTTPException(
            status_code=500,
            detail="STT_API_KEY / STT_BASE_URL is not configured on the server.",
        )

    # 1. Validate content type / extension
    filename = file.filename or "audio.webm"
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    ctype = (file.content_type or "").lower()

    if ext not in _ALLOWED_AUDIO_EXTS and ctype not in _ALLOWED_AUDIO_TYPES:
        raise HTTPException(
            status_code=415,
            detail=(
                "Unsupported audio format. Send mp3, wav, webm, ogg, m4a, "
                "mp4, aac, flac, or opus."
            ),
        )

    # 2. Read & size-check the upload
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio file is empty.")

    if len(audio_bytes) > _MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Audio file too large (max {_MAX_AUDIO_BYTES // (1024*1024)} MB).",
        )

    # 3. Build the multipart form for the OpenAI-compatible Whisper API.
    # Whisper wants:
    #   - file:        the raw audio bytes + filename (with extension so it
    #                  can detect format)
    #   - model:       "whisper-1" (or compatible)
    #   - prompt:      dialect hint — biases the decoder toward Cantonese /
    #                  TW Mandarin / VFX jargon vocabulary
    #   - response_format: "json" (or "verbose_json" for duration/language)
    files = {
        "file": (filename, io.BytesIO(audio_bytes), ctype or "application/octet-stream"),
    }
    data = {
        "model": settings.STT_MODEL,
        "prompt": STT_DIALECT_PROMPT,
        "response_format": "verbose_json",
        "language": "zh",  # hint; Whisper will still detect within zh family
    }
    headers = {
        "Authorization": f"Bearer {settings.STT_API_KEY}",
        # NOTE: do NOT set Content-Type manually — httpx will set the
        # multipart boundary for us.
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                settings.audio_transcriptions_url,
                files=files,
                data=data,
                headers=headers,
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"STT request failed: {exc}")

    if resp.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Whisper API error: {resp.status_code} {resp.text[:300]}",
        )

    # 4. Parse the response
    try:
        result = resp.json()
    except Exception:
        # If the API returned plain text (response_format=text), wrap it.
        return STTResponse(text=resp.text.strip(), model=settings.STT_MODEL)

    text = (result.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=502, detail="Whisper returned empty transcription.")

    return STTResponse(
        text=text,
        model=result.get("model", settings.STT_MODEL),
        duration=result.get("duration"),
        language=result.get("language"),
    )

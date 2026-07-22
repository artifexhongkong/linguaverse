"""LinguaVerse FastAPI backend.

Exposes:
- ``GET  /health``     — basic liveness check
- ``POST /translate``  — proxies translation requests to the Agnes API
                         using the ``Agnes-2.0-Flash`` model.

The API key is read from ``config.settings`` and never sent back to the
client.
"""

from __future__ import annotations

from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config import settings

app = FastAPI(title="LinguaVerse API", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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

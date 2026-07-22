from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import OPENAI_API_BASE

app = FastAPI(title="LinguaVerse API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "api_base": OPENAI_API_BASE}

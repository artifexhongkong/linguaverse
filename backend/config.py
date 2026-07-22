from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    AGNES_API_KEY: str
    AGNES_BASE_URL: str = "https://api.agnes.ai/v1"
    AGNES_MODEL: str = "Agnes-2.0-Flash"


settings = Settings()

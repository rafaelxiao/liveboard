from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Single source of truth for runtime configuration (env-driven)."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # --- Database ---
    DATABASE_URL: str
    TEST_DATABASE_URL: str | None = None

    # --- Auth / JWT ---
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_TTL_MIN: int = 15
    REFRESH_TOKEN_TTL_DAYS: int = 14

    # --- Seeded admin ---
    ADMIN_EMAIL: str
    ADMIN_PASSWORD: str

    # --- CORS ---
    CORS_ORIGINS: str = ""

    # --- Quant conventions ---
    RISK_FREE_RATE: float = 0.0
    ANNUALIZATION_DAYS: int = 365
    SHARPE_MIN_SAMPLE_TRADES: int = 20
    SHARPE_MIN_ACTIVE_DAYS: int = 30
    SHARPE_SUPPRESS_BELOW: int = 5
    PER_TRADE_MATCH_TOLERANCE: int = 300  # seconds

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

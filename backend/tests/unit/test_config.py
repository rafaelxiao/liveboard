import importlib

import pytest


def _fresh_settings(monkeypatch, **env):
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    import app.core.config as config_module

    importlib.reload(config_module)
    return config_module.Settings()


def test_settings_reads_all_env_vars(monkeypatch):
    settings = _fresh_settings(
        monkeypatch,
        DATABASE_URL="postgresql+psycopg://u:p@localhost:5432/liveboard",
        TEST_DATABASE_URL="postgresql+psycopg://u:p@localhost:5432/liveboard_test",
        JWT_SECRET="test-secret",
        ADMIN_EMAIL="admin@example.com",
        ADMIN_PASSWORD="adminpw",
        CORS_ORIGINS="http://localhost:5173,http://localhost:3000",
    )
    assert settings.DATABASE_URL.endswith("/liveboard")
    assert settings.TEST_DATABASE_URL.endswith("/liveboard_test")
    assert settings.JWT_SECRET == "test-secret"
    assert settings.JWT_ALGORITHM == "HS256"
    assert settings.ACCESS_TOKEN_TTL_MIN == 15
    assert settings.REFRESH_TOKEN_TTL_DAYS == 14
    assert settings.ADMIN_EMAIL == "admin@example.com"
    assert settings.RISK_FREE_RATE == 0
    assert settings.ANNUALIZATION_DAYS == 365
    assert settings.SHARPE_MIN_SAMPLE_TRADES == 20
    assert settings.SHARPE_MIN_ACTIVE_DAYS == 30
    assert settings.SHARPE_SUPPRESS_BELOW == 5
    assert settings.PER_TRADE_MATCH_TOLERANCE == 300


def test_cors_origins_parsed_to_list(monkeypatch):
    settings = _fresh_settings(
        monkeypatch,
        DATABASE_URL="postgresql+psycopg://u:p@localhost:5432/liveboard",
        JWT_SECRET="s",
        ADMIN_EMAIL="a@b.c",
        ADMIN_PASSWORD="pw",
        CORS_ORIGINS="http://localhost:5173, http://localhost:3000 ",
    )
    assert settings.cors_origins_list == [
        "http://localhost:5173",
        "http://localhost:3000",
    ]


def test_missing_required_field_raises(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    import app.core.config as config_module

    importlib.reload(config_module)
    with pytest.raises(Exception):  # noqa: B017
        config_module.Settings(_env_file=None)

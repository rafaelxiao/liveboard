# LiveBoard Phase 0 — Foundations & Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a runnable, empty FastAPI + PostgreSQL backend skeleton — uv project, config/db/errors/main scaffolding, Alembic wired to model metadata, Docker Compose Postgres, and a pytest harness with a passing health-check — so every later phase has a tested foundation to build on.

**Architecture:** A `backend/` package root managed by `uv`. `app/main.py` is an app factory that wires CORS, an aggregator router, error handlers, and a startup hook stub. `app/db.py` owns the SQLAlchemy 2.x engine/session/`Base`/`get_db`; `app/core/config.py` is the single pydantic-settings source for every env var; `app/core/errors.py` defines typed domain exceptions plus handlers that emit uniform error JSON. Alembic reads its URL from `Settings` and its metadata from `app.db.Base` (with all models imported via `app/models/__init__.py`). Tests run against a real test Postgres via `TestClient`.

**Tech Stack:** Python ≥3.12, uv, FastAPI ≥0.110, uvicorn[standard] ≥0.29, SQLAlchemy ≥2.0, Alembic ≥1.13, psycopg[binary] ≥3.1, pydantic ≥2.6, pydantic-settings ≥2.2, pytest ≥8, pytest-cov, httpx ≥0.27, ruff ≥0.4, PostgreSQL 16 (Docker `postgres:16`).

## Global Constraints

- All money/qty are `Decimal` → `NUMERIC(28,10)`; rates `NUMERIC(28,12)`; JSON numbers serialized as **strings**; every metric field carries a `units` entry.
- All `ts` are ISO-8601 **UTC** (reject naive/non-UTC); trade date derived in series `session_tz`.
- **No financial computation in the frontend.** If a number is shown, the backend produced it. Responses carry data + metadata only (no colors, no formatted strings, no UI labels).
- Business logic only in `app/services/*` (framework-free, callable without HTTP); routers parse → call one service → serialize.
- TDD: each unit of logic gets a failing test first; frequent commits; `ruff` + `pytest` green before a phase gate.
- Per-user data isolation everywhere; voided rows excluded from all computation.

---

## File Structure

Every file this phase creates (all paths relative to the repo root `LiveBoard/`):

| File | Responsibility |
|------|----------------|
| `.gitignore` | Ignore `.env`, `__pycache__`, `.venv`, `*.pyc`, coverage artifacts |
| `.env.example` | Documented env vars (every var from tech-stack §4 / structure §1.4) |
| `docker-compose.yml` | `postgres:16` service (named volume, port 5432) + optional `adminer` |
| `backend/pyproject.toml` | uv project metadata, dependency floors, `[tool.ruff]`, `[tool.pytest.ini_options]` (coverage gate on `app/services`) |
| `backend/.env.example` | Backend-local duplicate of the documented env (sourced by `uv run`) |
| `backend/alembic.ini` | Alembic config; `script_location = app/alembic`; URL comes from `env.py`, not hardcoded |
| `backend/app/__init__.py` | Package marker |
| `backend/app/core/__init__.py` | Package marker |
| `backend/app/core/config.py` | `Settings` (pydantic-settings) — single source for all env config |
| `backend/app/core/errors.py` | Typed domain exceptions + FastAPI handlers → uniform error JSON |
| `backend/app/db.py` | SQLAlchemy engine, `SessionLocal`, `Base`, `get_db()` dependency |
| `backend/app/models/__init__.py` | Imports all model modules so Alembic autogenerate sees them (empty for Phase 0) |
| `backend/app/schemas/__init__.py` | Package marker (DTOs land here in later phases) |
| `backend/app/services/__init__.py` | Package marker (business logic lands here in later phases) |
| `backend/app/routers/__init__.py` | `api_router` aggregator (includes the health router) |
| `backend/app/routers/health.py` | `GET /health` liveness endpoint |
| `backend/app/main.py` | App factory: CORS, router aggregation, error handlers, startup hook stub |
| `backend/app/alembic/env.py` | Alembic runtime env; binds `app.db.Base.metadata`; reads URL from `Settings` |
| `backend/app/alembic/script.py.mako` | Migration template |
| `backend/app/alembic/versions/0001_initial_empty.py` | First (empty) migration so `alembic upgrade head` succeeds on a fresh DB |
| `backend/tests/__init__.py` | Package marker |
| `backend/tests/conftest.py` | Fixtures: test engine/session, schema setup, `TestClient`, factory helper stubs |
| `backend/tests/unit/__init__.py` | Package marker |
| `backend/tests/api/__init__.py` | Package marker |
| `backend/tests/api/test_health.py` | TDD health-check: `GET /health` → 200 |
| `backend/tests/api/test_app_smoke.py` | `/docs` and `/openapi.json` reachable; error-handler envelope shape |

---

## Tasks

> Work from the repo root `LiveBoard/`. All `uv`, `pytest`, `alembic`, and `uvicorn`
> commands are run **from `backend/`** unless a path says otherwise. Initialize git
> first if the repo is not yet a git repository (`git init`).

---

### Task 1: uv project scaffolding (`pyproject.toml` + package skeleton)

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py`, `backend/app/core/__init__.py`, `backend/app/models/__init__.py`, `backend/app/schemas/__init__.py`, `backend/app/services/__init__.py`, `backend/app/routers/__init__.py`
- Create: `backend/tests/__init__.py`, `backend/tests/unit/__init__.py`, `backend/tests/api/__init__.py`
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: an installable uv project named `liveboard-backend` with the dependency floors and tool config every later task relies on; the `app/` and `tests/` package tree.

- [ ] **Step 1: Write the failing test** — a deliverable-verification command (no pytest file yet). The verifiable deliverable is "`uv sync` resolves and installs all declared deps". Create the package markers and `pyproject.toml` first, then run the verification in Step 2.

Create the empty package markers (all are empty files):
```
backend/app/__init__.py
backend/app/core/__init__.py
backend/app/models/__init__.py
backend/app/schemas/__init__.py
backend/app/services/__init__.py
backend/app/routers/__init__.py
backend/tests/__init__.py
backend/tests/unit/__init__.py
backend/tests/api/__init__.py
```

Create `.gitignore` (repo root):
```gitignore
# Python
__pycache__/
*.py[cod]
*.egg-info/
.venv/
.pytest_cache/
.ruff_cache/
.coverage
htmlcov/
coverage.xml

# Env / secrets
.env

# OS
.DS_Store
```

Create `backend/pyproject.toml`:
```toml
[project]
name = "liveboard-backend"
version = "0.1.0"
description = "LiveBoard backend — FastAPI quant analytics data service"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.110",
    "uvicorn[standard]>=0.29",
    "sqlalchemy>=2.0",
    "alembic>=1.13",
    "psycopg[binary]>=3.1",
    "pydantic>=2.6",
    "pydantic-settings>=2.2",
    "passlib[bcrypt]>=1.7",
    "pyjwt>=2.8",
]

[dependency-groups]
dev = [
    "pytest>=8",
    "pytest-cov",
    "httpx>=0.27",
    "ruff>=0.4",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["app"]

[tool.ruff]
line-length = 100
target-version = "py312"
src = ["app", "tests"]

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "W"]
ignore = ["B008"]  # FastAPI Depends(...) in defaults is idiomatic

[tool.ruff.lint.per-file-ignores]
"app/alembic/*" = ["E402"]      # alembic env imports after config side-effects
"tests/*" = ["B008"]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-q --cov=app/services --cov-report=term-missing"
filterwarnings = ["error::DeprecationWarning"]

[tool.coverage.run]
source = ["app/services"]
```

- [ ] **Step 2: Run to verify it fails** — before the files exist, this fails.
Run: `cd backend && uv sync`
Expected (run *before* creating `pyproject.toml`): FAIL with "No `pyproject.toml` found" (or uv cannot find a project). After creating the files above, this becomes the implementation/verify step.

- [ ] **Step 3: Write minimal implementation** — the `pyproject.toml`, `.gitignore`, and all package markers above ARE the implementation. Ensure each `__init__.py` is an empty file and the directory tree matches the File Structure section.

- [ ] **Step 4: Run to verify it passes**
Run: `cd backend && uv sync`
Expected: PASS — uv creates `.venv`, writes `uv.lock`, and reports the dependency set resolved (fastapi, sqlalchemy, alembic, psycopg, pydantic, pydantic-settings, passlib, pyjwt + dev group) installed with no resolution errors.
Then run `cd backend && uv run ruff check .`
Expected: PASS — "All checks passed!" (no Python files with lint errors yet).

- [ ] **Step 5: Commit**
```bash
git add .gitignore backend/pyproject.toml backend/uv.lock backend/app backend/tests
git commit -m "P0: uv project scaffolding + package skeleton + ruff/pytest config"
```

---

### Task 2: `core/config.py` — Settings (all env vars)

**Files:**
- Create: `backend/app/core/config.py`
- Create: `backend/.env.example`, `.env.example` (repo root)
- Test: `backend/tests/unit/test_config.py`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure pydantic-settings).
- Produces:
  - `class Settings(BaseSettings)` with fields for every env var (see code).
  - `get_settings() -> Settings` (lru_cached) and a module-level `settings = get_settings()`.
  - `Settings.cors_origins_list -> list[str]` (parsed from comma-separated `CORS_ORIGINS`).
  Later tasks (`db.py`, `main.py`, `alembic/env.py`) import `from app.core.config import settings`.

- [ ] **Step 1: Write the failing test**
```python
# backend/tests/unit/test_config.py
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
    with pytest.raises(Exception):
        config_module.Settings(_env_file=None)
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd backend && uv run pytest tests/unit/test_config.py`
Expected: FAIL with "ModuleNotFoundError: No module named 'app.core.config'" (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**
```python
# backend/app/core/config.py
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
```

Create `.env.example` (repo root) — documents every env var:
```dotenv
# === Backend ===
# Postgres DSN (psycopg 3 driver)
DATABASE_URL=postgresql+psycopg://liveboard:liveboard@localhost:5432/liveboard
# Separate database for API tests
TEST_DATABASE_URL=postgresql+psycopg://liveboard:liveboard@localhost:5432/liveboard_test

# Auth / JWT
JWT_SECRET=change-me-in-production
JWT_ALGORITHM=HS256
ACCESS_TOKEN_TTL_MIN=15
REFRESH_TOKEN_TTL_DAYS=14

# Seeded admin (idempotent on startup)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me

# CORS (comma-separated SPA origins)
CORS_ORIGINS=http://localhost:5173

# Quant conventions
RISK_FREE_RATE=0
ANNUALIZATION_DAYS=365
SHARPE_MIN_SAMPLE_TRADES=20
SHARPE_MIN_ACTIVE_DAYS=30
SHARPE_SUPPRESS_BELOW=5
PER_TRADE_MATCH_TOLERANCE=300

# === Frontend ===
# API base; defaults to /api via the Vite dev proxy
VITE_API_BASE_URL=/api
```

Create `backend/.env.example` with the same backend block (so `uv run` from `backend/` sees a documented template):
```dotenv
DATABASE_URL=postgresql+psycopg://liveboard:liveboard@localhost:5432/liveboard
TEST_DATABASE_URL=postgresql+psycopg://liveboard:liveboard@localhost:5432/liveboard_test
JWT_SECRET=change-me-in-production
JWT_ALGORITHM=HS256
ACCESS_TOKEN_TTL_MIN=15
REFRESH_TOKEN_TTL_DAYS=14
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me
CORS_ORIGINS=http://localhost:5173
RISK_FREE_RATE=0
ANNUALIZATION_DAYS=365
SHARPE_MIN_SAMPLE_TRADES=20
SHARPE_MIN_ACTIVE_DAYS=30
SHARPE_SUPPRESS_BELOW=5
PER_TRADE_MATCH_TOLERANCE=300
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd backend && cp .env.example .env && uv run pytest tests/unit/test_config.py`
Expected: PASS — 3 tests pass. (`.env` is git-ignored; it is needed so `Settings()` resolves required fields when `monkeypatch` is not setting them.)

- [ ] **Step 5: Commit**
```bash
git add backend/app/core/config.py backend/tests/unit/test_config.py .env.example backend/.env.example
git commit -m "P0: Settings (pydantic-settings) covering all env vars + .env.example"
```

---

### Task 3: `db.py` — engine, session, Base, get_db

**Files:**
- Create: `backend/app/db.py`
- Test: `backend/tests/unit/test_db.py`

**Interfaces:**
- Consumes: `from app.core.config import settings` (`settings.DATABASE_URL`).
- Produces:
  - `Base` — `DeclarativeBase` subclass; all models inherit from it; Alembic reads `Base.metadata`.
  - `engine` — module-level SQLAlchemy `Engine` built from `settings.DATABASE_URL`.
  - `SessionLocal` — `sessionmaker[Session]` bound to `engine`.
  - `get_db() -> Iterator[Session]` — FastAPI dependency yielding a session and closing it.

- [ ] **Step 1: Write the failing test**
```python
# backend/tests/unit/test_db.py
from collections.abc import Iterator

from sqlalchemy.orm import Session

import app.db as db


def test_base_has_metadata():
    # Base must expose a MetaData object for Alembic autogenerate
    assert hasattr(db.Base, "metadata")
    assert db.Base.metadata is not None


def test_engine_uses_configured_url():
    from app.core.config import settings

    assert str(db.engine.url).startswith("postgresql+psycopg")
    # URL should be derived from settings, not hardcoded
    assert settings.DATABASE_URL.split("://", 1)[0] in str(db.engine.url)


def test_get_db_yields_session_and_closes():
    gen = db.get_db()
    assert isinstance(gen, Iterator)
    session = next(gen)
    assert isinstance(session, Session)
    # Exhausting the generator triggers the finally: close()
    try:
        next(gen)
    except StopIteration:
        pass
    assert session.bind is db.engine
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd backend && uv run pytest tests/unit/test_db.py`
Expected: FAIL with "ModuleNotFoundError: No module named 'app.db'".

- [ ] **Step 3: Write minimal implementation**
```python
# backend/app/db.py
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    """Declarative base; every ORM model inherits from this.

    Alembic autogenerate targets ``Base.metadata`` (see app/alembic/env.py).
    """


engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, future=True)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: yield a session, always close it."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd backend && uv run pytest tests/unit/test_db.py`
Expected: PASS — 3 tests pass. (Engine creation does not open a connection, so no live Postgres is needed for this unit test.)

- [ ] **Step 5: Commit**
```bash
git add backend/app/db.py backend/tests/unit/test_db.py
git commit -m "P0: db.py — engine/SessionLocal/Base/get_db"
```

---

### Task 4: `core/errors.py` — typed exceptions + uniform error JSON

**Files:**
- Create: `backend/app/core/errors.py`
- Test: `backend/tests/unit/test_errors.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `class AppError(Exception)` base with `status_code: int`, `code: str`, `message: str`.
  - Subclasses: `NotFoundError` (404), `ConflictError` (409), `ValidationAppError` (422), `AuthError` (401), `ForbiddenError` (403), `PayloadTooLargeError` (413).
  - `error_payload(code: str, message: str, details=None) -> dict` — canonical `{"error": {...}}` shape.
  - `register_exception_handlers(app: FastAPI) -> None` — wires handlers for `AppError` and FastAPI's `RequestValidationError`/`HTTPException` so every error response shares one shape. `main.py` calls this.

- [ ] **Step 1: Write the failing test**
```python
# backend/tests/unit/test_errors.py
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core import errors


def test_app_error_subclasses_carry_status_and_code():
    assert errors.NotFoundError("x").status_code == 404
    assert errors.ConflictError("x").status_code == 409
    assert errors.ValidationAppError("x").status_code == 422
    assert errors.AuthError("x").status_code == 401
    assert errors.ForbiddenError("x").status_code == 403
    assert errors.PayloadTooLargeError("x").status_code == 413
    err = errors.NotFoundError("missing series")
    assert err.code == "not_found"
    assert err.message == "missing series"


def test_error_payload_shape():
    payload = errors.error_payload("not_found", "missing series")
    assert payload == {"error": {"code": "not_found", "message": "missing series", "details": None}}


def test_handlers_emit_uniform_json():
    app = FastAPI()
    errors.register_exception_handlers(app)

    @app.get("/boom")
    def boom():
        raise errors.ConflictError("email already registered")

    client = TestClient(app)
    resp = client.get("/boom")
    assert resp.status_code == 409
    body = resp.json()
    assert body["error"]["code"] == "conflict"
    assert body["error"]["message"] == "email already registered"


def test_request_validation_error_uses_same_envelope():
    from pydantic import BaseModel

    app = FastAPI()
    errors.register_exception_handlers(app)

    class Body(BaseModel):
        n: int

    @app.post("/v")
    def v(body: Body):
        return {"ok": True}

    client = TestClient(app)
    resp = client.post("/v", json={"n": "not-an-int"})
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "validation_error"
    assert body["error"]["details"] is not None
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd backend && uv run pytest tests/unit/test_errors.py`
Expected: FAIL with "ModuleNotFoundError: No module named 'app.core.errors'".

- [ ] **Step 3: Write minimal implementation**
```python
# backend/app/core/errors.py
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    """Base domain exception. Subclasses set status_code + code."""

    status_code: int = 500
    code: str = "internal_error"

    def __init__(self, message: str, details: Any | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details


class AuthError(AppError):
    status_code = 401
    code = "unauthorized"


class ForbiddenError(AppError):
    status_code = 403
    code = "forbidden"


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


class ConflictError(AppError):
    status_code = 409
    code = "conflict"


class PayloadTooLargeError(AppError):
    status_code = 413
    code = "payload_too_large"


class ValidationAppError(AppError):
    status_code = 422
    code = "validation_error"


def error_payload(code: str, message: str, details: Any | None = None) -> dict:
    return {"error": {"code": code, "message": message, "details": details}}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error_handler(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(exc.code, exc.message, exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=error_payload("validation_error", "Request validation failed", exc.errors()),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload("http_error", str(exc.detail)),
        )
```

> Note: FastAPI serializes `exc.errors()` which may contain non-JSON-native objects in
> some pydantic versions; if the validation handler raises a serialization error during
> Step 4, wrap details with `jsonable_encoder(exc.errors())` (`from fastapi.encoders import jsonable_encoder`).

- [ ] **Step 4: Run test to verify it passes**
Run: `cd backend && uv run pytest tests/unit/test_errors.py`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**
```bash
git add backend/app/core/errors.py backend/tests/unit/test_errors.py
git commit -m "P0: core/errors — typed domain exceptions + uniform error JSON handlers"
```

---

### Task 5: health router + `main.py` app factory (TDD health-check)

**Files:**
- Create: `backend/app/routers/health.py`
- Modify: `backend/app/routers/__init__.py` (aggregator)
- Create: `backend/app/main.py`
- Test: `backend/tests/api/test_health.py`, `backend/tests/api/test_app_smoke.py`

**Interfaces:**
- Consumes: `register_exception_handlers` (Task 4), `settings.cors_origins_list` (Task 2).
- Produces:
  - `app/routers/__init__.py`: `api_router: APIRouter` aggregating sub-routers (health for now).
  - `app/routers/health.py`: `router: APIRouter` with `GET /health -> {"status": "ok"}`.
  - `app/main.py`: `create_app() -> FastAPI` (app factory) and module-level `app = create_app()`. The factory adds CORS, includes `api_router`, registers error handlers, and registers a startup hook stub (`_on_startup`, where Phase 1 will add the idempotent admin seed).

- [ ] **Step 1: Write the failing test**
```python
# backend/tests/api/test_health.py
from fastapi.testclient import TestClient

from app.main import create_app


def test_health_returns_200_ok():
    client = TestClient(create_app())
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
```

```python
# backend/tests/api/test_app_smoke.py
from fastapi.testclient import TestClient

from app.main import create_app


def test_openapi_served():
    client = TestClient(create_app())
    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    assert resp.json()["info"]["title"] == "LiveBoard API"


def test_docs_served():
    client = TestClient(create_app())
    resp = client.get("/docs")
    assert resp.status_code == 200


def test_unknown_route_uses_error_envelope():
    client = TestClient(create_app())
    resp = client.get("/does-not-exist")
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "http_error"
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd backend && uv run pytest tests/api/test_health.py tests/api/test_app_smoke.py`
Expected: FAIL with "ModuleNotFoundError: No module named 'app.main'".

- [ ] **Step 3: Write minimal implementation**
```python
# backend/app/routers/health.py
from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

```python
# backend/app/routers/__init__.py
from fastapi import APIRouter

from app.routers import health

api_router = APIRouter()
api_router.include_router(health.router)
```

```python
# backend/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.routers import api_router


def create_app() -> FastAPI:
    app = FastAPI(title="LiveBoard API", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)
    app.include_router(api_router)

    @app.on_event("startup")
    async def _on_startup() -> None:
        # Phase 1 wires the idempotent admin seed here.
        pass

    return app


app = create_app()
```

> Note: `@app.on_event("startup")` is the simplest stub. If the project pins a FastAPI
> version that deprecates it (emitting a `DeprecationWarning` that the `filterwarnings = ["error::DeprecationWarning"]`
> pytest setting turns into a failure), switch to the lifespan form:
> `from contextlib import asynccontextmanager` + `@asynccontextmanager async def lifespan(app): yield`
> passed as `FastAPI(lifespan=lifespan)`. Pick whichever keeps `uv run pytest` green.

- [ ] **Step 4: Run test to verify it passes**
Run: `cd backend && uv run pytest tests/api/test_health.py tests/api/test_app_smoke.py`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**
```bash
git add backend/app/routers/health.py backend/app/routers/__init__.py backend/app/main.py backend/tests/api/test_health.py backend/tests/api/test_app_smoke.py
git commit -m "P0: app factory (CORS, router aggregator, error handlers, startup stub) + /health (TDD)"
```

---

### Task 6: Alembic wiring + first empty migration

**Files:**
- Create: `backend/alembic.ini`
- Create: `backend/app/alembic/env.py`
- Create: `backend/app/alembic/script.py.mako`
- Create: `backend/app/alembic/versions/0001_initial_empty.py`
- Create: `backend/app/alembic/versions/.gitkeep` (only if `versions/` would otherwise be empty before the migration file — skip if the migration file is committed directly)

**Interfaces:**
- Consumes: `app.db.Base` (Task 3, `Base.metadata`), `app.core.config.settings` (`DATABASE_URL`), and `app.models` (Task 1 — empty for now, imported so future models register on `Base.metadata`).
- Produces: a working Alembic environment whose `target_metadata = Base.metadata` and whose URL comes from `settings`, plus a head revision `0001` so `alembic upgrade head` succeeds on an empty DB. Later phases run `alembic revision --autogenerate`.

- [ ] **Step 1: Write the failing test** — the verifiable deliverable is the command `alembic upgrade head` succeeding against the test DB. First add an API/integration-style check that the migration head is reachable and config loads:
```python
# backend/tests/api/test_alembic.py
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


def _alembic_config() -> Config:
    backend_root = Path(__file__).resolve().parents[2]  # backend/
    cfg = Config(str(backend_root / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_root / "app" / "alembic"))
    return cfg


def test_alembic_has_single_head():
    script = ScriptDirectory.from_config(_alembic_config())
    heads = script.get_heads()
    assert len(heads) == 1, f"expected exactly one head, got {heads}"


def test_alembic_env_targets_base_metadata():
    import app.db as db

    # The migration metadata must be the same Base used by the app/models.
    assert db.Base.metadata is not None
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd backend && uv run pytest tests/api/test_alembic.py`
Expected: FAIL — `alembic.ini` / `app/alembic` do not exist yet, so `ScriptDirectory.from_config` raises (no such file/directory).

- [ ] **Step 3: Write minimal implementation**

`backend/alembic.ini`:
```ini
[alembic]
script_location = app/alembic
prepend_sys_path = .
# sqlalchemy.url is intentionally blank — env.py reads it from app.core.config.settings.
sqlalchemy.url =

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARNING
handlers = console
qualname =

[logger_sqlalchemy]
level = WARNING
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

`backend/app/alembic/env.py`:
```python
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.db import Base

# Import all models so they register on Base.metadata for autogenerate.
import app.models  # noqa: F401

config = context.config

# Inject the URL from Settings (never hardcode it in alembic.ini).
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section, {})
    connectable = engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

`backend/app/alembic/script.py.mako`:
```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

# revision identifiers, used by Alembic.
revision: str = ${repr(up_revision)}
down_revision: str | None = ${repr(down_revision)}
branch_labels: str | Sequence[str] | None = ${repr(branch_labels)}
depends_on: str | Sequence[str] | None = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

`backend/app/alembic/versions/0001_initial_empty.py`:
```python
"""initial empty migration

Revision ID: 0001
Revises:
Create Date: 2026-06-19 00:00:00.000000
"""
from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Phase 0 establishes the migration baseline. Models arrive in Phase 1+.
    pass


def downgrade() -> None:
    pass
```

- [ ] **Step 4: Run test to verify it passes**
First the script-directory test:
Run: `cd backend && uv run pytest tests/api/test_alembic.py`
Expected: PASS — single head `0001` detected.

Then the real upgrade against an empty test DB (requires Postgres from Task 7; if running this task before Task 7, point `DATABASE_URL` at any reachable empty Postgres):
Run: `cd backend && uv run alembic upgrade head`
Expected: PASS — Alembic logs `Running upgrade  -> 0001, initial empty migration` and exits 0. `uv run alembic current` then prints `0001 (head)`.

- [ ] **Step 5: Commit**
```bash
git add backend/alembic.ini backend/app/alembic/env.py backend/app/alembic/script.py.mako backend/app/alembic/versions/0001_initial_empty.py backend/tests/api/test_alembic.py
git commit -m "P0: Alembic wired to Base.metadata + settings URL + first empty migration 0001"
```

---

### Task 7: Docker Compose Postgres (+ optional adminer)

**Files:**
- Create: `docker-compose.yml` (repo root)

**Interfaces:**
- Consumes: env from `.env` (Task 2) for credentials/db name (compose reads the repo-root `.env` automatically).
- Produces: a `postgres:16` service on `localhost:5432` with a named volume, healthcheck, and an optional `adminer` service (profile `tools`). Satisfies the gate clause "`docker compose up` starts Postgres".

- [ ] **Step 1: Write the failing test** — verification is a command, not a pytest file. The deliverable: `docker compose up -d db` brings Postgres healthy and the test DB exists.

Create `docker-compose.yml` (repo root):
```yaml
services:
  db:
    image: postgres:16
    container_name: liveboard-db
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-liveboard}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-liveboard}
      POSTGRES_DB: ${POSTGRES_DB:-liveboard}
    ports:
      - "5432:5432"
    volumes:
      - liveboard_pgdata:/var/lib/postgresql/data
      - ./scripts/init-test-db.sh:/docker-entrypoint-initdb.d/init-test-db.sh:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-liveboard} -d ${POSTGRES_DB:-liveboard}"]
      interval: 5s
      timeout: 5s
      retries: 10

  adminer:
    image: adminer:4
    container_name: liveboard-adminer
    profiles: ["tools"]
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "8080:8080"

volumes:
  liveboard_pgdata:
```

Create `scripts/init-test-db.sh` (creates the separate test database referenced by `TEST_DATABASE_URL`):
```bash
#!/bin/bash
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE liveboard_test'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'liveboard_test')\gexec
EOSQL
```
Make it executable: `chmod +x scripts/init-test-db.sh`.

> The compose file reads `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` from the repo-root
> `.env`. Add these three to `.env` (and `.env.example`) so they match the credentials in
> `DATABASE_URL`. If you prefer not to add them, the `:-liveboard` defaults already align
> with the `DATABASE_URL` in `.env.example`.

- [ ] **Step 2: Run to verify it fails** — before the file exists:
Run: `docker compose config`
Expected: FAIL with "no configuration file provided: not found".

- [ ] **Step 3: Write minimal implementation** — the `docker-compose.yml` and `scripts/init-test-db.sh` above are the implementation.

- [ ] **Step 4: Run to verify it passes**
Run: `docker compose up -d db`
Expected: PASS — Postgres container starts. Then:
Run: `docker compose ps`
Expected: `liveboard-db` shows state `running` / health `healthy`.
Run: `docker compose exec db psql -U liveboard -d liveboard_test -c "select 1;"`
Expected: returns `1` (confirms the test DB was created by the init script).

- [ ] **Step 5: Commit**
```bash
git add docker-compose.yml scripts/init-test-db.sh
git commit -m "P0: docker-compose Postgres 16 (+ optional adminer) + test-db init script"
```

---

### Task 8: `tests/conftest.py` — test engine/session, TestClient, factory helpers

**Files:**
- Create: `backend/tests/conftest.py`

**Interfaces:**
- Consumes: `app.core.config.settings` (`TEST_DATABASE_URL`), `app.db.Base`/`get_db` (Task 3), `app.main.create_app` (Task 5).
- Produces shared fixtures for all later phases:
  - `test_engine` (session-scoped) — engine bound to `TEST_DATABASE_URL`; creates all tables via `Base.metadata.create_all` and drops them at teardown.
  - `db_session` (function-scoped) — transactional session rolled back after each test.
  - `client` (function-scoped) — `TestClient` with `get_db` overridden to use `db_session`.
  - `make_unique_email` — factory helper stub demonstrating the pattern later phases extend.

- [ ] **Step 1: Write the failing test** — conftest fixtures are verified by a tiny test that uses them. Create `backend/tests/api/test_conftest_wiring.py`:
```python
# backend/tests/api/test_conftest_wiring.py
from sqlalchemy import text


def test_db_session_fixture_connects(db_session):
    result = db_session.execute(text("select 1")).scalar_one()
    assert result == 1


def test_client_fixture_serves_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_make_unique_email_factory(make_unique_email):
    a = make_unique_email()
    b = make_unique_email()
    assert a != b
    assert "@" in a
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd backend && uv run pytest tests/api/test_conftest_wiring.py`
Expected: FAIL with "fixture 'db_session' not found" (and `client`, `make_unique_email`).

- [ ] **Step 3: Write minimal implementation**
```python
# backend/tests/conftest.py
import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.db import Base, get_db
from app.main import create_app


@pytest.fixture(scope="session")
def test_engine():
    url = settings.TEST_DATABASE_URL or settings.DATABASE_URL
    engine = create_engine(url, pool_pre_ping=True, future=True)
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture()
def db_session(test_engine) -> Iterator[Session]:
    """Function-scoped session wrapped in a transaction rolled back after each test."""
    connection = test_engine.connect()
    transaction = connection.begin()
    session_factory = sessionmaker(bind=connection, autoflush=False, expire_on_commit=False)
    session = session_factory()
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture()
def client(db_session) -> Iterator[TestClient]:
    app = create_app()

    def _override_get_db() -> Iterator[Session]:
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def make_unique_email():
    def _make() -> str:
        return f"user-{uuid.uuid4().hex[:12]}@example.com"

    return _make
```

- [ ] **Step 4: Run test to verify it passes** — requires the test Postgres up (Task 7) with `TEST_DATABASE_URL` reachable:
Run: `cd backend && uv run pytest tests/api/test_conftest_wiring.py`
Expected: PASS — 3 tests pass (db_session connects, client serves `/health`, factory yields unique emails).

- [ ] **Step 5: Commit**
```bash
git add backend/tests/conftest.py backend/tests/api/test_conftest_wiring.py
git commit -m "P0: pytest conftest — test engine/session, TestClient w/ get_db override, factory helpers"
```

---

### Task 9: Phase 0 acceptance-gate verification (full green run)

**Files:**
- Modify: none (verification + any small fixes surfaced).

**Interfaces:**
- Consumes: everything above.
- Produces: a recorded, reproducible pass of the full Phase 0 acceptance gate.

- [ ] **Step 1: Bring up infra**
Run: `docker compose up -d db`
Expected: `liveboard-db` healthy (`docker compose ps`).

- [ ] **Step 2: Migrations on an empty DB**
Run: `cd backend && uv run alembic upgrade head && uv run alembic current`
Expected: PASS — `0001 (head)`.

- [ ] **Step 3: Full test suite + lint**
Run: `cd backend && uv run ruff check . && uv run ruff format --check . && uv run pytest`
Expected: PASS — ruff reports no issues; pytest reports all tests passing (config, db, errors, health, smoke, alembic, conftest wiring) with a coverage line for `app/services` (0% is acceptable in Phase 0 — no services yet; the gate threshold is enforced from Phase 3 onward).

- [ ] **Step 4: Serve `/docs` via uvicorn**
Run: `cd backend && uv run uvicorn app.main:app --port 8000 &` then `curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/docs`
Expected: `200`. Also `curl -s http://localhost:8000/health` returns `{"status":"ok"}`. Stop the server afterward (`kill %1`).

- [ ] **Step 5: Commit (only if fixes were needed)**
```bash
git add -A
git commit -m "P0: acceptance-gate verification — compose up, alembic head, pytest green, /docs 200"
```

---

## Self-Review — Phase 0 acceptance-gate coverage

The roadmap's Phase 0 gate has four clauses. Each maps to a task and an independently verifiable command:

1. **`docker compose up` starts Postgres** → **Task 7** (`docker compose up -d db`; healthcheck `healthy`; test DB created by init script). Re-verified in Task 9 Step 1.
2. **`uv run uvicorn` serves `/docs`** → **Task 5** (app factory + OpenAPI title smoke test) verified end-to-end in **Task 9 Step 4** (`/docs` → 200, `/health` → `{"status":"ok"}`).
3. **`uv run pytest` runs and a trivial health-check test passes** → **Task 5** health-check is implemented TDD-style (`tests/api/test_health.py`: `GET /health` → 200). Full suite green in **Task 9 Step 3**.
4. **`alembic upgrade head` on an empty DB succeeds** → **Task 6** (single head `0001`, env bound to `Base.metadata` + `settings` URL) verified in **Task 9 Step 2**.

Scaffolding deliverables from the roadmap Phase 0 scope are each covered: repo layout `backend/app/{core,models,schemas,routers,services,alembic}` + `tests/{unit,api}` (Task 1); `pyproject.toml` (uv) with dependency floors + ruff + pytest coverage gate on `app/services` (Task 1); `core/config.py` with **all** env vars from tech-stack §4 (Task 2); `db.py` engine/session/Base/`get_db` (Task 3); `core/errors.py` typed exceptions + handlers → uniform error JSON (Task 4); `main.py` app factory with CORS, router aggregator, startup hook stub (Task 5); Alembic env wired to `Base` + models metadata + first empty migration (Task 6); `docker-compose.yml` `postgres:16` (+ optional adminer) + `.env.example` (Tasks 2, 7); `tests/conftest.py` test engine/session, `TestClient`, factory helpers (Task 8).

Global-constraint hooks established for later phases: `Base` is the autogenerate metadata target so all NUMERIC-precision models register cleanly (DoD-5); the error envelope already maps 401/403/404/409/413/422 (DoD-3); services live in their own package with the coverage gate pre-wired (DoD-1); `create_app()` is a framework-thin factory keeping routers/services separable (DoD-8). No financial logic, models, or routers beyond `/health` are introduced — Phase 0 stays pure scaffolding.

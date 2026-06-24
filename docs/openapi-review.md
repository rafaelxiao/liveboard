# OpenAPI Completeness & Units Review

Regenerate with: `docker compose up -d` then `curl -sS http://localhost:8000/v1/openapi.json > docs/openapi.json`

## Endpoint inventory

| Path | Method | Status | Notes |
|---|---|---|---|
| `/v1/health` | GET | ✅ | App liveness |
| `/v1/docs` | GET | ✅ | Auto-generated Swagger UI |
| `/v1/openapi.json` | GET | ✅ | Contract export |
| `/v1/auth/register` | POST | ✅ | Phase 1 — RegisterIn → UserOut (201) |
| `/v1/auth/login` | POST | ✅ | Phase 1 — LoginIn → TokenPair (200) |
| `/v1/auth/me` | GET | ✅ | Phase 1 — Bearer → UserOut |
| `/v1/auth/refresh` | POST | ✅ | Phase 1 — RefreshIn → AccessTokenOut |
| `/v1/admin/users` | GET | ✅ | Phase 1 — Admin-only, list users |
| `/v1/admin/users/{id}/approve` | POST | ✅ | Phase 1 — Admin-only |
| `/v1/admin/users/{id}/reject` | POST | ✅ | Phase 1 — Admin-only |
| `/v1/api-keys` | POST | ✅ | Phase 1 — Create API key |
| `/v1/api-keys` | GET | ✅ | Phase 1 — List user's keys |
| `/v1/api-keys/{id}/revoke` | POST | ✅ | Phase 1 — Revoke key |
| `/v1/series` | POST | ✅ | Phase 2 — Create series (201) |
| `/v1/series` | GET | ✅ | Phase 2 — List user's series |
| `/v1/series/{id}` | GET | ✅ | Phase 2 — Series detail |
| `/v1/series/{id}/instruments` | POST | ✅ | Phase 2 — Upsert instruments |
| `/v1/series/{id}/fx-rates` | POST | ✅ | Phase 2 — Ingest FX rates |
| `/v1/series/{id}/benchmark` | POST | ✅ | Phase 2 — Ingest benchmark returns |
| `/v1/series/{id}/fills:batch` | POST | ✅ | Phase 2 — Batch fill ingestion |
| `/v1/series/{id}/fills:void` | POST | ✅ | Phase 2 — Soft-delete fills |
| `/v1/series/{id}/fund-movements` | POST | ✅ | Phase 2 — Fund movements |
| `/v1/series/{id}/metrics` | GET | ✅ | Phase 4 — Metrics envelope |
| `/v1/comparisons` | POST | ✅ | Phase 5 — Multi-series comparison |

## Units checklist

All metric fields in `MetricsEnvelope` carry a `units` entry (verified by `units_map()` in `services/metrics.py`):

| Metric | Units |
|---|---|
| `net_pnl`, `gross_pnl`, `total_fees` | `currency` |
| `avg_win`, `avg_loss`, `expectancy` | `currency` |
| `largest_win`, `largest_loss` | `currency` |
| `max_drawdown` | `currency` |
| `win_rate` | `ratio` |
| `profit_factor`, `payoff_ratio` | `ratio` |
| `calmar` | `ratio` |
| `twr` | `ratio` |
| `sharpe`, `sortino`, `volatility` | `annualized_ratio` |
| `cagr` | `annualized_ratio` |
| `trade_count` | `count` |
| `max_consec_wins`, `max_consec_losses` | `count` |
| `avg_holding_secs` | `seconds` |

## Numeric serialization

All money/qty fields: `NUMERIC(28,10)` → JSON string. All rates: `NUMERIC(28,12)` → JSON string. Verified: `price`, `qty`, `total_fee`, `multiplier`, `tick_size`, `lot_size`, `rate`, `return_pct`, `amount`, all fee components.

## Envelope shape

Matches design spec §8: `{meta, metrics{equity, drawdown, returns, risk, trade_stats, units}, flags}` with `ComparisonOut` adding `{account, strategy, symbol, per_trade}` blocks.

# OpenAPI Completeness & Units Review

Regenerate with: `docker compose up -d` then `curl -sS http://localhost:8000/openapi.json > docs/openapi.json`

## Endpoint inventory

| Path | Method | Status | Notes |
|---|---|---|---|
| `/health` | GET | ✅ | App liveness |
| `/docs` | GET | ✅ | Auto-generated Swagger UI |
| `/openapi.json` | GET | ✅ | Contract export |
| `/auth/register` | POST | ✅ | Phase 1 — RegisterIn → UserOut (201) |
| `/auth/login` | POST | ✅ | Phase 1 — LoginIn → TokenPair (200) |
| `/auth/me` | GET | ✅ | Phase 1 — Bearer → UserOut |
| `/auth/refresh` | POST | ✅ | Phase 1 — RefreshIn → AccessTokenOut |
| `/admin/users` | GET | ✅ | Phase 1 — Admin-only, list users |
| `/admin/users/{id}/approve` | POST | ✅ | Phase 1 — Admin-only |
| `/admin/users/{id}/reject` | POST | ✅ | Phase 1 — Admin-only |
| `/api-keys` | POST | ✅ | Phase 1 — Create API key |
| `/api-keys` | GET | ✅ | Phase 1 — List user's keys |
| `/api-keys/{id}/revoke` | POST | ✅ | Phase 1 — Revoke key |
| `/series` | POST | ✅ | Phase 2 — Create series (201) |
| `/series` | GET | ✅ | Phase 2 — List user's series |
| `/series/{id}` | GET | ✅ | Phase 2 — Series detail |
| `/series/{id}/instruments` | POST | ✅ | Phase 2 — Upsert instruments |
| `/series/{id}/fx-rates` | POST | ✅ | Phase 2 — Ingest FX rates |
| `/series/{id}/benchmark` | POST | ✅ | Phase 2 — Ingest benchmark returns |
| `/series/{id}/fills:batch` | POST | ✅ | Phase 2 — Batch fill ingestion |
| `/series/{id}/fills:void` | POST | ✅ | Phase 2 — Soft-delete fills |
| `/series/{id}/fund-movements` | POST | ✅ | Phase 2 — Fund movements |
| `/series/{id}/metrics` | GET | ✅ | Phase 4 — Metrics envelope |
| `/comparisons` | POST | ✅ | Phase 5 — Multi-series comparison |

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

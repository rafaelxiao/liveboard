# LiveBoard — Agent Rules

## Dev vs Prod

| | Production | Dev |
|---|---|---|
| URL | `/liveboard/` | `/liveboard/dev/` |
| Backend | `:8002` | `:8003` |
| Frontend | `dist/` (static) | Vite `:5175` (HMR) |
| Database | shared | shared |

```bash
bash scripts/start.sh    # production
bash scripts/dev.sh      # development (HMR)
```

## Frontend changes

Always run `npm run build` after changing frontend code — nginx serves from `dist/`, not Vite.

```bash
cd frontend && npm run build
```

## Pushing to GitHub

GitHub is intermittently blocked from mainland China. Use the retry script:

```bash
bash scripts/push.sh "commit message"   # commit + push
bash scripts/push.sh                     # push only
```

Token is embedded in `git remote origin URL` — no credential helper needed.

## i18n

All user-facing strings use `react-i18next` with `useTranslation("namespace")`. Namespaces:
- `common`, `auth`, `dashboard`, `compare`, `settings`, `docs`, `share`

When adding strings:
1. Add keys to `frontend/src/i18n/locales/en/` and `zh/`
2. Use `t("key")` in components

## metricColor

Uses translation keys (not translated labels) for locale-safe color coding:
```tsx
["netPnl", t("netPnl"), value, "pnl"]  // [colorKey, label, value, format]
```

## Nginx

Live config at `/etc/nginx/conf.d/sites.conf`. Template at `liveboard.nginx.conf`.
Reload after changes: `sudo nginx -s reload`

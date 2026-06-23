#!/usr/bin/env bash
# End-to-end smoke check: register → login → health → docs.
# Run after `docker compose up -d` with the full stack healthy.
set -euo pipefail

BASE="${1:-http://localhost:5173}"
API="${BASE}/api"

echo "=== Health check ==="
curl -fsS "${API}/health" | python3 -m json.tool

echo "=== OpenAPI docs ==="
curl -fsS "${API}/openapi.json" -o /dev/null && echo "openapi.json OK"

echo "=== Register test user ==="
REG=$(curl -sS -X POST "${API}/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@example.com","password":"smoke12345"}')
echo "$REG" | python3 -m json.tool

echo "=== Login as admin ==="
LOGIN=$(curl -sS -X POST "${API}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"change-me"}')
echo "$LOGIN" | python3 -m json.tool
ACCESS=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "=== Approve smoke user ==="
curl -sS -X GET "${API}/admin/users" \
  -H "Authorization: Bearer ${ACCESS}" | python3 -c "
import sys, json
users = json.load(sys.stdin)
smoke = [u for u in users if u['email'] == 'smoke@example.com']
if smoke:
    print('found smoke user id:', smoke[0]['id'])
else:
    sys.exit(1)
"

echo ""
echo "=== PASS: all smoke checks OK ==="

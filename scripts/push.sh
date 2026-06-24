#!/usr/bin/env bash
# Push to GitHub from mainland China — retries until it connects.
# Usage:
#   bash scripts/push.sh "commit message"   # add all, commit, push
#   bash scripts/push.sh                     # push only (no commit)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ $# -gt 0 ]; then
  echo "Committing: $1"
  git add -A
  git commit -m "$1" || echo "(nothing to commit)"
fi

for i in $(seq 1 20); do
  echo "[$i] pushing..."
  if timeout 30 git push origin main 2>&1; then
    echo "OK"
    exit 0
  fi
  echo "retry in 3s..."
  sleep 3
done
echo "FAILED after 20 attempts"
exit 1

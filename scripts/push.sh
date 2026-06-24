#!/usr/bin/env bash
# Push to GitHub from mainland China — retries until it connects.
# Token is embedded in git remote URL; just keep retrying.
set -euo pipefail
cd "$(dirname "$0")/.."
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

#!/usr/bin/env bash
# Container health check: Juno proxy must answer /api/health.
set -e
curl -fsS "http://127.0.0.1:${JUNO_WEB_PORT:-3000}/api/health" > /dev/null

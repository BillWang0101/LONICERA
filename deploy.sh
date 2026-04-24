#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

APP_VERSION="$(git rev-parse --short HEAD 2>/dev/null || echo local)"
export APP_VERSION

git pull --ff-only
APP_VERSION="$(git rev-parse --short HEAD 2>/dev/null || echo "$APP_VERSION")"
export APP_VERSION

docker compose up -d --build
docker compose ps

echo "deployed version: $APP_VERSION"

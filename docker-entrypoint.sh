#!/bin/sh
set -e

echo "Running database migrations..."
/nakama/nakama migrate up \
  --database.address "$NAKAMA_DATABASE_ADDRESS"

echo "Starting Nakama server..."
exec /nakama/nakama \
  --config /nakama/data/production.yml \
  --database.address "$NAKAMA_DATABASE_ADDRESS" \
  --console.password "$NAKAMA_CONSOLE_PASSWORD" \
  --console.signing_key "$NAKAMA_CONSOLE_SIGNING_KEY" \
  --session.encryption_key "$NAKAMA_SESSION_ENCRYPTION_KEY" \
  --session.refresh_encryption_key "$NAKAMA_SESSION_REFRESH_ENCRYPTION_KEY"

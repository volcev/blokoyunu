#!/usr/bin/env bash
set -euo pipefail

# Local daily backup (no cloud). Packs backend/volchain and writes metadata.
# Env (optional):
#  VOLCHAIN_ENV=prod|staging (default: prod)
#  VOLCHAIN_RPC=http://127.0.0.1:3001
#  VOLCHAIN_BACKUP_DIR=/var/backups/volchain
#  VOLCHAIN_BACKUP_RETENTION_DAYS=30

ENV_NAME="${VOLCHAIN_ENV:-prod}"
RPC="${VOLCHAIN_RPC:-http://127.0.0.1:3001}"
BACKUP_DIR="${VOLCHAIN_BACKUP_DIR:-/var/backups/volchain}"
RETENTION_DAYS="${VOLCHAIN_BACKUP_RETENTION_DAYS:-30}"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$ROOT_DIR/volchain"

TS_UTC=$(date -u +%Y%m%d-%H%M)
YEAR=$(date -u +%Y)
MON=$(date -u +%m)
DAY=$(date -u +%d)
HMS=$(date -u +%H%M)
HOSTNAME_FQDN=$(hostname -f 2>/dev/null || hostname)
CHAIN_ID="volchain-main"

mkdir -p "$BACKUP_DIR/$ENV_NAME/$YEAR/$MON/$DAY/$HMS"

echo "[local-backup] ENV=$ENV_NAME RPC=$RPC DIR=$BACKUP_DIR"

# Verify must be green
VERIFY_JSON=$(curl -fsS "$RPC/volchain/verify") || { echo "[local-backup] verify request failed" >&2; exit 1; }
OK=$(echo "$VERIFY_JSON" | jq -r .ok 2>/dev/null || echo false)
if [[ "$OK" != "true" ]]; then
  echo "[local-backup] verify not ok: $VERIFY_JSON" >&2
  exit 1
fi

# Head for metadata
HEAD_JSON=$(curl -fsS "$RPC/volchain/head")
HEIGHT=$(echo "$HEAD_JSON" | jq -r .height)
APPHASH=$(echo "$HEAD_JSON" | jq -r .appHash)

DEST_DIR="$BACKUP_DIR/$ENV_NAME/$YEAR/$MON/$DAY/$HMS"
ARCHIVE="$DEST_DIR/volchain-$TS_UTC-$HOSTNAME_FQDN-h${HEIGHT}-${APPHASH}.tar.gz"
META="$DEST_DIR/volchain-$TS_UTC-metadata.json"

echo "[local-backup] packing $DATA_DIR -> $ARCHIVE"
tar -czf "$ARCHIVE" -C "$ROOT_DIR" "$(basename "$DATA_DIR")"

echo "[local-backup] writing metadata -> $META"
jq -n \
  --arg chain_id "$CHAIN_ID" \
  --arg env "$ENV_NAME" \
  --arg host "$HOSTNAME_FQDN" \
  --arg appHash "$APPHASH" \
  --argjson height "$HEIGHT" \
  --arg ts "$(date -u +%FT%TZ)" \
  '{chain_id:$chain_id, env:$env, host:$host, appHash:$appHash, height:$height, time:$ts}' > "$META"

# Retention cleanup
if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "[local-backup] retention: deleting files older than $RETENTION_DAYS days"
  find "$BACKUP_DIR/$ENV_NAME" -type f -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
  # remove empty directories
  find "$BACKUP_DIR/$ENV_NAME" -type d -empty -delete 2>/dev/null || true
fi

echo "[local-backup] DONE -> $DEST_DIR"




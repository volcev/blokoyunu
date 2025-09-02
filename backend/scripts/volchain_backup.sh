#!/usr/bin/env bash
set -euo pipefail

# Volchain daily backup script
# Requires: curl, jq, awscli

ENV_NAME="${VOLCHAIN_ENV:-prod}"
RPC="${VOLCHAIN_RPC:-http://127.0.0.1:3001}"
BUCKET="${VOLCHAIN_BACKUP_BUCKET:-volchain-backups}"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$ROOT_DIR/volchain"

TS_UTC=$(date -u +%Y%m%d-%H%M)
YEAR=$(date -u +%Y)
MON=$(date -u +%m)
DAY=$(date -u +%d)
HMS=$(date -u +%H%M)
HOSTNAME_FQDN=$(hostname -f 2>/dev/null || hostname)

echo "[backup] ENV=$ENV_NAME RPC=$RPC BUCKET=$BUCKET"

# 1) Verify must be green
VERIFY_JSON=$(curl -fsS "$RPC/volchain/verify") || { echo "[backup] verify request failed" >&2; exit 1; }
OK=$(echo "$VERIFY_JSON" | jq -r .ok 2>/dev/null || echo false)
if [[ "$OK" != "true" ]]; then
  echo "[backup] verify not ok: $VERIFY_JSON" >&2
  exit 1
fi

# 2) Read head for metadata
HEAD_JSON=$(curl -fsS "$RPC/volchain/head")
HEIGHT=$(echo "$HEAD_JSON" | jq -r .height)
APPHASH=$(echo "$HEAD_JSON" | jq -r .appHash)
CHAIN_ID="volchain-main"

PREFIX="s3://$BUCKET/$ENV_NAME/$YEAR/$MON/$DAY/$HMS"
ARCHIVE="/tmp/volchain-$TS_UTC-$HOSTNAME_FQDN-h${HEIGHT}-${APPHASH}.tar.gz"
META="/tmp/volchain-$TS_UTC-metadata.json"

echo "[backup] packing $DATA_DIR -> $ARCHIVE"
tar -czf "$ARCHIVE" -C "$ROOT_DIR" "$(basename "$DATA_DIR")"

echo "[backup] writing metadata -> $META"
jq -n \
  --arg chain_id "$CHAIN_ID" \
  --arg env "$ENV_NAME" \
  --arg host "$HOSTNAME_FQDN" \
  --arg appHash "$APPHASH" \
  --argjson height "$HEIGHT" \
  --arg ts "$(date -u +%FT%TZ)" \
  '{chain_id:$chain_id, env:$env, host:$host, appHash:$appHash, height:$height, time:$ts}' > "$META"

echo "[backup] uploading to $PREFIX (SSE-S3)"
aws s3 cp "$ARCHIVE" "$PREFIX/" --sse AES256 \
  --metadata "chain_id=$CHAIN_ID,env=$ENV_NAME,host=$HOSTNAME_FQDN,appHash=$APPHASH,height=$HEIGHT" \
  --only-show-errors
aws s3 cp "$META" "$PREFIX/" --sse AES256 --content-type application/json \
  --metadata "chain_id=$CHAIN_ID,env=$ENV_NAME,host=$HOSTNAME_FQDN,appHash=$APPHASH,height=$HEIGHT" \
  --only-show-errors

# Tagging for visibility (optional)
OBJ_KEY_ARCHIVE="$ENV_NAME/$YEAR/$MON/$DAY/$HMS/$(basename "$ARCHIVE")"
OBJ_KEY_META="$ENV_NAME/$YEAR/$MON/$DAY/$HMS/$(basename "$META")"
aws s3api put-object-tagging --bucket "$BUCKET" --key "$OBJ_KEY_ARCHIVE" \
  --tagging "TagSet=[{Key=chain_id,Value=$CHAIN_ID},{Key=env,Value=$ENV_NAME},{Key=host,Value=$HOSTNAME_FQDN},{Key=appHash,Value=$APPHASH},{Key=height,Value=$HEIGHT}]" >/dev/null 2>&1 || true
aws s3api put-object-tagging --bucket "$BUCKET" --key "$OBJ_KEY_META" \
  --tagging "TagSet=[{Key=chain_id,Value=$CHAIN_ID},{Key=env,Value=$ENV_NAME},{Key=host,Value=$HOSTNAME_FQDN},{Key=appHash,Value=$APPHASH},{Key=height,Value=$HEIGHT}]" >/dev/null 2>&1 || true

echo "[backup] DONE -> $PREFIX"




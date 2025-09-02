# Volchain Backup & DR Runbook

## Scope
- Backup contents:
  - backend/volchain/snapshot.json
  - backend/volchain/blocks/
  - (optional) backend/volchain/blocks.log, backend/volchain/mempool.jsonl
- S3 layout: s3://volchain-backups/{env}/YYYY/MM/DD/HHMM/
- Metadata/Tags: chain_id, env, host, appHash, height
- Encryption: SSE-S3 (optionally KMS)
- Retention: 30–90 days (configure S3 lifecycle)

## Prerequisites
- AWS CLI configured (aws configure)
- Environment:
  - VOLCHAIN_ENV=prod|staging
  - VOLCHAIN_RPC=http://127.0.0.1:3001
  - VOLCHAIN_BACKUP_BUCKET=volchain-backups

## Daily Backup (03:00 UTC)
1) Ensure verify is green (script does it):
   - Calls /volchain/verify, must be { ok: true }
2) Packs backend/volchain into tar.gz and writes metadata JSON (height, appHash)
3) Uploads both to S3 path with SSE-S3 and tags

Manual run:
```bash
cd backend/scripts
VOLCHAIN_ENV=prod VOLCHAIN_BACKUP_BUCKET=volchain-backups ./volchain_backup.sh
```
Crontab (run as service user):
```cron
0 3 * * * cd /home/volcev/blokoyunu/backend/scripts && VOLCHAIN_ENV=prod VOLCHAIN_BACKUP_BUCKET=volchain-backups ./volchain_backup.sh >> /var/log/volchain_backup.log 2>&1
```

## Disaster Recovery (DR) Drill
Goal: Restore from S3 and confirm replay produces the same appHash and height.

1) Pick a backup (e.g., last 7 days) and download:
```bash
AWS_BUCKET=volchain-backups
ENV=prod
P=2025/08/23/0310
mkdir -p /tmp/dr && cd /tmp/dr
aws s3 cp s3:///// . --recursive
```
2) Inspect metadata:
```bash
META=
cat "" | jq
# capture appHash and height
```
3) Extract archive to a new directory:
```bash
ARCH=
mkdir -p ./restore
tar -xzf "" -C ./restore
ls ./restore/volchain
```
4) Point a test instance to restored data dir or copy over, then start producer and replay (existing binary):
   - Start backend (it will read snapshot.json);
   - Use /volchain/verify to ensure { ok: true }.

5) Compare head:
```bash
curl -sS http://127.0.0.1:3001/volchain/head | jq
# Ensure height & appHash match metadata
```
6) Record drill:
```json
{ "date": "2025-08-23T04:20Z", "duration": "6m30s", "height": 1234, "appHash": "...", "result": "PASS" }
```

## Notes
- Lifecycle/Retention: configure on the S3 bucket (30–90 days, then Glacier or delete)
- KMS: if using SSE-KMS, export AWS_DEFAULT_REGION and --sse aws:kms --sse-kms-key-id <KEY>
- Backups are safe to take while chain is active; verify ensures a consistent snapshot prior to upload.

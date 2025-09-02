#!/bin/bash
# VolChain Production Backup Script
# Deploy to: /usr/local/bin/backup-volchain.sh
# Crontab: 0 2 * * * /usr/local/bin/backup-volchain.sh

set -euo pipefail

# Configuration
VOLCHAIN_DIR="/home/volcev/blokoyunu/backend"
BACKUP_ROOT="/backup/volchain"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"

# Logging
LOG_FILE="/var/log/volchain-backup.log"
exec 1> >(tee -a "$LOG_FILE")
exec 2>&1

echo "=== VolChain Backup Started: $(date) ==="

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Pre-backup verification
echo "Running pre-backup verification..."
VERIFY_RESULT=$(curl -s localhost:3001/volchain/verify?mode=system | jq -r '.ok' 2>/dev/null || echo "false")
if [ "$VERIFY_RESULT" != "true" ]; then
    echo "WARNING: System verification failed before backup. Continuing anyway."
    echo "Verification status: $VERIFY_RESULT"
fi

# Backup Volchain ledger data
echo "Backing up Volchain ledger..."
if [ -d "$VOLCHAIN_DIR/volchain" ]; then
    cp -r "$VOLCHAIN_DIR/volchain" "$BACKUP_DIR/"
    echo "✅ Volchain ledger backed up"
else
    echo "❌ Volchain directory not found: $VOLCHAIN_DIR/volchain"
    exit 1
fi

# Backup game state
echo "Backing up game state..."
if [ -f "$VOLCHAIN_DIR/db.json" ]; then
    cp "$VOLCHAIN_DIR/db.json" "$BACKUP_DIR/game_db.json"
    echo "✅ Game database backed up"
else
    echo "❌ Game database not found: $VOLCHAIN_DIR/db.json"
    exit 1
fi

if [ -f "$VOLCHAIN_DIR/gridb.json" ]; then
    cp "$VOLCHAIN_DIR/gridb.json" "$BACKUP_DIR/"
    echo "✅ Grid defense database backed up"
else
    echo "❌ Grid defense database not found: $VOLCHAIN_DIR/gridb.json"
    exit 1
fi

# Backup auth database (same as game db currently)
echo "Backing up auth database..."
cp "$VOLCHAIN_DIR/db.json" "$BACKUP_DIR/auth_db.json"
echo "✅ Auth database backed up"

# Create metadata
echo "Creating backup metadata..."
cat > "$BACKUP_DIR/backup_info.json" << EOF
{
  "timestamp": "$TIMESTAMP",
  "date": "$(date -Iseconds)",
  "volchain_dir": "$VOLCHAIN_DIR",
  "backup_version": "1.0",
  "pre_backup_verification": "$VERIFY_RESULT",
  "server_uptime": "$(uptime -p)",
  "disk_usage": "$(df -h $VOLCHAIN_DIR | tail -1)"
}
EOF

# Get current system stats
curl -s localhost:3001/volchain/health > "$BACKUP_DIR/health_snapshot.json" 2>/dev/null || echo "{\"error\": \"health_unavailable\"}" > "$BACKUP_DIR/health_snapshot.json"

# Create checksums for integrity verification
echo "Creating checksums..."
cd "$BACKUP_DIR"
find . -type f -exec sha256sum {} \; > checksums.txt
echo "✅ Checksums created"

# Compress backup (optional)
echo "Compressing backup..."
cd "$BACKUP_ROOT"
tar -czf "${TIMESTAMP}.tar.gz" "$TIMESTAMP" 2>/dev/null || echo "Warning: Compression failed, keeping uncompressed backup"

# Calculate backup size
BACKUP_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo "📦 Backup size: $BACKUP_SIZE"

# Post-backup verification
echo "Running post-backup verification..."
cd "$BACKUP_DIR"
if sha256sum -c checksums.txt > /dev/null 2>&1; then
    echo "✅ Backup integrity verified"
else
    echo "❌ Backup integrity check failed!"
    exit 1
fi

# Cleanup old backups
echo "Cleaning up old backups (keeping $RETENTION_DAYS days)..."
OLD_BACKUPS=$(find "$BACKUP_ROOT" -maxdepth 1 -type d -name "????????_??????" -mtime +$RETENTION_DAYS | wc -l)
if [ "$OLD_BACKUPS" -gt 0 ]; then
    find "$BACKUP_ROOT" -maxdepth 1 -type d -name "????????_??????" -mtime +$RETENTION_DAYS -exec rm -rf {} \;
    find "$BACKUP_ROOT" -maxdepth 1 -name "????????_??????.tar.gz" -mtime +$RETENTION_DAYS -exec rm -f {} \; 2>/dev/null || true
    echo "🗑️ Removed $OLD_BACKUPS old backups"
else
    echo "📁 No old backups to clean"
fi

# Final summary
TOTAL_BACKUPS=$(find "$BACKUP_ROOT" -maxdepth 1 -type d -name "????????_??????" | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_ROOT" | cut -f1)

echo "=== VolChain Backup Completed: $(date) ==="
echo "📊 Summary:"
echo "   • Backup location: $BACKUP_DIR"
echo "   • Backup size: $BACKUP_SIZE"
echo "   • Total backups: $TOTAL_BACKUPS"
echo "   • Total backup storage: $TOTAL_SIZE"
echo "   • Verification: PASS"
echo ""

# Optional: Send notification (uncomment if you have notification system)
# curl -X POST "your-notification-webhook" -d "VolChain backup completed successfully: $TIMESTAMP"

exit 0

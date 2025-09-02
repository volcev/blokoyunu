# VolChain Production Runbook

## 🚨 Emergency Response Procedures

### Critical Principles
1. **NEVER directly edit files** - All fixes must go through ledger-first flow
2. **Every mutation follows**: `ledger-first → sealed → applied → commit → guard → rollback on fail`
3. **In doubt, verify first**: Always check `/volchain/verify?mode=system` before taking action

---

## 🔍 Verification Failure

**Alert**: `VolchainSystemVerificationFailed`
**Severity**: Warning

### Immediate Response
```bash
# 1. Check verification details
curl -s localhost:3001/volchain/verify?mode=system | jq

# 2. Check specific failure type
curl -s localhost:3001/volchain/verify?mode=system | jq '.system.details'

# 3. Check if it's a crossOk failure (most common)
curl -s localhost:3001/volchain/verify?mode=system | jq '.system.crossOk'
```

### Resolution Steps

#### If `crossOk: false` (Chain vs Game mismatch)
```bash
# Force reconcile stakes to match game state
curl -X POST localhost:3001/admin/volchain-reconcile-stake-from-gridb \
  -H "X-Admin-Secret: $VOLCHAIN_ADMIN_SECRET"

# Wait 30 seconds and re-verify
sleep 30
curl -s localhost:3001/volchain/verify?mode=system | jq '.ok'
```

#### If `chainOk: false` (Internal chain inconsistency)
```bash
# This is rare - check mempool and recent transactions
curl -s localhost:3001/volchain/health | jq '{mempoolSize, lastBlockAge: .last_block_age_seconds}'

# If mempool is stuck, restart producer (requires manual intervention)
# Contact system administrator
```

### Recovery Verification
```bash
# Confirm all checks pass
curl -s localhost:3001/volchain/verify | jq '.ok'  # blocks
curl -s localhost:3001/volchain/verify?mode=system | jq '.ok'  # system
```

---

## ⏰ Stale Blocks

**Alert**: `VolchainBlocksStale`
**Severity**: Critical

### Immediate Response
```bash
# Check current block age
curl -s localhost:3001/volchain/health | jq '.last_block_age_seconds'

# Check mempool size (should be processing)
curl -s localhost:3001/volchain/health | jq '.mempoolSize'

# Check producer uptime
curl -s localhost:3001/volchain/health | jq '.producerUptime'
```

### Resolution Steps

#### If mempool has pending transactions but no new blocks
```bash
# Restart the backend service (last resort)
sudo systemctl restart volchain-backend

# Wait for service to come up
sleep 10

# Verify producer is working
curl -s localhost:3001/volchain/health | jq '{lastBlockAge: .last_block_age_seconds, mempoolSize}'
```

#### If mempool is empty but blocks still stale
```bash
# This indicates no new transactions - check if system is idle
# Monitor for 5 minutes to see if new transactions arrive
```

---

## ⚡ Barrier Timeouts

**Alert**: `VolchainBarrierTimeouts` 
**Severity**: Warning

### Immediate Response
```bash
# Check barrier metrics
curl -s localhost:3001/volchain/health | jq '{
  barrier_timeouts: .volchain_barrier_timeouts_total,
  barrier_wait_total: .volchain_barrier_wait_ms_total
}'

# Check current system load
curl -s localhost:3001/volchain/health | jq '.mempoolSize'
```

### Resolution Steps

#### If timeouts are increasing rapidly
```bash
# Check if producer is overwhelmed
# Consider increasing barrier timeouts temporarily
export VOLCHAIN_BARRIER_TIMEOUT_MS=10000  # Increase to 10 seconds
systemctl restart volchain-backend
```

#### If timeouts persist
```bash
# Check if there's a deadlock in transaction processing
# Review recent logs for stuck transactions
tail -100 /var/log/volchain/backend.log | grep -i timeout
```

---

## 👥 User Mismatches

**Alert**: `VolchainUserMismatches`
**Severity**: Warning

### Immediate Response
```bash
# Get detailed user mismatch report
curl -s localhost:3001/volchain/verify?mode=system | jq '.users.mismatches[] | select(.username != null)'
```

### Resolution Steps

#### For individual user mismatches
```bash
# DO NOT directly edit user data
# Use reconcile endpoint to fix via ledger-first approach
curl -X POST localhost:3001/admin/volchain-reconcile-stake-from-gridb \
  -H "X-Admin-Secret: $VOLCHAIN_ADMIN_SECRET"

# Verify fix
curl -s localhost:3001/volchain/verify?mode=system | jq '.users.ok'
```

---

## 📊 Mempool Overload

**Alert**: `VolchainMempoolOverload`
**Severity**: Warning

### Immediate Response
```bash
# Check mempool details
curl -s localhost:3001/volchain/health | jq '{
  mempoolSize,
  producerUptime,
  lastBlockAge: .last_block_age_seconds
}'
```

### Resolution Steps
```bash
# Temporarily reduce transaction rate if possible
# Monitor if mempool drains naturally
# If not draining, restart producer
sudo systemctl restart volchain-backend
```

---

## 🔧 Service Down

**Alert**: `VolchainServiceDown`
**Severity**: Critical

### Immediate Response
```bash
# Check service status
sudo systemctl status volchain-backend

# Check logs for errors
sudo journalctl -u volchain-backend -n 50

# Restart service
sudo systemctl restart volchain-backend

# Verify health
sleep 10
curl -f localhost:3001/volchain/health
```

---

## 📋 Daily Backup Procedures

### Manual Backup (Run Daily)
```bash
#!/bin/bash
# backup-volchain.sh

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backup/volchain/$TIMESTAMP"

mkdir -p "$BACKUP_DIR"

# Backup Volchain data
cp -r /home/volcev/blokoyunu/backend/volchain "$BACKUP_DIR/"

# Backup game state 
cp /home/volcev/blokoyunu/backend/db.json "$BACKUP_DIR/"
cp /home/volcev/blokoyunu/backend/gridb.json "$BACKUP_DIR/"

# Backup auth database
cp /home/volcev/blokoyunu/backend/db.json "$BACKUP_DIR/auth_db.json"

# Create checksum
cd "$BACKUP_DIR"
find . -type f -exec sha256sum {} \; > checksums.txt

echo "Backup completed: $BACKUP_DIR"

# Cleanup old backups (keep 30 days)
find /backup/volchain -type d -mtime +30 -exec rm -rf {} \; 2>/dev/null
```

### Recovery from Backup
```bash
# NEVER restore without verification
# 1. Stop service
sudo systemctl stop volchain-backend

# 2. Restore files
RESTORE_DIR="/backup/volchain/20241225_120000"  # Use specific backup
cp -r "$RESTORE_DIR/volchain" /home/volcev/blokoyunu/backend/
cp "$RESTORE_DIR/db.json" /home/volcev/blokoyunu/backend/
cp "$RESTORE_DIR/gridb.json" /home/volcev/blokoyunu/backend/

# 3. Verify checksums
cd "$RESTORE_DIR"
sha256sum -c checksums.txt

# 4. Start service and verify
sudo systemctl start volchain-backend
sleep 10
curl -s localhost:3001/volchain/verify?mode=system | jq '.ok'
```

---

## ⚠️ FORBIDDEN ACTIONS

### ❌ NEVER DO THESE:
1. **Direct file editing**: `vim db.json` or `vim volchain/snapshot.json`
2. **Manual balance changes**: Never manually modify balances
3. **Bypass guards**: Never skip verification after changes
4. **Force overrides**: Never use emergency flags without admin secret

### ✅ ALWAYS DO THESE:
1. **Use admin endpoints**: All fixes via REST API
2. **Verify after changes**: Always check `/volchain/verify`
3. **Backup before major changes**: Create checkpoint
4. **Follow ledger-first**: Every mutation must go through proper flow

---

## 📞 Escalation Matrix

| Severity | Response Time | Contact |
|----------|---------------|---------|
| Critical | 15 minutes | On-call engineer + Team lead |
| Warning | 2 hours | Team slack channel |
| Info | Next business day | Create ticket |

### Contact Information
- **On-call**: [Your alerting system]
- **Team Slack**: #volchain-alerts
- **Documentation**: https://github.com/yourorg/blokoyunu/backend/

---

## 🔍 Health Check Commands

```bash
# Quick health check
curl -s localhost:3001/volchain/health | jq '{
  ok: true,
  lastBlockAge: .last_block_age_seconds,
  mempool: .mempoolSize,
  timeouts: .volchain_barrier_timeouts_total
}'

# Full verification suite
echo "=== BLOCKS VERIFICATION ==="
curl -s localhost:3001/volchain/verify | jq

echo "=== SYSTEM VERIFICATION ==="  
curl -s localhost:3001/volchain/verify?mode=system | jq

echo "=== METRICS ==="
curl -s localhost:3001/volchain/health | jq '{
  barriers: {
    timeouts: .volchain_barrier_timeouts_total,
    wait_total: .volchain_barrier_wait_ms_total
  },
  invariants: {
    user_mismatches: .volchain_invariant_user_mismatch_total,
    system_mismatches: .volchain_invariant_system_mismatch_total
  }
}'
```

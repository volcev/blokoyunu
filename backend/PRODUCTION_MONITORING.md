# Production Monitoring & Alerts

## Forever-Guard Protection System

This document outlines the comprehensive monitoring and protection system for VolChain production environment. The system ensures no one can break the core invariants through:

1. **CI Gate**: Required checks on every PR/commit
2. **Real-time Alerts**: Prometheus monitoring with escalation
3. **Operational Runbook**: Step-by-step recovery procedures

## CI/CD Protection

### Required CI Checks
Every pull request must pass:
- ✅ Unit tests (key resolver, prevalidation, barriers)
- ✅ Integration tests (ledger-first flow, verification endpoints)
- ✅ Security tests (faucet disabled, admin endpoints protected)
- ✅ Production readiness (no test artifacts, monitoring files present)

**CI Configuration**: `.github/workflows/ci-gate.yml`

## Volchain Health Metrics

Access via: `GET /volchain/health`

### Production Prometheus Alerts

**Full Alert Rules**: `backend/prometheus-alerts.yml`

```yaml
# Critical Alerts (Deploy to Prometheus /etc/prometheus/rules/)

groups:
  - name: volchain.critical
    rules:
      - alert: VolchainSystemVerificationFailed
        expr: volchain_verify_total{status="fail"} > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "VolChain system verification failed"
          description: "System invariant verification failing for 5+ minutes"
          runbook_url: "backend/RUNBOOK.md#verification-failure"

      - alert: VolchainBlocksStale
        expr: volchain_last_block_age_seconds > 60
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "VolChain blocks are stale" 
          description: "Last block is {{ $value }} seconds old"
          runbook_url: "backend/RUNBOOK.md#stale-blocks"

      - alert: VolchainBarrierTimeouts
        expr: increase(volchain_barrier_timeouts_total[5m]) > 0
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "VolChain barrier timeouts detected"
          description: "{{ $value }} barrier timeouts in last 5 minutes"
          runbook_url: "backend/RUNBOOK.md#barrier-timeouts"
```

## Environment Variables

```bash
# Barrier configuration
VOLCHAIN_BARRIER_TIMEOUT_MS=5000    # Default: 5 seconds
VOLCHAIN_BARRIER_POLL_MS=50         # Default: 50ms polling

# Chain ID enforcement
CHAIN_ID=volchain-main              # Required for all mutations

# Data paths
GAME_DB_PATH=/home/volcev/blokoyunu/backend/db.json
VOLCHAIN_DIR=/home/volcev/blokoyunu/backend/volchain
```

## Health Check Endpoints

1. **System Health**: `GET /volchain/health`
2. **Verification**: `GET /volchain/verify?mode=system`
3. **Block Verification**: `GET /volchain/verify?mode=blocks`

## Security Requirements

All mutation endpoints now require:
- `X-Op-Id` header (idempotency)
- `X-Chain-Id` header validation (if provided)
- `resolveAnyToHex64` key normalization

## Ledger-First Guarantees

- `PATCH /grid/:index` (dig) ✅
- `POST /volchain/transfer` ✅
- `PATCH /gridb/:index` (stake/attack)
- `POST /gridb/:index/unstake`
- `DELETE /gridb/:index`

All mutations follow: **ledger-first → sealed → applied → commit → guard**

## Operational Runbook

**Detailed Recovery Procedures**: `backend/RUNBOOK.md`

### Quick Reference
- **Verification Failure**: Use reconcile endpoint with admin secret
- **Stale Blocks**: Check mempool, restart producer if needed  
- **Barrier Timeouts**: Monitor load, increase timeout if overloaded
- **User Mismatches**: Run stake reconciliation via admin endpoint

### Emergency Contacts
- **Critical Issues**: 15-minute response time
- **Escalation**: On-call engineer + team lead
- **Documentation**: GitHub repository + RUNBOOK.md

## Deployment Checklist

### Prometheus Setup
```bash
# 1. Deploy alert rules
sudo cp backend/prometheus-alerts.yml /etc/prometheus/rules/

# 2. Update prometheus.yml
# Add volchain job to scrape_configs:
# - job_name: 'volchain'
#   static_configs:
#     - targets: ['localhost:3001']  
#   metrics_path: '/volchain/health'
#   scrape_interval: 30s

# 3. Reload Prometheus
sudo systemctl reload prometheus
```

### CI/CD Setup
```bash
# 1. Ensure GitHub Actions is enabled
# 2. Verify .github/workflows/ci-gate.yml is in repository
# 3. Set branch protection rules requiring CI checks
# 4. Test with sample PR
```

### Backup Automation
```bash
# 1. Deploy daily backup script to /usr/local/bin/backup-volchain.sh
# 2. Add to crontab:
#    0 2 * * * /usr/local/bin/backup-volchain.sh
# 3. Test backup and recovery procedures
```

## Forever-Guard Guarantees

✅ **Invariant Protection**: `balance = mined = used + available` enforced at all levels  
✅ **Ledger-First Flow**: All mutations require sealed barrier before commit  
✅ **Automatic Rollback**: Guard failures trigger immediate state rollback  
✅ **CI Prevention**: Invalid changes blocked at commit time  
✅ **Real-time Monitoring**: Prometheus alerts on any invariant violation  
✅ **Recovery Procedures**: Step-by-step runbook for all failure scenarios  

**Result**: No one can break the core VolChain invariants - protected by code, tests, monitoring, and procedures.

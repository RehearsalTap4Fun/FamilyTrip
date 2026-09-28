#!/usr/bin/env bash
# 同路 · 每日备份同步数据（都是密文），保留 14 天。crontab（admin）: 40 3 * * * /opt/trip/backup-sync.sh
set -e
DST=/var/lib/trip/backup/$(date +%F)
mkdir -p "$DST"
cp -a /var/lib/trip/sync/*.json "$DST"/ 2>/dev/null || true
find /var/lib/trip/backup -maxdepth 1 -mindepth 1 -type d -mtime +14 -exec rm -rf {} +

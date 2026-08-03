#!/usr/bin/env bash
# Mission-data backup script — run any time: bash scripts/backup-missions.sh
# Creates dated SQL + CSV backups of mission/task tables in backups/
set -euo pipefail

STAMP=$(date -u '+%Y-%m-%d_%H%M')
mkdir -p backups

TABLES="daily_missions daily_tasks advertiser_tasks task_clicks"

for T in $TABLES; do
  # CSV backup
  psql "$DATABASE_URL" -c "\copy $T TO 'backups/${T}_${STAMP}.csv' WITH CSV HEADER" >/dev/null
  echo "backed up: backups/${T}_${STAMP}.csv"
done

echo "Done. All mission/task tables backed up at $STAMP UTC."

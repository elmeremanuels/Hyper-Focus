#!/usr/bin/env bash
# Nightly database backup (verbeterplan P0.2): pg_dump, encrypted with openssl, copied with
# rclone to EU storage. Keeps 14 daily and 8 weekly copies. Alerts Elmer when anything fails.
# Cron (as user app): CRON_TZ=Asia/Makassar / 0 3 * * * ~/hyperfocus/scripts/ops/backup.sh
# Reads DATABASE_URL, BACKUP_PASSPHRASE and BACKUP_REMOTE from ~/hyperfocus/.env. See docs/ops.md.
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$HOME/hyperfocus}"
LOCAL_DIR="${BACKUP_LOCAL_DIR:-$HOME/backups}"
cd "$APP_DIR"
# shellcheck source=lib.sh
source "$APP_DIR/scripts/ops/lib.sh"
trap 'alert backup "Back-up mislukt op regel $LINENO. Kijk in ~/backups/backup.log."' ERR

require DATABASE_URL BACKUP_PASSPHRASE BACKUP_REMOTE
mkdir -p "$LOCAL_DIR"
chmod 700 "$LOCAL_DIR"

stamp="$(date -u +%Y-%m-%d)"
file="$LOCAL_DIR/hyperfocus-$stamp.dump.enc"

# The custom format is compressed already and restores with pg_restore.
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" |
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$file"
[ -s "$file" ] || { alert backup "Back-up is leeg: $file"; exit 1; }

rclone copyto "$file" "$BACKUP_REMOTE/daily/$(basename "$file")"
# Sunday: also a weekly copy.
if [ "$(date -u +%u)" = 7 ]; then
  rclone copyto "$file" "$BACKUP_REMOTE/weekly/$(basename "$file")"
fi

# Retention: 14 daily, 8 weekly. Locally only the last two.
rclone delete --min-age 14d "$BACKUP_REMOTE/daily"
rclone delete --min-age 56d "$BACKUP_REMOTE/weekly"
ls -1t "$LOCAL_DIR"/hyperfocus-*.dump.enc | tail -n +3 | xargs -r rm --

echo "$(date -u +%FT%TZ) backup ok: $(basename "$file") ($(du -h "$file" | cut -f1))"

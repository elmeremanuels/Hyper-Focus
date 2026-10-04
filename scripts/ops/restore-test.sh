#!/usr/bin/env bash
# Monthly restore test (verbeterplan P0.2): fetches the newest backup, decrypts it, restores it
# into a scratch database and checks that users and tasks came back. Alerts Elmer on failure.
# Cron (as user app): CRON_TZ=Asia/Makassar / 30 4 1 * * ~/hyperfocus/scripts/ops/restore-test.sh
# Needs a role that may create databases: RESTORE_ADMIN_URL in .env (see docs/ops.md).
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$HOME/hyperfocus}"
cd "$APP_DIR"
# shellcheck source=lib.sh
source "$APP_DIR/scripts/ops/lib.sh"
trap 'alert restore_test "Hersteltest van de back-up mislukt op regel $LINENO. Kijk in ~/backups/restore-test.log."' ERR

require BACKUP_PASSPHRASE BACKUP_REMOTE RESTORE_ADMIN_URL
scratch_db="hyperfocus_restore_test"
work="$(mktemp -d)"
cleanup() {
  psql "$RESTORE_ADMIN_URL" -qc "DROP DATABASE IF EXISTS $scratch_db WITH (FORCE)" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

newest="$(rclone lsf "$BACKUP_REMOTE/daily" | sort | tail -n 1)"
[ -n "$newest" ] || { alert restore_test "Geen back-up gevonden in $BACKUP_REMOTE/daily."; exit 1; }
rclone copyto "$BACKUP_REMOTE/daily/$newest" "$work/backup.enc"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$work/backup.enc" -out "$work/backup.dump"

psql "$RESTORE_ADMIN_URL" -qc "DROP DATABASE IF EXISTS $scratch_db WITH (FORCE)"
psql "$RESTORE_ADMIN_URL" -qc "CREATE DATABASE $scratch_db"
scratch_url="$(scratch_url "$RESTORE_ADMIN_URL" "$scratch_db")"
pg_restore --no-owner --no-privileges --exit-on-error -d "$scratch_url" "$work/backup.dump"

users="$(psql "$scratch_url" -tAc 'select count(*) from users')"
tasks="$(psql "$scratch_url" -tAc 'select count(*) from tasks')"
if [ "$users" -lt 1 ]; then
  alert restore_test "Hersteltest: de back-up $newest bevat geen gebruikers."
  exit 1
fi
echo "$(date -u +%FT%TZ) restore ok: $newest ($users users, $tasks tasks)"

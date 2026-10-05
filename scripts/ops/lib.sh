# Shared helpers for the ops scripts. Sourced, not run.

# Reads one key from .env without running the file as shell code.
env_get() {
  local line
  line="$(grep -E "^$1=" .env 2>/dev/null | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  printf '%s' "$line"
}

# Exports the named keys from .env (the process environment wins) and stops when one is empty.
require() {
  local key value
  for key in "$@"; do
    value="${!key:-$(env_get "$key")}"
    if [ -z "$value" ]; then
      alert config "$key ontbreekt in .env voor $(basename "$0")."
      exit 1
    fi
    export "$key=$value"
  done
}

# Alerts Elmer by Telegram and mail; falls back to stderr when that fails too.
alert() {
  echo "ALERT $1: $2" >&2
  npm run --silent ops:alert -- "$1" "$2" || true
}

# postgres://user:pass@host:5432/db?x=y → the same URL pointing at another database.
scratch_url() {
  local base="${1%%\?*}" query=""
  [[ "$1" == *\?* ]] && query="?${1#*\?}"
  printf '%s/%s%s' "${base%/*}" "$2" "$query"
}

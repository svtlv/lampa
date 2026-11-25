#!/usr/bin/env bash
# read-only host collection; the Python companion uses only the standard library
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec python3 -B "$script_dir/measure-playback.py" "$@"

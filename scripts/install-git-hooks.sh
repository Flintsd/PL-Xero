#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

hook_dir="$repo_root/.git/hooks"

if [[ ! -d "$hook_dir" ]]; then
  echo "ERROR: .git/hooks not found. Are you in a git repo?" >&2
  exit 1
fi

install -m 0755 "$repo_root/.githooks/pre-commit" "$hook_dir/pre-commit"

echo "Installed pre-commit hook to $hook_dir/pre-commit"

#!/usr/bin/env sh
# Install the plugin and the global files into ~/.claude (or $CLAUDE_CONFIG_DIR).
# --dry-run prints each step. Never overwrites: changed files are backed up first.
set -eu
here=$(cd "$(dirname "$0")" && pwd); dest="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"; dry=""; [ "${1:-}" = "--dry-run" ] && dry=1
step() { echo "+ $*"; [ -n "$dry" ] || "$@"; }
backup() { [ -f "$1" ] && step cp "$1" "$1.bak.$(date +%Y%m%d%H%M%S)" || true; }
step mkdir -p "$dest"
if ! cmp -s "$here/global/CLAUDE.md" "$dest/saw-workflow.md"; then backup "$dest/saw-workflow.md"; step cp "$here/global/CLAUDE.md" "$dest/saw-workflow.md"; fi
if ! grep -qx "@saw-workflow.md" "$dest/CLAUDE.md" 2>/dev/null; then backup "$dest/CLAUDE.md"; echo "+ append @saw-workflow.md to $dest/CLAUDE.md"; [ -n "$dry" ] || printf '\n@saw-workflow.md\n' >> "$dest/CLAUDE.md"; fi
if [ -f "$dest/settings.json" ]; then echo "kept: $dest/settings.json (merge from global/settings.example.json by hand)"; else step cp "$here/global/settings.example.json" "$dest/settings.json"; fi
# Last: installing a plugin writes settings.json, which would stop the copy above.
if [ -z "${SAW_NO_PLUGIN:-}" ] && command -v claude >/dev/null 2>&1; then step claude plugin marketplace add "$here"; step claude plugin install sams-agentic-workflow@sams-agentic-workflow; else echo "skip: plugin install (claude not on PATH)"; fi

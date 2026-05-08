#!/usr/bin/env bash
# new-decision.sh — scaffold a decision log entry under
# salon-x-business/decisions/. See salonx-flightdeck/CLAUDE.md "Decisions log"
# for the convention; the canonical template lives here.
#
# Usage: ./scripts/new-decision.sh "Title with spaces"

set -euo pipefail

if [[ $# -lt 1 || -z "${1// }" ]]; then
  echo "usage: $0 \"Decision title\"" >&2
  exit 2
fi

title="$1"

# Resolve target directory. FLIGHTDECK_REPO_ROOT lets the user override the
# default sibling-repo root (matches the convention in CLAUDE.md).
root="${FLIGHTDECK_REPO_ROOT:-$HOME/all-salonx-repo}"
target_dir="$root/salon-x-business/decisions"

if [[ ! -d "$target_dir" ]]; then
  echo "error: decisions directory not found at $target_dir" >&2
  echo "       set FLIGHTDECK_REPO_ROOT if the sibling repos live elsewhere." >&2
  exit 1
fi

# Slugify: lowercase, spaces -> dashes, strip non-alnum/-, collapse dashes,
# trim leading/trailing dashes, truncate to 50 chars.
slug=$(printf '%s' "$title" \
  | tr '[:upper:]' '[:lower:]' \
  | tr ' ' '-' \
  | tr -cd 'a-z0-9-' \
  | tr -s '-' \
  | sed -e 's/^-//' -e 's/-$//' \
  | cut -c1-50 \
  | sed -e 's/-$//')

if [[ -z "$slug" ]]; then
  echo "error: title produced an empty slug after sanitisation" >&2
  exit 1
fi

today=$(date +%F)
filename="${today}-${slug}.md"
filepath="$target_dir/$filename"

if [[ -e "$filepath" ]]; then
  echo "error: $filepath already exists; refusing to overwrite" >&2
  exit 1
fi

# Escape any double quotes in the title for safe YAML embedding.
yaml_title=${title//\"/\\\"}

cat > "$filepath" <<EOF
---
title: "${yaml_title}"
date: ${today}
status: active
kind: []
stakeholders: []
tags: []
---

## Context

What forced the decision. One paragraph.

## Decision

What we picked. One paragraph.

## What we considered and rejected

- Option A — pros / cons / why we said no
- Option B — pros / cons / why we said no

## Tradeoffs accepted

- Cost we're explicitly accepting.

## Open questions / follow-ups

- Threshold that would make us revisit.
- Owner for the follow-up.

## Meeting context

Quote or summary from the meeting / Lark thread that drove the alignment.
EOF

echo "$filepath"

editor="${EDITOR:-vim}"
exec "$editor" "$filepath"

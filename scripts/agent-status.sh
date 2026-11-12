#!/usr/bin/env bash
# What each background agent (git worktree under .claude/worktrees) is doing right now.
# Usage: scripts/agent-status.sh        (re-run, or: watch -n 30 scripts/agent-status.sh)
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)" || exit 1

echo "main: $(git log -1 --format='%h %s (%cr)')"
echo
shopt -s nullglob
trees=(.claude/worktrees/*/)
[ ${#trees[@]} -eq 0 ] && echo "No agent worktrees: nothing running." && exit 0

for w in "${trees[@]}"; do
  w=${w%/}
  ahead=$(git -C "$w" rev-list --count main..HEAD 2>/dev/null)
  dirty=$(git -C "$w" status --short 2>/dev/null | wc -l | xargs)
  recent=$(find "$w/apps" "$w/scripts" "$w/docs" "$w/packages" -type f -mmin -15 \
    -not -path '*/node_modules/*' -not -path '*/.next*' -not -path '*/crawl-output/*' 2>/dev/null | wc -l | xargs)
  slot=$(grep -hoE '^PORT=41[0-9]+' "$w/apps/api/.env" 2>/dev/null | cut -d= -f2)
  state="idle"
  [ "$recent" -gt 0 ] && state="ACTIVE"
  echo "■ ${w##*/agent-}  [$state]"
  echo "  last commit : $(git -C "$w" log -1 --format='%cr — %s' 2>/dev/null | cut -c1-110)"
  echo "  progress    : $ahead commits ahead of main · $dirty uncommitted · $recent files touched in 15 min"
  if [ -n "$slot" ]; then
    n=${slot: -1}
    ports=$(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk '{print $9}' | grep -oE ":(310$n|410$n|810$n)$" | sort -u | tr '\n' ' ')
    echo "  servers     : ${ports:-none running} (slot $n)"
  fi
  echo
done
echo "machine: $(uptime | sed 's/.*load averages*: /load /') · free RAM $(vm_stat | awk '/Pages free/{printf "%d MB", $3*16384/1048576}')"

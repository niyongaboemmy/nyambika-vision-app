#!/usr/bin/env bash
# Runs every crawl in sequence against one slot and prints a pass/fail table (UI/UX modernisation regression gate).
# Usage: BASE_URL=http://localhost:3104 API_URL=http://localhost:4104 scripts/crawl-all.sh [crawl names…]
set -u
cd "$(dirname "$0")"
names=("$@")
if [ ${#names[@]} -eq 0 ]; then
  names=($(ls crawl-*.mjs | grep -v crawl-lib | sed 's/\.mjs$//'))
fi
mkdir -p crawl-output/logs
pass=0; fail=0; failed=()
for n in "${names[@]}"; do
  start=$(date +%s)
  if node "$n.mjs" > "crawl-output/logs/$n.log" 2>&1; then r=PASS; pass=$((pass+1)); else r=FAIL; fail=$((fail+1)); failed+=("$n"); fi
  echo "$r $n ($(( $(date +%s) - start ))s)"
done
echo "passed $pass · failed $fail ${failed[*]:-}"

#!/usr/bin/env bash
# Create the AI Gateway virtualenv (Python 3.12) and install pinned deps.
set -euo pipefail
cd "$(dirname "$0")/../apps/ai"
PY=${PYTHON:-python3.12}
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/pip install -q -r requirements.txt
echo "AI gateway ready (apps/ai/.venv)"

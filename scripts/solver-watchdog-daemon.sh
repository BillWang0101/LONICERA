#!/bin/zsh

set -eu

PROJECT_DIR="/path/to/lonicera"
INDEX_PATH="$PROJECT_DIR/.phase1-btn-vs-bb-srp-50bb-full/workload-index.json"
SOLVER_DIR="/path/to/TexasSolver"
REPORT_DIR="$PROJECT_DIR/.phase1-btn-vs-bb-srp-50bb-full/reports"
LOG_FILE="$REPORT_DIR/workload-watchdog-daemon.log"
PID_FILE="$REPORT_DIR/workload-watchdog-daemon.pid"
LOCK_DIR="/tmp/com.lonicera.solver-watchdog-daemon.lock"
NODE_BIN="/opt/homebrew/bin/node"

mkdir -p "$REPORT_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  exit 0
fi

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo $$ > "$PID_FILE"

log() {
  printf "[%s] %s\n" "$(date +"%Y-%m-%d %H:%M:%S")" "$1" >> "$LOG_FILE"
}

while true; do
  log "watchdog tick"
  "$NODE_BIN" "$PROJECT_DIR/scripts/solver-workload-watchdog.js" \
    --index "$INDEX_PATH" \
    --solver-dir "$SOLVER_DIR" \
    --project-dir "$PROJECT_DIR" \
    --interval-seconds 300 \
    --stale-minutes 12 \
    --timeout-ms 180000 \
    --max-iteration 10 \
    --summary-file "$REPORT_DIR/workload-runner.summary.json" \
    --log-file "$REPORT_DIR/workload-watchdog.log" \
    --once >> "$LOG_FILE" 2>&1 || log "watchdog tick failed"
  sleep 300
done

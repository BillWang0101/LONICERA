#!/bin/zsh

set -u

MOUNT_POINT="${MOUNT_POINT:-/Volumes/lonicera_solver_workloads}"
SMB_URL="${SMB_URL:-smb://user@example-nas/share}"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/nas-keepalive.log"
LOCK_DIR="/tmp/com.lonicera.nas-keepalive.lock"

mkdir -p "$LOG_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  exit 0
fi

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

timestamp() {
  date +"%Y-%m-%d %H:%M:%S"
}

log() {
  printf "[%s] %s\n" "$(timestamp)" "$1" >> "$LOG_FILE"
}

is_mounted() {
  /sbin/mount | /usr/bin/grep -F "on $MOUNT_POINT (smbfs" >/dev/null 2>&1
}

probe_mount() {
  /bin/ls -ld "$MOUNT_POINT" >/dev/null 2>&1 && /usr/bin/stat -f "%m" "$MOUNT_POINT" >/dev/null 2>&1
}

remount() {
  log "mount missing, trying Finder mount: $SMB_URL"
  /usr/bin/osascript <<EOF >/dev/null 2>&1
try
  tell application "Finder"
    mount volume "$SMB_URL"
  end tell
end try
EOF
  sleep 5
  if is_mounted; then
    log "remount succeeded"
    return 0
  fi

  log "Finder mount did not report success, trying open"
  /usr/bin/open "$SMB_URL" >/dev/null 2>&1 || true
  sleep 5
  if is_mounted; then
    log "open-based remount succeeded"
    return 0
  fi

  log "remount failed"
  return 1
}

if is_mounted; then
  if probe_mount; then
    log "probe ok"
    exit 0
  fi

  log "mount present but probe failed, trying remount"
fi

remount

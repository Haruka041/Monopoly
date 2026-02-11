#!/usr/bin/env bash
set -Eeuo pipefail
shopt -s nullglob

export NODE_ENV=production
export NODE_MAX_OLD_SPACE_SIZE="${NODE_MAX_OLD_SPACE_SIZE:-512}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE}}"

export FATPAPER_DOMAIN="${FATPAPER_DOMAIN:-localhost}"
export PROTOCOL="${PROTOCOL:-https}"
export USE_PORT="${USE_PORT:-false}"
export USER_SERVER_PATH="${USER_SERVER_PATH:-user-server}"
export MONOPOLY_SERVER_PATH="${MONOPOLY_SERVER_PATH:-monopoly-server}"
export ICE_SERVER_PATH="${ICE_SERVER_PATH:-ice-server}"
export TURN_URLS="${TURN_URLS:-}"
export TURN_USERNAME="${TURN_USERNAME:-}"
export TURN_CREDENTIAL="${TURN_CREDENTIAL:-}"
export EXTRA_STUN_URLS="${EXTRA_STUN_URLS:-}"
export ICE_SERVERS_JSON="${ICE_SERVERS_JSON:-}"
export USER_SERVER_HOST="${USER_SERVER_HOST:-127.0.0.1}"
export ENABLE_ACCESS_LOG="${ENABLE_ACCESS_LOG:-true}"
export ENABLE_HEALTH_CHECK_LOG="${ENABLE_HEALTH_CHECK_LOG:-true}"
export HEALTH_CHECK_INTERVAL_SEC="${HEALTH_CHECK_INTERVAL_SEC:-30}"
export HEALTH_CHECK_TIMEOUT_SEC="${HEALTH_CHECK_TIMEOUT_SEC:-5}"

export MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
export MYSQL_PORT="${MYSQL_PORT:-3306}"
export MYSQL_USERNAME="${MYSQL_USERNAME:-root}"
export MYSQL_PASSWORD="${MYSQL_PASSWORD:-root}"
export MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-$MYSQL_PASSWORD}"

export ENABLE_AUTO_BACKUP="${ENABLE_AUTO_BACKUP:-true}"
export BACKUP_KEEP_COUNT="${BACKUP_KEEP_COUNT:-100}"
export BACKUP_INTERVAL_MIN="${BACKUP_INTERVAL_MIN:-1}"
export BACKUP_TRIGGER_LINES="${BACKUP_TRIGGER_LINES:-100}"
export BACKUP_MIN_INTERVAL_SEC="${BACKUP_MIN_INTERVAL_SEC:-60}"
export BACKUP_HEARTBEAT_INTERVAL_SEC="${BACKUP_HEARTBEAT_INTERVAL_SEC:-60}"
export BACKUP_ARCHIVE_NAME="${BACKUP_ARCHIVE_NAME:-data_backup.zip}"
export RESTORE_BACKUP_ON_STARTUP="${RESTORE_BACKUP_ON_STARTUP:-true}"
export BACKUP_REPO="${BACKUP_REPO:-}"
export BACKUP_REPO_TYPE="${BACKUP_REPO_TYPE:-dataset}"
export BACKUP_BRANCH="${BACKUP_BRANCH:-main}"
export BACKUP_HF_TOKEN="${BACKUP_HF_TOKEN:-${HF_TOKEN:-}}"
export BACKUP_HF_USERNAME="${BACKUP_HF_USERNAME:-${HF_USERNAME:-__token__}}"
export BACKUP_USE_HF_API="${BACKUP_USE_HF_API:-}"
export MAP_LIST_SHOW_ALL="${MAP_LIST_SHOW_ALL:-true}"

if [ -z "${BACKUP_USE_HF_API}" ]; then
    case "${BACKUP_REPO_TYPE}" in
        dataset|datasets)
            export BACKUP_USE_HF_API="true"
            ;;
        *)
            export BACKUP_USE_HF_API="false"
            ;;
    esac
fi

if [ -d /data ]; then
    MYSQL_DATA_DIR="${MYSQL_DATA_DIR:-/data/mysql}"
    BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
    AVATAR_STORE_DIR="${AVATAR_STORE_DIR:-/data/avatar-store}"
else
    MYSQL_DATA_DIR="${MYSQL_DATA_DIR:-/var/lib/mysql}"
    BACKUP_DIR="${BACKUP_DIR:-/var/backups/monopoly}"
    AVATAR_STORE_DIR="${AVATAR_STORE_DIR:-/var/lib/monopoly-avatar-store}"
fi

BACKUP_REPO_DIR="${BACKUP_REPO_DIR:-/tmp/hf-backup-repo}"
BACKUP_REPO_ARCHIVE_PATH="${BACKUP_REPO_ARCHIVE_PATH:-${BACKUP_REPO_DIR}/${BACKUP_ARCHIVE_NAME}}"
BACKUP_WORK_DIR="${BACKUP_WORK_DIR:-/tmp/monopoly-backup-work}"
BACKUP_RESTORE_DIR="${BACKUP_RESTORE_DIR:-/tmp/monopoly-backup-restore}"
BACKUP_LOCK_DIR="${BACKUP_LOCK_DIR:-/tmp/monopoly-backup-lock}"
BACKUP_EVENT_FILE="${BACKUP_EVENT_FILE:-/tmp/monopoly-backup-event.log}"
BACKUP_GIT_ASKPASS="${BACKUP_GIT_ASKPASS:-/tmp/monopoly-hf-git-askpass.sh}"
APP_LOG_FILE="${APP_LOG_FILE:-/tmp/space-app.log}"
MYSQL_SOCKET="/run/mysqld/mysqld.sock"
BACKUP_LAST_RUN_FILE="${BACKUP_LAST_RUN_FILE:-/tmp/monopoly-backup-last-run}"
USER_HEALTH_URL="${USER_HEALTH_URL:-http://127.0.0.1:83/health}"
MONOPOLY_HEALTH_URL="${MONOPOLY_HEALTH_URL:-http://127.0.0.1:84/health}"
GATEWAY_HEALTH_URL="${GATEWAY_HEALTH_URL:-http://127.0.0.1:7860/}"
RUNTIME_CONFIG_FILE="${RUNTIME_CONFIG_FILE:-/var/www/monopoly-client/runtime-config.js}"
USER_SERVER_AVATAR_DIR="${USER_SERVER_AVATAR_DIR:-/app/fatpaper-user-server/public/fatpaper/user/avatar}"

append_app_log() {
    local line="$1"
    echo "${line}"
    if [ -n "${APP_LOG_FILE:-}" ]; then
        printf '%s\n' "${line}" >> "${APP_LOG_FILE}" 2>/dev/null || true
    fi
}

write_runtime_ice_config() {
    local target_file="${RUNTIME_CONFIG_FILE}"
    mkdir -p "$(dirname "${target_file}")"
    node - "${target_file}" <<'NODE'
const fs = require("fs");
const targetFile = process.argv[2];
const runtimeConfig = {
    turnUrls: process.env.TURN_URLS || "",
    turnUsername: process.env.TURN_USERNAME || "",
    turnCredential: process.env.TURN_CREDENTIAL || "",
    extraStunUrls: process.env.EXTRA_STUN_URLS || "",
    iceServersJson: process.env.ICE_SERVERS_JSON || ""
};

fs.writeFileSync(
    targetFile,
    `window.__MONOPOLY_RUNTIME__ = ${JSON.stringify(runtimeConfig)};\n`,
    "utf8"
);
NODE
}

safe_parse_positive_int() {
    local val="$1"
    local fallback="$2"
    if ! [[ "${val}" =~ ^[0-9]+$ ]]; then
        echo "${fallback}"
        return
    fi
    echo "${val}"
}

prepare_avatar_storage() {
    mkdir -p "${AVATAR_STORE_DIR}"
    mkdir -p "$(dirname "${USER_SERVER_AVATAR_DIR}")"

    if [ -e "${USER_SERVER_AVATAR_DIR}" ] && [ ! -L "${USER_SERVER_AVATAR_DIR}" ]; then
        cp -a "${USER_SERVER_AVATAR_DIR}/." "${AVATAR_STORE_DIR}/" 2>/dev/null || true
        rm -rf "${USER_SERVER_AVATAR_DIR}"
    fi

    ln -sfn "${AVATAR_STORE_DIR}" "${USER_SERVER_AVATAR_DIR}"
    append_app_log "[space] avatar storage linked: ${USER_SERVER_AVATAR_DIR} -> ${AVATAR_STORE_DIR}"
}

cleanup() {
    echo "[space] shutting down services..."
    if [ "${ENABLE_AUTO_BACKUP}" = "true" ]; then
        backup_once "shutdown" || true
    fi
    if [ -n "${LOG_WATCH_PID:-}" ]; then
        kill "${LOG_WATCH_PID}" >/dev/null 2>&1 || true
    fi
    if [ -n "${INTERVAL_BACKUP_PID:-}" ]; then
        kill "${INTERVAL_BACKUP_PID}" >/dev/null 2>&1 || true
    fi
    if [ -n "${HEALTH_CHECK_PID:-}" ]; then
        kill "${HEALTH_CHECK_PID}" >/dev/null 2>&1 || true
    fi
    if [ -n "${BACKUP_HEARTBEAT_PID:-}" ]; then
        kill "${BACKUP_HEARTBEAT_PID}" >/dev/null 2>&1 || true
    fi
    pkill -f "node dist/fatpaper-user-server/app.js" || true
    pkill -f "node dist/monopoly-server/app.js" || true
    pkill -f "nginx: master process" || true
    pkill -f "mysqld" || true
}
trap cleanup EXIT INT TERM

wait_mysql() {
    for _ in $(seq 1 90); do
        if mysqladmin --protocol=socket --socket="$MYSQL_SOCKET" ping --silent >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    return 1
}

wait_http_service() {
    local name="$1"
    local url="$2"
    local max_retry="${3:-60}"
    for _ in $(seq 1 "${max_retry}"); do
        if curl -fsS "${url}" >/dev/null 2>&1; then
            echo "[space] ${name} is ready (${url})"
            return 0
        fi
        sleep 1
    done
    echo "[space] ${name} health check timeout (${url})"
    return 1
}

start_mysql() {
    mysqld \
        --user=mysql \
        --datadir="$MYSQL_DATA_DIR" \
        --socket="$MYSQL_SOCKET" \
        --port="$MYSQL_PORT" \
        --bind-address=127.0.0.1 \
        --innodb_buffer_pool_size="${MYSQL_INNODB_BUFFER_POOL_SIZE:-128M}" \
        --max_connections="${MYSQL_MAX_CONNECTIONS:-120}" &
    MYSQL_PID=$!
    if ! wait_mysql; then
        echo "[space] mysql startup failed"
        exit 1
    fi
}

mysql_socket() {
    mysql --protocol=socket --socket="$MYSQL_SOCKET" -uroot "$@"
}

mysql_tcp() {
    mysql -h127.0.0.1 -P"$MYSQL_PORT" -uroot "-p${MYSQL_ROOT_PASSWORD}" "$@"
}

mysql_exec() {
    if mysql_socket -e "SELECT 1" >/dev/null 2>&1; then
        mysql_socket "$@"
    else
        mysql_tcp "$@"
    fi
}

is_repo_backup_enabled() {
    if [ "${ENABLE_AUTO_BACKUP}" != "true" ]; then
        return 1
    fi
    if [ -z "${BACKUP_REPO}" ] || [ -z "${BACKUP_HF_TOKEN}" ]; then
        return 1
    fi
    return 0
}

is_hf_api_backup_mode() {
    local mode="${BACKUP_USE_HF_API}"
    if [ -z "${mode}" ]; then
        case "${BACKUP_REPO_TYPE}" in
            dataset|datasets)
                mode="true"
                ;;
            *)
                mode="false"
                ;;
        esac
    fi
    if [ "${mode}" = "true" ]; then
        return 0
    fi
    return 1
}

mask_backup_secret() {
    local text="${1:-}"
    local masked="${text}"
    if [ -n "${BACKUP_HF_TOKEN:-}" ]; then
        masked="${masked//${BACKUP_HF_TOKEN}/***HF_TOKEN***}"
    fi
    printf '%s' "${masked}"
}

hf_api_download_backup() {
    if ! is_repo_backup_enabled; then
        return 1
    fi
    mkdir -p "${BACKUP_DIR}"
    if ! command -v python3 >/dev/null 2>&1; then
        append_app_log "[space] hf api download failed: python3 not available"
        return 1
    fi
    if ! python3 - "${BACKUP_REPO}" "${BACKUP_ARCHIVE_NAME}" "${BACKUP_DIR}/${BACKUP_ARCHIVE_NAME}" <<'PY'
import os, sys, shutil
repo = sys.argv[1]
filename = sys.argv[2]
dest = sys.argv[3]
token = os.environ.get("BACKUP_HF_TOKEN") or os.environ.get("HF_TOKEN") or ""
try:
    from huggingface_hub import hf_hub_download
except Exception as e:
    print(f"[space] hf api download failed: huggingface_hub missing ({e})")
    sys.exit(1)
try:
    path = hf_hub_download(repo_id=repo, repo_type="dataset", filename=filename, token=token)
    shutil.copy(path, dest)
except Exception as e:
    print(f"[space] hf api download failed: {e}")
    sys.exit(1)
PY
    then
        return 1
    fi
    local archive_size
    archive_size="$(du -h "${BACKUP_DIR}/${BACKUP_ARCHIVE_NAME}" 2>/dev/null | awk '{print $1}')"
    append_app_log "[space] backup repo sync finished (api): ${BACKUP_ARCHIVE_NAME} (${archive_size})"
    return 0
}

hf_api_upload_backup() {
    if ! is_repo_backup_enabled; then
        return 1
    fi
    if [ ! -f "${BACKUP_DIR}/${BACKUP_ARCHIVE_NAME}" ]; then
        append_app_log "[space] hf api upload skipped: ${BACKUP_ARCHIVE_NAME} missing"
        return 1
    fi
    if ! command -v python3 >/dev/null 2>&1; then
        append_app_log "[space] hf api upload failed: python3 not available"
        return 1
    fi
    if ! python3 - "${BACKUP_REPO}" "${BACKUP_DIR}/${BACKUP_ARCHIVE_NAME}" "${BACKUP_ARCHIVE_NAME}" <<'PY'
import os, sys
repo = sys.argv[1]
local_path = sys.argv[2]
path_in_repo = sys.argv[3]
token = os.environ.get("BACKUP_HF_TOKEN") or os.environ.get("HF_TOKEN") or ""
try:
    from huggingface_hub import HfApi
except Exception as e:
    print(f"[space] hf api upload failed: huggingface_hub missing ({e})")
    sys.exit(1)
try:
    api = HfApi()
    api.upload_file(
        path_or_fileobj=local_path,
        path_in_repo=path_in_repo,
        repo_id=repo,
        repo_type="dataset",
        token=token,
        commit_message="Automated backup (api)",
    )
except Exception as e:
    print(f"[space] hf api upload failed: {e}")
    sys.exit(1)
PY
    then
        return 1
    fi
    append_app_log "[space] backup repo push completed (api): ${BACKUP_ARCHIVE_NAME}"
    return 0
}

prepare_backup_git_auth() {
    local hf_user="${BACKUP_HF_USERNAME:-__token__}"
    cat > "${BACKUP_GIT_ASKPASS}" <<EOF
#!/usr/bin/env sh
case "\$1" in
*sername*) printf '%s\n' "${hf_user}" ;;
*assword*) printf '%s\n' "${BACKUP_HF_TOKEN}" ;;
*) printf '\n' ;;
esac
EOF
    chmod 700 "${BACKUP_GIT_ASKPASS}" >/dev/null 2>&1 || true
}

run_git_hf() {
    local output=""
    local rc=0
    set +e
    output="$(
        GIT_TERMINAL_PROMPT=0 \
        GIT_ASKPASS="${BACKUP_GIT_ASKPASS}" \
        git "$@" 2>&1
    )"
    rc=$?
    set -e
    if [ "${rc}" -ne 0 ]; then
        append_app_log "[space] git auth command failed: git $* :: $(mask_backup_secret "${output}")"
        return "${rc}"
    fi
    return 0
}

build_backup_remote_url() {
    local repo_url
    if [[ "${BACKUP_REPO}" =~ ^https?:// ]]; then
        repo_url="${BACKUP_REPO}"
    else
        case "${BACKUP_REPO_TYPE}" in
            dataset|datasets)
                repo_url="https://huggingface.co/datasets/${BACKUP_REPO}.git"
                ;;
            space|spaces)
                repo_url="https://huggingface.co/spaces/${BACKUP_REPO}.git"
                ;;
            model|models|"")
                repo_url="https://huggingface.co/${BACKUP_REPO}.git"
                ;;
            *)
                repo_url="https://huggingface.co/datasets/${BACKUP_REPO}.git"
                ;;
        esac
    fi
    echo "${repo_url}"
}

ensure_backup_repo() {
    if ! is_repo_backup_enabled; then
        return 1
    fi

    local remote_url
    remote_url="$(build_backup_remote_url)"
    prepare_backup_git_auth

    if ! run_git_hf ls-remote "${remote_url}"; then
        append_app_log "[space] backup repo auth check failed: repo=${BACKUP_REPO}, type=${BACKUP_REPO_TYPE}, branch=${BACKUP_BRANCH}"
        return 1
    fi

    if [ ! -d "${BACKUP_REPO_DIR}/.git" ]; then
        rm -rf "${BACKUP_REPO_DIR}"
        if ! run_git_hf clone --depth 1 --branch "${BACKUP_BRANCH}" "${remote_url}" "${BACKUP_REPO_DIR}"; then
            if ! run_git_hf clone "${remote_url}" "${BACKUP_REPO_DIR}"; then
                echo "[space] backup repo clone failed"
                return 1
            fi
            git -C "${BACKUP_REPO_DIR}" checkout -B "${BACKUP_BRANCH}" >/dev/null 2>&1 || true
        fi
    else
        git -C "${BACKUP_REPO_DIR}" remote set-url origin "${remote_url}" >/dev/null 2>&1 || true
        run_git_hf -C "${BACKUP_REPO_DIR}" fetch origin "${BACKUP_BRANCH}" || true
        git -C "${BACKUP_REPO_DIR}" checkout "${BACKUP_BRANCH}" >/dev/null 2>&1 || git -C "${BACKUP_REPO_DIR}" checkout -b "${BACKUP_BRANCH}" >/dev/null 2>&1 || true
        git -C "${BACKUP_REPO_DIR}" reset --hard "origin/${BACKUP_BRANCH}" >/dev/null 2>&1 || true
        git -C "${BACKUP_REPO_DIR}" clean -fdx >/dev/null 2>&1 || true
    fi

    git -C "${BACKUP_REPO_DIR}" config user.email "space-backup@local" >/dev/null 2>&1 || true
    git -C "${BACKUP_REPO_DIR}" config user.name "space-backup-bot" >/dev/null 2>&1 || true
    return 0
}

sync_backups_from_repo() {
    if is_hf_api_backup_mode; then
        hf_api_download_backup || append_app_log "[space] backup repo sync failed (api)"
        return 0
    fi

    if ! ensure_backup_repo; then
        return 0
    fi

    mkdir -p "${BACKUP_DIR}"
    if [ ! -f "${BACKUP_REPO_ARCHIVE_PATH}" ]; then
        append_app_log "[space] backup repo sync: no ${BACKUP_ARCHIVE_NAME} found in repo"
        return 0
    fi

    cp -f "${BACKUP_REPO_ARCHIVE_PATH}" "${BACKUP_DIR}/${BACKUP_ARCHIVE_NAME}"
    local archive_size
    archive_size="$(du -h "${BACKUP_DIR}/${BACKUP_ARCHIVE_NAME}" | awk '{print $1}')"
    append_app_log "[space] backup repo sync finished: ${BACKUP_ARCHIVE_NAME} (${archive_size})"
}

sync_backups_to_repo() {
    local reason="$1"
    local ts="$2"
    if is_hf_api_backup_mode; then
        hf_api_upload_backup || {
            append_app_log "[space] backup repo push failed (api-${reason})"
            return 1
        }
        return 0
    fi

    if ! ensure_backup_repo; then
        append_app_log "[space] backup repo sync skipped (${reason}): repo disabled"
        return 0
    fi

    if [ ! -f "${BACKUP_DIR}/${BACKUP_ARCHIVE_NAME}" ]; then
        append_app_log "[space] backup repo sync skipped (${reason}): ${BACKUP_ARCHIVE_NAME} missing"
        return 1
    fi

    cp -f "${BACKUP_DIR}/${BACKUP_ARCHIVE_NAME}" "${BACKUP_REPO_ARCHIVE_PATH}"
    rm -rf "${BACKUP_REPO_DIR}/db" "${BACKUP_REPO_DIR}/assets"

    git -C "${BACKUP_REPO_DIR}" add -A "${BACKUP_ARCHIVE_NAME}" >/dev/null 2>&1 || true
    git -C "${BACKUP_REPO_DIR}" add -A db assets >/dev/null 2>&1 || true
    if git -C "${BACKUP_REPO_DIR}" diff --cached --quiet; then
        append_app_log "[space] backup repo unchanged (${reason}), skip push"
        return 0
    fi
    git -C "${BACKUP_REPO_DIR}" commit -m "Automated backup ${ts} (${reason})" >/dev/null 2>&1 || true
    run_git_hf -C "${BACKUP_REPO_DIR}" push origin "${BACKUP_BRANCH}" || {
        append_app_log "[space] backup repo push failed (${reason}): please verify BACKUP_REPO and HF token write permission"
        return 1
    }
}

build_backup_archive() {
    local ts="$1"
    local reason="$2"
    local work_dir="${BACKUP_WORK_DIR}"
    local output_file="${BACKUP_DIR}/${BACKUP_ARCHIVE_NAME}"
    local metadata_file="${work_dir}/meta.json"
    local mono_count="NA"
    local users_count="NA"
    local mono_sql_file="${work_dir}/db/monopoly.sql"
    local user_sql_file="${work_dir}/db/fatpaper_user.sql"

    rm -rf "${work_dir}"
    mkdir -p "${work_dir}/db" "${work_dir}/assets/avatars" "${BACKUP_DIR}" "${AVATAR_STORE_DIR}"

    mono_count="$(mysql -h127.0.0.1 -P"${MYSQL_PORT}" -uroot "-p${MYSQL_ROOT_PASSWORD}" -Nse "SELECT COUNT(*) FROM monopoly.map;" 2>/dev/null || echo "NA")"
    users_count="$(mysql -h127.0.0.1 -P"${MYSQL_PORT}" -uroot "-p${MYSQL_ROOT_PASSWORD}" -Nse "SELECT COUNT(*) FROM fatpaper_user.\`user\`;" 2>/dev/null || echo "NA")"

    mysqldump -h127.0.0.1 -P"${MYSQL_PORT}" -uroot "-p${MYSQL_ROOT_PASSWORD}" --single-transaction --quick monopoly > "${mono_sql_file}" || return 1
    gzip -1f "${mono_sql_file}" || return 1

    mysqldump -h127.0.0.1 -P"${MYSQL_PORT}" -uroot "-p${MYSQL_ROOT_PASSWORD}" --single-transaction --quick fatpaper_user > "${user_sql_file}" || return 1
    gzip -1f "${user_sql_file}" || return 1

    cp -af "${AVATAR_STORE_DIR}/." "${work_dir}/assets/avatars/" 2>/dev/null || true

    cat > "${metadata_file}" <<EOF
{
  "timestamp": "${ts}",
  "reason": "${reason}",
  "format": "monopoly-backup-zip-v1",
  "usersCount": "${users_count}",
  "mapsCount": "${mono_count}"
}
EOF

    rm -f "${output_file}"
    (
        cd "${work_dir}"
        zip -q -r -9 "${output_file}" db assets meta.json
    ) || return 1

    return 0
}

acquire_backup_lock() {
    for _ in $(seq 1 30); do
        if mkdir "${BACKUP_LOCK_DIR}" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    return 1
}

release_backup_lock() {
    rmdir "${BACKUP_LOCK_DIR}" >/dev/null 2>&1 || true
}

backup_once() {
    local reason="${1:-manual}"
    if [ "${ENABLE_AUTO_BACKUP}" != "true" ]; then
        return 0
    fi

    if [ "${BACKUP_MIN_INTERVAL_SEC}" -gt 0 ] && [[ "${reason}" == interval || "${reason}" == log-* ]]; then
        if [ -f "${BACKUP_LAST_RUN_FILE}" ]; then
            local now
            local last
            now="$(date +%s)"
            last="$(cat "${BACKUP_LAST_RUN_FILE}" 2>/dev/null || echo 0)"
            if [[ "${last}" =~ ^[0-9]+$ ]] && [ $((now - last)) -lt "${BACKUP_MIN_INTERVAL_SEC}" ]; then
                append_app_log "[space] backup skipped (${reason}): min-interval ${BACKUP_MIN_INTERVAL_SEC}s"
                return 0
            fi
        fi
    fi

    if ! acquire_backup_lock; then
        append_app_log "[space] backup skipped: lock busy"
        return 0
    fi

    set +e
    local rc=0
    local ts
    ts="$(date +%Y%m%d_%H%M%S)"
    append_app_log "[space] backup started (${reason}) at ${ts}"
    log_db_snapshot_counts "before-${reason}"

    build_backup_archive "${ts}" "${reason}" || rc=1
    local archive_size
    archive_size="$(du -h "${BACKUP_DIR}/${BACKUP_ARCHIVE_NAME}" 2>/dev/null | awk '{print $1}')"
    if [ -n "${archive_size}" ]; then
        append_app_log "[space] backup archive ready: ${BACKUP_ARCHIVE_NAME} (${archive_size})"
    fi

    sync_backups_to_repo "${reason}" "${ts}" || rc=1
    if [ "${rc}" -eq 0 ]; then
        date +%s > "${BACKUP_LAST_RUN_FILE}" || true
        append_app_log "[space] backup completed (${reason}) at ${ts}"
    else
        append_app_log "[space] backup failed (${reason}) at ${ts}"
    fi

    release_backup_lock
    set -e
    return "${rc}"
}

restore_sql_into_db() {
    local db_name="$1"
    local dump_file="$2"
    local tmp_restore_dir="${BACKUP_RESTORE_DIR}/tmp"
    local tmp_sql_file=""
    if [[ "${dump_file}" == *.gz ]]; then
        mkdir -p "${tmp_restore_dir}"
        tmp_sql_file="$(mktemp "${tmp_restore_dir}/${db_name}.XXXXXX.sql")"
        if ! gunzip -c "${dump_file}" > "${tmp_sql_file}"; then
            append_app_log "[space] restore failed (${db_name}): invalid gzip ${dump_file}"
            rm -f "${tmp_sql_file}" >/dev/null 2>&1 || true
            return 1
        fi
        if ! mysql -h127.0.0.1 -P"${MYSQL_PORT}" -uroot "-p${MYSQL_ROOT_PASSWORD}" "${db_name}" < "${tmp_sql_file}"; then
            append_app_log "[space] restore failed (${db_name}): mysql import error from ${dump_file}"
            rm -f "${tmp_sql_file}" >/dev/null 2>&1 || true
            return 1
        fi
        rm -f "${tmp_sql_file}" >/dev/null 2>&1 || true
    else
        if ! mysql -h127.0.0.1 -P"${MYSQL_PORT}" -uroot "-p${MYSQL_ROOT_PASSWORD}" "${db_name}" < "${dump_file}"; then
            append_app_log "[space] restore failed (${db_name}): mysql import error from ${dump_file}"
            return 1
        fi
    fi
}

log_db_snapshot_counts() {
    local label="$1"
    local users_count
    local maps_count
    users_count="$(mysql -h127.0.0.1 -P"${MYSQL_PORT}" -uroot "-p${MYSQL_ROOT_PASSWORD}" -Nse "SELECT COUNT(*) FROM fatpaper_user.\`user\`;" 2>/dev/null || echo "NA")"
    maps_count="$(mysql -h127.0.0.1 -P"${MYSQL_PORT}" -uroot "-p${MYSQL_ROOT_PASSWORD}" -Nse "SELECT COUNT(*) FROM monopoly.map;" 2>/dev/null || echo "NA")"
    append_app_log "[space] db snapshot (${label}): users=${users_count}, maps=${maps_count}"
}

restore_latest_backup_if_exists() {
    local archive_file="${BACKUP_DIR}/${BACKUP_ARCHIVE_NAME}"
    local mono_from_archive=""
    local user_from_archive=""
    local legacy_mono_candidates=( "${BACKUP_DIR}"/monopoly_*.sql "${BACKUP_DIR}"/monopoly_*.sql.gz )
    local legacy_user_candidates=( "${BACKUP_DIR}"/fatpaper_user_*.sql "${BACKUP_DIR}"/fatpaper_user_*.sql.gz )
    local mono_candidates=( "${BACKUP_DIR}"/monopoly_*.sql "${BACKUP_DIR}"/monopoly_*.sql.gz )
    local user_candidates=( "${BACKUP_DIR}"/fatpaper_user_*.sql "${BACKUP_DIR}"/fatpaper_user_*.sql.gz )
    local latest_mono=""
    local latest_user=""
    local ts=""

    mkdir -p "${AVATAR_STORE_DIR}"

    if [ -f "${archive_file}" ]; then
        rm -rf "${BACKUP_RESTORE_DIR}"
        mkdir -p "${BACKUP_RESTORE_DIR}"
        append_app_log "[space] restoring backup archive: ${archive_file}"
        if unzip -oq "${archive_file}" -d "${BACKUP_RESTORE_DIR}" >/dev/null 2>&1; then
            if [ -f "${BACKUP_RESTORE_DIR}/db/monopoly.sql.gz" ]; then
                mono_from_archive="${BACKUP_RESTORE_DIR}/db/monopoly.sql.gz"
            elif [ -f "${BACKUP_RESTORE_DIR}/db/monopoly.sql" ]; then
                mono_from_archive="${BACKUP_RESTORE_DIR}/db/monopoly.sql"
            fi
            if [ -f "${BACKUP_RESTORE_DIR}/db/fatpaper_user.sql.gz" ]; then
                user_from_archive="${BACKUP_RESTORE_DIR}/db/fatpaper_user.sql.gz"
            elif [ -f "${BACKUP_RESTORE_DIR}/db/fatpaper_user.sql" ]; then
                user_from_archive="${BACKUP_RESTORE_DIR}/db/fatpaper_user.sql"
            fi

            if [ -n "${mono_from_archive}" ]; then
                append_app_log "[space] restoring backup db: ${mono_from_archive}"
                restore_sql_into_db "monopoly" "${mono_from_archive}"
                if [ -n "${user_from_archive}" ]; then
                    append_app_log "[space] restoring backup db: ${user_from_archive}"
                    restore_sql_into_db "fatpaper_user" "${user_from_archive}"
                fi
                if [ -d "${BACKUP_RESTORE_DIR}/assets/avatars" ]; then
                    cp -af "${BACKUP_RESTORE_DIR}/assets/avatars/." "${AVATAR_STORE_DIR}/" 2>/dev/null || true
                fi
                append_app_log "[space] backup restore completed from ${BACKUP_ARCHIVE_NAME}"
                log_db_snapshot_counts "after-archive-restore"
                return 0
            fi
            append_app_log "[space] backup archive extracted but db files not found, fallback to legacy backups"
        else
            append_app_log "[space] backup archive unzip failed, fallback to legacy backups"
        fi
    fi

    if [ "${#legacy_mono_candidates[@]}" -eq 0 ]; then
        return 1
    fi

    latest_mono="$(ls -1t "${mono_candidates[@]}" | head -n1)"
    ts="$(basename "${latest_mono}")"
    ts="${ts#monopoly_}"
    ts="${ts%.sql}"
    ts="${ts%.gz}"

    if [ -f "${BACKUP_DIR}/fatpaper_user_${ts}.sql" ]; then
        latest_user="${BACKUP_DIR}/fatpaper_user_${ts}.sql"
    elif [ -f "${BACKUP_DIR}/fatpaper_user_${ts}.sql.gz" ]; then
        latest_user="${BACKUP_DIR}/fatpaper_user_${ts}.sql.gz"
    elif [ "${#user_candidates[@]}" -gt 0 ]; then
        latest_user="$(ls -1t "${user_candidates[@]}" | head -n1)"
    fi

    append_app_log "[space] restoring legacy backup: ${latest_mono}"
    restore_sql_into_db "monopoly" "${latest_mono}"
    if [ -n "${latest_user}" ]; then
        append_app_log "[space] restoring legacy backup: ${latest_user}"
        restore_sql_into_db "fatpaper_user" "${latest_user}"
    fi
    log_db_snapshot_counts "after-legacy-restore"
    return 0
}

start_interval_backup_loop() {
    if [ "${ENABLE_AUTO_BACKUP}" != "true" ]; then
        return
    fi
    if [ "${BACKUP_INTERVAL_MIN}" -le 0 ]; then
        return
    fi
    (
        while true; do
            sleep "${BACKUP_INTERVAL_MIN}m"
            backup_once "interval" || echo "[space] interval backup failed"
        done
    ) &
    INTERVAL_BACKUP_PID=$!
}

start_log_backup_watcher() {
    if [ "${ENABLE_AUTO_BACKUP}" != "true" ]; then
        return
    fi
    if [ "${BACKUP_TRIGGER_LINES}" -le 0 ]; then
        return
    fi

    append_app_log "[space] log-based backup enabled: every ${BACKUP_TRIGGER_LINES} lines"
    (
        local count=0
        tail -n0 -F "${APP_LOG_FILE}" 2>/dev/null | while IFS= read -r _line; do
            count=$((count + 1))
            if (( count % BACKUP_TRIGGER_LINES == 0 )); then
                append_app_log "[space] log lines reached ${count}, triggering backup..."
                backup_once "log-${count}" || echo "[space] log-trigger backup failed"
            fi
        done
    ) &
    LOG_WATCH_PID=$!
}

start_backup_heartbeat_loop() {
    if [ "${ENABLE_AUTO_BACKUP}" != "true" ]; then
        return
    fi
    BACKUP_HEARTBEAT_INTERVAL_SEC="$(safe_parse_positive_int "${BACKUP_HEARTBEAT_INTERVAL_SEC}" "60")"
    if [ "${BACKUP_HEARTBEAT_INTERVAL_SEC}" -lt 20 ]; then
        BACKUP_HEARTBEAT_INTERVAL_SEC=20
    fi
    append_app_log "[space] backup-heartbeat enabled: every ${BACKUP_HEARTBEAT_INTERVAL_SEC}s"
    (
        while true; do
            local last_backup_epoch=0
            local last_backup_human="never"
            local now_epoch
            now_epoch="$(date +%s)"
            if [ -f "${BACKUP_LAST_RUN_FILE}" ]; then
                last_backup_epoch="$(cat "${BACKUP_LAST_RUN_FILE}" 2>/dev/null || echo 0)"
            fi
            if [[ "${last_backup_epoch}" =~ ^[0-9]+$ ]] && [ "${last_backup_epoch}" -gt 0 ]; then
                last_backup_human="$(date -d "@${last_backup_epoch}" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "${last_backup_epoch}")"
            fi
            append_app_log "[backup-heartbeat] auto=${ENABLE_AUTO_BACKUP}, interval=${BACKUP_INTERVAL_MIN}m, trigger=${BACKUP_TRIGGER_LINES} lines, last=${last_backup_human}, now=${now_epoch}"
            sleep "${BACKUP_HEARTBEAT_INTERVAL_SEC}"
        done
    ) &
    BACKUP_HEARTBEAT_PID=$!
}

start_event_backup_watcher() {
    if [ "${ENABLE_AUTO_BACKUP}" != "true" ]; then
        return
    fi

    touch "${BACKUP_EVENT_FILE}" 2>/dev/null || true
    append_app_log "[space] event-based backup enabled: file=${BACKUP_EVENT_FILE}"
    (
        while true; do
            if [ -s "${BACKUP_EVENT_FILE}" ]; then
                local event_reason
                event_reason="$(tail -n1 "${BACKUP_EVENT_FILE}" 2>/dev/null | awk '{print $2}' | tr -cd '[:alnum:]_-')"
                if [ -z "${event_reason}" ]; then
                    event_reason="manual"
                fi
                : > "${BACKUP_EVENT_FILE}" 2>/dev/null || true
                append_app_log "[space] backup event received: ${event_reason}"
                backup_once "event-${event_reason}" || echo "[space] event-trigger backup failed"
            fi
            sleep 3
        done
    ) &
    EVENT_BACKUP_PID=$!
}

health_probe_once() {
    local name="$1"
    local url="$2"
    local status
    status="$(curl -sS -o /dev/null -w "%{http_code}" --max-time "${HEALTH_CHECK_TIMEOUT_SEC}" "${url}" 2>/dev/null || echo "000")"
    case "${status}" in
        200|301|302)
            append_app_log "[health] ${name} ok (${status}) ${url}"
            ;;
        *)
            append_app_log "[health] ${name} fail (${status}) ${url}"
            ;;
    esac
}

start_health_check_loop() {
    if [ "${ENABLE_HEALTH_CHECK_LOG}" != "true" ]; then
        return
    fi
    if ! [[ "${HEALTH_CHECK_INTERVAL_SEC}" =~ ^[0-9]+$ ]] || [ "${HEALTH_CHECK_INTERVAL_SEC}" -lt 5 ]; then
        HEALTH_CHECK_INTERVAL_SEC=30
    fi
    if ! [[ "${HEALTH_CHECK_TIMEOUT_SEC}" =~ ^[0-9]+$ ]] || [ "${HEALTH_CHECK_TIMEOUT_SEC}" -lt 1 ]; then
        HEALTH_CHECK_TIMEOUT_SEC=5
    fi

    append_app_log "[space] health-check loop enabled: every ${HEALTH_CHECK_INTERVAL_SEC}s"
    (
        while true; do
            health_probe_once "user-server" "${USER_HEALTH_URL}"
            health_probe_once "monopoly-server" "${MONOPOLY_HEALTH_URL}"
            health_probe_once "gateway" "${GATEWAY_HEALTH_URL}"
            sleep "${HEALTH_CHECK_INTERVAL_SEC}"
        done
    ) &
    HEALTH_CHECK_PID=$!
}

mkdir -p /run/mysqld "${MYSQL_DATA_DIR}" "${BACKUP_DIR}" "${AVATAR_STORE_DIR}"
chown -R mysql:mysql /run/mysqld "${MYSQL_DATA_DIR}"
write_runtime_ice_config || echo "[space] warning: write runtime ICE config failed"
prepare_avatar_storage

echo "[space] starting nginx on :7860..."
nginx -g "daemon off;" &
NGINX_PID=$!

echo "[space] starting mysql..."
if [ ! -d "${MYSQL_DATA_DIR}/mysql" ]; then
    mariadb-install-db --user=mysql --datadir="${MYSQL_DATA_DIR}" --auth-root-authentication-method=normal > /tmp/mariadb-init.log
fi

start_mysql

if ! mysql_socket -e "SELECT 1" >/dev/null 2>&1 && ! mysql_tcp -e "SELECT 1" >/dev/null 2>&1; then
    echo "[space] mysql root auth failed, reinitializing data dir..."
    kill "${MYSQL_PID}" || true
    wait "${MYSQL_PID}" || true
    rm -rf "${MYSQL_DATA_DIR}"/*
    mariadb-install-db --user=mysql --datadir="${MYSQL_DATA_DIR}" --auth-root-authentication-method=normal > /tmp/mariadb-init.log
    start_mysql
fi

if ! mysql_socket -e "SELECT 1" >/dev/null 2>&1 && ! mysql_tcp -e "SELECT 1" >/dev/null 2>&1; then
    echo "[space] mysql root auth still failed"
    exit 1
fi

mysql_exec -e "ALTER USER 'root'@'localhost' IDENTIFIED BY '${MYSQL_ROOT_PASSWORD}';" || true
mysql_exec -e "CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY '${MYSQL_ROOT_PASSWORD}';" || true
mysql_exec -e "GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;" || true
mysql_exec -e "CREATE USER IF NOT EXISTS '${MYSQL_USERNAME}'@'%' IDENTIFIED BY '${MYSQL_PASSWORD}';" || true
mysql_exec -e "GRANT ALL PRIVILEGES ON *.* TO '${MYSQL_USERNAME}'@'%' WITH GRANT OPTION;" || true
mysql_exec -e "FLUSH PRIVILEGES;"

mysql -h127.0.0.1 -P"${MYSQL_PORT}" -uroot "-p${MYSQL_ROOT_PASSWORD}" -e "CREATE DATABASE IF NOT EXISTS monopoly CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -h127.0.0.1 -P"${MYSQL_PORT}" -uroot "-p${MYSQL_ROOT_PASSWORD}" -e "CREATE DATABASE IF NOT EXISTS fatpaper_user CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

if is_repo_backup_enabled; then
    append_app_log "[space] backup repo enabled: type=${BACKUP_REPO_TYPE}, repo=${BACKUP_REPO}, branch=${BACKUP_BRANCH}"
    echo "[space] syncing backups from HF repo..."
    sync_backups_from_repo || echo "[space] backup repo sync failed"
else
    append_app_log "[space] backup repo disabled: missing BACKUP_REPO or HF token"
fi

RESTORE_APPLIED="false"
if [ "${RESTORE_BACKUP_ON_STARTUP}" = "true" ]; then
    if restore_latest_backup_if_exists; then
        RESTORE_APPLIED="true"
    else
        append_app_log "[space] no startup backup restored (archive missing or invalid)"
    fi
fi

if [ "${RESTORE_APPLIED}" != "true" ]; then
    TABLE_COUNT="$(mysql -h127.0.0.1 -P"${MYSQL_PORT}" -uroot "-p${MYSQL_ROOT_PASSWORD}" -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='monopoly' AND table_name='map';")"
    if [ "${TABLE_COUNT:-0}" = "0" ]; then
        append_app_log "[space] importing demo data monopoly.sql (first run)..."
        sed 's/utf8mb4_0900_ai_ci/utf8mb4_unicode_ci/g' /app/monopoly.sql | mysql -h127.0.0.1 -P"${MYSQL_PORT}" -uroot "-p${MYSQL_ROOT_PASSWORD}" monopoly
    fi
fi

mkdir -p "$(dirname "${APP_LOG_FILE}")"
touch "${APP_LOG_FILE}"
append_app_log "[space] runtime summary: healthLog=${ENABLE_HEALTH_CHECK_LOG}, healthInterval=${HEALTH_CHECK_INTERVAL_SEC}s, accessLog=${ENABLE_ACCESS_LOG}, backupAuto=${ENABLE_AUTO_BACKUP}, backupArchive=${BACKUP_ARCHIVE_NAME}, restoreOnStartup=${RESTORE_BACKUP_ON_STARTUP}, backupInterval=${BACKUP_INTERVAL_MIN}m, backupTrigger=${BACKUP_TRIGGER_LINES} lines, backupMinInterval=${BACKUP_MIN_INTERVAL_SEC}s, backupEventFile=${BACKUP_EVENT_FILE}, backupApi=${BACKUP_USE_HF_API}"

echo "[space] starting user-server..."
(
    cd /app/fatpaper-user-server
    node dist/fatpaper-user-server/app.js 2>&1 | sed -u 's/^/[user-server] /'
) | tee -a "${APP_LOG_FILE}" &
USER_SERVER_PID=$!

echo "[space] starting monopoly-server..."
(
    cd /app/monopoly-server
    node dist/monopoly-server/app.js 2>&1 | sed -u 's/^/[monopoly-server] /'
) | tee -a "${APP_LOG_FILE}" &
MONOPOLY_SERVER_PID=$!

wait_http_service "user-server" "http://127.0.0.1:83/health" 60 || true
wait_http_service "monopoly-server" "http://127.0.0.1:84/health" 60 || true

backup_once "startup" || echo "[space] startup backup failed"
start_interval_backup_loop
start_log_backup_watcher
start_backup_heartbeat_loop
start_event_backup_watcher
start_health_check_loop

wait -n "${MYSQL_PID}" "${USER_SERVER_PID}" "${MONOPOLY_SERVER_PID}" "${NGINX_PID}"
exit 1

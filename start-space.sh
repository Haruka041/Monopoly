#!/usr/bin/env bash
set -Eeuo pipefail
shopt -s nullglob

export NODE_ENV=production

export FATPAPER_DOMAIN="${FATPAPER_DOMAIN:-localhost}"
export PROTOCOL="${PROTOCOL:-https}"
export USE_PORT="${USE_PORT:-false}"
export USER_SERVER_PATH="${USER_SERVER_PATH:-user-server}"
export MONOPOLY_SERVER_PATH="${MONOPOLY_SERVER_PATH:-monopoly-server}"
export ICE_SERVER_PATH="${ICE_SERVER_PATH:-ice-server}"
export USER_SERVER_HOST="${USER_SERVER_HOST:-127.0.0.1}"

export MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
export MYSQL_PORT="${MYSQL_PORT:-3306}"
export MYSQL_USERNAME="${MYSQL_USERNAME:-root}"
export MYSQL_PASSWORD="${MYSQL_PASSWORD:-root}"
export MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-$MYSQL_PASSWORD}"

export ENABLE_AUTO_BACKUP="${ENABLE_AUTO_BACKUP:-true}"
export BACKUP_KEEP_COUNT="${BACKUP_KEEP_COUNT:-100}"
export BACKUP_INTERVAL_MIN="${BACKUP_INTERVAL_MIN:-0}"
export BACKUP_TRIGGER_LINES="${BACKUP_TRIGGER_LINES:-100}"
export BACKUP_REPO="${BACKUP_REPO:-}"
export BACKUP_REPO_TYPE="${BACKUP_REPO_TYPE:-dataset}"
export BACKUP_BRANCH="${BACKUP_BRANCH:-main}"
export BACKUP_HF_TOKEN="${BACKUP_HF_TOKEN:-${HF_TOKEN:-}}"
export BACKUP_HF_USERNAME="${BACKUP_HF_USERNAME:-${HF_USERNAME:-token}}"

if [ -d /data ]; then
    MYSQL_DATA_DIR="${MYSQL_DATA_DIR:-/data/mysql}"
    BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
else
    MYSQL_DATA_DIR="${MYSQL_DATA_DIR:-/var/lib/mysql}"
    BACKUP_DIR="${BACKUP_DIR:-/var/backups/monopoly}"
fi

BACKUP_REPO_DIR="${BACKUP_REPO_DIR:-/tmp/hf-backup-repo}"
BACKUP_REPO_DATA_DIR="${BACKUP_REPO_DATA_DIR:-${BACKUP_REPO_DIR}/db}"
BACKUP_LOCK_DIR="${BACKUP_LOCK_DIR:-/tmp/monopoly-backup-lock}"
APP_LOG_FILE="${APP_LOG_FILE:-/tmp/space-app.log}"
MYSQL_SOCKET="/run/mysqld/mysqld.sock"

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

start_mysql() {
    mysqld --user=mysql --datadir="$MYSQL_DATA_DIR" --socket="$MYSQL_SOCKET" --port="$MYSQL_PORT" --bind-address=127.0.0.1 &
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
    echo "${repo_url/https:\/\//https://${BACKUP_HF_USERNAME}:${BACKUP_HF_TOKEN}@}"
}

ensure_backup_repo() {
    if ! is_repo_backup_enabled; then
        return 1
    fi

    local remote_url
    remote_url="$(build_backup_remote_url)"

    if [ ! -d "${BACKUP_REPO_DIR}/.git" ]; then
        rm -rf "${BACKUP_REPO_DIR}"
        if ! git clone --depth 1 --branch "${BACKUP_BRANCH}" "${remote_url}" "${BACKUP_REPO_DIR}" >/dev/null 2>&1; then
            if ! git clone "${remote_url}" "${BACKUP_REPO_DIR}" >/dev/null 2>&1; then
                echo "[space] backup repo clone failed"
                return 1
            fi
            git -C "${BACKUP_REPO_DIR}" checkout -B "${BACKUP_BRANCH}" >/dev/null 2>&1 || true
        fi
    else
        git -C "${BACKUP_REPO_DIR}" remote set-url origin "${remote_url}" >/dev/null 2>&1 || true
        git -C "${BACKUP_REPO_DIR}" fetch origin "${BACKUP_BRANCH}" >/dev/null 2>&1 || true
        git -C "${BACKUP_REPO_DIR}" checkout "${BACKUP_BRANCH}" >/dev/null 2>&1 || git -C "${BACKUP_REPO_DIR}" checkout -b "${BACKUP_BRANCH}" >/dev/null 2>&1 || true
        git -C "${BACKUP_REPO_DIR}" pull --rebase origin "${BACKUP_BRANCH}" >/dev/null 2>&1 || true
    fi

    git -C "${BACKUP_REPO_DIR}" config user.email "space-backup@local" >/dev/null 2>&1 || true
    git -C "${BACKUP_REPO_DIR}" config user.name "space-backup-bot" >/dev/null 2>&1 || true
    mkdir -p "${BACKUP_REPO_DATA_DIR}"
    return 0
}

prune_backup_dir() {
    local target_dir="$1"
    local keep_count="$2"
    local mono_files=( "${target_dir}"/monopoly_*.sql "${target_dir}"/monopoly_*.sql.gz )
    local user_files=( "${target_dir}"/fatpaper_user_*.sql "${target_dir}"/fatpaper_user_*.sql.gz )

    if [ "${#mono_files[@]}" -gt "${keep_count}" ]; then
        mapfile -t mono_sorted < <(ls -1t "${mono_files[@]}")
        rm -f "${mono_sorted[@]:${keep_count}}"
    fi

    if [ "${#user_files[@]}" -gt "${keep_count}" ]; then
        mapfile -t user_sorted < <(ls -1t "${user_files[@]}")
        rm -f "${user_sorted[@]:${keep_count}}"
    fi
}

sync_backups_from_repo() {
    if ! ensure_backup_repo; then
        return 0
    fi
    cp -f "${BACKUP_REPO_DATA_DIR}"/monopoly_*.sql "${BACKUP_DIR}"/ 2>/dev/null || true
    cp -f "${BACKUP_REPO_DATA_DIR}"/fatpaper_user_*.sql "${BACKUP_DIR}"/ 2>/dev/null || true
    cp -f "${BACKUP_REPO_DATA_DIR}"/monopoly_*.sql.gz "${BACKUP_DIR}"/ 2>/dev/null || true
    cp -f "${BACKUP_REPO_DATA_DIR}"/fatpaper_user_*.sql.gz "${BACKUP_DIR}"/ 2>/dev/null || true
}

sync_backups_to_repo() {
    local reason="$1"
    local ts="$2"
    if ! ensure_backup_repo; then
        return 0
    fi

    cp -f "${BACKUP_DIR}"/monopoly_*.sql "${BACKUP_REPO_DATA_DIR}"/ 2>/dev/null || true
    cp -f "${BACKUP_DIR}"/fatpaper_user_*.sql "${BACKUP_REPO_DATA_DIR}"/ 2>/dev/null || true
    cp -f "${BACKUP_DIR}"/monopoly_*.sql.gz "${BACKUP_REPO_DATA_DIR}"/ 2>/dev/null || true
    cp -f "${BACKUP_DIR}"/fatpaper_user_*.sql.gz "${BACKUP_REPO_DATA_DIR}"/ 2>/dev/null || true
    prune_backup_dir "${BACKUP_REPO_DATA_DIR}" "${BACKUP_KEEP_COUNT}"

    git -C "${BACKUP_REPO_DIR}" add db >/dev/null 2>&1 || true
    if git -C "${BACKUP_REPO_DIR}" diff --cached --quiet; then
        return 0
    fi
    git -C "${BACKUP_REPO_DIR}" commit -m "backup: ${reason} ${ts}" >/dev/null 2>&1 || true
    git -C "${BACKUP_REPO_DIR}" push origin "${BACKUP_BRANCH}" >/dev/null 2>&1 || {
        echo "[space] backup repo push failed"
        return 1
    }
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

    if ! acquire_backup_lock; then
        echo "[space] backup skipped: lock busy"
        return 0
    fi

    set +e
    local rc=0
    local ts
    ts="$(date +%Y%m%d_%H%M%S)"
    mkdir -p "${BACKUP_DIR}"

    mysqldump -h127.0.0.1 -P"${MYSQL_PORT}" -uroot "-p${MYSQL_ROOT_PASSWORD}" --single-transaction --quick monopoly > "${BACKUP_DIR}/monopoly_${ts}.sql"
    if [ $? -ne 0 ]; then rc=1; fi
    mysqldump -h127.0.0.1 -P"${MYSQL_PORT}" -uroot "-p${MYSQL_ROOT_PASSWORD}" --single-transaction --quick fatpaper_user > "${BACKUP_DIR}/fatpaper_user_${ts}.sql"
    if [ $? -ne 0 ]; then rc=1; fi

    prune_backup_dir "${BACKUP_DIR}" "${BACKUP_KEEP_COUNT}"
    sync_backups_to_repo "${reason}" "${ts}" || rc=1

    release_backup_lock
    set -e
    return "${rc}"
}

restore_sql_into_db() {
    local db_name="$1"
    local dump_file="$2"
    if [[ "${dump_file}" == *.gz ]]; then
        gunzip -c "${dump_file}" | mysql -h127.0.0.1 -P"${MYSQL_PORT}" -uroot "-p${MYSQL_ROOT_PASSWORD}" "${db_name}"
    else
        mysql -h127.0.0.1 -P"${MYSQL_PORT}" -uroot "-p${MYSQL_ROOT_PASSWORD}" "${db_name}" < "${dump_file}"
    fi
}

restore_latest_backup_if_exists() {
    local mono_candidates=( "${BACKUP_DIR}"/monopoly_*.sql "${BACKUP_DIR}"/monopoly_*.sql.gz )
    local user_candidates=( "${BACKUP_DIR}"/fatpaper_user_*.sql "${BACKUP_DIR}"/fatpaper_user_*.sql.gz )
    local latest_mono=""
    local latest_user=""
    local ts=""

    if [ "${#mono_candidates[@]}" -eq 0 ]; then
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

    echo "[space] restoring backup: ${latest_mono}"
    restore_sql_into_db "monopoly" "${latest_mono}"
    if [ -n "${latest_user}" ]; then
        echo "[space] restoring backup: ${latest_user}"
        restore_sql_into_db "fatpaper_user" "${latest_user}"
    fi
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

    echo "[space] log-based backup enabled: every ${BACKUP_TRIGGER_LINES} lines"
    (
        local count=0
        tail -n0 -F "${APP_LOG_FILE}" 2>/dev/null | while IFS= read -r _line; do
            count=$((count + 1))
            if (( count % BACKUP_TRIGGER_LINES == 0 )); then
                echo "[space] log lines reached ${count}, triggering backup..."
                backup_once "log-${count}" || echo "[space] log-trigger backup failed"
            fi
        done
    ) &
    LOG_WATCH_PID=$!
}

echo "[space] starting mysql..."
mkdir -p /run/mysqld "${MYSQL_DATA_DIR}" "${BACKUP_DIR}"
chown -R mysql:mysql /run/mysqld "${MYSQL_DATA_DIR}"

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
    echo "[space] syncing backups from HF repo..."
    sync_backups_from_repo || echo "[space] backup repo sync failed"
fi

TABLE_COUNT="$(mysql -h127.0.0.1 -P"${MYSQL_PORT}" -uroot "-p${MYSQL_ROOT_PASSWORD}" -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='monopoly' AND table_name='map';")"
if [ "${TABLE_COUNT:-0}" = "0" ]; then
    if ! restore_latest_backup_if_exists; then
        echo "[space] importing demo data monopoly.sql (first run)..."
        sed 's/utf8mb4_0900_ai_ci/utf8mb4_unicode_ci/g' /app/monopoly.sql | mysql -h127.0.0.1 -P"${MYSQL_PORT}" -uroot "-p${MYSQL_ROOT_PASSWORD}" monopoly
    fi
fi

backup_once "startup" || echo "[space] startup backup failed"
start_interval_backup_loop

mkdir -p "$(dirname "${APP_LOG_FILE}")"
: > "${APP_LOG_FILE}"
start_log_backup_watcher

echo "[space] starting user-server..."
(
    cd /app/fatpaper-user-server
    npm run start 2>&1 | sed -u 's/^/[user-server] /'
) | tee -a "${APP_LOG_FILE}" &
USER_SERVER_PID=$!

echo "[space] starting monopoly-server..."
(
    cd /app/monopoly-server
    npm run start 2>&1 | sed -u 's/^/[monopoly-server] /'
) | tee -a "${APP_LOG_FILE}" &
MONOPOLY_SERVER_PID=$!

for _ in $(seq 1 90); do
    if curl -fsS "http://127.0.0.1:83/health" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

for _ in $(seq 1 90); do
    if curl -fsS "http://127.0.0.1:84/health" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

echo "[space] starting nginx on :7860..."
nginx -g "daemon off;" &
NGINX_PID=$!

wait -n "${MYSQL_PID}" "${USER_SERVER_PID}" "${MONOPOLY_SERVER_PID}" "${NGINX_PID}"
exit 1

#!/usr/bin/env bash
set -Eeuo pipefail

export NODE_ENV=production

export FATPAPER_DOMAIN="${FATPAPER_DOMAIN:-localhost}"
export PROTOCOL="${PROTOCOL:-https}"
export USE_PORT="${USE_PORT:-false}"
export USER_SERVER_PATH="${USER_SERVER_PATH:-user-server}"
export MONOPOLY_SERVER_PATH="${MONOPOLY_SERVER_PATH:-monopoly-server}"
export ICE_SERVER_PATH="${ICE_SERVER_PATH:-ice-server}"

export MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
export MYSQL_PORT="${MYSQL_PORT:-3306}"
export MYSQL_USERNAME="${MYSQL_USERNAME:-root}"
export MYSQL_PASSWORD="${MYSQL_PASSWORD:-root}"
export MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-$MYSQL_PASSWORD}"
export ENABLE_AUTO_BACKUP="${ENABLE_AUTO_BACKUP:-true}"
export BACKUP_INTERVAL_MIN="${BACKUP_INTERVAL_MIN:-60}"
export BACKUP_KEEP_COUNT="${BACKUP_KEEP_COUNT:-24}"

if [ -d /data ]; then
    MYSQL_DATA_DIR="${MYSQL_DATA_DIR:-/data/mysql}"
    BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
else
    MYSQL_DATA_DIR="${MYSQL_DATA_DIR:-/var/lib/mysql}"
    BACKUP_DIR="${BACKUP_DIR:-/var/backups/monopoly}"
fi

MYSQL_SOCKET="/run/mysqld/mysqld.sock"

cleanup() {
    echo "[space] shutting down services..."
    pkill -f "node dist/fatpaper-user-server/app.js" || true
    pkill -f "node dist/monopoly-server/app.js" || true
    pkill -f "nginx: master process" || true
    pkill -f "mysqld" || true
    if [ -n "${BACKUP_PID:-}" ]; then
        kill "${BACKUP_PID}" >/dev/null 2>&1 || true
    fi
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

backup_once() {
    mkdir -p "$BACKUP_DIR"
    local ts
    ts="$(date +%Y%m%d_%H%M%S)"

    mysqldump -h127.0.0.1 -P"$MYSQL_PORT" -uroot "-p${MYSQL_ROOT_PASSWORD}" --single-transaction --quick monopoly \
        | gzip -c > "${BACKUP_DIR}/monopoly_${ts}.sql.gz"
    mysqldump -h127.0.0.1 -P"$MYSQL_PORT" -uroot "-p${MYSQL_ROOT_PASSWORD}" --single-transaction --quick fatpaper_user \
        | gzip -c > "${BACKUP_DIR}/fatpaper_user_${ts}.sql.gz"

    local keep_from
    keep_from=$((BACKUP_KEEP_COUNT + 1))
    mapfile -t old_mono < <(ls -1t "${BACKUP_DIR}"/monopoly_*.sql.gz 2>/dev/null | tail -n +"${keep_from}" || true)
    mapfile -t old_user < <(ls -1t "${BACKUP_DIR}"/fatpaper_user_*.sql.gz 2>/dev/null | tail -n +"${keep_from}" || true)
    if [ "${#old_mono[@]}" -gt 0 ]; then rm -f "${old_mono[@]}"; fi
    if [ "${#old_user[@]}" -gt 0 ]; then rm -f "${old_user[@]}"; fi
}

start_backup_loop() {
    if [ "${ENABLE_AUTO_BACKUP}" != "true" ]; then
        echo "[space] auto backup disabled"
        return
    fi
    echo "[space] auto backup enabled: dir=${BACKUP_DIR}, interval=${BACKUP_INTERVAL_MIN}m, keep=${BACKUP_KEEP_COUNT}"
    (
        while true; do
            sleep "${BACKUP_INTERVAL_MIN}m"
            backup_once || echo "[space] backup failed"
        done
    ) &
    BACKUP_PID=$!
}

echo "[space] starting mysql..."
mkdir -p /run/mysqld "$MYSQL_DATA_DIR" "$BACKUP_DIR"
chown -R mysql:mysql /run/mysqld "$MYSQL_DATA_DIR"

if [ ! -d "${MYSQL_DATA_DIR}/mysql" ]; then
    mariadb-install-db --user=mysql --datadir="$MYSQL_DATA_DIR" --auth-root-authentication-method=normal > /tmp/mariadb-init.log
fi

start_mysql

if ! mysql_socket -e "SELECT 1" >/dev/null 2>&1 && ! mysql_tcp -e "SELECT 1" >/dev/null 2>&1; then
    echo "[space] mysql root auth failed, reinitializing data dir..."
    kill "$MYSQL_PID" || true
    wait "$MYSQL_PID" || true
    rm -rf "${MYSQL_DATA_DIR}"/*
    mariadb-install-db --user=mysql --datadir="$MYSQL_DATA_DIR" --auth-root-authentication-method=normal > /tmp/mariadb-init.log
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

mysql -h127.0.0.1 -P"$MYSQL_PORT" -uroot "-p${MYSQL_ROOT_PASSWORD}" -e "CREATE DATABASE IF NOT EXISTS monopoly CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -h127.0.0.1 -P"$MYSQL_PORT" -uroot "-p${MYSQL_ROOT_PASSWORD}" -e "CREATE DATABASE IF NOT EXISTS fatpaper_user CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

TABLE_COUNT="$(mysql -h127.0.0.1 -P"$MYSQL_PORT" -uroot "-p${MYSQL_ROOT_PASSWORD}" -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='monopoly' AND table_name='map';")"
if [ "${TABLE_COUNT:-0}" = "0" ]; then
    echo "[space] importing demo data monopoly.sql (first run)..."
    mysql -h127.0.0.1 -P"$MYSQL_PORT" -uroot "-p${MYSQL_ROOT_PASSWORD}" monopoly < /app/monopoly.sql
fi

backup_once || echo "[space] initial backup failed"
start_backup_loop

echo "[space] starting user-server..."
(
    cd /app/fatpaper-user-server
    npm run start
) &
USER_SERVER_PID=$!

echo "[space] starting monopoly-server..."
(
    cd /app/monopoly-server
    npm run start
) &
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

wait -n "$MYSQL_PID" "$USER_SERVER_PID" "$MONOPOLY_SERVER_PID" "$NGINX_PID"
exit 1

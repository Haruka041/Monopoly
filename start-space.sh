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

MYSQL_SOCKET="/run/mysqld/mysqld.sock"

cleanup() {
    echo "[space] shutting down services..."
    pkill -f "node dist/fatpaper-user-server/app.js" || true
    pkill -f "node dist/monopoly-server/app.js" || true
    pkill -f "nginx: master process" || true
    pkill -f "mysqld" || true
}
trap cleanup EXIT INT TERM

echo "[space] starting mysql..."
mkdir -p /run/mysqld /var/lib/mysql
chown -R mysql:mysql /run/mysqld /var/lib/mysql

if [ ! -d /var/lib/mysql/mysql ]; then
    mariadb-install-db --user=mysql --datadir=/var/lib/mysql > /tmp/mariadb-init.log
fi

mysqld --user=mysql --datadir=/var/lib/mysql --socket="$MYSQL_SOCKET" --port="$MYSQL_PORT" --bind-address=127.0.0.1 &
MYSQL_PID=$!

for _ in $(seq 1 90); do
    if mysqladmin --protocol=socket --socket="$MYSQL_SOCKET" ping --silent >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

if ! mysqladmin --protocol=socket --socket="$MYSQL_SOCKET" ping --silent >/dev/null 2>&1; then
    echo "[space] mysql startup failed"
    exit 1
fi

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

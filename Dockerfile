FROM node:16-bullseye AS source
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

COPY . .

RUN set -eux; \
    if [ ! -f fatpaper-login/package.json ]; then rm -rf fatpaper-login && git clone --depth 1 --branch main https://github.com/FatPaper-1874/fatpaper-login.git fatpaper-login; fi; \
    if [ ! -f fatpaper-user-server/package.json ]; then rm -rf fatpaper-user-server && git clone --depth 1 --branch main https://github.com/FatPaper-1874/fatpaper-user-server.git fatpaper-user-server; fi; \
    if [ ! -f monopoly-admin/package.json ]; then rm -rf monopoly-admin && git clone --depth 1 --branch main https://github.com/FatPaper-1874/monopoly-admin.git monopoly-admin; fi; \
    if [ ! -f monopoly-client/package.json ]; then rm -rf monopoly-client && git clone --depth 1 --branch main-p2p https://github.com/FatPaper-1874/monopoly-client.git monopoly-client; fi; \
    if [ ! -f monopoly-server/package.json ]; then rm -rf monopoly-server && git clone --depth 1 --branch main-p2p https://github.com/FatPaper-1874/monopoly-server.git monopoly-server; fi

FROM source AS web-build
WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com/

RUN cd /app/fatpaper-login && npm ci && npm run build
RUN cd /app/monopoly-client && npm ci && npm run build
RUN cd /app/monopoly-admin && npm ci && npm run build

FROM node:16-bullseye
WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends nginx mariadb-server curl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=source /app /app

RUN cd /app/fatpaper-user-server && npm ci
RUN cd /app/monopoly-server && npm ci

RUN rm -rf /var/www/html && mkdir -p /var/www/monopoly-client /var/www/81 /var/www/82
COPY --from=web-build /app/monopoly-client/dist /var/www/monopoly-client
COPY --from=web-build /app/fatpaper-login/dist /var/www/81
COPY --from=web-build /app/monopoly-admin/dist /var/www/82

COPY --from=source /app/conf/nginx.space.conf /etc/nginx/nginx.conf
COPY --from=source /app/start-space.sh /usr/local/bin/start-space.sh

RUN chmod +x /usr/local/bin/start-space.sh && \
    mkdir -p /run/mysqld /var/lib/mysql /app/monopoly-server/public /app/fatpaper-user-server/public && \
    chown -R mysql:mysql /run/mysqld /var/lib/mysql

EXPOSE 7860

CMD ["/usr/local/bin/start-space.sh"]

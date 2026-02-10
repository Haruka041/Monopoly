FROM node:16-bullseye AS source
WORKDIR /app

COPY . .

FROM source AS web-build
WORKDIR /app

ENV NODE_OPTIONS=--max_old_space_size=4096
ENV NPM_CONFIG_AUDIT=false
ENV NPM_CONFIG_FUND=false
RUN npm config set registry https://registry.npmjs.org/

RUN cd /app/fatpaper-login && npm install --legacy-peer-deps && npm run build
RUN cd /app/monopoly-client && npm install --legacy-peer-deps && npm run build
RUN cd /app/monopoly-admin && npm install --legacy-peer-deps && npm run build

FROM node:16-bullseye
WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends nginx mariadb-server curl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=source /app /app

RUN cd /app/fatpaper-user-server && npm install --legacy-peer-deps
RUN cd /app/monopoly-server && npm install --legacy-peer-deps

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

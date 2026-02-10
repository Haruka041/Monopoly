# Hugging Face Space 一键部署指南

这份仓库已经改成 `Docker Space` 可直接启动。你只需要：

1. 创建一个 Hugging Face Space（SDK 选 `Docker`）
2. 把本仓库代码推送到该 Space
3. 在 Space 的 `Settings -> Variables and secrets` 填变量
4. 配置 Cloudflare Worker 反代到 `*.hf.space`

## 1) 必填 Variables

- `FATPAPER_DOMAIN` = 你的 Cloudflare 域名（例如 `game.example.com`，不带 `https://`）
- `PROTOCOL` = `https`
- `USE_PORT` = `false`
- `USER_SERVER_PATH` = `user-server`
- `MONOPOLY_SERVER_PATH` = `monopoly-server`
- `ICE_SERVER_PATH` = `ice-server`

- `MYSQL_HOST` = `127.0.0.1`
- `MYSQL_PORT` = `3306`
- `MYSQL_USERNAME` = `root`

## 2) 必填 Secrets

- `MYSQL_PASSWORD` = 你的数据库密码
- `MYSQL_ROOT_PASSWORD` = 同上（建议与 `MYSQL_PASSWORD` 一致）

## 3) 可选 Secrets（腾讯云 COS）

不填就走本地存储（容器内）。

- `TC_SECRETID`
- `TC_SECRETKEY`
- `TC_BUCKET_NAME`
- `TC_REGION`

## 4) 数据持久化与自动备份（强烈建议）

- 免费 `cpu-basic` 的容器磁盘会重置，数据库数据可能丢失。
- 建议在 Space 开启 **Persistent Storage**（`/data` 路径）。
- 已内置自动备份，默认开启；备份文件会写到 `/data/backups`（无持久盘时是临时目录）。
- 启动时会尝试从 HF 备份仓库拉取并恢复最近备份。
- 默认每累计 `100` 行应用日志触发一次自动备份，并自动清理旧备份（默认保留 `100` 份）。

可选 Variables：

- `MYSQL_DATA_DIR`（默认：有 `/data` 时用 `/data/mysql`，否则 `/var/lib/mysql`）
- `BACKUP_DIR`（默认：有 `/data` 时用 `/data/backups`，否则 `/var/backups/monopoly`）
- `ENABLE_AUTO_BACKUP`（默认 `true`）
- `BACKUP_KEEP_COUNT`（默认 `100`）
- `BACKUP_TRIGGER_LINES`（默认 `100`）
- `BACKUP_INTERVAL_MIN`（默认 `0`，可选；>0 时按分钟额外定时备份）
- `BACKUP_REPO`（示例：`Haruka041/monopoly-backup`）
- `BACKUP_REPO_TYPE`（`dataset`/`space`/`model`，默认 `dataset`）
- `BACKUP_BRANCH`（默认 `main`）
- `BACKUP_HF_USERNAME`（默认 `token`，可选）

可选 Secrets：

- `BACKUP_HF_TOKEN`（或直接复用 `HF_TOKEN`）

## 5) Cloudflare Worker

参考根目录 `cloudflare-worker-example.js`，只需要改：

- `targetHostname` 改成你的 Space 原始域名（例如 `xxx.hf.space`）

然后把你的自定义域名（B）接到这个 Worker Route。

## 6) 注意事项

- 这个项目多人联机依赖 `/ice-server`，Worker 必须支持 websocket 透传。
- 若 `monopoly.sql` 中外链资源出现 403，请替换成你自己的资源地址。
- Space 空闲可能休眠，首次进入会冷启动。

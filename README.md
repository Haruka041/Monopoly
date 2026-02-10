---
title: Monopoly Multiplayer
emoji: 🎲
colorFrom: yellow
colorTo: blue
sdk: docker
app_port: 7860
---

联机大富翁
=====
大富翁总项目，支持使用 docker 运行。
>全局配置请到根目录的`global.config.ts`中修改。

#### Hugging Face Space 部署
直接看 `HF_SPACE_SETUP.md`（已包含 Variables/Secrets 列表和 Cloudflare Worker 模板）

#### 小白食用教程（windows下使用docker desktop部署，使用镜像源免魔法）
教程: https://note.youdao.com/s/1fUq7glx

#### 注意⚠️
1. 在非 localhost 网络环境下部署时需要将 `global.config.ts` 里的域名配置改为对应地址。
2. 搭建非本地环境时如果出现资源 403/跨域，请在管理端替换为你自己的资源地址（`monopoly.sql` 里包含演示资源链接）。

#### 拉取项目
```
git clone <your-repo-url>
```
#### 文件目录结构
项目目录结构如下
```
├─📁 conf--------------------------- # docker启动时需要的配置文件
│ ├─📁 sql
│ │ └─📄 init.sql------------------- # 初始数据库的sql命令
│ ├─📄 my.cnf----------------------- # mysql配置文件
│ └─📄 nginx.conf------------------- # nginx配置文件
├─📄 .dockerignore
├─📄 .gitignore
├─📄 docker-compose-local.yml------- # docker-compose文件，用于在docker启动项目
├─📄 dockerfile-monopoly-server----- # 大富翁服务器的docker文件
├─📄 dockerfile-user-server--------- # 用户服务器的docker文件
├─📄 dockerfile-web----------------- # 前端web网页的docker文件
├─📄 global.config.ts--------------- # 全局配置文件
├─📄 LICENSE
├─📄 monopoly.sql------------------- # 演示视频中使用到的演示数据
├─📄 quick-dev-start.bat------------ # 以命令行的方式快速启动
├─📄 quick-docker-build.bat--------- # docker快速打包项目
├─📄 quick-docker-start.bat--------- # docker快速运行项目
├─📄 README.md
├─📄 tencent-cloud.ts--------------- # 腾讯云COS的配置，可以不填写
└─📄 user-server-health-check.js---- # 健康检查js，用于docker-compose顺序启动
```

#### 跑起来的方法
* ##### 使用原生方法安装（开发时）
1. 环境中要有mysql，运行根目录的`monopoly.sql`文件；
2. 到各个模块目录使用`yarn`安装依赖；
3. 可以在各个模块中使用`yarn dev`分别启动项目，也可以直接启动根目录的`quick-dev-start.bat`一键启动；

* ##### 使用docker启动
1. 环境中要安装docker；
2. 使用魔法🧙‍♀️；
3. 启动`quick-docker-start.bat`一键启动；

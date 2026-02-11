import "reflect-metadata";
import AppDataSource from "./src/utils/db/dbConnecter";
import express, { RequestHandler } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import routerUser from "./src/routers/user";
import {serverLog} from "./src/utils/logger";
import chalk from "chalk";
import {APIPORT} from "./src/static";

const enableAccessLog = process.env.ENABLE_ACCESS_LOG !== "false";

const accessLogMiddleware: RequestHandler = (req, res, next) => {
	const start = Date.now();
	res.on("finish", () => {
		serverLog(
			`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`,
			"http"
		);
	});
	next();
};

const normalizeLegacyProxyPath: RequestHandler = (req, _res, next) => {
	// Allow stale/cached clients or proxy rewrites that include duplicated prefixes.
	if (req.url.startsWith("/user-server/")) {
		req.url = req.url.replace(/^\/user-server/, "");
	} else if (req.url === "/user-server") {
		req.url = "/";
	}
	next();
};

async function bootstrap() {
    try {
        await AppDataSource.initialize().then(() => {
            serverLog(`${chalk.bold.bgGreen(" 数据库连接成功 ")}`);
        });

        // await redisClientInit().then(() => {
        // 	serverLog(`${chalk.bold.bgGreen(" Redis连接成功 ")}`);
        // });

        const app = express();

        app.use(cors());

        app.use("/static", express.static("public"));

        app.use(normalizeLegacyProxyPath);

        // app.use(roleValidation);

        app.use(bodyParser.json());
        if (enableAccessLog) {
            app.use(accessLogMiddleware);
            serverLog(`${chalk.bold.bgGreen(" HTTP访问日志已开启 ")}`);
        } else {
            serverLog(`${chalk.bold.bgYellow(" HTTP访问日志已关闭 ")}`, "warn");
        }

        app.use("/user", routerUser);

        app.get('/health', (req, res) => {
            // 在这里进行服务的健康检查，返回适当的响应
            // 为了配合docker-compose按顺序启动
            res.status(200).send('OK');
        });

        app.listen(APIPORT, () => {
            serverLog(`${chalk.bold.bgGreen(` API服务启动成功 ${APIPORT}端口 `)} `);
        });
    } catch (e: any) {
        serverLog(`${chalk.bold.bgRed(` 服务器出错: `)}`, "error");
        serverLog(`${chalk.bold.bgRed(e.message)}`, "error");
    }
}

bootstrap();

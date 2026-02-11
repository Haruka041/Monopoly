import "reflect-metadata";
import AppDataSource from "./src/db/dbConnecter";
import express, { ErrorRequestHandler, RequestHandler } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import routerModel from "./src/routers/model";
import { routerUser } from "./src/routers/user";
import { routerMap } from "./src/routers/map";
import { routerRole } from "./src/routers/role";
import { routerItemType } from "./src/routers/item-type";
import { routerMapItem } from "./src/routers/mapItem";
import { routerStreet } from "./src/routers/street";
import { routerProperty } from "./src/routers/property";
import { routerChanceCard } from "./src/routers/chance-card";
import { routerMusic } from "./src/routers/music";
import { roomRouter } from "./src/routers/room-router";
import { serverLog } from "./src/utils/logger";
import chalk from "chalk";
import { __APIPORT__, __USERSERVERHOST__ } from "./global.config";
import { getPublicKey } from "./src/utils/api/keys";
import { roleValidation } from "./src/utils/role-validation";
import { routerArrivedEvent } from "./src/routers/arrived-event";
import { createServer } from "http";
import { attachGameWsGateway } from "./src/ws/game-room-manager";

// import { roleValidation } from "./src/utils/role-validation";
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
	// Some stale browser bundles may accidentally include duplicated proxy prefixes
	// (e.g. /monopoly-server/monopoly-server/*). Normalize them server-side so
	// users can still play before cache refresh.
	if (req.url.startsWith("/monopoly-server/")) {
		req.url = req.url.replace(/^\/monopoly-server/, "");
	} else if (req.url === "/monopoly-server") {
		req.url = "/";
	}

	// Legacy/stale clients may route user-server paths through monopoly-server.
	// Normalize prefix so router-level fallback handlers can process them.
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

		const publicKey = await getPublicKey();
		serverLog(`${chalk.bold.bgGreen(" 用户服务器连接成功 ")}`);

		const app = express();

		app.use(cors());

		app.use("/static", express.static("public"));
		app.use(normalizeLegacyProxyPath);

		app.use(roleValidation); //身份验证

		app.use(bodyParser.json());
		if (enableAccessLog) {
			app.use(accessLogMiddleware);
			serverLog(`${chalk.bold.bgGreen(" HTTP访问日志已开启 ")}`);
		} else {
			serverLog(`${chalk.bold.bgYellow(" HTTP访问日志已关闭 ")}`, "warn");
		}

		app.use("/user", routerUser);
		app.use("/role", routerRole);
		app.use("/model", routerModel);
		app.use("/map", routerMap);
		app.use("/item-type", routerItemType);
		app.use("/arrived-event", routerArrivedEvent);
		app.use("/map-item", routerMapItem);
		app.use("/street", routerStreet);
		app.use("/property", routerProperty);
		app.use("/chance-card", routerChanceCard);
		app.use("/music", routerMusic);
		app.use("/room-router", roomRouter);

		app.get("/health", (req, res) => {
			// 在这里进行服务的健康检查，返回适当的响应
			// 为了配合docker-compose按顺序启动
			res.status(200).send("OK");
		});

		app.use(handleError);

		const httpServer = createServer(app);
		attachGameWsGateway(httpServer);

		httpServer.listen(__APIPORT__, () => {
			serverLog(`${chalk.bold.bgGreen(` API服务启动成功 ${__APIPORT__}端口`)}`);
		});
	} catch (e: any) {
		serverLog(`${chalk.bold.bgRed(` 服务器出错: `)}`, "error");
		console.log(e);
	}
}

bootstrap();

const handleError: ErrorRequestHandler = (err, req, res, next) => {
	console.error(err.stack);
	res.status(500).send(`服务器错误:${err.message}`);
};

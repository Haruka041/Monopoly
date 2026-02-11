import { Router } from "express";
import { roleValidation } from "../utils/role-validation";
import { ResInterface } from "../interfaces/res";
import { verToken } from "../utils/token";
import axios from "axios";
import { __USERSERVERHOST__ } from "../../global.config";

export const routerUser = Router();

routerUser.get("/info", async (req, res) => {
	const token = (req.headers.authorization as string | undefined) || (req.query.token as string | undefined) || "";
	try {
		const upstream = await axios.get(`${__USERSERVERHOST__}/user/info`, {
			params: token ? { token } : req.query,
			headers: token ? { Authorization: token } : {},
			timeout: 10000,
		});
		res.status(upstream.status).json(upstream.data);
	} catch (e: any) {
		const status = Number(e?.response?.status) || 500;
		const data =
			e?.response?.data ||
			(<ResInterface>{
				status,
				msg: e?.message || "获取用户信息失败",
			});
		res.status(status).json(data);
	}
});

routerUser.get("/is-admin", async (req, res, next) => {
	const token = req.headers.authorization;
	if (!token) {
		const resContent: ResInterface = {
			status: 401,
			msg: "没有携带token",
		};
		res.status(401).json(resContent);
		return;
	}
	const tokenInfo = await verToken(token);
	if (!tokenInfo) {
		const resContent: ResInterface = {
			status: 401,
			msg: "token解析失败",
		};
		res.status(401).json(resContent);
		return;
	}
	const isAdmin = tokenInfo.isAdmin;
	if (isAdmin) {
		const resContent: ResInterface = {
			status: 200,
			data: { isAdmin: true },
		};
		res.status(200).json(resContent);
	} else {
		const resContent: ResInterface = {
			status: 403,
			msg: "你不是管理员喔",
		};
		res.status(403).json(resContent);
	}
});

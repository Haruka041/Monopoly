import { __USERSERVER__ } from "@G/global.config";
import axios from "axios";

interface UserInfo {
	username: string;
	useraccount: string;
	id: string;
	avatar: string;
	color: string;
}
2;

export async function getUserByToken(token: string) {
	const authToken = token || localStorage.getItem("token") || "";
	const res = await axios.get(`${__USERSERVER__}/user/info`, {
		params: { token: authToken },
		headers: authToken ? { Authorization: authToken } : {},
	});
	return res.data as UserInfo;
}

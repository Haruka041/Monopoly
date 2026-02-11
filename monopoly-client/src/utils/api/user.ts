import { __USERSERVER__ } from "@G/global.config";
import axios from "axios";

export interface UserInfo {
	username: string;
	useraccount: string;
	id: string;
	avatar: string;
	color: string;
}

export async function getUserByToken(token: string) {
	const authToken = token || localStorage.getItem("token") || "";
	const res = await axios.get(`${__USERSERVER__}/user/info`, {
		params: { token: authToken },
		headers: authToken ? { Authorization: authToken } : {},
	});
	return res.data as UserInfo;
}

export async function updateMyProfile(payload: {
	username?: string;
	color?: string;
	avatarFile?: File;
}) {
	const token = localStorage.getItem("token") || "";
	const formData = new FormData();
	if (payload.username !== undefined) formData.append("username", payload.username);
	if (payload.color !== undefined) formData.append("color", payload.color);
	if (payload.avatarFile) formData.append("avatar", payload.avatarFile);
	const res = await axios.post(`${__USERSERVER__}/user/profile/update`, formData, {
		headers: {
			...(token ? { Authorization: token } : {}),
			"Content-Type": "multipart/form-data",
		},
	});
	return (res.data?.data || res.data) as UserInfo;
}

export async function changeMyPassword(oldPassword: string, newPassword: string) {
	const token = localStorage.getItem("token") || "";
	const res = await axios.post(
		`${__USERSERVER__}/user/profile/change-password`,
		{ oldPassword, newPassword },
		{
			headers: token ? { Authorization: token } : {},
		}
	);
	return res.data;
}

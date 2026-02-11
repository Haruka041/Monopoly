import { __MONOPOLYSERVER__ } from "@G/global.config";
import axios from "axios";

const getAuthHeaders = () => {
	const token = localStorage.getItem("token");
	return token ? { Authorization: token } : {};
};

export async function joinRoomApi(roomId: string) {
	const res = (await axios.get(`${__MONOPOLYSERVER__}/room-router/join`, {
		params: { roomId },
		headers: getAuthHeaders(),
	})) as any;

	// 200: { status, data: {...} }
	if (res?.data) {
		const { hostPeerId = "", needCreate = false, deleteIntervalMs = 0, wsPath = "/monopoly-server/ws/game" } = res.data;
		return { hostPeerId, needCreate, deleteIntervalMs, wsPath };
	}

	throw new Error(res?.msg || "连接房间服务器失败");
}

export async function emitHostPeerId(roomId: string, hostPeerId: string, hostName: string, hostId: string) {
	await axios.post(
		`${__MONOPOLYSERVER__}/room-router/emit-host`,
		{ roomId, hostPeerId, hostName, hostId },
		{ headers: getAuthHeaders() }
	);
}

export async function emitRoomHeart(roomId: string) {
	await axios.get(`${__MONOPOLYSERVER__}/room-router/heart`, {
		params: { roomId },
		headers: getAuthHeaders(),
	});
}

export function deleteRoom(roomId: string) {
	navigator.sendBeacon(`${__MONOPOLYSERVER__}/room-router/delete?roomId=${roomId}`);
}

export async function getRandomPublicRoom() {
	return (await axios.get(`${__MONOPOLYSERVER__}/room-router/random-public-room`, { headers: getAuthHeaders() })) as {
		roomId: string;
	};
}

export async function setRoomPrivate(roomId: string, isPrivate: boolean) {
	return (await axios.post(
		`${__MONOPOLYSERVER__}/room-router/set-private`,
		{ roomId, isPrivate },
		{ headers: getAuthHeaders() }
	)) as { roomId: string; isPrivate: boolean };
}

export async function setRoomStarted(roomId: string, isStarted: boolean) {
	return (await axios.post(
		`${__MONOPOLYSERVER__}/room-router/set-started`,
		{ roomId, isStarted },
		{ headers: getAuthHeaders() }
	)) as { roomId: string; isStarted: boolean };
}

import { Router } from "express";
import { ResInterface } from "../interfaces/res";
import { getGameRoomManager } from "../ws/game-room-manager";

export const roomRouter = Router();

const roomManager = getGameRoomManager();

roomRouter.get("/join", async (req, res) => {
	const { roomId } = req.query as { roomId?: string };
	if (!roomId || roomId.length < 1 || roomId.length > 12) {
		const resMsg: ResInterface = {
			status: 400,
			msg: "RoomId不符合标准",
		};
		res.status(resMsg.status).json(resMsg);
		return;
	}

	const existed = roomManager.hasRoom(roomId);
	await roomManager.ensureRoom(roomId);
	const resMsg: ResInterface = {
		status: 200,
		data: {
			needCreate: !existed,
			hostPeerId: "",
			wsPath: "/monopoly-server/ws/game",
		},
	};
	res.status(resMsg.status).json(resMsg);
});

roomRouter.post("/emit-host", async (_req, res) => {
	// Legacy compatibility endpoint:
	// old clients used this to report host peer id.
	// In server-authoritative mode it's no longer needed.
	res.status(200).json(<ResInterface>{ status: 200 });
});

roomRouter.post("/delete", async (req, res) => {
	const { roomId } = req.query as { roomId?: string };
	if (!roomId) {
		res.status(400).json(<ResInterface>{ status: 400, msg: "RoomId不符合标准" });
		return;
	}
	roomManager.removeRoom(roomId, "http-delete");
	res.status(200).json(<ResInterface>{ status: 200 });
});

roomRouter.get("/heart", async (req, res) => {
	const { roomId } = req.query as { roomId?: string };
	if (roomId) {
		roomManager.touchRoom(roomId);
	}
	res.status(200).end();
});

roomRouter.get("/room-list", async (_req, res) => {
	res.status(200).json({
		data: roomManager.listRoomItems().map((item: any) => ({
			...item,
			hostPeerId: null,
		})),
	});
});

roomRouter.get("/random-public-room", async (_req, res) => {
	const roomArr = roomManager.listRoomItems().filter((r: any) => !r.isPrivate && !r.isStarted);
	if (roomArr.length > 0) {
		const randomIndex = Math.floor(Math.random() * roomArr.length);
		res.status(200).json({ roomId: roomArr[randomIndex].roomId });
	} else {
		res.status(200).json({ roomId: "" });
	}
});

roomRouter.post("/set-private", async (req, res) => {
	const { roomId, isPrivate } = req.body as { roomId?: string; isPrivate?: boolean };
	if (!roomId || typeof isPrivate !== "boolean") {
		res.status(400).json(<ResInterface>{ status: 400, msg: "参数错误" });
		return;
	}

	const ok = roomManager.setRoomPrivate(roomId, isPrivate);
	if (!ok) {
		res.status(400).json(<ResInterface>{ status: 400, msg: "不存在的房间" });
		return;
	}

	res.status(200).json(
		<ResInterface>{
			status: 200,
			msg: isPrivate ? "现在房间只能通过输入ID进入啦" : "已将房间公开",
			data: { roomId, isPrivate },
		}
	);
});

roomRouter.post("/set-started", async (req, res) => {
	const { roomId, isStarted } = req.body as { roomId?: string; isStarted?: boolean };
	if (!roomId || typeof isStarted !== "boolean") {
		res.status(400).json(<ResInterface>{ status: 400, msg: "参数错误" });
		return;
	}
	const ok = roomManager.setRoomStarted(roomId, isStarted);
	if (!ok) {
		res.status(400).json(<ResInterface>{ status: 400, msg: "不存在的房间" });
		return;
	}
	res.status(200).json(<ResInterface>{ status: 200 });
});

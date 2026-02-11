import { IncomingMessage } from "http";
import { RawData, WebSocketServer, WebSocket } from "ws";
import { createRecord } from "../db/api/game-record";
import { getMapById } from "../db/api/map";
import { getRoleList } from "../db/api/role";
import { ChangeRoleOperate, ChatMessageType, SocketMsgType } from "../enums/bace";
import { OperateType } from "../enums/game";
import { SocketMessage, User, UserInRoomInfo, Role, GameSetting, RoomInfo, ChatMessage, RoomListItem } from "../game-engine/types";
import { randomString } from "../utils";
import { serverLog } from "../utils/logger";
import { GameProcess } from "../game-engine/GameProcess";

type WsClient = WebSocket & {
	__roomId?: string;
	__userId?: string;
	__isAlive?: boolean;
};

type RoomUserSession = UserInRoomInfo & {
	ws: WsClient | null;
	isOffLine: boolean;
};

const ROOM_IDLE_MS = 5 * 60 * 1000;
const ROOM_CLEANUP_INTERVAL_MS = 60 * 1000;
const MAX_ROOM_PLAYERS = 6;
const GAME_WS_PATH = "/ws/game";

const DEFAULT_GAME_SETTING: GameSetting = {
	gameOverRule: 2,
	initMoney: 20000,
	multiplier: 0.5,
	multiplierIncreaseRounds: 4,
	roundTime: 20,
	mapId: "",
	diceNum: 2,
	chanceCardVisible: true,
	overMoney: 100000,
	slackOffMode: false,
};

const DEFAULT_ROLE: Role = {
	id: "default-role",
	baseUrl: "",
	roleName: "默认角色",
	fileName: "",
	color: "#ffffff",
};

function isWsOpen(ws: WebSocket | null | undefined) {
	return !!ws && ws.readyState === WebSocket.OPEN;
}

function parseJsonSafe(input: string): SocketMessage | null {
	try {
		return JSON.parse(input) as SocketMessage;
	} catch {
		return null;
	}
}

function toSocketMessage(
	type: SocketMsgType,
	data: any,
	roomId?: string,
	msg?: { type: "info" | "success" | "warning" | "error" | ""; content: string },
	extra?: any
): SocketMessage {
	return {
		type,
		source: "server",
		roomId,
		data,
		msg,
		extra,
	};
}

class GameRoom {
	private readonly roomId: string;
	private readonly createdAt: number;
	private ownerId = "";
	private readonly roleList: Role[];
	private readonly userMap = new Map<string, RoomUserSession>();
	private gameProcess: GameProcess | null = null;
	private gameSetting: GameSetting = { ...DEFAULT_GAME_SETTING };
	private isStarted = false;
	private isPrivate = true;
	private lastActiveTime = Date.now();

	constructor(roomId: string, roleList: Role[]) {
		this.roomId = roomId;
		this.roleList = roleList.length > 0 ? roleList : [DEFAULT_ROLE];
		this.createdAt = Date.now();
	}

	public getRoomId() {
		return this.roomId;
	}

	public getIsStarted() {
		return this.isStarted;
	}

	public getIsPrivate() {
		return this.isPrivate;
	}

	public getLastActiveTime() {
		return this.lastActiveTime;
	}

	public hasUser(userId: string) {
		return this.userMap.has(userId);
	}

	public getOwnerId() {
		return this.ownerId;
	}

	public getUsers() {
		return Array.from(this.userMap.values());
	}

	public touch() {
		this.lastActiveTime = Date.now();
	}

	public setPrivate(isPrivate: boolean) {
		this.isPrivate = isPrivate;
		this.touch();
	}

	public setStarted(isStarted: boolean) {
		this.isStarted = isStarted;
		this.touch();
	}

	public toRoomListItem(): RoomListItem {
		const owner = this.ownerId ? this.userMap.get(this.ownerId) : undefined;
		return {
			roomId: this.roomId,
			hostId: owner?.userId || "",
			hostName: owner?.username || "",
			isPrivate: this.isPrivate,
			isStarted: this.isStarted,
			createTime: this.createdAt,
			lastActiveTime: this.lastActiveTime,
		};
	}

	public join(user: User, ws: WsClient): { joined: boolean; roomEmpty: boolean } {
		this.touch();
		const existing = this.userMap.get(user.userId);
		if (existing) {
			existing.ws = ws;
			existing.isOffLine = false;
			ws.__userId = existing.userId;
			ws.__roomId = this.roomId;
			this.sendToSocket(
				ws,
				toSocketMessage(SocketMsgType.JoinRoom, { roomId: this.roomId }, this.roomId, {
					type: "success",
					content: "重新连接成功",
				})
			);
			this.roomInfoBroadcast();
			if (this.gameProcess) {
				this.gameProcess.handlePlayerReconnect(existing.userId);
				this.roomBroadcast(
					toSocketMessage(SocketMsgType.MsgNotify, "", this.roomId, {
						type: "success",
						content: `${existing.username} 重新连接`,
					})
				);
			}
			return { joined: true, roomEmpty: false };
		}

		if (this.userMap.size >= MAX_ROOM_PLAYERS) {
			this.sendToSocket(
				ws,
				toSocketMessage(SocketMsgType.MsgNotify, "", this.roomId, {
					type: "error",
					content: "该房间已经满人了",
				})
			);
			return { joined: false, roomEmpty: false };
		}

		const userInRoom: RoomUserSession = {
			...user,
			role: this.pickRandomRole(),
			isReady: false,
			ws,
			isOffLine: false,
		};
		this.userMap.set(user.userId, userInRoom);
		if (!this.ownerId) {
			this.ownerId = user.userId;
		}

		ws.__userId = user.userId;
		ws.__roomId = this.roomId;
		this.sendToSocket(
			ws,
			toSocketMessage(SocketMsgType.JoinRoom, { roomId: this.roomId }, this.roomId, {
				type: "success",
				content: "加入房间成功",
			})
		);
		this.roomBroadcast(
			toSocketMessage(SocketMsgType.MsgNotify, "", this.roomId, {
				type: "success",
				content: `${user.username} 加入了房间`,
			}),
			user.userId
		);
		this.roomInfoBroadcast();
		return { joined: true, roomEmpty: false };
	}

	public leave(userId: string, byDisconnect: boolean): boolean {
		const user = this.userMap.get(userId);
		if (!user) return this.userMap.size === 0;

		this.touch();
		if (this.isStarted) {
			user.isOffLine = true;
			user.ws = null;
			this.gameProcess?.handlePlayerOffline(userId);
			this.roomBroadcast(
				toSocketMessage(SocketMsgType.MsgNotify, "", this.roomId, {
					type: "warning",
					content: byDisconnect ? `${user.username} 断开连接` : `${user.username} 离开了房间`,
				})
			);
			this.roomInfoBroadcast();
			return this.userMap.size > 0 && this.userMap.values() && Array.from(this.userMap.values()).every((u) => u.isOffLine);
		}

		this.userMap.delete(userId);
		if (this.ownerId === userId) {
			const nextOwner = this.getUsers().find((u) => !u.isOffLine);
			this.ownerId = nextOwner?.userId || "";
		}

		if (this.userMap.size > 0) {
			this.roomBroadcast(
				toSocketMessage(SocketMsgType.MsgNotify, "", this.roomId, {
					type: "warning",
					content: `${user.username} 离开了房间`,
				})
			);
			this.roomInfoBroadcast();
		}
		return this.userMap.size === 0;
	}

	public handleMessage(userId: string, msg: SocketMessage) {
		this.touch();
		switch (msg.type) {
			case SocketMsgType.Heart:
				this.sendToUser(userId, toSocketMessage(SocketMsgType.Heart, "", this.roomId));
				break;
			case SocketMsgType.RoomChat:
				this.chatBroadcast(String(msg.data || ""), userId);
				break;
			case SocketMsgType.ReadyToggle:
				this.readyToggle(userId);
				break;
			case SocketMsgType.ChangeColor:
				this.changeColor(userId, String(msg.data || ""));
				break;
			case SocketMsgType.KickOut:
				this.kickOut(userId, String(msg.data || ""));
				break;
			case SocketMsgType.ChangeRole:
				this.changeRole(userId, Number(msg.data) as ChangeRoleOperate);
				break;
			case SocketMsgType.ChangeGameSetting:
				this.changeGameSetting(userId, msg.data as GameSetting);
				break;
			case SocketMsgType.GameStart:
				void this.startGame(userId);
				break;
			case SocketMsgType.GameInitFinished:
				this.emitOperationToGame(userId, OperateType.GameInitFinished);
				break;
			case SocketMsgType.RollDiceResult:
				this.emitOperationToGame(userId, OperateType.RollDice);
				break;
			case SocketMsgType.UseChanceCard: {
				const chanceCardId = String(msg.data || "");
				const target = msg.extra;
				if (!chanceCardId) return;
				if (target) {
					if (typeof target === "string") {
						this.emitOperationToGame(userId, OperateType.UseChanceCard, chanceCardId, [target]);
					} else if (Array.isArray(target)) {
						this.emitOperationToGame(userId, OperateType.UseChanceCard, chanceCardId, target);
					} else {
						this.emitOperationToGame(userId, OperateType.UseChanceCard, chanceCardId);
					}
				} else {
					this.emitOperationToGame(userId, OperateType.UseChanceCard, chanceCardId);
				}
				break;
			}
			case SocketMsgType.Animation:
				this.emitOperationToGame(userId, msg.data as OperateType | string);
				break;
			case SocketMsgType.BuyProperty:
				this.emitOperationToGame(userId, OperateType.BuyProperty, msg.extra);
				break;
			case SocketMsgType.BuildHouse:
				this.emitOperationToGame(userId, OperateType.BuildHouse, msg.extra);
				break;
			default:
				break;
		}
	}

	public handleLeaveMessage(userId: string) {
		this.sendToUser(userId, toSocketMessage(SocketMsgType.LeaveRoom, "", this.roomId));
		return this.leave(userId, false);
	}

	public destroy() {
		this.gameProcess?.destroy();
		this.gameProcess = null;
	}

	private pickRandomRole(): Role {
		const index = Math.floor(Math.random() * this.roleList.length);
		return this.roleList[index] || DEFAULT_ROLE;
	}

	private getRoomInfo(): RoomInfo {
		return {
			roomId: this.roomId,
			ownerId: this.ownerId,
			ownerName: this.userMap.get(this.ownerId)?.username || "",
			isStarted: this.isStarted,
			roleList: this.roleList,
			gameSetting: this.gameSetting,
			userList: this.getUsers().map((u) => {
				const { ws, isOffLine: _isOffLine, ...info } = u;
				return info;
			}),
		};
	}

	private roomInfoBroadcast() {
		this.roomBroadcast(toSocketMessage(SocketMsgType.RoomInfo, this.getRoomInfo(), this.roomId));
	}

	private roomBroadcast(msg: SocketMessage, exceptUserId?: string) {
		this.getUsers().forEach((user) => {
			if (exceptUserId && user.userId === exceptUserId) return;
			this.sendToSocket(user.ws, msg);
		});
	}

	private sendToUser(userId: string, msg: SocketMessage) {
		const user = this.userMap.get(userId);
		if (!user) return;
		this.sendToSocket(user.ws, msg);
	}

	private sendToUsers(userIdList: string[], msg: SocketMessage) {
		userIdList.forEach((id) => this.sendToUser(id, msg));
	}

	private sendToSocket(ws: WebSocket | null | undefined, msg: SocketMessage) {
		const socket = ws;
		if (!socket || socket.readyState !== WebSocket.OPEN) return;
		socket.send(JSON.stringify(msg));
	}

	private assertOwner(userId: string, actionName: string) {
		if (this.ownerId !== userId) {
			this.sendToUser(
				userId,
				toSocketMessage(SocketMsgType.MsgNotify, "", this.roomId, {
					type: "error",
					content: `${actionName} 失败：仅房主可执行`,
				})
			);
			return false;
		}
		return true;
	}

	private chatBroadcast(content: string, userId: string) {
		if (!content) return;
		const user = this.userMap.get(userId);
		if (!user) return;
		const { ws, isOffLine, ...userInfo } = user;
		const message: ChatMessage = {
			id: randomString(16),
			type: ChatMessageType.Text,
			content,
			user: userInfo,
			time: Date.now(),
		};
		this.roomBroadcast(toSocketMessage(SocketMsgType.RoomChat, message, this.roomId));
	}

	private readyToggle(userId: string) {
		const user = this.userMap.get(userId);
		if (!user) return;
		user.isReady = !user.isReady;
		this.roomInfoBroadcast();
	}

	private changeColor(userId: string, color: string) {
		const user = this.userMap.get(userId);
		if (!user || !color) return;
		user.color = color;
		this.roomInfoBroadcast();
	}

	private kickOut(requestUserId: string, targetUserId: string) {
		if (!this.assertOwner(requestUserId, "踢人")) return;
		if (!targetUserId || targetUserId === this.ownerId) return;
		const target = this.userMap.get(targetUserId);
		if (!target) return;
		this.sendToUser(
			targetUserId,
			toSocketMessage(SocketMsgType.KickOut, "", this.roomId, {
				type: "error",
				content: "你已被踢出房间",
			})
		);
		target.ws?.close(1000, "kicked");
		const roomEmpty = this.leave(targetUserId, false);
		if (roomEmpty) {
			this.destroy();
		}
	}

	private changeRole(userId: string, operate: ChangeRoleOperate) {
		const user = this.userMap.get(userId);
		if (!user) return;
		const roleIndex = this.roleList.findIndex((role) => role.id === user.role?.id);
		const currentIndex = roleIndex >= 0 ? roleIndex : 0;
		const newIndex =
			operate === ChangeRoleOperate.Next
				? currentIndex + 1 >= this.roleList.length
					? 0
					: currentIndex + 1
				: currentIndex - 1 < 0
				? this.roleList.length - 1
				: currentIndex - 1;
		user.role = this.roleList[newIndex] || DEFAULT_ROLE;
		this.roomInfoBroadcast();
	}

	private changeGameSetting(userId: string, gameSetting: GameSetting) {
		if (!this.assertOwner(userId, "修改设置")) return;
		this.gameSetting = {
			...this.gameSetting,
			...gameSetting,
		};
		this.roomInfoBroadcast();
		this.roomBroadcast(
			toSocketMessage(SocketMsgType.MsgNotify, "", this.roomId, {
				type: "info",
				content: "地图设置有变更",
			})
		);
	}

	private async startGame(userId: string) {
		if (!this.assertOwner(userId, "开始游戏")) return;
		if (this.isStarted || this.gameProcess) return;
		if (!this.gameSetting.mapId) {
			this.roomBroadcast(
				toSocketMessage(SocketMsgType.MsgNotify, "", this.roomId, {
					type: "warning",
					content: "请先选择地图",
				})
			);
			return;
		}
		const allReady = this.getUsers().every((u) => u.userId === this.ownerId || u.isReady);
		if (!allReady) {
			this.roomBroadcast(
				toSocketMessage(SocketMsgType.MsgNotify, "", this.roomId, {
					type: "warning",
					content: "有玩家未准备",
				})
			);
			return;
		}

		const mapInfo = await getMapById(this.gameSetting.mapId, false);
		if (!mapInfo) {
			this.roomBroadcast(
				toSocketMessage(SocketMsgType.MsgNotify, "", this.roomId, {
					type: "error",
					content: "加载地图失败，请重新选择地图",
				})
			);
			return;
		}

		this.isStarted = true;
		this.roomBroadcast(toSocketMessage(SocketMsgType.GameStart, "start", this.roomId));
		this.roomInfoBroadcast();

		const players = this.getUsers().map((u) => {
			const { ws, isOffLine: _isOffLine, ...player } = u;
			return player;
		});

		this.gameProcess = new GameProcess(mapInfo as any, this.gameSetting, players, this.ownerId, {
			sendToUsers: (userIdList, msg) => {
				this.sendToUsers(userIdList, msg);
			},
			onGameOver: () => {
				this.handleGameOver();
			},
		});

		this.gameProcess
			.start()
			.then(() => {
				serverLog(`[room:${this.roomId}] game process finished`, "info");
			})
			.catch((err) => {
				serverLog(`[room:${this.roomId}] game process crashed: ${err?.message || err}`, "error");
				this.roomBroadcast(
					toSocketMessage(SocketMsgType.MsgNotify, "", this.roomId, {
						type: "error",
						content: "游戏进程异常结束，请重新开始",
					})
				);
				this.handleGameOver();
			});
	}

	private emitOperationToGame(userId: string, operateType: OperateType | string, ...data: any[]) {
		if (!this.gameProcess) return;
		this.gameProcess.emitOperation(userId, operateType, ...data);
	}

	private handleGameOver() {
		this.isStarted = false;
		this.gameProcess?.destroy();
		this.gameProcess = null;
		this.getUsers().forEach((user) => {
			user.isReady = false;
		});
		this.roomInfoBroadcast();
	}
}

export class GameRoomManager {
	private readonly roomMap = new Map<string, GameRoom>();

	constructor() {
		setInterval(() => {
			this.cleanup();
		}, ROOM_CLEANUP_INTERVAL_MS);
	}

	public async ensureRoom(roomId: string) {
		if (!this.roomMap.has(roomId)) {
			const { roleList } = await getRoleList(-1, 0);
			this.roomMap.set(roomId, new GameRoom(roomId, roleList as unknown as Role[]));
		}
		return this.roomMap.get(roomId)!;
	}

	public getRoom(roomId: string) {
		return this.roomMap.get(roomId);
	}

	public hasRoom(roomId: string) {
		return this.roomMap.has(roomId);
	}

	public removeRoom(roomId: string, reason = "manual") {
		const room = this.roomMap.get(roomId);
		if (!room) return;
		room.destroy();
		const duration = Date.now() - room.toRoomListItem().createTime;
		void createRecord(roomId, duration).catch((err) => {
			serverLog(`[room:${roomId}] create record failed: ${err?.message || err}`, "warn");
		});
		this.roomMap.delete(roomId);
		serverLog(`[room:${roomId}] removed (${reason})`, "info");
	}

	public listRoomItems() {
		return Array.from(this.roomMap.values()).map((room) => room.toRoomListItem());
	}

	public touchRoom(roomId: string) {
		const room = this.roomMap.get(roomId);
		if (room) room.touch();
	}

	public setRoomPrivate(roomId: string, isPrivate: boolean) {
		const room = this.roomMap.get(roomId);
		if (!room) return false;
		room.setPrivate(isPrivate);
		return true;
	}

	public setRoomStarted(roomId: string, isStarted: boolean) {
		const room = this.roomMap.get(roomId);
		if (!room) return false;
		room.setStarted(isStarted);
		return true;
	}

	public async handleJoin(roomId: string, user: User, ws: WsClient) {
		const room = await this.ensureRoom(roomId);
		return room.join(user, ws);
	}

	public handleMessage(roomId: string, userId: string, msg: SocketMessage) {
		const room = this.roomMap.get(roomId);
		if (!room) return;
		room.handleMessage(userId, msg);
	}

	public handleLeave(roomId: string, userId: string) {
		const room = this.roomMap.get(roomId);
		if (!room) return;
		const shouldDelete = room.handleLeaveMessage(userId);
		if (shouldDelete) {
			this.removeRoom(roomId, "room-empty");
		}
	}

	public handleDisconnect(roomId: string, userId: string) {
		const room = this.roomMap.get(roomId);
		if (!room) return;
		const shouldDelete = room.leave(userId, true);
		if (shouldDelete && !room.getIsStarted()) {
			this.removeRoom(roomId, "all-left");
		}
	}

	private cleanup() {
		const now = Date.now();
		this.roomMap.forEach((room, roomId) => {
			const idle = now - room.getLastActiveTime();
			if (idle < ROOM_IDLE_MS) return;
			if (!room.getIsStarted()) {
				this.removeRoom(roomId, "idle");
				return;
			}
			const users = room.getUsers();
			if (users.length > 0 && users.every((u) => u.isOffLine)) {
				this.removeRoom(roomId, "all-offline");
			}
		});
	}
}

let singletonRoomManager: GameRoomManager | null = null;

export function getGameRoomManager() {
	if (!singletonRoomManager) {
		singletonRoomManager = new GameRoomManager();
	}
	return singletonRoomManager;
}

export function attachGameWsGateway(server: import("http").Server) {
	const roomManager = getGameRoomManager();
	const wss = new WebSocketServer({
		noServer: true,
		perMessageDeflate: false,
		maxPayload: 1024 * 1024,
	});

	const heartbeatTimer = setInterval(() => {
		wss.clients.forEach((client) => {
			const ws = client as WsClient;
			if (ws.__isAlive === false) {
				try {
					ws.terminate();
				} catch {}
				return;
			}
			ws.__isAlive = false;
			try {
				ws.ping();
			} catch {
				try {
					ws.terminate();
				} catch {}
			}
		});
	}, 30000);

	wss.on("close", () => {
		clearInterval(heartbeatTimer);
	});

	server.on("upgrade", (req: IncomingMessage, socket, head) => {
		const requestUrl = req.url || "";
		const parsed = new URL(requestUrl, "http://localhost");
		const pathname = parsed.pathname;
		if (!pathname.endsWith(GAME_WS_PATH)) {
			socket.destroy();
			return;
		}

		wss.handleUpgrade(req, socket, head, (ws) => {
			wss.emit("connection", ws, req);
		});
	});

	wss.on("connection", (rawWs, req) => {
		const ws = rawWs as WsClient;
		ws.__isAlive = true;
		const parsed = new URL(req.url || "", "http://localhost");
		const queryRoomId = parsed.searchParams.get("roomId") || "";

		if (queryRoomId) {
			ws.__roomId = queryRoomId;
		}

		ws.on("pong", () => {
			ws.__isAlive = true;
		});

		ws.on("message", async (payload: RawData) => {
			const msg = parseJsonSafe(payload.toString());
			if (!msg) {
				ws.send(
					JSON.stringify(
						toSocketMessage(SocketMsgType.MsgNotify, "", ws.__roomId, {
							type: "error",
							content: "消息格式错误",
						})
					)
				);
				return;
			}

			if (msg.type === SocketMsgType.JoinRoom) {
				const user = msg.data as User;
				const roomId = msg.roomId || ws.__roomId || "";
				if (!roomId || roomId.length > 12) {
					ws.send(
						JSON.stringify(
							toSocketMessage(SocketMsgType.MsgNotify, "", roomId, {
								type: "error",
								content: "不合法的房间ID",
							})
						)
					);
					return;
				}
				if (!user?.userId || !user?.username) {
					ws.send(
						JSON.stringify(
							toSocketMessage(SocketMsgType.MsgNotify, "", roomId, {
								type: "error",
								content: "缺少用户信息",
							})
						)
					);
					return;
				}
				const result = await roomManager.handleJoin(roomId, user, ws);
				if (!result.joined) return;
				return;
			}

			if (msg.type === SocketMsgType.LeaveRoom) {
				if (ws.__roomId && ws.__userId) {
					roomManager.handleLeave(ws.__roomId, ws.__userId);
					ws.close(1000, "leave-room");
				}
				return;
			}

			if (!ws.__roomId || !ws.__userId) {
				ws.send(
					JSON.stringify(
						toSocketMessage(SocketMsgType.MsgNotify, "", ws.__roomId, {
							type: "error",
							content: "尚未加入房间",
						})
					)
				);
				return;
			}
			roomManager.handleMessage(ws.__roomId, ws.__userId, msg);
		});

		ws.on("close", () => {
			ws.__isAlive = false;
			if (ws.__roomId && ws.__userId) {
				roomManager.handleDisconnect(ws.__roomId, ws.__userId);
			}
		});

		ws.on("error", () => {
			ws.__isAlive = false;
			if (ws.__roomId && ws.__userId) {
				roomManager.handleDisconnect(ws.__roomId, ws.__userId);
			}
		});
	});
}

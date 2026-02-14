import { ChangeRoleOperate, SocketMsgType } from "@/enums/bace";
import {
	ChatMessage,
	GameLog,
	GameSetting,
	Room,
	RoomInfo,
	SocketMessage,
	User,
} from "@/interfaces/bace";
import { debounce } from "@/utils";
import FPMessage from "@/components/utils/fp-message";
import {
	useChat,
	useGameInfo,
	useGameLog,
	useLoading,
	useMapData,
	useRoomInfo,
	useRoomList,
	useUserInfo,
	useUserList,
	useUtil,
} from "@/store";
import router from "@/router";
import { GameInfo, GameInitInfo, PropertyInfo, PlayerInfo } from "@/interfaces/game";
import useEventBus from "@/utils/event-bus";
import { createVNode } from "vue";
import PropertyInfoVue from "@/components/common/property-card.vue";
import { FPMessageBox } from "@/components/utils/fp-message-box";
import { OperateType } from "@/enums/game";
import { joinRoomApi } from "@/utils/api/room-router";
import { GameEvents } from "../../enums/game";
import { __MONOPOLYSERVER__ } from "@G/global.config";

type MonopolyClientOptions = {
	iceServer: {
		host: string;
		port: number;
	};
};

export class MonopolyClient {
	private userId: string | undefined;
	private roomId: string | undefined;
	private socketPath = `${__MONOPOLYSERVER__}/ws/game`;
	private socket: WebSocket | null = null;
	private manualClose = false;
	private reconnecting = false;
	private readonly reconnectMaxAttempts = 8;
	private readonly reconnectBaseDelayMs = 1200;

	private isOnline = false;

	private intervalList: any[] = [];

	private static instance: MonopolyClient | null;

	private sendHeartTime = 0;
	private readonly wsMaxConnectAttempts = 4;
	private readonly wsBaseConnectTimeoutMs = 10000;

	private getErrorMessage(error: any, fallback = "服务器连接失败") {
		if (typeof error === "string") return error;
		if (error?.message) return error.message;
		if (error?.response?.data?.msg) return error.response.data.msg;
		return fallback;
	}

	private sleep(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private openSocket(wsUrl: string, timeoutMs: number) {
		return new Promise<WebSocket>((resolve, reject) => {
			const ws = new WebSocket(wsUrl);
			let settled = false;

			const doneResolve = () => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timeout);
				resolve(ws);
			};
			const doneReject = (error: Error) => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timeout);
				try {
					ws.close();
				} catch {}
				reject(error);
			};

			const timeout = window.setTimeout(() => {
				doneReject(new Error("连接房间超时，请稍后重试"));
			}, timeoutMs);

			ws.onopen = () => doneResolve();
			ws.onerror = () => doneReject(new Error("连接房间失败"));
			ws.onclose = () => doneReject(new Error("连接被服务器关闭"));
		});
	}

	private async openSocketWithRetry(wsUrl: string) {
		let lastError: Error = new Error("连接房间失败");
		for (let attempt = 1; attempt <= this.wsMaxConnectAttempts; attempt++) {
			try {
				const timeoutMs = this.wsBaseConnectTimeoutMs + (attempt - 1) * 3000;
				return await this.openSocket(wsUrl, timeoutMs);
			} catch (error: any) {
				lastError = error instanceof Error ? error : new Error(this.getErrorMessage(error));
				if (attempt < this.wsMaxConnectAttempts) {
					await this.sleep(500 * attempt);
				}
			}
		}
		throw lastError;
	}

	public static getInstance(): MonopolyClient;
	public static getInstance(options: MonopolyClientOptions): Promise<MonopolyClient>;
	public static getInstance(options?: MonopolyClientOptions) {
		if (this.instance) {
			return this.instance;
		}
		if (options) {
			return (async () => {
				this.instance = new MonopolyClient(options);

				return this.instance;
			})();
		} else {
			// if (!this.instance) {
			// 	throw Error("在调用MonopolyClient之前应该先对其初始化, 使用useMonopolyClient时提供options以初始化");
			// }
			return this.instance;
		}
	}

	private constructor(_options: MonopolyClientOptions) {}

	public async joinRoom(roomId: string) {
		try {
			const data = await joinRoomApi(roomId);
			this.roomId = roomId;
			this.socketPath = data.wsPath || `${__MONOPOLYSERVER__}/ws/game`;
			useLoading().showLoading("连接房间服务器中...");
			await this.linkToGameServer(roomId, { isReconnect: false });
		} catch (e) {
			FPMessage({ type: "error", message: this.getErrorMessage(e, "服务器连接失败") });
		}
	}

	private buildWsUrl(roomId: string) {
		const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
		const wsPath = this.socketPath.startsWith("/") ? this.socketPath : `/${this.socketPath}`;
		return `${wsProtocol}://${window.location.host}${wsPath}?roomId=${encodeURIComponent(roomId)}`;
	}

	private resetHeartBeatTimer() {
		this.intervalList.forEach((i) => {
			clearInterval(i);
		});
		this.intervalList = [];
		this.intervalList.push(
			setInterval(() => {
				this.sendHeartTime = Date.now();
				this.sendMsg(SocketMsgType.Heart, "");
			}, 5000)
		);
	}

	private async linkToGameServer(roomId: string, options?: { isReconnect?: boolean; silentError?: boolean }) {
		const isReconnect = Boolean(options?.isReconnect);
		try {
			const wsUrl = this.buildWsUrl(roomId);
			const socket = await this.openSocketWithRetry(wsUrl);

			this.socket = socket;
			this.manualClose = false;
			const { userId, username, color, avatar } = useUserInfo();
			const user: User = { userId, username, color, avatar, isReady: false };
			this.sendRaw({
				type: SocketMsgType.JoinRoom,
				source: userId,
				roomId,
				data: user,
			});

			if (isReconnect) {
				FPMessage({ type: "success", message: "重连成功，已回到房间" });
			} else {
				FPMessage({
					type: "success",
					message: "房间连接成功🤗",
				});
			}
			this.isOnline = true;
			this.reconnecting = false;
			useLoading().hideLoading();

			this.resetHeartBeatTimer();

			socket.onmessage = (ev: MessageEvent<string>) => {
				const data: SocketMessage = JSON.parse(ev.data);
				if (data.msg) {
					FPMessage({
						type: data.msg.type as "info" | "success" | "warning" | "error",
						message: data.msg.content,
					});
				}
				// console.log("Client Receive: ", data);

				switch (data.type) {
					case SocketMsgType.Heart:
						this.handleHeart(data);
						break;
					case SocketMsgType.ConfirmIdentity:
						this.handleConfirmIdentity();
						break;
					case SocketMsgType.UserList:
						this.handleUserListReply(data.data);
						break;
					case SocketMsgType.RoomList:
						this.handleRoomListReply(data.data);
						break;
					case SocketMsgType.JoinRoom:
						this.handleJoinRoomReply(data);
						break;
					case SocketMsgType.LeaveRoom:
						this.handleLeaveRoomReply(data);
						break;
					case SocketMsgType.KickOut:
						this.handleKickOutReply();
						break;
					case SocketMsgType.RoomInfo:
						this.handleRoomInfoReply(data);
						break;
					case SocketMsgType.RoomChat:
						this.handleRoomChatReply(data);
						break;
					case SocketMsgType.GameStart:
						this.handleGameStartReply(data);
						break;
					case SocketMsgType.GameInit:
						this.handleGameInit(data);
						break;
					case SocketMsgType.GameInitFinished:
						this.handleGameInitFinished();
						break;
					case SocketMsgType.GameInfo:
						this.handleGameInfo(data);
						break;
					case SocketMsgType.GameLog:
						this.handleGameLog(data);
						break;
					case SocketMsgType.GainMoney:
						this.handleGainMoney(data);
						break;
					case SocketMsgType.CostMoney:
						this.handleCostMoney(data);
						break;
					case SocketMsgType.RemainingTime:
						this.handleRemainingTime(data);
						break;
					case SocketMsgType.RoundTurn:
						this.handleRoundTurn();
						break;
					case SocketMsgType.RollDiceStart:
						this.handleRollDiceAnimationPlay();
						break;
					case SocketMsgType.RollDiceResult:
						this.handleRollDiceResult(data);
						break;
					case SocketMsgType.UseChanceCard:
						this.handleUsedChanceCard(data);
						break;
					case SocketMsgType.PlayerWalk:
						this.handlePlayerWalk(data);
						break;
					case SocketMsgType.PlayerTp:
						this.handlePlayerTp(data);
						break;
					case SocketMsgType.BuyProperty:
						this.handleBuyProperty(data);
						break;
					case SocketMsgType.BuildHouse:
						this.handleBuildHouse(data);
						break;
					case SocketMsgType.GameOver:
						this.handleGameOver(data);
						break;
					case SocketMsgType.PauseGame:
						this.handleGamePause();
						break;
					case SocketMsgType.ResumeGame:
						this.handleGameResume();
						break;
					default:
						break;
				}
			};

			socket.onclose = () => {
				this.handleSocketDisconnected("close");
			};

			socket.onerror = () => {
				this.handleSocketDisconnected("error");
			};
		} catch (e: any) {
			if (!options?.silentError) {
				FPMessage({ type: "error", message: this.getErrorMessage(e, "连接房间失败") });
			}
			throw e;
		}
	}

	private async reconnectToRoom() {
		if (this.reconnecting || this.manualClose) return;
		if (!this.roomId) {
			FPMessage({
				type: "error",
				message: "连接已断开，找不到房间信息，已返回大厅",
				onClosed: () => {
					router.replace("room-router");
					this.destory();
				},
			});
			return;
		}

		this.reconnecting = true;
		useLoading().showLoading("网络抖动，正在重连...");
		for (let attempt = 1; attempt <= this.reconnectMaxAttempts; attempt++) {
			useLoading().text = `网络中断，正在重连 (${attempt}/${this.reconnectMaxAttempts})...`;
			try {
				await this.linkToGameServer(this.roomId, {
					isReconnect: true,
					silentError: true,
				});
				return;
			} catch {
				if (attempt < this.reconnectMaxAttempts) {
					await this.sleep(this.reconnectBaseDelayMs * attempt);
				}
			}
		}
		useLoading().hideLoading();
		this.reconnecting = false;
		FPMessage({
			type: "error",
			message: "重连失败，请重新进入房间",
			onClosed: () => {
				router.replace("room-router");
				this.destory();
			},
		});
	}

	private handleSocketDisconnected(_reason: string) {
		if (this.manualClose) return;
		if (!this.isOnline && this.reconnecting) return;
		this.isOnline = false;
		void this.reconnectToRoom();
	}

	private handleHeart(data: SocketMessage) {
		const gameInfoStore = useGameInfo();
		gameInfoStore.ping = Math.round((Date.now() - this.sendHeartTime) / 2);
		// this.sendMsg(SocketMsgType.Heart, "");
		this.handleNoHeart.fn();
	}

	private handleNoHeart = debounce(
		() => {
			this.handleSocketDisconnected("heart-timeout");
		},
		45000,
		true
	);

	private handleConfirmIdentity() {}

	private handleUserListReply(data: User[]) {
		const userListStore = useUserList();
		userListStore.userList = data;
	}

	private handleRoomListReply(data: Room[]) {
		const roomListStore = useRoomList();
		roomListStore.roomList = data;
	}

	private handleJoinRoomReply(data: SocketMessage) {
		if (data.roomId) {
			useRoomInfo().roomId = data.roomId;
			localStorage.setItem("last-room-id", data.roomId);
			router.replace({ name: "room" });
		}
	}

	private handleLeaveRoomReply(data: SocketMessage) {}

	private handleKickOutReply() {
		FPMessage({ type: "error", message: "你已被踢出房间" });
		this.destory();
		router.replace({ name: "room-router" });
	}

	private handleRoomInfoReply(data: SocketMessage) {
		const roomInfoData = data.data as RoomInfo;
		const roomInfoStore = useRoomInfo();
		roomInfoData &&
			roomInfoStore.$patch({
				roomId: roomInfoData.roomId,
				ownerId: roomInfoData.ownerId,
				ownerName: roomInfoData.ownerName,
				userList: roomInfoData.userList,
				roleList: roomInfoData.roleList,
				gameSetting: roomInfoData.gameSetting,
			});
	}

	private handleRoomChatReply(res: SocketMessage) {
		const message = res.data as ChatMessage;
		useChat().addNewMessage(message);
	}

	private handleGameStartReply(data: SocketMessage) {
		useLoading().$patch({
			loading: true,
			text: "正在进入游戏...",
		});
	}

	private handleGameInit(data: SocketMessage) {
		if (data.data) {
			const loadingStore = useLoading();
			loadingStore.text = "获取数据成功，加载中...";

			const gameInitInfo = data.data as GameInitInfo;

			const mapDataStore = useMapData();
			mapDataStore.$patch(gameInitInfo);

			const gameInfoStore = useGameInfo();
			gameInitInfo &&
				gameInfoStore.$patch({
					currentRound: gameInitInfo.currentRound,
					currentPlayerIdInRound: gameInitInfo.currentPlayerInRound,
					currentMultiplier: gameInitInfo.currentMultiplier,
				});

			router.replace({ name: "game" });
		} else {
			FPMessage({ type: "error", message: "获取地图初始数据失败" });
		}
	}

	private handleGameInitFinished() {
		useLoading().hideLoading();
	}

	private handleGainMoney(data: SocketMessage) {
		const { player, money, source } = data.data as {
			player: PlayerInfo;
			money: number;
			source: PlayerInfo | undefined;
		};
		useEventBus().emit(GameEvents.GainMoney + player.id, player, money, source);
	}

	private handleCostMoney(data: SocketMessage) {
		const { player, money, target } = data.data as {
			player: PlayerInfo;
			money: number;
			target: PlayerInfo | undefined;
		};
		useEventBus().emit(GameEvents.CostMoney + player.id, player, money, target);
	}

	private handleGameInfo(data: SocketMessage) {
		if (data.data == "error") return;
		const gameInfoStore = useGameInfo();
		const gameInfo: GameInfo = data.data;
		if (gameInfo) {
			gameInfoStore.$patch({
				currentPlayerIdInRound: gameInfo.currentPlayerInRound,
				currentRound: gameInfo.currentRound,
				currentMultiplier: gameInfo.currentMultiplier,
				playersList: gameInfo.playerList,
				propertiesList: gameInfo.properties,
			});
			const me = gameInfo.playerList.find((p) => p.id === useUserInfo().userId);
			if (me && me.isBankrupted) {
				const utilStore = useUtil();
				utilStore.canRoll = false;
				utilStore.canUseCard = false;
			}
		}
	}

	private handleGameLog(data: SocketMessage) {
		const log = data.data as GameLog;
		useGameLog().addNewLog(log);
	}

	private handleRemainingTime(data: SocketMessage) {
		const waitingFor = data.data;
		const utilStore = useUtil();
		utilStore.waitingFor = waitingFor;
		utilStore.timeOut = waitingFor.remainingTime <= 0;
		if (waitingFor.remainingTime <= 0) {
			utilStore.canRoll = false;
			useEventBus().emit(GameEvents.TimeOut);
		}
	}

	private handleRoundTurn() {
		const utilStore = useUtil();
		utilStore.canRoll = true;
		utilStore.canUseCard = true;
		useEventBus().emit("RoundTurn");
	}

	private handleRollDiceAnimationPlay() {
		const utilStore = useUtil();
		utilStore.canRoll = false;
		utilStore.canUseCard = false;
		utilStore.isRollDiceAnimationPlay = true;
	}

	private handleRollDiceResult(data: SocketMessage) {
		const rollDiceResult: number[] = data.data.rollDiceResult;

		const utilStore = useUtil();
		utilStore.rollDiceResult = rollDiceResult;
		utilStore.isRollDiceAnimationPlay = false;
	}

	private handleUsedChanceCard(data: SocketMessage) {
		const utilStore = useUtil();
		if (data.data === "error") {
			utilStore.canUseCard = true;
		}
		utilStore.canRoll = true;
	}

	private handlePlayerWalk(data: SocketMessage) {
		const { playerId, step, walkId } = data.data as { playerId: string; step: number; walkId: string };
		useEventBus().emit("player-walk", playerId, step, walkId);
	}

	private handlePlayerTp(data: SocketMessage) {
		const { playerId, positionIndex, walkId } = data.data as {
			playerId: string;
			positionIndex: number;
			walkId: string;
		};
		useEventBus().emit("player-tp", playerId, positionIndex, walkId);
	}

	private handleBuyProperty(data: SocketMessage) {
		const property: PropertyInfo = data.data;

		const vnode = createVNode(PropertyInfoVue, { property });

		FPMessageBox({
			title: "购买地皮",
			content: vnode,
			cancelText: "不买",
			confirmText: "买！",
		})
			.then(() => {
				this.sendMsg(SocketMsgType.BuyProperty, OperateType.BuyProperty, undefined, true);
			})
			.catch(() => {
				this.sendMsg(SocketMsgType.BuyProperty, OperateType.BuyProperty, undefined, false);
			});
	}

	private handleBuildHouse(data: SocketMessage) {
		const property: PropertyInfo = data.data;

		const vnode = createVNode(PropertyInfoVue, { property });

		FPMessageBox({
			title: "升级房子",
			content: vnode,
			cancelText: "不升级",
			confirmText: "升级！",
		})
			.then(() => {
				this.sendMsg(SocketMsgType.BuildHouse, OperateType.BuildHouse, undefined, true);
			})
			.catch(() => {
				this.sendMsg(SocketMsgType.BuildHouse, OperateType.BuildHouse, undefined, false);
			});
	}

	private handleGameOver(data: SocketMessage) {
		const gameInfoStore = useGameInfo();
		gameInfoStore.isGameOver = true;
	}

	private handleGamePause() {
		useLoading().showLoading("房主摸鱼被发现了，游戏暂停，等待房主回来");
	}

	private handleGameResume() {
		useLoading().hideLoading();
	}

	public sendRoomChatMessage(message: string, roomId: string) {
		this.sendMsg(SocketMsgType.RoomChat, message, roomId);
	}

	public async leaveRoom() {
		this.isOnline = false;
		await this.sendMsg(SocketMsgType.LeaveRoom, "");
		this.destory();
		const roomInfoStore = useRoomInfo();
		roomInfoStore.$reset();
		useChat().$reset();
		useGameLog().$reset();
		this.destory();
		router.replace({ name: "room-router" });
	}

	public readyToggle() {
		this.sendMsg(SocketMsgType.ReadyToggle, "");
	}

	public changeColor(newColor: string) {
		this.sendMsg(SocketMsgType.ChangeColor, newColor);
	}

	public kickOut(playerId: string) {
		this.sendMsg(SocketMsgType.KickOut, playerId);
	}

	public changeRole(operate: ChangeRoleOperate) {
		this.sendMsg(SocketMsgType.ChangeRole, operate);
	}

	public changeGameSetting(gameSetting: GameSetting) {
		this.sendMsg(SocketMsgType.ChangeGameSetting, gameSetting);
	}

	public startGame() {
		this.sendMsg(SocketMsgType.GameStart, "");
	}

	public gameInitFinished() {
		this.sendMsg(SocketMsgType.GameInitFinished, "");
	}

	public rollDice() {
		this.sendMsg(SocketMsgType.RollDiceResult, OperateType.RollDice);
		const utilStore = useUtil();
		utilStore.canRoll = false;
		utilStore.canUseCard = false;
	}

	public useChanceCard(cardId: string, target?: string | string[]) {
		const utilStore = useUtil();
		utilStore.canRoll = false;
		utilStore.canUseCard = false;
		this.sendMsg(SocketMsgType.UseChanceCard, cardId, undefined, target);
	}

	public AnimationComplete(animationId?: string) {
		this.sendMsg(SocketMsgType.Animation, OperateType.Animation + animationId);
	}

	public destory() {
		this.isOnline = false;
		this.handleNoHeart.cancel();
		this.intervalList.forEach((i) => {
			clearInterval(i);
		});
		this.intervalList = [];
		if (this.socket) {
			this.manualClose = true;
			if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
				this.socket.close(1000, "client-destroy");
			}
		}
		this.socket = null;
	}

	public disConnect() {
		if (this.socket && this.socket.readyState === WebSocket.OPEN) {
			this.manualClose = true;
			this.socket.close(1000, "client-disconnect");
		}
		this.destory();
	}

	private async sendMsg(type: SocketMsgType, data: any, roomId: string = useRoomInfo().roomId, extra: any = undefined) {
		const userInfo = useUserInfo();
		const msgToSend: SocketMessage = {
			type,
			source: userInfo.userId,
			roomId,
			data,
			extra,
		};
		this.sendRaw(msgToSend);
	}

	private sendRaw(msg: SocketMessage) {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
		this.socket.send(JSON.stringify(msg));
	}

	public static destoryInstance() {
		this.instance && this.instance.destory();
		this.instance = null;
	}
}

function useMonopolyClient(): MonopolyClient;
function useMonopolyClient(options: MonopolyClientOptions): Promise<MonopolyClient>;
function useMonopolyClient(options?: MonopolyClientOptions) {
	window.addEventListener("beforeunload", destoryMonopolyClient);
	return options ? MonopolyClient.getInstance(options) : MonopolyClient.getInstance();
}

function destoryMonopolyClient() {
	try {
		MonopolyClient.getInstance() && MonopolyClient.destoryInstance();
	} catch (e) {
		console.log(e);
	}
}

export { useMonopolyClient, destoryMonopolyClient };

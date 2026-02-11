import { SocketMsgType } from "../enums/bace";
import { ChanceCardType, GameLinkItem, GameOverRule, OperateType, PlayerEvents } from "../enums/game";
import { ChanceCard } from "./class/ChanceCard";
import Dice from "./class/Dice";
import { OperateListener } from "./class/OperateListener";
import { Player } from "./class/Player";
import { Property } from "./class/Property";
import { RoundTimeTimer } from "./class/RoundTimeTimer";
import { EFFECT_PRELUDE } from "./effect-prelude";
import { ChanceCard as ChanceCardFromDB, GameInfo, GameInitInfo, GameLog, GameMap, GameSetting, MapItem, SocketMessage, UserInRoomInfo } from "./types";
import { compileTsToJs, createAsyncExecutor, getRandomInteger, randomString } from "./utils";

type GameProcessHooks = {
	sendToUsers: (userIdList: string[], msg: SocketMessage) => void;
	onGameOver?: () => void;
};

export class GameProcess {
	private readonly hooks: GameProcessHooks;
	private readonly operateListener: OperateListener;
	private readonly mapInfo: GameMap;
	private readonly gameSetting: GameSetting;
	private readonly dice: Dice;
	private readonly roundTimeTimer: RoundTimeTimer;
	private readonly animationStepDurationMs = 600;

	private playerList: Player[] = [];
	private propertyList: Map<string, Property> = new Map();
	private chanceCardInfoList: ChanceCardFromDB[] = [];
	private mapItemList: Map<string, MapItem> = new Map();
	private startTime = Date.now();

	private isGameOver = false;
	private currentPlayerInRound: Player | null = null;
	private currentRound = 0;
	private currentMultiplier = 1;
	private timeoutList: any[] = [];
	private intervalTimerList: any[] = [];
	private eventMsg = "";
	private gameLogList: GameLog[] = [];

	constructor(
		mapInfo: GameMap,
		gameSetting: GameSetting,
		users: UserInRoomInfo[],
		roomOwnerId: string,
		hooks: GameProcessHooks
	) {
		this.mapInfo = mapInfo;
		this.gameSetting = gameSetting;
		this.hooks = hooks;
		this.operateListener = new OperateListener();
		this.dice = new Dice(gameSetting.diceNum);
		this.roundTimeTimer = new RoundTimeTimer(gameSetting.roundTime, 1000);

		if (gameSetting.slackOffMode) {
			this.operateListener.on(roomOwnerId, OperateType.PauseGame, () => {
				this.roundTimeTimer.pause();
				this.gameBroadcast({
					type: SocketMsgType.PauseGame,
					msg: {
						type: "info",
						content: "房主摸鱼被发现了，游戏暂停",
					},
					source: "server",
					data: "",
				});
			});
			this.operateListener.on(roomOwnerId, OperateType.ResumeGame, () => {
				this.roundTimeTimer.resume();
				this.gameBroadcast({
					type: SocketMsgType.ResumeGame,
					msg: {
						type: "info",
						content: "房主回来了，游戏继续",
					},
					source: "server",
					data: "",
				});
			});
		}

		this.loadGameMap(mapInfo);
		this.initPlayer(users);
	}

	public async start() {
		this.gameInfoBroadcast();
		this.gameInitBroadcast();
		await this.waitInitFinished();
		await this.gameLoop();
	}

	public emitOperation(userId: string, operateType: OperateType | string, ...data: any[]) {
		this.operateListener.emit(userId, operateType, ...data);
	}

	public handlePlayerOffline(userId: string) {
		const player = this.getPlayerById(userId);
		if (player) {
			player.setIsOffline(true);
			// If the disconnected player is on turn, enqueue safe default operations
			// so the round can continue in server-hosted mode.
			if (this.currentPlayerInRound?.getId() === userId) {
				setTimeout(() => {
					this.operateListener.emit(userId, OperateType.RollDice);
					this.operateListener.emit(userId, OperateType.BuyProperty, false);
					this.operateListener.emit(userId, OperateType.BuildHouse, false);
				}, 120);
			}
			this.gameInfoBroadcast();
		}
	}

	public handlePlayerReconnect(userId: string) {
		const player = this.playerList.find((item) => item.getUser().userId === userId);
		if (!player) return;
		player.setIsOffline(false);

		this.sendToUsers([userId], {
			type: SocketMsgType.GameStart,
			source: "server",
			data: "",
		});

		const {
			id: mapId,
			name: mapName,
			background: mapBackground,
			indexList: mapIndexList,
			itemTypes: itemTypesList,
			streets: streetsList,
			houseModel_lv0: lv0,
			houseModel_lv1: lv1,
			houseModel_lv2: lv2,
		} = this.mapInfo;
		const gameInitInfo: GameInitInfo = {
			mapId,
			mapName,
			mapBackground,
			mapItemsList: Array.from(this.mapItemList.values()),
			mapIndexList,
			itemTypesList,
			streetsList,
			playerList: this.playerList.map((p) => p.getPlayerInfo()),
			properties: Array.from(this.propertyList.values()).map((property) => property.getPropertyInfo()),
			chanceCards: this.chanceCardInfoList,
			currentPlayerInRound: this.currentPlayerInRound ? this.currentPlayerInRound.getId() : "",
			currentRound: this.currentRound,
			currentMultiplier: this.currentMultiplier,
			houseModels: { lv0, lv1, lv2 },
		};
		this.sendToUsers([userId], {
			type: SocketMsgType.GameInit,
			source: "server",
			data: gameInitInfo,
		});
		this.operateListener.once(userId, OperateType.GameInitFinished, () => {
			this.sendToUsers([userId], {
				type: SocketMsgType.GameInitFinished,
				source: "server",
				data: "",
			});
		});
		this.gameInfoBroadcast();
	}

	public destroy() {
		this.isGameOver = true;
		this.playerList.forEach((p) => {
			this.operateListener.removeAll(p.getId());
		});
		this.intervalTimerList.forEach((id) => clearInterval(id));
		this.timeoutList.forEach((id) => clearTimeout(id));
		this.roundTimeTimer.destroy();
	}

	public getGameLog() {
		return this.gameLogList;
	}

	public getPlayerById(id: string) {
		return this.playerList.find((player) => player.getId() === id);
	}

	public getRandomChanceCard(num: number): ChanceCard[] {
		const cards: ChanceCard[] = [];
		for (let i = 0; i < num; i++) {
			const index = Math.floor(Math.random() * this.chanceCardInfoList.length);
			const card = this.chanceCardInfoList[index];
			if (card) cards.push(new ChanceCard(card));
		}
		return cards;
	}

	public getNewChanceCard(id: string): ChanceCard {
		const card = this.chanceCardInfoList.find((item) => item.id === id);
		if (!card) throw new Error("错误的机会卡ID");
		return new ChanceCard(card);
	}

	public createGameLinkItem(type: GameLinkItem, id: string) {
		return `@-#${type}#-#${id}#`;
	}

	public roundRemainingTimeBroadcast = (remainingTime: number) => {
		this.gameBroadcast({
			type: SocketMsgType.RemainingTime,
			source: "server",
			data: {
				eventMsg: this.eventMsg,
				remainingTime,
			},
		});
	};

	public gameMsgNotifyBroadcast(type: "success" | "warning" | "error" | "info", msg: string) {
		this.gameBroadcast({
			type: SocketMsgType.MsgNotify,
			source: "server",
			data: "",
			msg: { type, content: msg },
		});
	}

	public gameLogBroadcast(log: string) {
		const gameLog: GameLog = {
			id: randomString(8),
			time: Date.now() - this.startTime,
			content: log,
		};
		this.gameLogList.push(gameLog);
		this.gameBroadcast({
			type: SocketMsgType.GameLog,
			source: "server",
			data: gameLog,
		});
	}

	public gameBroadcast(msg: SocketMessage) {
		this.sendToUsers(
			this.playerList.map((u) => u.getId()),
			msg
		);
	}

	public gameInitBroadcast() {
		const {
			id: mapId,
			name: mapName,
			background: mapBackground,
			indexList: mapIndexList,
			itemTypes: itemTypesList,
			streets: streetsList,
			houseModel_lv0: lv0,
			houseModel_lv1: lv1,
			houseModel_lv2: lv2,
		} = this.mapInfo;
		const gameInitInfo: GameInitInfo = {
			mapId,
			mapName,
			mapBackground,
			mapItemsList: Array.from(this.mapItemList.values()),
			mapIndexList,
			itemTypesList,
			streetsList,
			playerList: this.playerList.map((player) => player.getPlayerInfo()),
			properties: Array.from(this.propertyList.values()).map((property) => property.getPropertyInfo()),
			chanceCards: this.chanceCardInfoList,
			currentPlayerInRound: this.currentPlayerInRound ? this.currentPlayerInRound.getId() : "",
			currentRound: this.currentRound,
			currentMultiplier: this.currentMultiplier,
			houseModels: { lv0, lv1, lv2 },
		};
		this.gameBroadcast({
			type: SocketMsgType.GameInit,
			source: "server",
			data: gameInitInfo,
		});
	}

	public gameInfoBroadcast() {
		const gameInfo: GameInfo = {
			currentPlayerInRound: this.currentPlayerInRound ? this.currentPlayerInRound.getId() : "",
			currentRound: this.currentRound,
			currentMultiplier: this.currentMultiplier,
			playerList: this.playerList.map((player) => player.getPlayerInfo()),
			properties: Array.from(this.propertyList.values()).map((property) => property.getPropertyInfo()),
		};
		this.gameBroadcast({
			type: SocketMsgType.GameInfo,
			source: "server",
			data: gameInfo,
		});
	}

	private sendToUsers(userIdList: string[], msg: SocketMessage) {
		this.hooks.sendToUsers(userIdList, msg);
	}

	private loadGameMap(mapInfo: GameMap) {
		const { mapItems, properties, chanceCards } = mapInfo;
		mapItems.forEach((item) => {
			if (item.arrivedEvent) {
				item.arrivedEvent.effectCode = compileTsToJs(item.arrivedEvent.effectCode, EFFECT_PRELUDE);
			}
			this.mapItemList.set(item.id, item);
		});
		properties.forEach((property) => {
			this.propertyList.set(property.id, new Property(property));
		});
		chanceCards.forEach((card) => {
			card.effectCode = compileTsToJs(card.effectCode, EFFECT_PRELUDE);
		});
		this.chanceCardInfoList = chanceCards;
	}

	private initPlayer(users: UserInRoomInfo[]) {
		this.playerList = users.map((user) => {
			const player = new Player(
				user,
				this.gameSetting.initMoney,
				getRandomInteger(0, this.mapInfo.indexList.length - 1)
			);
			player.setCardsList(this.getRandomChanceCard(4));

			player.addEventListener(PlayerEvents.AfterCost, (money, target) => {
				this.gameBroadcast({
					type: SocketMsgType.CostMoney,
					source: "server",
					data: {
						player: player.getPlayerInfo(),
						money: parseInt(`${money}`, 10),
						target: target ? target.getPlayerInfo() : undefined,
					},
				});
				this.gameOverCheck();
			});

			player.addEventListener(PlayerEvents.AfterGain, (money, source) => {
				this.gameBroadcast({
					type: SocketMsgType.GainMoney,
					source: "server",
					data: {
						player: player.getPlayerInfo(),
						money: parseInt(`${money}`, 10),
						source: source ? source.getPlayerInfo() : undefined,
					},
				});
				this.gameOverCheck();
			});

			player.addEventListener(PlayerEvents.AfterSetMoney, () => {
				this.gameOverCheck();
			});

			player.addEventListener(PlayerEvents.AfterCost, () => {
				this.gameOverCheck();
			});

			player.addEventListener(PlayerEvents.Walk, async (step: number) => {
				const walkId = randomString(16);
				this.gameBroadcast({
					type: SocketMsgType.PlayerWalk,
					source: "server",
					data: { playerId: player.getId(), step, walkId },
				});
				const sourceIndex = player.getPositionIndex();
				const total = this.mapInfo.indexList.length;
				const newIndex = (((sourceIndex + step) % total) + total) % total;
				player.setPositionIndex(newIndex);
				this.gameInfoBroadcast();

				const animationDuration = this.animationStepDurationMs * (Math.abs(step) + 3);
				const animationTimer = setTimeout(() => {
					this.operateListener.emit(player.getId(), OperateType.Animation + walkId);
				}, animationDuration);
				await this.operateListener.onceAsync(player.getId(), OperateType.Animation + walkId, () => {
					clearTimeout(animationTimer);
				});
				player.emit(PlayerEvents.AnimationFinished);
				return step;
			});

			player.addEventListener(PlayerEvents.Tp, async (positionIndex: number) => {
				const walkId = randomString(16);
				this.gameBroadcast({
					type: SocketMsgType.PlayerTp,
					source: "server",
					data: { playerId: player.getId(), positionIndex, walkId },
				});
				player.setPositionIndex(positionIndex);
				this.gameInfoBroadcast();

				const animationTimer = setTimeout(() => {
					this.operateListener.emit(player.getId(), OperateType.Animation + walkId);
				}, 2000);
				await this.operateListener.onceAsync(player.getId(), OperateType.Animation + walkId, () => {
					clearTimeout(animationTimer);
				});
				player.emit(PlayerEvents.AnimationFinished);
				return positionIndex;
			});

			player.addEventListener(PlayerEvents.AfterSetBankrupted, (isBankrupted: boolean) => {
				if (!isBankrupted) return;
				Array.from(this.propertyList.values()).forEach((property) => {
					const owner = property.getOwner();
					if (owner && owner.getId() === player.getId()) {
						property.setOwner(undefined);
					}
				});
				player.setCardsList([]);
				this.gameOverCheck();
				if (this.currentPlayerInRound === player) {
					this.operateListener.removeAll(player.getId());
					player.removeAllListeners();
				}
				this.gameBroadcast({
					type: SocketMsgType.MsgNotify,
					source: "server",
					data: "",
					msg: { type: "info", content: `${player.getName()} 破产了` },
				});
				this.gameLogBroadcast(`${this.createGameLinkItem(GameLinkItem.Player, player.getId())} 破产了`);
			});

			return player;
		});

		this.currentPlayerInRound = this.playerList[0];
	}

	private gameOverCheck() {
		if (this.gameSetting.gameOverRule !== GameOverRule.Earn100000) return;
		const gameOver =
			this.playerList.some((player) => player.getMoney() >= this.gameSetting.overMoney) ||
			(this.playerList.length === 1 && this.playerList.every((p) => p.getIsBankrupted())) ||
			(this.playerList.length > 1 && this.playerList.filter((player) => !player.getIsBankrupted()).length <= 1);
		if (gameOver) this.gameOver();
	}

	private async waitInitFinished() {
		const promiseArr: Promise<any>[] = [];
		this.playerList.forEach((player) => {
			promiseArr.push(this.operateListener.onceAsync(player.getId(), OperateType.GameInitFinished, () => {}));
		});
		await Promise.all(promiseArr);
		this.gameBroadcast({
			type: SocketMsgType.GameInitFinished,
			source: "server",
			data: "",
		});
	}

	private async gameLoop() {
		this.roundTimeTimer.setIntervalFunction(this.roundRemainingTimeBroadcast);
		while (!this.isGameOver) {
			let currentPlayerIndex = 0;
			while (currentPlayerIndex < this.playerList.length) {
				this.gameInfoBroadcast();
				const currentPlayer = this.playerList[currentPlayerIndex];
				if (currentPlayer.getIsBankrupted()) {
					currentPlayerIndex++;
					continue;
				}

				if (currentPlayer.getStop() > 0) {
					this.gameMsgNotifyBroadcast("info", `${currentPlayer.getName()}睡着了,跳过回合`);
					this.gameLogBroadcast(`${this.createGameLinkItem(GameLinkItem.Player, currentPlayer.getId())} 睡着了,跳过回合`);
					await currentPlayer.setStop(currentPlayer.getStop() - 1);
					currentPlayerIndex++;
					continue;
				}
				this.currentPlayerInRound = currentPlayer;
				this.roundTurnNotify(currentPlayer);
				this.gameInfoBroadcast();
				await this.gameRound(currentPlayer);
				currentPlayerIndex++;
			}
			this.nextRound();
		}
		this.roundTimeTimer.clearInterval();
	}

	private async gameRound(currentPlayer: Player) {
		await currentPlayer.emit(PlayerEvents.BeforeRound, currentPlayer);
		this.gameInfoBroadcast();
		this.roundTimeTimer.setTimeOutFunction(null);
		await this.useChanceCardListener(currentPlayer);
		await this.waitRollDice(currentPlayer);
		await this.handleArriveEvent(currentPlayer);
		await currentPlayer.emit(PlayerEvents.AfterRound, currentPlayer);
	}

	private async useChanceCardListener(sourcePlayer: Player) {
		const userId = sourcePlayer.getId();
		if (sourcePlayer.getIsOffline()) {
			// Offline mode: skip active card operation and roll directly.
			this.eventMsg = `${sourcePlayer.getName()} 离线托管中`;
			this.roundRemainingTimeBroadcast(0);
			await this.sleep(200);
			return;
		}
		await new Promise<void>(async (resolve) => {
			let isRoundEnd = false;

			const handleRollDice = () => {
				isRoundEnd = true;
				this.operateListener.removeAll(userId, OperateType.UseChanceCard);
				this.roundTimeTimer.stop();
				resolve();
			};

			const handleUseChanceCardTimeOut = () => {
				isRoundEnd = true;
				this.operateListener.remove(userId, OperateType.RollDice, handleRollDice);
				this.operateListener.removeAll(userId, OperateType.UseChanceCard);
				this.operateListener.emit(userId, OperateType.RollDice);
			};

			this.operateListener.once(userId, OperateType.RollDice, handleRollDice);

			while (!isRoundEnd) {
				this.eventMsg = `等待 ${sourcePlayer.getName()} 执行回合`;
				this.roundTimeTimer.setTimeOutFunction(handleUseChanceCardTimeOut);
				await this.operateListener.onceAsync(
					userId,
					OperateType.UseChanceCard,
					async (chanceCardId: string, targetIdList: string[] = []) => {
					this.roundTimeTimer.stop();
					const chanceCard = sourcePlayer.getCardById(chanceCardId);
					if (!chanceCard) {
						this.sendToUsers([sourcePlayer.getId()], {
							type: SocketMsgType.MsgNotify,
							source: "server",
							data: "",
							msg: { type: "error", content: "机会卡使用失败: 未知的机会卡ID" },
						});
						return;
					}

					let error = "";
					try {
						switch (chanceCard.getType()) {
							case ChanceCardType.ToSelf:
								await chanceCard.use(sourcePlayer, sourcePlayer, this);
								this.gameMsgNotifyBroadcast("info", `${sourcePlayer.getName()} 对自己使用了机会卡: "${chanceCard.getName()}"`);
								this.gameLogBroadcast(
									`${this.createGameLinkItem(GameLinkItem.Player, sourcePlayer.getId())} 对自己使用了机会卡: ${this.createGameLinkItem(
										GameLinkItem.ChanceCard,
										chanceCard.getSourceId()
									)}`
								);
								break;
							case ChanceCardType.ToOtherPlayer:
							case ChanceCardType.ToPlayer: {
								const targetPlayer = this.playerList.find((player) => player.getId() === targetIdList[0]);
								if (!targetPlayer) {
									error = "目标玩家不存在";
									break;
								}
								await chanceCard.use(sourcePlayer, targetPlayer, this);
								this.gameMsgNotifyBroadcast(
									"info",
									`${sourcePlayer.getName()} 对玩家 ${targetPlayer.getName()} 使用了机会卡: "${chanceCard.getName()}"`
								);
								this.gameLogBroadcast(
									`${this.createGameLinkItem(GameLinkItem.Player, sourcePlayer.getId())} 对玩家 ${this.createGameLinkItem(
										GameLinkItem.Player,
										targetPlayer.getId()
									)} 使用了机会卡: ${this.createGameLinkItem(GameLinkItem.ChanceCard, chanceCard.getSourceId())}`
								);
								break;
							}
							case ChanceCardType.ToProperty: {
								const targetProperty = this.propertyList.get(targetIdList[0]);
								if (!targetProperty) {
									error = "目标建筑/地皮不存在";
									break;
								}
								await chanceCard.use(sourcePlayer, targetProperty, this);
								this.gameMsgNotifyBroadcast(
									"info",
									`${sourcePlayer.getName()} 对地皮 ${targetProperty.getName()} 使用了机会卡: "${chanceCard.getName()}"`
								);
								this.gameLogBroadcast(
									`${this.createGameLinkItem(GameLinkItem.Player, sourcePlayer.getId())} 对地皮 ${this.createGameLinkItem(
										GameLinkItem.Property,
										targetProperty.getId()
									)} 使用了机会卡: ${this.createGameLinkItem(GameLinkItem.ChanceCard, chanceCard.getSourceId())}`
								);
								break;
							}
							case ChanceCardType.ToMapItem: {
								const ids = targetIdList as string[];
								const targetPlayers: Player[] = [];
								ids.forEach((id) => {
									const player = this.playerList.find((item) => item.getId() === id);
									if (player) targetPlayers.push(player);
								});
								if (targetPlayers.length === 0) {
									error = "选中的玩家不存在";
									break;
								}
								await chanceCard.use(sourcePlayer, targetPlayers, this);
								break;
							}
						}
					} catch (e: any) {
						error = e?.message || "机会卡执行失败";
					}

					if (error) {
						this.sendToUsers([sourcePlayer.getId()], {
							type: SocketMsgType.MsgNotify,
							source: "server",
							data: "",
							msg: { type: "error", content: error },
						});
						this.sendToUsers([sourcePlayer.getId()], {
							type: SocketMsgType.UseChanceCard,
							source: "server",
							data: "error",
						});
						return;
					}

					await sourcePlayer.loseCard(chanceCardId);
					this.gameInfoBroadcast();
					isRoundEnd = true;
					this.eventMsg = `等待 ${sourcePlayer.getName()} 掷骰子`;
					this.roundTimeTimer.setTimeOutFunction(handleUseChanceCardTimeOut);
					this.sendToUsers([sourcePlayer.getId()], {
						type: SocketMsgType.MsgNotify,
						source: "server",
						data: "",
						msg: { type: "success", content: `机会卡 ${chanceCard.getName()} 使用成功！` },
					});
					this.sendToUsers([sourcePlayer.getId()], {
						type: SocketMsgType.UseChanceCard,
						source: "server",
						data: "",
					});
					}
				);
			}
		});
	}

	private async waitRollDice(player: Player) {
		const userId = player.getId();
		if (player.getIsOffline()) {
			await this.sleep(400);
			this.gameBroadcast({ type: SocketMsgType.RollDiceStart, source: "server", data: "" });
			this.dice.roll();
			await this.sleep(1200);
			this.gameBroadcast({
				type: SocketMsgType.RollDiceResult,
				source: "server",
				data: {
					rollDiceResult: this.dice.getResultArray(),
					rollDiceCount: this.dice.getResultNumber(),
					rollDicePlayerId: player.getId(),
				},
				msg: {
					type: "info",
					content: `${player.getName()}(托管) 摇到的点数是: ${this.dice.getResultArray().join("-")}`,
				},
			});
			this.gameLogBroadcast(
				`${this.createGameLinkItem(GameLinkItem.Player, player.getId())}(托管) 摇到的点数是: ${this.dice
					.getResultArray()
					.join("-")}`
			);
			await player.walk(this.dice.getResultNumber());
			this.gameInfoBroadcast();
			return;
		}
		await new Promise((resolve, reject) => {
			this.operateListener.onceAsync(userId, OperateType.RollDice, resolve);
			player.addEventListener(PlayerEvents.AfterSetBankrupted, (isBankrupted) => {
				if (isBankrupted) reject("bankrupted");
			});
		})
			.then(async () => {
				this.gameBroadcast({ type: SocketMsgType.RollDiceStart, source: "server", data: "" });
				this.dice.roll();
				await this.sleep(1500);
				this.gameBroadcast({
					type: SocketMsgType.RollDiceResult,
					source: "server",
					data: {
						rollDiceResult: this.dice.getResultArray(),
						rollDiceCount: this.dice.getResultNumber(),
						rollDicePlayerId: player.getId(),
					},
					msg: {
						type: "info",
						content: `${player.getName()} 摇到的点数是: ${this.dice.getResultArray().join("-")}`,
					},
				});
				this.gameLogBroadcast(
					`${this.createGameLinkItem(GameLinkItem.Player, player.getId())} 摇到的点数是: ${this.dice.getResultArray().join("-")}`
				);
				await player.walk(this.dice.getResultNumber());
			})
			.catch(() => {})
			.finally(() => {
				this.gameInfoBroadcast();
			});
	}

	public async handleArriveEvent(arrivedPlayer: Player) {
		if (arrivedPlayer.getIsBankrupted()) return;
		const playerPositionIndex = arrivedPlayer.getPositionIndex();
		const arriveItemId = this.mapInfo.indexList[playerPositionIndex];
		const arriveItem = this.mapItemList.get(arriveItemId);
		if (!arriveItem) return;

		if (arriveItem.linkto) {
			const linkMapItem = arriveItem.linkto;
			if (!linkMapItem.property) return;
			const property = this.propertyList.get(linkMapItem.property.id);
			if (!property) return;
			const arrivePropertyMsg: SocketMessage = {
				type: SocketMsgType.BuyProperty,
				source: "server",
				data: property.getPropertyInfo(),
				msg: { type: "", content: "" },
			};

			const owner = property.getOwner();
				if (owner) {
					if (owner.getId() === arrivedPlayer.getId()) {
						if (property.getBuildingLevel() < 2) {
							if (arrivedPlayer.getIsOffline()) {
								if (arrivedPlayer.getMoney() > property.getSellCost()) {
									await this.handlePlayerBuildUp(arrivedPlayer, property);
								}
								this.roundRemainingTimeBroadcast(0);
								return;
							}
							this.eventMsg = `等待 ${arrivedPlayer.getName()} 升级房子`;
							this.roundTimeTimer.setTimeOutFunction(() => {
								this.operateListener.emit(arrivedPlayer.getId(), OperateType.BuildHouse, false);
						});
						arrivePropertyMsg.type = SocketMsgType.BuildHouse;
						arrivePropertyMsg.msg = {
							type: "success",
							content: `你到达了你的${property.getName()}，可以升级房子`,
						};
						this.sendToUsers([arrivedPlayer.getId()], arrivePropertyMsg);
						const playerRes = await this.operateListener.onceAsync(
							arrivedPlayer.getId(),
							OperateType.BuildHouse,
							(choice) => choice
						);
						this.roundRemainingTimeBroadcast(0);
						if (playerRes) {
							await this.handlePlayerBuildUp(arrivedPlayer, property);
						}
					}
				} else {
					const ownerPlayer = this.getPlayerById(owner.getId());
					if (!ownerPlayer) return;
					const passCost = property.getPassCost() * this.currentMultiplier;
					await this.handlePayToSomeOne(arrivedPlayer, ownerPlayer, passCost);
					this.sendToUsers([arrivedPlayer.getId()], {
						...arrivePropertyMsg,
						type: SocketMsgType.MsgNotify,
						msg: {
							type: "error",
							content: `你到达了${owner.getName()}的地皮: ${property.getName()}，支付了${passCost}￥过路费`,
						},
					});
					this.sendToUsers([ownerPlayer.getId()], {
						...arrivePropertyMsg,
						type: SocketMsgType.MsgNotify,
						msg: {
							type: "success",
							content: `${arrivedPlayer.getName()}到达了你的地皮: ${property.getName()}，支付了${passCost}￥过路费`,
						},
					});
					this.sendToUsers(
						this.playerList
							.filter((p) => p.getId() !== arrivedPlayer.getId() && p.getId() !== owner.getId())
							.map((p) => p.getId()),
						{
							...arrivePropertyMsg,
							type: SocketMsgType.MsgNotify,
							msg: {
								type: "info",
								content: `${arrivedPlayer.getName()}到达了${owner.getName()}的地皮: ${property.getName()}，支付了${passCost}￥过路费`,
							},
						}
					);
					this.gameInfoBroadcast();
					this.gameLogBroadcast(
						`${this.createGameLinkItem(GameLinkItem.Player, arrivedPlayer.getId())} 到达了 ${this.createGameLinkItem(
							GameLinkItem.Player,
							owner.getId()
						)} 的地皮: ${this.createGameLinkItem(GameLinkItem.Property, property.getId())}，支付了 ${passCost}￥ 过路费`
					);
				}
			} else {
				if (arrivedPlayer.getIsOffline()) {
					if (arrivedPlayer.getMoney() > property.getSellCost()) {
						await this.handlePlayerBuyProperty(arrivedPlayer, property);
					}
					this.roundRemainingTimeBroadcast(0);
					return;
				}
				this.eventMsg = `等待 ${arrivedPlayer.getName()} 购买地皮`;
				this.roundTimeTimer.setTimeOutFunction(() => {
					this.operateListener.emit(arrivedPlayer.getId(), OperateType.BuyProperty, false);
				});
				arrivePropertyMsg.type = SocketMsgType.BuyProperty;
				arrivePropertyMsg.msg = {
					type: "success",
					content: `你到达了${property.getName()}，可以买下这块地皮`,
				};
				this.sendToUsers([arrivedPlayer.getId()], arrivePropertyMsg);
				const playerRes = await this.operateListener.onceAsync(
					arrivedPlayer.getId(),
					OperateType.BuyProperty,
					(choice) => choice
				);
				this.roundRemainingTimeBroadcast(0);
				if (playerRes) {
					await this.handlePlayerBuyProperty(arrivedPlayer, property);
				}
			}
		} else if (arriveItem.arrivedEvent) {
			const effectCode = arriveItem.arrivedEvent.effectCode;
			if (effectCode) {
				const arrivedFunction = createAsyncExecutor(["arrivedPlayer", "gameProcess"], effectCode);
				await arrivedFunction(arrivedPlayer, this);
				this.gameMsgNotifyBroadcast("info", `${arrivedPlayer.getName()} 踩到了特殊地块: ${arriveItem.arrivedEvent.name}`);
				this.gameLogBroadcast(
					`${this.createGameLinkItem(GameLinkItem.Player, arrivedPlayer.getId())} 踩到了特殊地块: ${this.createGameLinkItem(
						GameLinkItem.ArrivedEvent,
						arriveItem.arrivedEvent.id
					)}`
				);
			}
		}
		this.gameInfoBroadcast();
	}

	private async handlePayToSomeOne(source: Player, target: Player, money: number) {
		await target.gain(money, source);
		return source.cost(money, target);
	}

	private nextRound() {
		this.currentRound++;
		this.gameOverCheck();
		if (this.currentRound % this.gameSetting.multiplierIncreaseRounds === 0) {
			this.currentMultiplier += this.gameSetting.multiplier;
			this.playerList.forEach((p) => {
				p.gainCard(this.getRandomChanceCard(1)[0]);
			});
			this.gameMsgNotifyBroadcast("info", `过路费倍率上涨为 ${this.currentMultiplier} 倍, 每人获得一张随机的机会卡`);
			this.gameLogBroadcast(`---过路费倍率上涨为 ${this.currentMultiplier} 倍, 每人获得一张随机的机会卡---`);
		}
	}

	private async handlePlayerBuyProperty(player: Player, property: Property) {
		if (player.getMoney() > property.getSellCost()) {
			await property.setOwner(player);
			this.gameInfoBroadcast();
			this.gameMsgNotifyBroadcast("info", `${player.getName()} 买下了地皮 ${property.getName()}`);
			this.gameLogBroadcast(
				`${this.createGameLinkItem(GameLinkItem.Player, player.getId())} 买下了地皮 ${this.createGameLinkItem(
					GameLinkItem.Property,
					property.getId()
				)}`
			);
			await player.cost(property.getSellCost());
			return;
		}
		this.sendToUsers([player.getId()], {
			type: SocketMsgType.MsgNotify,
			source: "server",
			data: "",
			msg: { type: "error", content: "不够钱啊穷鬼" },
		});
	}

	private async handlePlayerBuildUp(player: Player, property: Property) {
		if (player.getMoney() > property.getSellCost()) {
			property.buildUp();
			this.gameInfoBroadcast();
			this.gameMsgNotifyBroadcast("info", `${player.getName()}把地皮${property.getName()}升到了${property.getBuildingLevel()}级`);
			this.gameLogBroadcast(
				`${this.createGameLinkItem(GameLinkItem.Player, player.getId())} 把地皮 ${this.createGameLinkItem(
					GameLinkItem.Property,
					property.getId()
				)} 升到了 ${property.getBuildingLevel()} 级`
			);
			await player.cost(property.getSellCost());
			return;
		}
		this.sendToUsers([player.getId()], {
			type: SocketMsgType.MsgNotify,
			source: "server",
			data: "",
			msg: { type: "error", content: "不够钱啊穷鬼" },
		});
	}

	private roundTurnNotify(player: Player) {
		this.sendToUsers([player.getId()], {
			type: SocketMsgType.RoundTurn,
			source: "server",
			data: "",
			msg: { type: "info", content: "现在是你的回合啦！" },
		});
		this.gameLogBroadcast(`---接下来是 ${this.createGameLinkItem(GameLinkItem.Player, player.getId())} 的回合---`);
	}

	private gameOver() {
		this.gameInfoBroadcast();
		this.gameBroadcast({
			type: SocketMsgType.GameOver,
			source: "server",
			data: "游戏结束",
			msg: { content: "游戏结束", type: "info" },
		});
		this.isGameOver = true;
		this.destroy();
		this.hooks.onGameOver && this.hooks.onGameOver();
	}

	private sleep(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

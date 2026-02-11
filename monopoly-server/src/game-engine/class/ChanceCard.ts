import { ChanceCardType } from "../../enums/game";
import { GameProcess } from "../GameProcess";
import { ChanceCardInterface, PlayerInterface, PropertyInterface } from "../interfaces";
import { ChanceCard as ChanceCardFromDB, ChanceCardInstanceInfo } from "../types";
import { createAsyncExecutor, randomString } from "../utils";

export class ChanceCard implements ChanceCardInterface {
	private id: string;
	private sourceId: string;
	private name: string;
	private describe: string;
	private type: ChanceCardType;
	private color: string;
	private icon: string;
	private effectCode: string;
	private effectFunction: (
		sourcePlayer: PlayerInterface,
		target: PlayerInterface | PropertyInterface | PlayerInterface[] | PropertyInterface[] | null,
		gameProcess: GameProcess
	) => Promise<any>;

	constructor(chanceCard: ChanceCardFromDB) {
		this.id = randomString(16);
		this.sourceId = chanceCard.id;
		this.name = chanceCard.name;
		this.describe = chanceCard.describe;
		this.type = chanceCard.type;
		this.color = chanceCard.color;
		this.icon = chanceCard.icon;
		this.effectCode = chanceCard.effectCode;
		this.effectFunction = createAsyncExecutor(
			["sourcePlayer", "target", "gameProcess"],
			this.effectCode
		) as (
			sourcePlayer: PlayerInterface,
			target: PlayerInterface | PropertyInterface | PlayerInterface[] | PropertyInterface[] | null,
			gameProcess: GameProcess
		) => Promise<any>;
	}

	public getId = () => this.id;
	public getSourceId = () => this.sourceId;
	public getName = () => this.name;
	public getDescribe = () => this.describe;
	public getColor = () => this.color;
	public getType = () => this.type;
	public getIcon = () => this.icon;
	public getEffectCode = () => this.effectCode;

	public async use(
		sourcePlayer: PlayerInterface,
		target: PlayerInterface | PropertyInterface | PlayerInterface[] | PropertyInterface[] | null,
		gameProcess: GameProcess
	) {
		try {
			await this.effectFunction(sourcePlayer, target, gameProcess);
		} catch (e: any) {
			throw Error(e.message);
		}
	}

	public getChanceCardInfo(): ChanceCardInstanceInfo {
		const chanceCardInfo: ChanceCardInstanceInfo = {
			id: this.id,
			sourceId: this.sourceId,
			name: this.name,
			describe: this.describe,
			color: this.color,
			type: this.type,
			icon: this.icon,
		};
		return chanceCardInfo;
	}
}

import { OperateType } from "../../enums/game";

type OperateListenerItem = {
	isOnce: boolean;
	fn: Function;
};

export class OperateListener {
	private eventMap: Map<string, Map<OperateType | string, OperateListenerItem[]>> = new Map();

	private setOperateListener(
		playerId: string,
		eventType: OperateType | string,
		fn: (...args: any[]) => void,
		isOnce: boolean
	) {
		if (!this.eventMap.has(playerId)) {
			this.eventMap.set(playerId, new Map());
		}
		const eventTypeMap = this.eventMap.get(playerId) as Map<OperateType | string, OperateListenerItem[]>;
		if (!eventTypeMap.has(eventType)) {
			eventTypeMap.set(eventType, []);
		}
		const eventList = eventTypeMap.get(eventType) as OperateListenerItem[];
		eventList.push({ isOnce, fn });
	}

	public onAsync(playerId: string, eventType: OperateType | string, listener: (...args: any[]) => void): Promise<any> {
		return new Promise((resolve) => {
			const newFn = (...args: any[]) => {
				resolve(listener(...args));
			};
			this.setOperateListener(playerId, eventType, newFn, false);
		});
	}

	public onceAsync(
		playerId: string,
		eventType: OperateType | string,
		listener: (...args: any[]) => void
	): Promise<any> {
		return new Promise((resolve) => {
			const newFn = (...args: any[]) => {
				resolve(listener(...args));
			};
			this.setOperateListener(playerId, eventType, newFn, true);
		});
	}

	public on(playerId: string, eventType: OperateType | string, listener: (...args: any[]) => void) {
		this.setOperateListener(playerId, eventType, listener, false);
	}

	public once(playerId: string, eventType: OperateType | string, listener: (...args: any[]) => void) {
		this.setOperateListener(playerId, eventType, listener, true);
	}

	public remove(playerId: string, eventType: OperateType | string, callback: (...args: any[]) => void) {
		const playerEvents = this.eventMap.get(playerId);
		if (!playerEvents) return;
		const eventTypeMap = playerEvents.get(eventType);
		if (!eventTypeMap) return;
		const removeIndex = eventTypeMap.findIndex((fobj) => fobj.fn === callback);
		if (removeIndex >= 0) eventTypeMap.splice(removeIndex, 1);
	}

	public removeAll(playerId: string, eventType?: OperateType | string) {
		const playerEvents = this.eventMap.get(playerId);
		if (!playerEvents) return;
		if (eventType) {
			if (playerEvents.has(eventType)) playerEvents.delete(eventType);
		} else if (this.eventMap.has(playerId)) {
			this.eventMap.delete(playerId);
		}
	}

	public emit(playerId: string, eventType: OperateType | string, ...args: any[]): boolean {
		const playerEvents = this.eventMap.get(playerId);
		if (!playerEvents) return false;
		const eventTypeMap = playerEvents.get(eventType);
		if (!eventTypeMap) return false;
		for (let index = 0; index < eventTypeMap.length; index++) {
			const fobj = eventTypeMap[index];
			fobj.fn.apply(this, args);
			if (fobj.isOnce) {
				eventTypeMap.splice(index, 1);
				index--;
			}
		}
		return true;
	}
}

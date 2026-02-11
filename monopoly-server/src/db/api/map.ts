import { getItemTypesFromMapItems, getPropertiesFromMapItems } from "../../utils";
import AppDataSource from "../dbConnecter";
import { Map as GameMap } from "../entities/map";
import { unlinkSync } from "fs";
import path from "path";
import { deleteFiles } from "../../utils/file-uploader";
import { Model } from "../entities/model";
import { In } from "typeorm";
import { Street } from "../entities/street";
import { Property } from "../entities/property";
import { MapItem } from "../entities/mapItem";

const mapRepository = AppDataSource.getRepository(GameMap);
const modelRepository = AppDataSource.getRepository(Model);

export const createMap = async (name: string) => {
	const map = new GameMap();
	map.name = name;
	map.indexList = [];
	return await mapRepository.save(map);
};

export const deleteMap = async (id: string) => {
	const map = await mapRepository.findOne({
		where: { id },
	});
	if (map) {
		await mapRepository.remove(map);
		return;
	} else {
		throw new Error("无效的id");
	}
};

export const updateMapName = async (mapId: string, name: string) => {
	await mapRepository.createQueryBuilder().update(GameMap).set({ name }).where("id = :id", { id: mapId }).execute();
};

export const updateMapUseState = async (mapId: string, inUse: boolean) => {
	await mapRepository.createQueryBuilder().update(GameMap).set({ inUse }).where("id = :id", { id: mapId }).execute();
	if (inUse) {
		const map = await loadGameMapInfo(mapId);
		if (map) mapInfoCache.set(mapId, map);
	}
};

export const setBackground = async (mapId: string, backgroundUrl: string) => {
	const { background: oldBg } = (await mapRepository.findOne({ where: { id: mapId }, select: ["background"] })) || {
		background: "",
	};
	if (oldBg) {
		const filePathArr = oldBg.split("/");
		const fileName = filePathArr[filePathArr.length - 1 >= 0 ? filePathArr.length - 1 : 0];
		try {
			await deleteFiles([`monopoly/backgrounds/${fileName}`]);
		} catch (e: any) {
			throw new Error(`在删除原有Background时发生错误：${e.message}`);
		}
	}

	await mapRepository
		.createQueryBuilder()
		.update(GameMap)
		.set({ background: backgroundUrl })
		.where("id = :id", { id: mapId })
		.execute();
};

export const updateHouseModelList = async (mapId: string, houseModels: { lv0: string; lv1: string; lv2: string }) => {
	const houseModel_lv0 = await modelRepository.findOne({ where: { id: houseModels.lv0 } });
	const houseModel_lv1 = await modelRepository.findOne({ where: { id: houseModels.lv1 } });
	const houseModel_lv2 = await modelRepository.findOne({ where: { id: houseModels.lv2 } });
	const map = await mapRepository.findOne({ where: { id: mapId } });
	if (map && houseModel_lv0 && houseModel_lv1 && houseModel_lv2) {
		map.houseModel_lv0 = houseModel_lv0;
		map.houseModel_lv1 = houseModel_lv1;
		map.houseModel_lv2 = houseModel_lv2;
		mapRepository.save(map);
	} else {
		throw new Error("获取Map或者Model时发生错误");
	}
};

export const updateIndexList = async (id: string, indexList: string[]) => {
	mapRepository.createQueryBuilder().update(GameMap).set({ indexList }).where("id = :id", { id }).execute();
};

const mapInfoCache: Map<string, GameMap> = new Map();

export const getMapById = async (id: string, isAdmin: boolean) => {
	if (!mapInfoCache.get(id) || isAdmin) {
		const map = await loadGameMapInfo(id);
		if (!map) return null;
		if (!isAdmin) mapInfoCache.set(id, map); //如果是管理员访问则不更新缓存, 只会在管理员在管理端开启地图时才会更新缓存
		return map;
	} else {
		return mapInfoCache.get(id) || null;
	}
};

async function loadGameMapInfo(id: string) {
	const map = await mapRepository.findOne({
		where: { id },
		relations: [
			"mapItems",
			"mapItems.linkto",
			"mapItems.linkto.type",
			"mapItems.linkto.property",
			"mapItems.linkto.property.street",
			"mapItems.type",
			"mapItems.type.model",
			"mapItems.arrivedEvent",
			"mapItems.property",
			"mapItems.property.street",
			// "properties",
			// "properties.street",
			"chanceCards",
			"streets",
			"houseModel_lv0",
			"houseModel_lv1",
			"houseModel_lv2",
		],
	});
	if (map) {
		map.itemTypes = getItemTypesFromMapItems(map.mapItems) as any;
		map.properties = getPropertiesFromMapItems(map.mapItems) as any;
		return map;
	} 
}

export const getMapsList = async (page: number, size: number, isAdmin: boolean) => {
	const total = await mapRepository.count();
	const shouldPage = page > 0 && size > 0 && size < total;
	let mapsList = await mapRepository.find({
		relations: ["mapItems", "mapItems.type", "mapItems.type.model", "chanceCards"],
		skip: shouldPage ? (page - 1) * size : undefined,
		take: shouldPage ? size : undefined,
	});
	mapsList.map((map) => {
		map.itemTypes = getItemTypesFromMapItems(map.mapItems) as any;
		return map;
	});
	const deduped = new Map<string, GameMap>();
	mapsList.forEach((map) => {
		if (!deduped.has(map.id)) deduped.set(map.id, map);
	});
	mapsList = Array.from(deduped.values());
	const showAllMaps = process.env.MAP_LIST_SHOW_ALL !== "false";
	if (!isAdmin && !showAllMaps) {
		mapsList = mapsList.filter((m) => m.inUse);
	}
	if (process.env.MAP_LIST_DEBUG === "true") {
		const summary = mapsList.map((m) => `${m.id}:${m.name}:${m.inUse ? "on" : "off"}`).join(", ");
		console.log(`[map-list] total=${total} returned=${mapsList.length} page=${page} size=${size} showAll=${showAllMaps} :: ${summary}`);
	}
	return { mapsList, total };
};

export const getMapIndexsByMapId = async (id: string) => {
	const map = await mapRepository.findOne({ where: { id }, select: ["indexList"] });
	if (map) {
		return map.indexList;
	} else {
		throw new Error("地图不存在");
	}
};

export const cloneMapWithVariant = async (
	sourceMapId: string,
	newName: string,
	options?: { propertyCostScale?: number; tollScale?: number; streetScale?: number }
) => {
	const source = await mapRepository.findOne({
		where: { id: sourceMapId },
		relations: [
			"mapItems",
			"mapItems.type",
			"mapItems.linkto",
			"mapItems.property",
			"mapItems.property.street",
			"mapItems.arrivedEvent",
			"chanceCards",
			"itemTypes",
			"streets",
			"houseModel_lv0",
			"houseModel_lv1",
			"houseModel_lv2",
		],
	});
	if (!source) {
		throw new Error("原始地图不存在");
	}
	if (!newName?.trim()) {
		throw new Error("新地图名称不能为空");
	}

	const propertyCostScale = Math.max(0.1, Number(options?.propertyCostScale || 1));
	const tollScale = Math.max(0.1, Number(options?.tollScale || 1));
	const streetScale = Math.max(0.1, Number(options?.streetScale || 1));

	const map = new GameMap();
	map.name = newName.trim();
	map.background = source.background;
	map.inUse = false;
	map.indexList = [];
	map.itemTypes = source.itemTypes || [];
	map.chanceCards = source.chanceCards || [];
	map.houseModel_lv0 = source.houseModel_lv0;
	map.houseModel_lv1 = source.houseModel_lv1;
	map.houseModel_lv2 = source.houseModel_lv2;

	const streetMap = new Map<string, Street>();
	map.streets = (source.streets || []).map((street) => {
		const s = new Street();
		s.name = street.name;
		s.increase = Number((street.increase * streetScale).toFixed(4));
		s.map = map;
		streetMap.set(street.id, s);
		return s;
	});

	const sourceProperties = (source.mapItems || [])
		.filter((item) => Boolean(item.property))
		.map((item) => item.property as Property)
		.filter((p, index, arr) => arr.findIndex((x) => x.id === p.id) === index);

	const propertyMap = new Map<string, Property>();
	map.properties = sourceProperties.map((property) => {
		const p = new Property();
		p.name = property.name;
		p.sellCost = Math.max(1, Math.round(property.sellCost * propertyCostScale));
		p.buildCost = Math.max(1, Math.round(property.buildCost * propertyCostScale));
		p.cost_lv0 = Math.max(1, Math.round(property.cost_lv0 * tollScale));
		p.cost_lv1 = Math.max(1, Math.round(property.cost_lv1 * tollScale));
		p.cost_lv2 = Math.max(1, Math.round(property.cost_lv2 * tollScale));
		p.effectCode = property.effectCode;
		p.map = map;
		p.street = property.street ? streetMap.get(property.street.id) || map.streets[0] : map.streets[0];
		propertyMap.set(property.id, p);
		return p;
	});

	const mapItemMap = new Map<string, MapItem>();
	map.mapItems = (source.mapItems || []).map((item) => {
		const m = new MapItem();
		m._id = item._id;
		m.x = item.x;
		m.y = item.y;
		m.rotation = item.rotation;
		m.type = item.type;
		m.arrivedEvent = item.arrivedEvent;
		m.map = map;
		if (item.property) {
			m.property = propertyMap.get(item.property.id);
		}
		mapItemMap.set(item.id, m);
		return m;
	});

	(source.mapItems || []).forEach((item) => {
		if (!item.linkto) return;
		const clonedItem = mapItemMap.get(item.id);
		const clonedTarget = mapItemMap.get(item.linkto.id);
		if (clonedItem && clonedTarget) {
			clonedItem.linkto = clonedTarget;
		}
	});

	const sourceIndexList = [...(source.indexList || [])];
	map.indexList = [];

	const saved = await mapRepository.save(map);
	const savedWithItems = await mapRepository.findOne({
		where: { id: saved.id },
		relations: ["mapItems"],
	});
	if (savedWithItems && sourceIndexList.length > 0) {
		const sourceIdToItemKey = new Map((source.mapItems || []).map((item) => [item.id, item._id]));
		const savedItemKeyToId = new Map((savedWithItems.mapItems || []).map((item) => [item._id, item.id]));
		savedWithItems.indexList = sourceIndexList
			.map((oldId) => {
				const key = sourceIdToItemKey.get(oldId) || "";
				return savedItemKeyToId.get(key) || "";
			})
			.filter(Boolean);
		await mapRepository.save(savedWithItems);
		return savedWithItems;
	}
	return saved;
};

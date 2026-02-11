import { GameMap } from "@/interfaces/game";
import axios from "axios";
import { __MONOPOLYSERVER__ } from "@G/global.config";

export const getMapsList = async (page: number, size: number) => {
	const { total, mapsList, current } = (
		await axios.get(`${__MONOPOLYSERVER__}/map/list`, { params: { page, size } })
	).data as any;
	return { total, mapsList, current };
};

export const getMapById = async (mapId: string) => {
	const data = (await axios.get(`${__MONOPOLYSERVER__}/map/info`, { params: { id: mapId } })).data as any;
	return data as GameMap;
};

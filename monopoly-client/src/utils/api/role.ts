import axios from "axios";
import { __MONOPOLYSERVER__ } from "@G/global.config";

export const getRoleList = async () => {
    const {total, roleList, current} = (await axios.get(`${__MONOPOLYSERVER__}/role/list`, {params: {page: -1}})).data as any;
    return {total, roleList, current};
};

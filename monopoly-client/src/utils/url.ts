import { __PROTOCOL__ } from "@G/global.config";

const ABSOLUTE_URL_REG = /^https?:\/\//i;

export function normalizeExternalUrl(raw: string | null | undefined): string {
	const value = (raw || "").trim();
	if (!value || value === "null" || value === "undefined") return "";
	if (ABSOLUTE_URL_REG.test(value)) return value;
	if (value.startsWith("//")) return `${__PROTOCOL__}:${value}`;
	return `${__PROTOCOL__}://${value.replace(/^\/+/, "")}`;
}

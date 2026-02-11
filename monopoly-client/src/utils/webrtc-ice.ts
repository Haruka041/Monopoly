const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
	{ urls: "stun:stun.l.google.com:19302" },
	{ urls: "stun:stun1.l.google.com:19302" },
];

type RuntimeConfig = {
	turnUrls?: string | string[];
	turnUsername?: string;
	turnCredential?: string;
	extraStunUrls?: string | string[];
	iceServersJson?: string;
	iceServers?: RTCIceServer[];
};

const splitUrls = (value: string | string[] | undefined): string[] => {
	if (!value) return [];
	if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
	return value
		.split(/[,\s;]+/g)
		.map((item) => item.trim())
		.filter(Boolean);
};

const normalizeIceServers = (input: unknown): RTCIceServer[] => {
	if (!Array.isArray(input)) return [];
	return input
		.filter((item): item is RTCIceServer => !!item && typeof item === "object" && "urls" in item)
		.map((item) => item);
};

const getRuntimeConfig = (): RuntimeConfig => {
	if (typeof window === "undefined") return {};
	return (window as any).__MONOPOLY_RUNTIME__ || {};
};

const uniqueBySignature = (servers: RTCIceServer[]): RTCIceServer[] => {
	const seen = new Set<string>();
	return servers.filter((server) => {
		const urls = Array.isArray(server.urls) ? server.urls.join("|") : server.urls;
		const signature = `${urls}|${server.username || ""}|${server.credential || ""}`;
		if (seen.has(signature)) return false;
		seen.add(signature);
		return true;
	});
};

export const buildIceServers = (): RTCIceServer[] => {
	const runtimeConfig = getRuntimeConfig();

	if (Array.isArray(runtimeConfig.iceServers) && runtimeConfig.iceServers.length > 0) {
		return uniqueBySignature(normalizeIceServers(runtimeConfig.iceServers));
	}

	if (runtimeConfig.iceServersJson) {
		try {
			const parsed = JSON.parse(runtimeConfig.iceServersJson);
			const parsedServers = normalizeIceServers(parsed);
			if (parsedServers.length > 0) return uniqueBySignature(parsedServers);
		} catch (error) {
			console.warn("[webrtc] invalid ICE_SERVERS_JSON, fallback to default STUN/TURN", error);
		}
	}

	const extraStunUrls = splitUrls(runtimeConfig.extraStunUrls);
	const turnUrls = splitUrls(runtimeConfig.turnUrls);
	const iceServers: RTCIceServer[] = [...DEFAULT_ICE_SERVERS];

	for (const stunUrl of extraStunUrls) {
		iceServers.push({ urls: stunUrl });
	}

	if (turnUrls.length > 0) {
		const turnServer: RTCIceServer = {
			urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls,
		};
		if (runtimeConfig.turnUsername) turnServer.username = runtimeConfig.turnUsername;
		if (runtimeConfig.turnCredential) turnServer.credential = runtimeConfig.turnCredential;
		iceServers.push(turnServer);
	}

	return uniqueBySignature(iceServers);
};

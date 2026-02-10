const isBrowser = typeof window !== "undefined";
const protocol = isBrowser
	? (window.location.protocol.replace(":", "") as "http" | "https")
	: "http";
const origin = isBrowser ? window.location.origin : "http://localhost";
const host = isBrowser ? window.location.hostname : "localhost";
const port = isBrowser && window.location.port ? Number(window.location.port) : protocol === "https" ? 443 : 80;

export const __PROTOCOL__ = protocol;
export const __MONOPOLYSERVER__ = "/monopoly-server";
export const __USERSERVER__ = "/user-server";
export const __LOGINPAGEURL__ = `${origin}/81/`;
// PeerJS server endpoint lives under /peerjs behind the /ice-server reverse proxy prefix.
export const __ICE_SERVER_PATH__ = "ice-server/peerjs";

export const __FATPAPER_HOST__ = host;
export const __ICE_SERVER_PORT__ = port;

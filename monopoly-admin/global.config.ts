const isBrowser = typeof window !== "undefined";

export const __MONOPOLYSERVER__ = "/monopoly-server";
export const __USERSERVER__ = "/user-server";
export const __LOGINPAGEURL__ = isBrowser ? `${window.location.origin}/81/` : "/81/";
export const __PROTOCOL__ = isBrowser
	? (window.location.protocol.replace(":", "") as "http" | "https")
	: "http";

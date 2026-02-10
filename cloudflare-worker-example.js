export default {
	async fetch(request) {
		const targetHostname = "your-space-name.hf.space";
		const targetUrl = new URL(request.url);

		targetUrl.protocol = "https:";
		targetUrl.hostname = targetHostname;

		const pathname = targetUrl.pathname;
		const isApiOrRealtime =
			pathname.startsWith("/user-server/") ||
			pathname.startsWith("/monopoly-server/") ||
			pathname.startsWith("/ice-server/");
		const isHtmlShell =
			pathname === "/" ||
			pathname === "/81" ||
			pathname === "/81/" ||
			pathname === "/82" ||
			pathname === "/82/" ||
			pathname.endsWith(".html");

		const upstreamRequest = new Request(targetUrl.toString(), request);
		upstreamRequest.headers.set("Host", targetHostname);

		const upstreamResponse = await fetch(upstreamRequest, {
			// Avoid stale HTML/API responses on proxy domain.
			cf: isApiOrRealtime || isHtmlShell ? { cacheEverything: false, cacheTtl: 0 } : undefined,
		});

		if (!isApiOrRealtime && !isHtmlShell) return upstreamResponse;

		const headers = new Headers(upstreamResponse.headers);
		headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
		headers.set("Pragma", "no-cache");
		headers.set("Expires", "0");
		headers.set("Surrogate-Control", "no-store");

		return new Response(upstreamResponse.body, {
			status: upstreamResponse.status,
			statusText: upstreamResponse.statusText,
			headers,
		});
	},
};

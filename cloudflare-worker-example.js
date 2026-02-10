export default {
    async fetch(request) {
        const targetHostname = "your-space-name.hf.space";
        const targetUrl = new URL(request.url);

        targetUrl.protocol = "https:";
        targetUrl.hostname = targetHostname;

        const proxyRequest = new Request(targetUrl.toString(), request);
        proxyRequest.headers.set("Host", targetHostname);

        return fetch(proxyRequest, {
            // 游戏接口与 websocket 都不应缓存
            cf: {
                cacheEverything: false,
                cacheTtl: 0,
            },
        });
    },
};

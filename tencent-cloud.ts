//腾讯云COS对象存储的配置，没有配置COS会将文件存到本地public中。
const env = process.env;

export const __TC_SECRETID__ = env.TC_SECRETID || "";
export const __TC_SECRETKEY__ = env.TC_SECRETKEY || "";

export const __TC_BUCKET_NAME__ = env.TC_BUCKET_NAME || "";
export const __TC_REGION__ = env.TC_REGION || "";

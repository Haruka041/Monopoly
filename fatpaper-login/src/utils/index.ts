import JSEncrypt from "jsencrypt";
import { getPublicKey } from "./api";

export function shuffleArray<T>(arr: T[]) {
	return arr.sort(function () {
		return 0.5 - Math.random();
	});
}

async function encryptWithPublicKey(password: string, publicKey: string) {
	const encrypt = new JSEncrypt();
	encrypt.setPublicKey(publicKey);
	const encrypted = encrypt.encrypt(password);
	return encrypted;
}

export async function getEncryption(str: string) {
	let publicKey = localStorage.getItem("public-key");
	if (!publicKey) publicKey = await getPublicKey();

	let encrypted = publicKey ? await encryptWithPublicKey(str, publicKey) : null;
	if (!encrypted) {
		// Space 重启后服务端密钥会变化，自动刷新公钥再重试一次
		publicKey = await getPublicKey();
		encrypted = publicKey ? await encryptWithPublicKey(str, publicKey) : null;
	}

	return encrypted;
}

import axios from "axios";
import { getEncryption } from "../index";
import FPMessage from "@/components/fp-message";

const pickPublicKeyFromError = (error: any): string | null => {
	const pk = error?.response?.data?.data?.publicKey;
	if (typeof pk === "string" && pk.includes("BEGIN PUBLIC KEY")) return pk;
	return null;
};

const isDecryptError = (error: any) => {
	const msg = error?.response?.data?.msg;
	return typeof msg === "string" && msg.includes("客户端密码解密失败");
};

export const getUserInfo = async () => {
	const res = await axios.get("/user/info");
	return res.data as { id: string; username: string; avatar: string; color: string };
};

export const getPublicKey = async () => {
	const res = await axios.get("/user/public-key", {
		params: { _ts: Date.now() },
		headers: {
			"Cache-Control": "no-cache",
			Pragma: "no-cache",
		},
	});
	const publicKey = res.data as string;
	if (!publicKey || !publicKey.includes("BEGIN PUBLIC KEY")) {
		throw new Error("获取公钥失败");
	}
	localStorage.setItem("public-key", publicKey);
	return publicKey;
};

export const apiLogin = async (useraccount: string, password: string) => {
	const doLogin = async () => {
		const encryptionPassword = await getEncryption(password);
		if (!encryptionPassword) {
			throw new Error("PASSWORD_ENCRYPT_FAILED");
		}
		const res = (await axios.post("/user/login", {
			useraccount,
			password: encryptionPassword,
		})) as any;
		return res.data;
	};

	try {
		return await doLogin();
	} catch (error: any) {
		if (error?.message === "PASSWORD_ENCRYPT_FAILED") {
			FPMessage({ type: "error", message: "密码加密异常" });
			return;
		}
		if (isDecryptError(error)) {
			const publicKeyFromError = pickPublicKeyFromError(error);
			if (publicKeyFromError) {
				localStorage.setItem("public-key", publicKeyFromError);
			} else {
				await getPublicKey();
			}
			return await doLogin();
		}
		throw error;
	}
};

export const apiRegister = async (formData: FormData, retryOnDecryptError = false) => {
	try {
		const res = await axios.post("/user/register", formData, {
			headers: {
				"Content-Type": "multipart/form-data",
			},
		});
		return res.status === 200 ? true : false;
	} catch (error: any) {
		if (!retryOnDecryptError && isDecryptError(error)) {
			const publicKeyFromError = pickPublicKeyFromError(error);
			if (publicKeyFromError) {
				localStorage.setItem("public-key", publicKeyFromError);
			} else {
				await getPublicKey();
			}
		}
		throw error;
	}
};

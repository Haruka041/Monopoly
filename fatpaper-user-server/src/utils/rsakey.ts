import crypto from "crypto";
import fs from "fs";
import path from "path";

type KeyPair = { privateKey: string; publicKey: string };

function generateKeyPair(): KeyPair {
	return crypto.generateKeyPairSync("rsa", {
		modulusLength: 2048,
		publicKeyEncoding: {
			type: "spki",
			format: "pem",
		},
		privateKeyEncoding: {
			type: "pkcs8",
			format: "pem",
		},
	});
}

function loadOrCreateKeyPair(): KeyPair {
	// Prefer HF persistent volume when available to keep keys stable across restarts.
	const baseDir = process.env.RSA_KEY_DIR || (fs.existsSync("/data") ? "/data/monopoly-rsa" : path.resolve(process.cwd(), ".rsa"));
	const privateKeyPath = process.env.RSA_PRIVATE_KEY_PATH || path.join(baseDir, "private.pem");
	const publicKeyPath = process.env.RSA_PUBLIC_KEY_PATH || path.join(baseDir, "public.pem");

	try {
		if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
			return {
				privateKey: fs.readFileSync(privateKeyPath, "utf8"),
				publicKey: fs.readFileSync(publicKeyPath, "utf8"),
			};
		}
	} catch (_) {
		// Fall through to key generation.
	}

	const generated = generateKeyPair();
	try {
		fs.mkdirSync(path.dirname(privateKeyPath), { recursive: true });
		fs.mkdirSync(path.dirname(publicKeyPath), { recursive: true });
		fs.writeFileSync(privateKeyPath, generated.privateKey, { encoding: "utf8", mode: 0o600 });
		fs.writeFileSync(publicKeyPath, generated.publicKey, { encoding: "utf8", mode: 0o600 });
	} catch (_) {
		// If persistence write fails, continue with in-memory generated keys.
	}
	return generated;
}

export const { privateKey, publicKey } = loadOrCreateKeyPair();

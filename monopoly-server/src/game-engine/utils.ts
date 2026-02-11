import * as ts from "typescript";

export function getRandomInteger(min: number, max: number) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomString(length: number) {
	const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let random = "";
	for (let i = 0; i < length; i++) {
		const randomIndex = Math.floor(Math.random() * characters.length);
		random += characters.charAt(randomIndex);
	}
	return random;
}

export function compileTsToJs(code: string, prelude: string): string {
	const fullCode = `${prelude}\n${code}`;
	const result = ts.transpileModule(fullCode, {
		compilerOptions: {
			module: ts.ModuleKind.None,
			target: ts.ScriptTarget.ES2020,
			strict: true,
			esModuleInterop: true,
			removeComments: true,
			noEmitHelpers: true,
		},
	});
	return result.outputText;
}

type DynamicAsyncFunction = (...args: any[]) => Promise<any>;

export function createAsyncExecutor(params: string[], body: string): DynamicAsyncFunction {
	// IMPORTANT:
	// Do not rely on `Object.getPrototypeOf(async function(){}).constructor` directly in TS source.
	// TS downlevels async/await for CommonJS builds, which would turn it into a normal Function at runtime.
	// We must obtain AsyncFunction via runtime parsing to preserve native async semantics.
	const AsyncFunctionCtor = Function("return Object.getPrototypeOf(async function(){}).constructor;")() as {
		new (...args: string[]): DynamicAsyncFunction;
	};

	return new AsyncFunctionCtor(...params, body);
}

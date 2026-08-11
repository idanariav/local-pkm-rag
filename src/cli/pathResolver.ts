import { existsSync, readdirSync, accessSync, constants as fsConstants } from "fs";
import { homedir } from "os";
import { join, delimiter } from "path";
import { spawn } from "child_process";

let cachedEnvPromise: Promise<NodeJS.ProcessEnv> | undefined;

function highestNvmNodeBin(): string | undefined {
	const nvmDir = join(homedir(), ".nvm", "versions", "node");
	if (!existsSync(nvmDir)) return undefined;
	try {
		const versions = readdirSync(nvmDir).filter((v) => /^v\d+\.\d+\.\d+$/.test(v));
		if (versions.length === 0) return undefined;
		versions.sort((a, b) => {
			const pa = a.slice(1).split(".").map(Number);
			const pb = b.slice(1).split(".").map(Number);
			for (let i = 0; i < 3; i++) {
				if (pa[i] !== pb[i]) return pa[i] - pb[i];
			}
			return 0;
		});
		return join(nvmDir, versions[versions.length - 1], "bin");
	} catch {
		return undefined;
	}
}

/** Directories that commonly hold Node/npm-installed global binaries but aren't
 *  on Electron's minimal subprocess PATH (which isn't sourced from .zshrc/.bashrc). */
function staticCandidateDirs(): string[] {
	const home = homedir();
	const candidates =
		process.platform === "win32"
			? [join(home, "AppData", "Roaming", "npm"), join(home, "AppData", "Local", "Volta", "bin")]
			: [
					"/opt/homebrew/bin",
					"/opt/homebrew/sbin",
					"/usr/local/bin",
					join(home, ".volta", "bin"),
					join(home, ".npm-global", "bin"),
					join(home, ".local", "share", "pnpm"),
				];
	const nvmBin = highestNvmNodeBin();
	if (nvmBin) candidates.push(nvmBin);
	return candidates.filter((dir) => existsSync(dir));
}

/** Best-effort: ask npm (if reachable at all via the current PATH) where its global bin dir is. */
function npmPrefixBin(): Promise<string | undefined> {
	return new Promise((resolve) => {
		try {
			const child = spawn("npm", ["config", "get", "prefix"], { shell: false, env: process.env });
			let out = "";
			child.stdout?.on("data", (chunk) => (out += chunk.toString()));
			child.on("error", () => resolve(undefined));
			child.on("close", (code) => {
				if (code !== 0) return resolve(undefined);
				const prefix = out.trim();
				if (!prefix) return resolve(undefined);
				const bin = process.platform === "win32" ? prefix : join(prefix, "bin");
				resolve(existsSync(bin) ? bin : undefined);
			});
		} catch {
			resolve(undefined);
		}
	});
}

/** Build (and cache for the session) a copy of process.env whose PATH additionally
 *  covers the common Homebrew/nvm/volta/npm-global install locations. */
export async function buildAugmentedEnv(): Promise<NodeJS.ProcessEnv> {
	if (!cachedEnvPromise) {
		cachedEnvPromise = (async () => {
			const dirs = staticCandidateDirs();
			const npmBin = await npmPrefixBin();
			if (npmBin && !dirs.includes(npmBin)) dirs.push(npmBin);

			const existingPath = process.env.PATH ?? "";
			return {
				...process.env,
				PATH: [...dirs, existingPath].filter(Boolean).join(delimiter),
			};
		})();
	}
	return cachedEnvPromise;
}

/** Clears the memoized env so the next buildAugmentedEnv() call recomputes it. */
export function resetAugmentedEnvCache(): void {
	cachedEnvPromise = undefined;
}

/** Finds the absolute path of an executable by walking the given PATH-augmented env's
 *  directories, so a successful bare-name detection can be persisted as a real path
 *  rather than just the literal binary name. */
export function findExecutableInPath(binaryName: string, env: NodeJS.ProcessEnv): string | undefined {
	const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
	for (const dir of dirs) {
		const candidate = join(dir, binaryName);
		if (!existsSync(candidate)) continue;
		try {
			accessSync(candidate, fsConstants.X_OK);
			return candidate;
		} catch {
			continue;
		}
	}
	return undefined;
}

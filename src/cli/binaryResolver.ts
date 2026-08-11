import { existsSync, accessSync, constants as fsConstants } from "fs";
import { CliRunner } from "./processRunner";
import { buildAugmentedEnv, findExecutableInPath } from "./pathResolver";
import { DetectResult } from "./types";

const DETECT_TIMEOUT_MS = 10000;

const runner = new CliRunner();

function isExecutablePath(path: string): boolean {
	try {
		accessSync(path, fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/** Resolves the executable to invoke: a valid override path verbatim, or the bare
 *  binary name (left to the PATH-augmented env to resolve). Shared by detection and execution
 *  so both agree on which binary is actually being run. */
export function resolveExecutableTarget(binaryName: string, overridePath?: string): string {
	const useOverride = !!overridePath && existsSync(overridePath) && isExecutablePath(overridePath);
	return useOverride ? (overridePath as string) : binaryName;
}

/** Detects a CLI binary by spawning its health-check command directly (one subprocess call):
 *  ENOENT => not installed, nonzero exit => installed but unhealthy, exit 0 => healthy.
 *  If overridePath is a valid executable it's used verbatim; otherwise binaryName is
 *  resolved against the PATH-augmented env (so Homebrew/nvm/volta installs are found). */
export async function detectBinary(
	binaryName: string,
	healthCheckArgs: string[],
	overridePath?: string
): Promise<DetectResult> {
	const env = await buildAugmentedEnv();
	const target = resolveExecutableTarget(binaryName, overridePath);
	// When falling back to bare-name PATH resolution, also resolve the real absolute path
	// (spawn resolves it internally but doesn't hand it back) so callers can persist it.
	const resolvedPath = target !== binaryName ? target : (findExecutableInPath(binaryName, env) ?? target);

	try {
		const result = await runner.run(target, healthCheckArgs, { env, timeoutMs: DETECT_TIMEOUT_MS });
		if (result.code === 0) {
			return { status: "healthy", resolvedPath };
		}
		return {
			status: "unhealthy",
			resolvedPath,
			message: result.stderr.trim() || result.stdout.trim() || `exited with code ${result.code}`,
		};
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		if (err.code === "ENOENT") {
			return { status: "not-found" };
		}
		return { status: "unhealthy", message: err.message ?? String(error) };
	}
}

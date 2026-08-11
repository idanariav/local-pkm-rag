import { spawn } from "child_process";

export interface RunOptions {
	env: NodeJS.ProcessEnv;
	timeoutMs?: number;
	cwd?: string;
}

export interface RunResult {
	stdout: string;
	stderr: string;
	code: number;
}

export interface StreamingOptions {
	env: NodeJS.ProcessEnv;
	cwd?: string;
	timeoutMs?: number;
	onStdout?: (chunk: string) => void;
	onStderr?: (chunk: string) => void;
}

export interface StreamingHandle {
	promise: Promise<{ code: number }>;
	kill: () => void;
}

const KILL_GRACE_MS = 3000;

/** Runs CLI binaries via spawn() (argv passed directly, no shell) so there is no
 *  shell-quoting to get wrong, and exposes both buffered and streaming execution. */
export class CliRunner {
	run(binPath: string, args: string[], opts: RunOptions): Promise<RunResult> {
		return new Promise((resolve, reject) => {
			const child = spawn(binPath, args, { shell: false, env: opts.env, cwd: opts.cwd });
			let stdout = "";
			let stderr = "";
			let settled = false;
			let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

			const finish = (fn: () => void) => {
				if (settled) return;
				settled = true;
				if (timeoutHandle) clearTimeout(timeoutHandle);
				fn();
			};

			if (opts.timeoutMs) {
				timeoutHandle = setTimeout(() => {
					child.kill("SIGTERM");
					setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
					finish(() =>
						reject(new Error(`Command timed out after ${opts.timeoutMs}ms: ${binPath} ${args.join(" ")}`))
					);
				}, opts.timeoutMs);
			}

			child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
			child.stderr?.on("data", (chunk) => (stderr += chunk.toString()));
			child.on("error", (error) => finish(() => reject(error)));
			child.on("close", (code) => finish(() => resolve({ stdout, stderr, code: code ?? -1 })));
		});
	}

	runStreaming(binPath: string, args: string[], opts: StreamingOptions): StreamingHandle {
		const child = spawn(binPath, args, { shell: false, env: opts.env, cwd: opts.cwd });
		let settled = false;
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

		const promise = new Promise<{ code: number }>((resolve, reject) => {
			const finish = (fn: () => void) => {
				if (settled) return;
				settled = true;
				if (timeoutHandle) clearTimeout(timeoutHandle);
				fn();
			};

			if (opts.timeoutMs) {
				timeoutHandle = setTimeout(() => {
					child.kill("SIGTERM");
					setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
					finish(() =>
						reject(new Error(`Command timed out after ${opts.timeoutMs}ms: ${binPath} ${args.join(" ")}`))
					);
				}, opts.timeoutMs);
			}

			child.stdout?.on("data", (chunk) => opts.onStdout?.(chunk.toString()));
			child.stderr?.on("data", (chunk) => opts.onStderr?.(chunk.toString()));
			child.on("error", (error) => finish(() => reject(error)));
			child.on("close", (code) => finish(() => resolve({ code: code ?? -1 })));
		});

		return {
			promise,
			kill: () => {
				child.kill("SIGTERM");
				setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
			},
		};
	}
}

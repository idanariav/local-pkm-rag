import { CliRunner, RunResult } from "./processRunner";
import { buildAugmentedEnv } from "./pathResolver";
import { detectBinary, resolveExecutableTarget } from "./binaryResolver";
import { CommandNode, DetectResult, ToolSchema } from "./types";

/** Reserved values-key: set true to append a command's jsonFlag (if it has one). */
export const JSON_OUTPUT_VALUE_KEY = "__outputJson";

export interface CommandResult extends RunResult {
	json?: unknown;
}

export type CommandValues = Record<string, unknown>;

export interface StreamingCommandHandle {
	kill: () => void;
	done: Promise<CommandResult>;
	argv: string[];
	command: CommandNode;
}

const DEFAULT_TIMEOUT_MS = 30000;

function buildArgv(command: CommandNode, values: CommandValues): string[] {
	const argv = [...command.argvPath];

	for (const positional of command.positionals) {
		const value = values[positional.name];
		if (value === undefined || value === null || value === "") {
			if (positional.required) {
				throw new Error(`Missing required argument: ${positional.label}`);
			}
			continue;
		}
		argv.push(String(value));
	}

	for (const flag of command.flags) {
		const value = values[flag.flag];
		if (value === undefined || value === null) continue;

		if (flag.type === "boolean") {
			if (value === true) argv.push(flag.flag);
			continue;
		}

		if (flag.repeatable) {
			const items = Array.isArray(value) ? value : [value];
			for (const item of items) {
				if (item === undefined || item === null || item === "") continue;
				argv.push(flag.flag, String(item));
			}
			continue;
		}

		if (value === "") continue;
		argv.push(flag.flag, String(value));
	}

	if (command.jsonFlag && values[JSON_OUTPUT_VALUE_KEY] === true) {
		argv.push(command.jsonFlag);
	}

	return argv;
}

function attachJson(command: CommandNode, argv: string[], result: RunResult): CommandResult {
	if (!command.jsonFlag || !argv.includes(command.jsonFlag)) return result;
	try {
		return { ...result, json: JSON.parse(result.stdout) };
	} catch {
		return result;
	}
}

/** Schema-driven executor for one CLI tool: builds argv from a CommandNode + user-supplied
 *  values, runs it buffered or streaming, and optionally parses --json output. This is the
 *  single code path all four tools' clients (and the generic command console) run through. */
export class GenericCliClient {
	private readonly runner = new CliRunner();

	constructor(
		private readonly binaryName: string,
		private readonly healthCheckCommand: string[],
		private readonly schema: ToolSchema,
		private overridePath?: string,
		private defaultTimeoutMs: number = DEFAULT_TIMEOUT_MS
	) {}

	updatePath(overridePath: string | undefined): void {
		this.overridePath = overridePath;
	}

	updateDefaultTimeout(timeoutMs: number): void {
		this.defaultTimeoutMs = timeoutMs;
	}

	async isAvailable(): Promise<boolean> {
		const result = await this.detect();
		return result.status === "healthy";
	}

	detect(): Promise<DetectResult> {
		return detectBinary(this.binaryName, this.healthCheckCommand, this.overridePath);
	}

	getCommand(commandId: string): CommandNode {
		const command = this.schema.commands.find((c) => c.id === commandId);
		if (!command) throw new Error(`Unknown command "${commandId}" for tool "${this.schema.id}"`);
		return command;
	}

	listCommands(): CommandNode[] {
		return this.schema.commands;
	}

	buildArgvPreview(commandId: string, values: CommandValues): string[] {
		return buildArgv(this.getCommand(commandId), values);
	}

	/** Buffered execution: waits for the process to exit and returns the full result. */
	async runCommand(commandId: string, values: CommandValues = {}, timeoutMs?: number): Promise<CommandResult> {
		const command = this.getCommand(commandId);
		const argv = buildArgv(command, values);
		const env = await buildAugmentedEnv();
		const bin = resolveExecutableTarget(this.binaryName, this.overridePath);

		const result = await this.runner.run(bin, argv, {
			env,
			timeoutMs: timeoutMs ?? this.defaultTimeoutMs,
		});
		return attachJson(command, argv, result);
	}

	/** Streaming execution: returns a handle with kill() immediately, output arrives via callbacks. */
	async runCommandStreaming(
		commandId: string,
		values: CommandValues = {},
		onStdout?: (chunk: string) => void,
		onStderr?: (chunk: string) => void
	): Promise<StreamingCommandHandle> {
		const command = this.getCommand(commandId);
		const argv = buildArgv(command, values);
		const env = await buildAugmentedEnv();
		const bin = resolveExecutableTarget(this.binaryName, this.overridePath);

		let stdout = "";
		let stderr = "";
		const handle = this.runner.runStreaming(bin, argv, {
			env,
			onStdout: (chunk) => {
				stdout += chunk;
				onStdout?.(chunk);
			},
			onStderr: (chunk) => {
				stderr += chunk;
				onStderr?.(chunk);
			},
		});

		const done = handle.promise.then(({ code }) => attachJson(command, argv, { stdout, stderr, code }));
		return { kill: handle.kill, done, argv, command };
	}
}

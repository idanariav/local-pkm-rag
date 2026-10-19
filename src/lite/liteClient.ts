import { App, normalizePath } from "obsidian";
import type { CommandResult, CommandValues, GenericCliClient, StreamingCommandHandle } from "../cli/genericClient";
import { CommandNode, ToolId, ToolSchema } from "../cli/types";
import { QmdLite, QmdSearchOptions } from "./qmdLite";
import { QvoidLite } from "./qvoidLite";
import { QimgLite } from "./qimgLite";

/** The part of GenericCliClient the console uses, so it can run either a CLI or lite mode. */
export type ConsoleClient = Pick<GenericCliClient, "listCommands" | "runCommand" | "runCommandStreaming" | "updatePath">;

/** Commands lite mode answers, and per command the flags it honors (others are hidden). */
const LITE_COMMANDS: Partial<Record<ToolId, Record<string, string[] | "all">>> = {
	qmd: {
		vsearch: ["-n", "-c", "--all", "--min-score"],
		tsearch: ["-n", "-c", "--all", "--min-score"],
		hsearch: ["-n", "-c", "--all", "--min-score"],
		fsearch: ["-n", "-c"],
		get: "all",
		"collection.list": "all",
	},
	qvoid: {
		query: "all",
		"find-similar": ["--cluster", "--top-k", "--min-score", "--threshold", "--format"],
		collections: "all",
	},
	qimg: {
		tsearch: ["--collection", "--after", "--before", "-n"],
		vsearch: "all",
		hsearch: "all",
		get: "all",
		"collection.list": "all",
	},
};

/** Tools with a lite mode (`usesLiteMode` is only ever true for these). */
export type LiteTool = "qmd" | "qvoid" | "qimg";
type LiteBackend = QmdLite | QvoidLite | QimgLite;

export function hasLiteMode(tool: ToolId): boolean {
	return tool in LITE_COMMANDS;
}

/** Loads each tool's export once, reloading when its manifest changes on disk. */
export class LiteBackends {
	private cache: Partial<Record<LiteTool, { mtime: number; backend: Promise<LiteBackend | null> }>> = {};

	constructor(
		private readonly app: App,
		private readonly exportDir: () => string
	) {}

	qmd(): Promise<QmdLite | null> {
		return this.get("qmd", (dir) => QmdLite.load(this.app, dir)) as Promise<QmdLite | null>;
	}

	qvoid(): Promise<QvoidLite | null> {
		return this.get("qvoid", (dir) => QvoidLite.load(this.app, dir)) as Promise<QvoidLite | null>;
	}

	qimg(): Promise<QimgLite | null> {
		return this.get("qimg", (dir) => QimgLite.load(this.app, dir)) as Promise<QimgLite | null>;
	}

	/** Whichever export backs `tool`, for callers that only need what they share (e.g. exportedAt). */
	forTool(tool: LiteTool): Promise<LiteBackend | null> {
		return tool === "qmd" ? this.qmd() : tool === "qvoid" ? this.qvoid() : this.qimg();
	}

	private async get(tool: LiteTool, load: (dir: string) => Promise<LiteBackend | null>) {
		const dir = normalizePath(`${this.exportDir()}/${tool}`);
		const mtime = (await this.app.vault.adapter.stat(`${dir}/manifest.json`))?.mtime ?? 0;
		const cached = this.cache[tool];
		if (cached && cached.mtime === mtime) return cached.backend;
		const backend = load(dir);
		this.cache[tool] = { mtime, backend };
		return backend;
	}
}

const num = (v: unknown): number | undefined => {
	if (v === undefined || v === null || v === "") return undefined;
	const n = Number(v);
	return isNaN(n) ? undefined : n;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const list = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(String).filter(Boolean);

/** Answers the console's search commands from the tool exports — same results contract
 *  (stdout/stderr/json) as GenericCliClient, so the console renders them unchanged. */
export class LiteClient implements ConsoleClient {
	constructor(
		private readonly tool: ToolId,
		private readonly schema: ToolSchema,
		private readonly backends: LiteBackends
	) {}

	updatePath(): void {
		// No binary to point at.
	}

	listCommands(): CommandNode[] {
		const supported = LITE_COMMANDS[this.tool] ?? {};
		return this.schema.commands
			.filter((c) => c.id in supported)
			.map((c) => {
				const flags = supported[c.id];
				return flags === "all" ? c : { ...c, flags: c.flags.filter((f) => flags.includes(f.flag)) };
			});
	}

	async runCommand(commandId: string, values: CommandValues = {}): Promise<CommandResult> {
		try {
			return await this.dispatch(commandId, values);
		} catch (error) {
			return { stdout: "", stderr: (error as Error).message, code: 1 };
		}
	}

	async runCommandStreaming(
		commandId: string,
		values: CommandValues = {},
		onStdout?: (chunk: string) => void,
		onStderr?: (chunk: string) => void
	): Promise<StreamingCommandHandle> {
		const command = this.listCommands().find((c) => c.id === commandId);
		if (!command) throw new Error(`"${commandId}" isn't available in lite mode`);
		const done = this.runCommand(commandId, values).then((r) => {
			if (r.stdout) onStdout?.(r.stdout);
			if (r.stderr) onStderr?.(r.stderr);
			return r;
		});
		return { kill: () => undefined, done, argv: command.argvPath, command };
	}

	private async dispatch(commandId: string, values: CommandValues): Promise<CommandResult> {
		if (this.tool === "qmd") return this.runQmd(commandId, values);
		if (this.tool === "qvoid") return this.runQvoid(commandId, values);
		if (this.tool === "qimg") return this.runQimg(commandId, values);
		throw new Error(`${this.tool} has no lite mode`);
	}

	private async runQimg(commandId: string, values: CommandValues): Promise<CommandResult> {
		const qimg = await this.backends.qimg();
		if (!qimg) throw new Error("No qimg export found. Run `qimg export` on a desktop with qimg installed.");

		const json = (data: unknown): CommandResult => ({ stdout: JSON.stringify(data, null, 2), stderr: "", code: 0, json: data });
		// Dates as the qimg CLI parses them: --before covers the whole day.
		const date = (v: unknown, endOfDay: boolean): number | undefined => {
			const s = str(v);
			if (!s) return undefined;
			const d = new Date(s);
			if (isNaN(d.getTime())) throw new Error(`invalid date: ${s} (expected YYYY-MM-DD)`);
			if (endOfDay) d.setHours(23, 59, 59, 999);
			return d.getTime();
		};
		const opts = {
			limit: num(values["-n"]) ?? 20,
			collection: str(values["--collection"]),
			after: date(values["--after"], false),
			before: date(values["--before"], true),
		};
		const query = str(values.query);
		const image = str(values["--image"]);

		switch (commandId) {
			case "tsearch": return json(qimg.tsearch(query ?? "", opts));
			case "vsearch": return json(qimg.vsearch(query, image, opts));
			case "hsearch": return json(qimg.hsearch(query, image, opts));
			case "get": return json(qimg.get(str(values.target) ?? ""));
			case "collection.list": return { stdout: qimg.collectionList(), stderr: "", code: 0 };
		}
		throw new Error(`"${commandId}" isn't available in lite mode`);
	}

	private async runQmd(commandId: string, values: CommandValues): Promise<CommandResult> {
		const qmd = await this.backends.qmd();
		if (!qmd) throw new Error("No qmd export found. Run `qmd export` on a desktop with qmd installed.");

		const json = (data: unknown): CommandResult => ({ stdout: JSON.stringify(data, null, 2), stderr: "", code: 0, json: data });
		// Same defaults as the qmd CLI with --json: 20 results, --all = no limit.
		const search = (defaultMinScore: number): QmdSearchOptions => ({
			limit: values["--all"] === true ? Infinity : num(values["-n"]) ?? 20,
			collections: list(values["-c"]),
			minScore: num(values["--min-score"]) ?? defaultMinScore,
		});
		const query = str(values.query) ?? "";

		switch (commandId) {
			case "vsearch": return json(await qmd.vsearch(query, search(0.3)));
			case "tsearch": return json(await qmd.tsearch(query, search(0)));
			case "hsearch": return json(await qmd.hsearch(query, search(0)));
			case "fsearch": return json(await qmd.fsearch(str(values.filter) ?? "", { ...search(0), limit: num(values["-n"]) ?? 50 }));
			case "collection.list": return { stdout: qmd.collectionList(), stderr: "", code: 0 };
			case "get": {
				const text = await qmd.get(str(values.target) ?? "", {
					section: str(values["--section"]),
					noCallouts: values["--no-callouts"] === true,
					noCodeblocks: values["--no-codeblocks"] === true,
					from: num(values["--from"]),
					lines: num(values["-l"]),
					lineNumbers: values["--line-numbers"] === true,
				});
				return { stdout: text, stderr: "", code: 0 };
			}
		}
		throw new Error(`"${commandId}" isn't available in lite mode`);
	}

	private async runQvoid(commandId: string, values: CommandValues): Promise<CommandResult> {
		const qvoid = await this.backends.qvoid();
		if (!qvoid) throw new Error("No qvoid export found. Run `qvoid export` on a desktop with qvoid installed.");

		const out = (o: { stdout: string; stderr: string }): CommandResult => ({ ...o, code: 0 });
		switch (commandId) {
			case "collections": return out({ stdout: qvoid.collectionList(), stderr: "" });
			case "query":
				return out(
					qvoid.query({
						destination: str(values["--destination"])?.split(",").map((s) => s.trim()).filter(Boolean),
						origin: str(values["--origin"]),
						semanticType: str(values["--semantic-type"]),
						minOccurrences: num(values["--min-occurrences"]),
						search: str(values["--search"]),
						limit: num(values["--limit"]),
						format: str(values["--format"]) ?? "summary",
					})
				);
			case "find-similar":
				return out(
					qvoid.findSimilar(str(values.query), {
						cluster: values["--cluster"] === true,
						topK: num(values["--top-k"]) ?? 10,
						minScore: num(values["--min-score"]) ?? 0.5,
						threshold: num(values["--threshold"]) ?? 0.82,
						format: str(values["--format"]) ?? "text",
					})
				);
		}
		throw new Error(`"${commandId}" isn't available in lite mode`);
	}
}

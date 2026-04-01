import { exec } from "child_process";

export interface QmdSearchResult {
	docid: string;
	score: number;
	file: string;
	title: string;
	context: string;
	snippet: string;
}

export interface QmdSearchOptions {
	limit?: number;
	minScore?: number;
	collection?: string;
}

export interface QmdStatusResult {
	collections: { name: string; documents: number; context: string }[];
	totalDocuments: number;
}

/**
 * Client for communicating with QMD via CLI subprocess.
 */
export class QmdClient {
	private qmdPath: string;

	constructor(qmdPath: string) {
		this.qmdPath = qmdPath;
	}

	updatePath(qmdPath: string): void {
		this.qmdPath = qmdPath;
	}

	/** Check if the QMD binary is available and responsive. */
	async isAvailable(): Promise<boolean> {
		try {
			await this.execQmd(["status"]);
			return true;
		} catch {
			return false;
		}
	}

	/** Get QMD status including collections and document counts. */
	async status(): Promise<string> {
		return this.execQmd(["status"]);
	}

	/** Get available collection names from QMD status output. */
	async getCollections(): Promise<string[]> {
		try {
			const output = await this.execQmd(["collection", "list"]);
			return output
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean);
		} catch {
			return [];
		}
	}

	/** Semantic vector search. */
	async vectorSearch(
		query: string,
		options: QmdSearchOptions = {}
	): Promise<QmdSearchResult[]> {
		const args = this.buildSearchArgs("search", `vec:${query}`, options);
		return this.execJsonSearch(args);
	}

	/** Deep search with query expansion and reranking. */
	async deepSearch(
		query: string,
		options: QmdSearchOptions = {}
	): Promise<QmdSearchResult[]> {
		const args = this.buildSearchArgs("search", query, options);
		return this.execJsonSearch(args);
	}

	/** Keyword/BM25 search. */
	async search(
		query: string,
		options: QmdSearchOptions = {}
	): Promise<QmdSearchResult[]> {
		const args = this.buildSearchArgs("search", `lex:${query}`, options);
		return this.execJsonSearch(args);
	}

	/** Retrieve a full document by file path or docid. */
	async get(fileOrDocid: string): Promise<string> {
		return this.execQmd(["get", fileOrDocid]);
	}

	private buildSearchArgs(
		command: string,
		query: string,
		options: QmdSearchOptions
	): string[] {
		const args = [command, query, "--json"];
		if (options.limit) {
			args.push("-n", String(options.limit));
		}
		if (options.minScore) {
			args.push("--min-score", String(options.minScore));
		}
		if (options.collection) {
			args.push("-c", options.collection);
		}
		return args;
	}

	private async execJsonSearch(args: string[]): Promise<QmdSearchResult[]> {
		const output = await this.execQmd(args);
		if (!output.trim()) return [];
		try {
			const parsed = JSON.parse(output);
			if (Array.isArray(parsed)) return parsed;
			return [];
		} catch {
			return [];
		}
	}

	private execQmd(args: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			const cmd = `${this.qmdPath} ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`;
			exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
				if (error) {
					reject(new Error(`QMD command failed: ${stderr || error.message}`));
					return;
				}
				resolve(stdout);
			});
		});
	}
}

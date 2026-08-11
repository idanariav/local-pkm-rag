import { GenericCliClient, JSON_OUTPUT_VALUE_KEY } from "../genericClient";
import { qmdSchema } from "../schemas/qmd";
import { TOOLS } from "../toolRegistry";

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

/**
 * Thin typed wrapper over GenericCliClient, preserving the exact public surface
 * consumed by rag/retrieval.ts and rag/modes.ts. All subprocess work is delegated
 * to the generic client; this class only maps qmd's search commands to typed results.
 */
export class QmdClient {
	private readonly client: GenericCliClient;

	constructor(qmdPath: string) {
		this.client = new GenericCliClient("qmd", TOOLS.qmd.healthCheckCommand, qmdSchema, qmdPath || undefined);
	}

	updatePath(qmdPath: string): void {
		this.client.updatePath(qmdPath || undefined);
	}

	/** Check if the qmd binary is available and responsive. */
	async isAvailable(): Promise<boolean> {
		return this.client.isAvailable();
	}

	/** Get qmd status including collections and document counts (raw text). */
	async status(): Promise<string> {
		const result = await this.client.runCommand("status");
		return result.stdout;
	}

	/** Get available collection names, parsed from `collection list`'s formatted output. */
	async getCollections(): Promise<string[]> {
		try {
			const result = await this.client.runCommand("collection.list");
			return this.parseCollectionNames(result.stdout);
		} catch {
			return [];
		}
	}

	/** Semantic vector search. */
	async vectorSearch(query: string, options: QmdSearchOptions = {}): Promise<QmdSearchResult[]> {
		return this.runJsonSearch("vsearch", query, options);
	}

	/** Keyword/BM25 search. */
	async search(query: string, options: QmdSearchOptions = {}): Promise<QmdSearchResult[]> {
		return this.runJsonSearch("tsearch", query, options);
	}

	/** Hybrid search with query expansion and reranking. */
	async deepSearch(query: string, options: QmdSearchOptions = {}): Promise<QmdSearchResult[]> {
		return this.runJsonSearch("hsearch", query, options);
	}

	/** Retrieve a full document by file path or docid. */
	async get(fileOrDocid: string): Promise<string> {
		const result = await this.client.runCommand("get", { target: fileOrDocid });
		return result.stdout;
	}

	/** Batch-retrieve documents matching a glob or comma-separated list. */
	async multiGet(pattern: string, options: { maxBytes?: number; lines?: number } = {}): Promise<string> {
		const result = await this.client.runCommand("multi-get", {
			pattern,
			"--max-bytes": options.maxBytes,
			"-l": options.lines,
		});
		return result.stdout;
	}

	private async runJsonSearch(
		commandId: "tsearch" | "vsearch" | "hsearch",
		query: string,
		options: QmdSearchOptions
	): Promise<QmdSearchResult[]> {
		const result = await this.client.runCommand(commandId, {
			query,
			"-n": options.limit,
			"--min-score": options.minScore,
			"-c": options.collection ? [options.collection] : undefined,
			[JSON_OUTPUT_VALUE_KEY]: true,
		});
		if (Array.isArray(result.json)) return result.json as QmdSearchResult[];
		return [];
	}

	/**
	 * `qmd collection list` prints a formatted block, not JSON:
	 *   name (qmd://name/)[ [excluded]]
	 *     Pattern:  <glob>
	 *     Files:    <n>
	 *     Updated:  <date>
	 * Extract just the name from each header line.
	 */
	private parseCollectionNames(output: string): string[] {
		const names: string[] = [];
		for (const line of output.split("\n")) {
			const match = /^(\S.+?) \(qmd:\/\//.exec(line);
			if (match) names.push(match[1]);
		}
		return names;
	}
}

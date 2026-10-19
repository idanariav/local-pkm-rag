import { App } from "obsidian";
import { filterLinks, formatClustersJson, formatDetailed, formatSummary } from "@idan_ariav/qvoid/query";
import { VectorManifest, VectorSet } from "./vectorSet";

type LinkRecord = Parameters<typeof filterLinks>[0][number];

/** `qvoid export` manifest (qvoid/docs/EXPORT.md). */
interface QvoidManifest extends VectorManifest {
	collection: string;
	items: string[];
}

export interface QvoidQueryOptions {
	destination?: string[];
	origin?: string;
	semanticType?: string;
	minOccurrences?: number;
	search?: string;
	limit?: number;
	format: string;
}

export interface QvoidSimilarOptions {
	cluster: boolean;
	topK: number;
	minScore: number;
	threshold: number;
	format: string;
}

/** Output as the CLI prints it: stdout + a stderr status line. */
export interface QvoidOutput {
	stdout: string;
	stderr: string;
}

/** qvoid's `query` / `find-similar` answered from a `qvoid export` in the vault. */
export class QvoidLite {
	private constructor(
		private readonly vectors: VectorSet<QvoidManifest>,
		private readonly records: LinkRecord[]
	) {}

	static async load(app: App, dir: string): Promise<QvoidLite | null> {
		const recordsPath = `${dir}/records.jsonl`;
		if (!(await app.vault.adapter.exists(recordsPath))) return null;
		const vectors = await VectorSet.load<QvoidManifest>(app, dir, (m) => m.items.length);
		if (!vectors) return null;
		const records = (await app.vault.adapter.read(recordsPath))
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as LinkRecord);
		return new QvoidLite(vectors, records);
	}

	get exportedAt(): string {
		return this.vectors.manifest.exportedAt;
	}

	/** `qvoid collections` text, as parsed by parseCollectionNames. */
	collectionList(): string {
		return `  ${this.vectors.manifest.collection}  (lite export)`;
	}

	query(opts: QvoidQueryOptions): QvoidOutput {
		const filtered = filterLinks(this.records, opts);
		if (opts.format === "json") {
			return { stdout: filtered.map((l) => JSON.stringify(l)).join("\n"), stderr: "" };
		}
		const text = opts.format === "detailed" ? formatDetailed(filtered) : formatSummary(filtered);
		return { stdout: text, stderr: `${filtered.length} of ${this.records.length} targets match.` };
	}

	findSimilar(query: string | undefined, opts: QvoidSimilarOptions): QvoidOutput {
		if (opts.cluster) return this.cluster(opts);
		if (!query) throw new Error("Provide a query string or pass --cluster.");

		const { items } = this.vectors.manifest;
		const exact = items.indexOf(query);
		const q = exact >= 0 ? this.vectors.itemVector(exact) : this.vectors.embedQuery(query);
		if (!q) throw new Error("None of the query's words are in the export's word table (lite mode).");

		const results = items
			.map((target, i) => ({ target, score: this.vectors.score(q, i) }))
			.filter((r) => r.target !== query && r.score >= opts.minScore)
			.sort((a, b) => b.score - a.score)
			.slice(0, opts.topK);
		if (results.length === 0) return { stdout: "", stderr: "No matches above threshold." };
		if (opts.format === "json") {
			return { stdout: results.map((r) => JSON.stringify(r)).join("\n"), stderr: "" };
		}
		const lines = results.map((r) => `  ${r.score.toFixed(3)}  ${r.target}`);
		return { stdout: [`Top ${results.length} similar targets to: ${JSON.stringify(query)}`, ...lines].join("\n"), stderr: "" };
	}

	/** Union-find over pairs at or above the threshold — qvoid's clusterDuplicates. */
	private cluster(opts: QvoidSimilarOptions): QvoidOutput {
		const { items } = this.vectors.manifest;
		const parent = items.map((_, i) => i);
		const find = (x: number): number => {
			while (parent[x] !== x) x = parent[x] = parent[parent[x]];
			return x;
		};
		for (let i = 0; i < items.length; i++) {
			for (let j = i + 1; j < items.length; j++) {
				if (this.vectors.similarity(i, j) >= opts.threshold) parent[find(i)] = find(j);
			}
		}
		const groups = new Map<number, string[]>();
		items.forEach((t, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), t]));
		const clusters = [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort()).sort((a, b) => b.length - a.length);

		const stderr = `${clusters.length} clusters at threshold ${opts.threshold}.`;
		if (opts.format === "json") return { stdout: formatClustersJson(clusters, opts.threshold).join("\n"), stderr };
		const text = clusters.map((g) => [`\n--- cluster (${g.length} targets)`, ...g.map((t) => `  ${t}`)].join("\n")).join("\n");
		return { stdout: text, stderr };
	}
}

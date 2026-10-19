import { App } from "obsidian";

/** Fields every "pkm-vectors" v1 export shares (`qmd export`, `qvoid export`). */
export interface VectorManifest {
	format: string;
	version: number;
	tool: string;
	model: string;
	dim: number;
	scale: number;
	exportedAt: string;
	/** v2: vector chunks, concatenated in order (v1 has a single vectors.bin instead). */
	files?: string[];
	words: string[];
}

const WORD_RE = /[a-z]{3,20}/g;

/** Int8 vectors from a tool export: `itemCount` item rows, then one row per word. A typed
 *  query becomes a vector as the mean of its known words' rows — no model on the device. */
export class VectorSet<M extends VectorManifest> {
	private readonly wordRow: Map<string, number>;

	private constructor(
		readonly manifest: M,
		private readonly bin: Int8Array,
		readonly itemCount: number
	) {
		this.wordRow = new Map(manifest.words.map((w, i) => [w, itemCount + i]));
	}

	/** Loads `<dir>/manifest.json` and its vectors — v2's chunk `files` (each under Obsidian Sync's
	 *  5 MB limit), or v1's single `vectors.bin` — or null when the export is absent. */
	static async load<M extends VectorManifest>(
		app: App,
		dir: string,
		itemCount: (manifest: M) => number
	): Promise<VectorSet<M> | null> {
		const adapter = app.vault.adapter;
		const manifestPath = `${dir}/manifest.json`;
		if (!(await adapter.exists(manifestPath))) return null;
		const manifest = JSON.parse(await adapter.read(manifestPath)) as M;
		if (manifest.format !== "pkm-vectors" || (manifest.version !== 1 && manifest.version !== 2)) {
			throw new Error(`${manifestPath}: unsupported export format ${manifest.format} v${manifest.version}`);
		}
		const paths = (manifest.files ?? ["vectors.bin"]).map((f) => `${dir}/${f}`);
		for (const p of paths) {
			if (!(await adapter.exists(p))) throw new Error(`${p} is missing (not synced yet?)`);
		}
		const parts = await Promise.all(paths.map((p) => adapter.readBinary(p)));
		const bin = new Int8Array(parts.reduce((n, b) => n + b.byteLength, 0));
		let off = 0;
		for (const b of parts) {
			bin.set(new Int8Array(b), off);
			off += b.byteLength;
		}
		return new VectorSet(manifest, bin, itemCount(manifest));
	}

	/** Mean of the query's known word vectors, normalized; null when no word is known. */
	embedQuery(text: string): Float32Array | null {
		const { dim } = this.manifest;
		const v = new Float32Array(dim);
		let known = 0;
		for (const word of text.toLowerCase().match(WORD_RE) ?? []) {
			const row = this.wordRow.get(word);
			if (row === undefined) continue;
			const off = row * dim;
			for (let k = 0; k < dim; k++) v[k] += this.bin[off + k];
			known++;
		}
		return known > 0 ? normalize(v) : null;
	}

	/** Item row as a normalized float vector (e.g. to use an existing item as the query). */
	itemVector(i: number): Float32Array {
		const { dim } = this.manifest;
		return normalize(Float32Array.from(this.bin.subarray(i * dim, (i + 1) * dim)));
	}

	/** Cosine similarity of a normalized query vector with item `i`. */
	score(query: Float32Array, i: number): number {
		const { dim, scale } = this.manifest;
		const off = i * dim;
		let s = 0;
		for (let k = 0; k < dim; k++) s += query[k] * this.bin[off + k];
		return s / scale;
	}

	/** Cosine similarity of items `i` and `j`, as qvoid's clustering computes it. */
	similarity(i: number, j: number): number {
		const { dim, scale } = this.manifest;
		let s = 0;
		for (let k = 0; k < dim; k++) s += this.bin[i * dim + k] * this.bin[j * dim + k];
		return s / (scale * scale);
	}
}

function normalize(v: Float32Array): Float32Array {
	let norm = 0;
	for (let k = 0; k < v.length; k++) norm += v[k] * v[k];
	norm = Math.sqrt(norm) || 1;
	for (let k = 0; k < v.length; k++) v[k] /= norm;
	return v;
}

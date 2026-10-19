import { App } from "obsidian";
import MiniSearch from "minisearch";
import { VectorManifest, VectorSet } from "./vectorSet";

/** `qimg export` manifest (qimg/docs/EXPORT.md). */
interface QimgImage {
	path: string;
	file: string;
	collection: string;
	hash: string;
	width: number | null;
	height: number | null;
	mime: string | null;
	taken_at: number | null;
	caption: string | null;
	exif_text: string | null;
	ocr_text: string | null;
	sidecar: string | null;
}
interface QimgManifest extends VectorManifest {
	images: QimgImage[];
	items: number[]; // vector row → image index
}

export interface QimgSearchOptions {
	limit: number;
	collection?: string;
	after?: number;
	before?: number;
}

/** A hit in `qimg <search> --json` shape (`path` is collection-relative, as in the CLI), plus
 *  the vault-relative `vault_path`. */
export interface QimgHit {
	path: string;
	vault_path: string;
	collection: string;
	caption: string | null;
	sidecar_path: string | null;
	score: number;
}

const RRF_K = 60;

/** qimg's search commands answered from a `qimg export` in the vault — no qimg binary or model. */
export class QimgLite {
	private readonly rowOf: Map<number, number>;
	private keyword: MiniSearch | null = null;

	private constructor(private readonly vectors: VectorSet<QimgManifest>) {
		this.rowOf = new Map(vectors.manifest.items.map((img, row) => [img, row]));
	}

	static async load(app: App, dir: string): Promise<QimgLite | null> {
		const vectors = await VectorSet.load<QimgManifest>(app, dir, (m) => m.items.length);
		return vectors ? new QimgLite(vectors) : null;
	}

	get exportedAt(): string {
		return this.vectors.manifest.exportedAt;
	}

	private get images(): QimgImage[] {
		return this.vectors.manifest.images;
	}

	/** `qimg collection list` text, as parsed by parseCollectionNames ("name\t..." per line). */
	collectionList(): string {
		return [...new Set(this.images.map((i) => i.collection))].map((c) => `${c}\t(lite export)`).join("\n");
	}

	/** Same filters as qimg's SQL: an image without a date never passes a date filter. */
	private passes(img: QimgImage, opts: QimgSearchOptions): boolean {
		if (opts.collection && img.collection !== opts.collection) return false;
		if (opts.after !== undefined && (img.taken_at === null || img.taken_at < opts.after)) return false;
		if (opts.before !== undefined && (img.taken_at === null || img.taken_at > opts.before)) return false;
		return true;
	}

	private hit(i: number, score: number): QimgHit {
		const img = this.images[i];
		return { path: img.file, vault_path: img.path, collection: img.collection, caption: img.caption, sidecar_path: img.sidecar, score };
	}

	/** Keyword search over path, filename, caption, EXIF and OCR text; every term must match,
	 *  as in qimg's FTS5 query. Scores are relative to the best hit. */
	tsearch(query: string, opts: QimgSearchOptions): QimgHit[] {
		if (!query.trim()) return [];
		if (!this.keyword) {
			this.keyword = new MiniSearch({ fields: ["path", "filename", "caption", "exif_text", "ocr_text"] });
			this.keyword.addAll(
				this.images.map((img, id) => ({
					id,
					path: img.file,
					filename: img.file.split("/").pop() ?? img.file,
					caption: img.caption ?? "",
					exif_text: img.exif_text ?? "",
					ocr_text: img.ocr_text ?? "",
				}))
			);
		}
		const results = this.keyword.search(query, {
			combineWith: "AND",
			prefix: true,
			filter: (r) => this.passes(this.images[r.id as number], opts),
		});
		const top = results[0]?.score ?? 1;
		return results.slice(0, opts.limit).map((r) => this.hit(r.id as number, r.score / top));
	}

	/** Vector search by text (mean of word vectors) or by an image already in the export. */
	vsearch(query: string | undefined, image: string | undefined, opts: QimgSearchOptions): QimgHit[] {
		let q: Float32Array | null;
		if (image) {
			const i = this.findImage(image);
			const row = i === null ? undefined : this.rowOf.get(i);
			if (row === undefined) {
				throw new Error(`--image needs an image that is in the export (lite mode can't embed new images): ${image}`);
			}
			q = this.vectors.itemVector(row);
		} else {
			if (!query?.trim()) throw new Error("Provide a query or --image.");
			q = this.vectors.embedQuery(query);
			if (!q) throw new Error("None of the query's words are in the export's word table (lite mode).");
		}
		const qv = q;
		return this.vectors.manifest.items
			.map((img, row) => ({ img, score: this.vectors.score(qv, row) }))
			.filter((r) => this.passes(this.images[r.img], opts))
			.sort((a, b) => b.score - a.score)
			.slice(0, opts.limit)
			.map((r) => this.hit(r.img, r.score));
	}

	/** qimg's hybridQuery: RRF (k=60) over 2×limit keyword + vector hits; score is the raw RRF sum. */
	hsearch(query: string | undefined, image: string | undefined, opts: QimgSearchOptions): QimgHit[] {
		const wide = { ...opts, limit: opts.limit * 2 };
		const keyword = image ? [] : this.tsearch(query ?? "", wide);
		let vector: QimgHit[] = [];
		try {
			vector = this.vsearch(query, image, wide);
		} catch (e) {
			// A query with no known word still gets keyword results, as long as there are some.
			if (image || keyword.length === 0) throw e;
		}
		const fused = new Map<string, { hit: QimgHit; score: number }>();
		for (const hits of [keyword, vector]) {
			hits.forEach((hit, rank) => {
				const e = fused.get(hit.vault_path) ?? { hit, score: 0 };
				e.score += 1 / (RRF_K + rank + 1);
				fused.set(hit.vault_path, e);
			});
		}
		return [...fused.values()]
			.sort((a, b) => b.score - a.score)
			.slice(0, opts.limit)
			.map(({ hit, score }) => ({ ...hit, score }));
	}

	/** `qimg get`: exact path, "collection/path", or a path suffix such as a bare filename. */
	get(target: string): Record<string, unknown> {
		const i = this.findImage(target);
		if (i === null) throw new Error(`not found: ${target}`);
		const img = this.images[i];
		return {
			collection: img.collection,
			path: img.file,
			vault_path: img.path,
			hash: img.hash,
			width: img.width,
			height: img.height,
			mime: img.mime,
			taken_at: img.taken_at,
			caption: img.caption,
			exif_text: img.exif_text,
			ocr_text: img.ocr_text,
			sidecar_path: img.sidecar,
		};
	}

	private findImage(target: string): number | null {
		const t = target.replace(/^\/+/, "");
		const i = this.images.findIndex(
			(img) => img.path === t || img.file === t || `${img.collection}/${img.file}` === t || img.path.endsWith(`/${t}`)
		);
		return i < 0 ? null : i;
	}
}

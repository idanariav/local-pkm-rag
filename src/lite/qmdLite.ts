import { App, TFile } from "obsidian";
import MiniSearch from "minisearch";
import { parseFilter } from "@idan_ariav/qmd/query";
import { resolveVaultFile } from "../views/fileLink";
import { VectorManifest, VectorSet } from "./vectorSet";
import { DocFacts, MarkdownSection, evaluateFilter, frontmatterDate, frontmatterRows, frontmatterTags } from "./fsearch";

/** `qmd export` manifest (qmd/docs/EXPORT.md). */
interface QmdDoc {
	path: string;
	file: string;
	collection: string;
	title: string;
	docid: string;
	context?: string;
	hash: string;
}
interface QmdItem {
	d: number;
	seq: number;
	line: number;
	snippet: string;
}
interface QmdManifest extends VectorManifest {
	collections: Record<string, { section?: { heading: string; level: number } }>;
	docs: QmdDoc[];
	items: QmdItem[];
}

export interface QmdSearchOptions {
	limit: number;
	collections: string[];
	minScore: number;
}

/** A search hit in `qmd <search> --json` shape. `file` is the vault path (the CLI gives a
 *  qmd:// URI) so the console resolves it without slug matching. */
export interface QmdHit {
	docid: string;
	score: number;
	file: string;
	path: string;
	collection: string;
	line?: number;
	title: string;
	context?: string;
	snippet?: string;
	stale?: boolean;
}

/** The text qmd indexes for one doc (whole body, or the collection's section) + its metadata. */
interface DocText {
	mtime: number;
	indexed: string;
	facts: DocFacts;
	aliases: string;
	description: string;
}

const RRF_K = 60;
const HYBRID_CANDIDATES = 50;
const SNIPPET_CHARS = 300;

const sha16 = async (text: string) => {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
};

const fieldValue = (fm: Record<string, unknown>, name: string): unknown => {
	const key = Object.keys(fm).find((k) => k.toLowerCase() === name);
	return key ? fm[key] : undefined;
};
const asText = (v: unknown): string => (Array.isArray(v) ? v.join(", ") : v === undefined || v === null ? "" : String(v));

/** qmd's search commands answered from a `qmd export` in the vault — no qmd binary needed. */
export class QmdLite {
	private readonly texts = new Map<number, DocText>();
	private keyword: MiniSearch | null = null;

	private constructor(
		private readonly app: App,
		private readonly vectors: VectorSet<QmdManifest>
	) {}

	static async load(app: App, dir: string): Promise<QmdLite | null> {
		const vectors = await VectorSet.load<QmdManifest>(app, dir, (m) => m.items.length);
		return vectors ? new QmdLite(app, vectors) : null;
	}

	get exportedAt(): string {
		return this.vectors.manifest.exportedAt;
	}

	private get docs(): QmdDoc[] {
		return this.vectors.manifest.docs;
	}

	/** `qmd collection list` text, as parsed by parseCollectionNames. */
	collectionList(): string {
		return Object.keys(this.vectors.manifest.collections)
			.map((name) => `${name} (qmd://${name}/)`)
			.join("\n");
	}

	private inCollections(doc: QmdDoc, collections: string[]): boolean {
		return collections.length === 0 || collections.includes(doc.collection);
	}

	private file(doc: QmdDoc): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(doc.path);
		return f instanceof TFile ? f : null;
	}

	/** Loads (or refreshes, when the file changed) the indexed text of doc `d`. */
	private async docText(d: number): Promise<DocText | null> {
		const doc = this.docs[d];
		const file = this.file(doc);
		if (!file) return null;
		const cached = this.texts.get(d);
		if (cached && cached.mtime === file.stat.mtime) return cached;

		const raw = await this.app.vault.cachedRead(file);
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
		const headings = cache?.headings ?? [];
		// Same boundaries as qmd's remark-based section extraction, but from Obsidian's
		// already-parsed headings — no per-note markdown parse, which matters on mobile.
		const [start, end] = indexedRange(
			raw.length,
			headings,
			cache?.frontmatterPosition?.end.offset ?? 0,
			this.vectors.manifest.collections[doc.collection]?.section
		);
		const indexed = raw.slice(start, end).trim();
		const sections = splitByHeadings(raw, headings, start, end);

		const text: DocText = {
			mtime: file.stat.mtime,
			indexed,
			aliases: asText(fieldValue(fm, "aliases") ?? fieldValue(fm, "alias")),
			description: asText(fieldValue(fm, "description") ?? fieldValue(fm, "summary")),
			facts: {
				title: doc.title,
				path: doc.file.replace(/^qmd:\/\/[^/]+\//, ""),
				collection: doc.collection,
				created: frontmatterDate(fm, "created") ?? new Date(file.stat.ctime).toISOString(),
				modified: frontmatterDate(fm, "modified") ?? new Date(file.stat.mtime).toISOString(),
				wordCount: sections.reduce((n, s) => n + (s.body.match(/\S+/g)?.length ?? 0), 0),
				tags: frontmatterTags(fm),
				rows: frontmatterRows(fm),
				sections,
			},
		};
		this.texts.set(d, text);
		return text;
	}

	/** Refreshes every doc's text and keeps the keyword index in step with it. */
	private async syncTexts(): Promise<void> {
		if (!this.keyword) {
			this.keyword = new MiniSearch({
				fields: ["title", "aliases", "description", "body"],
				searchOptions: { boost: { title: 3, aliases: 2, description: 1.5 }, prefix: true },
			});
		}
		for (let d = 0; d < this.docs.length; d++) {
			const before = this.texts.get(d);
			const text = await this.docText(d);
			if (text === before) continue;
			if (before) this.keyword.discard(d);
			if (text) {
				this.keyword.add({ id: d, title: this.docs[d].title, aliases: text.aliases, description: text.description, body: text.indexed });
			} else {
				this.texts.delete(d);
			}
		}
	}

	private hit(d: number, score: number, line: number | undefined, snippet: string | undefined): QmdHit {
		const doc = this.docs[d];
		return {
			docid: `#${doc.docid}`,
			score: Math.round(score * 100) / 100,
			file: doc.path,
			path: doc.path.split("/").pop() ?? doc.path,
			collection: doc.collection,
			...(line !== undefined && { line }),
			title: doc.title,
			...(doc.context && { context: doc.context }),
			...(snippet && { snippet }),
		};
	}

	/** Marks hits whose file changed since the export (vector positions/snippets may be off). */
	private async markStale(hits: QmdHit[]): Promise<QmdHit[]> {
		const byPath = new Map(this.docs.map((doc) => [doc.path, doc]));
		for (const hit of hits) {
			const doc = byPath.get(hit.file);
			const file = doc && this.file(doc);
			if (!doc || !file) continue;
			if ((await sha16(await this.app.vault.cachedRead(file))) !== doc.hash) {
				hit.stale = true;
				hit.snippet = `(changed since export) ${hit.snippet ?? ""}`.trim();
			}
		}
		return hits;
	}

	private vectorRank(query: string, opts: QmdSearchOptions): { d: number; score: number; item: number }[] | null {
		const q = this.vectors.embedQuery(query);
		if (!q) return null;
		const best = new Map<number, { score: number; item: number }>();
		const { items } = this.vectors.manifest;
		for (let i = 0; i < items.length; i++) {
			const d = items[i].d;
			if (!this.inCollections(this.docs[d], opts.collections)) continue;
			const score = this.vectors.score(q, i);
			const prev = best.get(d);
			if (!prev || score > prev.score) best.set(d, { score, item: i });
		}
		return [...best]
			.map(([d, v]) => ({ d, ...v }))
			.filter((r) => r.score >= opts.minScore)
			.sort((a, b) => b.score - a.score);
	}

	async vsearch(query: string, opts: QmdSearchOptions): Promise<QmdHit[]> {
		const ranked = this.vectorRank(query, opts);
		if (!ranked) throw new Error("None of the query's words are in the export's word table (lite mode).");
		const { items } = this.vectors.manifest;
		return this.markStale(
			ranked.slice(0, opts.limit).map((r) => this.hit(r.d, r.score, items[r.item].line, items[r.item].snippet))
		);
	}

	private async keywordRank(query: string, opts: QmdSearchOptions): Promise<{ d: number; score: number; line?: number; snippet?: string }[]> {
		await this.syncTexts();
		// qmd lex syntax: "exact phrase" and -excluded terms; the rest are prefix-matched terms.
		const phrases = (query.match(/"[^"]+"/g) ?? []).map((p) => p.slice(1, -1).toLowerCase());
		const rest = query.replace(/"[^"]+"/g, " ");
		const excluded = rest.split(/\s+/).filter((t) => t.startsWith("-") && t.length > 1).map((t) => t.slice(1).toLowerCase());
		const terms = [...rest.split(/\s+/).filter((t) => t && !t.startsWith("-")), ...phrases].join(" ");
		if (!terms.trim()) return [];

		const results = this.keyword!.search(terms, {
			filter: (r) => {
				const d = r.id as number;
				const text = this.texts.get(d)!.indexed.toLowerCase();
				return (
					this.inCollections(this.docs[d], opts.collections) &&
					phrases.every((p) => text.includes(p)) &&
					!excluded.some((t) => text.includes(t))
				);
			},
		});
		const top = results[0]?.score ?? 1;
		return results.map((r) => {
			const d = r.id as number;
			const { line, snippet } = keywordSnippet(this.texts.get(d)!.indexed, r.terms);
			return { d, score: r.score / top, line, snippet };
		});
	}

	async tsearch(query: string, opts: QmdSearchOptions): Promise<QmdHit[]> {
		const ranked = await this.keywordRank(query, opts);
		return ranked
			.filter((r) => r.score >= opts.minScore)
			.slice(0, opts.limit)
			.map((r) => this.hit(r.d, r.score, r.line, r.snippet));
	}

	/** Reciprocal-rank fusion of keyword + vector rankings (no query expansion or LLM rerank). */
	async hsearch(query: string, opts: QmdSearchOptions): Promise<QmdHit[]> {
		const wide = { ...opts, minScore: 0 };
		const keyword = (await this.keywordRank(query, wide)).slice(0, HYBRID_CANDIDATES);
		const vector = (this.vectorRank(query, wide) ?? []).slice(0, HYBRID_CANDIDATES);
		const fused = new Map<number, { rrf: number; line?: number; snippet?: string }>();
		const { items } = this.vectors.manifest;
		vector.forEach((r, rank) => {
			fused.set(r.d, { rrf: 1 / (RRF_K + rank + 1), line: items[r.item].line, snippet: items[r.item].snippet });
		});
		keyword.forEach((r, rank) => {
			const prev = fused.get(r.d);
			// The keyword snippet shows where the query's words actually are, so it wins.
			fused.set(r.d, { rrf: (prev?.rrf ?? 0) + 1 / (RRF_K + rank + 1), line: r.line, snippet: r.snippet });
		});
		const ranked = [...fused].sort((a, b) => b[1].rrf - a[1].rrf);
		const top = ranked[0]?.[1].rrf ?? 1;
		return this.markStale(
			ranked
				.map(([d, r]) => this.hit(d, r.rrf / top, r.line, r.snippet))
				.filter((h) => h.score >= opts.minScore)
				.slice(0, opts.limit)
		);
	}

	async fsearch(filter: string, opts: QmdSearchOptions): Promise<Record<string, unknown>[]> {
		const node = parseFilter(filter);
		await this.syncTexts();
		const matches: { d: number; facts: DocFacts }[] = [];
		for (const [d, text] of this.texts) {
			if (this.inCollections(this.docs[d], opts.collections) && evaluateFilter(node, text.facts)) {
				matches.push({ d, facts: text.facts });
			}
		}
		matches.sort((a, b) => (a.facts.modified < b.facts.modified ? 1 : a.facts.modified > b.facts.modified ? -1 : 0));
		return matches.slice(0, opts.limit).map(({ d, facts }) => ({
			file: this.docs[d].path,
			path: this.docs[d].path.split("/").pop(),
			collection: facts.collection,
			title: facts.title,
			modified: facts.modified.slice(0, 10),
			word_count: facts.wordCount,
		}));
	}

	/** `qmd get`: by #docid, qmd:// URI, vault path, or note name. */
	async get(
		target: string,
		opts: { section?: string; noCallouts?: boolean; noCodeblocks?: boolean; from?: number; lines?: number; lineNumbers?: boolean }
	): Promise<string> {
		const doc = target.startsWith("#")
			? this.docs.find((x) => `#${x.docid}` === target)
			: this.docs.find((x) => x.file === target || x.path === target);
		const ref = target.replace(/^qmd:\/\/[^/]+\//, "");
		// Note names resolve the way a [[wikilink]] would; the fuzzy resolver is the last resort
		// (its slug match ignores extensions, so a note's same-named PNG could win).
		const file =
			(doc && this.file(doc)) ??
			this.app.metadataCache.getFirstLinkpathDest(ref.replace(/\.md$/, ""), "") ??
			resolveVaultFile(this.app, ref);
		if (!file) throw new Error(`Document not found: ${target}`);

		const raw = await this.app.vault.cachedRead(file);
		const cache = this.app.metadataCache.getFileCache(file);
		let start = 0;
		let end = raw.length;
		if (opts.section) {
			const range = sectionRange(cache?.headings ?? [], opts.section.split("/"), raw.length);
			if (!range) throw new Error(`Section not found: ${opts.section}`);
			[start, end] = range;
		}
		// Drop callouts / code blocks using Obsidian's own block parse, back to front so offsets hold.
		const dropTypes = new Set([...(opts.noCallouts ? ["callout"] : []), ...(opts.noCodeblocks ? ["code"] : [])]);
		let text = raw.slice(start, end);
		const drops = (cache?.sections ?? [])
			.filter((s) => dropTypes.has(s.type) && s.position.start.offset >= start && s.position.end.offset <= end)
			.sort((a, b) => b.position.start.offset - a.position.start.offset);
		for (const s of drops) {
			text = text.slice(0, s.position.start.offset - start) + text.slice(s.position.end.offset - start);
		}

		let lines = text.split("\n");
		const first = Math.max(1, opts.from ?? 1);
		lines = lines.slice(first - 1, opts.lines !== undefined ? first - 1 + opts.lines : undefined);
		if (opts.lineNumbers) lines = lines.map((l, i) => `${first + i}: ${l}`);
		return lines.join("\n");
	}
}

type HeadingPos = { heading: string; level: number; position: { start: { offset: number }; end: { offset: number } } };

/** Offsets of the text qmd indexes: the collection's section (heading end → next heading of the
 *  same or higher level) when it has a section filter, else everything after the frontmatter.
 *  A missing section yields an empty range, as qmd indexes nothing for it. */
function indexedRange(
	length: number,
	headings: HeadingPos[],
	frontmatterEnd: number,
	section: { heading: string; level: number } | undefined
): [number, number] {
	if (!section) return [frontmatterEnd, length];
	const i = headings.findIndex((h) => h.level === section.level && h.heading.trim() === section.heading);
	if (i < 0) return [0, 0];
	const next = headings.slice(i + 1).find((h) => h.level <= section.level);
	return [headings[i].position.end.offset, next ? next.position.start.offset : length];
}

/** Flat sections within [start, end) — one per heading plus a level-0 preamble — the shape of
 *  qmd's `sections` table. */
function splitByHeadings(raw: string, headings: HeadingPos[], start: number, end: number): MarkdownSection[] {
	const sections: MarkdownSection[] = [];
	let current = { level: 0, heading: null as string | null, from: start };
	for (const h of headings) {
		if (h.position.start.offset < start || h.position.start.offset >= end) continue;
		sections.push({ level: current.level, heading: current.heading, body: raw.slice(current.from, h.position.start.offset).trim() });
		current = { level: h.level, heading: h.heading.trim(), from: h.position.end.offset };
	}
	sections.push({ level: current.level, heading: current.heading, body: raw.slice(current.from, end).trim() });
	return sections.filter((s) => s.level > 0 || s.body);
}

/** Offsets of a heading path ("Heading/Sub"): from the heading line to the next heading of the same or higher level. */
function sectionRange(
	headings: { heading: string; level: number; position: { start: { offset: number } } }[],
	path: string[],
	textLength: number
): [number, number] | null {
	let lo = 0;
	let hi = textLength;
	let minLevel = 0;
	for (const part of path) {
		const h = headings.find(
			(x) => x.position.start.offset >= lo && x.position.start.offset < hi && x.level > minLevel && x.heading.trim() === part.trim()
		);
		if (!h) return null;
		const next = headings.find((x) => x.position.start.offset > h.position.start.offset && x.level <= h.level);
		lo = h.position.start.offset;
		hi = Math.min(hi, next ? next.position.start.offset : textLength);
		minLevel = h.level;
	}
	return [lo, hi];
}

/** First line containing a matched term, with a little following context. */
function keywordSnippet(text: string, terms: string[]): { line?: number; snippet?: string } {
	const lines = text.split("\n");
	const lowered = terms.map((t) => t.toLowerCase());
	const idx = lines.findIndex((l) => lowered.some((t) => l.toLowerCase().includes(t)));
	if (idx < 0) return { snippet: text.slice(0, SNIPPET_CHARS) || undefined };
	return { line: idx + 1, snippet: lines.slice(idx, idx + 4).join("\n").slice(0, SNIPPET_CHARS) };
}

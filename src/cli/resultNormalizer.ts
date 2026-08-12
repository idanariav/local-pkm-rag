import { ToolId } from "./types";

/** A tool-agnostic shape the console can render as a clickable, hover-previewable result card. */
export interface NormalizedResult {
	title: string;
	fileRef: string;
	subtitle?: string;
	score?: number;
}

/** Normalizes a command's parsed JSON array into result cards, or returns null when the
 *  shape isn't a recognized "array of file-referencing results" (falls back to raw JSON). */
export function normalizeResults(toolId: ToolId, json: unknown): NormalizedResult[] | null {
	if (!Array.isArray(json)) return null;

	const normalizer = NORMALIZERS[toolId];
	if (!normalizer) return null;

	const results = json.map(normalizer).filter((r): r is NormalizedResult => r !== null);
	return results.length > 0 ? results : null;
}

function asRecord(item: unknown): Record<string, unknown> | null {
	return typeof item === "object" && item !== null ? (item as Record<string, unknown>) : null;
}

/** Strips qmd's diff-style hunk header (e.g. "@@ -13,4 @@ (12 before, 152 after)") off
 *  the front of a snippet — informative for a diff tool, just noise for a result list. */
function stripSnippetHunkHeader(snippet: string): string {
	return snippet.replace(/^@@[^@]*@@\s*\([^)]*\)\n?/, "").trim();
}

/** qmd search results: { file, title?, snippet?, context?, score? }. */
function normalizeQmdResult(item: unknown): NormalizedResult | null {
	const r = asRecord(item);
	if (!r || typeof r.file !== "string") return null;
	const rawSubtitle = typeof r.snippet === "string" ? r.snippet : typeof r.context === "string" ? r.context : undefined;
	return {
		title: typeof r.title === "string" && r.title ? r.title : r.file,
		fileRef: r.file,
		subtitle: rawSubtitle ? stripSnippetHunkHeader(rawSubtitle) : undefined,
		score: typeof r.score === "number" ? r.score : undefined,
	};
}

/** qimg search results: { path, collection?, caption?, score? } — no "file"/"title" fields. */
function normalizeQimgResult(item: unknown): NormalizedResult | null {
	const r = asRecord(item);
	if (!r || typeof r.path !== "string") return null;
	return {
		title: r.path,
		fileRef: r.path,
		subtitle:
			typeof r.caption === "string" && r.caption
				? r.caption
				: typeof r.collection === "string"
					? `Collection: ${r.collection}`
					: undefined,
		score: typeof r.score === "number" ? r.score : undefined,
	};
}

/**
 * qnode's search commands return two different shapes depending on what they describe:
 *   - edges (neighbors, find-by-distance): { dst_path, dst_target, field_key?, context? }
 *   - nodes (siblings, metrics show): { path, shared_parents? } or { path, pagerank?, in_degree?, out_degree? }
 * Both are handled here since they're both ultimately "here's a related file."
 */
function normalizeQnodeResult(item: unknown): NormalizedResult | null {
	const r = asRecord(item);
	if (!r) return null;

	const fileRef = typeof r.dst_path === "string" ? r.dst_path : typeof r.path === "string" ? r.path : null;
	if (!fileRef) return null;

	// dst_target (edge shape) is already a clean note name; node-shaped results (siblings,
	// metrics) have no display name, so fall back to the basename rather than the full path.
	const basename = (fileRef.split("/").pop() ?? fileRef).replace(/\.md$/, "");
	const title = typeof r.dst_target === "string" && r.dst_target ? r.dst_target : basename;

	const subtitleParts: string[] = [];
	if (typeof r.field_key === "string") subtitleParts.push(r.field_key);
	if (typeof r.context === "string") subtitleParts.push(r.context);
	if (subtitleParts.length === 0 && typeof r.shared_parents === "number") {
		subtitleParts.push(`${r.shared_parents} shared parent${r.shared_parents === 1 ? "" : "s"}`);
	}
	if (subtitleParts.length === 0 && typeof r.pagerank === "number") {
		subtitleParts.push(
			`pagerank ${r.pagerank.toFixed(4)}, in-degree ${r.in_degree ?? "?"}, out-degree ${r.out_degree ?? "?"}`
		);
	}

	return {
		title,
		fileRef,
		subtitle: subtitleParts.length > 0 ? subtitleParts.join(" — ") : undefined,
		score: typeof r.pagerank === "number" ? r.pagerank : undefined,
	};
}

const NORMALIZERS: Partial<Record<ToolId, (item: unknown) => NormalizedResult | null>> = {
	qmd: normalizeQmdResult,
	qimg: normalizeQimgResult,
	qnode: normalizeQnodeResult,
};

/**
 * qvoid's `query --format json` prints NDJSON (one JSON object per line), each describing
 * an unresolved "void" target with a list of real-file occurrences — not a JSON array of
 * simple file results like the other tools. A void itself has no file to link to (that's
 * the point — it's a link to a note that doesn't exist yet); what's actually clickable is
 * each occurrence's source note. Flattens every occurrence into its own result card.
 */
export function normalizeQvoidQueryNdjson(stdout: string): NormalizedResult[] | null {
	const results: NormalizedResult[] = [];

	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			continue;
		}

		const target = asRecord(parsed);
		if (!target || typeof target.target !== "string" || !Array.isArray(target.occurrences)) continue;

		for (const occurrence of target.occurrences) {
			const occ = asRecord(occurrence);
			if (!occ || typeof occ.source !== "string") continue;
			const contextParts = [occ.context_before, occ.context_after].filter((c) => typeof c === "string");
			results.push({
				title: target.target,
				fileRef: occ.source,
				subtitle:
					contextParts.length > 0
						? contextParts.join(" … ")
						: typeof occ.semantic_type === "string"
							? occ.semantic_type
							: undefined,
			});
		}
	}

	return results.length > 0 ? results : null;
}

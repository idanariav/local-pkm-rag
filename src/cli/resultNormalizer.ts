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

const NORMALIZERS: Partial<Record<ToolId, (item: unknown) => NormalizedResult | null>> = {
	qmd: normalizeQmdResult,
	qimg: normalizeQimgResult,
};

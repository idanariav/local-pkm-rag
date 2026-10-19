import type { FilterNode } from "@idan_ariav/qmd/query";

/** One heading-delimited section of a doc's indexed text (level 0 = text before the first heading). */
export interface MarkdownSection {
	level: number;
	heading: string | null;
	body: string;
}

/** One frontmatter value, as qmd's `frontmatter` table stores it (arrays → one row per item). */
export interface FrontmatterRow {
	key: string;
	text: string;
	num: number | null;
	date: string | null;
}

/** Everything qmd's fsearch SQL can look at for one document. */
export interface DocFacts {
	title: string;
	path: string;
	collection: string;
	created: string;
	modified: string;
	wordCount: number;
	tags: string[];
	rows: FrontmatterRow[];
	sections: MarkdownSection[];
}

// Mirrors qmd's src/parse/frontmatter.ts so values compare the way they do in the index.
const DATE_FIELDS = ["created", "date", "created_at", "dateCreated"];
const MODIFIED_FIELDS = ["modified", "updated", "modified_at", "dateModified", "lastModified"];
const TAG_FIELDS = ["tags", "tag"];

export function toISODate(val: unknown): string | null {
	if (!val) return null;
	if (val instanceof Date) return isNaN(val.getTime()) ? null : val.toISOString().slice(0, 10);
	if (typeof val === "string") {
		const d = new Date(val);
		return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
	}
	return null;
}

function scalarText(val: unknown): string {
	if (val === null || val === undefined) return "";
	if (val instanceof Date) return val.toISOString().slice(0, 10);
	return String(val);
}

export function frontmatterRows(fm: Record<string, unknown>): FrontmatterRow[] {
	const rows: FrontmatterRow[] = [];
	for (const [key, val] of Object.entries(fm)) {
		if (key === "position") continue; // Obsidian adds this to cached frontmatter; not a real key
		for (const item of Array.isArray(val) ? val : [val]) {
			rows.push({ key, text: scalarText(item), num: typeof item === "number" ? item : null, date: toISODate(item) });
		}
	}
	return rows;
}

export function frontmatterTags(fm: Record<string, unknown>): string[] {
	for (const field of TAG_FIELDS) {
		const raw = fm[field];
		if (raw === undefined) continue;
		if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
		if (typeof raw === "string") return raw.split(",").map((v) => v.trim()).filter(Boolean);
		return [];
	}
	return [];
}

export function frontmatterDate(fm: Record<string, unknown>, kind: "created" | "modified"): string | null {
	for (const field of kind === "created" ? DATE_FIELDS : MODIFIED_FIELDS) {
		const d = toISODate(fm[field]);
		if (d) return d;
	}
	return null;
}

/** "7d", "2w", "3m", "1y" → ISO date that long ago; anything else is taken as a date as-is. */
function resolveDate(value: string): string {
	const m = /^(\d+)([dwmy])$/i.exec(value);
	if (!m) return value;
	const n = parseInt(m[1], 10);
	const now = new Date();
	switch (m[2].toLowerCase()) {
		case "d": now.setDate(now.getDate() - n); break;
		case "w": now.setDate(now.getDate() - n * 7); break;
		case "m": now.setMonth(now.getMonth() - n); break;
		case "y": now.setFullYear(now.getFullYear() - n); break;
	}
	return now.toISOString().slice(0, 10);
}

/** SQL LIKE '%v%' — case-insensitive for ASCII, as in SQLite. */
const like = (text: string, v: string) => text.toLowerCase().includes(v.toLowerCase());

function regex(text: string, pattern: string): boolean {
	try {
		return new RegExp(pattern).test(text);
	} catch {
		return false;
	}
}

type Op = "=" | "~=" | "<" | ">" | "regex";

function matchText(text: string, op: Op, value: string, field: string): boolean {
	switch (op) {
		case "=": return text === value;
		case "~=": return like(text, value);
		case "regex": return regex(text, value);
		default: throw new Error(`Operator ${op} not supported for ${field} field`);
	}
}

const DOC_FIELDS: Record<string, (f: DocFacts) => string | number> = {
	created: (f) => f.created,
	created_at: (f) => f.created,
	modified: (f) => f.modified,
	modified_at: (f) => f.modified,
	title: (f) => f.title,
	word_count: (f) => f.wordCount,
	path: (f) => f.path,
	collection: (f) => f.collection,
};
const DATE_DOC_FIELDS = new Set(["created", "created_at", "modified", "modified_at"]);

function evalCmp(field: string, op: Op, value: string, f: DocFacts): boolean {
	if (field === "tag" || field === "tags") return f.tags.some((t) => matchText(t, op, value, "tag"));
	if (field === "section") return f.sections.some((s) => s.heading !== null && matchText(s.heading, op, value, "section"));
	if (field === "content") {
		if (op !== "~=" && op !== "regex") throw new Error(`Operator ${op} not supported for content field`);
		return f.sections.some((s) => matchText(s.body, op, value, "content"));
	}
	if (field === "level") {
		const lvl = parseInt(value, 10);
		if (op === "=") return f.sections.some((s) => s.level === lvl);
		if (op === "<") return f.sections.some((s) => s.level < lvl);
		if (op === ">") return f.sections.some((s) => s.level > lvl);
		throw new Error(`Operator ${op} not supported for level field`);
	}
	if (field in DOC_FIELDS) {
		const actual = DOC_FIELDS[field](f);
		const v = DATE_DOC_FIELDS.has(field) ? resolveDate(value) : value;
		if (typeof actual === "number") {
			const n = parseFloat(v);
			if (op === "<") return actual < n;
			if (op === ">") return actual > n;
			if (op === "=") return actual === n;
		}
		if (op === "<") return String(actual) < v;
		if (op === ">") return String(actual) > v;
		return matchText(String(actual), op, v, field);
	}
	// Generic frontmatter key.
	const rows = f.rows.filter((r) => r.key === field);
	if (op === "<" || op === ">") {
		const n = parseFloat(value);
		const d = resolveDate(value);
		return rows.some((r) =>
			op === "<"
				? (r.num !== null && r.num < n) || (r.date !== null && r.date < d)
				: (r.num !== null && r.num > n) || (r.date !== null && r.date > d)
		);
	}
	return rows.some((r) => matchText(r.text, op, value, field));
}

const missing = (field: string, f: DocFacts) => !f.rows.some((r) => r.key === field);

/** Evaluates a parsed qmd filter against one document — the in-memory twin of qmd's
 *  compile.ts SQL, field for field. */
export function evaluateFilter(node: FilterNode, f: DocFacts): boolean {
	switch (node.type) {
		case "AND": return evaluateFilter(node.left, f) && evaluateFilter(node.right, f);
		case "OR": return evaluateFilter(node.left, f) || evaluateFilter(node.right, f);
		case "NOT": return !evaluateFilter(node.operand, f);
		case "CMP": return evalCmp(node.field, node.op, node.value, f);
		case "MISSING": return missing(node.field, f);
		case "EMPTY":
			if (node.field === "section" || node.field === "sections") return f.sections.some((s) => !s.body);
			return f.rows.some((r) => r.key === node.field && r.text === "");
		case "NO":
			if (node.field === "headings" || node.field === "heading") return !f.sections.some((s) => s.level > 0);
			if (node.field === "level") {
				const lvl = node.value ? parseInt(node.value, 10) : null;
				return lvl !== null ? !f.sections.some((s) => s.level === lvl) : !f.sections.some((s) => s.level > 0);
			}
			return missing(node.field, f);
	}
}

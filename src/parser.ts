import { App, TFile } from "obsidian";
import { ParsedNote } from "./types";
import { PkmRagSettings, resolveParseSettings } from "./settings";
import { extractSectionByHeading } from "./markdownParser";

const PROPERTY_WIKILINK_PATTERN = /\([A-Za-z]+::\s*\[\[(?:[^\]|]*\|)?([^\]]+)\]\]\)/g;
const WIKILINK_PATTERN = /\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g;
const DATAVIEW_FIELD_PATTERN = /^\s*\w+::\s*/gm;

/** Extract target note titles from wikilinks (link target, not display text). */
const WIKILINK_TARGET_PATTERN = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
const PROPERTY_WIKILINK_TARGET_PATTERN = /\([A-Za-z]+::\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\)/g;

/**
 * Extract content under a specific heading using AST-based parsing.
 * Captures from the heading until the next same-or-higher-level heading or end of file.
 * Headings inside code blocks are correctly ignored.
 */
export function extractSection(text: string, headerName: string, headerLevel: number): string | null {
	return extractSectionByHeading(text, headerName, headerLevel);
}

/**
 * Extract content after frontmatter (everything after the closing ---).
 */
export function extractFullContent(text: string): string | null {
	let content = text;
	if (text.startsWith("---")) {
		const endIdx = text.indexOf("---", 3);
		if (endIdx !== -1) {
			content = text.substring(endIdx + 3).trim();
		}
	}
	return content || null;
}

/** Extract wikilink targets (the note being linked to). */
export function extractWikilinks(text: string): string[] {
	const links = new Set<string>();

	// Property wikilinks: (Jump:: [[Target|display]]) -> Target
	let match;
	const propPattern = new RegExp(PROPERTY_WIKILINK_TARGET_PATTERN.source, "g");
	while ((match = propPattern.exec(text)) !== null) {
		links.add(match[1].trim());
	}

	// Standard wikilinks: [[Target|display]] -> Target
	const stdPattern = new RegExp(WIKILINK_TARGET_PATTERN.source, "g");
	while ((match = stdPattern.exec(text)) !== null) {
		links.add(match[1].trim());
	}

	return Array.from(links).sort();
}

/** Strip wikilink syntax and dataview fields to plain text. */
export function cleanWikilinks(text: string): string {
	// Property wikilinks: (Jump:: [[X|y]]) -> y
	let cleaned = text.replace(PROPERTY_WIKILINK_PATTERN, "$1");
	// Standard wikilinks: [[X|y]] -> y, [[X]] -> X
	cleaned = cleaned.replace(WIKILINK_PATTERN, "$1");
	// Dataview inline fields at line start
	cleaned = cleaned.replace(DATAVIEW_FIELD_PATTERN, "");
	return cleaned;
}

/** Normalize a frontmatter value to a string array. */
function normalizeList(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) {
		return value.filter((v) => v != null).map((v) => String(v).trim());
	}
	return [];
}

/**
 * Parse an Obsidian markdown file into a ParsedNote.
 * Returns null if the note lacks the required frontmatter key or content.
 */
export async function parseNote(
	file: TFile,
	app: App,
	settings: PkmRagSettings
): Promise<ParsedNote | null> {
	const cache = app.metadataCache.getFileCache(file);
	const frontmatter = cache?.frontmatter;

	// Require the configured frontmatter key (default: UUID)
	const uuid = frontmatter?.[settings.requiredFrontmatterKey];
	if (!uuid) return null;

	const text = await app.vault.cachedRead(file);

	// Resolve per-folder parsing settings (falls back to global defaults)
	const parse = resolveParseSettings(file.path, settings);

	// Extract content based on content mode
	let rawContent: string | null;
	if (parse.contentMode === "section") {
		rawContent = extractSection(text, parse.noteSectionHeaderName, parse.noteSectionHeaderLevel);
	} else {
		rawContent = extractFullContent(text);
	}
	if (!rawContent) return null;

	// Extract wikilinks before cleaning
	const outgoingLinks = extractWikilinks(rawContent);

	// Clean content
	const content = cleanWikilinks(rawContent);

	const modified = String(frontmatter?.[settings.modifiedFrontmatterKey] ?? "");
	const description = String(frontmatter?.[settings.descriptionFrontmatterKey] ?? "");
	const aliases = normalizeList(frontmatter?.aliases);
	const tags = normalizeList(frontmatter?.tags).map((t) =>
		t.startsWith("#") ? t.slice(1) : t
	);

	return {
		uuid: String(uuid),
		modified,
		title: file.basename,
		description,
		aliases,
		tags,
		content,
		filePath: file.path,
		outgoingLinks,
	};
}

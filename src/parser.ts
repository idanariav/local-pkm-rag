import { App, TFile } from "obsidian";
import { ParsedNote } from "./types";
import { PkmRagSettings } from "./settings";

const PROPERTY_WIKILINK_PATTERN = /\([A-Za-z]+::\s*\[\[(?:[^\]|]*\|)?([^\]]+)\]\]\)/g;
const WIKILINK_PATTERN = /\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g;
const DATAVIEW_FIELD_PATTERN = /^\s*\w+::\s*/gm;

/** Extract target note titles from wikilinks (link target, not display text). */
const WIKILINK_TARGET_PATTERN = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
const PROPERTY_WIKILINK_TARGET_PATTERN = /\([A-Za-z]+::\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\)/g;

/**
 * Extract content under a specific heading.
 * Captures from the heading until the next same-level heading or end of file.
 */
export function extractSection(text: string, header: string): string | null {
	// Escape special regex characters in the header
	const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const regex = new RegExp(`(?:^|\\n)${escaped}\\s*\\n(.*?)(?=\\n## |$)`, "s");
	const match = text.match(regex);
	if (!match) return null;
	const content = match[1].trim();
	return content || null;
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

	// Extract content based on content mode
	let rawContent: string | null;
	if (settings.contentMode === "section") {
		rawContent = extractSection(text, settings.noteSectionHeader);
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

	return {
		uuid: String(uuid),
		modified,
		title: file.basename,
		description,
		aliases,
		content,
		filePath: file.path,
		outgoingLinks,
	};
}

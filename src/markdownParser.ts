import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Heading, Root, RootContent } from "mdast";

/**
 * Extract plain text from a heading AST node's children.
 */
function headingText(node: Heading): string {
	return node.children
		.map((child) => {
			if ("value" in child) return child.value;
			if ("children" in child) return headingText(child as unknown as Heading);
			return "";
		})
		.join("");
}

/**
 * Parse markdown text into an AST.
 */
function parseMarkdown(text: string): Root {
	return unified().use(remarkParse).parse(text);
}

/**
 * Extract content under a specific heading using AST-based parsing.
 *
 * Finds the heading matching the given name and level, and returns
 * all content between it and the next heading of same-or-higher level,
 * or end of document. Headings inside code blocks are correctly ignored.
 *
 * Returns the original text (preserving formatting) via position offsets.
 */
export function extractSectionByHeading(
	text: string,
	headerName: string,
	headerLevel: number
): string | null {
	const tree = parseMarkdown(text);
	const level = headerLevel;
	const headerText = headerName;

	let sectionStart: number | null = null;
	let sectionEnd: number | null = null;

	for (const node of tree.children) {
		if (node.type !== "heading") continue;
		const heading = node as Heading;

		if (sectionStart !== null) {
			// We found the start — look for the next heading at same or higher level
			if (heading.depth <= level) {
				sectionEnd = heading.position!.start.offset!;
				break;
			}
		} else if (
			heading.depth === level &&
			headingText(heading).trim() === headerText
		) {
			// Found the target heading — content starts after the heading line
			sectionStart = heading.position!.end.offset!;
		}
	}

	if (sectionStart === null) return null;
	if (sectionEnd === null) sectionEnd = text.length;

	const content = text.substring(sectionStart, sectionEnd).trim();
	return content || null;
}

/**
 * Split markdown text into sections at heading boundaries using AST parsing.
 *
 * Each section includes its heading line (if any) plus content until the
 * next heading. Content before the first heading is returned as the first
 * section if non-empty.
 *
 * Headings inside code blocks are correctly ignored by the AST parser.
 */
export function splitMarkdownByHeadings(text: string): string[] {
	const tree = parseMarkdown(text);

	// Collect offsets where headings start
	const headingOffsets: number[] = [];
	for (const node of tree.children) {
		if (node.type === "heading" && node.position) {
			headingOffsets.push(node.position.start.offset!);
		}
	}

	if (headingOffsets.length === 0) {
		// No headings — return the full text as a single section
		return text.trim() ? [text.trim()] : [];
	}

	const sections: string[] = [];

	// Content before the first heading
	if (headingOffsets[0] > 0) {
		const preContent = text.substring(0, headingOffsets[0]).trim();
		if (preContent) {
			sections.push(preContent);
		}
	}

	// Each heading section
	for (let i = 0; i < headingOffsets.length; i++) {
		const start = headingOffsets[i];
		const end =
			i + 1 < headingOffsets.length ? headingOffsets[i + 1] : text.length;
		const section = text.substring(start, end).trim();
		if (section) {
			sections.push(section);
		}
	}

	return sections;
}

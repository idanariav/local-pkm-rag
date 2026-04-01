import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Heading, Root } from "mdast";

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
			if (heading.depth <= level) {
				sectionEnd = heading.position!.start.offset!;
				break;
			}
		} else if (
			heading.depth === level &&
			headingText(heading).trim() === headerText
		) {
			sectionStart = heading.position!.end.offset!;
		}
	}

	if (sectionStart === null) return null;
	if (sectionEnd === null) sectionEnd = text.length;

	const content = text.substring(sectionStart, sectionEnd).trim();
	return content || null;
}

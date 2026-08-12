import { ToolId } from "./types";

/**
 * Each tool's `collection list` prints a different non-JSON format. Centralized here so
 * both QmdClient and the console's live collection-suggestion field share one parser
 * per tool instead of duplicating (and risking re-diverging) the logic.
 */
export function parseCollectionNames(toolId: ToolId, output: string): string[] {
	switch (toolId) {
		case "qmd":
			return parseQmdCollectionNames(output);
		case "qimg":
			return parseQimgCollectionNames(output);
		default:
			return [];
	}
}

/** qmd: "name (qmd://name/)[ [excluded]]" header line, then indented detail lines. */
function parseQmdCollectionNames(output: string): string[] {
	const names: string[] = [];
	for (const line of output.split("\n")) {
		const match = /^(\S.+?) \(qmd:\/\//.exec(line);
		if (match) names.push(match[1]);
	}
	return names;
}

/** qimg: "name\tpath\tpattern" per collection, followed by an indented "  sidecar: ..." line. */
function parseQimgCollectionNames(output: string): string[] {
	const names: string[] = [];
	for (const line of output.split("\n")) {
		if (/^\s/.test(line)) continue;
		const name = line.split("\t")[0]?.trim();
		if (name) names.push(name);
	}
	return names;
}

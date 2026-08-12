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
		case "qnode":
			return parseSingleLineCollectionNames(output);
		case "qvoid":
			return parseSingleLineCollectionNames(output);
	}
}

/** qnode ("name\tpath\tpattern[\tvault_root=...]") and qvoid ("  name(padded)  path")
 *  both print exactly one line per collection with no continuation lines — the name is
 *  always the first whitespace-delimited token, verified against each tool's own
 *  console.log call in source (qnode/src/cli/qnode.ts, qvoid/src/cli/qvoid.ts). */
function parseSingleLineCollectionNames(output: string): string[] {
	const names: string[] = [];
	for (const line of output.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const name = trimmed.split(/\s+/)[0];
		if (name) names.push(name);
	}
	return names;
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

import { FlagSpec, ToolSchema } from "./types";

/** Unique flags across every "search"-category command in a tool's schema — the set
 *  exposed in Settings for configuring persistent defaults, since search commands are
 *  what run repeatedly. Deduped by flag string; when the same flag recurs across
 *  commands with different declared defaults (e.g. qmd's --min-score has a default
 *  of 0.3 on vsearch but none on tsearch/hsearch/fsearch), the copy that actually
 *  has a default wins, so Settings doesn't show a blank field for a flag that does
 *  have a sensible default on at least one of the tool's commands. */
export function getSearchFlags(schema: ToolSchema): FlagSpec[] {
	const seen = new Map<string, FlagSpec>();
	for (const command of schema.commands) {
		if (command.category !== "search") continue;
		for (const flag of command.flags) {
			const existing = seen.get(flag.flag);
			if (!existing || (existing.default === undefined && flag.default !== undefined)) {
				seen.set(flag.flag, flag);
			}
		}
	}
	return Array.from(seen.values());
}

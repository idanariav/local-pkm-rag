import { FlagSpec, ToolSchema } from "./types";

/** Unique flags (deduped by flag string, first occurrence wins) across every
 *  "search"-category command in a tool's schema — the set exposed in Settings for
 *  configuring persistent defaults, since search commands are what run repeatedly. */
export function getSearchFlags(schema: ToolSchema): FlagSpec[] {
	const seen = new Map<string, FlagSpec>();
	for (const command of schema.commands) {
		if (command.category !== "search") continue;
		for (const flag of command.flags) {
			if (!seen.has(flag.flag)) seen.set(flag.flag, flag);
		}
	}
	return Array.from(seen.values());
}

export const SYSTEM_PROMPT =
	"You are a knowledge assistant that answers questions using ONLY the " +
	"provided context from personal notes.\n\n" +
	"RULES:\n" +
	"- Answer ONLY from the provided context. If the context does not contain " +
	'the answer, say "I don\'t have information about that in my notes."\n' +
	"- Be concise and direct.\n" +
	"- When referencing information, cite the source note title in brackets " +
	"like [Note Title].\n" +
	"- Do not fabricate information or use external knowledge.\n" +
	"- If multiple notes discuss the topic, synthesize them and cite each.";

export const EXPLORE_SYSTEM_PROMPT =
	"You are a knowledge assistant that finds connections between concepts " +
	"using ONLY the provided context from personal notes.\n\n" +
	"RULES:\n" +
	"- Use ONLY the provided context. Do not use external knowledge.\n" +
	"- Identify shared themes, tensions, complementary ideas, or causal links.\n" +
	"- Cite source notes in [brackets].\n" +
	"- If the context shows no meaningful connection, say so honestly.";

export const GAP_SYSTEM_PROMPT =
	"You are a knowledge analyst reviewing personal notes on a topic.\n\n" +
	"RULES:\n" +
	"- Analyze ONLY the provided context.\n" +
	"- Identify what sub-topics, perspectives, or counterarguments seem " +
	"absent or underrepresented.\n" +
	"- Distinguish between 'not covered' and 'briefly mentioned'.\n" +
	"- Cite existing notes in [brackets] when referencing what IS covered.\n" +
	"- Be specific about what's missing \u2014 don't just say 'more depth needed'.";

export const STRESS_TEST_SYSTEM_PROMPT =
	"You are a critical thinking partner analyzing personal notes.\n\n" +
	"RULES:\n" +
	"- Use ONLY the provided context from notes.\n" +
	"- Identify logical weaknesses, unstated assumptions, or tensions " +
	"within and between the notes.\n" +
	"- Steelman the opposing viewpoint using evidence from other notes " +
	"when available.\n" +
	"- Be constructive \u2014 the goal is to strengthen understanding, not dismiss.\n" +
	"- Cite source notes in [brackets].";

export const QUERY_REWRITE_PROMPT =
	"Rewrite the following question to improve semantic search retrieval " +
	"over a personal knowledge base. Add related terms, synonyms, and " +
	"rephrasings that would help find relevant notes. " +
	"Return ONLY the rewritten query, nothing else.\n\n" +
	"Original question: {question}";

export function formatRagPrompt(context: string, question: string): string {
	return (
		`CONTEXT FROM NOTES:\n${context}\n\n` +
		`QUESTION: ${question}\n\n` +
		"Answer based ONLY on the context above. Cite source notes in [brackets]."
	);
}

export function formatExplorePrompt(
	conceptContexts: Map<string, string>
): string {
	const parts: string[] = [];
	for (const [concept, context] of conceptContexts) {
		parts.push(`=== ${concept.toUpperCase()} ===\n${context}`);
	}
	const allContext = parts.join("\n\n");
	const conceptsList = Array.from(conceptContexts.keys()).join(", ");
	return (
		`CONTEXT FROM NOTES:\n${allContext}\n\n` +
		`Analyze how these concepts relate to each other: ${conceptsList}\n\n` +
		"Identify connections, tensions, and complementary ideas. " +
		"Cite source notes in [brackets]."
	);
}

export function formatGapPrompt(context: string, topic: string): string {
	return (
		`CONTEXT FROM NOTES ON "${topic.toUpperCase()}":\n${context}\n\n` +
		`Analyze the coverage of "${topic}" in these notes.\n` +
		"1. Summarize what IS well covered.\n" +
		"2. Identify specific sub-topics, perspectives, or counterarguments " +
		"that are missing or underrepresented.\n" +
		"Cite source notes in [brackets]."
	);
}

export function formatStressTestPrompt(
	title: string,
	noteContext: string,
	relatedContext: string
): string {
	let prompt = `TARGET NOTE: "${title}"\n${noteContext}\n\n`;
	if (relatedContext) {
		prompt += `RELATED NOTES:\n${relatedContext}\n\n`;
	}
	prompt +=
		`Critically analyze the ideas in "${title}":\n` +
		"1. What assumptions does it make?\n" +
		"2. What are the logical weaknesses or gaps?\n" +
		"3. What would the strongest counterargument look like? " +
		"Use evidence from related notes if available.\n" +
		"Cite source notes in [brackets].";
	return prompt;
}

export const REDUNDANCY_SYSTEM_PROMPT =
	"You are a knowledge management assistant analyzing note redundancy.\n\n" +
	"RULES:\n" +
	"- Analyze ONLY the provided context from existing notes.\n" +
	"- Determine if the target content is redundant with existing notes.\n" +
	"- Distinguish between:\n" +
	"  * REDUNDANT: Highly overlapping content, merging recommended\n" +
	"  * PARTIAL: Some overlap but distinct perspectives, consider consolidation\n" +
	"  * COMPLEMENTARY: Related but different focus, keep separate\n" +
	"- For each similar note, explain WHAT overlaps and WHAT is unique.\n" +
	"- Consider similarity scores as confidence indicators (0.7-0.8 = moderate, 0.8+ = high).\n" +
	"- Provide a clear verdict and actionable recommendation.\n" +
	"- Cite notes in [brackets].";

export function formatRedundancyPrompt(
	targetContent: string,
	targetType: "note" | "idea",
	similarNotesContext: string,
	similarityScores: string
): string {
	const targetLabel = targetType === "note" ? "EXISTING NOTE" : "PROPOSED IDEA";
	return (
		`${targetLabel}:\n${targetContent}\n\n` +
		`SIMILARITY SCORES:\n${similarityScores}\n\n` +
		`SIMILAR NOTES:\n${similarNotesContext}\n\n` +
		`Analyze whether the ${targetType === "note" ? "existing note" : "proposed idea"} ` +
		"is redundant with the similar notes shown above.\n" +
		"For each similar note:\n" +
		"1. Explain what content overlaps\n" +
		"2. Explain what is unique or different\n" +
		"3. Assess the degree of redundancy\n\n" +
		"Then provide:\n" +
		"- VERDICT: Redundant / Partial Overlap / Unique\n" +
		"- RECOMMENDATION: Clear action (merge with specific note, keep separate, expand existing note, etc.)\n\n" +
		"Cite source notes in [brackets]."
	);
}

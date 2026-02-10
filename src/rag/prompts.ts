export const SYSTEM_PROMPT = `You are a knowledge assistant that answers questions using ONLY the provided context from personal notes.

RULES:
- Answer ONLY from the provided context. If the context does not contain the answer, say "I don't have information about that in my notes."
- Be concise and direct.
- When referencing information, cite the source note title in brackets like [Note Title].
- Do not fabricate information or use external knowledge.
- If multiple notes discuss the topic, synthesize them and cite each.`;

export const EXPLORE_SYSTEM_PROMPT = `You are a knowledge assistant that finds connections between concepts using ONLY the provided context from personal notes.

RULES:
- Use ONLY the provided context. Do not use external knowledge.
- Identify shared themes, tensions, complementary ideas, or causal links.
- Cite source notes in [brackets].
- If the context shows no meaningful connection, say so honestly.`;

export const GAP_SYSTEM_PROMPT = `You are a knowledge analyst reviewing personal notes on a topic.

RULES:
- Analyze ONLY the provided context.
- Identify what sub-topics, perspectives, or counterarguments seem absent or underrepresented.
- Distinguish between 'not covered' and 'briefly mentioned'.
- Cite existing notes in [brackets] when referencing what IS covered.
- Be specific about what's missing \u2014 don't just say 'more depth needed'.`;

export const STRESS_TEST_SYSTEM_PROMPT = `You are a critical thinking partner analyzing personal notes.

RULES:
- Use ONLY the provided context from notes.
- Identify logical weaknesses, unstated assumptions, or tensions within and between the notes.
- Steelman the opposing viewpoint using evidence from other notes when available.
- Be constructive \u2014 the goal is to strengthen understanding, not dismiss.
- Cite source notes in [brackets].`;

export const QUERY_REWRITE_PROMPT = `Rewrite the following question to improve semantic search retrieval over a personal knowledge base. Add related terms, synonyms, and rephrasings that would help find relevant notes. Return ONLY the rewritten query, nothing else.

Original question: {question}`;

export function formatRagPrompt(context: string, question: string): string {
	return `CONTEXT FROM NOTES:\n${context}\n\nQUESTION: ${question}\n\nAnswer based ONLY on the context above. Cite source notes in [brackets].`;
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
	return `CONTEXT FROM NOTES:\n${allContext}\n\nAnalyze how these concepts relate to each other: ${conceptsList}\n\nIdentify connections, tensions, and complementary ideas. Cite source notes in [brackets].`;
}

export function formatGapPrompt(context: string, topic: string): string {
	return `CONTEXT FROM NOTES ON "${topic.toUpperCase()}":\n${context}\n\nAnalyze the coverage of "${topic}" in these notes.
1. Summarize what IS well covered.
2. Identify specific sub-topics, perspectives, or counterarguments that are missing or underrepresented.
Cite source notes in [brackets].`;
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
	prompt += `Critically analyze the ideas in "${title}":
1. What assumptions does it make?
2. What are the logical weaknesses or gaps?
3. What would the strongest counterargument look like? Use evidence from related notes if available.
Cite source notes in [brackets].`;
	return prompt;
}

export const REDUNDANCY_SYSTEM_PROMPT = `You are a knowledge management assistant analyzing note redundancy.

RULES:
- Analyze ONLY the provided context from existing notes.
- Determine if the target content is redundant with existing notes.
- Distinguish between:
  * REDUNDANT: Highly overlapping content, merging recommended
  * PARTIAL: Some overlap but distinct perspectives, consider consolidation
  * COMPLEMENTARY: Related but different focus, keep separate
- For each similar note, explain WHAT overlaps and WHAT is unique.
- Consider similarity scores as confidence indicators (0.7-0.8 = moderate, 0.8+ = high).
- Provide a clear verdict and actionable recommendation.
- Cite notes in [brackets].`;

export function formatRedundancyPrompt(
	targetContent: string,
	targetType: "note" | "idea",
	similarNotesContext: string,
	similarityScores: string
): string {
	const targetLabel = targetType === "note" ? "EXISTING NOTE" : "PROPOSED IDEA";
	return `${targetLabel}:\n${targetContent}\n\nSIMILARITY SCORES:\n${similarityScores}\n\nSIMILAR NOTES:\n${similarNotesContext}\n\nAnalyze whether the ${targetType === "note" ? "existing note" : "proposed idea"} is redundant with the similar notes shown above.
For each similar note:
1. Explain what content overlaps
2. Explain what is unique or different
3. Assess the degree of redundancy

Then provide:
- VERDICT: Redundant / Partial Overlap / Unique
- RECOMMENDATION: Clear action (merge with specific note, keep separate, expand existing note, etc.)

Cite source notes in [brackets].`;
}

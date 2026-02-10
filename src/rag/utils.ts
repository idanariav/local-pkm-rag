import { OllamaClient } from "../embedding/ollamaClient";
import { SourceInfo } from "../types";

/**
 * Execute a chat completion with optional streaming support.
 * Replaces the repeated if/else streaming pattern across all mode handlers.
 */
export async function chatWithOptionalStreaming(
	ollamaClient: OllamaClient,
	messages: { role: string; content: string }[],
	enableStreaming: boolean,
	onToken?: (token: string) => void
): Promise<string> {
	if (onToken && enableStreaming) {
		return ollamaClient.chatStream(messages, onToken);
	}
	return ollamaClient.chat(messages);
}

/** Deduplicate sources by title, preserving first occurrence order. */
export function deduplicateSources(sources: SourceInfo[]): SourceInfo[] {
	const seen = new Set<string>();
	const unique: SourceInfo[] = [];
	for (const src of sources) {
		if (!seen.has(src.title)) {
			seen.add(src.title);
			unique.push(src);
		}
	}
	return unique;
}

/**
 * Format a source header string for inclusion in LLM context.
 * Handles variant formats across retrieval and mode handlers.
 */
export function formatSourceHeader(
	title: string,
	description?: string,
	options?: { similarity?: number; descriptionSeparator?: string }
): string {
	let header = `[Source: ${title}]`;
	if (options?.similarity !== undefined) {
		header += ` (Similarity: ${options.similarity})`;
	}
	if (description) {
		const sep = options?.descriptionSeparator ?? "\n";
		header += `${sep}Description: ${description}`;
	}
	return header;
}

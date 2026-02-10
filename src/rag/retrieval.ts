import { VectorStore } from "../embedding/vectorStore";
import { OllamaClient } from "../embedding/ollamaClient";
import { RetrievalResult, SimilarNote, SourceInfo } from "../types";
import { formatSourceHeader } from "./utils";

/**
 * Retrieve relevant context from the vector store via semantic search.
 * Returns formatted context string and deduplicated source metadata.
 */
export async function retrieveContext(
	query: string,
	vectorStore: VectorStore,
	ollamaClient: OllamaClient,
	nResults: number,
	threshold: number,
	filterTags?: string[]
): Promise<RetrievalResult> {
	const queryEmbedding = await ollamaClient.embed(query);
	const tagSet = filterTags && filterTags.length > 0 ? new Set(filterTags) : undefined;
	const results = vectorStore.search(queryEmbedding, nResults, undefined, tagSet);

	const contextParts: string[] = [];
	const sources: SourceInfo[] = [];
	const seenTitles = new Set<string>();

	for (const { chunk, similarity } of results) {
		if (similarity < threshold) continue;

		const title = chunk.metadata.title || "Unknown";
		const description = chunk.metadata.description || "";

		const header = formatSourceHeader(title, description, {
			descriptionSeparator: " | ",
		});
		contextParts.push(`${header}\n${chunk.text}`);

		if (!seenTitles.has(title)) {
			seenTitles.add(title);
			sources.push({
				title,
				description,
				filePath: chunk.metadata.filePath,
			});
		}
	}

	return {
		formattedContext: contextParts.join("\n\n---\n\n"),
		sources,
	};
}

/**
 * Find notes semantically similar to the given note title.
 * Uses the first chunk's stored embedding (no Ollama call needed).
 * Optionally filters out notes that are already linked.
 */
export function findSimilarNotes(
	title: string,
	vectorStore: VectorStore,
	filterLinked: boolean,
	topK: number,
	threshold: number,
	filterTags?: string[]
): SimilarNote[] {
	const targetChunks = vectorStore.getChunksByTitle(title);
	if (targetChunks.length === 0) return [];

	const targetUuid = targetChunks[0].metadata.uuid;
	const queryEmbedding = targetChunks[0].embedding;

	// Build set of linked titles if filtering
	const linkedTitles = new Set<string>();
	if (filterLinked) {
		// Outgoing links from the target note
		const outgoingStr = targetChunks[0].metadata.outgoingLinks || "";
		if (outgoingStr) {
			for (const link of outgoingStr.split(",")) {
				const trimmed = link.trim();
				if (trimmed) linkedTitles.add(trimmed);
			}
		}

		// Incoming links: find notes whose outgoingLinks contain this title
		const allTitles = vectorStore.getAllTitles();
		for (const otherTitle of allTitles) {
			if (otherTitle === title) continue;
			const otherChunks = vectorStore.getChunksByTitle(otherTitle);
			if (otherChunks.length === 0) continue;
			const otherLinks = otherChunks[0].metadata.outgoingLinks || "";
			const links = otherLinks
				.split(",")
				.map((l) => l.trim())
				.filter(Boolean);
			if (links.includes(title)) {
				linkedTitles.add(otherTitle);
			}
		}
	}

	// Search with over-fetch to account for filtering
	const tagSet = filterTags && filterTags.length > 0 ? new Set(filterTags) : undefined;
	const results = vectorStore.search(
		queryEmbedding,
		topK + 20,
		new Set([targetUuid]),
		tagSet
	);

	const similar: SimilarNote[] = [];
	const seenTitles = new Set<string>();

	for (const { chunk, similarity } of results) {
		if (similarity < threshold) continue;

		const noteTitle = chunk.metadata.title || "Unknown";
		if (seenTitles.has(noteTitle)) continue;
		if (filterLinked && linkedTitles.has(noteTitle)) continue;

		seenTitles.add(noteTitle);
		similar.push({
			title: noteTitle,
			description: chunk.metadata.description || "",
			similarity: Math.round(similarity * 1000) / 1000,
			filePath: chunk.metadata.filePath,
		});

		if (similar.length >= topK) break;
	}

	return similar;
}

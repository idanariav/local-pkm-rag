import { VectorStore } from "../embedding/vectorStore";
import { OllamaClient } from "../embedding/ollamaClient";
import { PkmRagSettings } from "../settings";
import { SourceInfo } from "../types";
import { DEFAULTS } from "../constants";
import { retrieveContext } from "./retrieval";
import {
	EXPLORE_SYSTEM_PROMPT,
	CONNECT_SYSTEM_PROMPT,
	GAP_SYSTEM_PROMPT,
	DEVILS_ADVOCATE_SYSTEM_PROMPT,
	REDUNDANCY_SYSTEM_PROMPT,
	UPDATER_SYSTEM_PROMPT,
	QUERY_REWRITE_PROMPT,
	formatExplorePrompt,
	formatConnectPrompt,
	formatGapPrompt,
	formatDevilsAdvocatePrompt,
	formatRedundancyPrompt,
	formatUpdaterPrompt,
} from "./prompts";
import {
	chatWithOptionalStreaming,
	deduplicateSources,
	formatSourceHeader,
} from "./utils";

export interface ModeResult {
	answer: string;
	sources: SourceInfo[];
}

/** Rewrite a query using the LLM for better retrieval. */
async function rewriteQuery(
	question: string,
	ollamaClient: OllamaClient
): Promise<string> {
	try {
		const response = await ollamaClient.chat([
			{
				role: "user",
				content: QUERY_REWRITE_PROMPT.replace("{question}", question),
			},
		]);
		const rewritten = response.trim();
		return rewritten || question;
	} catch {
		return question;
	}
}

/** Ask mode: RAG Q&A with optional query rewriting. */
export async function runExploreMode(
	question: string,
	vectorStore: VectorStore,
	ollamaClient: OllamaClient,
	settings: PkmRagSettings,
	onToken?: (token: string) => void,
	filterTags?: string[]
): Promise<ModeResult> {
	// Optional query rewriting
	let searchQuery = question;
	if (settings.enableQueryRewrite) {
		searchQuery = await rewriteQuery(question, ollamaClient);
	}

	const { formattedContext, sources } = await retrieveContext(
		searchQuery,
		vectorStore,
		ollamaClient,
		settings.topK,
		settings.similarityThreshold,
		filterTags
	);

	if (!formattedContext) {
		return {
			answer: "I don't have information about that in my notes.",
			sources: [],
		};
	}

	// Use original question in the RAG prompt (not the rewritten one)
	const prompt = formatExplorePrompt(formattedContext, question);
	const messages = [
		{ role: "system", content: EXPLORE_SYSTEM_PROMPT },
		{ role: "user", content: prompt },
	];

	const answer = await chatWithOptionalStreaming(
		ollamaClient, messages, settings.enableStreaming, onToken
	);

	return { answer, sources };
}

/** Connect mode: Analyze relationships between selected notes. */
export async function runConnectMode(
	selectedNotes: string[],
	vectorStore: VectorStore,
	ollamaClient: OllamaClient,
	settings: PkmRagSettings,
	onToken?: (token: string) => void,
	filterTags?: string[]
): Promise<ModeResult> {
	const conceptContexts = new Map<string, string>();
	const allSources: SourceInfo[] = [];

	for (const noteTitle of selectedNotes) {
		const { formattedContext, sources } = await retrieveContext(
			noteTitle,
			vectorStore,
			ollamaClient,
			settings.topK,
			settings.similarityThreshold,
			filterTags
		);
		conceptContexts.set(
			noteTitle,
			formattedContext || "No notes found."
		);
		allSources.push(...sources);
	}

	const prompt = formatConnectPrompt(conceptContexts);
	const messages = [
		{ role: "system", content: CONNECT_SYSTEM_PROMPT },
		{ role: "user", content: prompt },
	];

	const answer = await chatWithOptionalStreaming(
		ollamaClient, messages, settings.enableStreaming, onToken
	);

	return { answer, sources: deduplicateSources(allSources) };
}

/** Gap Analysis mode: Identify coverage gaps for a topic. */
export async function runGapMode(
	topic: string,
	vectorStore: VectorStore,
	ollamaClient: OllamaClient,
	settings: PkmRagSettings,
	onToken?: (token: string) => void,
	filterTags?: string[]
): Promise<ModeResult> {
	const { formattedContext, sources } = await retrieveContext(
		topic,
		vectorStore,
		ollamaClient,
		settings.gapAnalysisTopK,
		settings.similarityThreshold,
		filterTags
	);

	if (!formattedContext) {
		return {
			answer: `No notes found related to "${topic}".`,
			sources: [],
		};
	}

	const prompt = formatGapPrompt(formattedContext, topic);
	const messages = [
		{ role: "system", content: GAP_SYSTEM_PROMPT },
		{ role: "user", content: prompt },
	];

	const answer = await chatWithOptionalStreaming(
		ollamaClient, messages, settings.enableStreaming, onToken
	);

	return { answer, sources };
}

/** Devil's Advocate mode: Challenge a note's reasoning using related notes. */
export async function runDevilsAdvocateMode(
	title: string,
	vectorStore: VectorStore,
	ollamaClient: OllamaClient,
	settings: PkmRagSettings,
	onToken?: (token: string) => void,
	filterTags?: string[]
): Promise<ModeResult> {
	// Get target note's chunks
	const targetChunks = vectorStore.getChunksByTitle(title);
	if (targetChunks.length === 0) {
		return {
			answer: `No note found with title "${title}".`,
			sources: [],
		};
	}

	const targetUuid = targetChunks[0].metadata.uuid;
	const noteContext = targetChunks.map((c) => c.text).join("\n\n");

	// Search for related notes using the first chunk's embedding
	const tagSet = filterTags && filterTags.length > 0 ? new Set(filterTags) : undefined;
	const results = vectorStore.search(
		targetChunks[0].embedding,
		settings.topK + 5,
		new Set([targetUuid]),
		tagSet
	);

	const relatedParts: string[] = [];
	const sources: SourceInfo[] = [
		{
			title,
			description: targetChunks[0].metadata.description || "",
			filePath: targetChunks[0].metadata.filePath,
		},
	];
	const seenTitles = new Set<string>([title]);

	for (const { chunk, similarity } of results) {
		if (similarity < settings.similarityThreshold) continue;

		const relTitle = chunk.metadata.title || "Unknown";
		const description = chunk.metadata.description || "";

		const header = formatSourceHeader(relTitle, description);
		relatedParts.push(`${header}\n${chunk.text}`);

		if (!seenTitles.has(relTitle)) {
			seenTitles.add(relTitle);
			sources.push({
				title: relTitle,
				description,
				filePath: chunk.metadata.filePath,
			});
		}
	}

	const relatedContext = relatedParts.join("\n\n---\n\n");
	const prompt = formatDevilsAdvocatePrompt(title, noteContext, relatedContext);
	const messages = [
		{ role: "system", content: DEVILS_ADVOCATE_SYSTEM_PROMPT },
		{ role: "user", content: prompt },
	];

	const answer = await chatWithOptionalStreaming(
		ollamaClient, messages, settings.enableStreaming, onToken
	);

	return { answer, sources };
}

/** Redundancy Check mode: Determine if a note/idea is redundant with existing notes. */
export async function runRedundancyMode(
	input: string,
	inputType: "note" | "idea",
	vectorStore: VectorStore,
	ollamaClient: OllamaClient,
	settings: PkmRagSettings,
	onToken?: (token: string) => void,
	filterTags?: string[]
): Promise<ModeResult> {
	let queryEmbedding: number[];
	let targetContent: string;
	let excludeUuid: string | undefined;

	if (inputType === "note") {
		// Get existing note's embedding and content
		const chunks = vectorStore.getChunksByTitle(input);
		if (chunks.length === 0) {
			return {
				answer: `No note found with title "${input}".`,
				sources: [],
			};
		}
		queryEmbedding = chunks[0].embedding;
		targetContent = chunks.map((c) => c.text).join("\n\n");
		excludeUuid = chunks[0].metadata.uuid;
	} else {
		// Embed the idea text
		queryEmbedding = await ollamaClient.embed(input);
		targetContent = input;
		excludeUuid = undefined;
	}

	// Search for similar notes with higher threshold for redundancy detection
	const tagSet = filterTags && filterTags.length > 0 ? new Set(filterTags) : undefined;
	const results = vectorStore.search(
		queryEmbedding,
		settings.similarTopK,
		excludeUuid ? new Set([excludeUuid]) : undefined,
		tagSet
	);

	const similarParts: string[] = [];
	const scores: string[] = [];
	const sources: SourceInfo[] = [];
	const seenTitles = new Set<string>();

	for (const { chunk, similarity } of results) {
		if (similarity < DEFAULTS.REDUNDANCY_THRESHOLD) continue;

		const title = chunk.metadata.title || "Unknown";
		if (seenTitles.has(title)) continue;
		seenTitles.add(title);

		const score = Math.round(similarity * 1000) / 1000;
		scores.push(`${title}: ${score}`);

		const header = formatSourceHeader(title, chunk.metadata.description, {
			similarity: score,
		});
		similarParts.push(`${header}\n${chunk.text}`);

		sources.push({
			title,
			description: chunk.metadata.description || "",
			filePath: chunk.metadata.filePath,
		});
	}

	if (similarParts.length === 0) {
		return {
			answer: `No similar notes found. This ${inputType === "note" ? "note" : "idea"} appears unique.`,
			sources: [],
		};
	}

	// Build prompt and get LLM analysis
	const similarContext = similarParts.join("\n\n---\n\n");
	const scoresText = scores.join("\n");
	const prompt = formatRedundancyPrompt(
		targetContent,
		inputType,
		similarContext,
		scoresText
	);

	const messages = [
		{ role: "system", content: REDUNDANCY_SYSTEM_PROMPT },
		{ role: "user", content: prompt },
	];

	const answer = await chatWithOptionalStreaming(
		ollamaClient, messages, settings.enableStreaming, onToken
	);

	return { answer, sources };
}

/** Updater mode: Surface missing insights from notes that link to the target note. */
export async function runUpdaterMode(
	title: string,
	vectorStore: VectorStore,
	ollamaClient: OllamaClient,
	settings: PkmRagSettings,
	onToken?: (token: string) => void,
	filterTags?: string[]
): Promise<ModeResult> {
	// Get target note's chunks
	const targetChunks = vectorStore.getChunksByTitle(title);
	if (targetChunks.length === 0) {
		return {
			answer: `No note found with title "${title}".`,
			sources: [],
		};
	}

	const noteContext = targetChunks.map((c) => c.text).join("\n\n");

	// Extract aliases from target note metadata
	const aliasStr = targetChunks[0].metadata.aliases || "";
	const aliases = aliasStr
		.split(",")
		.map((a) => a.trim())
		.filter(Boolean);

	// Find chunks from other notes that link to this note
	let backlinkChunks = vectorStore.getChunksLinkingTo(title, aliases);

	// Apply tag filtering if specified
	if (filterTags && filterTags.length > 0) {
		const tagSet = new Set(filterTags);
		backlinkChunks = backlinkChunks.filter((chunk) => {
			const chunkTags = (chunk.metadata.tags || "")
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean);
			return chunkTags.some((t) => tagSet.has(t));
		});
	}

	if (backlinkChunks.length === 0) {
		return {
			answer: `No other notes link to "${title}". There are no backlink insights to review.`,
			sources: [],
		};
	}

	// Format backlink context with source headers
	const backlinkParts: string[] = [];
	const sources: SourceInfo[] = [
		{
			title,
			description: targetChunks[0].metadata.description || "",
			filePath: targetChunks[0].metadata.filePath,
		},
	];
	const seenTitles = new Set<string>([title]);

	for (const chunk of backlinkChunks) {
		const srcTitle = chunk.metadata.title || "Unknown";
		const description = chunk.metadata.description || "";

		const header = formatSourceHeader(srcTitle, description);
		backlinkParts.push(`${header}\n${chunk.text}`);

		if (!seenTitles.has(srcTitle)) {
			seenTitles.add(srcTitle);
			sources.push({
				title: srcTitle,
				description,
				filePath: chunk.metadata.filePath,
			});
		}
	}

	const backlinkContext = backlinkParts.join("\n\n---\n\n");
	const prompt = formatUpdaterPrompt(title, noteContext, backlinkContext);
	const messages = [
		{ role: "system", content: UPDATER_SYSTEM_PROMPT },
		{ role: "user", content: prompt },
	];

	const answer = await chatWithOptionalStreaming(
		ollamaClient, messages, settings.enableStreaming, onToken
	);

	return { answer, sources };
}

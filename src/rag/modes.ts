import { App, TFile } from "obsidian";
import { QmdClient } from "../qmd/qmdClient";
import { OllamaChatClient } from "../ollama/chatClient";
import { PkmRagSettings, resolveParseSettings } from "../settings";
import { SourceInfo } from "../types";
import { DEFAULTS } from "../constants";
import { retrieveContext } from "./retrieval";
import { extractSectionByHeading } from "../markdownParser";
import {
	EXPLORE_SYSTEM_PROMPT,
	CONNECT_SYSTEM_PROMPT,
	GAP_SYSTEM_PROMPT,
	DEVILS_ADVOCATE_SYSTEM_PROMPT,
	REDUNDANCY_SYSTEM_PROMPT,
	UPDATER_SYSTEM_PROMPT,
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

/**
 * Read a note's content from the vault, applying section extraction.
 * Returns null if the file is not found.
 */
async function readNoteContent(
	title: string,
	app: App,
	settings: PkmRagSettings
): Promise<{ content: string; description: string; filePath: string } | null> {
	const allFiles = app.vault.getMarkdownFiles();
	const file = allFiles.find((f) => f.basename === title);
	if (!file) return null;

	const fullContent = await app.vault.read(file);
	const cache = app.metadataCache.getFileCache(file);
	const description = String(cache?.frontmatter?.[settings.descriptionFrontmatterKey] || "").slice(0, 500);

	const parseSettings = resolveParseSettings(file.path, settings);
	let content: string;

	if (parseSettings.contentMode === "section") {
		const section = extractSectionByHeading(
			fullContent,
			parseSettings.noteSectionHeaderName,
			parseSettings.noteSectionHeaderLevel
		);
		content = section || fullContent;
	} else {
		const fmEnd = fullContent.indexOf("---", 3);
		content = fmEnd !== -1 ? fullContent.substring(fmEnd + 3).trim() : fullContent;
	}

	return { content, description, filePath: file.path };
}

/** Explore mode: RAG Q&A over notes. */
export async function runExploreMode(
	question: string,
	qmdClient: QmdClient,
	ollamaClient: OllamaChatClient,
	app: App,
	settings: PkmRagSettings,
	onToken?: (token: string) => void,
	collection?: string
): Promise<ModeResult> {
	const { formattedContext, sources } = await retrieveContext(
		question,
		qmdClient,
		app,
		settings,
		settings.topK,
		settings.similarityThreshold,
		collection
	);

	if (!formattedContext) {
		return {
			answer: "I don't have information about that in my notes.",
			sources: [],
		};
	}

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
	qmdClient: QmdClient,
	ollamaClient: OllamaChatClient,
	app: App,
	settings: PkmRagSettings,
	onToken?: (token: string) => void,
	collection?: string
): Promise<ModeResult> {
	const conceptContexts = new Map<string, string>();
	const allSources: SourceInfo[] = [];

	for (const noteTitle of selectedNotes) {
		const { formattedContext, sources } = await retrieveContext(
			noteTitle,
			qmdClient,
			app,
			settings,
			settings.topK,
			settings.similarityThreshold,
			collection
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
	qmdClient: QmdClient,
	ollamaClient: OllamaChatClient,
	app: App,
	settings: PkmRagSettings,
	onToken?: (token: string) => void,
	collection?: string
): Promise<ModeResult> {
	const { formattedContext, sources } = await retrieveContext(
		topic,
		qmdClient,
		app,
		settings,
		settings.gapAnalysisTopK,
		settings.similarityThreshold,
		collection
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
	qmdClient: QmdClient,
	ollamaClient: OllamaChatClient,
	app: App,
	settings: PkmRagSettings,
	onToken?: (token: string) => void,
	collection?: string
): Promise<ModeResult> {
	// Get target note content
	const targetNote = await readNoteContent(title, app, settings);
	if (!targetNote) {
		return {
			answer: `No note found with title "${title}".`,
			sources: [],
		};
	}

	// Use the note's description as search query for better semantic matching
	const searchQuery = targetNote.description || title;
	const searchCollection = collection || settings.defaultCollection || undefined;
	const results = await qmdClient.vectorSearch(searchQuery, {
		limit: settings.topK + 5,
		minScore: settings.similarityThreshold,
		collection: searchCollection,
	});

	const relatedParts: string[] = [];
	const sources: SourceInfo[] = [
		{
			title,
			description: targetNote.description,
			filePath: targetNote.filePath,
		},
	];
	const seenTitles = new Set<string>([title]);

	for (const result of results) {
		const relTitle = result.title || "Unknown";
		if (relTitle === title) continue;

		// Read and extract section content from the related note
		const relNote = await readNoteContent(relTitle, app, settings);
		const content = relNote?.content || result.snippet;
		const description = relNote?.description || "";

		const header = formatSourceHeader(relTitle, description);
		relatedParts.push(`${header}\n${content}`);

		if (!seenTitles.has(relTitle)) {
			seenTitles.add(relTitle);
			sources.push({
				title: relTitle,
				description,
				filePath: relNote?.filePath || result.file,
			});
		}
	}

	const relatedContext = relatedParts.join("\n\n---\n\n");
	const prompt = formatDevilsAdvocatePrompt(title, targetNote.content, relatedContext);
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
	qmdClient: QmdClient,
	ollamaClient: OllamaChatClient,
	app: App,
	settings: PkmRagSettings,
	onToken?: (token: string) => void,
	collection?: string
): Promise<ModeResult> {
	let targetContent: string;
	let searchQuery: string;
	let excludeTitle: string | undefined;

	if (inputType === "note") {
		const note = await readNoteContent(input, app, settings);
		if (!note) {
			return {
				answer: `No note found with title "${input}".`,
				sources: [],
			};
		}
		targetContent = note.content;
		searchQuery = note.description || input;
		excludeTitle = input;
	} else {
		targetContent = input;
		searchQuery = input;
		excludeTitle = undefined;
	}

	const searchCollection = collection || settings.defaultCollection || undefined;
	const results = await qmdClient.vectorSearch(searchQuery, {
		limit: settings.similarTopK,
		minScore: DEFAULTS.REDUNDANCY_THRESHOLD,
		collection: searchCollection,
	});

	const similarParts: string[] = [];
	const scores: string[] = [];
	const sources: SourceInfo[] = [];
	const seenTitles = new Set<string>();

	for (const result of results) {
		const resultTitle = result.title || "Unknown";
		if (resultTitle === excludeTitle) continue;
		if (seenTitles.has(resultTitle)) continue;
		seenTitles.add(resultTitle);

		const score = Math.round(result.score * 1000) / 1000;
		scores.push(`${resultTitle}: ${score}`);

		const relNote = await readNoteContent(resultTitle, app, settings);
		const content = relNote?.content || result.snippet;
		const description = relNote?.description || "";

		const header = formatSourceHeader(resultTitle, description, {
			similarity: score,
		});
		similarParts.push(`${header}\n${content}`);

		sources.push({
			title: resultTitle,
			description,
			filePath: relNote?.filePath || result.file,
		});
	}

	if (similarParts.length === 0) {
		return {
			answer: `No similar notes found. This ${inputType === "note" ? "note" : "idea"} appears unique.`,
			sources: [],
		};
	}

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
	qmdClient: QmdClient,
	ollamaClient: OllamaChatClient,
	app: App,
	settings: PkmRagSettings,
	onToken?: (token: string) => void,
	_collection?: string
): Promise<ModeResult> {
	// Get target note content
	const targetNote = await readNoteContent(title, app, settings);
	if (!targetNote) {
		return {
			answer: `No note found with title "${title}".`,
			sources: [],
		};
	}

	// Find backlinks using Obsidian's metadata cache
	const targetFile = app.vault.getAbstractFileByPath(targetNote.filePath);
	if (!(targetFile instanceof TFile)) {
		return {
			answer: `Cannot find file for "${title}".`,
			sources: [],
		};
	}

	// Get all files that link TO the target note
	const backlinkFiles: TFile[] = [];
	for (const [sourcePath, links] of Object.entries(app.metadataCache.resolvedLinks)) {
		if (targetNote.filePath in links) {
			const sourceFile = app.vault.getAbstractFileByPath(sourcePath);
			if (sourceFile instanceof TFile) {
				backlinkFiles.push(sourceFile);
			}
		}
	}

	if (backlinkFiles.length === 0) {
		return {
			answer: `No other notes link to "${title}". There are no backlink insights to review.`,
			sources: [],
		};
	}

	// Read content from backlink notes with section extraction
	const backlinkParts: string[] = [];
	const sources: SourceInfo[] = [
		{
			title,
			description: targetNote.description,
			filePath: targetNote.filePath,
		},
	];
	const seenTitles = new Set<string>([title]);

	for (const blFile of backlinkFiles) {
		const srcTitle = blFile.basename;
		const blNote = await readNoteContent(srcTitle, app, settings);
		if (!blNote) continue;

		const header = formatSourceHeader(srcTitle, blNote.description);
		backlinkParts.push(`${header}\n${blNote.content}`);

		if (!seenTitles.has(srcTitle)) {
			seenTitles.add(srcTitle);
			sources.push({
				title: srcTitle,
				description: blNote.description,
				filePath: blNote.filePath,
			});
		}
	}

	if (backlinkParts.length === 0) {
		return {
			answer: `No backlink content could be extracted for "${title}".`,
			sources: [],
		};
	}

	const backlinkContext = backlinkParts.join("\n\n---\n\n");
	const prompt = formatUpdaterPrompt(title, targetNote.content, backlinkContext);
	const messages = [
		{ role: "system", content: UPDATER_SYSTEM_PROMPT },
		{ role: "user", content: prompt },
	];

	const answer = await chatWithOptionalStreaming(
		ollamaClient, messages, settings.enableStreaming, onToken
	);

	return { answer, sources };
}

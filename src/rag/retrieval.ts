import { App, TFile } from "obsidian";
import { QmdClient } from "../qmd/qmdClient";
import { RetrievalResult, SimilarNote, SourceInfo } from "../types";
import { PkmRagSettings, resolveParseSettings } from "../settings";
import { extractSectionByHeading } from "../markdownParser";
import { formatSourceHeader } from "./utils";

/**
 * Read note content from vault and apply section extraction based on settings.
 * Returns the extracted section content (or full content if mode is "full").
 */
async function extractNoteContent(
	filePath: string,
	app: App,
	settings: PkmRagSettings
): Promise<{ content: string; description: string } | null> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return null;

	const fullContent = await app.vault.read(file);
	const cache = app.metadataCache.getFileCache(file);
	const description = cache?.frontmatter?.[settings.descriptionFrontmatterKey] || "";

	const parseSettings = resolveParseSettings(filePath, settings);

	let content: string;
	if (parseSettings.contentMode === "section") {
		const section = extractSectionByHeading(
			fullContent,
			parseSettings.noteSectionHeaderName,
			parseSettings.noteSectionHeaderLevel
		);
		content = section || fullContent;
	} else {
		// Strip frontmatter for full mode
		const fmEnd = fullContent.indexOf("---", 3);
		content = fmEnd !== -1 ? fullContent.substring(fmEnd + 3).trim() : fullContent;
	}

	return { content, description: String(description).slice(0, 500) };
}

/**
 * Resolve a QMD file path to a vault-relative file path.
 * QMD returns paths relative to the collection root; we need vault-relative paths.
 */
function resolveQmdFileToVaultPath(qmdFile: string, app: App): string | null {
	// QMD returns paths like "collection_name/relative/path.md"
	// Try to find the file by matching the basename and path suffix
	const allFiles = app.vault.getMarkdownFiles();
	for (const file of allFiles) {
		if (file.path.endsWith(qmdFile) || file.path === qmdFile) {
			return file.path;
		}
	}
	// Try matching just the filename
	const basename = qmdFile.split("/").pop() || qmdFile;
	for (const file of allFiles) {
		if (file.basename + ".md" === basename || file.basename === basename.replace(/\.md$/, "")) {
			return file.path;
		}
	}
	return null;
}

/**
 * Retrieve relevant context from QMD via semantic search.
 * Returns formatted context string and deduplicated source metadata.
 */
export async function retrieveContext(
	query: string,
	qmdClient: QmdClient,
	app: App,
	settings: PkmRagSettings,
	nResults: number,
	threshold: number,
	collection?: string
): Promise<RetrievalResult> {
	const searchCollection = collection || settings.defaultCollection || undefined;
	const results = await qmdClient.vectorSearch(query, {
		limit: nResults,
		minScore: threshold,
		collection: searchCollection,
	});

	const contextParts: string[] = [];
	const sources: SourceInfo[] = [];
	const seenTitles = new Set<string>();

	for (const result of results) {
		const title = result.title || "Unknown";
		const vaultPath = resolveQmdFileToVaultPath(result.file, app);

		// Try to extract section content from the actual note file
		let content = result.snippet;
		let description = "";

		if (vaultPath) {
			const extracted = await extractNoteContent(vaultPath, app, settings);
			if (extracted) {
				content = extracted.content;
				description = extracted.description;
			}
		}

		const header = formatSourceHeader(title, description, {
			descriptionSeparator: " | ",
		});
		contextParts.push(`${header}\n${content}`);

		if (!seenTitles.has(title)) {
			seenTitles.add(title);
			sources.push({
				title,
				description,
				filePath: vaultPath || result.file,
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
 * Uses QMD vector search and Obsidian metadata for link filtering.
 */
export async function findSimilarNotes(
	title: string,
	qmdClient: QmdClient,
	app: App,
	filterLinked: boolean,
	topK: number,
	threshold: number,
	collection?: string
): Promise<SimilarNote[]> {
	const searchCollection = collection || undefined;
	const results = await qmdClient.vectorSearch(title, {
		limit: topK + 20,
		minScore: threshold,
		collection: searchCollection,
	});

	// Build set of linked titles if filtering
	const linkedTitles = new Set<string>();
	if (filterLinked) {
		const activeFile = app.workspace.getActiveFile();
		if (activeFile) {
			// Outgoing links
			const resolved = app.metadataCache.resolvedLinks[activeFile.path];
			if (resolved) {
				for (const linkedPath of Object.keys(resolved)) {
					const linkedFile = app.vault.getAbstractFileByPath(linkedPath);
					if (linkedFile instanceof TFile) {
						linkedTitles.add(linkedFile.basename);
					}
				}
			}

			// Incoming links (backlinks)
			for (const [sourcePath, links] of Object.entries(app.metadataCache.resolvedLinks)) {
				if (activeFile.path in links) {
					const sourceFile = app.vault.getAbstractFileByPath(sourcePath);
					if (sourceFile instanceof TFile) {
						linkedTitles.add(sourceFile.basename);
					}
				}
			}
		}
	}

	const similar: SimilarNote[] = [];
	const seenTitles = new Set<string>();

	for (const result of results) {
		const noteTitle = result.title || "Unknown";
		if (noteTitle === title) continue;
		if (seenTitles.has(noteTitle)) continue;
		if (filterLinked && linkedTitles.has(noteTitle)) continue;

		seenTitles.add(noteTitle);

		const vaultPath = resolveQmdFileToVaultPath(result.file, app);
		let description = "";
		if (vaultPath) {
			const file = app.vault.getAbstractFileByPath(vaultPath);
			if (file instanceof TFile) {
				const cache = app.metadataCache.getFileCache(file);
				description = cache?.frontmatter?.Description || "";
			}
		}

		similar.push({
			title: noteTitle,
			description: String(description).slice(0, 200),
			similarity: Math.round(result.score * 1000) / 1000,
			filePath: vaultPath || result.file,
		});

		if (similar.length >= topK) break;
	}

	return similar;
}

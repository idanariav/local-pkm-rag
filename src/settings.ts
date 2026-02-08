import { DEFAULTS } from "./constants";

export interface FolderConfig {
	folder: string;
	contentMode?: "section" | "full";
	noteSectionHeaderName?: string;
	noteSectionHeaderLevel?: number;
}

export interface ResolvedParseSettings {
	contentMode: "section" | "full";
	noteSectionHeaderName: string;
	noteSectionHeaderLevel: number;
}

export interface PkmRagSettings {
	ollamaUrl: string;
	embedModel: string;
	chatModel: string;
	embedDimensions: number;

	folderConfigs: FolderConfig[];
	excludedFolders: string;

	contentMode: "section" | "full";
	noteSectionHeaderName: string;
	noteSectionHeaderLevel: number;
	requiredFrontmatterKey: string;
	modifiedFrontmatterKey: string;
	descriptionFrontmatterKey: string;

	chunkSize: number;
	chunkOverlap: number;
	minChunkLength: number;

	topK: number;
	similarTopK: number;
	gapAnalysisTopK: number;
	similarityThreshold: number;
	enableQueryRewrite: boolean;

	filterLinkedByDefault: boolean;
	enableStreaming: boolean;

	embeddingsFolderPath: string;
	enableAutoEmbed: boolean;
	autoEmbedDebounceSeconds: number;
}

export const DEFAULT_SETTINGS: PkmRagSettings = {
	ollamaUrl: DEFAULTS.OLLAMA_URL,
	embedModel: DEFAULTS.EMBED_MODEL,
	chatModel: DEFAULTS.CHAT_MODEL,
	embedDimensions: DEFAULTS.EMBED_DIMENSIONS,

	folderConfigs: [],
	excludedFolders: DEFAULTS.EXCLUDED_FOLDERS,

	contentMode: DEFAULTS.CONTENT_MODE,
	noteSectionHeaderName: DEFAULTS.NOTES_SECTION_HEADER_NAME,
	noteSectionHeaderLevel: DEFAULTS.NOTES_SECTION_HEADER_LEVEL,
	requiredFrontmatterKey: DEFAULTS.REQUIRED_FRONTMATTER_KEY,
	modifiedFrontmatterKey: DEFAULTS.MODIFIED_FRONTMATTER_KEY,
	descriptionFrontmatterKey: DEFAULTS.DESCRIPTION_FRONTMATTER_KEY,

	chunkSize: DEFAULTS.CHUNK_SIZE,
	chunkOverlap: DEFAULTS.CHUNK_OVERLAP,
	minChunkLength: DEFAULTS.MIN_CHUNK_LENGTH,

	topK: DEFAULTS.TOP_K,
	similarTopK: DEFAULTS.SIMILAR_TOP_K,
	gapAnalysisTopK: DEFAULTS.GAP_ANALYSIS_TOP_K,
	similarityThreshold: DEFAULTS.SIMILARITY_THRESHOLD,
	enableQueryRewrite: DEFAULTS.ENABLE_QUERY_REWRITE,

	filterLinkedByDefault: false,
	enableStreaming: true,

	embeddingsFolderPath: DEFAULTS.EMBEDDINGS_FOLDER_PATH,
	enableAutoEmbed: DEFAULTS.AUTO_EMBED_ENABLED,
	autoEmbedDebounceSeconds: DEFAULTS.AUTO_EMBED_DEBOUNCE_SECONDS,
};

/** Find the most specific matching FolderConfig for a file path (longest-prefix match). */
export function findFolderConfig(
	filePath: string,
	folderConfigs: FolderConfig[]
): FolderConfig | undefined {
	let bestMatch: FolderConfig | undefined;
	let bestLength = -1;

	for (const config of folderConfigs) {
		if (!config.folder) continue;
		const prefix = config.folder + "/";
		if (filePath.startsWith(prefix) || filePath === config.folder) {
			if (config.folder.length > bestLength) {
				bestLength = config.folder.length;
				bestMatch = config;
			}
		}
	}
	return bestMatch;
}

/** Resolve effective parse settings for a file by merging folder overrides onto global defaults. */
export function resolveParseSettings(
	filePath: string,
	settings: PkmRagSettings
): ResolvedParseSettings {
	const folderConfig = findFolderConfig(filePath, settings.folderConfigs);
	return {
		contentMode: folderConfig?.contentMode ?? settings.contentMode,
		noteSectionHeaderName: folderConfig?.noteSectionHeaderName ?? settings.noteSectionHeaderName,
		noteSectionHeaderLevel: folderConfig?.noteSectionHeaderLevel ?? settings.noteSectionHeaderLevel,
	};
}

/** Check whether a file falls within the configured embed scope. */
export function isFileInScope(
	filePath: string,
	folderConfigs: FolderConfig[]
): boolean {
	const folders = folderConfigs.map((c) => c.folder).filter(Boolean);
	if (folders.length === 0) return true;
	return folders.some(
		(folder) => filePath.startsWith(folder + "/") || filePath === folder
	);
}

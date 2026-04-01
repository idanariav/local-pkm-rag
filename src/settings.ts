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
	chatModel: string;

	folderConfigs: FolderConfig[];

	contentMode: "section" | "full";
	noteSectionHeaderName: string;
	noteSectionHeaderLevel: number;
	descriptionFrontmatterKey: string;

	topK: number;
	similarTopK: number;
	gapAnalysisTopK: number;
	similarityThreshold: number;

	filterLinkedByDefault: boolean;
	enableStreaming: boolean;

	qmdPath: string;
	defaultCollection: string;
}

export const DEFAULT_SETTINGS: PkmRagSettings = {
	ollamaUrl: DEFAULTS.OLLAMA_URL,
	chatModel: DEFAULTS.CHAT_MODEL,

	folderConfigs: [],

	contentMode: DEFAULTS.CONTENT_MODE,
	noteSectionHeaderName: DEFAULTS.NOTES_SECTION_HEADER_NAME,
	noteSectionHeaderLevel: DEFAULTS.NOTES_SECTION_HEADER_LEVEL,
	descriptionFrontmatterKey: DEFAULTS.DESCRIPTION_FRONTMATTER_KEY,

	topK: DEFAULTS.TOP_K,
	similarTopK: DEFAULTS.SIMILAR_TOP_K,
	gapAnalysisTopK: DEFAULTS.GAP_ANALYSIS_TOP_K,
	similarityThreshold: DEFAULTS.SIMILARITY_THRESHOLD,

	filterLinkedByDefault: false,
	enableStreaming: true,

	qmdPath: DEFAULTS.QMD_PATH,
	defaultCollection: DEFAULTS.QMD_DEFAULT_COLLECTION,
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

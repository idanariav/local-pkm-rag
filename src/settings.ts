import { DEFAULTS } from "./constants";
import { ToolId } from "./cli/types";
import { TOOL_IDS } from "./cli/toolRegistry";

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

	toolPaths: Record<ToolId, string>;
	commandTimeoutMs: number;
	setupWizardShown: boolean;
	/** Per-tool default values for search-command flags (e.g. qmd's -n, --min-score),
	 *  keyed by the flag string. Pre-fills the CLI console's forms; overrides the
	 *  command schema's own hardcoded default when set. */
	toolFlagDefaults: Record<ToolId, Record<string, string>>;

	/** Ordered command IDs run in sequence by the setup wizard's per-tool "Update" button
	 *  (e.g. qmd's ["index", "embed"]). Configurable in Settings → Update Command Sequences. */
	toolUpdateCommands: Record<ToolId, string[]>;

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

	toolPaths: Object.fromEntries(TOOL_IDS.map((id) => [id, ""])) as Record<ToolId, string>,
	commandTimeoutMs: DEFAULTS.DEFAULT_COMMAND_TIMEOUT_MS,
	setupWizardShown: false,
	toolFlagDefaults: Object.fromEntries(TOOL_IDS.map((id) => [id, {}])) as Record<ToolId, Record<string, string>>,
	toolUpdateCommands: {
		qmd: ["index", "embed"],
		qimg: ["index", "caption", "ocr", "embed"],
		qnode: ["index", "metrics.compute"],
		qvoid: ["index", "classify", "embed"],
	},

	defaultCollection: DEFAULTS.QMD_DEFAULT_COLLECTION,
};

/**
 * One-time migration from the pre-multi-tool settings shape: the old single `qmdPath`
 * field becomes `toolPaths.qmd`. Safe to call on already-migrated settings (no-op).
 */
export function migrateLegacySettings(settings: PkmRagSettings & { qmdPath?: string }): PkmRagSettings {
	if (settings.qmdPath && !settings.toolPaths?.qmd) {
		settings.toolPaths = { ...settings.toolPaths, qmd: settings.qmdPath };
	}
	delete settings.qmdPath;
	return settings;
}

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

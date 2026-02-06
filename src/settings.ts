import { DEFAULTS } from "./constants";

export interface PkmRagSettings {
	ollamaUrl: string;
	embedModel: string;
	chatModel: string;
	embedDimensions: number;

	foldersToEmbed: string;
	excludedFolders: string;

	contentMode: "section" | "full";
	noteSectionHeader: string;
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

	foldersToEmbed: "",
	excludedFolders: DEFAULTS.EXCLUDED_FOLDERS,

	contentMode: DEFAULTS.CONTENT_MODE,
	noteSectionHeader: DEFAULTS.NOTES_SECTION_HEADER,
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

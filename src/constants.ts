export const DEFAULTS = {
	OLLAMA_URL: "http://localhost:11434",
	EMBED_MODEL: "nomic-embed-text",
	CHAT_MODEL: "llama3.1:8b",
	EMBED_DIMENSIONS: 768,

	CHUNK_SIZE: 800,
	CHUNK_OVERLAP: 100,
	MIN_CHUNK_LENGTH: 50,
	CHUNK_SEPARATORS: ["\n## ", "\n### ", "\n\n", "\n1. ", "\n- ", "\n", ". ", " "],
	CHUNK_SEPARATORS_NO_HEADINGS: ["\n\n", "\n1. ", "\n- ", "\n", ". ", " "],

	TOP_K: 5,
	SIMILARITY_THRESHOLD: 0.5,
	SIMILAR_TOP_K: 10,
	GAP_ANALYSIS_TOP_K: 15,
	ENABLE_QUERY_REWRITE: false,

	CONTENT_MODE: "section" as const,
	NOTES_SECTION_HEADER_NAME: "Notes",
	NOTES_SECTION_HEADER_LEVEL: 2,
	REQUIRED_FRONTMATTER_KEY: "UUID",
	MODIFIED_FRONTMATTER_KEY: "Modified",
	DESCRIPTION_FRONTMATTER_KEY: "Description",

	PROPERTY_WIKILINK_PATTERN: /\([A-Za-z]+::\s*\[\[(?:[^\]|]*\|)?([^\]]+)\]\]\)/g,
	WIKILINK_PATTERN: /\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g,
	DATAVIEW_FIELD_PATTERN: /^\s*\w+::\s*/gm,

	EXCLUDED_FOLDERS: ".obsidian, .trash",
	EMBEDDINGS_FOLDER_PATH: ".pkm-embeddings",
	AUTO_EMBED_ENABLED: true,
	AUTO_EMBED_DEBOUNCE_SECONDS: 30,
} as const;

export const VECTOR_STORE_VERSION = 1;
export const EMBEDDINGS_FILENAME = "embeddings.json";
export const EMBED_DEBOUNCE_MS = 30_000;
export const EMBED_CONCURRENCY = 3;

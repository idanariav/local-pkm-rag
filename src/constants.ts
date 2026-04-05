export const DEFAULTS = {
	OLLAMA_URL: "http://localhost:11434",
	CHAT_MODEL: "llama3.1:8b",

	TOP_K: 5,
	SIMILARITY_THRESHOLD: 0.5,
	SIMILAR_TOP_K: 10,
	GAP_ANALYSIS_TOP_K: 15,
	REDUNDANCY_THRESHOLD: 0.5,

	CONTENT_MODE: "section" as const,
	NOTES_SECTION_HEADER_NAME: "Notes",
	NOTES_SECTION_HEADER_LEVEL: 2,
	DESCRIPTION_FRONTMATTER_KEY: "Description",

	PROPERTY_WIKILINK_PATTERN: /\([A-Za-z]+::\s*\[\[(?:[^\]|]*\|)?([^\]]+)\]\]\)/g,
	WIKILINK_PATTERN: /\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g,
	DATAVIEW_FIELD_PATTERN: /^\s*\w+::\s*/gm,

	QMD_PATH: "/opt/homebrew/bin/qmd",
	QMD_DEFAULT_COLLECTION: "",
} as const;

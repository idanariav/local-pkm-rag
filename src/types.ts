export interface ParsedNote {
	uuid: string;
	modified: string;
	title: string;
	description: string;
	aliases: string[];
	tags: string[];
	content: string;
	filePath: string;
	outgoingLinks: string[];
}

export interface ChunkMetadata {
	uuid: string;
	modified: string;
	title: string;
	description: string;
	aliases: string;
	tags: string;
	outgoingLinks: string;
	chunkIndex: number;
	totalChunks: number;
	filePath: string;
}

export interface StoredChunk {
	id: string;
	embedding: number[];
	text: string;
	metadata: ChunkMetadata;
}

export interface VectorStoreData {
	version: number;
	modelName: string;
	chunkSize: number;
	chunkOverlap: number;
	chunks: StoredChunk[];
}

export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	sources?: SourceInfo[];
	timestamp: number;
}

export interface SourceInfo {
	title: string;
	description: string;
	filePath?: string;
}

export interface RetrievalResult {
	formattedContext: string;
	sources: SourceInfo[];
}

export interface SimilarNote {
	title: string;
	description: string;
	similarity: number;
	filePath?: string;
}

export interface EmbedStats {
	new: number;
	updated: number;
	unchanged: number;
	skipped: number;
	deleted: number;
	errors: number;
}

export type ChatMode = "explore" | "connect" | "gap" | "devils_advocate" | "redundancy";

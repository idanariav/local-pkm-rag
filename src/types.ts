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

export type ChatMode = "explore" | "connect" | "gap" | "devils_advocate" | "redundancy" | "updater";

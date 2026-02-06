import { requestUrl } from "obsidian";
import { EMBED_CONCURRENCY } from "../constants";

export class OllamaClient {
	private baseUrl: string;
	private embedModel: string;
	private chatModel: string;

	constructor(baseUrl: string, embedModel: string, chatModel: string) {
		this.baseUrl = baseUrl.replace(/\/+$/, "");
		this.embedModel = embedModel;
		this.chatModel = chatModel;
	}

	/** Check if Ollama is reachable. */
	async isAvailable(): Promise<boolean> {
		try {
			const response = await requestUrl({
				url: `${this.baseUrl}/api/tags`,
				method: "GET",
			});
			return response.status === 200;
		} catch {
			return false;
		}
	}

	/** Embed a single text, returning the embedding vector. */
	async embed(text: string): Promise<number[]> {
		const response = await requestUrl({
			url: `${this.baseUrl}/api/embeddings`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: this.embedModel,
				prompt: text,
			}),
		});
		if (response.status !== 200) {
			throw new Error(`Ollama embed failed: ${response.status}`);
		}
		return response.json.embedding;
	}

	/** Embed a batch of texts with concurrency control. */
	async embedBatch(
		texts: string[],
		onProgress?: (done: number, total: number) => void
	): Promise<number[][]> {
		const results: number[][] = new Array(texts.length);
		let completed = 0;

		// Process in concurrent batches
		for (let i = 0; i < texts.length; i += EMBED_CONCURRENCY) {
			const batch = texts.slice(i, i + EMBED_CONCURRENCY);
			const embeddings = await Promise.all(
				batch.map((text) => this.embed(text))
			);
			for (let j = 0; j < embeddings.length; j++) {
				results[i + j] = embeddings[j];
			}
			completed += batch.length;
			onProgress?.(completed, texts.length);
		}

		return results;
	}

	/** Send a chat completion request (non-streaming). */
	async chat(
		messages: { role: string; content: string }[]
	): Promise<string> {
		const response = await requestUrl({
			url: `${this.baseUrl}/api/chat`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: this.chatModel,
				messages,
				stream: false,
			}),
		});
		if (response.status !== 200) {
			throw new Error(`Ollama chat failed: ${response.status}`);
		}
		return response.json.message.content;
	}

	/** Send a streaming chat request, calling onToken for each token. */
	async chatStream(
		messages: { role: string; content: string }[],
		onToken: (token: string) => void
	): Promise<string> {
		const response = await fetch(`${this.baseUrl}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: this.chatModel,
				messages,
				stream: true,
			}),
		});

		if (!response.ok) {
			throw new Error(`Ollama stream failed: ${response.status}`);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error("No response body for streaming");
		}

		const decoder = new TextDecoder();
		let fullResponse = "";
		let buffer = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			// Keep the last incomplete line in the buffer
			buffer = lines.pop() || "";

			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const data = JSON.parse(line);
					if (data.message?.content) {
						const token = data.message.content;
						fullResponse += token;
						onToken(token);
					}
				} catch {
					// Skip malformed JSON lines
				}
			}
		}

		// Process any remaining buffer
		if (buffer.trim()) {
			try {
				const data = JSON.parse(buffer);
				if (data.message?.content) {
					const token = data.message.content;
					fullResponse += token;
					onToken(token);
				}
			} catch {
				// Skip
			}
		}

		return fullResponse;
	}
}

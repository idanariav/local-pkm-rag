import { requestUrl } from "obsidian";

/**
 * Ollama client for LLM chat/generation only.
 * Embedding is handled by QMD.
 */
export class OllamaChatClient {
	private baseUrl: string;
	private chatModel: string;

	constructor(baseUrl: string, chatModel: string) {
		this.baseUrl = baseUrl.replace(/\/+$/, "");
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

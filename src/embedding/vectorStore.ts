import { Plugin } from "obsidian";
import { StoredChunk, VectorStoreData } from "../types";
import { VECTOR_STORE_VERSION, EMBEDDINGS_FILENAME } from "../constants";

function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA * normB);
	return denom === 0 ? 0 : dot / denom;
}

export class VectorStore {
	private chunks: Map<string, StoredChunk> = new Map();
	private uuidIndex: Map<string, string[]> = new Map();
	private dirty = false;
	private storedModelName = "";
	private storedChunkSize = 0;
	private storedChunkOverlap = 0;
	private embeddingsFolderPath = "";  // Configurable path for embeddings storage

	get totalChunks(): number {
		return this.chunks.size;
	}

	get totalNotes(): number {
		return this.uuidIndex.size;
	}

	/** Load embeddings from the plugin data directory. */
	async loadFromDisk(plugin: Plugin): Promise<void> {
		try {
			const path = this.getFilePath(plugin);
			const exists = await plugin.app.vault.adapter.exists(path);
			if (!exists) return;

			const raw = await plugin.app.vault.adapter.read(path);
			const data: VectorStoreData = JSON.parse(raw);

			if (data.version !== VECTOR_STORE_VERSION) {
				console.log("PKM RAG: Vector store version mismatch, starting fresh");
				return;
			}

			this.storedModelName = data.modelName || "";
			this.storedChunkSize = data.chunkSize || 0;
			this.storedChunkOverlap = data.chunkOverlap || 0;

			this.chunks.clear();
			this.uuidIndex.clear();

			for (const chunk of data.chunks) {
				this.chunks.set(chunk.id, chunk);
				const existing = this.uuidIndex.get(chunk.metadata.uuid) || [];
				existing.push(chunk.id);
				this.uuidIndex.set(chunk.metadata.uuid, existing);
			}

			this.dirty = false;
		} catch (e) {
			console.error("PKM RAG: Failed to load vector store", e);
		}
	}

	/** Save embeddings to the plugin data directory. */
	async saveToDisk(plugin: Plugin): Promise<void> {
		if (!this.dirty) return;

		const data: VectorStoreData = {
			version: VECTOR_STORE_VERSION,
			modelName: this.storedModelName,
			chunkSize: this.storedChunkSize,
			chunkOverlap: this.storedChunkOverlap,
			chunks: Array.from(this.chunks.values()),
		};

		const path = this.getFilePath(plugin);
		// Ensure directory exists
		const dir = path.substring(0, path.lastIndexOf("/"));
		if (!(await plugin.app.vault.adapter.exists(dir))) {
			await plugin.app.vault.adapter.mkdir(dir);
		}

		await plugin.app.vault.adapter.write(path, JSON.stringify(data));
		this.dirty = false;
	}

	/** Check if the stored config matches current settings. Returns true if valid. */
	validateConfig(modelName: string, chunkSize: number, chunkOverlap: number): boolean {
		if (this.chunks.size === 0) return true;
		return (
			this.storedModelName === modelName &&
			this.storedChunkSize === chunkSize &&
			this.storedChunkOverlap === chunkOverlap
		);
	}

	/** Update stored config values (call after embedding). */
	setConfig(modelName: string, chunkSize: number, chunkOverlap: number): void {
		this.storedModelName = modelName;
		this.storedChunkSize = chunkSize;
		this.storedChunkOverlap = chunkOverlap;
	}

	/** Clear all stored data. */
	clear(): void {
		this.chunks.clear();
		this.uuidIndex.clear();
		this.dirty = true;
	}

	/** Insert or replace chunks for a note. */
	upsertChunks(chunks: StoredChunk[]): void {
		if (chunks.length === 0) return;
		const uuid = chunks[0].metadata.uuid;
		this.deleteByUuid(uuid);

		const ids: string[] = [];
		for (const chunk of chunks) {
			this.chunks.set(chunk.id, chunk);
			ids.push(chunk.id);
		}
		this.uuidIndex.set(uuid, ids);
		this.dirty = true;
	}

	/** Delete all chunks for a given UUID. */
	deleteByUuid(uuid: string): void {
		const ids = this.uuidIndex.get(uuid);
		if (!ids) return;
		for (const id of ids) {
			this.chunks.delete(id);
		}
		this.uuidIndex.delete(uuid);
		this.dirty = true;
	}

	/** Get all chunks for a given UUID. */
	getByUuid(uuid: string): StoredChunk[] {
		const ids = this.uuidIndex.get(uuid);
		if (!ids) return [];
		return ids.map((id) => this.chunks.get(id)!).filter(Boolean);
	}

	/** Get UUID -> modified date mapping for incremental update detection. */
	getEmbeddedState(): Map<string, string> {
		const state = new Map<string, string>();
		for (const [uuid, ids] of this.uuidIndex) {
			if (ids.length > 0) {
				const chunk = this.chunks.get(ids[0]);
				if (chunk) {
					state.set(uuid, chunk.metadata.modified);
				}
			}
		}
		return state;
	}

	/** Get all unique tags across stored chunks. */
	getAllTags(): string[] {
		const tags = new Set<string>();
		for (const chunk of this.chunks.values()) {
			const tagStr = chunk.metadata.tags || "";
			if (tagStr) {
				for (const tag of tagStr.split(",")) {
					const trimmed = tag.trim();
					if (trimmed) tags.add(trimmed);
				}
			}
		}
		return Array.from(tags).sort();
	}

	/** Get all unique note titles. */
	getAllTitles(): string[] {
		const titles = new Set<string>();
		for (const chunk of this.chunks.values()) {
			if (chunk.metadata.title) {
				titles.add(chunk.metadata.title);
			}
		}
		return Array.from(titles).sort();
	}

	/** Get chunks matching a specific title. */
	getChunksByTitle(title: string): StoredChunk[] {
		const results: StoredChunk[] = [];
		for (const chunk of this.chunks.values()) {
			if (chunk.metadata.title === title) {
				results.push(chunk);
			}
		}
		return results.sort((a, b) => a.metadata.chunkIndex - b.metadata.chunkIndex);
	}

	/** Find the UUID associated with a file path. */
	getUuidByFilePath(filePath: string): string | null {
		for (const chunk of this.chunks.values()) {
			if (chunk.metadata.filePath === filePath) {
				return chunk.metadata.uuid;
			}
		}
		return null;
	}

	/** Update file path in all chunks matching the old path. */
	updateFilePath(oldPath: string, newPath: string): void {
		for (const chunk of this.chunks.values()) {
			if (chunk.metadata.filePath === oldPath) {
				chunk.metadata.filePath = newPath;
				this.dirty = true;
			}
		}
	}

	/**
	 * Search for similar chunks by cosine similarity.
	 * Returns top K results sorted by similarity descending.
	 * Uses a min-heap approach to avoid sorting all results.
	 */
	search(
		queryEmbedding: number[],
		topK: number,
		excludeUuids?: Set<string>,
		filterTags?: Set<string>
	): Array<{ chunk: StoredChunk; similarity: number }> {
		const heap: Array<{ chunk: StoredChunk; similarity: number }> = [];

		for (const chunk of this.chunks.values()) {
			if (excludeUuids && excludeUuids.has(chunk.metadata.uuid)) {
				continue;
			}
			if (filterTags && filterTags.size > 0) {
				const chunkTags = (chunk.metadata.tags || "")
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean);
				if (!chunkTags.some((t) => filterTags.has(t))) {
					continue;
				}
			}
			const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);

			if (heap.length < topK) {
				heap.push({ chunk, similarity });
				if (heap.length === topK) {
					heap.sort((a, b) => a.similarity - b.similarity);
				}
			} else if (similarity > heap[0].similarity) {
				heap[0] = { chunk, similarity };
				heap.sort((a, b) => a.similarity - b.similarity);
			}
		}

		return heap.sort((a, b) => b.similarity - a.similarity);
	}

	/** Get all chunks from other notes whose outgoingLinks reference the target title or aliases. */
	getChunksLinkingTo(title: string, aliases?: string[]): StoredChunk[] {
		const targets = new Set<string>([title]);
		if (aliases) {
			for (const alias of aliases) {
				if (alias) targets.add(alias);
			}
		}

		const results: StoredChunk[] = [];
		for (const chunk of this.chunks.values()) {
			if (chunk.metadata.title === title) continue;
			const links = (chunk.metadata.outgoingLinks || "")
				.split(",")
				.map((l) => l.trim())
				.filter(Boolean);
			if (links.some((l) => targets.has(l))) {
				results.push(chunk);
			}
		}

		return results.sort((a, b) =>
			a.metadata.title !== b.metadata.title
				? a.metadata.title.localeCompare(b.metadata.title)
				: a.metadata.chunkIndex - b.metadata.chunkIndex
		);
	}

	private getFilePath(plugin: Plugin): string {
		if (this.embeddingsFolderPath) {
			return `${this.embeddingsFolderPath}/${EMBEDDINGS_FILENAME}`;
		}
		// Fallback to plugin directory if no custom path is set
		return `${plugin.manifest.dir}/${EMBEDDINGS_FILENAME}`;
	}

	/** Set the custom embeddings folder path. */
	setEmbeddingsFolderPath(path: string): void {
		this.embeddingsFolderPath = path;
	}
}

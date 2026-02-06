import { App, TFile } from "obsidian";
import { VectorStore } from "./vectorStore";
import { OllamaClient } from "./ollamaClient";
import { RecursiveCharacterTextSplitter } from "./chunker";
import { parseNote } from "../parser";
import { PkmRagSettings } from "../settings";
import { StoredChunk, EmbedStats, NoteChunk, ParsedNote } from "../types";
import { DEFAULTS } from "../constants";

export class EmbedPipeline {
	private vectorStore: VectorStore;
	private ollamaClient: OllamaClient;
	private app: App;
	private settings: PkmRagSettings;

	constructor(
		vectorStore: VectorStore,
		ollamaClient: OllamaClient,
		app: App,
		settings: PkmRagSettings
	) {
		this.vectorStore = vectorStore;
		this.ollamaClient = ollamaClient;
		this.app = app;
		this.settings = settings;
	}

	updateSettings(settings: PkmRagSettings): void {
		this.settings = settings;
	}

	/**
	 * Run the full embedding pipeline with incremental updates.
	 * If force is true, clears all existing embeddings first.
	 */
	async embedVault(
		force: boolean = false,
		onProgress?: (msg: string) => void
	): Promise<EmbedStats> {
		// Validate config or force re-embed
		if (force) {
			this.vectorStore.clear();
		} else if (
			!this.vectorStore.validateConfig(
				this.settings.embedModel,
				this.settings.chunkSize,
				this.settings.chunkOverlap
			)
		) {
			onProgress?.("Config changed, clearing embeddings...");
			this.vectorStore.clear();
		}

		this.vectorStore.setConfig(
			this.settings.embedModel,
			this.settings.chunkSize,
			this.settings.chunkOverlap
		);

		const files = this.getFilesToEmbed();
		const embeddedState = this.vectorStore.getEmbeddedState();
		const stats: EmbedStats = {
			new: 0,
			updated: 0,
			unchanged: 0,
			skipped: 0,
			deleted: 0,
			errors: 0,
		};
		const seenUuids = new Set<string>();

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			onProgress?.(
				`Processing ${i + 1}/${files.length}: ${file.basename}`
			);

			try {
				const note = await parseNote(file, this.app, this.settings);
				if (!note) {
					stats.skipped++;
					continue;
				}

				seenUuids.add(note.uuid);

				const existingModified = embeddedState.get(note.uuid);
				if (existingModified === note.modified) {
					stats.unchanged++;
					continue;
				}

				if (existingModified !== undefined) {
					this.vectorStore.deleteByUuid(note.uuid);
					stats.updated++;
				} else {
					stats.new++;
				}

				const storedChunks = await this.chunkAndEmbed(note);
				if (storedChunks.length === 0) {
					stats.skipped++;
					continue;
				}

				this.vectorStore.upsertChunks(storedChunks);
			} catch (e) {
				console.error(`PKM RAG: Error processing ${file.path}`, e);
				stats.errors++;
			}
		}

		// Detect deleted notes (only on full vault scan)
		const deletedUuids = new Set<string>();
		for (const uuid of embeddedState.keys()) {
			if (!seenUuids.has(uuid)) {
				deletedUuids.add(uuid);
			}
		}
		for (const uuid of deletedUuids) {
			this.vectorStore.deleteByUuid(uuid);
			stats.deleted++;
		}

		return stats;
	}

	/** Embed a single file. */
	async embedFile(file: TFile): Promise<EmbedStats> {
		const stats: EmbedStats = {
			new: 0,
			updated: 0,
			unchanged: 0,
			skipped: 0,
			deleted: 0,
			errors: 0,
		};

		try {
			const note = await parseNote(file, this.app, this.settings);
			if (!note) {
				stats.skipped++;
				return stats;
			}

			const embeddedState = this.vectorStore.getEmbeddedState();
			const existingModified = embeddedState.get(note.uuid);

			if (existingModified === note.modified) {
				stats.unchanged++;
				return stats;
			}

			if (existingModified !== undefined) {
				this.vectorStore.deleteByUuid(note.uuid);
				stats.updated++;
			} else {
				stats.new++;
			}

			const storedChunks = await this.chunkAndEmbed(note);
			if (storedChunks.length === 0) {
				stats.skipped++;
				return stats;
			}

			this.vectorStore.upsertChunks(storedChunks);
		} catch (e) {
			console.error(`PKM RAG: Error embedding ${file.path}`, e);
			stats.errors++;
		}

		return stats;
	}

	/** Chunk a note and generate embeddings for each chunk. */
	private async chunkAndEmbed(note: ParsedNote): Promise<StoredChunk[]> {
		// Prepend description to content (same as Python)
		let fullText = note.content;
		if (note.description) {
			fullText = `${note.description}\n\n${note.content}`;
		}

		if (fullText.trim().length < this.settings.minChunkLength) {
			return [];
		}

		const splitter = new RecursiveCharacterTextSplitter(
			this.settings.chunkSize,
			this.settings.chunkOverlap,
			[...DEFAULTS.CHUNK_SEPARATORS]
		);
		const texts = splitter.splitText(fullText);

		// Filter out very short chunks
		const validTexts = texts.filter(
			(t) => t.length >= this.settings.minChunkLength
		);
		if (validTexts.length === 0) return [];

		// Generate embeddings
		const embeddings = await this.ollamaClient.embedBatch(validTexts);

		// Build stored chunks
		const storedChunks: StoredChunk[] = [];
		for (let i = 0; i < validTexts.length; i++) {
			storedChunks.push({
				id: `${note.uuid}_chunk_${i}`,
				embedding: embeddings[i],
				text: validTexts[i],
				metadata: {
					uuid: note.uuid,
					modified: note.modified,
					title: note.title,
					description: note.description
						? note.description.substring(0, 500)
						: "",
					aliases: note.aliases.join(", "),
					outgoingLinks: note.outgoingLinks.join(", "),
					chunkIndex: i,
					totalChunks: validTexts.length,
					filePath: note.filePath,
				},
			});
		}

		return storedChunks;
	}

	/** Get markdown files to embed based on settings. */
	private getFilesToEmbed(): TFile[] {
		const allFiles = this.app.vault.getMarkdownFiles();

		const includeFolders = this.settings.foldersToEmbed
			.split(",")
			.map((f) => f.trim())
			.filter(Boolean);

		const excludeFolders = this.settings.excludedFolders
			.split(",")
			.map((f) => f.trim())
			.filter(Boolean);

		return allFiles.filter((file) => {
			// Exclude folders check
			for (const excluded of excludeFolders) {
				if (file.path.startsWith(excluded + "/") || file.path.startsWith(excluded)) {
					return false;
				}
			}

			// Include folders check (empty means include all)
			if (includeFolders.length === 0) return true;

			for (const included of includeFolders) {
				if (file.path.startsWith(included + "/") || file.path.startsWith(included)) {
					return true;
				}
			}
			return false;
		});
	}
}

import { Notice, Plugin, TFile } from "obsidian";
import { PkmRagSettings, DEFAULT_SETTINGS } from "./settings";
import { PkmRagSettingTab } from "./settingsTab";
import { VectorStore } from "./embedding/vectorStore";
import { OllamaClient } from "./embedding/ollamaClient";
import { EmbedPipeline } from "./embedding/embedPipeline";
import { RelatedNotesView, RELATED_NOTES_VIEW_TYPE } from "./views/relatedNotesView";
import { ChatView, CHAT_VIEW_TYPE } from "./views/chatView";
import { EMBED_DEBOUNCE_MS } from "./constants";

export default class PkmRagPlugin extends Plugin {
	settings: PkmRagSettings = DEFAULT_SETTINGS;
	vectorStore: VectorStore = new VectorStore();
	ollamaClient: OllamaClient = new OllamaClient(
		DEFAULT_SETTINGS.ollamaUrl,
		DEFAULT_SETTINGS.embedModel,
		DEFAULT_SETTINGS.chatModel
	);
	embedPipeline!: EmbedPipeline;

	private embedDebounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

	async onload() {
		await this.loadSettings();
		this.ollamaClient = new OllamaClient(
			this.settings.ollamaUrl,
			this.settings.embedModel,
			this.settings.chatModel
		);

		// Set the embeddings folder path
		this.vectorStore.setEmbeddingsFolderPath(this.settings.embeddingsFolderPath);

		// Load vector store from disk
		await this.vectorStore.loadFromDisk(this);

		// Initialize embed pipeline
		this.embedPipeline = new EmbedPipeline(
			this.vectorStore,
			this.ollamaClient,
			this.app,
			this.settings
		);

		// Register views
		this.registerView(RELATED_NOTES_VIEW_TYPE, (leaf) => new RelatedNotesView(leaf, this));
		this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));

		// Add settings tab
		this.addSettingTab(new PkmRagSettingTab(this.app, this));

		// Register commands
		this.addCommand({
			id: "show-related",
			name: "Show related notes",
			callback: () => this.activateView(RELATED_NOTES_VIEW_TYPE),
		});

		this.addCommand({
			id: "open-chat",
			name: "Open chat",
			callback: () => this.activateView(CHAT_VIEW_TYPE),
		});

		this.addCommand({
			id: "embed-vault",
			name: "Embed vault",
			callback: () => this.embedVault(false),
		});

		this.addCommand({
			id: "embed-current",
			name: "Embed current note",
			callback: () => this.embedCurrentNote(),
		});

		// Auto-update related notes on active leaf change
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.refreshRelatedNotesView();
			})
		);

		// Re-embed on file modify (debounced)
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (this.settings.enableAutoEmbed && file instanceof TFile && file.extension === "md") {
					this.debouncedEmbed(file);
				}
			})
		);

		// Remove chunks on file delete
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					this.handleFileDelete(file);
				}
			})
		);

		// Update filePath on rename
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile && file.extension === "md") {
					this.vectorStore.updateFilePath(oldPath, file.path);
					this.vectorStore.saveToDisk(this);
				}
			})
		);
	}

	onunload() {
		// Clear debounce timers
		for (const timer of this.embedDebounceTimers.values()) {
			clearTimeout(timer);
		}
		this.embedDebounceTimers.clear();

		// Save vector store
		this.vectorStore.saveToDisk(this);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Update clients with new settings
		this.ollamaClient = new OllamaClient(
			this.settings.ollamaUrl,
			this.settings.embedModel,
			this.settings.chatModel
		);
		// Update embeddings folder path
		this.vectorStore.setEmbeddingsFolderPath(this.settings.embeddingsFolderPath);
		if (this.embedPipeline) {
			this.embedPipeline.updateSettings(this.settings);
		}
	}

	async activateView(viewType: string) {
		const existing = this.app.workspace.getLeavesOfType(viewType);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: viewType, active: true });
			this.app.workspace.revealLeaf(leaf);
		}
	}

	async embedVault(force: boolean) {
		const notice = new Notice("Embedding vault...", 0);
		try {
			const stats = await this.embedPipeline.embedVault(force, (msg) => {
				notice.setMessage(msg);
			});
			notice.setMessage("Saving embeddings...");
			await this.vectorStore.saveToDisk(this);
			notice.hide();
			new Notice(
				`Embedding complete: ${stats.new} new, ${stats.updated} updated, ${stats.unchanged} unchanged, ${stats.skipped} skipped, ${stats.deleted} deleted, ${stats.errors} errors`,
				10000
			);
			this.refreshRelatedNotesView();
		} catch (e) {
			notice.hide();
			new Notice(`Embedding failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	async embedCurrentNote() {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("No active file");
			return;
		}
		const notice = new Notice(`Embedding ${file.basename}...`, 0);
		try {
			const stats = await this.embedPipeline.embedFile(file);
			notice.hide();
			if (stats.new + stats.updated > 0) {
				new Notice(`Embedded ${file.basename}`);
			} else if (stats.skipped > 0) {
				new Notice(`Skipped ${file.basename} (no UUID or content)`);
			} else {
				new Notice(`${file.basename} is unchanged`);
			}
			this.refreshRelatedNotesView();
		} catch (e) {
			notice.hide();
			new Notice(`Failed to embed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private debouncedEmbed(file: TFile) {
		const existing = this.embedDebounceTimers.get(file.path);
		if (existing) {
			clearTimeout(existing);
		}
		const debounceMs = this.settings.autoEmbedDebounceSeconds * 1000;
		const timer = setTimeout(async () => {
			this.embedDebounceTimers.delete(file.path);
			try {
				await this.embedPipeline.embedFile(file);
				await this.vectorStore.saveToDisk(this);
				this.refreshRelatedNotesView();
			} catch {
				// Silently fail for auto-embed
			}
		}, debounceMs);
		this.embedDebounceTimers.set(file.path, timer);
	}

	private handleFileDelete(file: TFile) {
		// Find UUID for this file path and delete chunks
		const uuid = this.vectorStore.getUuidByFilePath(file.path);
		if (uuid) {
			this.vectorStore.deleteByUuid(uuid);
			this.vectorStore.saveToDisk(this);
		}
	}

	private refreshRelatedNotesView() {
		const leaves = this.app.workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof RelatedNotesView) {
				view.refresh();
			}
		}
	}
}

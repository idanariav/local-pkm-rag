import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type PkmRagPlugin from "./main";
import { OllamaClient } from "./embedding/ollamaClient";

export class PkmRagSettingTab extends PluginSettingTab {
	plugin: PkmRagPlugin;

	constructor(app: App, plugin: PkmRagPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// --- Ollama Connection ---
		containerEl.createEl("h3", { text: "Ollama Connection" });

		new Setting(containerEl)
			.setName("Ollama URL")
			.setDesc("Base URL for the local Ollama instance")
			.addText((text) =>
				text
					.setPlaceholder("http://localhost:11434")
					.setValue(this.plugin.settings.ollamaUrl)
					.onChange(async (value) => {
						this.plugin.settings.ollamaUrl = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Embedding model")
			.setDesc("Ollama model for generating embeddings")
			.addText((text) =>
				text
					.setPlaceholder("nomic-embed-text")
					.setValue(this.plugin.settings.embedModel)
					.onChange(async (value) => {
						this.plugin.settings.embedModel = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Chat model")
			.setDesc("Ollama model for chat/generation")
			.addText((text) =>
				text
					.setPlaceholder("llama3.1:8b")
					.setValue(this.plugin.settings.chatModel)
					.onChange(async (value) => {
						this.plugin.settings.chatModel = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Embedding dimensions")
			.setDesc("Vector dimensions for the embedding model")
			.addText((text) =>
				text
					.setPlaceholder("768")
					.setValue(String(this.plugin.settings.embedDimensions))
					.onChange(async (value) => {
						const n = parseInt(value);
						if (!isNaN(n) && n > 0) {
							this.plugin.settings.embedDimensions = n;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Check if Ollama is reachable")
			.addButton((btn) =>
				btn.setButtonText("Test").onClick(async () => {
					const client = new OllamaClient(
						this.plugin.settings.ollamaUrl,
						this.plugin.settings.embedModel,
						this.plugin.settings.chatModel
					);
					const ok = await client.isAvailable();
					new Notice(
						ok
							? "Ollama is connected and available."
							: "Cannot reach Ollama. Is it running?"
					);
				})
			);

		// --- Vault Folders ---
		containerEl.createEl("h3", { text: "Vault Folders" });

		containerEl.createEl("p", {
			text: "Configure which folders to embed. Leave empty to embed the entire vault. Per-folder overrides inherit from the global parsing defaults below.",
			cls: "setting-item-description",
		});

		const folderListEl = containerEl.createDiv("pkm-folder-list");
		this.renderFolderList(folderListEl);

		new Setting(containerEl)
			.addButton((btn) =>
				btn.setButtonText("+ Add folder").onClick(async () => {
					this.plugin.settings.folderConfigs.push({ folder: "" });
					await this.plugin.saveSettings();
					folderListEl.empty();
					this.renderFolderList(folderListEl);
				})
			);

		new Setting(containerEl)
			.setName("Excluded folders")
			.setDesc("Comma-separated folder paths to exclude")
			.addText((text) =>
				text
					.setPlaceholder(".obsidian, .trash")
					.setValue(this.plugin.settings.excludedFolders)
					.onChange(async (value) => {
						this.plugin.settings.excludedFolders = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Embeddings folder path")
			.setDesc("Folder to store the embeddings database (relative to vault root)")
			.addText((text) =>
				text
					.setPlaceholder(".pkm-embeddings")
					.setValue(this.plugin.settings.embeddingsFolderPath)
					.onChange(async (value) => {
						this.plugin.settings.embeddingsFolderPath = value || ".pkm-embeddings";
						await this.plugin.saveSettings();
					})
			);

		// --- Parsing (Global Defaults) ---
		containerEl.createEl("h3", { text: "Parsing (Global Defaults)" });

		containerEl.createEl("p", {
			text: "These settings are used for all files unless overridden by a per-folder configuration above.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Content mode")
			.setDesc(
				"'Section' extracts only the configured header section. 'Full' embeds entire note content."
			)
			.addDropdown((dd) =>
				dd
					.addOption("section", "Section only")
					.addOption("full", "Full content")
					.setValue(this.plugin.settings.contentMode)
					.onChange(async (value) => {
						this.plugin.settings.contentMode = value as
							| "section"
							| "full";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Section header name")
			.setDesc(
				"Heading text to extract content from (only used in Section mode)"
			)
			.addText((text) =>
				text
					.setPlaceholder("Notes")
					.setValue(this.plugin.settings.noteSectionHeaderName)
					.onChange(async (value) => {
						this.plugin.settings.noteSectionHeaderName = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Section header level")
			.setDesc(
				"Heading level to match (e.g. 2 = ##, 3 = ###)"
			)
			.addDropdown((dd) =>
				dd
					.addOption("1", "H1 (#)")
					.addOption("2", "H2 (##)")
					.addOption("3", "H3 (###)")
					.addOption("4", "H4 (####)")
					.addOption("5", "H5 (#####)")
					.addOption("6", "H6 (######)")
					.setValue(String(this.plugin.settings.noteSectionHeaderLevel))
					.onChange(async (value) => {
						this.plugin.settings.noteSectionHeaderLevel = parseInt(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Required frontmatter key")
			.setDesc("Notes without this frontmatter key are skipped")
			.addText((text) =>
				text
					.setPlaceholder("UUID")
					.setValue(this.plugin.settings.requiredFrontmatterKey)
					.onChange(async (value) => {
						this.plugin.settings.requiredFrontmatterKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Modified field key")
			.setDesc("Frontmatter key used for change detection")
			.addText((text) =>
				text
					.setPlaceholder("Modified")
					.setValue(this.plugin.settings.modifiedFrontmatterKey)
					.onChange(async (value) => {
						this.plugin.settings.modifiedFrontmatterKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Description field key")
			.setDesc(
				"Frontmatter key for the note description (prepended to chunks)"
			)
			.addText((text) =>
				text
					.setPlaceholder("Description")
					.setValue(this.plugin.settings.descriptionFrontmatterKey)
					.onChange(async (value) => {
						this.plugin.settings.descriptionFrontmatterKey = value;
						await this.plugin.saveSettings();
					})
			);

		// --- Chunking ---
		containerEl.createEl("h3", { text: "Chunking" });

		new Setting(containerEl)
			.setName("Chunk size")
			.setDesc("Maximum characters per chunk (200-2000)")
			.addSlider((slider) =>
				slider
					.setLimits(200, 2000, 100)
					.setValue(this.plugin.settings.chunkSize)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.chunkSize = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Chunk overlap")
			.setDesc("Character overlap between chunks (0-500)")
			.addSlider((slider) =>
				slider
					.setLimits(0, 500, 50)
					.setValue(this.plugin.settings.chunkOverlap)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.chunkOverlap = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Minimum chunk length")
			.setDesc("Chunks shorter than this are discarded (10-200)")
			.addSlider((slider) =>
				slider
					.setLimits(10, 200, 10)
					.setValue(this.plugin.settings.minChunkLength)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.minChunkLength = value;
						await this.plugin.saveSettings();
					})
			);

		// --- Retrieval ---
		containerEl.createEl("h3", { text: "Retrieval" });

		new Setting(containerEl)
			.setName("Top K (Ask mode)")
			.setDesc("Number of chunks retrieved for Q&A (1-20)")
			.addSlider((slider) =>
				slider
					.setLimits(1, 20, 1)
					.setValue(this.plugin.settings.topK)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.topK = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Top K (Related notes)")
			.setDesc("Number of similar notes to show (1-30)")
			.addSlider((slider) =>
				slider
					.setLimits(1, 30, 1)
					.setValue(this.plugin.settings.similarTopK)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.similarTopK = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Top K (Gap analysis)")
			.setDesc("Number of chunks for gap analysis (1-30)")
			.addSlider((slider) =>
				slider
					.setLimits(1, 30, 1)
					.setValue(this.plugin.settings.gapAnalysisTopK)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.gapAnalysisTopK = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Similarity threshold")
			.setDesc(
				"Minimum similarity score to include results (0.0-1.0)"
			)
			.addSlider((slider) =>
				slider
					.setLimits(0, 100, 5)
					.setValue(
						Math.round(
							this.plugin.settings.similarityThreshold * 100
						)
					)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.similarityThreshold = value / 100;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Enable query rewrite")
			.setDesc(
				"Expand queries with related terms for broader retrieval (may reduce precision)"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableQueryRewrite)
					.onChange(async (value) => {
						this.plugin.settings.enableQueryRewrite = value;
						await this.plugin.saveSettings();
					})
			);

		// --- Auto-embedding ---
		containerEl.createEl("h3", { text: "Auto-embedding" });

		new Setting(containerEl)
			.setName("Enable auto-embedding")
			.setDesc("Automatically embed notes when they are modified")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableAutoEmbed)
					.onChange(async (value) => {
						this.plugin.settings.enableAutoEmbed = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto-embed debounce time")
			.setDesc(
				"Seconds to wait after a note is modified before embedding (1-60 seconds)"
			)
			.addSlider((slider) =>
				slider
					.setLimits(1, 60, 1)
					.setValue(this.plugin.settings.autoEmbedDebounceSeconds)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.autoEmbedDebounceSeconds = value;
						await this.plugin.saveSettings();
					})
			);

		// --- UI ---
		containerEl.createEl("h3", { text: "UI" });

		new Setting(containerEl)
			.setName("Filter linked notes by default")
			.setDesc(
				"Exclude already-linked notes from Related Notes results by default"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.filterLinkedByDefault)
					.onChange(async (value) => {
						this.plugin.settings.filterLinkedByDefault = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Enable streaming")
			.setDesc("Stream chat responses token by token")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableStreaming)
					.onChange(async (value) => {
						this.plugin.settings.enableStreaming = value;
						await this.plugin.saveSettings();
					})
			);

		// --- Actions ---
		containerEl.createEl("h3", { text: "Actions" });

		new Setting(containerEl)
			.setName("Embed vault")
			.setDesc("Run incremental embedding of all configured folders")
			.addButton((btn) =>
				btn
					.setButtonText("Embed Vault")
					.setCta()
					.onClick(async () => {
						await this.plugin.embedVault(false);
					})
			);

		new Setting(containerEl)
			.setName("Force re-embed")
			.setDesc(
				"Clear all embeddings and re-embed from scratch. Use after changing model or chunk settings."
			)
			.addButton((btn) =>
				btn
					.setButtonText("Force Re-embed")
					.setWarning()
					.onClick(async () => {
						await this.plugin.embedVault(true);
					})
			);

		// Stats display
		const statsEl = containerEl.createDiv("pkm-rag-stats");
		const totalChunks = this.plugin.vectorStore?.totalChunks ?? 0;
		const totalNotes = this.plugin.vectorStore?.totalNotes ?? 0;
		statsEl.createEl("p", {
			text: `Embedded: ${totalNotes} notes, ${totalChunks} chunks`,
			cls: "setting-item-description",
		});
	}

	private renderFolderList(containerEl: HTMLElement): void {
		const configs = this.plugin.settings.folderConfigs;

		if (configs.length === 0) {
			containerEl.createEl("p", {
				text: "No folders configured. Entire vault will be embedded.",
				cls: "setting-item-description",
			});
			return;
		}

		for (let i = 0; i < configs.length; i++) {
			const config = configs[i];
			const groupEl = containerEl.createDiv("pkm-folder-config-group");
			groupEl.style.border = "1px solid var(--background-modifier-border)";
			groupEl.style.borderRadius = "8px";
			groupEl.style.padding = "8px 12px";
			groupEl.style.marginBottom = "8px";

			new Setting(groupEl)
				.setName(`Folder ${i + 1}`)
				.addText((text) =>
					text
						.setPlaceholder("e.g. Content/Notes")
						.setValue(config.folder)
						.onChange(async (value) => {
							config.folder = value.trim().replace(/\/+$/, "");
							await this.plugin.saveSettings();
						})
				)
				.addExtraButton((btn) =>
					btn
						.setIcon("x")
						.setTooltip("Remove folder")
						.onClick(async () => {
							this.plugin.settings.folderConfigs.splice(i, 1);
							await this.plugin.saveSettings();
							containerEl.empty();
							this.renderFolderList(containerEl);
						})
				);

			new Setting(groupEl)
				.setName("Content mode")
				.addDropdown((dd) =>
					dd
						.addOption("", "Use default")
						.addOption("section", "Section only")
						.addOption("full", "Full content")
						.setValue(config.contentMode ?? "")
						.onChange(async (value) => {
							config.contentMode = value === ""
								? undefined
								: (value as "section" | "full");
							await this.plugin.saveSettings();
						})
				);

			new Setting(groupEl)
				.setName("Section header name")
				.addText((text) =>
					text
						.setPlaceholder("(use default)")
						.setValue(config.noteSectionHeaderName ?? "")
						.onChange(async (value) => {
							config.noteSectionHeaderName = value.trim() || undefined;
							await this.plugin.saveSettings();
						})
				);

			new Setting(groupEl)
				.setName("Section header level")
				.addDropdown((dd) =>
					dd
						.addOption("", "Use default")
						.addOption("1", "H1 (#)")
						.addOption("2", "H2 (##)")
						.addOption("3", "H3 (###)")
						.addOption("4", "H4 (####)")
						.addOption("5", "H5 (#####)")
						.addOption("6", "H6 (######)")
						.setValue(
							config.noteSectionHeaderLevel != null
								? String(config.noteSectionHeaderLevel)
								: ""
						)
						.onChange(async (value) => {
							config.noteSectionHeaderLevel = value === ""
								? undefined
								: parseInt(value);
							await this.plugin.saveSettings();
						})
				);
		}
	}
}

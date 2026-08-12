import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type PkmRagPlugin from "./main";
import { OllamaChatClient } from "./ollama/chatClient";
import { TOOLS } from "./cli/toolRegistry";
import { detectBinary } from "./cli/binaryResolver";
import { DetectResult, FlagSpec, ToolId } from "./cli/types";
import { SetupWizardModal } from "./views/setupWizardModal";
import { getSearchFlags } from "./cli/searchFlags";

export class PkmRagSettingTab extends PluginSettingTab {
	plugin: PkmRagPlugin;

	constructor(app: App, plugin: PkmRagPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** Helper for the common text-input setting pattern. */
	private addTextSetting(
		container: HTMLElement,
		name: string,
		desc: string,
		placeholder: string,
		getValue: () => string,
		setValue: (v: string) => void
	): Setting {
		return new Setting(container)
			.setName(name)
			.setDesc(desc)
			.addText((text) =>
				text
					.setPlaceholder(placeholder)
					.setValue(getValue())
					.onChange(async (value) => {
						setValue(value);
						await this.plugin.saveSettings();
					})
			);
	}

	private describeStatus(result: DetectResult): string {
		switch (result.status) {
			case "healthy":
				return "Detected";
			case "unhealthy":
				return `Not responding${result.message ? ` (${result.message})` : ""}`;
			case "not-found":
				return "Not found";
		}
	}

	/** Renders one tool's status badge, path override field, and a "Test" button. */
	private renderToolSetting(containerEl: HTMLElement, id: ToolId): void {
		const tool = TOOLS[id];
		const wrapper = containerEl.createDiv({ cls: "pkm-rag-tool-setting" });

		const statusEl = wrapper.createDiv({ cls: "pkm-rag-tool-status" });
		statusEl.setText("Status: unknown");

		this.addTextSetting(
			wrapper,
			tool.displayName,
			`Path to the ${tool.binaryName} binary (leave blank to auto-detect)`,
			"(auto-detected)",
			() => this.plugin.settings.toolPaths[id] ?? "",
			(v) => {
				this.plugin.settings.toolPaths[id] = v;
			}
		);

		new Setting(wrapper)
			.setName(`Test ${tool.binaryName} connection`)
			.setDesc(`Check if ${tool.binaryName} is reachable`)
			.addButton((btn) =>
				btn.setButtonText("Test").onClick(async () => {
					const result = await detectBinary(
						tool.binaryName,
						tool.healthCheckCommand,
						this.plugin.settings.toolPaths[id] || undefined
					);
					const label = this.describeStatus(result);
					statusEl.setText(`Status: ${label}`);
					new Notice(`${tool.displayName}: ${label}`);
				})
			)
			.addButton((btn) =>
				btn.setButtonText("Setup wizard").onClick(() => {
					new SetupWizardModal(this.app, this.plugin).open();
				})
			);
	}

	/** Whether the user has explicitly configured an override for this flag (as opposed to
	 *  just seeing the tool's own schema default displayed). */
	private hasFlagOverride(id: ToolId, flag: FlagSpec): boolean {
		return this.plugin.settings.toolFlagDefaults[id]?.[flag.flag] !== undefined;
	}

	/** What to show in the field: the user's override if set, otherwise the command
	 *  schema's own default (so the field always displays a real value, not a blank
	 *  with a ghost placeholder) — falls back to "" only when neither exists. */
	private getFlagDisplayValue(id: ToolId, flag: FlagSpec): string {
		const override = this.plugin.settings.toolFlagDefaults[id]?.[flag.flag];
		if (override !== undefined) return override;
		return flag.default !== undefined ? String(flag.default) : "";
	}

	private async setFlagDefault(id: ToolId, flag: FlagSpec, value: string): Promise<void> {
		if (!this.plugin.settings.toolFlagDefaults[id]) this.plugin.settings.toolFlagDefaults[id] = {};
		if (value === "") {
			delete this.plugin.settings.toolFlagDefaults[id][flag.flag];
		} else {
			this.plugin.settings.toolFlagDefaults[id][flag.flag] = value;
		}
		await this.plugin.saveSettings();
	}

	/** Type-aware field for one search flag's default: toggle for booleans, dropdown for
	 *  enums, text otherwise. Pre-filled with the tool's own schema default so the field
	 *  shows a real value; only writes to settings once the user actually changes it, so
	 *  an untouched field keeps tracking the tool's default rather than freezing it. */
	private renderSearchDefaultField(container: HTMLElement, id: ToolId, flag: FlagSpec): void {
		const display = this.getFlagDisplayValue(id, flag);
		const setting = new Setting(container).setName(flag.label).setDesc(flag.description ?? flag.flag);
		if (this.hasFlagOverride(id, flag)) {
			setting.setDesc(`${flag.description ?? flag.flag} (overridden)`);
		}

		if (flag.type === "boolean") {
			setting.addToggle((toggle) =>
				toggle.setValue(display === "true").onChange((v) => this.setFlagDefault(id, flag, v ? "true" : ""))
			);
			return;
		}

		if (flag.type === "enum" && flag.enumValues) {
			setting.addDropdown((dd) => {
				dd.addOption("", flag.default !== undefined ? `(default: ${flag.default})` : "(none)");
				for (const v of flag.enumValues as string[]) dd.addOption(v, v);
				dd.setValue(display);
				dd.onChange((v) => this.setFlagDefault(id, flag, v));
			});
			return;
		}

		setting.addText((text) =>
			text.setValue(display).onChange((v) => this.setFlagDefault(id, flag, v.trim()))
		);
	}

	/** One collapsed-by-default section per tool listing every unique flag across its
	 *  search commands, so users can pre-fill values they'd otherwise retype every run. */
	private renderSearchDefaultsForTool(containerEl: HTMLElement, id: ToolId): void {
		const tool = TOOLS[id];
		const flags = getSearchFlags(tool.schema);
		if (flags.length === 0) return;

		const details = containerEl.createEl("details", { cls: "pkm-rag-search-defaults" });
		details.createEl("summary", { text: `${tool.displayName} (${flags.length} parameters)` });
		const body = details.createDiv();
		for (const flag of flags) {
			this.renderSearchDefaultField(body, id, flag);
		}
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// --- Tools ---
		containerEl.createEl("h3", { text: "Tools" });
		containerEl.createEl("p", {
			text: "qmd, qimg, qnode, and qvoid are separate CLI tools this plugin drives. Leave a path blank to auto-detect it.",
			cls: "setting-item-description",
		});

		for (const id of Object.keys(TOOLS) as ToolId[]) {
			this.renderToolSetting(containerEl, id);
		}

		containerEl.createEl("h4", { text: "QMD (RAG chat)" });
		this.addTextSetting(containerEl, "Default collection", "QMD collection to search by default (leave empty for all)",
			"",
			() => this.plugin.settings.defaultCollection,
			(v) => { this.plugin.settings.defaultCollection = v; });

		// --- Search Parameter Defaults ---
		containerEl.createEl("h3", { text: "Search Parameter Defaults" });
		containerEl.createEl("p", {
			text: "Pre-fill these values in the CLI console's search forms instead of leaving them empty. Leave a field blank to use the command's own default.",
			cls: "setting-item-description",
		});

		for (const id of Object.keys(TOOLS) as ToolId[]) {
			this.renderSearchDefaultsForTool(containerEl, id);
		}

		// --- Ollama Connection ---
		containerEl.createEl("h3", { text: "Ollama (Chat)" });

		this.addTextSetting(containerEl, "Ollama URL", "Base URL for the local Ollama instance",
			"http://localhost:11434",
			() => this.plugin.settings.ollamaUrl,
			(v) => { this.plugin.settings.ollamaUrl = v; });

		this.addTextSetting(containerEl, "Chat model", "Ollama model for chat/generation",
			"llama3.1:8b",
			() => this.plugin.settings.chatModel,
			(v) => { this.plugin.settings.chatModel = v; });

		new Setting(containerEl)
			.setName("Test Ollama connection")
			.setDesc("Check if Ollama is reachable")
			.addButton((btn) =>
				btn.setButtonText("Test").onClick(async () => {
					const client = new OllamaChatClient(
						this.plugin.settings.ollamaUrl,
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

		// --- Parsing (for section extraction) ---
		containerEl.createEl("h3", { text: "Section Extraction" });

		containerEl.createEl("p", {
			text: "Controls which part of notes is used as context for the LLM. QMD finds relevant documents; these settings control what content is extracted from each result.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Content mode")
			.setDesc(
				"'Section' extracts only the configured header section. 'Full' uses entire note content."
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

		this.addTextSetting(containerEl, "Section header name",
			"Heading text to extract content from (only used in Section mode)",
			"Notes",
			() => this.plugin.settings.noteSectionHeaderName,
			(v) => { this.plugin.settings.noteSectionHeaderName = v; });

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

		this.addTextSetting(containerEl, "Description field key",
			"Frontmatter key for the note description",
			"Description",
			() => this.plugin.settings.descriptionFrontmatterKey,
			(v) => { this.plugin.settings.descriptionFrontmatterKey = v; });

		// Per-folder overrides
		containerEl.createEl("h3", { text: "Per-Folder Overrides" });

		containerEl.createEl("p", {
			text: "Override section extraction settings for specific folders.",
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

		// --- Retrieval ---
		containerEl.createEl("h3", { text: "Retrieval" });

		new Setting(containerEl)
			.setName("Top K (Explore mode)")
			.setDesc("Number of results retrieved for Q&A (1-20)")
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
			.setDesc("Number of results for gap analysis (1-30)")
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
				"Minimum score to include results (0.0-1.0)"
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
	}

	private renderFolderList(containerEl: HTMLElement): void {
		const configs = this.plugin.settings.folderConfigs;

		if (configs.length === 0) {
			containerEl.createEl("p", {
				text: "No per-folder overrides configured.",
				cls: "setting-item-description",
			});
			return;
		}

		for (let i = 0; i < configs.length; i++) {
			const config = configs[i];
			const groupEl = containerEl.createDiv("pkm-folder-config-group pkm-rag-folder-group");

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

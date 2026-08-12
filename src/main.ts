import { Notice, Plugin } from "obsidian";
import { PkmRagSettings, DEFAULT_SETTINGS, migrateLegacySettings } from "./settings";
import { PkmRagSettingTab } from "./settingsTab";
import { QmdClient } from "./cli/tools/qmdClient";
import { OllamaChatClient } from "./ollama/chatClient";
import { RelatedNotesView, RELATED_NOTES_VIEW_TYPE } from "./views/relatedNotesView";
import { ChatView, CHAT_VIEW_TYPE } from "./views/chatView";
import { SetupWizardModal } from "./views/setupWizardModal";
import { CliConsoleView, CLI_CONSOLE_VIEW_TYPE, CLI_CONSOLE_HOVER_SOURCE } from "./views/cliConsoleView";
import { TOOLS } from "./cli/toolRegistry";
import { detectBinary } from "./cli/binaryResolver";
import { DetectResult, ToolId } from "./cli/types";

export default class PkmRagPlugin extends Plugin {
	settings: PkmRagSettings = DEFAULT_SETTINGS;
	qmdClient: QmdClient = new QmdClient(DEFAULT_SETTINGS.toolPaths.qmd);
	ollamaClient: OllamaChatClient = new OllamaChatClient(
		DEFAULT_SETTINGS.ollamaUrl,
		DEFAULT_SETTINGS.chatModel
	);
	/** In-memory (not persisted) last-known status per tool, read by settings tab / console. */
	toolStatus: Partial<Record<ToolId, DetectResult>> = {};

	async onload() {
		await this.loadSettings();
		this.qmdClient = new QmdClient(this.settings.toolPaths.qmd);
		this.ollamaClient = new OllamaChatClient(
			this.settings.ollamaUrl,
			this.settings.chatModel
		);

		// Non-blocking detection pass across all 4 tools.
		void this.detectAllTools();

		// Register views
		this.registerView(RELATED_NOTES_VIEW_TYPE, (leaf) => new RelatedNotesView(leaf, this));
		this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
		this.registerView(CLI_CONSOLE_VIEW_TYPE, (leaf) => new CliConsoleView(leaf, this));
		this.registerHoverLinkSource(CLI_CONSOLE_HOVER_SOURCE, {
			display: "PKM RAG CLI Console",
			defaultMod: false,
		});

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
			id: "open-setup-wizard",
			name: "Open PKM tools setup wizard",
			callback: () => new SetupWizardModal(this.app, this).open(),
		});

		this.addCommand({
			id: "open-cli-console",
			name: "Open CLI console",
			callback: () => this.activateView(CLI_CONSOLE_VIEW_TYPE),
		});

		// Auto-update related notes on active leaf change
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.refreshRelatedNotesView();
			})
		);

		if (!this.settings.setupWizardShown) {
			this.settings.setupWizardShown = true;
			await this.saveSettings();
			new SetupWizardModal(this.app, this).open();
		} else {
			const qmdAvailable = await this.qmdClient.isAvailable();
			if (!qmdAvailable) {
				new Notice("QMD is not available. Please install QMD and configure the path in settings.");
			}
		}
	}

	private async detectAllTools(): Promise<void> {
		await Promise.all(
			(Object.keys(TOOLS) as ToolId[]).map(async (id) => {
				const tool = TOOLS[id];
				this.toolStatus[id] = await detectBinary(
					tool.binaryName,
					tool.healthCheckCommand,
					this.settings.toolPaths[id] || undefined
				);
			})
		);
	}

	async loadSettings() {
		const loaded = await this.loadData();
		this.settings = migrateLegacySettings(Object.assign({}, DEFAULT_SETTINGS, loaded));
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.qmdClient.updatePath(this.settings.toolPaths.qmd);
		this.ollamaClient = new OllamaChatClient(
			this.settings.ollamaUrl,
			this.settings.chatModel
		);
	}

	private async activateView(viewType: string) {
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

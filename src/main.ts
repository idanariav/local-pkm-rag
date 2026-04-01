import { Notice, Plugin } from "obsidian";
import { PkmRagSettings, DEFAULT_SETTINGS } from "./settings";
import { PkmRagSettingTab } from "./settingsTab";
import { QmdClient } from "./qmd/qmdClient";
import { OllamaChatClient } from "./ollama/chatClient";
import { RelatedNotesView, RELATED_NOTES_VIEW_TYPE } from "./views/relatedNotesView";
import { ChatView, CHAT_VIEW_TYPE } from "./views/chatView";

export default class PkmRagPlugin extends Plugin {
	settings: PkmRagSettings = DEFAULT_SETTINGS;
	qmdClient: QmdClient = new QmdClient(DEFAULT_SETTINGS.qmdPath);
	ollamaClient: OllamaChatClient = new OllamaChatClient(
		DEFAULT_SETTINGS.ollamaUrl,
		DEFAULT_SETTINGS.chatModel
	);

	async onload() {
		await this.loadSettings();
		this.qmdClient = new QmdClient(this.settings.qmdPath);
		this.ollamaClient = new OllamaChatClient(
			this.settings.ollamaUrl,
			this.settings.chatModel
		);

		// Check QMD availability
		const qmdAvailable = await this.qmdClient.isAvailable();
		if (!qmdAvailable) {
			new Notice("QMD is not available. Please install QMD and configure the path in settings.");
		}

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

		// Auto-update related notes on active leaf change
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.refreshRelatedNotesView();
			})
		);
	}

	async loadSettings() {
		const loaded = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.qmdClient.updatePath(this.settings.qmdPath);
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

import { App, Modal, Notice } from "obsidian";
import type PkmRagPlugin from "../main";
import { TOOLS } from "../cli/toolRegistry";
import { detectBinary } from "../cli/binaryResolver";
import { buildAugmentedEnv } from "../cli/pathResolver";
import { CliRunner, StreamingHandle } from "../cli/processRunner";
import { GenericCliClient, StreamingCommandHandle } from "../cli/genericClient";
import { DetectResult, ToolId } from "../cli/types";

const NODE_URL = "https://nodejs.org/";
const NVM_URL = "https://github.com/nvm-sh/nvm";
const HOMEBREW_URL = "https://brew.sh/";

interface ToolCard {
	statusEl: HTMLElement;
	installBtn: HTMLButtonElement;
	updateBtn: HTMLButtonElement;
	cancelBtn: HTMLButtonElement;
	logEl: HTMLElement;
}

/** Dashboard of 4 independent tool cards (no install-order dependency between them),
 *  plus a Node/npm prerequisite check. Detects, installs via streaming `npm install -g`,
 *  and re-verifies each of qmd/qimg/qnode/qvoid. */
export class SetupWizardModal extends Modal {
	private readonly plugin: PkmRagPlugin;
	private readonly runner = new CliRunner();
	private nodeAvailable = false;
	private readonly cards: Partial<Record<ToolId, ToolCard>> = {};
	private readonly activeInstalls: Partial<Record<ToolId, StreamingHandle>> = {};
	private readonly activeUpdates: Partial<Record<ToolId, StreamingCommandHandle>> = {};
	private readonly clients: Partial<Record<ToolId, GenericCliClient>> = {};

	constructor(app: App, plugin: PkmRagPlugin) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pkm-rag-wizard");

		contentEl.createEl("h2", { text: "PKM tools setup" });
		contentEl.createEl("p", {
			text: "Detect and install qmd, qimg, qnode, and qvoid — the CLI tools this plugin drives.",
			cls: "setting-item-description",
		});

		const prereqEl = contentEl.createDiv({ cls: "pkm-rag-wizard-prereq" });
		prereqEl.setText("Checking for Node.js / npm...");

		const cardsEl = contentEl.createDiv({ cls: "pkm-rag-wizard-cards" });
		for (const id of Object.keys(TOOLS) as ToolId[]) {
			this.renderCard(cardsEl, id);
		}

		const actionsEl = contentEl.createDiv({ cls: "pkm-rag-wizard-footer" });
		const recheckBtn = actionsEl.createEl("button", { text: "Re-check all" });
		recheckBtn.addEventListener("click", () => this.refreshAll());

		await this.checkPrereqs(prereqEl);
		await this.refreshAll();
	}

	onClose(): void {
		for (const handle of Object.values(this.activeInstalls)) {
			handle?.kill();
		}
		for (const handle of Object.values(this.activeUpdates)) {
			handle?.kill();
		}
		this.contentEl.empty();
	}

	private getClient(id: ToolId): GenericCliClient {
		const tool = TOOLS[id];
		let client = this.clients[id];
		if (!client) {
			client = new GenericCliClient(
				tool.binaryName,
				tool.healthCheckCommand,
				tool.schema,
				this.plugin.settings.toolPaths[id] || undefined,
				this.plugin.settings.commandTimeoutMs
			);
			this.clients[id] = client;
		} else {
			client.updatePath(this.plugin.settings.toolPaths[id] || undefined);
		}
		return client;
	}

	private async checkPrereqs(prereqEl: HTMLElement): Promise<void> {
		const [node, npm] = await Promise.all([
			detectBinary("node", ["--version"]),
			detectBinary("npm", ["--version"]),
		]);
		this.nodeAvailable = node.status === "healthy" && npm.status === "healthy";

		prereqEl.empty();
		if (this.nodeAvailable) {
			prereqEl.createEl("p", { text: "Node.js and npm are available.", cls: "pkm-rag-wizard-ok" });
			return;
		}

		prereqEl.addClass("pkm-rag-wizard-warning");
		prereqEl.createEl("p", {
			text: "Node.js/npm weren't found, so tools can't be installed automatically. Install one of the following, then reopen this wizard:",
		});
		const list = prereqEl.createEl("ul");
		this.addLink(list, "Node.js (nodejs.org)", NODE_URL);
		this.addLink(list, "nvm (Node version manager)", NVM_URL);
		this.addLink(list, "Homebrew (brew install node)", HOMEBREW_URL);

		for (const card of Object.values(this.cards)) {
			if (card) card.installBtn.disabled = true;
		}
	}

	private addLink(list: HTMLElement, text: string, url: string): void {
		const item = list.createEl("li");
		item.createEl("a", { text, href: url, attr: { target: "_blank", rel: "noopener" } });
	}

	private renderCard(container: HTMLElement, id: ToolId): void {
		const tool = TOOLS[id];
		const card = container.createDiv({ cls: "pkm-rag-wizard-card" });
		card.createEl("h3", { text: tool.displayName });
		card.createEl("p", { text: tool.npmPackage, cls: "setting-item-description" });

		const statusEl = card.createDiv({ cls: "pkm-rag-wizard-status" });
		statusEl.setText("Checking...");

		const actionsEl = card.createDiv({ cls: "pkm-rag-wizard-card-actions" });
		const installBtn = actionsEl.createEl("button", { text: "Install" });
		const updateBtn = actionsEl.createEl("button", { text: "Update" });
		const cancelBtn = actionsEl.createEl("button", { text: "Cancel" });
		cancelBtn.addClass("pkm-rag-hidden");

		const logEl = card.createEl("pre", { cls: "pkm-rag-wizard-log pkm-rag-hidden" });

		installBtn.addEventListener("click", () => this.installTool(id));
		updateBtn.addEventListener("click", () => this.updateTool(id));
		cancelBtn.addEventListener("click", () => {
			this.activeInstalls[id]?.kill();
			this.activeUpdates[id]?.kill();
		});

		this.cards[id] = { statusEl, installBtn, updateBtn, cancelBtn, logEl };
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

	private async refreshAll(): Promise<void> {
		await Promise.all((Object.keys(TOOLS) as ToolId[]).map((id) => this.refreshStatus(id)));
	}

	private async refreshStatus(id: ToolId): Promise<void> {
		const card = this.cards[id];
		if (!card) return;
		const tool = TOOLS[id];
		const result = await detectBinary(tool.binaryName, tool.healthCheckCommand, this.plugin.settings.toolPaths[id] || undefined);

		card.statusEl.setText(this.describeStatus(result));
		card.statusEl.className = `pkm-rag-wizard-status pkm-rag-wizard-status-${result.status}`;
		card.installBtn.setText(result.status === "healthy" ? "Reinstall" : "Install");
		card.installBtn.disabled = !this.nodeAvailable;
		card.updateBtn.disabled = result.status !== "healthy";

		if (result.status === "healthy" && result.resolvedPath && !this.plugin.settings.toolPaths[id]) {
			this.plugin.settings.toolPaths[id] = result.resolvedPath;
			await this.plugin.saveSettings();
		}
	}

	private async installTool(id: ToolId): Promise<void> {
		const card = this.cards[id];
		if (!card || this.activeInstalls[id] || this.activeUpdates[id]) return;
		const tool = TOOLS[id];

		card.installBtn.disabled = true;
		card.updateBtn.disabled = true;
		card.cancelBtn.removeClass("pkm-rag-hidden");
		card.logEl.removeClass("pkm-rag-hidden");
		card.logEl.setText("");
		card.statusEl.setText("Installing...");
		card.statusEl.className = "pkm-rag-wizard-status pkm-rag-wizard-status-installing";

		const env = await buildAugmentedEnv();
		const append = (chunk: string) => {
			card.logEl.setText(card.logEl.getText() + chunk);
			card.logEl.scrollTop = card.logEl.scrollHeight;
		};

		const handle = this.runner.runStreaming("npm", ["install", "-g", tool.npmPackage], {
			env,
			onStdout: append,
			onStderr: append,
		});
		this.activeInstalls[id] = handle;

		try {
			const { code } = await handle.promise;
			if (code !== 0) {
				new Notice(`${tool.displayName} install failed (exit ${code}). See the log for details.`);
			}
		} catch (error) {
			append(`\n[cancelled or failed: ${(error as Error).message}]\n`);
		} finally {
			delete this.activeInstalls[id];
			card.cancelBtn.addClass("pkm-rag-hidden");
			card.installBtn.disabled = !this.nodeAvailable;
			await this.refreshStatus(id);
		}
	}

	/** Runs this tool's configured update sequence (Settings → Update Command Sequences)
	 *  one command at a time, stopping at the first non-zero exit code. */
	private async updateTool(id: ToolId): Promise<void> {
		const card = this.cards[id];
		if (!card || this.activeInstalls[id] || this.activeUpdates[id]) return;
		const tool = TOOLS[id];
		const commandIds = this.plugin.settings.toolUpdateCommands[id] ?? [];
		if (commandIds.length === 0) {
			new Notice(`No update commands configured for ${tool.displayName}.`);
			return;
		}

		card.installBtn.disabled = true;
		card.updateBtn.disabled = true;
		card.cancelBtn.removeClass("pkm-rag-hidden");
		card.logEl.removeClass("pkm-rag-hidden");
		card.logEl.setText("");
		card.statusEl.setText("Updating...");
		card.statusEl.className = "pkm-rag-wizard-status pkm-rag-wizard-status-installing";

		const client = this.getClient(id);
		const append = (chunk: string) => {
			card.logEl.setText(card.logEl.getText() + chunk);
			card.logEl.scrollTop = card.logEl.scrollHeight;
		};

		try {
			for (const commandId of commandIds) {
				append(`\n$ ${tool.binaryName} ${commandId}\n`);
				const handle = await client.runCommandStreaming(commandId, {}, append, append);
				this.activeUpdates[id] = handle;
				const result = await handle.done;
				delete this.activeUpdates[id];
				if (result.code !== 0) {
					new Notice(`${tool.displayName} update failed at "${commandId}" (exit ${result.code}). See the log for details.`);
					return;
				}
			}
			new Notice(`${tool.displayName} updated.`);
		} catch (error) {
			append(`\n[cancelled or failed: ${(error as Error).message}]\n`);
		} finally {
			delete this.activeUpdates[id];
			card.cancelBtn.addClass("pkm-rag-hidden");
			card.installBtn.disabled = !this.nodeAvailable;
			await this.refreshStatus(id);
		}
	}
}

import { App, ItemView, WorkspaceLeaf, Setting, Notice, Modal } from "obsidian";
import type PkmRagPlugin from "../main";
import { TOOLS } from "../cli/toolRegistry";
import { GenericCliClient, JSON_OUTPUT_VALUE_KEY, CommandResult } from "../cli/genericClient";
import { CommandCategory, CommandNode, FlagSpec, PositionalArgSpec, ToolId } from "../cli/types";

const CATEGORY_TABS: { id: CommandCategory; label: string }[] = [
	{ id: "search", label: "Search" },
	{ id: "infra", label: "Setup / Infra" },
];

export const CLI_CONSOLE_VIEW_TYPE = "pkm-rag-cli-console";

class ConfirmRunModal extends Modal {
	constructor(app: App, private readonly message: string, private readonly onConfirm: () => void) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl("p", { text: this.message });
		const actions = this.contentEl.createDiv({ cls: "pkm-rag-console-confirm-actions" });
		actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		const confirmBtn = actions.createEl("button", { text: "Run", cls: "mod-warning" });
		confirmBtn.addEventListener("click", () => {
			this.close();
			this.onConfirm();
		});
	}
}

/** Schema-driven generic command console: pick a tool, pick a command, fill in a
 *  generated form, run it. The same plumbing (GenericCliClient + per-tool schema)
 *  works for all four tools; only qmd has a fully populated schema this round. */
export class CliConsoleView extends ItemView {
	private readonly plugin: PkmRagPlugin;
	private readonly clients: Partial<Record<ToolId, GenericCliClient>> = {};
	private currentTool: ToolId = "qmd";
	private currentCategory: CommandCategory = "search";
	private currentCommand: CommandNode | null = null;
	private values: Record<string, unknown> = {};
	private activeKill: (() => void) | null = null;

	private formEl!: HTMLElement;
	private outputEl!: HTMLElement;
	private runBtn!: HTMLButtonElement;
	private cancelBtn!: HTMLButtonElement;
	private commandListEl!: HTMLElement;
	private commandSearchEl!: HTMLInputElement;
	private categoryTabsEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: PkmRagPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return CLI_CONSOLE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "CLI console";
	}

	getIcon(): string {
		return "square-terminal";
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("pkm-rag-console");

		const header = container.createDiv({ cls: "pkm-rag-console-header" });
		const toolSelect = header.createEl("select", { cls: "pkm-rag-console-tool-select" });
		for (const id of Object.keys(TOOLS) as ToolId[]) {
			toolSelect.createEl("option", { value: id, text: TOOLS[id].displayName });
		}
		toolSelect.value = this.currentTool;
		toolSelect.addEventListener("change", () => {
			this.currentTool = toolSelect.value as ToolId;
			this.currentCategory = "search";
			this.currentCommand = null;
			this.values = {};
			this.renderCategoryTabs();
			this.renderCommandList();
			this.renderForm();
		});

		const body = container.createDiv({ cls: "pkm-rag-console-body" });

		const pickerEl = body.createDiv({ cls: "pkm-rag-console-picker" });
		this.categoryTabsEl = pickerEl.createDiv({ cls: "pkm-rag-console-category-tabs" });
		this.commandSearchEl = pickerEl.createEl("input", {
			type: "text",
			placeholder: "Search commands...",
			cls: "pkm-rag-note-search",
		});
		this.commandListEl = pickerEl.createDiv({ cls: "pkm-rag-console-command-list" });
		this.commandSearchEl.addEventListener("input", () => this.renderCommandList());

		this.formEl = body.createDiv({ cls: "pkm-rag-console-form" });

		const actionsEl = container.createDiv({ cls: "pkm-rag-console-actions" });
		this.runBtn = actionsEl.createEl("button", { text: "Run", cls: "mod-cta" });
		this.cancelBtn = actionsEl.createEl("button", { text: "Cancel", cls: "pkm-rag-hidden" });
		this.runBtn.addEventListener("click", () => this.handleRun());
		this.cancelBtn.addEventListener("click", () => this.activeKill?.());

		this.outputEl = container.createEl("pre", { cls: "pkm-rag-console-output" });

		this.renderCategoryTabs();
		this.renderCommandList();
		this.renderForm();
	}

	async onClose(): Promise<void> {
		this.activeKill?.();
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

	/** Segmented tabs splitting the rare, admin-y setup commands from the frequent search ones. */
	private renderCategoryTabs(): void {
		this.categoryTabsEl.empty();
		for (const tab of CATEGORY_TABS) {
			const btn = this.categoryTabsEl.createEl("button", {
				text: tab.label,
				cls: "pkm-rag-console-category-tab" + (this.currentCategory === tab.id ? " is-active" : ""),
			});
			btn.addEventListener("click", () => {
				if (this.currentCategory === tab.id) return;
				this.currentCategory = tab.id;
				this.currentCommand = null;
				this.values = {};
				this.renderCategoryTabs();
				this.renderCommandList();
				this.renderForm();
			});
		}
	}

	private renderCommandList(): void {
		this.commandListEl.empty();
		const client = this.getClient(this.currentTool);
		const filter = this.commandSearchEl.value.toLowerCase();
		const commands = client
			.listCommands()
			.filter((c) => c.category === this.currentCategory)
			.filter((c) => c.label.toLowerCase().includes(filter));

		if (commands.length === 0) {
			const tabLabel = CATEGORY_TABS.find((t) => t.id === this.currentCategory)?.label ?? this.currentCategory;
			this.commandListEl.createEl("p", {
				text: `No ${tabLabel} commands available yet for this tool.`,
				cls: "setting-item-description",
			});
			return;
		}

		for (const command of commands) {
			const selected = this.currentCommand?.id === command.id;
			const item = this.commandListEl.createDiv({
				cls: "pkm-rag-dropdown-item" + (selected ? " pkm-rag-console-command-selected" : ""),
				text: command.label,
			});
			item.addEventListener("click", () => {
				this.currentCommand = command;
				this.values = {};
				this.renderCommandList();
				this.renderForm();
			});
		}
	}

	private renderForm(): void {
		this.formEl.empty();
		this.outputEl.setText("");

		const command = this.currentCommand;
		if (!command) {
			this.formEl.createEl("p", {
				text: "Select a command to build its form.",
				cls: "setting-item-description",
			});
			return;
		}

		if (command.description) {
			this.formEl.createEl("p", { text: command.description, cls: "setting-item-description" });
		}

		for (const positional of command.positionals) {
			this.renderPositionalField(positional);
		}
		for (const flag of command.flags) {
			this.renderFlagField(flag);
		}
		if (command.jsonFlag) {
			new Setting(this.formEl).setName("Output as JSON").addToggle((toggle) =>
				toggle.setValue(!!this.values[JSON_OUTPUT_VALUE_KEY]).onChange((value) => {
					this.values[JSON_OUTPUT_VALUE_KEY] = value;
				})
			);
		}
	}

	private renderPositionalField(positional: PositionalArgSpec): void {
		const label = positional.label + (positional.required ? " *" : "");

		if (positional.type === "enum" && positional.enumValues) {
			new Setting(this.formEl).setName(label).setDesc(positional.description ?? "").addDropdown((dd) => {
				dd.addOption("", "—");
				for (const v of positional.enumValues as string[]) dd.addOption(v, v);
				dd.onChange((v) => {
					this.values[positional.name] = v || undefined;
				});
			});
			return;
		}

		new Setting(this.formEl).setName(label).setDesc(positional.description ?? "").addText((text) =>
			text.onChange((v) => {
				this.values[positional.name] = positional.type === "number" ? (v === "" ? undefined : Number(v)) : v;
			})
		);
	}

	private renderFlagField(flag: FlagSpec): void {
		if (flag.type === "boolean") {
			new Setting(this.formEl).setName(flag.label).setDesc(flag.description ?? "").addToggle((toggle) =>
				toggle.setValue(!!flag.default).onChange((v) => {
					this.values[flag.flag] = v;
				})
			);
			return;
		}

		if (flag.repeatable) {
			this.renderChipField(flag);
			return;
		}

		if (flag.type === "enum" && flag.enumValues) {
			new Setting(this.formEl).setName(flag.label).setDesc(flag.description ?? "").addDropdown((dd) => {
				dd.addOption("", "—");
				for (const v of flag.enumValues as string[]) dd.addOption(v, v);
				if (flag.default !== undefined) dd.setValue(String(flag.default));
				dd.onChange((v) => {
					this.values[flag.flag] = v || undefined;
				});
			});
			return;
		}

		new Setting(this.formEl).setName(flag.label).setDesc(flag.description ?? "").addText((text) => {
			if (flag.default !== undefined) text.setPlaceholder(String(flag.default));
			text.onChange((v) => {
				this.values[flag.flag] = flag.type === "number" ? (v === "" ? undefined : Number(v)) : v || undefined;
			});
		});
	}

	private renderChipField(flag: FlagSpec): void {
		const wrapper = this.formEl.createDiv({ cls: "pkm-rag-console-chip-field" });
		wrapper.createEl("label", { text: flag.label, cls: "setting-item-name" });
		if (flag.description) {
			wrapper.createEl("p", { text: flag.description, cls: "setting-item-description" });
		}

		const items: string[] = [];
		this.values[flag.flag] = items;

		const chipsEl = wrapper.createDiv({ cls: "pkm-rag-chips-container" });
		const renderChips = () => {
			chipsEl.empty();
			for (const item of items) {
				const chip = chipsEl.createDiv({ cls: "pkm-rag-chip" });
				chip.createSpan({ text: item });
				const removeBtn = chip.createEl("button", { text: "×", cls: "pkm-rag-chip-remove" });
				removeBtn.addEventListener("click", () => {
					const idx = items.indexOf(item);
					if (idx >= 0) items.splice(idx, 1);
					renderChips();
				});
			}
		};

		const input = wrapper.createEl("input", { type: "text", placeholder: "Type a value, press Enter" });

		// qmd's collection flags get live suggestions from real collections instead of a blank freeform field.
		if (this.currentTool === "qmd" && (flag.flag === "-c" || flag.flag === "--collection")) {
			const listId = "pkm-rag-console-qmd-collections";
			const datalist = wrapper.createEl("datalist", { attr: { id: listId } });
			void this.plugin.qmdClient.getCollections().then((collections) => {
				datalist.empty();
				for (const c of collections) datalist.createEl("option", { value: c });
			});
			input.setAttr("list", listId);
		}

		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && input.value.trim()) {
				e.preventDefault();
				items.push(input.value.trim());
				input.value = "";
				renderChips();
			}
		});

		renderChips();
	}

	private async handleRun(): Promise<void> {
		const command = this.currentCommand;
		if (!command) return;

		for (const positional of command.positionals) {
			if (positional.required && !this.values[positional.name]) {
				new Notice(`"${positional.label}" is required.`);
				return;
			}
		}

		const run = () => this.executeCommand(command);
		if (command.destructive) {
			new ConfirmRunModal(
				this.app,
				`Run ${TOOLS[this.currentTool].binaryName} ${command.argvPath.join(" ")}? This may not be reversible.`,
				run
			).open();
		} else {
			await run();
		}
	}

	private async executeCommand(command: CommandNode): Promise<void> {
		const client = this.getClient(this.currentTool);
		this.outputEl.setText("");
		this.runBtn.disabled = true;

		if (command.executionMode === "streaming") {
			this.cancelBtn.removeClass("pkm-rag-hidden");
			try {
				const handle = await client.runCommandStreaming(
					command.id,
					this.values,
					(chunk) => this.appendOutput(chunk),
					(chunk) => this.appendOutput(chunk)
				);
				this.activeKill = handle.kill;
				this.finishOutput(await handle.done);
			} catch (error) {
				this.outputEl.setText(`Error: ${(error as Error).message}`);
			} finally {
				this.activeKill = null;
				this.cancelBtn.addClass("pkm-rag-hidden");
				this.runBtn.disabled = false;
			}
			return;
		}

		try {
			this.finishOutput(await client.runCommand(command.id, this.values));
		} catch (error) {
			this.outputEl.setText(`Error: ${(error as Error).message}`);
		} finally {
			this.runBtn.disabled = false;
		}
	}

	private appendOutput(chunk: string): void {
		this.outputEl.setText(this.outputEl.getText() + chunk);
	}

	private finishOutput(result: CommandResult): void {
		if (result.json !== undefined) {
			this.outputEl.setText(JSON.stringify(result.json, null, 2));
			return;
		}
		const parts = [result.stdout, result.stderr].filter(Boolean);
		this.outputEl.setText(parts.join("\n---stderr---\n") || `(no output, exit code ${result.code})`);
	}
}

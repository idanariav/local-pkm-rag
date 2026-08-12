import { App, ItemView, WorkspaceLeaf, Setting, Notice, Modal } from "obsidian";
import type PkmRagPlugin from "../main";
import { TOOLS } from "../cli/toolRegistry";
import { GenericCliClient, JSON_OUTPUT_VALUE_KEY, CommandResult } from "../cli/genericClient";
import { CommandCategory, CommandNode, FlagSpec, PositionalArgSpec, ToolId } from "../cli/types";
import { parseCollectionNames } from "../cli/collectionNames";
import { normalizeResults, normalizeQvoidQueryNdjson, NormalizedResult } from "../cli/resultNormalizer";
import { renderFileLink } from "./fileLink";

/** Tools whose collection-listing output we know how to parse into plain names for
 *  live chip suggestions, and which command lists them (qvoid's is "collections",
 *  not "collection.list" like the other three). */
const COLLECTION_LIST_COMMAND_ID: Partial<Record<ToolId, string>> = {
	qmd: "collection.list",
	qimg: "collection.list",
	qnode: "collection.list",
	qvoid: "collections",
};

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
	private resultsEl!: HTMLElement;
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

		this.resultsEl = container.createDiv({ cls: "pkm-rag-console-results pkm-rag-hidden" });
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

		// Positionals are the command's primary arguments — always visible, never tucked away.
		for (const positional of command.positionals) {
			this.renderPositionalField(positional, this.formEl);
		}

		const requiredFlags = command.flags.filter((f) => f.required);
		const optionalFlags = command.flags.filter((f) => !f.required);

		for (const flag of requiredFlags) {
			this.renderFlagField(flag, this.formEl);
		}

		if (optionalFlags.length > 0) {
			const details = this.formEl.createEl("details", { cls: "pkm-rag-console-advanced" });
			details.createEl("summary", { text: `Advanced (${optionalFlags.length})` });
			const advancedBody = details.createDiv();
			for (const flag of optionalFlags) {
				this.renderFlagField(flag, advancedBody);
			}
		}

		if (command.jsonFlag) {
			// Defaults on: JSON is what powers the pretty results list below.
			if (this.values[JSON_OUTPUT_VALUE_KEY] === undefined) {
				this.values[JSON_OUTPUT_VALUE_KEY] = true;
			}
			new Setting(this.formEl).setName("Output as JSON").addToggle((toggle) =>
				toggle.setValue(!!this.values[JSON_OUTPUT_VALUE_KEY]).onChange((value) => {
					this.values[JSON_OUTPUT_VALUE_KEY] = value;
				})
			);
		}
	}

	private renderPositionalField(positional: PositionalArgSpec, container: HTMLElement): void {
		const label = positional.label + (positional.required ? " *" : "");

		if (positional.type === "enum" && positional.enumValues) {
			new Setting(container).setName(label).setDesc(positional.description ?? "").addDropdown((dd) => {
				dd.addOption("", "—");
				for (const v of positional.enumValues as string[]) dd.addOption(v, v);
				dd.onChange((v) => {
					this.values[positional.name] = v || undefined;
				});
			});
			return;
		}

		new Setting(container).setName(label).setDesc(positional.description ?? "").addText((text) =>
			text.onChange((v) => {
				this.values[positional.name] = positional.type === "number" ? (v === "" ? undefined : Number(v)) : v;
			})
		);
	}

	/** A user-configured default (Settings → Search Parameter Defaults) takes priority
	 *  over the command schema's own hardcoded default when both are present. */
	private getEffectiveDefault(flag: FlagSpec): string | undefined {
		const configured = this.plugin.settings.toolFlagDefaults[this.currentTool]?.[flag.flag];
		if (configured !== undefined && configured !== "") return configured;
		return flag.default !== undefined ? String(flag.default) : undefined;
	}

	private renderFlagField(flag: FlagSpec, container: HTMLElement): void {
		const effectiveDefault = this.getEffectiveDefault(flag);

		if (this.isCollectionFlag(flag) && COLLECTION_LIST_COMMAND_ID[this.currentTool]) {
			if (flag.repeatable) {
				this.renderCollectionChipField(flag, container);
			} else {
				this.renderCollectionDropdownField(flag, container);
			}
			return;
		}

		if (flag.type === "boolean") {
			const initial = effectiveDefault === "true";
			this.values[flag.flag] = initial;
			new Setting(container).setName(flag.label).setDesc(flag.description ?? "").addToggle((toggle) =>
				toggle.setValue(initial).onChange((v) => {
					this.values[flag.flag] = v;
				})
			);
			return;
		}

		if (flag.repeatable) {
			this.renderChipField(flag, container);
			return;
		}

		if (flag.type === "enum" && flag.enumValues) {
			if (effectiveDefault !== undefined) this.values[flag.flag] = effectiveDefault;
			new Setting(container).setName(flag.label).setDesc(flag.description ?? "").addDropdown((dd) => {
				dd.addOption("", "—");
				for (const v of flag.enumValues as string[]) dd.addOption(v, v);
				if (effectiveDefault !== undefined) dd.setValue(effectiveDefault);
				dd.onChange((v) => {
					this.values[flag.flag] = v || undefined;
				});
			});
			return;
		}

		if (effectiveDefault !== undefined) {
			this.values[flag.flag] = flag.type === "number" ? Number(effectiveDefault) : effectiveDefault;
		}
		new Setting(container).setName(flag.label).setDesc(flag.description ?? "").addText((text) => {
			if (effectiveDefault !== undefined) text.setValue(effectiveDefault);
			text.onChange((v) => {
				this.values[flag.flag] = flag.type === "number" ? (v === "" ? undefined : Number(v)) : v || undefined;
			});
		});
	}

	private isCollectionFlag(flag: FlagSpec): boolean {
		return flag.flag === "-c" || flag.flag === "--collection";
	}

	/** Fetches and parses the current tool's real collection names, for tools whose
	 *  collection-listing output we know how to parse (empty array if unsupported or
	 *  the command fails, e.g. tool not installed/configured yet). */
	private async fetchCollectionNames(): Promise<string[]> {
		const tool = this.currentTool;
		const listCommandId = COLLECTION_LIST_COMMAND_ID[tool];
		if (!listCommandId) return [];
		try {
			const result = await this.getClient(tool).runCommand(listCommandId);
			return parseCollectionNames(tool, result.stdout);
		} catch {
			return [];
		}
	}

	/** Single-collection flags (qimg/qnode/qvoid's --collection) get a real dropdown of
	 *  live collection names instead of a freeform text field, so it's impossible to
	 *  typo a collection name. */
	private renderCollectionDropdownField(flag: FlagSpec, container: HTMLElement): void {
		const effectiveDefault = this.getEffectiveDefault(flag);
		if (effectiveDefault !== undefined) this.values[flag.flag] = effectiveDefault;

		let selectEl!: HTMLSelectElement;
		new Setting(container).setName(flag.label).setDesc(flag.description ?? "").addDropdown((dd) => {
			selectEl = dd.selectEl;
			dd.addOption("", "All collections");
			dd.setValue("");
			dd.onChange((v) => {
				this.values[flag.flag] = v || undefined;
			});
		});

		void this.fetchCollectionNames().then((names) => {
			for (const name of names) selectEl.createEl("option", { value: name, text: name });
			if (effectiveDefault && names.includes(effectiveDefault)) {
				selectEl.value = effectiveDefault;
			}
		});
	}

	/** Repeatable collection flags (qmd's -c) get a dropdown that adds a chip on
	 *  selection instead of a freeform text input — same multi-select chip UX, but
	 *  constrained to real collection names. */
	private renderCollectionChipField(flag: FlagSpec, container: HTMLElement): void {
		const wrapper = container.createDiv({ cls: "pkm-rag-console-chip-field" });
		wrapper.createEl("label", { text: flag.label, cls: "setting-item-name" });
		if (flag.description) {
			wrapper.createEl("p", { text: flag.description, cls: "setting-item-description" });
		}

		const effectiveDefault = this.getEffectiveDefault(flag);
		const items: string[] = effectiveDefault ? [effectiveDefault] : [];
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

		const selectEl = wrapper.createEl("select");
		selectEl.createEl("option", { value: "", text: "Add a collection..." });
		selectEl.addEventListener("change", () => {
			const value = selectEl.value;
			if (value && !items.includes(value)) {
				items.push(value);
				renderChips();
			}
			selectEl.value = "";
		});

		void this.fetchCollectionNames().then((names) => {
			for (const name of names) selectEl.createEl("option", { value: name, text: name });
		});

		renderChips();
	}

	private renderChipField(flag: FlagSpec, container: HTMLElement): void {
		const wrapper = container.createDiv({ cls: "pkm-rag-console-chip-field" });
		wrapper.createEl("label", { text: flag.label, cls: "setting-item-name" });
		if (flag.description) {
			wrapper.createEl("p", { text: flag.description, cls: "setting-item-description" });
		}

		const effectiveDefault = this.getEffectiveDefault(flag);
		const items: string[] = effectiveDefault ? [effectiveDefault] : [];
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
		this.outputEl.removeClass("pkm-rag-hidden");
		this.resultsEl.empty();
		this.resultsEl.addClass("pkm-rag-hidden");
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
				await this.finishOutput(await handle.done);
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
			await this.finishOutput(await client.runCommand(command.id, this.values));
		} catch (error) {
			this.outputEl.setText(`Error: ${(error as Error).message}`);
		} finally {
			this.runBtn.disabled = false;
		}
	}

	private appendOutput(chunk: string): void {
		this.outputEl.setText(this.outputEl.getText() + chunk);
	}

	private async finishOutput(result: CommandResult): Promise<void> {
		// qvoid's `query` prints NDJSON when --format json is chosen, not a single JSON
		// value — the generic jsonFlag/result.json path doesn't apply, since --format is
		// an enum (summary/detailed/json), not a boolean flag like the other tools' --json.
		if (this.currentTool === "qvoid" && this.currentCommand?.id === "query" && this.values["--format"] === "json") {
			const normalized = normalizeQvoidQueryNdjson(result.stdout);
			if (normalized) {
				await this.renderResultCards(normalized);
				return;
			}
		}

		if (result.json !== undefined) {
			const normalized = normalizeResults(this.currentTool, result.json);
			if (normalized) {
				await this.renderResultCards(normalized);
				return;
			}
			this.outputEl.setText(JSON.stringify(result.json, null, 2));
			return;
		}
		const parts = [result.stdout, result.stderr].filter(Boolean);
		this.outputEl.setText(parts.join("\n---stderr---\n") || `(no output, exit code ${result.code})`);
	}

	/** Renders search-style results as real Obsidian wikilinks instead of a raw JSON dump —
	 *  click-to-open and native hover-preview (images included) come from Obsidian's own
	 *  link rendering, not custom event wiring. Rendered one at a time (not fired in
	 *  parallel) since concurrent MarkdownRenderer.render calls into different containers
	 *  are not reliable — only the first tended to actually render. */
	private async renderResultCards(results: NormalizedResult[]): Promise<void> {
		this.outputEl.addClass("pkm-rag-hidden");
		this.resultsEl.removeClass("pkm-rag-hidden");
		this.resultsEl.empty();

		for (const result of results) {
			const card = this.resultsEl.createDiv({ cls: "pkm-rag-console-result-card" });
			const titleRow = card.createDiv({ cls: "pkm-rag-console-result-title-row" });
			await renderFileLink(titleRow, this.app, this, result.fileRef, result.title);
			if (result.score !== undefined) {
				titleRow.createSpan({ text: result.score.toFixed(2), cls: "pkm-rag-console-result-score" });
			}
			if (result.subtitle) {
				card.createDiv({ text: result.subtitle, cls: "pkm-rag-console-result-subtitle" });
			}
		}
	}
}

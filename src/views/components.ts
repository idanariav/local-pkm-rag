import { MarkdownRenderer, App, Component } from "obsidian";
import { SourceInfo } from "../types";

/** Create a collapsible sources section. */
export function createSourcesEl(
	container: HTMLElement,
	sources: SourceInfo[],
	app: App
): void {
	if (sources.length === 0) return;

	const details = container.createEl("details", {
		cls: "pkm-rag-sources",
	});
	details.createEl("summary", {
		text: `Sources (${sources.length} notes)`,
	});

	for (const source of sources) {
		const sourceEl = details.createDiv({ cls: "pkm-rag-source" });
		const link = sourceEl.createEl("a", {
			text: source.title,
			cls: "pkm-rag-source-title",
		});
		link.addEventListener("click", (e) => {
			e.preventDefault();
			if (source.filePath) {
				app.workspace.openLinkText(source.filePath, "");
			} else {
				app.workspace.openLinkText(source.title, "");
			}
		});

		if (source.description) {
			sourceEl.createEl("span", {
				text: source.description,
				cls: "pkm-rag-source-desc",
			});
		}
	}
}

/** Render markdown content into a container element. */
export async function renderMarkdown(
	content: string,
	container: HTMLElement,
	app: App,
	component: Component
): Promise<void> {
	await MarkdownRenderer.render(app, content, container, "", component);
}

/** Create a multi-select tag filter with chips and dropdown. */
export function createTagFilter(
	container: HTMLElement,
	tags: string[],
	onChange: (selected: string[]) => void
): void {
	const wrapper = container.createDiv({ cls: "pkm-rag-tag-filter" });
	wrapper.createEl("small", {
		text: "Filter by tags",
		cls: "pkm-rag-tag-filter-label",
	});

	const selected = new Set<string>();

	const chipsContainer = wrapper.createDiv({
		cls: "pkm-rag-chips-container",
	});

	const searchInput = wrapper.createEl("input", {
		type: "text",
		placeholder: "Search tags...",
		cls: "pkm-rag-note-search",
	});

	const dropdown = wrapper.createDiv({
		cls: "pkm-rag-note-dropdown",
	});
	dropdown.style.display = "none";

	const renderChips = () => {
		chipsContainer.empty();
		for (const tag of selected) {
			const chip = chipsContainer.createDiv({
				cls: "pkm-rag-chip",
			});
			chip.createSpan({ text: tag });
			const removeBtn = chip.createEl("button", {
				text: "\u00d7",
				cls: "pkm-rag-chip-remove",
			});
			removeBtn.addEventListener("click", () => {
				selected.delete(tag);
				renderChips();
				onChange(Array.from(selected));
			});
		}
	};

	const renderDropdown = (filter: string) => {
		dropdown.empty();
		const filtered = tags.filter(
			(t) =>
				!selected.has(t) &&
				t.toLowerCase().includes(filter.toLowerCase())
		);
		if (filtered.length === 0) {
			dropdown.style.display = "none";
			return;
		}
		dropdown.style.display = "block";
		for (const tag of filtered.slice(0, 20)) {
			const item = dropdown.createDiv({
				text: tag,
				cls: "pkm-rag-dropdown-item",
			});
			item.addEventListener("click", () => {
				selected.add(tag);
				searchInput.value = "";
				dropdown.style.display = "none";
				renderChips();
				onChange(Array.from(selected));
			});
		}
	};

	searchInput.addEventListener("input", () => {
		renderDropdown(searchInput.value);
	});
	searchInput.addEventListener("focus", () => {
		renderDropdown(searchInput.value);
	});

	document.addEventListener("click", (e) => {
		if (!wrapper.contains(e.target as Node)) {
			dropdown.style.display = "none";
		}
	});
}

/** Create a searchable note selector dropdown. */
export function createNoteSelector(
	container: HTMLElement,
	titles: string[],
	placeholder: string,
	multiple: boolean,
	onChange: (selected: string[]) => void
): { getSelected: () => string[] } {
	const wrapper = container.createDiv({ cls: "pkm-rag-note-selector" });
	const selected: Set<string> = new Set();

	if (multiple) {
		// Multi-select with chips
		const chipsContainer = wrapper.createDiv({
			cls: "pkm-rag-chips-container",
		});

		const searchInput = wrapper.createEl("input", {
			type: "text",
			placeholder,
			cls: "pkm-rag-note-search",
		});

		const dropdown = wrapper.createDiv({
			cls: "pkm-rag-note-dropdown",
		});
		dropdown.style.display = "none";

		const renderChips = () => {
			chipsContainer.empty();
			for (const title of selected) {
				const chip = chipsContainer.createDiv({
					cls: "pkm-rag-chip",
				});
				chip.createSpan({ text: title });
				const removeBtn = chip.createEl("button", {
					text: "\u00d7",
					cls: "pkm-rag-chip-remove",
				});
				removeBtn.addEventListener("click", () => {
					selected.delete(title);
					renderChips();
					onChange(Array.from(selected));
				});
			}
		};

		const renderDropdown = (filter: string) => {
			dropdown.empty();
			const filtered = titles.filter(
				(t) =>
					!selected.has(t) &&
					t.toLowerCase().includes(filter.toLowerCase())
			);
			if (filtered.length === 0) {
				dropdown.style.display = "none";
				return;
			}
			dropdown.style.display = "block";
			for (const title of filtered.slice(0, 20)) {
				const item = dropdown.createDiv({
					text: title,
					cls: "pkm-rag-dropdown-item",
				});
				item.addEventListener("click", () => {
					selected.add(title);
					searchInput.value = "";
					dropdown.style.display = "none";
					renderChips();
					onChange(Array.from(selected));
				});
			}
		};

		searchInput.addEventListener("input", () => {
			renderDropdown(searchInput.value);
		});
		searchInput.addEventListener("focus", () => {
			renderDropdown(searchInput.value);
		});

		// Close dropdown when clicking outside
		document.addEventListener("click", (e) => {
			if (!wrapper.contains(e.target as Node)) {
				dropdown.style.display = "none";
			}
		});

		return {
			getSelected: () => Array.from(selected),
		};
	} else {
		// Single-select dropdown
		const searchInput = wrapper.createEl("input", {
			type: "text",
			placeholder,
			cls: "pkm-rag-note-search",
		});

		const dropdown = wrapper.createDiv({
			cls: "pkm-rag-note-dropdown",
		});
		dropdown.style.display = "none";

		const renderDropdown = (filter: string) => {
			dropdown.empty();
			const filtered = titles.filter((t) =>
				t.toLowerCase().includes(filter.toLowerCase())
			);
			if (filtered.length === 0) {
				dropdown.style.display = "none";
				return;
			}
			dropdown.style.display = "block";
			for (const title of filtered.slice(0, 20)) {
				const item = dropdown.createDiv({
					text: title,
					cls: "pkm-rag-dropdown-item",
				});
				item.addEventListener("click", () => {
					selected.clear();
					selected.add(title);
					searchInput.value = title;
					dropdown.style.display = "none";
					onChange([title]);
				});
			}
		};

		searchInput.addEventListener("input", () => {
			renderDropdown(searchInput.value);
		});
		searchInput.addEventListener("focus", () => {
			renderDropdown(searchInput.value);
		});

		document.addEventListener("click", (e) => {
			if (!wrapper.contains(e.target as Node)) {
				dropdown.style.display = "none";
			}
		});

		return {
			getSelected: () => Array.from(selected),
		};
	}
}

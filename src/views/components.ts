import { MarkdownRenderer, App, Component } from "obsidian";
import { SourceInfo } from "../types";

const MAX_DROPDOWN_ITEMS = 20;

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

/**
 * Shared chip-based multi-select dropdown with search filtering.
 * Used by both createTagFilter and createNoteSelector (multi-select mode).
 */
function createChipSelector(
	container: HTMLElement,
	items: string[],
	placeholder: string,
	onChange: (selected: string[]) => void
): { getSelected: () => string[]; cleanup: () => void } {
	const selected = new Set<string>();

	const chipsContainer = container.createDiv({
		cls: "pkm-rag-chips-container",
	});

	const searchInput = container.createEl("input", {
		type: "text",
		placeholder,
		cls: "pkm-rag-note-search",
	});

	const dropdown = container.createDiv({
		cls: "pkm-rag-note-dropdown",
	});
	dropdown.style.display = "none";

	const renderChips = () => {
		chipsContainer.empty();
		for (const item of selected) {
			const chip = chipsContainer.createDiv({
				cls: "pkm-rag-chip",
			});
			chip.createSpan({ text: item });
			const removeBtn = chip.createEl("button", {
				text: "\u00d7",
				cls: "pkm-rag-chip-remove",
			});
			removeBtn.addEventListener("click", () => {
				selected.delete(item);
				renderChips();
				onChange(Array.from(selected));
			});
		}
	};

	const renderDropdown = (filter: string) => {
		dropdown.empty();
		const filtered = items.filter(
			(t) =>
				!selected.has(t) &&
				t.toLowerCase().includes(filter.toLowerCase())
		);
		if (filtered.length === 0) {
			dropdown.style.display = "none";
			return;
		}
		dropdown.style.display = "block";
		for (const item of filtered.slice(0, MAX_DROPDOWN_ITEMS)) {
			const el = dropdown.createDiv({
				text: item,
				cls: "pkm-rag-dropdown-item",
			});
			el.addEventListener("click", () => {
				selected.add(item);
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

	const onClickOutside = (e: MouseEvent) => {
		if (!container.contains(e.target as Node)) {
			dropdown.style.display = "none";
		}
	};
	document.addEventListener("click", onClickOutside);

	return {
		getSelected: () => Array.from(selected),
		cleanup: () => document.removeEventListener("click", onClickOutside),
	};
}

/** Create a multi-select tag filter with chips and dropdown. */
export function createTagFilter(
	container: HTMLElement,
	tags: string[],
	onChange: (selected: string[]) => void
): { cleanup: () => void } {
	const wrapper = container.createDiv({ cls: "pkm-rag-tag-filter" });
	wrapper.createEl("small", {
		text: "Filter by tags",
		cls: "pkm-rag-tag-filter-label",
	});

	const { cleanup } = createChipSelector(wrapper, tags, "Search tags...", onChange);
	return { cleanup };
}

/** Create a searchable note selector dropdown. */
export function createNoteSelector(
	container: HTMLElement,
	titles: string[],
	placeholder: string,
	multiple: boolean,
	onChange: (selected: string[]) => void
): { getSelected: () => string[]; cleanup: () => void } {
	const wrapper = container.createDiv({ cls: "pkm-rag-note-selector" });

	if (multiple) {
		return createChipSelector(wrapper, titles, placeholder, onChange);
	}

	// Single-select dropdown
	const selected: Set<string> = new Set();

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
		for (const title of filtered.slice(0, MAX_DROPDOWN_ITEMS)) {
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

	const onClickOutside = (e: MouseEvent) => {
		if (!wrapper.contains(e.target as Node)) {
			dropdown.style.display = "none";
		}
	};
	document.addEventListener("click", onClickOutside);

	return {
		getSelected: () => Array.from(selected),
		cleanup: () => document.removeEventListener("click", onClickOutside),
	};
}

import { ItemView, WorkspaceLeaf } from "obsidian";
import type PkmRagPlugin from "../main";
import { findSimilarNotes } from "../rag/retrieval";
import { createTagFilter } from "./components";

export const RELATED_NOTES_VIEW_TYPE = "pkm-rag-related-notes";

export class RelatedNotesView extends ItemView {
	private plugin: PkmRagPlugin;
	private filterLinked: boolean;
	private selectedTags: string[] = [];
	private resultsContainer: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: PkmRagPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.filterLinked = plugin.settings.filterLinkedByDefault;
	}

	getViewType(): string {
		return RELATED_NOTES_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Related Notes";
	}

	getIcon(): string {
		return "links-coming-in";
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("pkm-rag-related-view");

		// Header
		const header = container.createDiv({ cls: "pkm-rag-related-header" });
		header.createEl("h4", { text: "Related Notes" });

		// Filter toggle
		const toggleWrapper = header.createDiv({
			cls: "pkm-rag-toggle-wrapper",
		});
		const toggle = toggleWrapper.createEl("input", { type: "checkbox" });
		toggle.checked = this.filterLinked;
		toggle.id = "pkm-rag-filter-linked";
		toggleWrapper.createEl("label", {
			text: "Exclude linked",
			attr: { for: "pkm-rag-filter-linked" },
		});
		toggle.addEventListener("change", () => {
			this.filterLinked = toggle.checked;
			this.refresh();
		});

		// Tag filter
		const allTags = this.plugin.vectorStore.getAllTags();
		if (allTags.length > 0) {
			const tagFilterEl = container.createDiv({
				cls: "pkm-rag-related-tag-filter",
			});
			createTagFilter(tagFilterEl, allTags, (tags) => {
				this.selectedTags = tags;
				this.refresh();
			});
		}

		// Results container
		this.resultsContainer = container.createDiv({
			cls: "pkm-rag-related-results",
		});

		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.resultsContainer = null;
	}

	async refresh(): Promise<void> {
		if (!this.resultsContainer) return;

		const container = this.resultsContainer;
		container.empty();

		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || activeFile.extension !== "md") {
			container.createDiv({
				text: "No note selected",
				cls: "pkm-rag-empty-state",
			});
			return;
		}

		// Check if note has UUID
		const cache = this.app.metadataCache.getFileCache(activeFile);
		const uuid =
			cache?.frontmatter?.[this.plugin.settings.requiredFrontmatterKey];
		if (!uuid) {
			container.createDiv({
				text: "Note has no UUID",
				cls: "pkm-rag-empty-state",
			});
			return;
		}

		// Check if note is embedded
		const chunks = this.plugin.vectorStore.getChunksByTitle(
			activeFile.basename
		);
		if (chunks.length === 0) {
			container.createDiv({
				text: 'Note not embedded yet. Run "Embed current note" or "Embed vault".',
				cls: "pkm-rag-empty-state",
			});
			return;
		}

		container.createDiv({
			text: "Finding related notes...",
			cls: "pkm-rag-loading",
		});

		// Use setTimeout to let the UI update before the computation
		setTimeout(() => {
			const tags = this.selectedTags.length > 0 ? this.selectedTags : undefined;
			const similar = findSimilarNotes(
				activeFile.basename,
				this.plugin.vectorStore,
				this.filterLinked,
				this.plugin.settings.similarTopK,
				this.plugin.settings.similarityThreshold,
				tags
			);

			container.empty();

			if (similar.length === 0) {
				container.createDiv({
					text: "No similar notes found",
					cls: "pkm-rag-empty-state",
				});
				return;
			}

			for (const note of similar) {
				const noteEl = container.createDiv({
					cls: "pkm-rag-similar-note",
				});

				const titleRow = noteEl.createDiv({
					cls: "pkm-rag-similar-title-row",
				});

				const titleEl = titleRow.createEl("a", {
					text: note.title,
					cls: "pkm-rag-similar-title",
				});
				titleEl.addEventListener("click", (e) => {
					e.preventDefault();
					if (note.filePath) {
						this.app.workspace.openLinkText(note.filePath, "");
					} else {
						this.app.workspace.openLinkText(note.title, "");
					}
				});

				titleRow.createEl("span", {
					text: `${Math.round(note.similarity * 100)}%`,
					cls: "pkm-rag-similar-score",
				});

				if (note.description) {
					noteEl.createDiv({
						text: note.description,
						cls: "pkm-rag-similar-description",
					});
				}
			}
		}, 0);
	}
}

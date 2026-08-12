import { App, HoverParent, TFile } from "obsidian";

/** Fuzzy-resolves a CLI tool's raw file reference (a "qmd://collection/path.md" URI, a
 *  collection-relative image filename, etc.) to an actual vault file, by suffix/basename
 *  match against every file in the vault — the same tolerant approach already proven for
 *  qmd note results, generalized to any file type so it also covers qimg's images. */
export function resolveVaultFile(app: App, rawRef: string): TFile | null {
	const allFiles = app.vault.getFiles();

	for (const file of allFiles) {
		if (rawRef.endsWith(file.path) || file.path.endsWith(rawRef) || file.path === rawRef) {
			return file;
		}
	}

	const basename = rawRef.split("/").pop() || rawRef;
	for (const file of allFiles) {
		if (file.name === basename) return file;
	}

	return null;
}

/** Renders a clickable link to a resolved vault file that triggers Obsidian's native
 *  Page Preview popover on hover — the same "hover-link" mechanism normal markdown
 *  wikilinks use, so images/notes preview exactly like they do everywhere else in Obsidian.
 *  Falls back to plain (unresolved) text if the reference can't be matched to a vault file. */
export function renderFileLink(
	container: HTMLElement,
	app: App,
	hoverParent: HoverParent,
	hoverSource: string,
	rawRef: string,
	displayText: string
): void {
	const file = resolveVaultFile(app, rawRef);
	if (!file) {
		container.createSpan({ text: displayText, cls: "pkm-rag-console-result-unresolved" });
		return;
	}

	const link = container.createEl("a", {
		text: displayText,
		cls: "pkm-rag-console-result-link internal-link",
		href: file.path,
	});

	link.addEventListener("click", (event) => {
		event.preventDefault();
		void app.workspace.openLinkText(file.path, "");
	});

	link.addEventListener("mouseover", (event) => {
		app.workspace.trigger("hover-link", {
			event,
			source: hoverSource,
			hoverParent,
			targetEl: link,
			linktext: file.path,
			sourcePath: file.path,
		});
	});
}

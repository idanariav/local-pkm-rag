import { App, Component, HoverParent, TFile } from "obsidian";
import { renderMarkdown } from "./components";

/** Minimal HoverParent so we can fire "hover-link" without requiring every calling
 *  view to implement the interface itself. */
const hoverParent: HoverParent = { hoverPopover: null };

/** Normalizes a filename for comparison: NFC unicode form (macOS's filesystem stores
 *  accented filenames as NFD, which fails === against a normal NFC string with the
 *  same visible characters), decoded of any URL-encoding, and case-folded. */
function normalizeForMatch(s: string): string {
	let decoded = s;
	try {
		decoded = decodeURIComponent(s);
	} catch {
		/* not URL-encoded, use as-is */
	}
	return decoded.normalize("NFC").toLowerCase();
}

/** Reduces a filename to just its letters/digits, extension stripped: qmd's virtual
 *  qmd:// file references are slugified (spaces become hyphens, punctuation like
 *  commas/periods/parens is stripped entirely) and no longer match the real vault
 *  filename by exact or basename comparison — e.g. qmd reports
 *  "Get-smarty-pants-cognitive-ability-personality-and-victimization-reference.md"
 *  for the real vault file "Get smarty pants cognitive ability, personality, and
 *  victimization. (reference).md". Stripping everything but letters/digits from both
 *  sides makes them comparable again. */
function slugKey(s: string): string {
	return normalizeForMatch(s)
		.replace(/\.[a-z0-9]+$/i, "")
		.replace(/[^a-z0-9]+/gi, "");
}

/** Fuzzy-resolves a CLI tool's raw file reference (a "qmd://collection/path.md" URI, a
 *  collection-relative image filename, etc.) to an actual vault file. Tries increasingly
 *  permissive strategies: exact/suffix path match, then exact basename match, then a
 *  punctuation-stripped "slug" match to survive qmd's filename slugification. */
export function resolveVaultFile(app: App, rawRef: string): TFile | null {
	const allFiles = app.vault.getFiles();
	const normalizedRawRef = normalizeForMatch(rawRef);

	for (const file of allFiles) {
		const normalizedPath = normalizeForMatch(file.path);
		if (
			normalizedRawRef.endsWith(normalizedPath) ||
			normalizedPath.endsWith(normalizedRawRef) ||
			normalizedPath === normalizedRawRef
		) {
			return file;
		}
	}

	const rawBasename = rawRef.split("/").pop() || rawRef;
	const basename = normalizeForMatch(rawBasename);
	for (const file of allFiles) {
		if (normalizeForMatch(file.name) === basename) return file;
	}

	const basenameSlug = slugKey(rawBasename);
	if (basenameSlug) {
		for (const file of allFiles) {
			if (slugKey(file.name) === basenameSlug) return file;
		}
	}

	console.warn(`[pkm-rag] Could not resolve "${rawRef}" to a vault file.`);
	return null;
}

function toWikilink(file: TFile, displayText: string): string {
	const linkPath = file.extension === "md" ? file.path.slice(0, -3) : file.path;
	const safeDisplay = displayText.replace(/[[\]]/g, "").trim() || file.basename;
	return `[[${linkPath}|${safeDisplay}]]`;
}

/**
 * Renders a real Obsidian wikilink for a resolved vault file through the same
 * MarkdownRenderer pipeline normal note content uses, so it looks and is structured
 * exactly like any other link in Obsidian. On top of that, explicit click/hover
 * handlers are attached directly to the rendered anchor as a guaranteed fallback —
 * MarkdownRenderer's automatic link interactivity isn't reliably wired up when
 * rendering into an arbitrary custom-view container outside the normal reading-view
 * pipeline, so click-to-open and hover-preview are made to not depend on it.
 * Falls back to plain text if the reference can't be resolved to a vault file.
 */
export async function renderFileLink(
	container: HTMLElement,
	app: App,
	component: Component,
	rawRef: string,
	displayText: string
): Promise<void> {
	const file = resolveVaultFile(app, rawRef);
	if (!file) {
		container.createSpan({
			text: displayText,
			cls: "pkm-rag-console-result-unresolved",
			attr: { title: `Could not match to a vault file: ${rawRef}` },
		});
		return;
	}

	await renderMarkdown(toWikilink(file, displayText), container, app, component);

	const link = container.querySelector("a.internal-link") as HTMLAnchorElement | null;
	if (!link) return;

	link.addEventListener("click", (event) => {
		event.preventDefault();
		void app.workspace.openLinkText(file.path, "");
	});

	link.addEventListener("mouseover", (event) => {
		app.workspace.trigger("hover-link", {
			event,
			source: "pkm-rag",
			hoverParent,
			targetEl: link,
			linktext: file.path,
			sourcePath: file.path,
		});
	});
}

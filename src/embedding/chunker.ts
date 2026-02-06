import { DEFAULTS } from "../constants";

/**
 * Pure TypeScript implementation of RecursiveCharacterTextSplitter.
 * Splits text by trying separators in order, merging small pieces
 * with configurable overlap.
 */
export class RecursiveCharacterTextSplitter {
	private chunkSize: number;
	private chunkOverlap: number;
	private separators: string[];

	constructor(
		chunkSize: number = DEFAULTS.CHUNK_SIZE,
		chunkOverlap: number = DEFAULTS.CHUNK_OVERLAP,
		separators: string[] = [...DEFAULTS.CHUNK_SEPARATORS]
	) {
		this.chunkSize = chunkSize;
		this.chunkOverlap = chunkOverlap;
		this.separators = separators;
	}

	splitText(text: string): string[] {
		return this._splitText(text, this.separators);
	}

	private _splitText(text: string, separators: string[]): string[] {
		const finalChunks: string[] = [];

		// Find the appropriate separator
		let separator = separators[separators.length - 1];
		let newSeparators: string[] = [];
		for (let i = 0; i < separators.length; i++) {
			if (separators[i] === "") {
				separator = separators[i];
				break;
			}
			if (text.includes(separators[i])) {
				separator = separators[i];
				newSeparators = separators.slice(i + 1);
				break;
			}
		}

		// Split by the chosen separator
		const splits = separator
			? text.split(separator).filter((s) => s !== "")
			: Array.from(text);

		// Merge small splits and recurse on large ones
		let goodSplits: string[] = [];
		const sep = separator;

		for (const s of splits) {
			if (s.length < this.chunkSize) {
				goodSplits.push(s);
			} else {
				if (goodSplits.length > 0) {
					const merged = this._mergeSplits(goodSplits, sep);
					finalChunks.push(...merged);
					goodSplits = [];
				}
				if (newSeparators.length === 0) {
					finalChunks.push(s);
				} else {
					const subChunks = this._splitText(s, newSeparators);
					finalChunks.push(...subChunks);
				}
			}
		}

		if (goodSplits.length > 0) {
			const merged = this._mergeSplits(goodSplits, sep);
			finalChunks.push(...merged);
		}

		return finalChunks;
	}

	private _mergeSplits(splits: string[], separator: string): string[] {
		const docs: string[] = [];
		const currentDoc: string[] = [];
		let total = 0;

		for (const s of splits) {
			const len = s.length;
			const sepLen = currentDoc.length > 0 ? separator.length : 0;

			if (total + len + sepLen > this.chunkSize && currentDoc.length > 0) {
				const doc = this._joinDocs(currentDoc, separator);
				if (doc !== null) {
					docs.push(doc);
				}
				// Keep overlap: pop from front until under overlap size
				while (
					total > this.chunkOverlap ||
					(total + len + sepLen > this.chunkSize && total > 0)
				) {
					if (currentDoc.length === 0) break;
					const removed = currentDoc.shift()!;
					total -= removed.length + (currentDoc.length > 0 ? separator.length : 0);
				}
			}
			currentDoc.push(s);
			total += len + sepLen;
		}

		const doc = this._joinDocs(currentDoc, separator);
		if (doc !== null) {
			docs.push(doc);
		}

		return docs;
	}

	private _joinDocs(docs: string[], separator: string): string | null {
		const text = docs.join(separator).trim();
		return text === "" ? null : text;
	}
}

import { ItemView, WorkspaceLeaf } from "obsidian";
import type PkmRagPlugin from "../main";
import { ChatMessage, ChatMode, SourceInfo } from "../types";
import { createSourcesEl, renderMarkdown, createNoteSelector, createTagFilter } from "./components";
import {
	runAskMode,
	runConnectMode,
	runGapMode,
	runDevilsAdvocateMode,
} from "../rag/modes";

export const CHAT_VIEW_TYPE = "pkm-rag-chat";

export class ChatView extends ItemView {
	private plugin: PkmRagPlugin;
	private currentMode: ChatMode = "ask";
	private messages: ChatMessage[] = [];
	private isProcessing = false;

	// DOM references
	private modeConfigEl: HTMLElement | null = null;
	private messagesEl: HTMLElement | null = null;
	private inputArea: HTMLElement | null = null;
	private textInput: HTMLTextAreaElement | null = null;
	private sendBtn: HTMLButtonElement | null = null;

	// Mode-specific state
	private selectedNotes: string[] = [];
	private selectedTags: string[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: PkmRagPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return CHAT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "PKM RAG Chat";
	}

	getIcon(): string {
		return "message-circle";
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("pkm-rag-chat-container");

		// Header with mode selector
		const headerEl = container.createDiv({ cls: "pkm-rag-chat-header" });

		const modeSelect = headerEl.createEl("select", {
			cls: "pkm-rag-mode-select",
		});
		const modes: { value: ChatMode; label: string }[] = [
			{ value: "ask", label: "Ask" },
			{ value: "connect", label: "Connect" },
			{ value: "gap", label: "Gap Analysis" },
			{ value: "devils_advocate", label: "Devil's Advocate" },
		];
		for (const mode of modes) {
			modeSelect.createEl("option", {
				value: mode.value,
				text: mode.label,
			});
		}
		modeSelect.value = this.currentMode;
		modeSelect.addEventListener("change", () => {
			this.currentMode = modeSelect.value as ChatMode;
			this.messages = [];
			this.selectedNotes = [];
			this.renderModeConfig();
			this.renderMessages();
		});

		// Clear button
		const clearBtn = headerEl.createEl("button", {
			text: "Clear",
			cls: "pkm-rag-clear-btn",
		});
		clearBtn.addEventListener("click", () => {
			this.messages = [];
			this.renderMessages();
		});

		// Tag filter (persists across mode switches)
		const tagFilterEl = container.createDiv({
			cls: "pkm-rag-chat-tag-filter",
		});
		const allTags = this.plugin.vectorStore.getAllTags();
		if (allTags.length > 0) {
			createTagFilter(tagFilterEl, allTags, (tags) => {
				this.selectedTags = tags;
			});
		}

		// Mode-specific config area
		this.modeConfigEl = container.createDiv({
			cls: "pkm-rag-chat-mode-config",
		});

		// Messages area
		this.messagesEl = container.createDiv({
			cls: "pkm-rag-chat-messages",
		});

		// Input area
		this.inputArea = container.createDiv({
			cls: "pkm-rag-chat-input-area",
		});

		this.renderModeConfig();
		this.renderInputArea();
	}

	async onClose(): Promise<void> {
		this.modeConfigEl = null;
		this.messagesEl = null;
		this.inputArea = null;
		this.textInput = null;
		this.sendBtn = null;
	}

	private renderModeConfig(): void {
		if (!this.modeConfigEl) return;
		this.modeConfigEl.empty();

		const titles = this.plugin.vectorStore.getAllTitles();

		switch (this.currentMode) {
			case "ask": {
				const tip = this.modeConfigEl.createDiv({
					cls: "pkm-rag-mode-tip",
				});
				tip.createEl("small", {
					text: 'Tip: Phrase questions directly (e.g., "What is agency?") for better retrieval.',
				});
				break;
			}
			case "connect": {
				this.modeConfigEl.createEl("small", {
					text: "Select 2+ notes to discover how they relate.",
					cls: "pkm-rag-mode-tip",
				});
				createNoteSelector(
					this.modeConfigEl,
					titles,
					"Search notes...",
					true,
					(selected) => {
						this.selectedNotes = selected;
					}
				);
				break;
			}
			case "gap": {
				this.modeConfigEl.createEl("small", {
					text: "Enter a topic to identify gaps in your notes.",
					cls: "pkm-rag-mode-tip",
				});
				break;
			}
			case "devils_advocate": {
				this.modeConfigEl.createEl("small", {
					text: "Select a note to challenge its reasoning.",
					cls: "pkm-rag-mode-tip",
				});
				createNoteSelector(
					this.modeConfigEl,
					titles,
					"Search for a note...",
					false,
					(selected) => {
						this.selectedNotes = selected;
					}
				);
				break;
			}
		}

		this.renderInputArea();
	}

	private renderInputArea(): void {
		if (!this.inputArea) return;
		this.inputArea.empty();

		const showTextInput =
			this.currentMode === "ask" || this.currentMode === "gap";

		if (showTextInput) {
			this.textInput = this.inputArea.createEl("textarea", {
				placeholder: this.getInputPlaceholder(),
				cls: "pkm-rag-chat-input",
			});
			this.textInput.rows = 2;
			this.textInput.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !e.shiftKey) {
					e.preventDefault();
					this.onSend();
				}
			});
		}

		this.sendBtn = this.inputArea.createEl("button", {
			text: this.getSendButtonText(),
			cls: "pkm-rag-send-btn",
		});
		this.sendBtn.addEventListener("click", () => this.onSend());
	}

	private getInputPlaceholder(): string {
		switch (this.currentMode) {
			case "ask":
				return "Ask about your notes...";
			case "gap":
				return "Enter a topic...";
			default:
				return "";
		}
	}

	private getSendButtonText(): string {
		switch (this.currentMode) {
			case "ask":
				return "Send";
			case "connect":
				return "Explore";
			case "gap":
				return "Analyze";
			case "devils_advocate":
				return "Challenge";
		}
	}

	private async onSend(): Promise<void> {
		if (this.isProcessing) return;

		let userContent = "";

		switch (this.currentMode) {
			case "ask":
			case "gap": {
				const text = this.textInput?.value?.trim();
				if (!text) return;
				userContent = text;
				if (this.textInput) this.textInput.value = "";
				break;
			}
			case "connect": {
				if (this.selectedNotes.length < 2) {
					this.addSystemMessage("Please select at least 2 notes.");
					return;
				}
				userContent = `Connect: ${this.selectedNotes.join(", ")}`;
				break;
			}
			case "devils_advocate": {
				if (this.selectedNotes.length === 0) {
					this.addSystemMessage("Please select a note.");
					return;
				}
				userContent = `Challenge: ${this.selectedNotes[0]}`;
				break;
			}
		}

		// Add user message
		this.messages.push({
			role: "user",
			content: userContent,
			timestamp: Date.now(),
		});
		this.renderMessages();

		// Process
		this.isProcessing = true;
		this.updateSendButton(true);

		// Create assistant message placeholder for streaming
		const assistantMsg: ChatMessage = {
			role: "assistant",
			content: "",
			timestamp: Date.now(),
		};
		this.messages.push(assistantMsg);

		const assistantEl = this.renderMessages();
		const contentEl = assistantEl?.querySelector(
			".pkm-rag-msg-content:last-child"
		) as HTMLElement | null;

		try {
			const onToken = contentEl
				? (token: string) => {
						assistantMsg.content += token;
						if (contentEl) {
							contentEl.textContent = assistantMsg.content;
						}
						this.scrollToBottom();
					}
				: undefined;

			let result: { answer: string; sources: SourceInfo[] };

			const tags = this.selectedTags.length > 0 ? this.selectedTags : undefined;

			switch (this.currentMode) {
				case "ask":
					result = await runAskMode(
						userContent,
						this.plugin.vectorStore,
						this.plugin.ollamaClient,
						this.plugin.settings,
						onToken,
						tags
					);
					break;
				case "connect":
					result = await runConnectMode(
						this.selectedNotes,
						this.plugin.vectorStore,
						this.plugin.ollamaClient,
						this.plugin.settings,
						onToken,
						tags
					);
					break;
				case "gap":
					result = await runGapMode(
						userContent,
						this.plugin.vectorStore,
						this.plugin.ollamaClient,
						this.plugin.settings,
						onToken,
						tags
					);
					break;
				case "devils_advocate":
					result = await runDevilsAdvocateMode(
						this.selectedNotes[0],
						this.plugin.vectorStore,
						this.plugin.ollamaClient,
						this.plugin.settings,
						onToken,
						tags
					);
					break;
			}

			assistantMsg.content = result.answer;
			assistantMsg.sources = result.sources;
		} catch (e) {
			assistantMsg.content = `Error: ${e instanceof Error ? e.message : String(e)}`;
		}

		this.isProcessing = false;
		this.updateSendButton(false);
		this.renderMessages();
	}

	private addSystemMessage(text: string): void {
		if (!this.messagesEl) return;
		const el = this.messagesEl.createDiv({
			cls: "pkm-rag-msg-system",
		});
		el.textContent = text;
		setTimeout(() => el.remove(), 3000);
	}

	/** Render all messages and return the messages container. */
	private renderMessages(): HTMLElement | null {
		if (!this.messagesEl) return null;
		this.messagesEl.empty();

		for (const msg of this.messages) {
			const msgEl = this.messagesEl.createDiv({
				cls: `pkm-rag-msg pkm-rag-msg-${msg.role}`,
			});

			const contentEl = msgEl.createDiv({ cls: "pkm-rag-msg-content" });

			if (msg.content) {
				// For completed messages, render as markdown
				if (
					msg.role === "assistant" &&
					!this.isProcessing
				) {
					renderMarkdown(
						msg.content,
						contentEl,
						this.app,
						this
					);
				} else {
					contentEl.textContent = msg.content;
				}
			} else if (msg.role === "assistant" && this.isProcessing) {
				contentEl.addClass("pkm-rag-loading");
				contentEl.textContent = "Thinking...";
			}

			if (msg.sources && msg.sources.length > 0) {
				createSourcesEl(msgEl, msg.sources, this.app);
			}
		}

		this.scrollToBottom();
		return this.messagesEl;
	}

	private scrollToBottom(): void {
		if (this.messagesEl) {
			this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
		}
	}

	private updateSendButton(processing: boolean): void {
		if (this.sendBtn) {
			this.sendBtn.disabled = processing;
			this.sendBtn.textContent = processing
				? "Processing..."
				: this.getSendButtonText();
		}
		if (this.textInput) {
			this.textInput.disabled = processing;
		}
	}
}

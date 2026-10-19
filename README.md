# PKM RAG Plugin

A local, privacy-first RAG (Retrieval-Augmented Generation) plugin for Obsidian that transforms your personal knowledge management vault into an intelligent assistant powered by local LLMs via Ollama.

## Features

### 🔍 Six Intelligent Modes

1. **Ask**: General question-answering about your knowledge base
2. **Find Related**: Discover notes similar to the current selection or query
3. **Connect**: Identify meaningful connections between different topics in your vault
4. **Gap Analysis**: Uncover knowledge gaps and areas for further exploration
5. **Devil's Advocate**: Challenge your ideas with counterarguments drawn from your notes
6. **Redundancy Check**: Detect duplicate or near-duplicate notes, and check if a new idea is already covered before creating it

### 🔒 Privacy-First Architecture

- **100% Local Processing**: All embeddings and LLM inference run on your machine via Ollama
- **No Cloud Dependencies**: Your notes never leave your computer
- **Offline Capable**: Works completely offline once Ollama models are installed

### ⚡ Performance

- **Smart Chunking**: Splits notes into overlapping chunks for better context retrieval
- **In-Memory Vector Search**: Fast cosine similarity search with JSON-based persistence
- **Auto-Embedding**: Automatically updates embeddings when notes change (debounced)
- **Streaming Responses**: Real-time streaming of LLM responses for better UX

## Requirements

- **Obsidian**: Version 1.0.0 or higher (desktop only)
- **Ollama**: Local LLM server ([installation guide](https://ollama.ai))
- **Ollama Models**:
  - `nomic-embed-text` - For generating embeddings
  - `llama3.1:8b` - For chat/reasoning (or your preferred model)

## Installation

### 1. Install Ollama

```bash
# macOS
brew install ollama

# Or download from https://ollama.ai
```

### 2. Pull Required Models

```bash
ollama pull nomic-embed-text
ollama pull llama3.1:8b
```

### 3. Install the Plugin

#### Option A: Manual Installation

1. Download the latest release
2. Extract to `.obsidian/plugins/pkm-rag/` in your vault
3. Enable the plugin in Obsidian Settings → Community Plugins

#### Option B: Build from Source

```bash
# Clone the repository
git clone https://github.com/yourusername/local-pkm-rag.git
cd local-pkm-rag

# Install dependencies
npm install

# Build the plugin
npm run build

# Copy to your vault
cp main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/pkm-rag/
```

## Configuration

### Environment Variables

The plugin requires the `VAULT_PATH` environment variable to be set:

```bash
# Add to your shell profile (.zshrc, .bashrc, etc.)
export VAULT_PATH="/path/to/your/obsidian/vault"
```

### Plugin Settings

Access settings via Settings → PKM RAG:

- **Ollama Base URL**: Default `http://localhost:11434`
- **Embedding Model**: Default `nomic-embed-text`
- **Chat Model**: Default `llama3.1:8b`
- **Content Mode**: `section` (chunks by headings) or `full` (entire note)
- **Chunk Size**: Tokens per chunk (default: 512)
- **Chunk Overlap**: Overlapping tokens between chunks (default: 50)
- **Top K Results**: Number of similar notes to retrieve (default: 5)
- **Vector Store Path**: Where embeddings are saved (default: `.pkm-embeddings/embeddings.json`)

### Note Requirements

Each note must have a `uuid` frontmatter key for tracking:

```yaml
---
uuid: 550e8400-e29b-41d4-a716-446655440000
---

# Your Note Title
Note content here...
```

## Usage

### Opening Views

- **Chat View**: Command palette → "Open PKM RAG Chat"
- **Related Notes View**: Command palette → "Open PKM RAG Related Notes" (sidebar)

### Chat Modes

1. Select a mode from the dropdown (Ask, Find Related, Connect, Gap Analysis, Devil's Advocate, Redundancy Check)
2. Type your query
3. Get streaming responses with relevant context from your vault

### Checking for Redundant Notes

1. Open the Chat view and select "Redundancy Check" mode
2. Choose **Check existing note** to analyze whether a note in your vault is redundant with others, or **Check new idea** to see if an idea is already covered before creating a new note
3. The plugin finds notes with 70%+ similarity and provides an LLM-powered analysis with a clear verdict (Redundant / Partial Overlap / Unique) and actionable recommendations

### Finding Related Notes

1. Open the Related Notes sidebar
2. Select text in any note
3. View automatically discovered related notes ranked by similarity

### Embedding Your Vault

- **Manual**: Command palette → "Embed all notes"
- **Automatic**: Notes are re-embedded on save (debounced)

### Lite Mode (mobile, or desktop without the CLIs)

When a tool's CLI isn't available, which is always the case on mobile, the CLI console answers the everyday search commands from exports the tools write into the vault. Related notes, chat and the setup wizard still need the desktop CLIs, so on mobile only **Open CLI console** is offered.

1. On a desktop with the tools installed, run `qmd export`, `qvoid export` and `qimg export`, each with `--out <vault>/Scaffolding/Embeddings/<tool>`. To keep the exports current, set `export.path` in qmd's and qimg's `index.yml` and `[export] path` in the qvoid collection TOML. Then `qmd embed`, `qvoid index`/`embed` and `qimg index`/`embed`/`caption`/`ocr` re-export automatically.
2. Let the folder sync to the other device. It's ~21 MB; keep it out of git.
3. Settings → Tools → Lite mode: set the export folder (default `Scaffolding/Embeddings`). "Always use lite mode" forces it on desktop for testing.

| Command | How lite mode answers it |
|---|---|
| qmd `vsearch` | Exported int8 vectors; the query vector is the mean of its words' vectors (no model on the device) |
| qmd `tsearch` | MiniSearch over the same text qmd indexes (section-filtered collections included), built on first use and refreshed per changed file |
| qmd `hsearch` | Reciprocal-rank fusion of the two above; no query expansion or LLM rerank |
| qmd `fsearch` | qmd's own filter parser, evaluated against Obsidian's live metadata |
| qmd `get` | Read directly from the vault (`--section`, `--no-callouts`, `--no-codeblocks`, `--from`, `-l`) |
| qvoid `query` | qvoid's own `filterLinks` over the exported records |
| qvoid `find-similar` | Exported vectors (exact target or word-mean query); `--cluster` computed live |
| qimg `tsearch` | MiniSearch over path, filename, caption, EXIF and OCR text (all terms must match, as in qimg) |
| qimg `vsearch` | Exported SigLIP image vectors; the query is the mean of its words' SigLIP text vectors. `--image` works for images already in the export |
| qimg `hsearch` | qimg's own fusion (RRF over 2×limit keyword + vector hits) |
| qimg `get` | Exported metadata (caption, OCR, EXIF, size, sidecar note) |

The console shows a "Lite · exported <date>" badge. Vector hits whose note changed since the export are prefixed "(changed since export)".

Fidelity against the CLIs on this vault: `fsearch` counts match or differ by a few notes (lite reads live files, the CLI its last index). `tsearch` shares 7/10 of the top-10; `vsearch` 7.3/10 (single-word queries vs qmd's pure vector search). `find-similar` shares 9.3/10, and clustering reproduces 45 of 46 clusters. qimg: `tsearch` 9.4/10, `vsearch` and `hsearch` 8.2/10 (single words 8–10, phrases such as "two people talking" down to 5).

## Architecture

### Project Structure

```
src/
├── main.ts                 # Plugin entry point & lifecycle
├── constants.ts            # Configuration defaults
├── types.ts                # TypeScript interfaces
├── settings.ts             # Settings schema
├── settingsTab.ts          # Settings UI
├── parser.ts               # Note parsing & metadata extraction
│
├── embedding/              # Embedding pipeline
│   ├── ollamaClient.ts     # Ollama API client
│   ├── embedPipeline.ts    # Vault embedding orchestration
│   ├── chunker.ts          # Text chunking
│   └── vectorStore.ts      # Vector storage & similarity search
│
├── rag/                    # RAG implementation
│   ├── retrieval.ts        # Similarity search
│   ├── prompts.ts          # System prompts for each mode
│   └── modes.ts            # Chat mode implementations
│
└── views/                  # Obsidian UI components
    ├── chatView.ts         # Main chat interface
    ├── relatedNotesView.ts # Related notes sidebar
    └── components.ts       # Shared UI helpers
```

### Data Flow

1. **Embedding**: Notes → Parser → Chunker → Ollama (embeddings) → Vector Store
2. **Retrieval**: Query → Ollama (embedding) → Vector Store (cosine similarity) → Top K notes
3. **Generation**: Query + Context → Ollama (LLM) → Streaming response

### Vector Store

- **Format**: JSON file with version tracking
- **Storage**: Configurable path (default: `.pkm-embeddings/embeddings.json`)
- **Search**: In-memory cosine similarity (fast for typical vaults)
- **Persistence**: Automatic save after embedding updates

## Development

### Build Commands

```bash
# Development mode (watch)
npm run dev

# Production build
npm run build
```

### TypeScript Configuration

- **Target**: ES2018
- **Module**: ESNext
- **Strict Mode**: Enabled
- **Source Maps**: Inline (dev), none (prod)

### Build System

- **Bundler**: esbuild (fast compilation)
- **Format**: CommonJS
- **Externals**: obsidian, electron, @codemirror/* packages
- **Tree Shaking**: Enabled

## Troubleshooting

### Ollama Connection Issues

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama
ollama serve
```

### Missing Embeddings

1. Open command palette
2. Run "Embed all notes"
3. Wait for completion (status bar shows progress)

### Notes Not Found

- Ensure notes have `uuid` frontmatter
- Check that `VAULT_PATH` is set correctly
- Verify content mode in settings matches your vault structure

## License

MIT

## Author

Idan Ariav

## Contributing

Contributions welcome! Please open an issue or PR.

---

**Note**: This plugin is in active development. Features and APIs may change.

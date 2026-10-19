# Lite backend plan — tool queries without the CLIs

Goal: when `qmd`/`qvoid` aren't installed (mobile, or a desktop without the tools), the plugin's
command console still answers the day-to-day **search** commands, from data the tools pre-export
into the vault. Not in scope: RAG chat modes, Ollama, setup/maintenance commands, qnode.
On desktop the lite backend is a fallback only — used when CLI detection isn't `healthy`.

Order: qmd → qvoid → plugin → smart-link migration → qimg (last).

## Decisions (agreed)

- Each tool owns an `export` command; the plugin only reads. No re-embedding at export time:
  vectors are read from the tool's own index. The exception is the **word table**, which is
  embedded once and then reused incrementally.
- Free-text query → vector = mean of the query's words' vectors from the word table (smart-link's
  approach), on mobile and desktop alike. Exact matches are handled first: if the query is an exported
  item, such as an existing ghost target, use that item's own vector.
- Exports live in `Scaffolding/Embeddings/<tool>/` (already git-ignored, `.gitignore:28`).
- smart-link's exporter is retired; smart-link reads the qmd + qvoid exports instead.
- Pure query logic is **imported**, not reimplemented: qmd's filter DSL (`src/query/lexer.ts`,
  `parser.ts` — no deps) and qvoid's `src/query.ts` (`filterLinks`, `projectFields`,
  `formatClustersJson`, `suggestCanonical` — type-only deps) are published as package subpath exports
  and bundled by esbuild.

## Shared format: `pkm-vectors` v1

```
Scaffolding/Embeddings/<tool>/
  manifest.json   { format: "pkm-vectors", version: 1, tool, model, dim, scale: 127,
                    exportedAt, items: [...], words: [...], ...tool-specific }
  vectors.bin     int8, row-major: items first, then words (dim bytes each)
```

- Vectors are L2-normalized, then `round(x * 127)`. Each row's score is a plain int dot product, and
  ranking is unaffected by the constant scale.
- `items[i]` carries enough to render a CLI-shaped result and detect staleness (see per-tool).
- Incremental: the exporter reuses rows whose `(id, hash, model, dim)` match the previous manifest.
- Plugin side: one `VectorSet` module (load, `embedQuery(text)`, `topK(vec, k, filter?)`).
  smart-link keeps its own copy of the same ~80 lines (two plugins, no shared package — acceptable).

## Status (2026-10-19)

- **Phase 1 done.** `qmd export` writes to `Scaffolding/Embeddings/qmd/`: 961 docs, 5,103 vectors,
  11.5k words, 8.5 MB. The first run takes ~45 s; reruns are fast because word vectors are reused.
  Format spec: `qmd/docs/EXPORT.md`. Findings that changed the plan:
  - Section-filtered collections (claims, concepts, maps, books) index only `## Notes`, so the export
    stores its own raw-file hash and per-chunk snippets instead of offsets into the file.
  - The word table also includes body words used at least 3 times. Common words + titles alone
    missed queries like "arrogance" and "groupthink".
  - Fidelity: the lite top-10 shares 7.3/10 docs with qmd's pure vector search on single-noun
    queries. 768 dims was no better than 512.
  - `qmd vsearch` always runs LLM expansion (`--no-expand` is ignored); logged in qmd's techdebt.
    Compare lite results against `searchVec`, not against `vsearch`.
- **Phase 2 done.** `qvoid export` writes to `Scaffolding/Embeddings/qvoid/`: `records.jsonl`
  (780 records) + 780 target vectors (384 dims, int8) + 12.3k words, 5.0 MB of vectors, ~7 s.
  Spec: `qvoid/docs/EXPORT.md`. Lite `find-similar` shares 9.3/10 of the CLI's top-10 on
  single-noun queries; `--cluster` @0.82 reproduces 45/46 clusters (one threshold-edge pair).
  Word table includes note words (≥3 uses under `origin_folders`). Link contexts alone missed
  everyday topic words, and 4 of the 15 eval queries returned nothing.
  `@idan_ariav/qvoid/query` exposes `filterLinks`/`projectFields` for the plugin.
- **Phase 3 done (pending a real-phone test).** `src/lite/` holds `vectorSet.ts` (shared int8 loader + word-mean
  query), `qmdLite.ts`, `qvoidLite.ts`, `fsearch.ts` (in-memory twin of qmd's `compile.ts`) and
  `liteClient.ts`. The console picks `LiteClient` per tool via `plugin.usesLiteMode()`.
  `isDesktopOnly` is now `false`; on mobile only the console command is registered. Checked in
  the vault with "Always use lite mode": `fsearch` tag filter 531 = 531, other filters within 1–8
  notes (live files vs. the CLI's last index); `tsearch` top-10 overlap 7.0/10; first keyword
  search 1.3 s (5 ms after). The indexed text is cut using Obsidian's cached heading positions instead
  of a per-note remark parse (5.8 s → 1.3 s).
  - Depends on the published `@idan_ariav/qmd@^2.5.1` and `@idan_ariav/qvoid@^0.5.0`
    (released 2026-10-19). 2.5.1 dropped qmd's leftover `typescript` peer dependency, which
    blocked installs into this TS 4.7 project. Only the `/query` subpaths get bundled, but the
    dev install pulls in the tools' full dependency trees (~550 MB of node_modules).
- **Phase 5 done (not released).** `qimg export` writes `Scaffolding/Embeddings/qimg/`: 366 images,
  366 SigLIP vectors (768 dims, int8), 6.8k words, 5.5 MB. The first run took 3.5 min (SigLIP text
  model, batched via the new `embedTexts`); reruns take seconds. Spec: `qimg/docs/EXPORT.md`. Before
  building, a prototype checked that SigLIP word averaging works: single words come out exact up to
  int8 rounding, phrases reach 6.3/10, and an "a picture of" template made it worse. Plugin:
  `src/lite/qimgLite.ts`. In-vault check against the CLI: `tsearch` 9.4/10, `vsearch`/`hsearch`
  8.2/10. `vsearch --image` works for images already in the export. The plugin needs no qimg code,
  so it doesn't depend on a qimg release.
- **Phase 4 done.** pkm-smart-link reads `<exportDir>/qmd` (notes: profile vector, else first
  chunk) and `<exportDir>/qvoid` (ghosts), each with its own word table. Note and ghost
  similarities are scaled by their own best match before merging. `tools/export-vectors.mjs`,
  `gray-matter` and `smart-link-vectors.*` were removed. Eval: queries recall@10 0.394 → 0.417,
  MRR 0.755 → 0.865; nouns recall@10 0.849 → 0.876, MRR 0.978 → 0.967, blind recall
  0.521 → 0.438 (one query lost its only hidden match, one gained).
  - `obsidian plugin:reload` doesn't reload pkm-rag (Lazy Plugins manages it). Use
    `app.plugins.disablePlugin` + `enablePlugin` via `obsidian eval`.
  - Found along the way: qmd cuts piped stdout off at 64 KB (logged in qmd's techdebt). This
    affects the plugin's normal CLI mode on large `--json` results.
- **Phase 3 step 1 done (mobile-safe load).** Node built-ins load lazily via
  `src/cli/nodeModules.ts`, detection returns `not-found` on mobile, and the wizard and notice are
  skipped there. The bundle's only module-scope require is `obsidian`. `isDesktopOnly` stays `true`
  until the lite backend exists; flipping it earlier would ship a plugin with nothing working on mobile.

## Phase 1 — qmd (`~/GitProjects/qmd`)

1. **Verify first:** check what `content_vectors.pos` is an offset into (the raw file, or the body
   after frontmatter) and how `documents.hash` is computed. The plugin must be able to recompute the
   hash with `crypto.subtle` sha256 from `vault.read()`. If it can't, the export stores its own sha256
   of the raw file per doc.
2. `qmd export [--out <dir>] [--dim 512]` (new `src/cli/commands/export.ts`):
   - items: every chunk (`hash_seq` → doc path, seq, pos, len) plus every profile vector
     (`PROFILE_KEY_PREFIX` rows), truncated to 512 dims (embeddinggemma supports truncation to
     shorter vectors (Matryoshka); smart-link's eval chose 512).
   - per-doc: `{path, collection, hash}`; manifest also maps `collections: {name: pathPrefix}`.
   - words: `common-words.txt` (moved here from pkm-smart-link) + every word in titles,
     embedded with `formatQueryForEmbedding`.
   - Size check: ~5.3k items + ~6k words × 512 B ≈ 5.8 MB.
3. Auto-export: when `export.path` is set in `index.yml`, run the export at the end of `qmd embed`.
4. `package.json` `exports["./query"]` → lexer + parser only (nothing that pulls sqlite/llama).
5. Docs: README command list, CLAUDE.md commands, `docs/ARCHITECTURE.md`, CHANGELOG `[Unreleased]`.

Verify: `qmd export` twice → second run reports 0 newly embedded; a test round-trips a known
chunk's int8 vector against `vectors_vec` (cosine > 0.99).

## Phase 2 — qvoid (`~/GitProjects/qvoid`)

1. `qvoid export [--out <dir>]`:
   - `records.jsonl` copied from `unresolved_links.jsonl` (780 records, ~0.7 MB).
   - items = `manifest.order` targets with their content hash, vectors int8 at full 384 dims
     (bge-small isn't trained for truncation (not Matryoshka), so dims stay at 384) ≈ 0.3 MB.
   - words: same word list, embedded **raw**, matching how `findSimilar` embeds a free-text query.
2. Auto-export at the end of `qvoid embed` when an export path is configured.
3. `package.json` `exports["./query"]` → `src/query.ts`.
4. Docs: README, CLAUDE.md, `docs/OVERVIEW.md` storage table, `docs/EMBEDDING.md`, CHANGELOG.

Verify: lite `find-similar --cluster` at 0.82 on the export gives the same clusters as the CLI.
(780² dot products — computed live in the plugin, so any `--threshold` works.)

## Phase 3 — plugin (`local-pkm-rag`)

1. **Mobile safety:** `fs`/`os`/`path`/`child_process` are top-level imports (`pathResolver.ts`,
   `processRunner.ts`, `binaryResolver.ts`) and will crash plugin load on mobile. Load them lazily
   behind `Platform.isDesktopApp`. Set `isDesktopOnly: false`, and on mobile register only the
   console view (RAG modes stay desktop-only).
2. `LiteClient` with the same surface the console uses (`detect`, `listCommands`, `runCommand`,
   `buildArgvPreview`). `cliConsoleView.getClient()` returns it when the CLI isn't `healthy`.
   `listCommands` returns only the commands below, with their existing schema `CommandNode`s, so
   forms render unchanged.
3. Commands, returning the CLI's `--json` shapes so `resultNormalizer` and the views stay unchanged:

   | Command | Lite implementation |
   |---|---|
   | qmd `vsearch` | `VectorSet` over chunks (+ profiles), best chunk per doc, collection filter |
   | qmd `tsearch` | MiniSearch (dependency) over vault files, built lazily, kept fresh via `vault.on("modify")` |
   | qmd `hsearch` | Reciprocal-rank fusion (RRF) of tsearch + vsearch; no expansion/rerank; result flagged `lite` |
   | qmd `fsearch` | imported qmd parser → evaluator over `metadataCache` (frontmatter, tags, headings, mtime/ctime, word count) |
   | qmd `get` | `vault.read` + `--section` via `metadataCache` headings |
   | qvoid `query` | imported `filterLinks` + `projectFields` over `records.jsonl` |
   | qvoid `find-similar` | `VectorSet` (exact-target shortcut first); `--cluster` via union-find live |

4. Console shows a "lite · exported <date>" badge. Vector hits whose doc hash changed since the
   export are marked stale and still shown.
5. Docs: README section on lite mode + how to enable exports.

Verify: on desktop, force lite mode via a hidden setting and compare top-10 overlap with the real CLI
on smart-link's `eval/queries.json` (vsearch, find-similar); `fsearch` results should be identical on
a few DSL queries. Then smoke-test on mobile.

## Phase 4 — smart-link migration (`pkm-smart-link`)

Loader reads `qmd/` (note items = profile rows only) and `qvoid/` (ghost items) as two
`VectorSet`s, each with its own word table; query vectors are computed per set. Delete
`tools/export-vectors.mjs` and `smart-link-vectors.*`. **Risk:** ghosts move from embeddinggemma
to bge-small space. Run `eval/run_eval.py` before and after; if ghost recall drops, qvoid export gains
an optional embeddinggemma vector set for ghosts (decide on data, not upfront).

## Phase 5 — qimg (later)

`qimg export`: image vectors (379 × 768 int8 ≈ 0.3 MB) + captions/OCR for MiniSearch + a SigLIP
text-tower word table. Word averaging in SigLIP space is unproven — eval before shipping vsearch.

## Open risks

- Word averaging is weak for long, sentence-like queries; hsearch's BM25 half compensates.
- Exports age between `embed` runs; staleness is surfaced, not hidden.
- Unrelated: `~/.local/share/qvoid/vault/vectors.npy` (15 MB, Apr 2026) looks like a leftover
  from an older format — candidate for cleanup.

# Deckbuilder: Autonomous Brief-to-Figma-Slides Pipeline

Deckbuilder is an autonomous workflow that takes a user brief and produces Figma Slides by combining figdeck (markdown-to-slides content generation) with Vibma (Figma manipulation via MCP). It eliminates the figdeck Figma plugin entirely — only the Vibma plugin is needed.

**Last updated:** 2026-03-02

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Usage](#usage)
- [Implementation](#implementation)
  - [Layer 1: Claude Code Skill](#layer-1-claude-code-skill-deckbuilder)
  - [Layer 2: Translator Module](#layer-2-translator-module-typescript)
  - [Layer 3: MCP Tool Executor](#layer-3-mcp-tool-executor)
- [Translator Internals](#translator-internals)
  - [Block-to-Tool Mapping](#block-to-tool-mapping)
  - [Parent ID Resolution](#parent-id-resolution)
  - [Style Resolution](#style-resolution)
  - [Layout Constants](#layout-constants)
- [File Inventory](#file-inventory)
- [Known Limitations](#known-limitations)
- [Testing](#testing)
- [Future Work](#future-work)

---

## Architecture Overview

```
User brief
    |
    v
Claude generates figdeck Markdown (.md file)
    |
    v
`figdeck build <file.md>` (CLI, headless — outputs JSON to stdout)
    |
    v
JSON array of slides
    |
    v
`create_slides_from_figdeck` MCP tool
    |
    v
Translator: figdeck JSON → VibmaCommand[] sequence
    |
    v
Executor: sequential Vibma tool calls with parent ID resolution
    |
    v
Figma Slides file populated with frames + text nodes
```

The key insight: `figdeck build` runs as a headless CLI command that parses markdown into structured JSON. The translator converts that JSON into a sequence of Vibma MCP tool calls. The executor runs those calls sequentially, resolving parent frame IDs as they are created. No figdeck Figma plugin, no second WebSocket server — just one plugin (Vibma) and one port.

---

## Prerequisites

| Dependency | Version | Purpose |
|-----------|---------|---------|
| figdeck CLI | 1.5.1+ | Parses markdown into slide JSON |
| Vibma MCP server | 0.1.1+ | Bridge between Claude and Figma |
| Vibma Figma plugin | — | Runs inside Figma Desktop |
| Figma Desktop | — | Must have a **Figma Slides** file open |

figdeck CLI location: `~/.npm-global/lib/node_modules/figdeck/bin/figdeck.js`

---

## Usage

### Via Claude Code skill

Invoke with `/deckbuilder` or any of these trigger phrases:
- "build a deck"
- "make slides"
- "create a presentation"
- "slide deck from brief"

The skill orchestrates the full pipeline:

1. **Brief intake** — parses topic, audience, tone, slide count, brand colors
2. **Generate markdown** — writes figdeck-formatted `.md` to `decks/{slug}.md`
3. **Validate** — runs `figdeck build` to verify syntax and produce JSON
4. **Connection check** — calls Vibma `ping` tool
5. **Render** — passes JSON to `create_slides_from_figdeck` (preferred) or manually translates block-by-block (fallback)
6. **Report** — lists created slides, flags skipped blocks

### Direct MCP tool call

If you already have figdeck JSON, call the tool directly:

```
create_slides_from_figdeck({
  slides: [ ... figdeck build JSON array ... ]
})
```

Response:

```json
{
  "success": true,
  "slideCount": 5,
  "commandsExecuted": 23,
  "slides": [
    "Slide 1 - Cover (123:456)",
    "Slide 2 - Key Findings (123:457)",
    ...
  ],
  "warnings": [
    "Slide 3: Image block skipped (./chart.png). Vibma cannot import images — add manually in Figma."
  ]
}
```

---

## Implementation

The deckbuilder is implemented in two layers: a Claude Code skill for orchestration, and a TypeScript translator module for reliable, deterministic conversion.

### Layer 1: Claude Code Skill (`/deckbuilder`)

**File:** `~/.claude/skills/deckbuilder/SKILL.md`

The skill is a prompt document that instructs Claude how to orchestrate the full workflow. It references the figdeck skill (`~/.claude/skills/figdeck/SKILL.md`) for markdown syntax rules and frontmatter options.

The skill defines two rendering paths:
- **Preferred:** Call `create_slides_from_figdeck` with the full JSON array (single tool call)
- **Fallback:** Manually translate each block to individual Vibma tool calls (if the tool is unavailable)

Default dark theme frontmatter:

```yaml
---
background: "#0f172a"
color: "#f8fafc"
cover: true
headings:
  h1: { size: 72, weight: 700, color: "#f8fafc" }
  h2: { size: 48, weight: 600, color: "#e2e8f0" }
  h3: { size: 32, weight: 600, color: "#cbd5e1" }
paragraphs: { size: 24, lineHeight: 150 }
bullets: { size: 22 }
slideNumber:
  show: false
---
```

### Layer 2: Translator Module (TypeScript)

Located at `src/translator/`. A pure-function module that converts figdeck JSON into an ordered array of `VibmaCommand` objects. No async operations, no Figma API calls — just data transformation.

**Entry point:**

```typescript
import { translateDeck } from "./translator";
import type { FigdeckSlide, TranslationResult } from "./translator";

const result: TranslationResult = translateDeck(slides);
// result.commands   — VibmaCommand[] to execute sequentially
// result.warnings   — string[] of skipped blocks
// result.slideCount — number of slides
```

**Module structure:**

| File | Responsibility | Lines |
|------|---------------|-------|
| `types.ts` | TypeScript interfaces for figdeck JSON + Vibma commands | 187 |
| `layout.ts` | Layout constants, style resolution, color utilities | 111 |
| `figdeck-to-vibma.ts` | Core translator — block-to-command mapping | 572 |
| `index.ts` | Barrel exports | 11 |

### Layer 3: MCP Tool Executor

**File:** `src/tools/slides.ts`

Registers the `create_slides_from_figdeck` MCP tool. Accepts the figdeck JSON array, calls `translateDeck()`, then executes the resulting commands sequentially via `sendCommand()`.

The executor maintains an `idStore` (Map<string, string>) to resolve deferred parent ID references. It injects the real Figma node ID into each command's `items` array before execution.

**Registration:** Imported and called in `src/tools/mcp-registry.ts`. An empty `figmaHandlers` map is spread into `src/tools/figma-registry.ts` (this tool runs entirely MCP-side, no plugin handler needed).

---

## Translator Internals

### Block-to-Tool Mapping

| Figdeck Block | Vibma Tool(s) | Notes |
|--------------|---------------|-------|
| **Slide container** | `create_frame` | 1920x1080, VERTICAL auto-layout, 100px padding all sides, 24px item spacing |
| **heading** (H1-H4) | `create_text` | Font size by level: H1=72/700w, H2=48/600w, H3=32/600w, H4=28/600w |
| **paragraph** | `create_text` | 24px/400w default, respects frontmatter overrides |
| **bullets** | `create_text` | Flattened to single text node with newline-separated lines |
| **code** | `create_frame` + `create_text` | Dark bg frame (#1e293b, cornerRadius 8, padding 24) with code text inside |
| **blockquote** | `create_frame` + `create_text` | Left stroke #3b82f6 weight 3, padded container |
| **callout** | `create_frame` + 2x `create_text` | Colored left stroke, label text (bold, accent color) + body text |
| **table** | `create_frame` (container) + row frames + cell text | Header row dark bg #334155 bold; even data rows #1e293b |
| **columns** | `create_frame` (HORIZONTAL) + column frames (VERTICAL) | Recursive `translateBlock()` for column contents |
| **image** | skipped | Warning: "add manually in Figma" |
| **figma embed** | skipped | Warning: "use Figma's native component instance" |

### Bullets Detail

Bullet lists are flattened into a single `create_text` call. Each nesting level gets:
- 4-space indent per level
- Different bullet character: level 0 = `•`, level 1 = `◦`, level 2 = `▪`, level 3+ = `▹`
- Ordered lists use numbered prefixes (`1.`, `2.`, etc.)
- Nested children respect `childrenOrdered` and `childrenStart` from figdeck JSON

### Tables Detail

Tables are constructed as nested auto-layout frames:

```
Table (VERTICAL, spacing 0, FILL horizontal, HUG vertical)
  ├── Header Row (HORIZONTAL, fillColor #334155, padding 12/16)
  │     ├── Cell 1 (text, bold, #f8fafc, FILL)
  │     └── Cell 2 (text, bold, #f8fafc, FILL)
  ├── Row 1 (HORIZONTAL, fillColor #1e293b, padding 10/16)  ← even rows get dark bg
  │     ├── Cell 1 (text, FILL)
  │     └── Cell 2 (text, FILL)
  └── Row 2 (HORIZONTAL, padding 10/16)                     ← odd rows transparent
        ├── Cell 1 (text, FILL)
        └── Cell 2 (text, FILL)
```

### Columns Detail

Three-level nesting:

```
Columns (HORIZONTAL, gap from block.gap or 32px, FILL horizontal, HUG vertical)
  ├── Column 1 (VERTICAL, spacing 24px, FILL horizontal, HUG vertical)
  │     └── ... blocks (recursive translateBlock calls)
  └── Column 2 (VERTICAL, spacing 24px, FILL horizontal, HUG vertical)
        └── ... blocks
```

### Parent ID Resolution

The translator produces commands that reference parent frames not yet created. This is solved with a `storeIdAs` / `parentRef` system:

```
Command 1: create_frame  → storeIdAs: "slide_0"
                           (executor stores returned Figma node ID under key "slide_0")

Command 2: create_text   → parentRef: "slide_0"
                           (executor looks up "slide_0" in idStore, injects real ID as parentId)

Command 3: create_frame  → parentRef: "slide_0", storeIdAs: "slide_0_code_a8f3e2"
                           (nested frame — both references a parent AND stores its own ID)

Command 4: create_text   → parentRef: "slide_0_code_a8f3e2"
                           (text inside the code block frame)
```

This keeps the translator as a pure function while the executor in `slides.ts` handles sequential execution:

```typescript
const idStore = new Map<string, string>();

for (const cmd of result.commands) {
  // Resolve parentRef → inject parentId into items array
  const params = resolveParentRef(cmd, idStore);

  // Execute via Vibma
  const response = await sendCommand(cmd.tool, params);

  // Store result ID if requested
  if (cmd.storeIdAs && response?.results?.[0]?.id) {
    idStore.set(cmd.storeIdAs, response.results[0].id);
  }
}
```

If a `parentRef` is not found in the idStore, the executor throws with a diagnostic message listing all available keys.

### Style Resolution

Custom figdeck frontmatter styles are merged with defaults. The resolution chain:

```
figdeck frontmatter → FigdeckStyles on each slide → resolveXxxStyle() → merged result
```

Resolution functions in `layout.ts`:

| Function | Merges | Defaults |
|----------|--------|----------|
| `resolveHeadingStyle(level, styles)` | `styles.headings.h{N}` | H1: 72/700, H2: 48/600, H3: 32/600, H4: 28/600 |
| `resolveParagraphStyle(styles)` | `styles.paragraphs` | size: 24, weight: 400, lineHeight: 150 |
| `resolveBulletStyle(styles)` | `styles.bullets` | size: 22, spacing: 16 |
| `resolveCodeStyle(styles)` | `styles.code` | size: 18, bg: #1e293b, color: #e2e8f0 |

Text color inheritance: heading blocks fall back to `styles.paragraphs.color` if no heading-specific color is set.

### Layout Constants

Defined in `layout.ts`:

| Constant | Value | Purpose |
|----------|-------|---------|
| `SLIDE_WIDTH` | 1920 | Standard Figma Slides width |
| `SLIDE_HEIGHT` | 1080 | Standard Figma Slides height |
| `SLIDE_PADDING` | 100 | Padding inside slide frame (all sides) |
| `CONTENT_WIDTH` | 1720 | Effective content width (1920 - 2*100) |
| `BLOCK_SPACING` | 24 | Vertical gap between content blocks |
| `BULLET_INDENT` | 32 | Horizontal indent per bullet nesting level |
| `BULLET_CHARS` | `["•","◦","▪","▹"]` | Bullet characters by nesting depth |

Callout accent colors:

| Type | Color | Label |
|------|-------|-------|
| tip | #22c55e | Tip |
| warning | #eab308 | Warning |
| caution | #ef4444 | Caution |
| note | #3b82f6 | Note |

### Color Utilities

`hexToRgba(hex)` converts hex color strings to Vibma's 0-1 RGBA format:

```typescript
hexToRgba("#ff0000")  // → { r: 1, g: 0, b: 0 }
hexToRgba("#ff000080") // → { r: 1, g: 0, b: 0, a: 0.502 }
hexToRgba("#f00")      // → { r: 1, g: 0, b: 0 }  (shorthand supported)
```

Handles 3, 4, 6, and 8 character hex strings. Returns `null` on invalid input.

---

## File Inventory

### New files

| File | Type | Lines | Purpose |
|------|------|-------|---------|
| `~/.claude/skills/deckbuilder/SKILL.md` | Skill prompt | ~176 | Claude Code orchestration instructions |
| `src/translator/types.ts` | TypeScript | 187 | Interfaces for figdeck JSON, VibmaCommand, TranslationResult |
| `src/translator/layout.ts` | TypeScript | 111 | Layout constants, style resolution, hexToRgba, callout colors |
| `src/translator/figdeck-to-vibma.ts` | TypeScript | 572 | Core translator — all block-to-command mapping |
| `src/translator/index.ts` | TypeScript | 11 | Barrel exports |
| `src/tools/slides.ts` | TypeScript | 92 | MCP tool registration + sequential executor |

### Modified files

| File | Change |
|------|--------|
| `src/tools/mcp-registry.ts` | +2 lines: import `registerSlides`, call in `registerAllTools()` |
| `src/tools/figma-registry.ts` | +2 lines: import `slidesHandlers`, spread into `allFigmaHandlers` |

### Build output

- MCP server: 101KB ESM + 107KB CJS
- Plugin: 724KB IIFE
- Zero new TypeScript errors (2 pre-existing unrelated errors in create-text.ts and text.ts)

---

## Known Limitations

### 1. Figma Slides API Gap (validation gate)

`create_frame` in a Figma Slides file may create regular frames instead of slide-type frames. The Figma Slides API uses `figma.createSlide()` to create actual presentation slides, which is different from `figma.createFrame()`.

**Impact:** Created frames may not appear in Figma's presentation mode (Play button).

**Mitigation:** If confirmed, add a `create_slide` handler to the Vibma Figma plugin that calls `figma.createSlide()`. The translator's `create_frame` calls for slide containers would then switch to `create_slide`.

**Status:** Untested. This is the primary validation gate — end-to-end testing will reveal whether this is needed.

### 2. Rich Text Spans

figdeck supports mixed bold/italic/strikethrough/code/link formatting within a paragraph via `FigdeckSpan[]`. The translator flattens spans to plain text (`spansToText()` concatenates span text only).

**Impact:** Inline formatting is lost. A paragraph with "This is **bold** and *italic*" renders as "This is bold and italic" with uniform weight.

**Mitigation:** Would require Figma's `setRangeFontName()` / `setRangeFontSize()` APIs, which need either a new Vibma tool or an enhancement to `create_text` that accepts character ranges.

### 3. Images

Vibma has no image import capability. Image blocks emit a warning: "Vibma cannot import images — add manually in Figma."

**Mitigation:** A future `import_image` tool would need to handle base64 encoding, Figma's `createImage()` API, and sizing/positioning.

### 4. Slide Ordering

Frames are created sequentially on the current page. In a Slides file, presentation order depends on layer order.

**Impact:** Slides may appear in reverse order in presentation mode.

**Mitigation:** Manual reordering in Figma's layer panel, or add programmatic z-order control.

### 5. Font Availability

The translator assumes Inter font (Vibma's default). figdeck frontmatter supports custom fonts via `fonts:` config, but the translator does not pass font family through to `create_text`.

**Mitigation:** Map figdeck font names to Vibma's `fontFamily` parameter (not yet exposed in the `create_text` schema).

### 6. Gradient/Image Backgrounds

Only `background.solid` (hex color) is handled. `background.gradient` and `background.image` from figdeck are silently ignored. Solid colors cover ~90% of practical use cases.

---

## Testing

### Manual test procedure

1. Open Figma Desktop, create a new Figma Slides file (File > New > Presentation)
2. Run the Vibma plugin (Right-click > Plugins > Vibma)
3. Verify connection: call `ping` tool
4. Run `/deckbuilder` with a simple brief: "3 slides about quarterly results for the exec team"
5. Check results:
   - Do frames appear on the canvas?
   - Do frames appear as slides in presentation mode (Play button)?
   - Is text content correct (headings, paragraphs, bullets)?
   - Are code blocks and callouts styled correctly?
   - Are cover slides centered?

### Validation gates

| Gate | Test | Pass criteria |
|------|------|--------------|
| Slide creation | Created frames appear in presentation mode | If they don't, need `create_slide` plugin handler |
| Text rendering | Headings, paragraphs, bullets readable | Correct font sizes and weights |
| Nested structures | Code blocks, callouts, tables render | Proper nesting with backgrounds and borders |
| Cover alignment | Cover slide is vertically and horizontally centered | `primaryAxisAlignItems: CENTER`, `counterAxisAlignItems: CENTER` |
| Style resolution | Custom frontmatter styles override defaults | Pass figdeck JSON with custom `styles` object |

### Build verification

```bash
cd /Users/tomsuharto/Documents/Obsidian\ Vault/Claude\ Code/Vibma
npm run build
```

Expected: clean build, no new TypeScript errors.

---

## Future Work

| Priority | Item | Effort | Depends on |
|----------|------|--------|-----------|
| **P0** | Test Figma Slides API — validate `create_frame` produces navigable slides | 30 min | Figma Slides file + Vibma connected |
| **P0** | Add `create_slide` handler if needed | 2-4 hrs | P0 test result |
| **P1** | Rich text spans — support mixed bold/italic/code within paragraphs | 4-8 hrs | New `create_text` range formatting support |
| **P1** | Image import tool for Vibma | 4-8 hrs | Figma `createImage()` API research |
| **P2** | Gradient backgrounds | 2 hrs | Figma gradient fill API |
| **P2** | Custom font family passthrough | 1 hr | Expose `fontFamily` in `create_text` schema |
| **P2** | Slide ordering control | 2 hrs | Figma layer order API |
| **P3** | Figma embed blocks | 4 hrs | Component instance resolution |

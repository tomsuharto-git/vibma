# Deckbuilder: Figdeck + Vibma Orchestrator

## Context

Tom wants an autonomous workflow that takes a brief and produces polished Figma Slides — combining figdeck (content generation via Markdown) with Vibma (design manipulation via MCP). Currently these are two separate tools requiring two separate Figma plugins with manual steps. The goal is to collapse this into a single-plugin, mostly-autonomous flow.

## Architecture: Vibma-Only (eliminates figdeck plugin)

```
User brief → Claude generates Markdown → `figdeck build` (headless JSON) → Vibma MCP creates slides in Figma
```

- `figdeck build` runs as a CLI command — no Figma plugin, no WebSocket server needed
- Vibma's MCP tools create the actual Figma Slides content
- Only the Vibma plugin needs to be connected (one plugin, one port)
- The figdeck Figma plugin is completely eliminated from the workflow

## Implementation: Two Phases

### Phase 1: Claude Code Skill (`/deckbuilder`) — works immediately

A SKILL.md that instructs Claude to orchestrate the full workflow using tools it already has access to (figdeck CLI + Vibma MCP).

**File:** `~/.claude/skills/deckbuilder/SKILL.md`

**Workflow the skill defines:**

1. **Brief intake** — parse topic, audience, tone, slide count
2. **Generate Markdown** — write figdeck-formatted .md file to `decks/{slug}.md` in cwd
3. **Validate** — run `figdeck build decks/{slug}.md` to verify syntax (JSON to stdout)
4. **Connection check** — call Vibma `ping` tool; if disconnected, show setup checklist
5. **Render to Figma** — Claude reads the markdown and translates each slide to Vibma MCP calls:
   - `create_frame` (1920x1080, background color) per slide
   - `create_text` for headings, paragraphs, bullets
   - `create_frame` for code blocks, callouts, columns
   - `set_fill_color`, `set_effects` for styling
6. **Enhancement pass** — optional polish (shadows, decorative elements, brand colors)
7. **Report** — list created slides, flag anything that needs manual adjustment (images, complex tables)

This works today with zero new code — Claude acts as the translator, using the figdeck SKILL.md for markdown syntax and Vibma MCP tools for Figma creation.

**References the existing skill:** `~/.claude/skills/figdeck/SKILL.md` for markdown syntax rules, font sizes, frontmatter options.

### Phase 2: Translator Module — makes it reliable and fast

A TypeScript module in the Vibma codebase that programmatically converts figdeck JSON to Vibma tool calls, exposed as a new MCP tool.

**New files in Vibma:**

| File | Purpose |
|------|---------|
| `src/translator/types.ts` | TypeScript interfaces for figdeck JSON (Slide, Block, Span) |
| `src/translator/layout.ts` | Y-position calculations, spacing, font size resolution |
| `src/translator/figdeck-to-vibma.ts` | Core mapper: figdeck Block → Vibma tool call sequence |
| `src/translator/index.ts` | Barrel export |
| `src/tools/slides.ts` | New MCP tool: `create_slides_from_figdeck` |

**Block-to-tool mapping:**

| Figdeck block | Vibma tool(s) |
|---------------|---------------|
| Slide container | `create_frame` (1920x1080, vertical auto-layout, padding 100px) |
| Heading (H1-H4) | `create_text` (fontSize: 72/48/32/28, bold) |
| Paragraph | `create_text` (fontSize from styles) |
| Bullet list | `create_text` per item (bullet char prefix, x-offset for nesting) |
| Code block | `create_frame` (dark bg #1e293b) + `create_text` (monospace) |
| Blockquote | `create_frame` (left border accent) + `create_text` |
| Table | `create_frame` per row + `create_text` per cell |
| Callout | `create_frame` (colored left border) + `create_text` |
| Columns | `create_frame` (HORIZONTAL layout) + column sub-frames |
| Background | `set_fill_color` on slide frame |
| Image | Flag as manual (Vibma has no image import tool yet) |

**Execution model:** Sequential per slide (need parent frame ID before creating children). ~2-3 Vibma tool calls per slide with batching. 10-slide deck = ~25 round trips = ~3 seconds.

**Updated skill:** Once the translator module exists, the SKILL.md switches to calling `create_slides_from_figdeck` with the JSON from `figdeck build`, instead of Claude manually translating each block.

**Modified existing file:** `src/tools/mcp-registry.ts` — import and register the new slides tool.

## Implementation Order

| Step | What | Deliverable |
|------|------|-------------|
| 1 | Create `/deckbuilder` SKILL.md | Working skill (Phase 1 complete) |
| 2 | Test end-to-end: brief → markdown → Vibma → Figma Slides | Validate the Slides API works with Vibma |
| 3 | Define translator types | `src/translator/types.ts` |
| 4 | Build translator + layout engine | `src/translator/figdeck-to-vibma.ts`, `layout.ts` |
| 5 | Register `create_slides_from_figdeck` MCP tool | `src/tools/slides.ts` |
| 6 | Update SKILL.md to use the new tool | Phase 2 complete |

**Stop-point:** Step 2 is a validation gate. If Vibma's `create_frame` doesn't create proper slide elements in a Figma Slides file, we'll need to add a `create_slide` handler to the Figma plugin (using Figma's slides API). This is the main unknown.

## Known Risks

1. **Figma Slides API gap** — `create_frame` in a Slides file may not produce slide-type frames. May need plugin-side `figma.createSlide()` handler.
2. **Rich text spans** — figdeck supports mixed bold/italic within a paragraph. Vibma's `create_text` only supports uniform fontWeight. V2 concern.
3. **Images** — Vibma has no image import tool. Image slides flagged as "needs manual adjustment."
4. **Slide ordering** — need to verify frames appear in correct presentation order.

## Verification

1. Run `/deckbuilder` with a simple 3-slide brief
2. Confirm slides appear in Figma Slides presentation mode
3. Verify text content, headings, bullets render correctly
4. Run Figma presentation mode to confirm slides are navigable

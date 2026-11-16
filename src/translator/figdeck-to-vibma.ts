// ─── Figdeck → Vibma Translator ─────────────────────────────────
// Converts figdeck JSON slide array into a sequence of Vibma MCP commands.

import type {
  FigdeckSlide, FigdeckBlock, BulletItem, FigdeckSpan,
  VibmaCommand, TranslationResult,
} from "./types";
import {
  SLIDE_WIDTH, SLIDE_HEIGHT, SLIDE_PADDING, CONTENT_WIDTH,
  BLOCK_SPACING, BULLET_INDENT, BULLET_CHARS,
  resolveHeadingStyle, resolveParagraphStyle, resolveBulletStyle, resolveCodeStyle,
  hexToRgba, CALLOUT_COLORS, CALLOUT_LABELS,
} from "./layout";

/**
 * Translate an array of figdeck slides into Vibma MCP commands.
 * Each slide becomes a frame + child elements. Commands use storeIdAs/parentRef
 * for deferred parent ID resolution during execution.
 */
export function translateDeck(slides: FigdeckSlide[]): TranslationResult {
  const commands: VibmaCommand[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const slideRef = `slide_${i}`;
    const slideTitle = getSlideTitle(slide, i);

    // Determine alignment
    const isCover = slide.cover === true;
    const hAlign = slide.align || (isCover ? "center" : "left");
    const vAlign = slide.valign || (isCover ? "middle" : "top");

    // Create slide frame
    const bgColor = slide.background?.solid || "#0f172a";
    commands.push({
      tool: "create_frame",
      params: {
        items: [{
          name: `Slide ${i + 1} - ${slideTitle}`,
          width: SLIDE_WIDTH,
          height: SLIDE_HEIGHT,
          fillColor: bgColor,
          layoutMode: "VERTICAL",
          paddingTop: SLIDE_PADDING,
          paddingRight: SLIDE_PADDING,
          paddingBottom: SLIDE_PADDING,
          paddingLeft: SLIDE_PADDING,
          itemSpacing: BLOCK_SPACING,
          primaryAxisAlignItems: vAlignToFigma(vAlign),
          counterAxisAlignItems: hAlignToFigma(hAlign),
          layoutSizingHorizontal: "FIXED",
          layoutSizingVertical: "FIXED",
        }],
      },
      storeIdAs: slideRef,
    });

    // Translate each block
    for (const block of slide.blocks) {
      translateBlock(block, slideRef, slide, hAlign, commands, warnings, i);
    }
  }

  return { commands, warnings, slideCount: slides.length };
}

// ─── Block Translators ──────────────────────────────────────────

function translateBlock(
  block: FigdeckBlock,
  parentRef: string,
  slide: FigdeckSlide,
  hAlign: string,
  commands: VibmaCommand[],
  warnings: string[],
  slideIndex: number,
): void {
  switch (block.kind) {
    case "heading":
      translateHeading(block, parentRef, slide, hAlign, commands);
      break;
    case "paragraph":
      translateParagraph(block, parentRef, slide, hAlign, commands);
      break;
    case "bullets":
      translateBullets(block, parentRef, slide, hAlign, commands);
      break;
    case "code":
      translateCode(block, parentRef, slide, commands);
      break;
    case "blockquote":
      translateBlockquote(block, parentRef, slide, hAlign, commands);
      break;
    case "callout":
      translateCallout(block, parentRef, slide, hAlign, commands);
      break;
    case "table":
      translateTable(block, parentRef, slide, commands);
      break;
    case "columns":
      translateColumns(block, parentRef, slide, hAlign, commands, warnings, slideIndex);
      break;
    case "image":
      warnings.push(`Slide ${slideIndex + 1}: Image block skipped (${block.url}). Vibma cannot import images — add manually in Figma.`);
      break;
    case "figma":
      warnings.push(`Slide ${slideIndex + 1}: Figma embed block skipped (${block.link}). Use Figma's native component instance instead.`);
      break;
  }
}

function translateHeading(
  block: Extract<FigdeckBlock, { kind: "heading" }>,
  parentRef: string,
  slide: FigdeckSlide,
  hAlign: string,
  commands: VibmaCommand[],
): void {
  const style = resolveHeadingStyle(block.level, slide.styles);
  const textColor = style.color || slide.styles?.paragraphs?.color;

  commands.push({
    tool: "create_text",
    params: {
      items: [{
        text: block.text,
        fontSize: style.size,
        fontWeight: style.weight,
        ...(textColor ? { fontColor: textColor } : {}),
        textAlignHorizontal: hAlignToText(hAlign),
        layoutSizingHorizontal: "FILL",
      }],
    },
    parentRef,
  });
}

function translateParagraph(
  block: Extract<FigdeckBlock, { kind: "paragraph" }>,
  parentRef: string,
  slide: FigdeckSlide,
  hAlign: string,
  commands: VibmaCommand[],
): void {
  const style = resolveParagraphStyle(slide.styles);

  commands.push({
    tool: "create_text",
    params: {
      items: [{
        text: block.text,
        fontSize: style.size,
        fontWeight: style.weight,
        ...(style.color ? { fontColor: style.color } : {}),
        textAlignHorizontal: hAlignToText(hAlign),
        layoutSizingHorizontal: "FILL",
      }],
    },
    parentRef,
  });
}

function translateBullets(
  block: Extract<FigdeckBlock, { kind: "bullets" }>,
  parentRef: string,
  slide: FigdeckSlide,
  hAlign: string,
  commands: VibmaCommand[],
): void {
  const style = resolveBulletStyle(slide.styles);

  // Flatten bullet tree into lines with indentation
  const lines = flattenBullets(block.items, 0, block.ordered ?? false, block.start ?? 1);
  const text = lines.join("\n");

  commands.push({
    tool: "create_text",
    params: {
      items: [{
        text,
        fontSize: style.size,
        ...(style.color ? { fontColor: style.color } : {}),
        textAlignHorizontal: hAlignToText(hAlign),
        layoutSizingHorizontal: "FILL",
      }],
    },
    parentRef,
  });
}

function flattenBullets(items: BulletItem[], level: number, ordered: boolean, start: number): string[] {
  const lines: string[] = [];
  const indent = "    ".repeat(level);
  const bullet = ordered ? null : (BULLET_CHARS[level] || BULLET_CHARS[BULLET_CHARS.length - 1]);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const prefix = ordered ? `${start + i}.` : bullet;
    lines.push(`${indent}${prefix} ${item.text}`);

    if (item.children?.length) {
      lines.push(
        ...flattenBullets(item.children, level + 1, item.childrenOrdered ?? false, item.childrenStart ?? 1),
      );
    }
  }
  return lines;
}

function translateCode(
  block: Extract<FigdeckBlock, { kind: "code" }>,
  parentRef: string,
  slide: FigdeckSlide,
  commands: VibmaCommand[],
): void {
  const style = resolveCodeStyle(slide.styles);
  const codeFrameRef = `${parentRef}_code_${Math.random().toString(36).slice(2, 8)}`;

  // Container frame with dark background
  commands.push({
    tool: "create_frame",
    params: {
      items: [{
        name: `Code (${block.language})`,
        fillColor: style.background,
        cornerRadius: 8,
        layoutMode: "VERTICAL",
        paddingTop: 24,
        paddingRight: 24,
        paddingBottom: 24,
        paddingLeft: 24,
        layoutSizingHorizontal: "FILL",
        layoutSizingVertical: "HUG",
      }],
    },
    parentRef,
    storeIdAs: codeFrameRef,
  });

  // Code text inside
  commands.push({
    tool: "create_text",
    params: {
      items: [{
        text: block.code,
        fontSize: style.size,
        fontWeight: 400,
        fontColor: style.color,
        layoutSizingHorizontal: "FILL",
      }],
    },
    parentRef: codeFrameRef,
  });
}

function translateBlockquote(
  block: Extract<FigdeckBlock, { kind: "blockquote" }>,
  parentRef: string,
  slide: FigdeckSlide,
  hAlign: string,
  commands: VibmaCommand[],
): void {
  const pStyle = resolveParagraphStyle(slide.styles);
  const quoteFrameRef = `${parentRef}_bq_${Math.random().toString(36).slice(2, 8)}`;

  // Quote container with left border accent
  commands.push({
    tool: "create_frame",
    params: {
      items: [{
        name: "Blockquote",
        strokeColor: "#3b82f6",
        strokeWeight: 3,
        layoutMode: "VERTICAL",
        paddingTop: 16,
        paddingRight: 24,
        paddingBottom: 16,
        paddingLeft: 24,
        layoutSizingHorizontal: "FILL",
        layoutSizingVertical: "HUG",
      }],
    },
    parentRef,
    storeIdAs: quoteFrameRef,
  });

  // Quote text
  commands.push({
    tool: "create_text",
    params: {
      items: [{
        text: block.text,
        fontSize: pStyle.size,
        fontWeight: 400,
        ...(pStyle.color ? { fontColor: pStyle.color } : {}),
        textAlignHorizontal: hAlignToText(hAlign),
        layoutSizingHorizontal: "FILL",
      }],
    },
    parentRef: quoteFrameRef,
  });
}

function translateCallout(
  block: Extract<FigdeckBlock, { kind: "callout" }>,
  parentRef: string,
  slide: FigdeckSlide,
  hAlign: string,
  commands: VibmaCommand[],
): void {
  const pStyle = resolveParagraphStyle(slide.styles);
  const accentColor = CALLOUT_COLORS[block.type] || CALLOUT_COLORS.note;
  const label = CALLOUT_LABELS[block.type] || "Note";
  const calloutFrameRef = `${parentRef}_callout_${Math.random().toString(36).slice(2, 8)}`;

  // Callout container
  commands.push({
    tool: "create_frame",
    params: {
      items: [{
        name: `Callout (${label})`,
        strokeColor: accentColor,
        strokeWeight: 3,
        cornerRadius: 8,
        layoutMode: "VERTICAL",
        paddingTop: 20,
        paddingRight: 24,
        paddingBottom: 20,
        paddingLeft: 24,
        itemSpacing: 8,
        layoutSizingHorizontal: "FILL",
        layoutSizingVertical: "HUG",
      }],
    },
    parentRef,
    storeIdAs: calloutFrameRef,
  });

  // Label text
  commands.push({
    tool: "create_text",
    params: {
      items: [{
        text: label,
        fontSize: 16,
        fontWeight: 700,
        fontColor: accentColor,
        layoutSizingHorizontal: "FILL",
      }],
    },
    parentRef: calloutFrameRef,
  });

  // Body text
  commands.push({
    tool: "create_text",
    params: {
      items: [{
        text: block.text,
        fontSize: pStyle.size,
        fontWeight: 400,
        ...(pStyle.color ? { fontColor: pStyle.color } : {}),
        textAlignHorizontal: hAlignToText(hAlign),
        layoutSizingHorizontal: "FILL",
      }],
    },
    parentRef: calloutFrameRef,
  });
}

function translateTable(
  block: Extract<FigdeckBlock, { kind: "table" }>,
  parentRef: string,
  slide: FigdeckSlide,
  commands: VibmaCommand[],
): void {
  const pStyle = resolveParagraphStyle(slide.styles);
  const tableRef = `${parentRef}_table_${Math.random().toString(36).slice(2, 8)}`;
  const colCount = block.headers.length;

  // Table container (vertical stack of rows)
  commands.push({
    tool: "create_frame",
    params: {
      items: [{
        name: "Table",
        layoutMode: "VERTICAL",
        itemSpacing: 0,
        layoutSizingHorizontal: "FILL",
        layoutSizingVertical: "HUG",
      }],
    },
    parentRef,
    storeIdAs: tableRef,
  });

  // Header row
  const headerRowRef = `${tableRef}_header`;
  commands.push({
    tool: "create_frame",
    params: {
      items: [{
        name: "Header Row",
        fillColor: "#334155",
        layoutMode: "HORIZONTAL",
        paddingTop: 12,
        paddingRight: 16,
        paddingBottom: 12,
        paddingLeft: 16,
        itemSpacing: 16,
        layoutSizingHorizontal: "FILL",
        layoutSizingVertical: "HUG",
      }],
    },
    parentRef: tableRef,
    storeIdAs: headerRowRef,
  });

  // Header cells
  const headerTexts = block.headers.map(spans => spansToText(spans));
  commands.push({
    tool: "create_text",
    params: {
      items: headerTexts.map(text => ({
        text,
        fontSize: pStyle.size - 2,
        fontWeight: 700,
        fontColor: "#f8fafc",
        layoutSizingHorizontal: "FILL",
      })),
    },
    parentRef: headerRowRef,
  });

  // Data rows
  for (let r = 0; r < block.rows.length; r++) {
    const row = block.rows[r];
    const rowRef = `${tableRef}_row_${r}`;
    const isEven = r % 2 === 0;

    commands.push({
      tool: "create_frame",
      params: {
        items: [{
          name: `Row ${r + 1}`,
          ...(isEven ? { fillColor: "#1e293b" } : {}),
          layoutMode: "HORIZONTAL",
          paddingTop: 10,
          paddingRight: 16,
          paddingBottom: 10,
          paddingLeft: 16,
          itemSpacing: 16,
          layoutSizingHorizontal: "FILL",
          layoutSizingVertical: "HUG",
        }],
      },
      parentRef: tableRef,
      storeIdAs: rowRef,
    });

    const cellTexts = row.map(spans => spansToText(spans));
    commands.push({
      tool: "create_text",
      params: {
        items: cellTexts.map(text => ({
          text,
          fontSize: pStyle.size - 2,
          fontWeight: 400,
          ...(pStyle.color ? { fontColor: pStyle.color } : {}),
          layoutSizingHorizontal: "FILL",
        })),
      },
      parentRef: rowRef,
    });
  }
}

function translateColumns(
  block: Extract<FigdeckBlock, { kind: "columns" }>,
  parentRef: string,
  slide: FigdeckSlide,
  hAlign: string,
  commands: VibmaCommand[],
  warnings: string[],
  slideIndex: number,
): void {
  const gap = block.gap ?? 32;
  const columnsRef = `${parentRef}_cols_${Math.random().toString(36).slice(2, 8)}`;

  // Horizontal container for columns
  commands.push({
    tool: "create_frame",
    params: {
      items: [{
        name: "Columns",
        layoutMode: "HORIZONTAL",
        itemSpacing: gap,
        layoutSizingHorizontal: "FILL",
        layoutSizingVertical: "HUG",
      }],
    },
    parentRef,
    storeIdAs: columnsRef,
  });

  // Each column as a vertical frame
  for (let c = 0; c < block.columns.length; c++) {
    const colRef = `${columnsRef}_col_${c}`;

    commands.push({
      tool: "create_frame",
      params: {
        items: [{
          name: `Column ${c + 1}`,
          layoutMode: "VERTICAL",
          itemSpacing: BLOCK_SPACING,
          layoutSizingHorizontal: "FILL",
          layoutSizingVertical: "HUG",
        }],
      },
      parentRef: columnsRef,
      storeIdAs: colRef,
    });

    // Recursively translate blocks inside each column
    for (const colBlock of block.columns[c]) {
      translateBlock(colBlock, colRef, slide, hAlign, commands, warnings, slideIndex);
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function getSlideTitle(slide: FigdeckSlide, index: number): string {
  for (const block of slide.blocks) {
    if (block.kind === "heading") return block.text;
  }
  return `Slide ${index + 1}`;
}

/** Convert vertical alignment to Figma primaryAxisAlignItems */
function vAlignToFigma(valign: string): "MIN" | "CENTER" | "MAX" {
  switch (valign) {
    case "middle": return "CENTER";
    case "bottom": return "MAX";
    default: return "MIN";
  }
}

/** Convert horizontal alignment to Figma counterAxisAlignItems */
function hAlignToFigma(halign: string): "MIN" | "CENTER" | "MAX" {
  switch (halign) {
    case "center": return "CENTER";
    case "right": return "MAX";
    default: return "MIN";
  }
}

/** Convert horizontal alignment to Figma textAlignHorizontal */
function hAlignToText(halign: string): "LEFT" | "CENTER" | "RIGHT" {
  switch (halign) {
    case "center": return "CENTER";
    case "right": return "RIGHT";
    default: return "LEFT";
  }
}

/** Flatten figdeck spans into plain text (rich text spans are a V2 concern) */
function spansToText(spans: FigdeckSpan[]): string {
  return spans.map(s => s.text).join("");
}

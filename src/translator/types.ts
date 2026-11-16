// ─── Figdeck JSON Types ─────────────────────────────────────────
// Matches the actual output of `figdeck build <file.md>`

/** Inline text span — may have formatting attributes */
export interface FigdeckSpan {
  text: string;
  type?: "bold" | "italic" | "strike" | "code" | "link";
  href?: string;
}

/** Heading block (H1-H4) */
export interface HeadingBlock {
  kind: "heading";
  level: 1 | 2 | 3 | 4;
  text: string;
  spans?: FigdeckSpan[];
}

/** Paragraph block */
export interface ParagraphBlock {
  kind: "paragraph";
  text: string;
  spans?: FigdeckSpan[];
}

/** Single bullet item */
export interface BulletItem {
  text: string;
  spans?: FigdeckSpan[];
  children?: BulletItem[];
  childrenOrdered?: boolean;
  childrenStart?: number;
}

/** Bullet list block */
export interface BulletsBlock {
  kind: "bullets";
  items: BulletItem[];
  ordered?: boolean;
  start?: number;
}

/** Fenced code block */
export interface CodeBlock {
  kind: "code";
  language: string;
  code: string;
}

/** Blockquote */
export interface BlockquoteBlock {
  kind: "blockquote";
  text: string;
  spans?: FigdeckSpan[];
}

/** Table block */
export interface TableBlock {
  kind: "table";
  headers: FigdeckSpan[][];  // array of columns, each column is spans
  rows: FigdeckSpan[][][];   // rows[row][col] = spans
  align?: (string | null)[];
}

/** Image block */
export interface ImageBlock {
  kind: "image";
  url: string;
  source?: "remote" | "local";
  alt?: string;
  size?: { width?: number; height?: number };
}

/** Callout block (tip, warning, caution, note) */
export interface CalloutBlock {
  kind: "callout";
  type: "tip" | "warning" | "caution" | "note";
  text: string;
  spans?: FigdeckSpan[];
}

/** Multi-column layout */
export interface ColumnsBlock {
  kind: "columns";
  columns: FigdeckBlock[][]; // each column is an array of blocks
  gap?: number;
  width?: string;            // e.g. "1fr/2fr"
}

/** Figma component embed (not used in translator — Vibma-specific) */
export interface FigmaBlock {
  kind: "figma";
  link: string;
}

/** Union of all block types */
export type FigdeckBlock =
  | HeadingBlock
  | ParagraphBlock
  | BulletsBlock
  | CodeBlock
  | BlockquoteBlock
  | TableBlock
  | ImageBlock
  | CalloutBlock
  | ColumnsBlock
  | FigmaBlock;

/** Heading style configuration */
export interface HeadingStyle {
  size?: number;
  weight?: number;
  color?: string;
}

/** Slide styles resolved from frontmatter */
export interface FigdeckStyles {
  headings?: {
    h1?: HeadingStyle;
    h2?: HeadingStyle;
    h3?: HeadingStyle;
    h4?: HeadingStyle;
  };
  paragraphs?: {
    size?: number;
    weight?: number;
    color?: string;
    lineHeight?: number;
    letterSpacing?: number;
  };
  bullets?: {
    size?: number;
    spacing?: number;
    color?: string;
  };
  code?: {
    size?: number;
    background?: string;
    color?: string;
  };
}

/** Background — figdeck outputs { solid: "#hex" } for solid colors */
export interface FigdeckBackground {
  solid?: string;
  gradient?: string;
  image?: string;
}

/** A single slide from figdeck build output */
export interface FigdeckSlide {
  blocks: FigdeckBlock[];
  background?: FigdeckBackground;
  styles?: FigdeckStyles;
  cover?: boolean;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  transition?: {
    type?: string;
    duration?: number;
    curve?: string;
  };
}

// ─── Vibma Command Types ────────────────────────────────────────
// Represents a sequence of Vibma MCP tool calls to execute

export interface VibmaCommand {
  /** The Vibma tool name (e.g. "create_frame", "create_text") */
  tool: string;
  /** Parameters for the tool call */
  params: Record<string, unknown>;
  /** Placeholder key — if set, the result's first item ID is stored under this key */
  storeIdAs?: string;
  /** Reference to a stored ID — replaces "{ref}" in parentId */
  parentRef?: string;
}

/** Result of translating a slide deck */
export interface TranslationResult {
  /** Ordered sequence of Vibma commands to execute */
  commands: VibmaCommand[];
  /** Warnings (e.g. skipped image blocks) */
  warnings: string[];
  /** Number of slides in the deck */
  slideCount: number;
}

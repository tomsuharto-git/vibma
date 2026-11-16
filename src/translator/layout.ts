// ─── Layout Constants & Utilities ───────────────────────────────
// Slide dimensions, spacing, and style resolution for the translator.

import type { FigdeckStyles, HeadingStyle } from "./types";

/** Figma Slides dimensions */
export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;

/** Default padding inside a slide frame */
export const SLIDE_PADDING = 100;

/** Content area = slide minus padding on both sides */
export const CONTENT_WIDTH = SLIDE_WIDTH - SLIDE_PADDING * 2;

/** Default spacing between content blocks */
export const BLOCK_SPACING = 24;

/** Bullet indentation per nesting level */
export const BULLET_INDENT = 32;

/** Bullet characters by nesting level */
export const BULLET_CHARS = ["•", "◦", "▪", "▹"];

// ─── Default Styles ─────────────────────────────────────────────

const DEFAULT_HEADING_STYLES: Record<string, HeadingStyle> = {
  h1: { size: 72, weight: 700 },
  h2: { size: 48, weight: 600 },
  h3: { size: 32, weight: 600 },
  h4: { size: 28, weight: 600 },
};

const DEFAULT_PARAGRAPH = { size: 24, weight: 400, lineHeight: 150 };
const DEFAULT_BULLETS = { size: 22, spacing: 16 };
const DEFAULT_CODE = { size: 18, background: "#1e293b", color: "#e2e8f0" };

// ─── Style Resolution ───────────────────────────────────────────

export function resolveHeadingStyle(
  level: number,
  styles?: FigdeckStyles,
): { size: number; weight: number; color?: string } {
  const key = `h${level}` as keyof NonNullable<FigdeckStyles["headings"]>;
  const custom = styles?.headings?.[key];
  const defaults = DEFAULT_HEADING_STYLES[key] || DEFAULT_HEADING_STYLES.h2;
  return {
    size: custom?.size ?? defaults.size!,
    weight: custom?.weight ?? defaults.weight!,
    color: custom?.color,
  };
}

export function resolveParagraphStyle(styles?: FigdeckStyles) {
  return {
    size: styles?.paragraphs?.size ?? DEFAULT_PARAGRAPH.size,
    weight: styles?.paragraphs?.weight ?? DEFAULT_PARAGRAPH.weight,
    color: styles?.paragraphs?.color,
    lineHeight: styles?.paragraphs?.lineHeight ?? DEFAULT_PARAGRAPH.lineHeight,
  };
}

export function resolveBulletStyle(styles?: FigdeckStyles) {
  return {
    size: styles?.bullets?.size ?? DEFAULT_BULLETS.size,
    spacing: styles?.bullets?.spacing ?? DEFAULT_BULLETS.spacing,
    color: styles?.bullets?.color,
  };
}

export function resolveCodeStyle(styles?: FigdeckStyles) {
  return {
    size: styles?.code?.size ?? DEFAULT_CODE.size,
    background: styles?.code?.background ?? DEFAULT_CODE.background,
    color: styles?.code?.color ?? DEFAULT_CODE.color,
  };
}

// ─── Color Utilities ────────────────────────────────────────────

/** Parse hex color to Vibma RGBA format (0-1 channels) */
export function hexToRgba(hex: string): { r: number; g: number; b: number; a?: number } | null {
  const m = hex.match(/^#?([0-9a-f]{3,8})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  if (h.length !== 6 && h.length !== 8) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  if (h.length === 8) return { r, g, b, a: parseInt(h.slice(6, 8), 16) / 255 };
  return { r, g, b };
}

// ─── Callout Colors ─────────────────────────────────────────────

export const CALLOUT_COLORS: Record<string, string> = {
  tip: "#22c55e",
  warning: "#eab308",
  caution: "#ef4444",
  note: "#3b82f6",
};

/** Callout label text */
export const CALLOUT_LABELS: Record<string, string> = {
  tip: "Tip",
  warning: "Warning",
  caution: "Caution",
  note: "Note",
};

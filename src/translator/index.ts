export { translateDeck } from "./figdeck-to-vibma";
export type {
  FigdeckSlide, FigdeckBlock, FigdeckSpan, FigdeckStyles, FigdeckBackground,
  HeadingBlock, ParagraphBlock, BulletsBlock, CodeBlock, BlockquoteBlock,
  TableBlock, ImageBlock, CalloutBlock, ColumnsBlock,
  VibmaCommand, TranslationResult,
} from "./types";
export {
  SLIDE_WIDTH, SLIDE_HEIGHT, SLIDE_PADDING, CONTENT_WIDTH,
  hexToRgba,
} from "./layout";

export interface TextOptions {
  /**
   * What a link becomes.
   * `'text'` (default) keeps the label, `'url'` keeps the destination, `'both'` writes
   * `label (destination)`.
   */
  links?: 'text' | 'url' | 'both';
  /** `'alt'` (default) keeps an image's alt text; `'drop'` removes the image entirely. */
  images?: 'alt' | 'drop';
  /** `'text'` (default) drops list markers; `'markers'` keeps `-` and `1.` in front of each item. */
  lists?: 'text' | 'markers';
  /** `'rows'` (default) writes each table row as tab-separated cells; `'drop'` removes tables. */
  tables?: 'rows' | 'drop';
  /**
   * `'strip'` (default) removes HTML tags and keeps the text between them, dropping `script` and
   * `style` contents outright. `'keep'` leaves HTML as written.
   */
  html?: 'strip' | 'keep';
  /** `'drop'` (default) removes YAML or TOML front matter; `'keep'` treats it as content. */
  frontMatter?: 'drop' | 'keep';
}

/** An option outside its allowed set. */
export declare class MarkdownTextError extends Error {
  readonly name: 'MarkdownTextError';
  constructor(message: string);
}

/**
 * Turn markdown into plain text.
 *
 * Block structure becomes blank-line-separated paragraphs. Code blocks and code spans keep their
 * contents exactly as written, escapes are resolved, HTML entities are decoded, and an autolink
 * keeps its target — which is the text it displays.
 *
 * This is a text extractor, not a CommonMark parser. The README lists what it does with each
 * construct.
 */
export declare function toText(markdown: string, options?: TextOptions): string;

/**
 * Decode the HTML entities markdown inherits from HTML — `&amp;`, `&#233;`, `&#x41;` and the named
 * entities in common use. Unknown names are left as written.
 */
export declare function decodeEntities(text: string): string;

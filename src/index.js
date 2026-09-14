// Turn markdown into plain text without destroying the text.
//
// The popular light option does this with a list of regular expressions, and that is why it strips
// the `**` out of a fenced code block, turns `` `__init__` `` into `init`, leaves `&amp;` undecoded,
// drops the target of an autolink, and carries an open ReDoS advisory. The correct options either
// pull in a full CommonMark toolchain or wrap a whole markdown parser.
//
// This does one forward pass. Blocks are recognised first — so a code fence is known to be a code
// fence before anything inside it is touched — and inline markup is removed only where it is
// actually markup. No expression here can backtrack, so adversarial input costs linear time.
//
// It is not a CommonMark parser and does not try to be. It is a text extractor, and the README says
// exactly what it does with each construct.

const DEFAULTS = {
  links: 'text',
  images: 'alt',
  lists: 'text',
  tables: 'rows',
  html: 'strip',
  frontMatter: 'drop',
};

export class MarkdownTextError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MarkdownTextError';
  }
}

// ---- entities ---------------------------------------------------------------------------------

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©',
  reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«',
  raquo: '»', deg: '°', plusmn: '±', times: '×', divide: '÷',
  frac12: '½', frac14: '¼', frac34: '¾', middot: '·', bull: '•',
  dagger: '†', euro: '€', pound: '£', yen: '¥', cent: '¢',
  sect: '§', para: '¶', micro: 'µ', larr: '←', rarr: '→',
  uarr: '↑', darr: '↓', harr: '↔', ne: '≠', le: '≤', ge: '≥',
  infin: '∞', sum: '∑', prod: '∏', radic: '√', asymp: '≈',
  equiv: '≡', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  pi: 'π', sigma: 'σ', omega: 'ω', lambda: 'λ', mu: 'μ',
  check: '✓', cross: '✗', star: '★', hearts: '♥',
};

// A single non-backtracking alternation: every branch is anchored and bounded.
const ENTITY = /&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g;

function codePoint(value) {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return '\ufffd';
  if (value === 0 || (value >= 0xd800 && value <= 0xdfff)) return '\ufffd';
  return String.fromCodePoint(value);
}

/** Decode the HTML entities markdown inherits from HTML. Unknown names are left alone. */
export function decodeEntities(text) {
  if (text.indexOf('&') === -1) return text;
  return text.replace(ENTITY, (whole, hex, decimal, name) => {
    if (hex !== undefined) return codePoint(parseInt(hex, 16));
    if (decimal !== undefined) return codePoint(Number(decimal));
    const known = NAMED[name];
    return known === undefined ? whole : known;
  });
}

// ---- inline ------------------------------------------------------------------------------------

const PUNCTUATION = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');

const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\n';
const looksLikeUri = (text) => /^[a-zA-Z][a-zA-Z0-9+.-]{1,31}:/.test(text);
const looksLikeEmail = (text) => /^[^\s<>@]+@[^\s<>@.]+(?:\.[^\s<>@.]+)+$/.test(text);

/**
 * Remove inline markup from one block of text. Code spans are copied out untouched, which is the
 * whole point: their contents are not markup and must not be treated as any.
 */
function inlineText(source, options) {
  let out = '';
  let i = 0;
  const length = source.length;
  const open = [];
  // Once a scan proves nothing closes a bracket or a parenthesis beyond some point, later ones stop
  // looking. Without this, a run of unmatched brackets costs quadratic time.
  const limits = {noBracketCloser: Infinity, noParenCloser: Infinity, noEmphasisCloser: Infinity};

  while (i < length) {
    const ch = source[i];

    // A backslash escape covers exactly one punctuation character.
    if (ch === '\\' && i + 1 < length) {
      const next = source[i + 1];
      if (next === '\n') { out += '\n'; i += 2; continue; }
      if (PUNCTUATION.has(next)) { out += next; i += 2; continue; }
      out += ch;
      i++;
      continue;
    }

    // A code span runs from a run of backticks to the next run of the same length.
    if (ch === '`') {
      let open = 0;
      while (i + open < length && source[i + open] === '`') open++;
      const fence = '`'.repeat(open);
      const close = source.indexOf(fence, i + open);
      const closeIsExact = close !== -1 && source[close + open] !== '`';
      if (close !== -1 && closeIsExact) {
        let content = source.slice(i + open, close);
        // One space of padding on each side is stripping, per CommonMark, but only if both sides
        // have it and the content is not all spaces.
        if (content.length > 2 && content[0] === ' ' && content[content.length - 1] === ' ' && content.trim() !== '') {
          content = content.slice(1, -1);
        }
        out += content.replace(/\n/g, ' ');
        i = close + open;
        continue;
      }
      out += fence;
      i += open;
      continue;
    }

    // An autolink carries its target as its text, so the target is what survives.
    if (ch === '<') {
      const close = source.indexOf('>', i + 1);
      if (close !== -1) {
        const inner = source.slice(i + 1, close);
        if (inner.length > 0 && inner.indexOf(' ') === -1 && (looksLikeUri(inner) || looksLikeEmail(inner))) {
          out += decodeEntities(inner);
          i = close + 1;
          continue;
        }
        // Otherwise it may be an HTML tag. A tag name is letters, digits and hyphens, and it ends
        // at whitespace or a slash — `<www.openjsf.org>` is neither an autolink nor a tag, so it
        // stays as written.
        if (options.html === 'strip' && /^\/?[a-zA-Z][a-zA-Z0-9-]*(?:[\s/][^<>]*)?$/.test(inner)) {
          i = close + 1;
          continue;
        }
        if (options.html === 'strip' && (inner.startsWith('!--') || inner.startsWith('?') || inner.startsWith('!'))) {
          i = close + 1;
          continue;
        }
      }
      out += ch;
      i++;
      continue;
    }

    // An image is a link with a leading bang; its alt text is the only text it has.
    if (ch === '!' && source[i + 1] === '[') {
      const parsed = readLink(source, i + 1, options.definitions, limits);
      if (parsed) {
        if (options.images === 'alt') out += inlineText(parsed.label, options);
        i = parsed.end;
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    if (ch === '[') {
      const parsed = readLink(source, i, options.definitions, limits);
      if (parsed) {
        const label = inlineText(parsed.label, options);
        if (options.links === 'text') out += label;
        else if (options.links === 'url') out += parsed.destination ? decodeEntities(parsed.destination) : label;
        else out += parsed.destination ? `${label} (${decodeEntities(parsed.destination)})` : label;
        i = parsed.end;
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    // Emphasis delimiters, by CommonMark's flanking rules. The rule that matters most here is the
    // one for `_`: it cannot open or close inside a word, which is why `my_variable_name` and
    // `https://example.com/a_b_c` keep their underscores.
    if (ch === '*' || ch === '_' || ch === '~') {
      let run = 0;
      while (i + run < length && source[i + run] === ch) run++;
      const before = i === 0 ? '\n' : source[i - 1];
      const after = i + run < length ? source[i + run] : '\n';
      const beforeSpace = isSpace(before);
      const afterSpace = isSpace(after);
      const beforePunctuation = PUNCTUATION.has(before);
      const afterPunctuation = PUNCTUATION.has(after);
      const leftFlanking = !afterSpace && (!afterPunctuation || beforeSpace || beforePunctuation);
      const rightFlanking = !beforeSpace && (!beforePunctuation || afterSpace || afterPunctuation);
      const canOpen = ch === '_' ? leftFlanking && (!rightFlanking || beforePunctuation) : leftFlanking;
      const canClose = ch === '_' ? rightFlanking && (!leftFlanking || afterPunctuation) : rightFlanking;

      if (canClose && open.length > 0 && open[open.length - 1] === ch) {
        open.pop();
        i += run;
        continue;
      }
      if (canOpen && i < limits.noEmphasisCloser && findCloser(source, i + run, ch, run) !== -1) {
        open.push(ch);
        i += run;
        continue;
      }
      if (canOpen) limits.noEmphasisCloser = Math.min(limits.noEmphasisCloser, i);
      out += ch.repeat(run);
      i += run;
      continue;
    }

    if (ch === '&') {
      const match = matchEntityAt(source, i);
      if (match) { out += match.text; i = match.end; continue; }
      out += ch;
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function matchEntityAt(source, start) {
  const limit = Math.min(source.length, start + 36);
  const semicolon = source.indexOf(';', start + 1);
  if (semicolon === -1 || semicolon > limit) return null;
  const decoded = decodeEntities(source.slice(start, semicolon + 1));
  if (decoded === source.slice(start, semicolon + 1)) return null;
  return {text: decoded, end: semicolon + 1};
}

/** Find the delimiter run that closes an emphasis run, without backtracking. */
function findCloser(source, from, ch, run) {
  for (let i = from; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue; }
    if (source[i] !== ch) continue;
    let length = 0;
    while (i + length < source.length && source[i + length] === ch) length++;
    const before = source[i - 1];
    if (length >= run && !isSpace(before)) return i;
    i += length - 1;
  }
  return -1;
}

/**
 * Read `[label](destination)` or `[label][reference]` starting at `[`. Returns null when the
 * brackets do not form a link, so the caller can emit them literally.
 */
function readLink(source, start, definitions, limits) {
  if (start >= limits.noBracketCloser) return null;
  let depth = 0;
  let i = start;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '`') {
      // A code span inside a label can contain brackets that are not structure.
      let open = 0;
      while (i + open < source.length && source[i + open] === '`') open++;
      const close = source.indexOf('`'.repeat(open), i + open);
      if (close !== -1) { i = close + open - 1; continue; }
    }
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0 || i >= source.length) {
    // Nothing after this point closes a bracket either, so later brackets need not look.
    limits.noBracketCloser = Math.min(limits.noBracketCloser, start);
    return null;
  }

  const label = source.slice(start + 1, i);
  let end = i + 1;

  if (source[end] === '(') {
    if (end >= limits.noParenCloser) return null;
    let parens = 1;
    let j = end + 1;
    for (; j < source.length && parens > 0; j++) {
      const ch = source[j];
      if (ch === '\\') { j++; continue; }
      if (ch === '(') parens++;
      else if (ch === ')') parens--;
      else if (ch === '\n' && source[j - 1] === '\n') return null;
    }
    if (parens !== 0) {
      limits.noParenCloser = Math.min(limits.noParenCloser, end);
      return null;
    }
    const inside = source.slice(end + 1, j - 1).trim();
    const destination = inside.startsWith('<') && inside.indexOf('>') !== -1
      ? inside.slice(1, inside.indexOf('>'))
      : inside.split(/\s+/)[0] ?? '';
    return {label, destination, end: j};
  }

  if (source[end] === '[') {
    const close = source.indexOf(']', end + 1);
    if (close !== -1) {
      const reference = source.slice(end + 1, close).trim() || label;
      if (definitions.has(normaliseLabel(reference))) return {label, destination: '', end: close + 1};
      return null;
    }
  }

  // A shortcut reference is a link only when something defines it; otherwise the brackets are text.
  return definitions.has(normaliseLabel(label)) ? {label, destination: '', end} : null;
}

const normaliseLabel = (label) => label.trim().replace(/\s+/g, ' ').toLowerCase();

/** Collect the reference definitions a document declares, so `[x]` is only a link when `x` exists. */
function collectDefinitions(lines) {
  const found = new Set();
  for (const line of lines) {
    const match = /^ {0,3}\[([^\]]{1,999})\]:[ \t]*\S/.exec(line);
    if (match) found.add(normaliseLabel(match[1]));
  }
  return found;
}

// ---- blocks ------------------------------------------------------------------------------------

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const THEMATIC = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const BULLET = /^([ \t]*)([-*+])([ \t]+)(.*)$/;
const ORDERED = /^([ \t]*)(\d{1,9})([.)])([ \t]+)(.*)$/;
const BLOCKQUOTE = /^ {0,3}> ?(.*)$/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-{1,}:?[ \t]*(?:\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/;
const HTML_BLOCK_OPEN = /^ {0,3}<(?:\/?[a-zA-Z][a-zA-Z0-9-]*(?=[\s/>])|!--|\?|![A-Z])/;
const LINK_DEFINITION = /^ {0,3}\[[^\]]{1,999}\]:[ \t]*\S+.*$/;
const FOOTNOTE_DEFINITION = /^ {0,3}\[\^[^\]]{1,999}\]:[ \t]*(.*)$/;

function stripFrontMatter(lines) {
  if (lines.length === 0) return lines;
  const first = lines[0].trim();
  const fence = first === '---' ? '---' : first === '+++' ? '+++' : null;
  if (!fence) return lines;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === fence) return lines.slice(i + 1);
  }
  return lines;
}

function tableCells(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\' && trimmed[i + 1] === '|') { current += '|'; i++; continue; }
    if (ch === '|') { cells.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/** Turn markdown into plain text. */
export function toText(markdown, options) {
  if (typeof markdown !== 'string') throw new TypeError('markdown must be a string');
  const settings = {...DEFAULTS, ...options};
  for (const [key, allowed] of [
    ['links', ['text', 'url', 'both']],
    ['images', ['alt', 'drop']],
    ['lists', ['text', 'markers']],
    ['tables', ['rows', 'drop']],
    ['html', ['strip', 'keep']],
    ['frontMatter', ['drop', 'keep']],
  ]) {
    if (!allowed.includes(settings[key])) {
      throw new MarkdownTextError(`${key} must be one of ${allowed.join(', ')}, got ${JSON.stringify(settings[key])}`);
    }
  }

  let source = markdown;
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  let lines = source.replace(/\r\n?/g, '\n').split('\n');
  if (settings.frontMatter === 'drop') lines = stripFrontMatter(lines);
  if (!settings.definitions) settings.definitions = collectDefinitions(lines);

  const blocks = [];
  let paragraph = [];
  let inList = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const joined = paragraph.join('\n');
    const text = inlineText(joined, settings).replace(/[ \t]*\n[ \t]*/g, '\n').trim();
    if (text) blocks.push(text);
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const marker = fence[1][0];
      const width = fence[1].length;
      const content = [];
      let closed = false;
      index++;
      for (; index < lines.length; index++) {
        const candidate = lines[index];
        const closing = new RegExp(`^ {0,3}${marker === '`' ? '`' : '~'}{${width},}[ \\t]*$`).exec(candidate);
        if (closing) { closed = true; break; }
        content.push(candidate);
      }
      void closed;
      // Code is the one thing that must survive exactly as written.
      const code = content.join('\n').replace(/\s+$/, '');
      if (code) blocks.push(code);
      continue;
    }

    if (line.trim() === '') { flushParagraph(); continue; }

    if (paragraph.length === 0 && !inList && /^ {4,}/.test(line)) {
      // An indented code block: gather the run and keep it verbatim.
      const content = [];
      for (; index < lines.length; index++) {
        const candidate = lines[index];
        if (candidate.trim() === '') { content.push(''); continue; }
        if (!/^ {4,}/.test(candidate)) break;
        content.push(candidate.slice(4));
      }
      index--;
      const code = content.join('\n').replace(/\s+$/, '');
      if (code) blocks.push(code);
      continue;
    }

    if (inList && !/^[ \t]/.test(line) && !BULLET.test(line) && !ORDERED.test(line)) inList = false;

    if (THEMATIC.test(line)) { flushParagraph(); inList = false; continue; }

    const atx = ATX.exec(line);
    if (atx) {
      flushParagraph();
      const text = inlineText(atx[2] ?? '', settings).trim();
      if (text) blocks.push(text);
      continue;
    }

    const setext = SETEXT.exec(line);
    if (setext && paragraph.length > 0) {
      flushParagraph();
      continue;
    }

    if (LINK_DEFINITION.test(line) && paragraph.length === 0 && !FOOTNOTE_DEFINITION.test(line)) continue;

    const footnote = FOOTNOTE_DEFINITION.exec(line);
    if (footnote && paragraph.length === 0) {
      const text = inlineText(footnote[1], settings).trim();
      if (text) blocks.push(text);
      continue;
    }

    const quote = BLOCKQUOTE.exec(line);
    if (quote) {
      flushParagraph();
      const inner = [quote[1]];
      for (index++; index < lines.length; index++) {
        const next = BLOCKQUOTE.exec(lines[index]);
        if (next) { inner.push(next[1]); continue; }
        if (lines[index].trim() === '') break;
        inner.push(lines[index]);
      }
      index--;
      const nested = toText(inner.join('\n'), settings);
      if (nested) blocks.push(nested);
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if ((bullet || ordered) && !THEMATIC.test(line)) {
      flushParagraph();
      const marker = bullet ? bullet[2] : `${ordered[2]}${ordered[3]}`;
      const rest = bullet ? bullet[4] : ordered[5];
      // A task list marker is structure, not text.
      const item = rest.replace(/^\[[ xX]\][ \t]+/, '');
      const text = inlineText(item, settings).trim();
      if (text) blocks.push(settings.lists === 'markers' ? `${marker} ${text}` : text);
      inList = true;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && TABLE_DELIMITER.test(lines[index + 1])) {
      flushParagraph();
      const rows = [tableCells(line)];
      index += 2;
      for (; index < lines.length; index++) {
        if (lines[index].trim() === '' || !lines[index].includes('|')) break;
        rows.push(tableCells(lines[index]));
      }
      index--;
      if (settings.tables === 'rows') {
        for (const row of rows) {
          const text = row.map((cell) => inlineText(cell, settings).trim()).filter(Boolean).join('\t');
          if (text) blocks.push(text);
        }
      }
      continue;
    }

    if (settings.html === 'strip' && paragraph.length === 0 && HTML_BLOCK_OPEN.test(line)) {
      const content = [];
      for (; index < lines.length; index++) {
        if (lines[index].trim() === '') break;
        content.push(lines[index]);
      }
      index--;
      const text = stripHtmlBlock(content.join('\n'), settings);
      if (text) blocks.push(text);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks.join('\n\n');
}

/** Remove tags from an HTML block, dropping the contents of script and style outright. */
function stripHtmlBlock(html, options) {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { out += html.slice(i); break; }
    out += html.slice(i, lt);
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    const name = /^<\s*(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt, lt + 40));
    const close = html.indexOf('>', lt);
    if (close === -1) { out += html.slice(lt); break; }
    if (name && !name[1] && (name[2].toLowerCase() === 'script' || name[2].toLowerCase() === 'style')) {
      const endTag = new RegExp(`</\\s*${name[2]}\\s*>`, 'i').exec(html.slice(close));
      i = endTag ? close + endTag.index + endTag[0].length : html.length;
      continue;
    }
    i = close + 1;
  }
  return inlineText(out, options).replace(/[ \t]*\n[ \t]*/g, '\n').trim();
}

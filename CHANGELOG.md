# Changelog

## 0.1.0

First release.

- `toText(markdown, options?)` turns markdown into plain text, keeping the contents of code blocks
  and code spans exactly as written, resolving escapes and HTML entities, and keeping the target of
  an autolink.
- `decodeEntities(text)` is exported for use on its own.
- Linear on adversarial input: nothing backtracks, and a scan that proves no delimiter closes beyond
  a point stops later scans from looking.
- Zero runtime dependencies. CommonJS and ESM, with types for both.

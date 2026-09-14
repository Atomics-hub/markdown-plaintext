# markdown-plaintext

Turn markdown into plain text without destroying the text. Zero dependencies.

```js
import {toText} from 'markdown-plaintext';

toText('Use `__init__` to set up:\n\n```js\nconst a = **not bold**;\n```');
// 'Use __init__ to set up:\n\nconst a = **not bold**;'
```

## The problem

Stripping markdown looks like a job for a few regular expressions, and that is how the popular light
package does it. It is also why that package turns `` `__init__` `` into `init`, strips the `**` out
of a fenced code block, leaves `&amp;` undecoded, drops the target of `<https://example.com>`, and
carries an open ReDoS advisory.

Across 34 README and documentation files from projects like Node, React, TypeScript, axios, fastify
and webpack — documents nobody involved here wrote — measured against what a CommonMark parser says
the document contains:

| package | weekly downloads | documents that lost text | fragments lost |
| --- | --- | --- | --- |
| `remove-markdown` | 782k | 21 of 34 | 621 |
| `markdown-to-txt` | 107k | 4 of 34 | 335 |
| **`markdown-plaintext`** | — | **0 of 34** | **0** |

What gets lost is not decoration. It is `import { createRoot } from 'react-dom/client'`, it is
`<script src="https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js">`, it is the download URLs from
Node's README, it is contributors' email addresses. For search indexing, embeddings or previews,
that is the content.

## Measured

### Correctness

The oracle is remark, a CommonMark parser: it says which literal strings a document contains, and
anything a converter drops that remark kept is text the caller lost. The test suite generates 400
documents covering every construct and holds the package to losing none of them, and the same
comparison runs over real documentation.

### Speed

46 real documents, 0.95 MB of markdown:

| converter | ms per pass | MB/s |
| --- | --- | --- |
| `remove-markdown` | 16.2 | 58.5 |
| **`markdown-plaintext`** | **46.5** | **20.3** |
| `markdown-to-txt` | 79.7 | 11.9 |
| `remark` + `mdast-util-to-string` | 726.1 | 1.3 |

`remove-markdown` is faster because it does less — it is running a list of replacements rather than
reading the document. Among converters that keep the text, this is the quickest, and it is 15x faster
than the fully correct route through a CommonMark toolchain.

### Adversarial input

`remove-markdown` has an open ReDoS advisory and an open issue from its own maintainer titled
"Investigate quadratic runtime for malformed delimiter-heavy inputs". Time to convert 16,000 repeats
of each shape:

| input | `remove-markdown` | `markdown-to-txt` | `markdown-plaintext` |
| --- | --- | --- | --- |
| `[` repeated | 187.9 ms | 102.6 ms | **0.5 ms** |
| `[a]` repeated | 378.0 ms | 16.3 ms | **2.3 ms** |
| `[a](b` repeated | 626.8 ms | 2,187.5 ms | **1.8 ms** |

Nothing here backtracks, and once a scan proves no bracket closes beyond a point, later brackets stop
looking. The test suite asserts that doubling the input does not multiply the time.

## Install

```bash
npm install markdown-plaintext
```

Node 18 or newer. No dependencies.

## Usage

### `toText(markdown, options?)`

```js
import {toText} from 'markdown-plaintext';

toText('# Title\n\nSee [the docs](https://example.com).');
// 'Title\n\nSee the docs'
```

| option | default | meaning |
| --- | --- | --- |
| `links` | `'text'` | `'url'` keeps the destination instead; `'both'` writes `label (destination)` |
| `images` | `'alt'` | `'drop'` removes images entirely |
| `lists` | `'text'` | `'markers'` keeps `-` and `1.` in front of each item |
| `tables` | `'rows'` | each row becomes tab-separated cells; `'drop'` removes tables |
| `html` | `'strip'` | tags go, their text stays, `script` and `style` contents go too; `'keep'` leaves HTML alone |
| `frontMatter` | `'drop'` | `'keep'` treats YAML or TOML front matter as content |

### `decodeEntities(text)`

The entity decoder used internally, exported because it is useful on its own. Handles `&amp;`,
`&#233;`, `&#x1F600;` and the named entities in common use; leaves unknown names as written.

## What it does with each construct

| markdown | becomes |
| --- | --- |
| fenced and indented code | its contents, **exactly as written** |
| code spans | their contents, exactly as written |
| headings | the heading text |
| emphasis, strong, strikethrough | the text inside |
| links | the label (see `links`) |
| images | the alt text (see `images`) |
| autolinks `<https://x>`, `<a@b.c>` | the target, which is what they display |
| lists and task lists | one item per line, markers and checkboxes removed |
| blockquotes | the quoted content |
| tables | one row per line, cells separated by tabs |
| thematic breaks | nothing |
| HTML | tags removed, text kept; `script` and `style` contents dropped |
| entities and escapes | resolved |
| front matter | nothing |
| link and footnote definitions | nothing |

Blocks are separated by a blank line. Text is never reflowed.

## What it is not

A CommonMark parser. It is a text extractor, and the table above is the whole contract. It reads
block structure first — so a code fence is known to be a code fence before anything inside it is
touched — and removes inline markup only where it is markup. Where the two disagree on something the
table does not cover, CommonMark is right and this is a simplification.

In particular: it does not render, it produces no HTML, it does not preserve exact spacing between
blocks, and it does not attempt list renumbering or nested-list indentation.

## Replacing `remove-markdown`

One thing to check before swapping. If your pipeline strips code *after* converting, like this:

```js
let content = removeMd(raw);
content = content.replace(/```[\s\S]*?```/g, '');   // no longer matches anything
content = content.replace(/`[^`]+`/g, '');
```

move the code-stripping *before* the conversion:

```js
const withoutCode = raw
  .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, '')
  .replace(/`[^`\n]+`/g, '');
const content = toText(withoutCode);
```

Every converter removes fence markers, so a regex looking for ` ``` ` after conversion has nothing
to match. `remove-markdown` appears to get away with it only because it mangles the code into
something unrecognisable — and that mangled code still reaches your index. Because this package keeps
code intact, leaving the ordering alone means *all* of it reaches your index instead.

Measured on one real consumer's search-index pipeline over 18 documentation files, counting fragments
that still look like source code: 183 as shipped, 504 with the converter swapped and the ordering
left alone, 71 with the code stripped first.

## Alternatives

- [`remove-markdown`](https://www.npmjs.com/package/remove-markdown) — regex-based, zero
  dependencies, much faster, and loses text in two thirds of the documents measured above.
- [`markdown-to-txt`](https://www.npmjs.com/package/markdown-to-txt) — wraps `marked`; more accurate
  than the regex approach. Its highest-voted open issue is that it has been uninstallable without an
  undeclared `lodash` since 2023.
- [`strip-markdown`](https://www.npmjs.com/package/strip-markdown) and
  [`mdast-util-to-string`](https://www.npmjs.com/package/mdast-util-to-string) — the correct route,
  through the unified toolchain. Use them if you already have an mdast tree, or if you need
  CommonMark exactness more than you need one small dependency.

## Licence

MIT

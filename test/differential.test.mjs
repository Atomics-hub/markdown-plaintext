// The correctness gate: a CommonMark parser decides what text a document contains.
//
// remark parses markdown to an mdast tree whose `text`, `inlineCode` and `code` nodes hold every
// literal the document actually says. Anything this package drops that remark kept is text the
// caller lost — which is the failure that makes a markdown-to-text converter useless for search,
// embeddings or previews. The test generates documents rather than checking in fixtures, so the
// cases are not ones the implementation was tuned against.
import assert from 'node:assert/strict';
import test from 'node:test';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import {toText} from '../src/index.js';

const parser = unified().use(remarkParse).use(remarkGfm);

function literals(markdown) {
  const tree = parser.parse(markdown);
  const out = [];
  const walk = (node) => {
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') out.push(node.value);
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return out;
}

// A fragment counts only when losing it would matter. A single character differing at a word
// boundary is a formatting choice; a missing identifier or URL is a bug.
const substantial = (value) => value.trim().length >= 6;

function lost(markdown) {
  const text = toText(markdown).replace(/\s+/g, ' ');
  return literals(markdown)
    .filter(substantial)
    .filter((fragment) => !text.includes(fragment.replace(/\s+/g, ' ').trim()));
}

let seed = 20260921;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const int = (n) => Math.floor(rnd() * n);
const pick = (list) => list[int(list.length)];

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
const word = () => pick(WORDS);
const phrase = (n = 4) => Array.from({length: n}, word).join(' ');

// Fragments that carry text a converter can lose: identifiers with underscores, URLs, code with
// markup characters in it, entities, escapes.
const PAYLOADS = [
  () => `${word()}_${word()}_${word()}`,
  () => `https://example.com/${word()}_${word()}?a=1&b=2`,
  () => `__${word()}__init__`,
  () => `${word()} &amp; ${word()}`,
  () => `caf&#233; ${word()}`,
  () => `\\*${word()}\\* literal`,
  () => `${word()}(url[, options])`,
  () => `a ${word()} b`,
];

const BLOCKS = [
  () => phrase(8),
  () => `# ${phrase(3)}`,
  () => `## ${pick(PAYLOADS)()}`,
  () => `${phrase(3)}\n${'='.repeat(3 + int(5))}`,
  () => '```' + (rnd() < 0.5 ? 'js' : '') + `\nconst ${word()} = **${word()}**; // # not a heading\n- not a list\n` + '```',
  () => `~~~\n${pick(PAYLOADS)()}\n**kept**\n~~~`,
  () => `    indented ${pick(PAYLOADS)()}\n    **kept**`,
  () => `- ${phrase(3)}\n- ${pick(PAYLOADS)()}\n- ${phrase(2)}`,
  () => `1. ${phrase(3)}\n2. ${pick(PAYLOADS)()}`,
  () => `> ${phrase(4)}\n> ${pick(PAYLOADS)()}`,
  () => `| ${word()} | ${word()} |\n| --- | --- |\n| ${pick(PAYLOADS)()} | ${phrase(2)} |`,
  () => `${phrase(2)} \`${pick(PAYLOADS)()}\` ${phrase(2)}`,
  () => `${phrase(2)} [${phrase(2)}](https://example.com/${word()}_${word()}) ${phrase(2)}`,
  () => `${phrase(2)} ![${phrase(2)}](image_${word()}.png)`,
  () => `<https://example.com/${word()}_${word()}>`,
  () => `<${word()}@example.com>`,
  () => `${phrase(2)} <b>${phrase(2)}</b> ${phrase(2)}`,
  () => `${phrase(2)} **${phrase(2)}** and *${word()}* and ~~${word()}~~`,
  () => `${phrase(2)}  \n${phrase(2)}`,
  () => `${phrase(2)} [${phrase(2)}][ref]\n\n[ref]: https://example.com/${word()}`,
  () => `***`,
  () => `<!-- ${phrase(3)} -->`,
  () => `${pick(PAYLOADS)()}`,
];

test('no substantial text is lost, against a CommonMark parser', () => {
  let documents = 0;
  let fragments = 0;
  for (let n = 0; n < 400; n++) {
    const blocks = Array.from({length: int(6) + 1}, () => pick(BLOCKS)());
    const markdown = blocks.join('\n\n');
    const missing = lost(markdown);
    documents++;
    fragments += literals(markdown).filter(substantial).length;
    assert.deepEqual(missing, [], `document ${n} lost text:\n${markdown}\n\n--- got ---\n${toText(markdown)}`);
  }
  assert.ok(documents === 400 && fragments > 1000, `checked ${fragments} fragments across ${documents} documents`);
});

test('front matter, BOM and line endings do not change the text', () => {
  const body = `# ${phrase(3)}\n\nsome ${phrase(4)} and \`code_span\` here.`;
  const expected = toText(body);
  assert.equal(toText('﻿' + body), expected);
  assert.equal(toText(body.replace(/\n/g, '\r\n')), expected);
  assert.equal(toText(`---\ntitle: x\ntags: [a, b]\n---\n\n${body}`), expected);
  assert.equal(toText(`+++\ntitle = "x"\n+++\n\n${body}`), expected);
});

test('adversarial input stays linear', () => {
  // remove-markdown carries an open ReDoS advisory and an open issue about quadratic runtime on
  // delimiter-heavy input.
  //
  // Growing the input eightfold is the measurement, not doubling it: linear work costs 8x and
  // quadratic work costs 64x, so the two are far enough apart to tell without a knife-edge
  // threshold. Each timing is the best of several runs, because the minimum is the one estimate a
  // garbage collection pause cannot inflate, and the slack term stops a baseline too small to
  // measure from turning scheduler noise into a ratio.
  const shapes = {
    'unmatched brackets': (n) => '['.repeat(n),
    'unmatched parentheses': (n) => '[a](b'.repeat(n),
    'unmatched backticks': (n) => '`'.repeat(n),
    'unmatched emphasis': (n) => '*'.repeat(n),
    'alternating brackets': (n) => '[a]'.repeat(n),
    'nested emphasis': (n) => '*'.repeat(n) + 'text' + '*'.repeat(n),
  };
  const best = (input) => {
    let ms = Infinity;
    for (let run = 0; run < 5; run++) {
      const started = process.hrtime.bigint();
      toText(input);
      ms = Math.min(ms, Number(process.hrtime.bigint() - started) / 1e6);
    }
    return ms;
  };
  for (const [name, build] of Object.entries(shapes)) {
    const small = build(8000);
    const large = build(64000);
    best(small);
    const a = best(small);
    const b = best(large);
    assert.ok(b < 400, `${name}: 64k units took ${b.toFixed(1)} ms`);
    assert.ok(b < a * 24 + 20, `${name}: eightfold input multiplied the time by ${(b / a).toFixed(1)}`);
  }
});

test('every document round-trips without throwing', () => {
  for (let n = 0; n < 300; n++) {
    const blocks = Array.from({length: int(5) + 1}, () => pick(BLOCKS)());
    // Truncate at a random point so half the constructs are unterminated.
    const markdown = blocks.join('\n\n').slice(0, int(400) + 1);
    assert.doesNotThrow(() => toText(markdown), `threw on:\n${markdown}`);
    for (const options of [{links: 'url'}, {links: 'both'}, {images: 'drop'}, {lists: 'markers'}, {tables: 'drop'}, {html: 'keep'}, {frontMatter: 'keep'}]) {
      assert.doesNotThrow(() => toText(markdown, options), `threw with ${JSON.stringify(options)}`);
    }
  }
});

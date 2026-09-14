import assert from 'node:assert/strict';
import test from 'node:test';
import * as api from '../src/index.js';
import {runChecks} from './checks.mjs';

const {toText, decodeEntities, MarkdownTextError} = api;

test('shared behavioural checks', () => {
  assert.ok(runChecks(api) >= 13);
});

test('a fenced block keeps its contents exactly, including the blank lines inside it', () => {
  const code = 'function f() {\n\n  return **1**;\n}';
  assert.equal(toText('```js\n' + code + '\n```'), code);
  assert.equal(toText('````\n```\nnested fence\n```\n````'), '```\nnested fence\n```');
  assert.equal(toText('```\nunterminated **kept**'), 'unterminated **kept**');
});

test('code spans with awkward delimiters', () => {
  assert.equal(toText('`` ` ``'), '`');
  assert.equal(toText('` a `'), 'a');
  assert.equal(toText('x `  a  ` y'), 'x  a  y', 'one space of padding is stripped, the rest is content');
  assert.equal(toText('a ` unclosed'), 'a ` unclosed');
  assert.equal(toText('`a\nb`'), 'a b');
});

test('headings in both forms, and closing hashes', () => {
  assert.equal(toText('### heading ###'), 'heading');
  assert.equal(toText('#not a heading'), '#not a heading');
  assert.equal(toText('#'), '');
  assert.equal(toText('Title\n---\n\nbody'), 'Title\n\nbody');
});

test('nested and lazy blockquotes', () => {
  assert.equal(toText('> outer\n>> inner'), 'outer\n\ninner');
  assert.equal(toText('> first\ncontinued'), 'first\ncontinued', 'a lazy continuation stays in the same paragraph');
  assert.equal(toText('>'), '');
});

test('lists of every marker, including indented continuations', () => {
  assert.equal(toText('* a\n+ b\n- c'), 'a\n\nb\n\nc');
  assert.equal(toText('1. a\n2) b'), 'a\n\nb');
  assert.equal(toText('- item\n\n  continued text'), 'item\n\ncontinued text');
  assert.equal(toText('- outer\n  - inner\n    - deepest'), 'outer\n\ninner\n\ndeepest');
});

test('tables with escaped pipes and ragged rows', () => {
  assert.equal(toText('| a \\| b | c |\n| --- | --- |\n| 1 | 2 |'), 'a | b\tc\n\n1\t2');
  assert.equal(toText('a | b\n--- | ---\n1 | 2'), 'a\tb\n\n1\t2');
  assert.equal(toText('| only |\n| --- |'), 'only');
});

test('links whose labels contain brackets or code', () => {
  assert.equal(toText('[a [nested] b](x)'), 'a [nested] b');
  assert.equal(toText('[`code[]`](x)'), 'code[]');
  assert.equal(toText('[unclosed](x'), '[unclosed](x');
  assert.equal(toText('[text](<https://example.com/a b>)'), 'text');
});

test('emphasis that is not emphasis', () => {
  assert.equal(toText('5 * 3 * 2'), '5 * 3 * 2');
  assert.equal(toText('a_b_c'), 'a_b_c');
  assert.equal(toText('**bold**text'), 'boldtext');
  assert.equal(toText('*not a bullet because no space'), '*not a bullet because no space');
});

test('decodeEntities is exported and conservative', () => {
  assert.equal(decodeEntities('&amp;&lt;&gt;&quot;&apos;'), '&<>"\'');
  assert.equal(decodeEntities('&#x1F600;'), '\u{1F600}');
  assert.equal(decodeEntities('&#0;'), '\ufffd');
  assert.equal(decodeEntities('&#x110000;'), '\ufffd');
  assert.equal(decodeEntities('a & b'), 'a & b');
  assert.equal(decodeEntities('&notreal;'), '&notreal;');
});

test('options are validated', () => {
  for (const [key, value] of [['links', 'x'], ['images', 'x'], ['lists', 'x'], ['tables', 'x'], ['html', 'x'], ['frontMatter', 'x']]) {
    assert.throws(() => toText('a', {[key]: value}), (error) => {
      assert.ok(error instanceof MarkdownTextError);
      assert.match(error.message, new RegExp(`^${key} must be one of`));
      return true;
    });
  }
  assert.throws(() => toText(null), TypeError);
  assert.throws(() => toText(undefined), TypeError);
});

test('a large document is handled in one pass', () => {
  const block = '## Heading\n\nSome `code_span` and [a link](https://example.com/a_b) and **bold**.\n\n```js\nconst x = **not bold**;\n```\n';
  const markdown = block.repeat(5000);
  const started = Date.now();
  const text = toText(markdown);
  const ms = Date.now() - started;
  assert.ok(text.includes('**not bold**'), 'code survived');
  assert.ok(text.includes('code_span'), 'code span survived');
  assert.ok(ms < 5000, `took ${ms} ms for ${(markdown.length / 1e6).toFixed(1)} MB`);
});

test('html handling', () => {
  assert.equal(toText('<div>a</div>', {html: 'keep'}), '<div>a</div>');
  assert.equal(toText('text <br/> more'), 'text  more');
  assert.equal(toText('<p>one</p>\n<p>two</p>'), 'one\ntwo');
  assert.equal(toText('a <notaknowntag data="x"> b'), 'a  b');
});

test('front matter is only front matter at the very start', () => {
  assert.equal(toText('body\n\n---\ntitle: x\n---'), 'body\n\ntitle: x', 'later dashes are thematic breaks, not front matter');
  assert.equal(toText('---\ntitle: x\n---\nbody'), 'body');
  // Unterminated front matter is not front matter, and a lone `---` with no paragraph above it is
  // a thematic break, so it disappears and the text below it stays.
  assert.equal(toText('---\nunterminated front matter\n\nbody'), 'unterminated front matter\n\nbody');
});

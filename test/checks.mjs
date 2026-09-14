import assert from 'node:assert/strict';

// Shared behavioural checks, used by the unit tests and by the packed-consumer test in both module
// systems, so the published artifact is held to the same behaviour as the source.
//
// Each case is one every reasonable definition of "plain text" agrees about: text inside a code
// block is not markup, an escaped asterisk is an asterisk, an autolink's target is its text, and no
// content disappears.
export function runChecks({toText, decodeEntities, MarkdownTextError}) {
  let checks = 0;
  const keeps = (markdown, ...fragments) => {
    const text = toText(markdown);
    for (const fragment of fragments) {
      assert.ok(text.includes(fragment), `expected ${JSON.stringify(fragment)} in ${JSON.stringify(text)}`);
    }
    return text;
  };

  // The failure that matters most: markup characters inside a code block are content.
  keeps('```js\nconst a = **not bold**;\n```', '**not bold**');
  keeps('```\n# not a heading\n```', '# not a heading');
  keeps('```\n- not a list\n```', '- not a list');
  keeps('~~~\n**kept**\n~~~', '**kept**');
  keeps('text\n\n    **indented code**\n\nmore', '**indented code**');
  checks++;

  // A code span is content too, which is why `__init__` must survive intact.
  keeps('the `__init__` method', '__init__');
  keeps('use `a * b * c` here', 'a * b * c');
  keeps('`` a ` b ``', 'a ` b');
  checks++;

  // Escapes resolve to the character they escape, and leave no backslash behind.
  assert.equal(toText('literally \\*not emphasis\\*'), 'literally *not emphasis*');
  assert.equal(toText('snake\\_case stays'), 'snake_case stays');
  checks++;

  // An underscore inside a word is not emphasis, so identifiers and URLs keep their shape.
  assert.equal(toText('my_variable_name'), 'my_variable_name');
  assert.equal(toText('visit https://example.com/a_b_c today'), 'visit https://example.com/a_b_c today');
  assert.equal(toText('sn*ake*case'), 'snakecase');
  checks++;

  // An autolink displays its target, so the target is the text.
  assert.equal(toText('mail <https://example.com/x>'), 'mail https://example.com/x');
  assert.equal(toText('write to <someone@example.com>'), 'write to someone@example.com');
  // Something that is neither a scheme nor a tag name is literal text.
  keeps('contributors, <www.openjsf.org>', '<www.openjsf.org>');
  checks++;

  // Entities are decoded, including numeric and hexadecimal forms.
  assert.equal(toText('A &amp; B'), 'A & B');
  assert.equal(toText('caf&#233;'), 'café');
  assert.equal(toText('&#x41;&#x42;'), 'AB');
  assert.equal(decodeEntities('&unknownthing; stays'), '&unknownthing; stays');
  checks++;

  // Brackets that are not links stay as written — a shortcut reference needs a definition.
  assert.equal(toText('axios(url[, config])'), 'axios(url[, config])');
  assert.equal(toText('see [the docs][ref]\n\n[ref]: https://example.com'), 'see the docs');
  assert.equal(toText('see [the docs]\n\n[the docs]: https://example.com'), 'see the docs');
  checks++;

  // Links, images and their options.
  assert.equal(toText('see [the docs](https://example.com/a_b)'), 'see the docs');
  assert.equal(toText('see [the docs](https://example.com/a_b)', {links: 'url'}), 'see https://example.com/a_b');
  assert.equal(toText('see [the docs](https://example.com)', {links: 'both'}), 'see the docs (https://example.com)');
  assert.equal(toText('![a diagram](x.png)'), 'a diagram');
  assert.equal(toText('![a diagram](x.png)', {images: 'drop'}), '');
  checks++;

  // Block structure: headings, quotes, lists, tables, rules, front matter.
  assert.equal(toText('# Title\n\nbody'), 'Title\n\nbody');
  assert.equal(toText('Title\n=====\n\nbody'), 'Title\n\nbody');
  assert.equal(toText('> quoted line'), 'quoted line');
  assert.equal(toText('- one\n- two'), 'one\n\ntwo');
  assert.equal(toText('- one\n- two', {lists: 'markers'}), '- one\n\n- two');
  assert.equal(toText('- [ ] todo\n- [x] done'), 'todo\n\ndone');
  assert.equal(toText('| a | b |\n| - | - |\n| 1 | 2 |'), 'a\tb\n\n1\t2');
  assert.equal(toText('| a | b |\n| - | - |\n| 1 | 2 |', {tables: 'drop'}), '');
  assert.equal(toText('a\n\n---\n\nb'), 'a\n\nb');
  assert.equal(toText('---\ntitle: x\n---\n\nbody'), 'body');
  checks++;

  // HTML: tags go, their text stays, and script and style contents go with the tags.
  assert.equal(toText('a <b>bold</b> word'), 'a bold word');
  assert.equal(toText('<div>\n  <p>inside</p>\n</div>'), 'inside');
  assert.equal(toText('<script>alert(1)</script>\n\nafter'), 'after');
  assert.equal(toText('<style>.a{}</style>\n\nafter'), 'after');
  assert.equal(toText('<!-- hidden -->\n\nshown'), 'shown');
  checks++;

  // Strikethrough and hard breaks.
  assert.equal(toText('~~gone~~ but here'), 'gone but here');
  assert.equal(toText('line one  \nline two'), 'line one\nline two');
  checks++;

  // Nothing to say is an empty string rather than a throw.
  assert.equal(toText(''), '');
  assert.equal(toText('\n\n\n'), '');
  assert.equal(toText('---\nonly: front matter\n---'), '');
  checks++;

  // Bad arguments are refused clearly.
  assert.throws(() => toText(42), TypeError);
  assert.throws(() => toText('x', {links: 'nope'}), (error) => {
    assert.ok(error instanceof MarkdownTextError);
    assert.match(error.message, /links must be one of/);
    return true;
  });
  checks++;

  return checks;
}

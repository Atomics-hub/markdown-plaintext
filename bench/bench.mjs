// Reproduce the README's figures against whichever alternatives you have installed.
//
//   npm install --no-save remove-markdown markdown-to-txt
//   node bench/bench.mjs [directory of .md files]
//
// With no directory, it runs on generated documents; point it at your own markdown for numbers that
// describe your workload rather than this one.
import {readdirSync, readFileSync, statSync, existsSync} from 'node:fs';
import {join, extname} from 'node:path';
import {toText} from '../src/index.js';

const has = (name) => { try { import.meta.resolve(name); return true; } catch { return false; } };

const subjects = [{name: 'markdown-plaintext', run: toText}];
if (has('remove-markdown')) subjects.unshift({name: 'remove-markdown', run: (await import('remove-markdown')).default});
if (has('markdown-to-txt')) subjects.push({name: 'markdown-to-txt', run: (await import('markdown-to-txt')).markdownToTxt});

function corpusFrom(directory) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (['.md', '.markdown'].includes(extname(entry))) out.push(readFileSync(path, 'utf8'));
    }
  };
  walk(directory);
  return out;
}

function generated() {
  const block = [
    '# Heading\n\nA paragraph with `code_span`, a [link](https://example.com/a_b) and **emphasis**.',
    '```js\nconst value = **not bold**; // # not a heading\n```',
    '- one\n- two\n- three',
    '| a | b |\n| --- | --- |\n| 1 | 2 |',
    '> quoted text with an autolink <https://example.com/x_y>',
  ].join('\n\n');
  return Array.from({length: 40}, () => block.repeat(5));
}

const directory = process.argv[2];
const corpus = directory && existsSync(directory) ? corpusFrom(directory) : generated();
const bytes = corpus.reduce((sum, text) => sum + Buffer.byteLength(text), 0);
console.log(`${corpus.length} documents, ${(bytes / 1e6).toFixed(2)} MB\n`);

console.log('  ' + 'converter'.padEnd(26) + 'ms / pass'.padStart(11) + 'MB/s'.padStart(9));
for (const subject of subjects) {
  for (const text of corpus) subject.run(text);
  const started = process.hrtime.bigint();
  const REPEATS = 5;
  for (let r = 0; r < REPEATS; r++) for (const text of corpus) subject.run(text);
  const ms = Number(process.hrtime.bigint() - started) / 1e6 / REPEATS;
  console.log('  ' + subject.name.padEnd(26) + ms.toFixed(1).padStart(11) + ((bytes / 1e6) / (ms / 1000)).toFixed(1).padStart(9));
}

console.log('\nadversarial shapes, 16,000 repeats each:');
const shapes = {'[': '[', '[a]': '[a]', '[a](b': '[a](b', '`': '`', '*': '*'};
console.log('  ' + 'input'.padEnd(12) + subjects.map((s) => s.name.slice(0, 20).padStart(22)).join(''));
for (const [label, unit] of Object.entries(shapes)) {
  const input = unit.repeat(16000);
  const cells = subjects.map((subject) => {
    const started = process.hrtime.bigint();
    try { subject.run(input); } catch { return 'threw'.padStart(22); }
    return `${(Number(process.hrtime.bigint() - started) / 1e6).toFixed(1)} ms`.padStart(22);
  });
  console.log('  ' + label.padEnd(12) + cells.join(''));
}

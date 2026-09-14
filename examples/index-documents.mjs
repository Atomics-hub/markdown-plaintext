// Index a directory of markdown for search or embeddings.
//
//   node examples/index-documents.mjs ./docs
//
// The reason to use this rather than a regular expression is visible in the output: code samples,
// identifiers with underscores and URLs all survive, and those are usually the most searchable text
// in a technical document.
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, extname} from 'node:path';
import {toText} from '../src/index.js';

const root = process.argv[2];
if (!root) {
  console.error('usage: node examples/index-documents.mjs <directory>');
  process.exit(2);
}

function* markdownFiles(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) yield* markdownFiles(path);
    else if (['.md', '.markdown', '.mdx'].includes(extname(entry))) yield path;
  }
}

let documents = 0;
let characters = 0;
const started = Date.now();
for (const path of markdownFiles(root)) {
  const text = toText(readFileSync(path, 'utf8'));
  documents++;
  characters += text.length;
  const preview = text.replace(/\s+/g, ' ').slice(0, 96);
  console.log(`${path}\n  ${preview}${text.length > 96 ? '…' : ''}\n`);
}
console.log(`${documents} documents, ${characters.toLocaleString()} characters, ${Date.now() - started} ms`);

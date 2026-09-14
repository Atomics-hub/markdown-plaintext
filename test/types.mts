import {toText, decodeEntities, MarkdownTextError} from 'markdown-plaintext';
import type {TextOptions} from 'markdown-plaintext';

const text: string = toText('# hello');
const configured: string = toText('# hello', {links: 'both', images: 'drop', lists: 'markers'});
const decoded: string = decodeEntities('&amp;');
const options: TextOptions = {links: 'url', tables: 'drop', html: 'keep', frontMatter: 'keep'};
const error: MarkdownTextError = new MarkdownTextError('bad');

void [text, configured, decoded, options, error];

// @ts-expect-error markdown must be a string
toText(42);
// @ts-expect-error links only takes those three values
toText('x', {links: 'link'});
// @ts-expect-error there is no such option
toText('x', {headings: 'drop'});

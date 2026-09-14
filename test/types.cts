import {toText, decodeEntities, MarkdownTextError} from 'markdown-plaintext';
import type {TextOptions} from 'markdown-plaintext';

const text: string = toText('**bold**');
const decoded: string = decodeEntities('&#233;');
const options: TextOptions = {images: 'alt'};
const error: MarkdownTextError = new MarkdownTextError('bad');

void [text, decoded, options, error];

// @ts-expect-error images only takes 'alt' or 'drop'
toText('x', {images: 'keep'});

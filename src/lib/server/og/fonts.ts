// Inter (SIL OFL, fonts/OFL.txt) from @fontsource 5.3.0, inlined into the server
// bundle with ?inline so rendering never touches the network or the filesystem.
// The "latin" subset covers U+0000–00FF, which holds every Icelandic letter
// (á é í ó ú ý ð þ æ ö and capitals), plus — · … ×. "Inter Ext" (latin-ext)
// is a separate family because satori only falls back across family names; it
// catches station names with letters such as ł or ő.

import type { Font } from 'satori';
import latin400 from './fonts/inter-latin-400-normal.woff?inline';
import latin600 from './fonts/inter-latin-600-normal.woff?inline';
import latin800 from './fonts/inter-latin-800-normal.woff?inline';
import ext400 from './fonts/inter-latin-ext-400-normal.woff?inline';
import ext800 from './fonts/inter-latin-ext-800-normal.woff?inline';

function decode(dataUri: string): Buffer {
	return Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');
}

let fonts: Font[] | undefined;

export function ogFonts(): Font[] {
	fonts ??= [
		{ name: 'Inter', data: decode(latin400), weight: 400, style: 'normal' },
		{ name: 'Inter', data: decode(latin600), weight: 600, style: 'normal' },
		{ name: 'Inter', data: decode(latin800), weight: 800, style: 'normal' },
		{ name: 'Inter Ext', data: decode(ext400), weight: 400, style: 'normal' },
		{ name: 'Inter Ext', data: decode(ext800), weight: 800, style: 'normal' }
	];
	return fonts;
}

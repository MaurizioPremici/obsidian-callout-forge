import { INLINE_TOKEN_PREFIX, PRESET_TOKEN_PREFIX } from './style-presets';

const CALLOUT_HEADER = /^(\s*(?:>\s*)+)\[!([^\]|]+)(?:\|([^\]]*))?\]([+-]?)(.*)$/u;

export interface CalloutHeader {
	line: number;
	lineText: string;
	prefix: string;
	quoteDepth: number;
	type: string;
	metadata: string[];
	fold: '' | '+' | '-';
	title: string;
}

export interface CalloutMutation {
	content: string;
	header: CalloutHeader;
	changed: boolean;
}

export function parseCalloutHeader(lineText: string, line = 0): CalloutHeader | null {
	const match = CALLOUT_HEADER.exec(lineText);
	if (match == null) return null;
	const type = match[2].trim();
	if (type.length === 0) return null;

	return {
		line,
		lineText,
		prefix: match[1],
		quoteDepth: (match[1].match(/>/gu) ?? []).length,
		type,
		metadata: splitMetadata(match[3]),
		fold: match[4] as '' | '+' | '-',
		title: match[5],
	};
}

export function locateCalloutAtLine(content: string, cursorLine: number): CalloutHeader | null {
	const lines = content.split('\n');
	if (lines.length === 0) return null;
	const boundedLine = Math.min(lines.length - 1, Math.max(0, cursorLine));

	for (let line = boundedLine; line >= 0; line -= 1) {
		const header = parseCalloutHeader(lines[line], line);
		if (header != null && headerContainsLine(lines, header, boundedLine)) return header;

		if (line < boundedLine && lines[line].trim().length === 0) break;
	}
	return null;
}

export function styleTokenFromHeader(header: CalloutHeader): string | null {
	return (
		header.metadata.find(
			(token) => token.startsWith(PRESET_TOKEN_PREFIX) || token.startsWith(INLINE_TOKEN_PREFIX),
		) ?? null
	);
}

export function setCalloutStyleToken(lineText: string, token: string | null): string {
	const header = parseCalloutHeader(lineText);
	if (header == null) throw new Error('The selected line is not a callout header.');
	if (token != null && !isStyleToken(token)) throw new Error('Invalid callout style token.');

	const metadata = header.metadata.filter((part) => !isStyleToken(part));
	if (token != null) metadata.push(token);
	const metadataSuffix = metadata.length > 0 ? `|${metadata.join(' ')}` : '';
	return `${header.prefix}[!${header.type}${metadataSuffix}]${header.fold}${header.title}`;
}

export function updateCalloutAtLine(content: string, cursorLine: number, token: string | null): CalloutMutation {
	const lines = content.split('\n');
	const header = locateCalloutAtLine(content, cursorLine);
	if (header == null) throw new Error('No callout found at the current position.');

	const replacement = setCalloutStyleToken(lines[header.line], token);
	const changed = replacement !== lines[header.line];
	if (changed) lines[header.line] = replacement;
	return { content: lines.join('\n'), header, changed };
}

export function countStyleToken(content: string, token: string): number {
	if (!isStyleToken(token)) return 0;
	let count = 0;
	for (const line of content.split('\n')) {
		const header = parseCalloutHeader(line);
		if (header?.metadata.includes(token)) count += 1;
	}
	return count;
}

export function replaceStyleToken(content: string, fromToken: string, toToken: string | null): string {
	if (!isStyleToken(fromToken)) throw new Error('Invalid source style token.');
	if (toToken != null && !isStyleToken(toToken)) throw new Error('Invalid replacement style token.');

	return content
		.split('\n')
		.map((line) => {
			const header = parseCalloutHeader(line);
			if (header == null || !header.metadata.includes(fromToken)) return line;
			const withoutSource = setCalloutStyleToken(line, null);
			return toToken == null ? withoutSource : setCalloutStyleToken(withoutSource, toToken);
		})
		.join('\n');
}

function headerContainsLine(lines: string[], header: CalloutHeader, targetLine: number): boolean {
	for (let line = header.line + 1; line <= targetLine; line += 1) {
		if (lines[line].trim().length === 0) return false;
		const depth = (lines[line].match(/>/gu) ?? []).length;
		if (depth < header.quoteDepth) return false;
	}
	return true;
}

function splitMetadata(metadata: string | undefined): string[] {
	if (metadata == null) return [];
	return metadata
		.trim()
		.split(/\s+/u)
		.filter((part) => part.length > 0);
}

function isStyleToken(token: string): boolean {
	return /^(?:cmc-p-[a-f0-9]{16}|cmci-[A-Za-z0-9_-]+)$/u.test(token);
}

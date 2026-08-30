import {
	countStyleToken,
	locateCalloutAtLine,
	parseCalloutHeader,
	replaceStyleToken,
	setCalloutStyleToken,
	styleTokenFromHeader,
	updateCalloutAtLine,
} from './callout-markdown';

const TOKEN = 'cmc-p-0123456789abcdef';

describe('callout markdown', () => {
	test('parses metadata, folding and custom titles', () => {
		const header = parseCalloutHeader('> [!warning|wide red]- Custom title', 4);
		expect(header).toMatchObject({
			line: 4,
			quoteDepth: 1,
			type: 'warning',
			metadata: ['wide', 'red'],
			fold: '-',
			title: ' Custom title',
		});
	});

	test('locates the nearest nested callout', () => {
		const markdown = [
			'> [!note] Outer',
			'> Outer content',
			'> > [!tip] Inner',
			'> > Inner content',
			'> Back outside',
		].join('\n');
		expect(locateCalloutAtLine(markdown, 3)?.type).toBe('tip');
		expect(locateCalloutAtLine(markdown, 4)?.type).toBe('note');
	});

	test('adds, replaces and removes only plugin-owned metadata', () => {
		const original = '> [!note|wide blue]+ Title';
		const added = setCalloutStyleToken(original, TOKEN);
		expect(added).toBe(`> [!note|wide blue ${TOKEN}]+ Title`);
		expect(styleTokenFromHeader(parseCalloutHeader(added)!)).toBe(TOKEN);
		expect(setCalloutStyleToken(added, null)).toBe(original);
	});

	test('updates the header while preserving the body', () => {
		const markdown = '> [!note]\n> Body';
		const mutation = updateCalloutAtLine(markdown, 1, TOKEN);
		expect(mutation.content).toBe(`> [!note|${TOKEN}]\n> Body`);
		expect(mutation.header.line).toBe(0);
	});

	test('counts and replaces a preset across a document', () => {
		const markdown = `> [!note|${TOKEN}]\n> One\n\n> [!tip|other ${TOKEN}]\n> Two`;
		expect(countStyleToken(markdown, TOKEN)).toBe(2);
		expect(countStyleToken(replaceStyleToken(markdown, TOKEN, null), TOKEN)).toBe(0);
		expect(replaceStyleToken(markdown, TOKEN, null)).toContain('[!tip|other]');
	});
});

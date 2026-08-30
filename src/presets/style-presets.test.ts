import {
	contrastRatio,
	createPreset,
	defaultPresetLibrary,
	inlineStylesFromMetadata,
	inlineToken,
	normalizeHex,
	normalizePresetLibrary,
	orderedPresetsForMenu,
	presetIdFromMetadata,
	presetLibraryToCSS,
	presetToken,
	stylesFromMetadata,
} from './style-presets';

describe('style presets', () => {
	test('normalizes short and long hex colors', () => {
		expect(normalizeHex('#ABC')).toBe('#aabbcc');
		expect(normalizeHex('#12abEF')).toBe('#12abef');
		expect(normalizeHex('red')).toBeNull();
	});

	test('drops invalid references while preserving valid presets', () => {
		const preset = createPreset('Ocean');
		const library = normalizePresetLibrary({
			presets: [preset, { id: 'unsafe', name: 'Bad' }],
			order: ['unsafe', preset.id],
			favorites: [preset.id, 'missing'],
			globalByCallout: { note: preset.id, warning: 'missing' },
		});

		expect(library.presets).toHaveLength(1);
		expect(library.order).toEqual([preset.id]);
		expect(library.favorites).toEqual([preset.id]);
		expect(library.globalByCallout).toEqual({ note: preset.id });
	});

	test('reads a preset token without disturbing unrelated metadata', () => {
		const preset = createPreset('Ocean');
		expect(presetIdFromMetadata(`wide ${presetToken(preset.id)} other`)).toBe(preset.id);
		expect(presetIdFromMetadata('wide other')).toBeNull();
	});

	test('round-trips one-off light and dark styles', () => {
		const preset = createPreset('One off');
		const token = inlineToken(preset.light, preset.dark, preset.icon);
		const decoded = inlineStylesFromMetadata(`other ${token}`);
		expect(decoded?.light).toEqual(preset.light);
		expect(decoded?.dark).toEqual(preset.dark);
		expect(decoded?.icon).toBe(preset.icon);
	});

	test('resolves the exact saved colors from preset metadata', () => {
		const preset = createPreset(
			'Test',
			{ background: '#123456', foreground: '#abcdef', titleForeground: '#fedcba' },
			{ background: '#101820', foreground: '#f0f4f8', titleForeground: '#ffcc00' },
		);
		const library = defaultPresetLibrary();
		library.presets = [preset];
		library.order = [preset.id];

		const resolved = stylesFromMetadata(library, `wide ${presetToken(preset.id)}`);
		expect(resolved?.light.background).toBe('#123456');
		expect(resolved?.light.foreground).toBe('#abcdef');
		expect(resolved?.dark.background).toBe('#101820');
		expect(resolved?.dark.titleForeground).toBe('#ffcc00');
	});

	test('puts favorites first while preserving their chosen order', () => {
		const first = createPreset('First');
		const favorite = createPreset('Favorite');
		const secondFavorite = createPreset('Second favorite');
		const library = defaultPresetLibrary();
		library.presets = [first, favorite, secondFavorite];
		library.order = [first.id, favorite.id, secondFavorite.id];
		library.favorites = [secondFavorite.id, favorite.id];

		expect(orderedPresetsForMenu(library).map((preset) => preset.id)).toEqual([
			secondFavorite.id,
			favorite.id,
			first.id,
		]);
	});

	test('generates instance rules after global rules', () => {
		const preset = createPreset('Ocean');
		const library = defaultPresetLibrary();
		library.presets = [preset];
		library.order = [preset.id];
		library.globalByCallout.note = preset.id;

		const css = presetLibraryToCSS(library);
		expect(css.indexOf('[data-callout="note"]')).toBeGreaterThanOrEqual(0);
		expect(css).toContain(`--callout-color: ${parseInt(preset.light.accent.slice(1, 3), 16)}, `);
		expect(css.indexOf(`[data-callout-metadata~="${presetToken(preset.id)}"]`)).toBeGreaterThan(
			css.indexOf('[data-callout="note"]'),
		);
	});

	test('calculates WCAG contrast ratios', () => {
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
		expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
	});
});

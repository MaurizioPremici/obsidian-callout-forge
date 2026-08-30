import { defaultSettings, migrateSettings } from './settings';

describe('settings migration', () => {
	test('migrates upstream settings and adds an empty preset library', () => {
		const migrated = migrateSettings(defaultSettings(), {
			callouts: { custom: ['demo'], settings: { demo: [] } },
			calloutDetection: { obsidian: false, theme: true, snippet: false },
		});

		expect(migrated.callouts.custom).toEqual(['demo']);
		expect(migrated.calloutDetection).toEqual({ obsidian: false, theme: true, snippet: false });
		expect(migrated.presets.schemaVersion).toBe(1);
		expect(migrated.presets.presets).toEqual([]);
	});

	test('rejects malformed top-level values', () => {
		const migrated = migrateSettings(defaultSettings(), { callouts: 'invalid', calloutDetection: null });
		expect(migrated.callouts.custom).toEqual([]);
		expect(migrated.calloutDetection).toEqual({ obsidian: true, theme: true, snippet: true });
	});
});

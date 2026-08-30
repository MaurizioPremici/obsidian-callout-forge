import { PresetService } from './preset-service';
import { createPreset, defaultPresetLibrary, presetToken } from './style-presets';

jest.mock('obsidian');

function createService() {
	const plugin = {
		settings: { presets: defaultPresetLibrary() },
		saveSettings: jest.fn(async () => undefined),
		applyStyles: jest.fn(),
		presets: { refreshRenderedCallouts: jest.fn() },
	};
	return { service: new PresetService(plugin as never), plugin };
}

describe('preset service', () => {
	test('saves a new preset as the first favorite when requested', async () => {
		const { service } = createService();
		const older = createPreset('Older favorite');
		const newest = createPreset('Newest favorite');
		await service.savePreset(older, true);
		await service.savePreset(newest, true);

		expect(service.library.favorites).toEqual([newest.id, older.id]);
	});

	test('moves an existing preset to the first favorite position', async () => {
		const { service } = createService();
		const older = createPreset('Older favorite');
		const selected = createPreset('Selected favorite');
		service.library.presets.push(older, selected);
		service.library.order.push(older.id, selected.id);
		service.library.favorites.push(older.id);

		await service.toggleFavorite(selected.id);

		expect(service.library.favorites).toEqual([selected.id, older.id]);
	});

	test('applies a saved preset token to the selected callout header', () => {
		const { service } = createService();
		const preset = createPreset('Test');
		service.library.presets.push(preset);
		service.library.order.push(preset.id);
		const editor = {
			getValue: () => '> [!note] Test\n> Body',
			transaction: jest.fn(),
		};

		service.applyPresetToEditor(editor as never, 1, preset.id);

		expect(editor.transaction).toHaveBeenCalledWith(
			expect.objectContaining({
				changes: [expect.objectContaining({ text: `> [!note|${presetToken(preset.id)}] Test` })],
			}),
			'callout-manager-custom',
		);
	});
});

import { CalloutID } from '&callout';

import { CalloutSettings } from './callout-settings';
import { PresetLibrarySettings, defaultPresetLibrary, normalizePresetLibrary } from './presets/style-presets';

/**
 * The Callout Manager plugin settings.
 */
export default interface Settings {
	callouts: {
		custom: string[];
		settings: Record<CalloutID, CalloutSettings>;
	};

	calloutDetection: {
		obsidian: boolean;
		theme: boolean;
		snippet: boolean;

		/** @deprecated */
		obsidianFallbackForced?: boolean;
	};

	presets: PresetLibrarySettings;
}

/**
 * Creates default settings for the plugin.
 */
export function defaultSettings(): Settings {
	return {
		callouts: {
			custom: [],
			settings: {},
		},
		calloutDetection: {
			obsidian: true,
			theme: true,
			snippet: true,
		},
		presets: defaultPresetLibrary(),
	};
}

/**
 * Migrates settings.
 *
 * @param into The object to merge into.
 * @param from The settings to add.
 * @returns The merged settings.
 */
export function migrateSettings(into: Settings, from: unknown): Settings {
	if (!isRecord(from)) return into;
	const callouts = isRecord(from.callouts) ? from.callouts : {};
	const detection = isRecord(from.calloutDetection) ? from.calloutDetection : {};
	const custom = Array.isArray(callouts.custom)
		? callouts.custom.filter((id): id is string => typeof id === 'string')
		: into.callouts.custom;
	const calloutSettings = isRecord(callouts.settings)
		? (callouts.settings as Record<CalloutID, CalloutSettings>)
		: into.callouts.settings;

	return {
		callouts: {
			custom,
			settings: calloutSettings,
		},
		calloutDetection: {
			obsidian: typeof detection.obsidian === 'boolean' ? detection.obsidian : into.calloutDetection.obsidian,
			theme: typeof detection.theme === 'boolean' ? detection.theme : into.calloutDetection.theme,
			snippet: typeof detection.snippet === 'boolean' ? detection.snippet : into.calloutDetection.snippet,
		},
		presets: normalizePresetLibrary(from.presets),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

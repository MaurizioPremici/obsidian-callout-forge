export type BorderStyle = 'solid' | 'dashed' | 'dotted' | 'double' | 'none';

export interface CalloutStyleValues {
	background: string;
	foreground: string;
	titleForeground: string;
	accent: string;
	border: string;
	backgroundOpacity: number;
	borderWidth: number;
	borderStyle: BorderStyle;
	borderRadius: number;
}

export interface CalloutStylePreset {
	id: string;
	name: string;
	icon: string;
	light: CalloutStyleValues;
	dark: CalloutStyleValues;
	createdAt: string;
	updatedAt: string;
}

export interface PresetLibrarySettings {
	schemaVersion: 1;
	presets: CalloutStylePreset[];
	order: string[];
	favorites: string[];
	recent: string[];
	globalByCallout: Record<string, string>;
	officialImport: {
		completed: boolean;
		importedAt?: string;
	};
}

export const PRESET_TOKEN_PREFIX = 'cmc-';
export const INLINE_TOKEN_PREFIX = 'cmci-';
export const CALLOUT_PRESET_ICONS = [
	{ id: 'lucide-alert-triangle', label: 'Caution' },
	{ id: 'lucide-lightbulb', label: 'Idea' },
	{ id: 'lucide-package', label: 'Package' },
	{ id: 'lucide-sticky-note', label: 'Note' },
	{ id: 'lucide-tag', label: 'Tag' },
	{ id: 'lucide-flask-conical', label: 'Experimental' },
	{ id: 'lucide-thumbs-up', label: 'Like' },
	{ id: 'lucide-palette', label: 'Creative' },
	{ id: 'lucide-quote', label: 'Quote' },
	{ id: 'lucide-dollar-sign', label: 'Money' },
	{ id: 'lucide-info', label: 'Info' },
	{ id: 'lucide-check-circle', label: 'Success' },
	{ id: 'lucide-help-circle', label: 'Question' },
	{ id: 'lucide-bug', label: 'Bug' },
	{ id: 'lucide-flame', label: 'Hot' },
	{ id: 'lucide-star', label: 'Favorite' },
	{ id: 'lucide-bookmark', label: 'Bookmark' },
	{ id: 'lucide-rocket', label: 'Launch' },
	{ id: 'lucide-code', label: 'Code' },
	{ id: 'lucide-wrench', label: 'Tool' },
] as const;
const VALID_PRESET_ID = /^p-[a-f0-9]{16}$/;
const BORDER_STYLES = new Set<BorderStyle>(['solid', 'dashed', 'dotted', 'double', 'none']);
const PRESET_ICON_IDS = new Set<string>(CALLOUT_PRESET_ICONS.map((icon) => icon.id));

export function defaultStyleValues(scheme: 'light' | 'dark'): CalloutStyleValues {
	if (scheme === 'dark') {
		return {
			background: '#1e2a3a',
			foreground: '#e5e7eb',
			titleForeground: '#93c5fd',
			accent: '#60a5fa',
			border: '#3b82f6',
			backgroundOpacity: 100,
			borderWidth: 1,
			borderStyle: 'solid',
			borderRadius: 6,
		};
	}

	return {
		background: '#e8f1ff',
		foreground: '#1f2937',
		titleForeground: '#0759b6',
		accent: '#0b63ce',
		border: '#0b63ce',
		backgroundOpacity: 100,
		borderWidth: 1,
		borderStyle: 'solid',
		borderRadius: 6,
	};
}

export function defaultPresetLibrary(): PresetLibrarySettings {
	return {
		schemaVersion: 1,
		presets: [],
		order: [],
		favorites: [],
		recent: [],
		globalByCallout: {},
		officialImport: { completed: false },
	};
}

export function createPreset(
	name: string,
	light?: Partial<CalloutStyleValues>,
	dark?: Partial<CalloutStyleValues>,
	icon = 'lucide-lightbulb',
): CalloutStylePreset {
	const now = new Date().toISOString();
	return {
		id: createPresetId(),
		name: normalizePresetName(name),
		icon: normalizePresetIcon(icon),
		light: normalizeStyleValues(light, 'light'),
		dark: normalizeStyleValues(dark, 'dark'),
		createdAt: now,
		updatedAt: now,
	};
}

export function clonePreset(preset: CalloutStylePreset, name = `${preset.name} copy`): CalloutStylePreset {
	return createPreset(name, preset.light, preset.dark, preset.icon);
}

export function normalizePresetLibrary(value: unknown): PresetLibrarySettings {
	const fallback = defaultPresetLibrary();
	if (!isRecord(value)) return fallback;

	const rawPresets = Array.isArray(value.presets) ? value.presets : [];
	const presets = rawPresets.map(normalizePreset).filter((preset): preset is CalloutStylePreset => preset !== null);
	const ids = new Set(presets.map((preset) => preset.id));
	const order = normalizeIdList(value.order, ids);
	for (const preset of presets) {
		if (!order.includes(preset.id)) order.push(preset.id);
	}

	const globalByCallout: Record<string, string> = {};
	if (isRecord(value.globalByCallout)) {
		for (const [callout, presetId] of Object.entries(value.globalByCallout)) {
			if (typeof presetId === 'string' && ids.has(presetId) && callout.length > 0) {
				globalByCallout[callout] = presetId;
			}
		}
	}

	const officialImport = isRecord(value.officialImport) ? value.officialImport : {};
	return {
		schemaVersion: 1,
		presets,
		order,
		favorites: normalizeIdList(value.favorites, ids),
		recent: normalizeIdList(value.recent, ids).slice(0, 8),
		globalByCallout,
		officialImport: {
			completed: officialImport.completed === true,
			...(typeof officialImport.importedAt === 'string' ? { importedAt: officialImport.importedAt } : {}),
		},
	};
}

export function normalizeStyleValues(value: unknown, scheme: 'light' | 'dark'): CalloutStyleValues {
	const fallback = defaultStyleValues(scheme);
	if (!isRecord(value)) return fallback;

	return {
		background: normalizeHex(value.background) ?? fallback.background,
		foreground: normalizeHex(value.foreground) ?? fallback.foreground,
		titleForeground: normalizeHex(value.titleForeground) ?? fallback.titleForeground,
		accent: normalizeHex(value.accent) ?? fallback.accent,
		border: normalizeHex(value.border) ?? fallback.border,
		backgroundOpacity: clampNumber(value.backgroundOpacity, 0, 100, fallback.backgroundOpacity),
		borderWidth: clampNumber(value.borderWidth, 0, 12, fallback.borderWidth),
		borderStyle: BORDER_STYLES.has(value.borderStyle as BorderStyle)
			? (value.borderStyle as BorderStyle)
			: fallback.borderStyle,
		borderRadius: clampNumber(value.borderRadius, 0, 40, fallback.borderRadius),
	};
}

export function normalizeHex(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const compact = value.trim().toLowerCase();
	if (/^#[a-f0-9]{6}$/.test(compact)) return compact;
	if (/^#[a-f0-9]{3}$/.test(compact)) {
		return `#${compact[1]}${compact[1]}${compact[2]}${compact[2]}${compact[3]}${compact[3]}`;
	}
	return null;
}

export function getPreset(library: PresetLibrarySettings, id: string): CalloutStylePreset | undefined {
	return library.presets.find((preset) => preset.id === id);
}

export function orderedPresets(library: PresetLibrarySettings): CalloutStylePreset[] {
	const byId = new Map(library.presets.map((preset) => [preset.id, preset]));
	return library.order
		.map((id) => byId.get(id))
		.filter((preset): preset is CalloutStylePreset => preset !== undefined);
}

export function orderedPresetsForMenu(library: PresetLibrarySettings): CalloutStylePreset[] {
	const byId = new Map(orderedPresets(library).map((preset) => [preset.id, preset]));
	const prioritizedIds = [...library.favorites, ...library.recent, ...library.order];
	const result: CalloutStylePreset[] = [];
	for (const id of prioritizedIds) {
		const preset = byId.get(id);
		if (preset == null || result.includes(preset)) continue;
		result.push(preset);
	}
	return result;
}

export function presetToken(id: string): string {
	if (!VALID_PRESET_ID.test(id)) throw new Error('Invalid preset identifier.');
	return `${PRESET_TOKEN_PREFIX}${id}`;
}

export function presetIdFromMetadata(metadata: string | null | undefined): string | null {
	if (metadata == null) return null;
	for (const token of metadata.trim().split(/\s+/u)) {
		if (token.startsWith(PRESET_TOKEN_PREFIX)) {
			const id = token.slice(PRESET_TOKEN_PREFIX.length);
			if (VALID_PRESET_ID.test(id)) return id;
		}
	}
	return null;
}

export function inlineToken(light: CalloutStyleValues, dark: CalloutStyleValues, icon: string): string {
	const json = JSON.stringify([compactStyle(light), compactStyle(dark), normalizePresetIcon(icon)]);
	return INLINE_TOKEN_PREFIX + base64UrlEncode(json);
}

export function inlineStylesFromMetadata(
	metadata: string | null | undefined,
): { light: CalloutStyleValues; dark: CalloutStyleValues; icon: string } | null {
	if (metadata == null) return null;
	const token = metadata
		.trim()
		.split(/\s+/u)
		.find((part) => part.startsWith(INLINE_TOKEN_PREFIX));
	if (token == null) return null;

	try {
		const decoded: unknown = JSON.parse(base64UrlDecode(token.slice(INLINE_TOKEN_PREFIX.length)));
		if (!Array.isArray(decoded) || decoded.length !== 3) return null;
		return {
			light: expandCompactStyle(decoded[0], 'light'),
			dark: expandCompactStyle(decoded[1], 'dark'),
			icon: normalizePresetIcon(decoded[2]),
		};
	} catch {
		return null;
	}
}

export function stylesFromMetadata(
	library: PresetLibrarySettings,
	metadata: string | null | undefined,
): { light: CalloutStyleValues; dark: CalloutStyleValues; icon: string } | null {
	const inline = inlineStylesFromMetadata(metadata);
	if (inline != null) return inline;
	const presetId = presetIdFromMetadata(metadata);
	const preset = presetId == null ? undefined : getPreset(library, presetId);
	return preset == null ? null : { light: preset.light, dark: preset.dark, icon: preset.icon };
}

export function presetLibraryToCSS(library: PresetLibrarySettings): string {
	const rules: string[] = [];
	for (const [calloutId, presetId] of Object.entries(library.globalByCallout)) {
		const preset = getPreset(library, presetId);
		if (preset == null) continue;
		const selector = `.callout[data-callout="${escapeAttribute(calloutId)}"]`;
		rules.push(styleRulesForSelector(selector, preset.light, 'light', preset.icon));
		rules.push(styleRulesForSelector(selector, preset.dark, 'dark', preset.icon));
	}

	for (const preset of library.presets) {
		const selector = `.callout[data-callout-metadata~="${presetToken(preset.id)}"]`;
		rules.push(styleRulesForSelector(selector, preset.light, 'light', preset.icon));
		rules.push(styleRulesForSelector(selector, preset.dark, 'dark', preset.icon));
	}

	return rules.filter((rule) => rule.length > 0).join('\n\n');
}

export function styleRulesForSelector(
	selector: string,
	style: CalloutStyleValues,
	scheme: 'light' | 'dark',
	icon: string,
): string {
	const root = `.theme-${scheme} ${selector}`;
	const background = rgba(style.background, style.backgroundOpacity / 100);
	return `${root} {
	--callout-color: ${rgbTuple(style.accent)};
	--callout-icon: ${normalizePresetIcon(icon)};
	--callout-radius: ${style.borderRadius}px;
	background-color: ${background} !important;
	color: ${style.foreground} !important;
	border: ${style.borderWidth}px ${style.borderStyle} ${style.border} !important;
	border-radius: ${style.borderRadius}px !important;
}
${root} > .callout-title {
	color: ${style.titleForeground} !important;
}
${root} > .callout-title .callout-icon {
	color: ${style.accent} !important;
}
${root} > .callout-content {
	color: ${style.foreground} !important;
}`;
}

export function applyInlineStyle(element: HTMLElement, style: CalloutStyleValues, icon: string): void {
	element.style.setProperty('--callout-color', rgbTuple(style.accent));
	element.style.setProperty('--callout-icon', normalizePresetIcon(icon));
	element.style.setProperty('--callout-radius', `${style.borderRadius}px`);
	element.style.setProperty('background-color', rgba(style.background, style.backgroundOpacity / 100), 'important');
	element.style.setProperty('color', style.foreground, 'important');
	element.style.setProperty('border', `${style.borderWidth}px ${style.borderStyle} ${style.border}`, 'important');
	element.style.setProperty('border-radius', `${style.borderRadius}px`, 'important');
	element
		.querySelector<HTMLElement>(':scope > .callout-title')
		?.style.setProperty('color', style.titleForeground, 'important');
	element
		.querySelector<HTMLElement>(':scope > .callout-title .callout-icon')
		?.style.setProperty('color', style.accent, 'important');
	element
		.querySelector<HTMLElement>(':scope > .callout-content')
		?.style.setProperty('color', style.foreground, 'important');
}

function rgbTuple(hex: string): string {
	const rgb = hexToRgb(normalizeHex(hex) ?? '#000000');
	return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
}

export function contrastRatio(foreground: string, background: string): number {
	const foregroundRgb = hexToRgb(normalizeHex(foreground) ?? '#000000');
	const backgroundRgb = hexToRgb(normalizeHex(background) ?? '#ffffff');
	const lighter = Math.max(relativeLuminance(foregroundRgb), relativeLuminance(backgroundRgb));
	const darker = Math.min(relativeLuminance(foregroundRgb), relativeLuminance(backgroundRgb));
	return (lighter + 0.05) / (darker + 0.05);
}

export function bestContrastColor(background: string): '#000000' | '#ffffff' {
	return contrastRatio('#000000', background) >= contrastRatio('#ffffff', background) ? '#000000' : '#ffffff';
}

export function exportPresetLibrary(library: PresetLibrarySettings): string {
	return JSON.stringify(
		{
			format: 'callout-manager-custom-presets',
			version: 1,
			exportedAt: new Date().toISOString(),
			presets: orderedPresets(library),
			favorites: library.favorites,
		},
		null,
		2,
	);
}

export function parsePresetImport(text: string): { presets: CalloutStylePreset[]; favorites: string[] } {
	const value: unknown = JSON.parse(text);
	if (!isRecord(value) || value.format !== 'callout-manager-custom-presets' || value.version !== 1) {
		throw new Error('Unsupported preset file.');
	}
	const library = normalizePresetLibrary({
		presets: value.presets,
		order: Array.isArray(value.presets)
			? value.presets.map((preset) => (isRecord(preset) && typeof preset.id === 'string' ? preset.id : ''))
			: [],
		favorites: value.favorites,
	});
	return { presets: orderedPresets(library), favorites: library.favorites };
}

function normalizePreset(value: unknown): CalloutStylePreset | null {
	if (!isRecord(value) || typeof value.id !== 'string' || !VALID_PRESET_ID.test(value.id)) return null;
	const createdAt = typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString();
	const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : createdAt;
	return {
		id: value.id,
		name: normalizePresetName(value.name),
		icon: normalizePresetIcon(value.icon),
		light: normalizeStyleValues(value.light, 'light'),
		dark: normalizeStyleValues(value.dark, 'dark'),
		createdAt,
		updatedAt,
	};
}

export function normalizePresetIcon(value: unknown): string {
	return typeof value === 'string' && PRESET_ICON_IDS.has(value) ? value : 'lucide-lightbulb';
}

function normalizePresetName(value: unknown): string {
	if (typeof value !== 'string') return 'Untitled preset';
	const name = value.trim().replace(/\s+/gu, ' ').slice(0, 80);
	return name.length > 0 ? name : 'Untitled preset';
}

function normalizeIdList(value: unknown, ids: Set<string>): string[] {
	if (!Array.isArray(value)) return [];
	const result: string[] = [];
	for (const id of value) {
		if (typeof id === 'string' && ids.has(id) && !result.includes(id)) result.push(id);
	}
	return result;
}

function createPresetId(): string {
	const bytes = new Uint8Array(8);
	globalThis.crypto.getRandomValues(bytes);
	return `p-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function compactStyle(style: CalloutStyleValues): unknown[] {
	const normalized = normalizeStyleValues(style, 'light');
	return [
		normalized.background,
		normalized.foreground,
		normalized.titleForeground,
		normalized.accent,
		normalized.border,
		normalized.backgroundOpacity,
		normalized.borderWidth,
		normalized.borderStyle,
		normalized.borderRadius,
	];
}

function expandCompactStyle(value: unknown, scheme: 'light' | 'dark'): CalloutStyleValues {
	if (!Array.isArray(value) || value.length !== 9) return defaultStyleValues(scheme);
	return normalizeStyleValues(
		{
			background: value[0],
			foreground: value[1],
			titleForeground: value[2],
			accent: value[3],
			border: value[4],
			backgroundOpacity: value[5],
			borderWidth: value[6],
			borderStyle: value[7],
			borderRadius: value[8],
		},
		scheme,
	);
}

function base64UrlEncode(value: string): string {
	return btoa(value).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function base64UrlDecode(value: string): string {
	const padded = value.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - (value.length % 4)) % 4);
	return atob(padded);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

function escapeAttribute(value: string): string {
	return value
		.replace(/\\/gu, '\\\\')
		.replace(/"/gu, '\\"')
		.replace(/[\n\r\f]/gu, '');
}

function rgba(hex: string, alpha: number): string {
	const rgb = hexToRgb(hex);
	return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.min(1, Math.max(0, alpha)).toFixed(2)})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const normalized = normalizeHex(hex) ?? '#000000';
	return {
		r: Number.parseInt(normalized.slice(1, 3), 16),
		g: Number.parseInt(normalized.slice(3, 5), 16),
		b: Number.parseInt(normalized.slice(5, 7), 16),
	};
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
	const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
		const value = channel / 255;
		return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

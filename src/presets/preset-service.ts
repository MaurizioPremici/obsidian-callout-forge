import { Editor, TFile } from 'obsidian';

import type CalloutManagerPlugin from '../main';

import { countStyleToken, replaceStyleToken, updateCalloutAtLine } from './callout-markdown';
import {
	CalloutStylePreset,
	CalloutStyleValues,
	clonePreset,
	getPreset,
	inlineToken,
	normalizePresetLibrary,
	presetToken,
} from './style-presets';

export interface PresetUsage {
	files: number;
	occurrences: number;
}

export class PresetService {
	public constructor(private readonly plugin: CalloutManagerPlugin) {}

	public get library() {
		return this.plugin.settings.presets;
	}

	public getPreset(id: string): CalloutStylePreset | undefined {
		return getPreset(this.library, id);
	}

	public uniqueName(requested: string, excludingId?: string): string {
		const base = requested.trim().replace(/\s+/gu, ' ').slice(0, 80) || 'Untitled preset';
		const names = new Set(
			this.library.presets
				.filter((preset) => preset.id !== excludingId)
				.map((preset) => preset.name.toLocaleLowerCase()),
		);
		if (!names.has(base.toLocaleLowerCase())) return base;

		let suffix = 2;
		while (names.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix += 1;
		return `${base} ${suffix}`;
	}

	public async savePreset(preset: CalloutStylePreset, favorite?: boolean): Promise<void> {
		const library = this.library;
		const existingIndex = library.presets.findIndex((candidate) => candidate.id === preset.id);
		const normalized = normalizePresetLibrary({ presets: [preset], order: [preset.id] }).presets[0];
		if (normalized == null) throw new Error('The preset is not valid.');
		normalized.name = this.uniqueName(normalized.name, normalized.id);
		normalized.updatedAt = new Date().toISOString();

		if (existingIndex >= 0) {
			library.presets[existingIndex] = normalized;
		} else {
			library.presets.push(normalized);
			library.order.push(normalized.id);
		}
		if (favorite === true) {
			library.favorites = [normalized.id, ...library.favorites.filter((id) => id !== normalized.id)];
		} else if (favorite === false) {
			library.favorites = library.favorites.filter((id) => id !== normalized.id);
		}

		await this.persist(true);
	}

	public async duplicatePreset(id: string): Promise<CalloutStylePreset> {
		const preset = this.getPreset(id);
		if (preset == null) throw new Error('Preset not found.');
		const duplicate = clonePreset(preset, this.uniqueName(`${preset.name} copy`));
		await this.savePreset(duplicate);
		return duplicate;
	}

	public async toggleFavorite(id: string): Promise<void> {
		if (this.getPreset(id) == null) return;
		const favorites = this.library.favorites;
		const index = favorites.indexOf(id);
		if (index >= 0) favorites.splice(index, 1);
		else this.library.favorites = [id, ...favorites];
		await this.persist(false);
	}

	public async touchRecent(id: string): Promise<void> {
		if (this.getPreset(id) == null) return;
		this.library.recent = [id, ...this.library.recent.filter((candidate) => candidate !== id)].slice(0, 8);
		await this.persist(false);
	}

	public async reorder(ids: string[]): Promise<void> {
		const known = new Set(this.library.presets.map((preset) => preset.id));
		const order = ids.filter((id, index) => known.has(id) && ids.indexOf(id) === index);
		for (const preset of this.library.presets) if (!order.includes(preset.id)) order.push(preset.id);
		this.library.order = order;
		await this.persist(false);
	}

	public applyPresetToEditor(editor: Editor, cursorLine: number, presetId: string): void {
		if (this.getPreset(presetId) == null) throw new Error('Preset not found.');
		this.applyTokenToEditor(editor, cursorLine, presetToken(presetId));
		void this.touchRecent(presetId);
	}

	public applyInlineToEditor(
		editor: Editor,
		cursorLine: number,
		light: CalloutStyleValues,
		dark: CalloutStyleValues,
		icon: string,
	): void {
		this.applyTokenToEditor(editor, cursorLine, inlineToken(light, dark, icon));
	}

	public resetEditor(editor: Editor, cursorLine: number): void {
		this.applyTokenToEditor(editor, cursorLine, null);
	}

	public async applyPresetToFile(file: TFile, cursorLine: number, presetId: string): Promise<void> {
		if (this.getPreset(presetId) == null) throw new Error('Preset not found.');
		await this.applyTokenToFile(file, cursorLine, presetToken(presetId));
		await this.touchRecent(presetId);
	}

	public async applyInlineToFile(
		file: TFile,
		cursorLine: number,
		light: CalloutStyleValues,
		dark: CalloutStyleValues,
		icon: string,
	): Promise<void> {
		await this.applyTokenToFile(file, cursorLine, inlineToken(light, dark, icon));
	}

	public async resetFile(file: TFile, cursorLine: number): Promise<void> {
		await this.applyTokenToFile(file, cursorLine, null);
	}

	public async setGlobalPreset(calloutId: string, presetId: string | null): Promise<void> {
		if (presetId == null) delete this.library.globalByCallout[calloutId];
		else {
			if (this.getPreset(presetId) == null) throw new Error('Preset not found.');
			this.library.globalByCallout[calloutId] = presetId;
			await this.touchRecent(presetId);
		}
		await this.persist(true);
	}

	public async findUsage(presetId: string): Promise<PresetUsage> {
		const token = presetToken(presetId);
		let files = 0;
		let occurrences = 0;
		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			const content = await this.plugin.app.vault.cachedRead(file);
			const matches = countStyleToken(content, token);
			if (matches > 0) {
				files += 1;
				occurrences += matches;
			}
		}
		return { files, occurrences };
	}

	public async deletePreset(presetId: string, replacementId: string | null): Promise<void> {
		if (this.getPreset(presetId) == null) return;
		if (replacementId === presetId) throw new Error('Replacement must be a different preset.');
		if (replacementId != null && this.getPreset(replacementId) == null)
			throw new Error('Replacement preset not found.');

		const fromToken = presetToken(presetId);
		const toToken = replacementId == null ? null : presetToken(replacementId);
		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			const content = await this.plugin.app.vault.cachedRead(file);
			if (!content.includes(fromToken)) continue;
			await this.plugin.app.vault.process(file, (current) => replaceStyleToken(current, fromToken, toToken));
		}

		for (const [calloutId, assignedId] of Object.entries(this.library.globalByCallout)) {
			if (assignedId !== presetId) continue;
			if (replacementId == null) delete this.library.globalByCallout[calloutId];
			else this.library.globalByCallout[calloutId] = replacementId;
		}

		this.library.presets = this.library.presets.filter((preset) => preset.id !== presetId);
		this.library.order = this.library.order.filter((id) => id !== presetId);
		this.library.favorites = this.library.favorites.filter((id) => id !== presetId);
		this.library.recent = this.library.recent.filter((id) => id !== presetId);
		await this.persist(true);
	}

	public async importPresets(
		presets: CalloutStylePreset[],
		favorites: string[],
		mode: 'merge' | 'replace',
	): Promise<void> {
		if (mode === 'replace') {
			this.library.presets = [];
			this.library.order = [];
			this.library.favorites = [];
			this.library.recent = [];
			this.library.globalByCallout = {};
		}

		for (const preset of presets) {
			const index = this.library.presets.findIndex((candidate) => candidate.id === preset.id);
			if (index >= 0) this.library.presets[index] = preset;
			else this.library.presets.push(preset);
			if (!this.library.order.includes(preset.id)) this.library.order.push(preset.id);
		}
		this.library.favorites = Array.from(new Set([...this.library.favorites, ...favorites])).filter((id) =>
			this.library.presets.some((preset) => preset.id === id),
		);
		this.plugin.settings.presets = normalizePresetLibrary(this.library);
		await this.persist(true);
	}

	private applyTokenToEditor(editor: Editor, cursorLine: number, token: string | null): void {
		const mutation = updateCalloutAtLine(editor.getValue(), cursorLine, token);
		if (!mutation.changed) return;
		editor.transaction(
			{
				changes: [
					{
						from: { line: mutation.header.line, ch: 0 },
						to: { line: mutation.header.line, ch: mutation.header.lineText.length },
						text: mutation.content.split('\n')[mutation.header.line],
					},
				],
			},
			'callout-manager-custom',
		);
	}

	private async applyTokenToFile(file: TFile, cursorLine: number, token: string | null): Promise<void> {
		await this.plugin.app.vault.process(file, (content) => updateCalloutAtLine(content, cursorLine, token).content);
	}

	private async persist(reapplyStyles: boolean): Promise<void> {
		this.plugin.settings.presets = normalizePresetLibrary(this.plugin.settings.presets);
		await this.plugin.saveSettings();
		if (reapplyStyles) {
			this.plugin.applyStyles();
			this.plugin.presets?.refreshRenderedCallouts();
		}
	}
}

import { App, ButtonComponent, Modal, Notice, Setting, setIcon } from 'obsidian';

import { PresetEditorModal } from './preset-editor-modal';
import { PresetService } from './preset-service';
import { CalloutStylePreset, exportPresetLibrary, orderedPresets, parsePresetImport } from './style-presets';

export class PresetManagerModal extends Modal {
	private query = '';
	private listEl!: HTMLElement;

	public constructor(app: App, private readonly service: PresetService) {
		super(app);
	}

	public onOpen(): void {
		this.modalEl.addClass('calloutmanager-preset-manager-modal');
		this.titleEl.setText('Callout style library');
		this.render();
	}

	public onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		const toolbar = contentEl.createDiv({ cls: 'calloutmanager-preset-manager-toolbar' });
		const search = toolbar.createEl('input', { type: 'search', placeholder: 'Search presets…' });
		search.value = this.query;
		search.addEventListener('input', () => {
			this.query = search.value;
			this.renderList();
		});

		new ButtonComponent(toolbar)
			.setIcon('lucide-plus')
			.setTooltip('New preset')
			.onClick(() => {
				new PresetEditorModal(this.app, this.service, null, undefined, () => this.render()).open();
			});
		new ButtonComponent(toolbar)
			.setIcon('lucide-upload')
			.setTooltip('Import JSON')
			.onClick(() => this.openImport());
		new ButtonComponent(toolbar)
			.setIcon('lucide-download')
			.setTooltip('Export JSON')
			.onClick(() => this.exportJson());

		this.listEl = contentEl.createDiv({ cls: 'calloutmanager-preset-manager-list' });
		this.renderList();
	}

	private renderList(): void {
		this.listEl.empty();
		const query = this.query.trim().toLocaleLowerCase();
		const presets = orderedPresets(this.service.library).filter((preset) =>
			preset.name.toLocaleLowerCase().includes(query),
		);
		if (presets.length === 0) {
			this.listEl.createDiv({
				cls: 'calloutmanager-centerbox',
				text: query.length === 0 ? 'No saved combinations yet.' : 'No matching combinations.',
			});
			return;
		}

		for (const preset of presets) this.renderPreset(preset);
	}

	private renderPreset(preset: CalloutStylePreset): void {
		const row = this.listEl.createDiv({ cls: 'calloutmanager-preset-row', attr: { draggable: 'true' } });
		row.dataset.presetId = preset.id;
		const handle = row.createDiv({ cls: 'calloutmanager-preset-drag', attr: { 'aria-label': 'Reorder preset' } });
		setIcon(handle, 'lucide-grip-vertical');

		const icon = row.createDiv({ cls: 'calloutmanager-preset-row-icon' });
		setIcon(icon, preset.icon);
		icon.style.color = preset.light.accent;
		const info = row.createDiv({ cls: 'calloutmanager-preset-row-info' });
		info.createEl('strong', { text: preset.name });
		const swatches = info.createDiv({ cls: 'calloutmanager-preset-swatches' });
		for (const color of [
			preset.light.background,
			preset.light.foreground,
			preset.light.accent,
			preset.dark.background,
		]) {
			swatches.createSpan({ attr: { title: color }, cls: 'calloutmanager-preset-swatch' }).style.backgroundColor =
				color;
		}

		const controls = row.createDiv({ cls: 'calloutmanager-preset-row-controls' });
		new ButtonComponent(controls)
			.setIcon(this.service.library.favorites.includes(preset.id) ? 'lucide-star' : 'lucide-star')
			.setTooltip(
				this.service.library.favorites.includes(preset.id) ? 'Remove from favorites' : 'Add to favorites',
			)
			.onClick(async () => {
				await this.service.toggleFavorite(preset.id);
				this.renderList();
			});
		if (this.service.library.favorites.includes(preset.id)) controls.lastElementChild?.addClass('is-active');

		new ButtonComponent(controls)
			.setIcon('lucide-pencil')
			.setTooltip('Edit')
			.onClick(() => {
				new PresetEditorModal(this.app, this.service, null, preset, () => this.render()).open();
			});
		new ButtonComponent(controls)
			.setIcon('lucide-copy')
			.setTooltip('Duplicate')
			.onClick(async () => {
				const duplicate = await this.service.duplicatePreset(preset.id);
				new Notice(`Preset “${duplicate.name}” created.`);
				this.render();
			});
		new ButtonComponent(controls)
			.setIcon('lucide-trash')
			.setTooltip('Delete')
			.setWarning()
			.onClick(() => {
				new DeletePresetModal(this.app, this.service, preset, () => this.render()).open();
			});

		row.addEventListener('dragstart', (event) => {
			event.dataTransfer?.setData('text/plain', preset.id);
			event.dataTransfer?.setDragImage(row, 12, 12);
			row.addClass('is-dragging');
		});
		row.addEventListener('dragend', () => row.removeClass('is-dragging'));
		row.addEventListener('dragover', (event) => {
			event.preventDefault();
			const draggingId = event.dataTransfer?.getData('text/plain');
			if (draggingId == null || draggingId === preset.id) return;
			const dragging = this.listEl.querySelector<HTMLElement>(`[data-preset-id="${draggingId}"]`);
			if (dragging == null) return;
			const before = event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2;
			row.parentElement?.insertBefore(dragging, before ? row : row.nextSibling);
		});
		row.addEventListener('drop', async (event) => {
			event.preventDefault();
			const ids = Array.from(this.listEl.querySelectorAll<HTMLElement>('[data-preset-id]')).map(
				(element) => element.dataset.presetId!,
			);
			await this.service.reorder(ids);
		});
	}

	private exportJson(): void {
		const blob = new Blob([exportPresetLibrary(this.service.library)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'callout-manager-custom-presets.json';
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
		new Notice('Preset library exported.');
	}

	private openImport(): void {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json,application/json';
		input.addEventListener('change', async () => {
			const file = input.files?.[0];
			if (file == null) return;
			try {
				const parsed = parsePresetImport(await file.text());
				new ImportPresetModal(this.app, this.service, parsed.presets, parsed.favorites, () =>
					this.render(),
				).open();
			} catch (error) {
				new Notice(error instanceof Error ? error.message : 'Could not import the preset file.');
			}
		});
		input.click();
	}
}

class DeletePresetModal extends Modal {
	public constructor(
		app: App,
		private readonly service: PresetService,
		private readonly preset: CalloutStylePreset,
		private readonly onDeleted: () => void,
	) {
		super(app);
	}

	public onOpen(): void {
		this.titleEl.setText(`Delete “${this.preset.name}”?`);
		this.contentEl.createEl('p', { text: 'Checking linked callouts…' });
		void this.loadUsage();
	}

	private async loadUsage(): Promise<void> {
		const usage = await this.service.findUsage(this.preset.id);
		this.contentEl.empty();
		this.contentEl.createEl('p', {
			text:
				usage.occurrences === 0
					? 'This preset is not linked from any Markdown note.'
					: `${usage.occurrences} linked callout(s) were found across ${usage.files} file(s).`,
		});

		let replacementId = '';
		new Setting(this.contentEl)
			.setName('Linked callouts')
			.setDesc('Reset them to the underlying callout style or replace this preset.')
			.addDropdown((dropdown) => {
				dropdown.addOption('', 'Reset style');
				for (const candidate of orderedPresets(this.service.library)) {
					if (candidate.id !== this.preset.id)
						dropdown.addOption(candidate.id, `Replace with ${candidate.name}`);
				}
				dropdown.onChange((value) => (replacementId = value));
			});

		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		new ButtonComponent(actions).setButtonText('Cancel').onClick(() => this.close());
		new ButtonComponent(actions)
			.setButtonText('Delete')
			.setWarning()
			.onClick(async () => {
				await this.service.deletePreset(this.preset.id, replacementId || null);
				new Notice(`Preset “${this.preset.name}” deleted.`);
				this.onDeleted();
				this.close();
			});
	}
}

class ImportPresetModal extends Modal {
	public constructor(
		app: App,
		private readonly service: PresetService,
		private readonly presets: CalloutStylePreset[],
		private readonly favorites: string[],
		private readonly onImported: () => void,
	) {
		super(app);
	}

	public onOpen(): void {
		this.titleEl.setText('Import callout styles');
		this.contentEl.createEl('p', {
			text: `${this.presets.length} validated preset(s) are ready to import. Choose how to combine them with this vault.`,
		});
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		new ButtonComponent(actions).setButtonText('Cancel').onClick(() => this.close());
		new ButtonComponent(actions)
			.setButtonText('Replace library')
			.setWarning()
			.onClick(() => void this.import('replace'));
		new ButtonComponent(actions)
			.setButtonText('Merge')
			.setCta()
			.onClick(() => void this.import('merge'));
	}

	private async import(mode: 'merge' | 'replace'): Promise<void> {
		await this.service.importPresets(this.presets, this.favorites, mode);
		new Notice(`${this.presets.length} preset(s) imported.`);
		this.onImported();
		this.close();
	}
}

declare const STYLES: `
	.calloutmanager-preset-manager-modal {
		--dialog-width: 720px;
	}

	.calloutmanager-preset-manager-toolbar {
		display: flex;
		gap: var(--size-4-2);
		margin-bottom: var(--size-4-3);

		input[type='search'] {
			flex: 1 1 auto;
		}
	}

	.calloutmanager-preset-manager-list {
		display: flex;
		flex-direction: column;
		gap: var(--size-4-2);
		min-height: 180px;
	}

	.calloutmanager-preset-row {
		display: grid;
		grid-template-columns: auto auto minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--size-4-2);
		padding: var(--size-4-2);
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-s);
		background: var(--background-primary);

		&.is-dragging { opacity: 0.45; }
	}

	.calloutmanager-preset-drag {
		cursor: grab;
		color: var(--text-muted);
	}

	.calloutmanager-preset-row-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
	}

	.calloutmanager-preset-row-info {
		min-width: 0;
	}

	.calloutmanager-preset-swatches {
		display: flex;
		gap: 4px;
		margin-top: 4px;
	}

	.calloutmanager-preset-swatch {
		display: inline-block;
		width: 18px;
		height: 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 3px;
	}

	.calloutmanager-preset-row-controls {
		display: flex;
		gap: 2px;

		button.is-active { color: var(--color-yellow); }
	}
`;

import { App, ButtonComponent, Editor, Modal, Notice, Setting, TFile, setIcon } from 'obsidian';

import { DeletePresetModal, PresetManagerModal } from './preset-manager-modal';
import { PresetService } from './preset-service';
import {
	CalloutStylePreset,
	CalloutStyleValues,
	applyInlineStyle,
	bestContrastColor,
	clonePreset,
	contrastRatio,
	createPreset,
	defaultStyleValues,
	normalizeHex,
	normalizeStyleValues,
} from './style-presets';

export type CalloutTarget =
	| { kind: 'editor'; editor: Editor; line: number; calloutType: string }
	| { kind: 'file'; file: TFile; line: number; calloutType: string };

export class PresetEditorModal extends Modal {
	private draft: CalloutStylePreset;
	private previewEl!: HTMLElement;
	private previewIconEl!: HTMLElement;

	public constructor(
		app: App,
		private readonly service: PresetService,
		private readonly target: CalloutTarget | null,
		preset?: CalloutStylePreset,
		private readonly onSaved?: () => void,
	) {
		super(app);
		this.draft = preset == null ? createPreset('My callout style') : structuredClone(preset);
	}

	public onOpen(): void {
		this.modalEl.addClass('calloutmanager-preset-editor-modal');
		this.titleEl.setText(
			this.service.getPreset(this.draft.id) == null ? 'New callout style' : 'Edit callout style',
		);
		this.render();
	}

	public onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName('Preset name')
			.setDesc('This name appears in the callout context menu.')
			.addText((text) => {
				text.setValue(this.draft.name)
					.setPlaceholder('Example: Ocean note')
					.onChange((value) => {
						this.draft.name = value;
						this.refreshPreview();
					});
			});

		this.createPreview(contentEl);
		this.renderSchemeEditor(contentEl, 'dark');
		this.renderSchemeEditor(contentEl, 'light');
		this.renderActions(contentEl);
	}

	private createPreview(container: HTMLElement): void {
		container.createEl('h3', { text: 'Live preview' });
		const previewHost = container.createDiv({ cls: 'calloutmanager-preset-preview-host theme-dark' });
		const toolbar = previewHost.createDiv({ cls: 'calloutmanager-preset-preview-toolbar' });
		toolbar.createSpan({ text: 'Preview theme:' });
		const themeSelect = toolbar.createEl('select');
		themeSelect.createEl('option', { text: 'Light', value: 'light' });
		themeSelect.createEl('option', { text: 'Dark', value: 'dark' });
		themeSelect.value = 'dark';
		themeSelect.addEventListener('change', () => {
			previewHost.toggleClass('theme-light', themeSelect.value === 'light');
			previewHost.toggleClass('theme-dark', themeSelect.value === 'dark');
			this.refreshPreview();
		});

		this.previewEl = previewHost.createDiv({ cls: 'callout' });
		const title = this.previewEl.createDiv({ cls: 'callout-title' });
		this.previewIconEl = title.createDiv({ cls: 'callout-icon' });
		title.createDiv({ cls: 'callout-title-inner', text: this.draft.name });
		this.previewEl.createDiv({
			cls: 'callout-content',
			text: 'Callout content remains readable with your foreground and background combination.',
		});
		this.refreshPreview();
	}

	private renderSchemeEditor(container: HTMLElement, scheme: 'light' | 'dark'): void {
		const details = container.createEl('details', { cls: 'calloutmanager-preset-scheme' });
		details.open = scheme === 'dark';
		details.createEl('summary', { text: scheme === 'light' ? 'Light theme colors' : 'Dark theme colors' });
		const editorEl = details.createDiv();
		const style = this.draft[scheme];

		this.addColorSetting(editorEl, 'Background', style.background, (value) => (style.background = value));
		this.addColorSetting(editorEl, 'Body foreground', style.foreground, (value) => (style.foreground = value));
		this.addColorSetting(
			editorEl,
			'Title foreground',
			style.titleForeground,
			(value) => (style.titleForeground = value),
		);
		this.addColorSetting(editorEl, 'Accent', style.accent, (value) => (style.accent = value));
		this.addColorSetting(editorEl, 'Border', style.border, (value) => (style.border = value));

		new Setting(editorEl)
			.setName('Background opacity')
			.setDesc(`${Math.round(style.backgroundOpacity)}%`)
			.addSlider((slider) =>
				slider
					.setLimits(0, 100, 1)
					.setDynamicTooltip()
					.setValue(style.backgroundOpacity)
					.onChange((value) => {
						style.backgroundOpacity = value;
						this.refreshPreview();
					}),
			);

		new Setting(editorEl)
			.setName('Border width')
			.setDesc('Pixels')
			.addSlider((slider) =>
				slider
					.setLimits(0, 12, 1)
					.setDynamicTooltip()
					.setValue(style.borderWidth)
					.onChange((value) => {
						style.borderWidth = value;
						this.refreshPreview();
					}),
			);

		new Setting(editorEl).setName('Border style').addDropdown((dropdown) => {
			dropdown
				.addOptions({ solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted', double: 'Double', none: 'None' })
				.setValue(style.borderStyle)
				.onChange((value) => {
					style.borderStyle = normalizeStyleValues({ ...style, borderStyle: value }, scheme).borderStyle;
					this.refreshPreview();
				});
		});

		new Setting(editorEl)
			.setName('Corner radius')
			.setDesc('Pixels')
			.addSlider((slider) =>
				slider
					.setLimits(0, 40, 1)
					.setDynamicTooltip()
					.setValue(style.borderRadius)
					.onChange((value) => {
						style.borderRadius = value;
						this.refreshPreview();
					}),
			);

		const ratio = contrastRatio(style.foreground, style.background);
		const contrast = new Setting(editorEl)
			.setName('Text contrast')
			.setDesc(`${ratio.toFixed(2)}:1 — ${ratio >= 4.5 ? 'WCAG AA pass' : 'low contrast warning'}`)
			.addButton((button) => {
				button.setButtonText('Auto-correct').onClick(() => {
					style.foreground = bestContrastColor(style.background);
					style.titleForeground = style.foreground;
					this.render();
				});
			});
		if (ratio < 4.5) contrast.settingEl.addClass('calloutmanager-contrast-warning');

		new Setting(editorEl)
			.setName('Theme helpers')
			.addButton((button) => {
				button.setButtonText(scheme === 'light' ? 'Copy to dark' : 'Copy to light').onClick(() => {
					this.draft[scheme === 'light' ? 'dark' : 'light'] = structuredClone(style);
					this.render();
				});
			})
			.addButton((button) => {
				button.setButtonText('Generate variant').onClick(() => {
					const destination = scheme === 'light' ? 'dark' : 'light';
					const generated = defaultStyleValues(destination);
					generated.accent = style.accent;
					generated.border = style.border;
					generated.foreground = bestContrastColor(generated.background);
					generated.titleForeground = generated.foreground;
					this.draft[destination] = generated;
					this.render();
				});
			});
	}

	private addColorSetting(
		container: HTMLElement,
		name: string,
		value: string,
		onChange: (value: string) => void,
	): void {
		const setting = new Setting(container).setName(name);
		let currentColor = normalizeHex(value) ?? value;
		let hexInput: HTMLInputElement | null = null;
		let colorInput: HTMLInputElement | null = null;
		const updatePreview = (nextValue: string) => {
			const normalized = normalizeHex(nextValue);
			if (normalized == null) return;
			currentColor = normalized;
			onChange(normalized);
			this.refreshPreview();
		};
		setting.addColorPicker((picker) => picker.setValue(value).onChange((nextValue) => {
			updatePreview(nextValue);
			if (hexInput != null) hexInput.value = currentColor.toUpperCase();
		}));
		colorInput = setting.controlEl.querySelector<HTMLInputElement>('input[type="color"]');
		setting.addText((text) => {
			text.setValue(currentColor.toUpperCase()).setPlaceholder('#B8BDC8').onChange((nextValue) => {
				const normalized = normalizeHex(nextValue);
				if (normalized == null) return;
				updatePreview(normalized);
				if (colorInput != null) colorInput.value = normalized;
			});
			hexInput = text.inputEl;
			hexInput.addClass('calloutmanager-hex-input');
			hexInput.addEventListener('blur', () => {
				if (hexInput != null) hexInput.value = currentColor.toUpperCase();
			});
		});
		// The native picker emits input while it is open; Obsidian's onChange may wait until it closes.
		setting.controlEl.addEventListener('input', (event) => {
			const input = event.target;
			if (input instanceof HTMLInputElement && input.type === 'color') {
				updatePreview(input.value);
				if (hexInput != null) hexInput.value = currentColor.toUpperCase();
			}
		});
	}

	private renderActions(container: HTMLElement): void {
		const actions = container.createDiv({ cls: 'modal-button-container calloutmanager-preset-actions' });
		new ButtonComponent(actions).setButtonText('Cancel').onClick(() => this.close());
		new ButtonComponent(actions).setButtonText('Saved styles / delete').onClick(() => {
			this.close();
			new PresetManagerModal(this.app, this.service).open();
		});

		const savedPreset = this.service.getPreset(this.draft.id);
		if (savedPreset != null) {
			new ButtonComponent(actions).setButtonText('Delete this style').setWarning().onClick(() => {
				new DeletePresetModal(this.app, this.service, savedPreset, () => {
					this.onSaved?.();
					this.close();
				}).open();
			});
			new ButtonComponent(actions).setButtonText('Duplicate').onClick(async () => {
				const duplicate = clonePreset(this.draft, this.service.uniqueName(`${this.draft.name} copy`));
				await this.service.savePreset(duplicate);
				await this.applyPreset(duplicate.id);
				new Notice(`Preset “${duplicate.name}” created.`);
				this.onSaved?.();
				this.close();
			});
		}

		if (this.target != null) {
			new ButtonComponent(actions).setButtonText('Apply once').onClick(async () => {
				await this.applyInline();
				new Notice('One-off callout style applied.');
				this.close();
			});
		}

		new ButtonComponent(actions)
			.setButtonText(this.target == null ? 'Save preset' : 'Save and apply')
			.setCta()
			.onClick(async () => {
				await this.service.savePreset(this.draft);
				await this.applyPreset(this.draft.id);
				new Notice(`Preset “${this.service.getPreset(this.draft.id)?.name ?? this.draft.name}” saved.`);
				this.onSaved?.();
				this.close();
			});
	}

	private refreshPreview(): void {
		if (this.previewEl == null) return;
		const isDark = this.previewEl.parentElement?.classList.contains('theme-dark') === true;
		this.previewIconEl.empty();
		setIcon(this.previewIconEl, this.draft.icon);
		this.previewEl
			.querySelector<HTMLElement>('.callout-title-inner')
			?.setText(this.draft.name || 'Untitled preset');
		applyInlineStyle(this.previewEl, isDark ? this.draft.dark : this.draft.light, this.draft.icon);
	}

	private async applyPreset(presetId: string): Promise<void> {
		if (this.target == null) return;
		if (this.target.kind === 'editor') {
			this.service.applyPresetToEditor(this.target.editor, this.target.line, presetId);
			return;
		}
		await this.service.applyPresetToFile(this.target.file, this.target.line, presetId);
	}

	private async applyInline(): Promise<void> {
		if (this.target == null) return;
		if (this.target.kind === 'editor') {
			this.service.applyInlineToEditor(
				this.target.editor,
				this.target.line,
				this.draft.light,
				this.draft.dark,
				this.draft.icon,
			);
			return;
		}
		await this.service.applyInlineToFile(
			this.target.file,
			this.target.line,
			this.draft.light,
			this.draft.dark,
			this.draft.icon,
		);
	}
}

declare const STYLES: `
	.calloutmanager-preset-editor-modal {
		--dialog-width: 760px;
	}

	.calloutmanager-preset-preview-host {
		padding: var(--size-4-3);
		margin-bottom: var(--size-4-4);
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m);
	}

	.calloutmanager-preset-preview-toolbar {
		display: flex;
		align-items: center;
		gap: var(--size-4-2);
		margin-bottom: var(--size-4-3);
		color: var(--text-muted);
	}

	.calloutmanager-preset-scheme {
		border-top: 1px solid var(--background-modifier-border);
		padding: var(--size-4-3) 0;

		summary {
			font-weight: var(--font-semibold);
			cursor: pointer;
		}
	}

	.calloutmanager-contrast-warning .setting-item-description {
		color: var(--text-warning);
	}

	.calloutmanager-hex-input {
		width: 8.5em;
		font-family: var(--font-monospace);
	}

	.calloutmanager-preset-actions {
		position: sticky;
		bottom: 0;
		background: var(--modal-background);
		padding-top: var(--size-4-3);
	}
`;

import { Editor, MarkdownView, Menu, Modal, Notice, Setting, TFile, setIcon } from 'obsidian';

import type CalloutManagerPlugin from '../main';

import { locateCalloutAtLine, parseCalloutHeader, styleTokenFromHeader } from './callout-markdown';
import { CalloutTarget, PresetEditorModal } from './preset-editor-modal';
import { PresetManagerModal } from './preset-manager-modal';
import { PresetService } from './preset-service';
import {
	CalloutStylePreset,
	applyInlineStyle,
	createPreset,
	getPreset,
	inlineStylesFromMetadata,
	orderedPresets,
	orderedPresetsForMenu,
	presetIdFromMetadata,
	stylesFromMetadata,
} from './style-presets';

export class PresetController {
	public readonly service: PresetService;
	private mutationObserver: MutationObserver | null = null;

	public constructor(private readonly plugin: CalloutManagerPlugin) {
		this.service = new PresetService(plugin);
	}

	public register(): void {
		const { app, plugin } = this;
		plugin.registerEvent(
			app.workspace.on('editor-menu', (menu, editor) => {
				const header = locateCalloutAtLine(editor.getValue(), editor.getCursor().line);
				if (header == null) return;
				const target: CalloutTarget = {
					kind: 'editor',
					editor,
					line: editor.getCursor().line,
					calloutType: header.type,
				};
				this.addRootMenuItem(menu, target, header.metadata.join(' '));
			}),
		);

		plugin.registerMarkdownPostProcessor((el, ctx) => {
			const callouts = collectCallouts(el);
			const section = ctx.getSectionInfo(el);
			const headers =
				section?.text
					.split('\n')
					.map((line, index) => parseCalloutHeader(line, (section?.lineStart ?? 0) + index))
					.filter((header): header is NonNullable<typeof header> => header != null) ?? [];

			for (let index = 0; index < callouts.length; index += 1) {
				const callout = callouts[index];
				const metadata = callout.dataset.calloutMetadata;
				this.applyInlineMetadata(callout, metadata);
				const matchingHeader =
					headers.find(
						(header, headerIndex) =>
							headerIndex >= index &&
							header.type.toLocaleLowerCase() === (callout.dataset.callout ?? '').toLocaleLowerCase() &&
							(metadata == null || metadata.length === 0 || header.metadata.join(' ') === metadata),
					) ?? headers[index];
				if (matchingHeader != null) {
					callout.dataset.cmcLine = String(matchingHeader.line);
					callout.dataset.cmcSourcePath = ctx.sourcePath;
				}
			}
		});

		plugin.registerDomEvent(document, 'contextmenu', (event) => this.onReadingContextMenu(event), true);
		plugin.registerEvent(app.workspace.on('css-change', () => this.refreshRenderedCallouts()));

		app.workspace.onLayoutReady(() => {
			this.scanStyledCallouts(document);
			this.mutationObserver = new MutationObserver((records) => {
				for (const record of records) {
					for (const node of Array.from(record.addedNodes)) {
						if (node instanceof HTMLElement) this.scanStyledCallouts(node);
					}
				}
			});
			this.mutationObserver.observe(document.body, { childList: true, subtree: true });
			plugin.register(() => {
				this.mutationObserver?.disconnect();
				this.mutationObserver = null;
			});
		});

		plugin.addCommand({
			id: 'customize-current-callout-style',
			name: 'Customize current callout style',
			editorCheckCallback: (checking, editor) => {
				const header = locateCalloutAtLine(editor.getValue(), editor.getCursor().line);
				if (header == null) return false;
				if (!checking) {
					const target: CalloutTarget = {
						kind: 'editor',
						editor,
						line: editor.getCursor().line,
						calloutType: header.type,
					};
					this.openEditor(target, header.metadata.join(' '));
				}
				return true;
			},
		});

		plugin.addCommand({
			id: 'apply-last-callout-style',
			name: 'Apply last callout style',
			editorCheckCallback: (checking, editor) => {
				const header = locateCalloutAtLine(editor.getValue(), editor.getCursor().line);
				const presetId = this.service.library.recent[0];
				if (header == null || presetId == null || this.service.getPreset(presetId) == null) return false;
				if (!checking)
					this.run(() => this.service.applyPresetToEditor(editor, editor.getCursor().line, presetId));
				return true;
			},
		});

		plugin.addCommand({
			id: 'manage-callout-style-presets',
			name: 'Manage callout style presets',
			callback: () => new PresetManagerModal(app, this.service).open(),
		});
	}

	public refreshRenderedCallouts(): void {
		this.scanStyledCallouts(document);
	}

	private addRootMenuItem(menu: Menu, target: CalloutTarget, metadata: string): void {
		menu.addItem((item) => {
			item.setTitle('Callout colors and icon')
				.setIcon('lucide-palette')
				.setSection('callout')
				.onClick((event) => {
					const submenu = new Menu();
					this.populatePresetMenu(submenu, target, metadata);
					if (event instanceof MouseEvent) submenu.showAtMouseEvent(event);
					else {
						const element = event.target instanceof HTMLElement ? event.target : document.body;
						const rect = element.getBoundingClientRect();
						submenu.showAtPosition({ x: rect.right, y: rect.top });
					}
				});
		});
	}

	private populatePresetMenu(menu: Menu, target: CalloutTarget, metadata: string): void {
		const currentPresetId = presetIdFromMetadata(metadata);
		const presets = orderedForMenu(this.service.library);
		if (presets.length > 0) {
			const favorites = presets.filter((preset) => this.service.library.favorites.includes(preset.id));
			const others = presets.filter((preset) => !this.service.library.favorites.includes(preset.id));
			if (favorites.length > 0) {
				menu.addItem((item) => item.setTitle('Favorites').setIsLabel(true));
				for (const preset of favorites) this.addPresetMenuItem(menu, target, currentPresetId, preset);
			}
			if (others.length > 0) {
				menu.addItem((item) => item.setTitle('Saved combinations').setIsLabel(true));
				for (const preset of others) this.addPresetMenuItem(menu, target, currentPresetId, preset);
			}
		}

		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(currentPresetId == null ? 'Create custom combination…' : 'Edit current combination…')
				.setIcon('lucide-sliders-horizontal')
				.onClick(() => this.openEditor(target, metadata)),
		);
		menu.addItem((item) =>
			item
				.setTitle(`Apply a preset to all “${target.calloutType}” callouts…`)
				.setIcon('lucide-layers')
				.onClick(() => new GlobalPresetModal(this.plugin, this.service, target.calloutType).open()),
		);
		menu.addItem((item) =>
			item
				.setTitle('Manage saved combinations…')
				.setIcon('lucide-library')
				.onClick(() => new PresetManagerModal(this.app, this.service).open()),
		);
		if (metadata.includes('cmc-')) {
			menu.addItem((item) =>
				item
					.setTitle('Reset this callout style')
					.setIcon('lucide-rotate-ccw')
					.setWarning(true)
					.onClick(() => this.run(() => this.resetTarget(target))),
			);
		}
	}

	private addPresetMenuItem(
		menu: Menu,
		target: CalloutTarget,
		currentPresetId: string | null,
		preset: CalloutStylePreset,
	): void {
		menu.addItem((item) => {
			item.setTitle(presetMenuTitle(preset))
				.setIcon(preset.icon)
				.setChecked(currentPresetId === preset.id)
				.onClick(() => this.run(() => this.applyPreset(target, preset.id)));
		});
	}

	private openEditor(target: CalloutTarget, metadata: string): void {
		const presetId = presetIdFromMetadata(metadata);
		const inline = inlineStylesFromMetadata(metadata);
		const preset =
			presetId != null
				? getPreset(this.service.library, presetId)
				: inline == null
				? undefined
				: createPreset('Saved from callout', inline.light, inline.dark, inline.icon);
		new PresetEditorModal(this.app, this.service, target, preset).open();
	}

	private onReadingContextMenu(event: MouseEvent): void {
		const target =
			event.target instanceof Element
				? event.target.closest<HTMLElement>('.markdown-reading-view .callout')
				: null;
		if (target == null) return;
		const sourcePath = target.dataset.cmcSourcePath;
		const line = Number.parseInt(target.dataset.cmcLine ?? '', 10);
		const file = sourcePath == null ? null : this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile) || !Number.isInteger(line)) return;

		event.preventDefault();
		event.stopPropagation();
		const calloutTarget: CalloutTarget = {
			kind: 'file',
			file,
			line,
			calloutType: target.dataset.callout ?? 'note',
		};
		const menu = new Menu();
		this.populatePresetMenu(menu, calloutTarget, target.dataset.calloutMetadata ?? '');
		menu.showAtMouseEvent(event);
	}

	private scanStyledCallouts(root: ParentNode): void {
		const callouts: HTMLElement[] = [];
		if (root instanceof HTMLElement && root.matches('.callout[data-callout-metadata*="cmc-"]')) callouts.push(root);
		callouts.push(...Array.from(root.querySelectorAll<HTMLElement>('.callout[data-callout-metadata*="cmc-"]')));
		for (const callout of callouts) this.applyInlineMetadata(callout, callout.dataset.calloutMetadata);
	}

	private applyInlineMetadata(callout: HTMLElement, metadata: string | undefined): void {
		const styles = stylesFromMetadata(this.service.library, metadata);
		if (styles == null) return;
		const dark = callout.ownerDocument.body.classList.contains('theme-dark');
		applyInlineStyle(callout, dark ? styles.dark : styles.light, styles.icon);
	}

	private async applyPreset(target: CalloutTarget, presetId: string): Promise<void> {
		if (target.kind === 'editor') this.service.applyPresetToEditor(target.editor, target.line, presetId);
		else await this.service.applyPresetToFile(target.file, target.line, presetId);
	}

	private async resetTarget(target: CalloutTarget): Promise<void> {
		if (target.kind === 'editor') this.service.resetEditor(target.editor, target.line);
		else await this.service.resetFile(target.file, target.line);
	}

	private run(action: () => void | Promise<void>): void {
		try {
			const result = action();
			if (result instanceof Promise) void result.catch((error) => this.showError(error));
		} catch (error) {
			this.showError(error);
		}
	}

	private showError(error: unknown): void {
		console.error('Callout Forge:', error);
		new Notice(error instanceof Error ? error.message : 'The callout style could not be changed.');
	}

	private get app() {
		return this.plugin.app;
	}
}

class GlobalPresetModal extends Modal {
	private presetId = '';

	public constructor(
		private readonly plugin: CalloutManagerPlugin,
		private readonly service: PresetService,
		private readonly calloutType: string,
	) {
		super(plugin.app);
		this.presetId = service.library.globalByCallout[calloutType] ?? service.library.recent[0] ?? '';
	}

	public onOpen(): void {
		this.titleEl.setText(`Style all “${this.calloutType}” callouts`);
		new Setting(this.contentEl)
			.setName('Saved combination')
			.setDesc('This changes existing and future callouts of this type without rewriting notes.')
			.addDropdown((dropdown) => {
				dropdown.addOption('', 'Choose a preset');
				for (const preset of orderedPresets(this.service.library)) dropdown.addOption(preset.id, preset.name);
				dropdown.setValue(this.presetId).onChange((value) => (this.presetId = value));
			});

		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		new Setting(actions).addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
		new Setting(actions).addButton((button) =>
			button
				.setButtonText('Reset global style')
				.setWarning()
				.onClick(async () => {
					await this.service.setGlobalPreset(this.calloutType, null);
					new Notice(`Global style for “${this.calloutType}” reset.`);
					this.close();
				}),
		);
		new Setting(actions).addButton((button) =>
			button
				.setButtonText('Apply globally')
				.setCta()
				.onClick(async () => {
					if (this.presetId.length === 0) {
						new Notice('Choose a preset first.');
						return;
					}
					await this.service.setGlobalPreset(this.calloutType, this.presetId);
					new Notice(`Global callout style applied to “${this.calloutType}”.`);
					this.close();
				}),
		);
	}
}

function orderedForMenu(library: PresetService['library']): CalloutStylePreset[] {
	return orderedPresetsForMenu(library);
}

function presetMenuTitle(preset: CalloutStylePreset): DocumentFragment {
	const fragment = document.createDocumentFragment();
	const swatch = fragment.createSpan({ cls: 'calloutmanager-menu-swatch' });
	swatch.style.background = `linear-gradient(135deg, ${preset.light.background} 0 50%, ${preset.dark.background} 50% 100%)`;
	fragment.createSpan({ text: preset.name });
	return fragment;
}

function collectCallouts(el: HTMLElement): HTMLElement[] {
	const result: HTMLElement[] = [];
	if (el.matches('.callout')) result.push(el);
	result.push(...Array.from(el.querySelectorAll<HTMLElement>('.callout')));
	return result;
}

declare const STYLES: `
	.calloutmanager-menu-swatch {
		display: inline-block;
		width: 16px;
		height: 16px;
		margin-right: var(--size-4-2);
		vertical-align: -3px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 50%;
	}
`;

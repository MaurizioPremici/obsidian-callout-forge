import { Editor, MarkdownView, Menu, MenuItem, Modal, Notice, Setting, TFile, setIcon } from 'obsidian';

import type CalloutManagerPlugin from '../main';

import { CalloutHeader, locateCalloutAtLine, parseCalloutHeader, readCalloutTextBlock, replaceCalloutTextBlock, setCalloutStyleToken, styleTokenFromHeader } from './callout-markdown';
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
		plugin.registerDomEvent(activeDocument, 'contextmenu', (event) => this.onRenderedEditorContextMenu(event), { capture: true });
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
				menu.addItem((item) => this.addTypeMenuItem(item, editor, header, target));
				this.addRootMenuItem(menu);
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
		plugin.registerDomEvent(document, 'dblclick', (event) => this.onReadingCalloutDoubleClick(event));
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

	private addRootMenuItem(menu: Menu): void {
		menu.addItem((item) => {
			item.setTitle('Callout styles')
				.setIcon('lucide-palette')
				.setSection('callout')
				.onClick(() => new PresetEditorModal(this.app, this.service, null).open());
		});
	}

	private onRenderedEditorContextMenu(event: MouseEvent): void {
		const origin = event.target instanceof Element ? event.target : null;
		const target = origin?.closest<HTMLElement>('.callout');
		if (target == null || origin?.closest('.markdown-source-view') == null) return;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const editor = view?.editor;
		if (editor == null || editor.somethingSelected()) return;
		const cm = (editor as Editor & { cm?: { posAtDOM?: (node: Node) => number; posAtCoords?: (coords: { x: number; y: number }) => number | null } }).cm;
		let line: number | null = null;
		try {
			if (cm?.posAtDOM != null) line = editor.offsetToPos(cm.posAtDOM(target)).line;
		} catch { /* Fall back to the click position. */ }
		if (line == null && cm?.posAtCoords != null) {
			const offset = cm.posAtCoords({ x: event.clientX, y: event.clientY });
			if (offset != null) line = editor.offsetToPos(offset).line;
		}
		if (line == null) {
			const stored = Number.parseInt(target.dataset.cmcLine ?? '', 10);
			if (Number.isInteger(stored)) line = stored;
		}
		if (line == null) return;
		const header = locateCalloutAtLine(editor.getValue(), line);
		if (header == null) return;

		event.preventDefault();
		event.stopImmediatePropagation();
		const calloutTarget: CalloutTarget = { kind: 'editor', editor, line: header.line, calloutType: header.type };
		const menu = new Menu();
		menu.addItem((item) => item.setTitle('Edit').setIcon('lucide-pencil').onClick(() => {
			editor.setCursor({ line: header.line, ch: editor.getLine(header.line).length });
			editor.focus();
		}));
		menu.addItem((item) => this.addTypeMenuItem(item, editor, header, calloutTarget));
		this.addRootMenuItem(menu);
		menu.showAtMouseEvent(event);
	}

	private addTypeMenuItem(item: MenuItem, editor: Editor, header: CalloutHeader, target: CalloutTarget): void {
		item.setTitle('Callout type').setIcon('lucide-list');
		const submenu = (item as MenuItem & { setSubmenu?: () => Menu }).setSubmenu?.();
		if (submenu == null) {
			item.onClick((event) => {
				const fallback = new Menu();
				this.populateTypeMenu(fallback, editor, header, target);
				if (event instanceof MouseEvent) fallback.showAtMouseEvent(event);
			});
			return;
		}
		this.populateTypeMenu(submenu, editor, header, target);
	}

	private populateTypeMenu(menu: Menu, editor: Editor, header: CalloutHeader, target: CalloutTarget): void {
		const builtInTypes = ['note', 'tip', 'cite', 'info', 'danger'];
		for (const type of builtInTypes) {
			menu.addItem((item) => item
				.setTitle(type.charAt(0).toUpperCase() + type.slice(1))
				.setChecked(header.type === type && styleTokenFromHeader(header) == null)
				.onClick(() => this.run(() => this.changeCalloutType(editor, header.line, type))));
		}
		const presets = orderedForMenu(this.service.library);
		if (presets.length > 0) {
			menu.addSeparator();
			menu.addItem((item) => item.setTitle('My callouts').setIsLabel(true));
			const selectedPreset = presetIdFromMetadata(header.metadata.join(' '));
			for (const preset of presets) this.addPresetMenuItem(menu, target, selectedPreset, preset);
		}
		menu.addSeparator();
		menu.addItem((item) => item.setTitle('Other…').onClick(() => this.promptCalloutType(editor, header.line)));
		menu.addItem((item) => item.setTitle('None').onClick(() => {
			const current = locateCalloutAtLine(editor.getValue(), header.line);
			if (current == null) return;
			editor.setLine(current.line, `${current.prefix}${current.title}`);
			editor.focus();
		}));
	}

	private promptCalloutType(editor: Editor, line: number): void {
		const modal = new Modal(this.app);
		modal.titleEl.setText('Other callout type');
		let requested = '';
		new Setting(modal.contentEl).setName('Type ID').addText((text) => {
			text.setPlaceholder('custom-type').onChange((value) => (requested = value.trim().toLowerCase()));
		});
		new Setting(modal.contentEl).addButton((button) => button.setButtonText('Apply').setCta().onClick(() => {
			if (!/^[a-z0-9_-]+$/u.test(requested)) {
				new Notice('Use letters, numbers, hyphens, or underscores.');
				return;
			}
			this.changeCalloutType(editor, line, requested);
			modal.close();
		}));
		modal.open();
	}

	private changeCalloutType(editor: Editor, line: number, type: string): void {
		const header = locateCalloutAtLine(editor.getValue(), line);
		if (header == null) return;
		const clean = setCalloutStyleToken(header.lineText, null);
		editor.setLine(header.line, clean.replace(/(\[!)[^\]|]+/u, `$1${type}`));
		editor.focus();
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
		this.addRootMenuItem(menu);
		menu.addSeparator();
		this.populatePresetMenu(menu, calloutTarget, target.dataset.calloutMetadata ?? '');
		menu.showAtMouseEvent(event);
	}

	private onReadingCalloutDoubleClick(event: MouseEvent): void {
		const origin = event.target instanceof Element ? event.target : null;
		if (origin?.closest('a, button, input, textarea, [contenteditable="true"], .calloutmanager-inline-editor') != null) return;
		const target = origin?.closest<HTMLElement>('.markdown-reading-view .callout');
		if (target == null || target.hasClass('calloutmanager-inline-editing')) return;
		const sourcePath = target.dataset.cmcSourcePath;
		const line = Number.parseInt(target.dataset.cmcLine ?? '', 10);
		const file = sourcePath == null ? null : this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile) || !Number.isInteger(line)) return;
		event.preventDefault();
		event.stopPropagation();
		void this.openReadingTextEditor(target, file, line);
	}

	private async openReadingTextEditor(target: HTMLElement, file: TFile, line: number): Promise<void> {
		try {
			const original = readCalloutTextBlock(await this.app.vault.read(file), line);
			if (original == null || !target.isConnected ||
				original.header.type.toLowerCase() !== (target.dataset.callout ?? '').toLowerCase()) return;
			target.addClass('calloutmanager-inline-editing');
			const editorEl = target.createDiv({ cls: 'calloutmanager-inline-editor' });
			const titleInput = editorEl.createEl('input', { attr: { type: 'text', 'aria-label': 'Callout title', placeholder: 'Callout title' } });
			titleInput.value = original.header.title.trim();
			const bodyInput = editorEl.createEl('textarea', { attr: { 'aria-label': 'Callout text', placeholder: 'Callout text' } });
			bodyInput.value = original.body;
			bodyInput.rows = Math.max(3, Math.min(18, original.body.split('\n').length + 1));
			const actions = editorEl.createDiv({ cls: 'calloutmanager-inline-actions' });
			const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
			const save = actions.createEl('button', { text: 'Save', cls: 'mod-cta', attr: { type: 'button' } });
			const close = () => {
				editorEl.remove();
				target.removeClass('calloutmanager-inline-editing');
			};
			const persist = async () => {
				save.disabled = true;
				try {
					await this.app.vault.process(file, (current) =>
						replaceCalloutTextBlock(current, original, titleInput.value, bodyInput.value));
					close();
				} catch (error) {
					save.disabled = false;
					this.showError(error);
				}
			};
			cancel.addEventListener('click', close);
			save.addEventListener('click', () => void persist());
			editorEl.addEventListener('keydown', (keyEvent) => {
				if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); close(); }
				else if (keyEvent.key === 'Enter' && (keyEvent.metaKey || keyEvent.ctrlKey)) {
					keyEvent.preventDefault();
					void persist();
				}
			});
			titleInput.focus();
		} catch (error) {
			this.showError(error);
		}
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
	/* Dracula colors all Markdown quote tokens green, including callout text in edit mode. */
	.theme-dark .markdown-source-view.mod-cm6 .cm-quote {
		color: #D3D6DE !important;
		-webkit-text-fill-color: #D3D6DE !important;
	}
	.callout.calloutmanager-inline-editing > .callout-title,
	.callout.calloutmanager-inline-editing > .callout-content {
		display: none;
	}
	.calloutmanager-inline-editor {
		display: flex;
		flex-direction: column;
		gap: var(--size-4-2);
		padding: var(--size-4-3);
	}
	.calloutmanager-inline-editor input,
	.calloutmanager-inline-editor textarea {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		color: var(--text-normal);
		background: var(--background-primary);
	}
	.theme-dark .calloutmanager-inline-editor input,
	.theme-dark .calloutmanager-inline-editor textarea {
		color: #D3D6DE !important;
		-webkit-text-fill-color: #D3D6DE;
		caret-color: #D3D6DE;
	}
	.theme-dark .calloutmanager-inline-editor input::selection,
	.theme-dark .calloutmanager-inline-editor textarea::selection {
		color: #fff;
		background: var(--interactive-accent);
	}
	.calloutmanager-inline-editor textarea {
		min-height: 100px;
		resize: vertical;
	}
	.calloutmanager-inline-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--size-4-2);
	}
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

# Obsidian Callout Forge

Design a callout once. Reuse it everywhere.

**Obsidian Callout Forge** lets you create, save, favorite, and apply complete color-and-icon combinations directly from the callout context menu.

This project is a fork of [eth-p/obsidian-callout-manager](https://github.com/eth-p/obsidian-callout-manager), distributed under the original MIT license.

![Screenshot](docs/images/screenshot_manage_pane_darklight.png)

## Features

-   **Reusable named style presets.**
    Save background, body foreground, title foreground, accent, border, opacity, border style, radius, and separate light/dark variants.

-   **20 included Lucide icons.**
    Each preset stores its name, icon, and complete color combination.

-   **Fast context-menu workflow.**
    In Live Preview, right-click a callout and open **Callout colors and icon**. Reading View has the same plugin menu, and Source Mode is supported through the command palette.

-   **Per-callout or global application.**
    Apply a preset to one callout, or make it the default for every callout of the selected type.

-   **Preset library.**
    Mark a combination as a favorite while saving it so it stays at the top of the callout menu. Search, reorder, duplicate, rename, delete with reference replacement, and import/export versioned JSON files.

-   **Non-destructive Markdown metadata.**
    Per-callout styles preserve the original callout type, title, fold marker, nesting, and unrelated metadata. Without the plugin, notes still render as standard callouts.

-   **Browse a list of available callouts.**
    Learn about all the callouts that you can use!

-   **Change the colors and icon of callouts.**
    Make callouts your own by changing their colors and icons.

-   **Create custom callouts.**
    No callout to suit your needs? Make it yourself!

-   **Automatically detects callouts created by snippets and themes.**
    Callout Manager keeps track of callouts for you.

-   **Supports Mobile Obsidian**
    Take your callouts on the go!

-   **Plugin API**
    We have a [Plugin API](./api/README.md) for integration with other plugins.

## Installation

Copy `main.js`, `styles.css`, and `manifest.json` into a vault plugin directory named `callout-manager-custom`, then enable **Obsidian Callout Forge** in Obsidian. The internal plugin ID remains `callout-manager-custom` for compatibility with existing installations and saved presets; official Callout Manager updates cannot overwrite it.

On first load, if the custom plugin has no data file and the official Callout Manager data is present, existing callout definitions and global appearance settings are imported. The official plugin should then remain disabled to avoid two global style sheets competing for the same callout types.

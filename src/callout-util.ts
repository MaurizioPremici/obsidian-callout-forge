import Callout from '&callout';
import { RGB, parseColor } from '&color';

/**
 * Gets the color (as a {@link RGB}) from a {@link Callout}.
 * This will try to do basic parsing on the color field.
 *
 * @param callout The callout.
 * @returns The callout's color, or null if not valid.
 */
export function getColorFromCallout(callout: Callout): RGB | null {
	const parsed = parseColor(callout.color);
	if (parsed != null) return parsed;

	// Callout Manager historically stored colors as a comma-delimited RGB tuple.
	// Keep accepting that persisted/API format while Obsidian 1.13 returns valid rgb(...) CSS colors.
	return parseColor(`rgb(${callout.color})`);
}

/**
 * Gets the title of a callout.
 *
 * This should be the same as what Obsidian displays when a callout block does not have a user-specified title.
 *
 * @param callout The callout.
 * @returns The callout's title.
 */
export function getTitleFromCallout(callout: Callout): string {
	const matches = /^(.)(.*)/u.exec(callout.id);
	if (matches == null) return callout.id;

	const firstChar = matches[1].toLocaleUpperCase();
	const remainingChars = matches[2].toLocaleLowerCase().replace(/-+/g, ' ');

	return `${firstChar}${remainingChars}`;
}

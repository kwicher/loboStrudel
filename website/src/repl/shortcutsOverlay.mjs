// Tiny shared open/closed flag for the keyboard-shortcuts overlay -- kept
// as its own nanostore (rather than component state) since the toggle is
// triggered from two independent places: the "?" button in the header
// (Panel.jsx) and a global "?" keydown listener (ShortcutsOverlay.jsx).
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';

export const $shortcutsOpen = atom(false);
export const useShortcutsOpen = () => useStore($shortcutsOpen);
export const openShortcuts = () => $shortcutsOpen.set(true);
export const closeShortcuts = () => $shortcutsOpen.set(false);
export const toggleShortcuts = () => $shortcutsOpen.set(!$shortcutsOpen.get());

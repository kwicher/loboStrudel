// Client-side favorites + tags for individual sounds/samples in the Sounds
// browser. Deliberately separate from user_pattern_utils.mjs (patterns) and
// settings.mjs (app settings) -- this is its own small localStorage-backed
// store so favoriting a sample doesn't get mixed into either of those.
//
// An "id" here is either a bank name ("bd") for a whole sound/sample bank,
// or "bd:2" for one specific sample/table/font inside a multi-sample bank.
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';

const STORAGE_KEY = 'strudel_sound_favorites';

function load() {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('[soundFavorites] failed to load', e);
    return {};
  }
}

// { [id]: { tags: string[] } }
export const $soundFavorites = atom(load());

function persist(next) {
  $soundFavorites.set(next);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('[soundFavorites] failed to save', e);
    }
  }
}

export function isFavorite(id) {
  return !!$soundFavorites.get()[id];
}

export function toggleFavorite(id) {
  const current = { ...$soundFavorites.get() };
  if (current[id]) {
    delete current[id];
  } else {
    current[id] = { tags: [] };
  }
  persist(current);
}

export function setFavoriteTags(id, tags) {
  const current = { ...$soundFavorites.get() };
  current[id] = { tags };
  persist(current);
}

export function getFavoriteTags(id) {
  return $soundFavorites.get()[id]?.tags ?? [];
}

// True if `id` is favorited itself, or if any favorited id with the same
// bank prefix ("bd" for "bd:2") carries a tag matching `query`.
export function favoritesMatchSearch(id, query) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const favs = $soundFavorites.get();
  return Object.entries(favs).some(([favId, { tags }]) => {
    if (favId !== id && !favId.startsWith(`${id}:`)) return false;
    return (tags || []).some((t) => t.toLowerCase().includes(q));
  });
}

export function useSoundFavorites() {
  return useStore($soundFavorites);
}

import { DownloadHistoryItem } from '../types/video';

const HISTORY_KEY = 'omnidrop_download_history_v1';
const PREFS_KEY = 'omnidrop_user_preferences_v1';

export function getStoredHistory(): DownloadHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed reading history:', e);
    return [];
  }
}

export function saveHistoryItem(item: Omit<DownloadHistoryItem, 'id' | 'timestamp'>): DownloadHistoryItem {
  const history = getStoredHistory();
  const newItem: DownloadHistoryItem = {
    ...item,
    id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: Date.now(),
  };

  const updated = [newItem, ...history.filter(h => h.originalUrl !== item.originalUrl || h.qualityId !== item.qualityId)].slice(0, 50);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed saving history:', e);
  }
  return newItem;
}

export function updateHistoryItem(
  id: string,
  patch: Partial<DownloadHistoryItem>
): DownloadHistoryItem[] {
  const history = getStoredHistory().map((item) =>
    item.id === id ? { ...item, ...patch } : item
  );
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    console.error('Failed updating history item:', e);
  }
  return history;
}

export function removeHistoryItem(id: string): DownloadHistoryItem[] {
  const history = getStoredHistory().filter(item => item.id !== id);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    console.error('Failed removing history item:', e);
  }
  return history;
}

export function clearAllHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch (e) {
    console.error('Failed clearing history:', e);
  }
}

export interface UserPreferences {
  theme: 'dark' | 'light';
  lang: 'he' | 'en';
}

export function getUserPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Failed reading user preferences:', e);
  }
  return {
    theme: 'dark', // Sleek dark slate default for media downloader
    lang: 'he', // Hebrew default as requested by prompt
  };
}

export function saveUserPreferences(prefs: UserPreferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.error('Failed saving user preferences:', e);
  }
}

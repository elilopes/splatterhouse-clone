import { DEFAULT_PROGRESS, type GameProgress } from "./types";

const KEY = "splatterhouse.progress.v1";

export function loadLocalProgress(): GameProgress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PROGRESS };
    const parsed = JSON.parse(raw) as Partial<GameProgress>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.unlockedStages)) {
      return { ...DEFAULT_PROGRESS };
    }
    return { ...DEFAULT_PROGRESS, ...parsed };
  } catch {
    return { ...DEFAULT_PROGRESS };
  }
}

export function saveLocalProgress(progress: GameProgress): void {
  localStorage.setItem(KEY, JSON.stringify({
    ...progress,
    updatedAt: new Date().toISOString()
  }));
}

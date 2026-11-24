export type GameProgress = {
  schemaVersion: 1;
  currentStage: number;
  unlockedStages: number[];
  checkpoint: string;
  totalScore: number;
  totalKills: number;
  deaths: number;
  updatedAt: string;
};

export const DEFAULT_PROGRESS: GameProgress = {
  schemaVersion: 1,
  currentStage: 1,
  unlockedStages: [1],
  checkpoint: "stage-01-start",
  totalScore: 0,
  totalKills: 0,
  deaths: 0,
  updatedAt: new Date().toISOString()
};

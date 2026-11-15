import type { GameK } from './adapter';

export interface GameState { mode: 'pov' | 'map'; guide: boolean; showRoute: boolean; showTrack: boolean; lens: number; warp: number; x: number; y: number; t: number; tilesLoaded: number; tilesTotal: number }
export interface Game {
  show(on: boolean): void;
  setMode(m: 'pov' | 'map'): void;
  setLens(i: number): void;
  setWarp(w: number): void;
  setExag(v: number): void;
  set(k: 'guide' | 'showRoute' | 'showTrack' | 'showRocks', v: boolean): void;
  scan(): void;
  reset(): void;
  readonly state: GameState;
  LENSES: [string, string][];
}
export function createGame(root: HTMLElement, K: GameK, opts?: { onChange?: () => void }): Game;

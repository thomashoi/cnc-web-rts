export type UnitType = 'LIGHT_INFANTRY' | 'MEDIUM_TANK' | 'HARVESTER' | 'MCV';

export interface UnitEntity {
  id: number;
  type: UnitType;
  ownerId: number;

  // Current simulation tick coordinates
  x: number;
  y: number;
  // Previous simulation tick coordinates (used for 60+ FPS render interpolation)
  prevX: number;
  prevY: number;

  // Movement & physics
  radius: number;
  speed: number; // World pixels per simulation tick
  targetX: number | null;
  targetY: number | null;

  // Orientation (in radians)
  hullAngle: number;
  turretAngle: number;

  // Combat & UI state
  hp: number;
  maxHp: number;
  selected: boolean;
}

export interface MoveCommand {
  tick: number;
  type: 'MOVE';
  unitIds: number[];
  targetX: number;
  targetY: number;
}

export type GameCommand = MoveCommand;

export interface TiberiumPatch {
  gridX: number;
  gridY: number;
  amount: number;
}

export const GAME_CONFIG = {
  TICK_RATE: 20, // 20 ticks per second
  TICK_MS: 1000 / 20, // 50ms per tick
  TILE_SIZE: 48,
  MAP_COLS: 40,
  MAP_ROWS: 40,
};

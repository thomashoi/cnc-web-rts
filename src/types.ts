export type UnitType = 'LIGHT_INFANTRY' | 'MEDIUM_TANK' | 'HARVESTER' | 'MCV';

export type BuildingType =
  | 'CONSTRUCTION_YARD'
  | 'POWER_PLANT'
  | 'REFINERY'
  | 'BARRACKS'
  | 'WAR_FACTORY';

export type HarvesterState =
  | 'IDLE'
  | 'MOVING_TO_TIBERIUM'
  | 'HARVESTING'
  | 'MOVING_TO_REFINERY'
  | 'UNLOADING';

export interface UnitEntity {
  id: number;
  type: UnitType;
  ownerId: number;

  // Current & previous tick coordinates for 60+ FPS interpolation
  x: number;
  y: number;
  prevX: number;
  prevY: number;

  radius: number;
  speed: number;
  targetX: number | null;
  targetY: number | null;

  hullAngle: number;
  turretAngle: number;

  hp: number;
  maxHp: number;
  selected: boolean;

  // Phase 2 Harvester FSM fields
  harvesterState?: HarvesterState;
  tiberiumLoad: number;
  maxTiberiumLoad: number;
  stateTimer: number;
  targetRefineryId: number | null;
  stuckTicks?: number;
}

export interface BuildingEntity {
  id: number;
  type: BuildingType;
  ownerId: number;
  gridX: number;
  gridY: number;
  widthTiles: number;
  heightTiles: number;
  hp: number;
  maxHp: number;
  powerProduced: number;
  powerConsumed: number;
  selected: boolean;
}

export interface ProductionItem {
  category: 'BUILDING' | 'INFANTRY' | 'VEHICLE';
  itemType: BuildingType | UnitType;
  totalCost: number;
  paidCost: number;
  totalTicks: number;
  completedTicks: number;
  readyToPlace: boolean;
  onHold: boolean;
}

export interface CatalogEntry {
  key: BuildingType | UnitType;
  category: 'BUILDING' | 'INFANTRY' | 'VEHICLE';
  name: string;
  cost: number;
  buildTicks: number;
  prerequisites: BuildingType[];
  widthTiles?: number;
  heightTiles?: number;
  powerProduced?: number;
  powerConsumed?: number;
  maxHp: number;
}

export const CATALOG: Record<BuildingType | UnitType, CatalogEntry> = {
  CONSTRUCTION_YARD: {
    key: 'CONSTRUCTION_YARD',
    category: 'BUILDING',
    name: 'Con. Yard',
    cost: 2500,
    buildTicks: 100,
    prerequisites: [],
    widthTiles: 3,
    heightTiles: 3,
    powerProduced: 25,
    powerConsumed: 0,
    maxHp: 1500,
  },
  POWER_PLANT: {
    key: 'POWER_PLANT',
    category: 'BUILDING',
    name: 'Power Plant',
    cost: 300,
    buildTicks: 60, // 3 seconds at 20Hz
    prerequisites: ['CONSTRUCTION_YARD'],
    widthTiles: 2,
    heightTiles: 2,
    powerProduced: 100,
    powerConsumed: 0,
    maxHp: 600,
  },
  REFINERY: {
    key: 'REFINERY',
    category: 'BUILDING',
    name: 'Refinery',
    cost: 1500,
    buildTicks: 120, // 6 seconds at 20Hz
    prerequisites: ['CONSTRUCTION_YARD', 'POWER_PLANT'],
    widthTiles: 3,
    heightTiles: 2,
    powerProduced: 0,
    powerConsumed: 40,
    maxHp: 1000,
  },
  BARRACKS: {
    key: 'BARRACKS',
    category: 'BUILDING',
    name: 'GDI Barracks',
    cost: 400,
    buildTicks: 70,
    prerequisites: ['CONSTRUCTION_YARD', 'POWER_PLANT'],
    widthTiles: 2,
    heightTiles: 2,
    powerProduced: 0,
    powerConsumed: 20,
    maxHp: 800,
  },
  WAR_FACTORY: {
    key: 'WAR_FACTORY',
    category: 'BUILDING',
    name: 'War Factory',
    cost: 2000,
    buildTicks: 140,
    prerequisites: ['CONSTRUCTION_YARD', 'REFINERY'],
    widthTiles: 3,
    heightTiles: 2,
    powerProduced: 0,
    powerConsumed: 50,
    maxHp: 1200,
  },
  LIGHT_INFANTRY: {
    key: 'LIGHT_INFANTRY',
    category: 'INFANTRY',
    name: 'Minigunner',
    cost: 100,
    buildTicks: 40,
    prerequisites: ['BARRACKS'],
    maxHp: 50,
  },
  MEDIUM_TANK: {
    key: 'MEDIUM_TANK',
    category: 'VEHICLE',
    name: 'Medium Tank',
    cost: 800,
    buildTicks: 90,
    prerequisites: ['WAR_FACTORY'],
    maxHp: 400,
  },
  HARVESTER: {
    key: 'HARVESTER',
    category: 'VEHICLE',
    name: 'Harvester',
    cost: 1200,
    buildTicks: 110,
    prerequisites: ['WAR_FACTORY', 'REFINERY'],
    maxHp: 600,
  },
  MCV: {
    key: 'MCV',
    category: 'VEHICLE',
    name: 'M.C.V.',
    cost: 2500,
    buildTicks: 150,
    prerequisites: ['WAR_FACTORY'],
    maxHp: 800,
  },
};

// Serializable Deterministic Commands
export interface MoveCommand {
  tick: number;
  type: 'MOVE';
  unitIds: number[];
  targetX: number;
  targetY: number;
}

export interface DeployMcvCommand {
  tick: number;
  type: 'DEPLOY_MCV';
  unitId: number;
}

export interface StartProductionCommand {
  tick: number;
  type: 'START_PRODUCTION';
  itemType: BuildingType | UnitType;
}

export interface CancelProductionCommand {
  tick: number;
  type: 'CANCEL_PRODUCTION';
  category: 'BUILDING' | 'INFANTRY' | 'VEHICLE' | 'UNIT';
}

export interface PlaceBuildingCommand {
  tick: number;
  type: 'PLACE_BUILDING';
  gridX: number;
  gridY: number;
}

export interface DirectHarvesterCommand {
  tick: number;
  type: 'DIRECT_HARVESTER';
  unitIds: number[];
  targetGridX?: number;
  targetGridY?: number;
  refineryId?: number;
}

export type GameCommand =
  | MoveCommand
  | DeployMcvCommand
  | StartProductionCommand
  | CancelProductionCommand
  | PlaceBuildingCommand
  | DirectHarvesterCommand;

export type CommandPayload =
  | Omit<MoveCommand, 'tick'>
  | Omit<DeployMcvCommand, 'tick'>
  | Omit<StartProductionCommand, 'tick'>
  | Omit<CancelProductionCommand, 'tick'>
  | Omit<PlaceBuildingCommand, 'tick'>
  | Omit<DirectHarvesterCommand, 'tick'>;

export interface TiberiumPatch {
  gridX: number;
  gridY: number;
  amount: number; // Max 100 per tile
}

export const GAME_CONFIG = {
  TICK_RATE: 20,
  TICK_MS: 1000 / 20,
  TILE_SIZE: 48,
  MAP_COLS: 40,
  MAP_ROWS: 40,
  BASE_ADJACENCY_TILES: 7, // Max tile distance from existing friendly building
};

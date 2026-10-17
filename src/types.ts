export type UnitType =
  | 'LIGHT_INFANTRY'
  | 'ROCKET_SOLDIER'
  | 'MEDIUM_TANK'
  | 'HARVESTER'
  | 'MCV';

export type BuildingType =
  | 'CONSTRUCTION_YARD'
  | 'POWER_PLANT'
  | 'REFINERY'
  | 'BARRACKS'
  | 'WAR_FACTORY'
  | 'GUARD_TOWER'
  | 'RADAR_DOME';

export type HarvesterState =
  | 'IDLE'
  | 'MOVING_TO_TIBERIUM'
  | 'HARVESTING'
  | 'MOVING_TO_REFINERY'
  | 'UNLOADING';

export type ArmorType = 'NONE' | 'LIGHT' | 'HEAVY';
export type WarheadType = 'SA' | 'AP' | 'HE';
export type ProjectileStyle = 'BULLET' | 'SHELL' | 'ROCKET';
export type MatchStatus = 'PLAYING' | 'VICTORY' | 'DEFEAT';

export type SfxType =
  | 'SHOOT_BULLET'
  | 'SHOOT_SHELL'
  | 'SHOOT_ROCKET'
  | 'EXPLOSION'
  | 'PLACE_BUILDING'
  | 'CREDITS_UNLOAD'
  | 'ORDER_ACK';

export interface GameEvent {
  sfx?: SfxType;
  evaSpeech?: string;
}

export const DAMAGE_MATRIX: Record<WarheadType, Record<ArmorType, number>> = {
  SA: { NONE: 1.0, LIGHT: 0.55, HEAVY: 0.25 },
  AP: { NONE: 0.35, LIGHT: 0.85, HEAVY: 1.0 },
  HE: { NONE: 0.9, LIGHT: 0.8, HEAVY: 0.65 },
};

export interface WeaponSpec {
  damage: number;
  range: number;
  cooldownTicks: number;
  warhead: WarheadType;
  projectileSpeed: number;
  projectileStyle: ProjectileStyle;
}

export interface UnitEntity {
  id: number;
  type: UnitType;
  ownerId: number; // 1 = GDI (Player), 2 = Brotherhood of Nod (AI)

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
  armor: ArmorType;
  sightRangeTiles: number;
  selected: boolean;

  harvesterState?: HarvesterState;
  tiberiumLoad: number;
  maxTiberiumLoad: number;
  stateTimer: number;
  targetRefineryId: number | null;

  weapon: WeaponSpec | null;
  attackCooldown: number;
  targetEntityId: number | null;
  isAttackMove: boolean;
  attackMoveDestX: number | null;
  attackMoveDestY: number | null;
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
  armor: ArmorType;
  sightRangeTiles: number;
  powerProduced: number;
  powerConsumed: number;
  selected: boolean;

  weapon: WeaponSpec | null;
  attackCooldown: number;
  targetEntityId: number | null;
  turretAngle: number;
}

export interface ProjectileEntity {
  id: number;
  ownerId: number;
  style: ProjectileStyle;
  warhead: WarheadType;
  damage: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  targetX: number;
  targetY: number;
  targetEntityId: number | null;
  speed: number;
}

export interface ExplosionEffect {
  id: number;
  x: number;
  y: number;
  maxRadius: number;
  currentTick: number;
  totalTicks: number;
  color: number;
}

export type VisibilityState = 0 | 1 | 2;

export interface ProductionItem {
  category: 'BUILDING' | 'UNIT';
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
  category: 'BUILDING' | 'UNIT';
  name: string;
  cost: number;
  buildTicks: number;
  prerequisites: BuildingType[];
  widthTiles?: number;
  heightTiles?: number;
  powerProduced?: number;
  powerConsumed?: number;
  maxHp: number;
  armor: ArmorType;
  sightRangeTiles: number;
  weapon?: WeaponSpec;
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
    powerProduced: 30,
    powerConsumed: 0,
    maxHp: 1500,
    armor: 'HEAVY',
    sightRangeTiles: 7,
  },
  POWER_PLANT: {
    key: 'POWER_PLANT',
    category: 'BUILDING',
    name: 'Power Plant',
    cost: 300,
    buildTicks: 50,
    prerequisites: ['CONSTRUCTION_YARD'],
    widthTiles: 2,
    heightTiles: 2,
    powerProduced: 100,
    powerConsumed: 0,
    maxHp: 600,
    armor: 'LIGHT',
    sightRangeTiles: 5,
  },
  REFINERY: {
    key: 'REFINERY',
    category: 'BUILDING',
    name: 'Refinery',
    cost: 1500,
    buildTicks: 100,
    prerequisites: ['CONSTRUCTION_YARD', 'POWER_PLANT'],
    widthTiles: 3,
    heightTiles: 2,
    powerProduced: 0,
    powerConsumed: 40,
    maxHp: 1000,
    armor: 'LIGHT',
    sightRangeTiles: 6,
  },
  BARRACKS: {
    key: 'BARRACKS',
    category: 'BUILDING',
    name: 'GDI Barracks',
    cost: 400,
    buildTicks: 60,
    prerequisites: ['CONSTRUCTION_YARD', 'POWER_PLANT'],
    widthTiles: 2,
    heightTiles: 2,
    powerProduced: 0,
    powerConsumed: 20,
    maxHp: 800,
    armor: 'LIGHT',
    sightRangeTiles: 5,
  },
  WAR_FACTORY: {
    key: 'WAR_FACTORY',
    category: 'BUILDING',
    name: 'War Factory',
    cost: 2000,
    buildTicks: 120,
    prerequisites: ['CONSTRUCTION_YARD', 'REFINERY'],
    widthTiles: 3,
    heightTiles: 2,
    powerProduced: 0,
    powerConsumed: 50,
    maxHp: 1200,
    armor: 'HEAVY',
    sightRangeTiles: 6,
  },
  GUARD_TOWER: {
    key: 'GUARD_TOWER',
    category: 'BUILDING',
    name: 'Guard Tower',
    cost: 500,
    buildTicks: 65,
    prerequisites: ['CONSTRUCTION_YARD', 'BARRACKS'],
    widthTiles: 1,
    heightTiles: 1,
    powerProduced: 0,
    powerConsumed: 25,
    maxHp: 650,
    armor: 'HEAVY',
    sightRangeTiles: 7,
    weapon: {
      damage: 24,
      range: 250,
      cooldownTicks: 9,
      warhead: 'SA',
      projectileSpeed: 26,
      projectileStyle: 'BULLET',
    },
  },
  RADAR_DOME: {
    key: 'RADAR_DOME',
    category: 'BUILDING',
    name: 'Radar Dome',
    cost: 1000,
    buildTicks: 90,
    prerequisites: ['CONSTRUCTION_YARD', 'REFINERY'],
    widthTiles: 2,
    heightTiles: 2,
    powerProduced: 0,
    powerConsumed: 45,
    maxHp: 900,
    armor: 'LIGHT',
    sightRangeTiles: 10,
  },
  LIGHT_INFANTRY: {
    key: 'LIGHT_INFANTRY',
    category: 'UNIT',
    name: 'Minigunner',
    cost: 100,
    buildTicks: 35,
    prerequisites: ['BARRACKS'],
    maxHp: 60,
    armor: 'NONE',
    sightRangeTiles: 5,
    weapon: {
      damage: 14,
      range: 150,
      cooldownTicks: 10,
      warhead: 'SA',
      projectileSpeed: 24,
      projectileStyle: 'BULLET',
    },
  },
  ROCKET_SOLDIER: {
    key: 'ROCKET_SOLDIER',
    category: 'UNIT',
    name: 'Rocket Inf.',
    cost: 300,
    buildTicks: 55,
    prerequisites: ['BARRACKS', 'RADAR_DOME'],
    maxHp: 55,
    armor: 'NONE',
    sightRangeTiles: 6,
    weapon: {
      damage: 55,
      range: 230,
      cooldownTicks: 24,
      warhead: 'AP',
      projectileSpeed: 16,
      projectileStyle: 'ROCKET',
    },
  },
  MEDIUM_TANK: {
    key: 'MEDIUM_TANK',
    category: 'UNIT',
    name: 'Medium Tank',
    cost: 800,
    buildTicks: 85,
    prerequisites: ['WAR_FACTORY'],
    maxHp: 420,
    armor: 'HEAVY',
    sightRangeTiles: 6,
    weapon: {
      damage: 70,
      range: 220,
      cooldownTicks: 22,
      warhead: 'AP',
      projectileSpeed: 20,
      projectileStyle: 'SHELL',
    },
  },
  HARVESTER: {
    key: 'HARVESTER',
    category: 'UNIT',
    name: 'Harvester',
    cost: 1200,
    buildTicks: 100,
    prerequisites: ['WAR_FACTORY', 'REFINERY'],
    maxHp: 600,
    armor: 'LIGHT',
    sightRangeTiles: 5,
  },
  MCV: {
    key: 'MCV',
    category: 'UNIT',
    name: 'M.C.V.',
    cost: 2500,
    buildTicks: 140,
    prerequisites: ['WAR_FACTORY'],
    maxHp: 800,
    armor: 'LIGHT',
    sightRangeTiles: 6,
  },
};

export interface MoveCommand {
  tick: number;
  type: 'MOVE';
  unitIds: number[];
  targetX: number;
  targetY: number;
}

export interface AttackCommand {
  tick: number;
  type: 'ATTACK';
  unitIds: number[];
  targetEntityId: number;
}

export interface AttackMoveCommand {
  tick: number;
  type: 'ATTACK_MOVE';
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
  category: 'BUILDING' | 'UNIT';
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
  | AttackCommand
  | AttackMoveCommand
  | DeployMcvCommand
  | StartProductionCommand
  | CancelProductionCommand
  | PlaceBuildingCommand
  | DirectHarvesterCommand;

export interface TiberiumPatch {
  gridX: number;
  gridY: number;
  amount: number;
}

export const GAME_CONFIG = {
  TICK_RATE: 20,
  TICK_MS: 1000 / 20,
  TILE_SIZE: 48,
  MAP_COLS: 40,
  MAP_ROWS: 40,
  BASE_ADJACENCY_TILES: 7,
  AI_WAVE_INTERVAL_TICKS: 2400, // 2 minutes (120 seconds) per Nod assault wave
};

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
export type CommandPayload = DistributiveOmit<GameCommand, 'tick'>;

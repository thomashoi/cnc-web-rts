import { GAME_CONFIG, GameCommand, TiberiumPatch, UnitEntity, UnitType } from './types';

export class GameEngine {
  public currentTick = 0;
  public credits = 5000;
  public units: Map<number, UnitEntity> = new Map();
  public tiberiumPatches: TiberiumPatch[] = [];
  public commandQueue: GameCommand[] = [];
  public lastCommandText = 'Awaiting orders';

  private nextEntityId = 1;

  constructor() {
    this.seedInitialMap();
  }

  private seedInitialMap(): void {
    // Spawn a starting GDI strike force near the center-left
    this.spawnUnit('MCV', 420, 460);
    this.spawnUnit('HARVESTER', 500, 520);

    this.spawnUnit('MEDIUM_TANK', 560, 380);
    this.spawnUnit('MEDIUM_TANK', 560, 440);
    this.spawnUnit('MEDIUM_TANK', 560, 500);

    this.spawnUnit('LIGHT_INFANTRY', 640, 390);
    this.spawnUnit('LIGHT_INFANTRY', 640, 425);
    this.spawnUnit('LIGHT_INFANTRY', 640, 460);
    this.spawnUnit('LIGHT_INFANTRY', 640, 495);

    // Seed Tiberium crystal fields on the right side of the sector
    const patchCenters = [
      { cx: 18, cy: 10 },
      { cx: 22, cy: 16 },
    ];
    for (const center of patchCenters) {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          if (Math.abs(dx) + Math.abs(dy) <= 3) {
            this.tiberiumPatches.push({
              gridX: center.cx + dx,
              gridY: center.cy + dy,
              amount: 100,
            });
          }
        }
      }
    }
  }

  public spawnUnit(type: UnitType, x: number, y: number, ownerId = 1): UnitEntity {
    const specs: Record<UnitType, { radius: number; speed: number; maxHp: number }> = {
      LIGHT_INFANTRY: { radius: 9, speed: 4.5, maxHp: 50 },
      MEDIUM_TANK: { radius: 18, speed: 6.0, maxHp: 400 },
      HARVESTER: { radius: 22, speed: 4.0, maxHp: 600 },
      MCV: { radius: 25, speed: 3.2, maxHp: 800 },
    };

    const spec = specs[type];
    const unit: UnitEntity = {
      id: this.nextEntityId++,
      type,
      ownerId,
      x,
      y,
      prevX: x,
      prevY: y,
      radius: spec.radius,
      speed: spec.speed,
      targetX: null,
      targetY: null,
      hullAngle: 0,
      turretAngle: 0,
      hp: spec.maxHp,
      maxHp: spec.maxHp,
      selected: false,
    };

    this.units.set(unit.id, unit);
    return unit;
  }

  /**
   * Queues a serializable command for the next deterministic simulation tick.
   */
  public issueCommand(cmd: Omit<GameCommand, 'tick'>): void {
    const scheduledCmd: GameCommand = {
      ...cmd,
      tick: this.currentTick + 1,
    };
    this.commandQueue.push(scheduledCmd);
  }

  /**
   * Executes exactly one 50ms simulation tick (20 Hz).
   */
  public stepSimulationTick(): void {
    this.currentTick++;

    // 1. Snapshot current positions for smooth render interpolation
    for (const unit of this.units.values()) {
      unit.prevX = unit.x;
      unit.prevY = unit.y;
    }

    // 2. Process all commands scheduled for this tick
    this.processCommandsForTick(this.currentTick);

    // 3. Step unit movement and collision separation
    this.updateUnitsMovement();
  }

  private processCommandsForTick(tick: number): void {
    const remaining: GameCommand[] = [];

    for (const cmd of this.commandQueue) {
      if (cmd.tick <= tick) {
        if (cmd.type === 'MOVE') {
          this.executeMoveCommand(cmd.unitIds, cmd.targetX, cmd.targetY);
          this.lastCommandText = `MOVE (${cmd.unitIds.length} units) -> [${Math.round(cmd.targetX)}, ${Math.round(cmd.targetY)}]`;
        }
      } else {
        remaining.push(cmd);
      }
    }

    this.commandQueue = remaining;
  }

  private executeMoveCommand(unitIds: number[], targetX: number, targetY: number): void {
    const count = unitIds.length;
    const cols = Math.ceil(Math.sqrt(count));
    const spacing = 46;

    unitIds.forEach((id, index) => {
      const unit = this.units.get(id);
      if (!unit) return;

      // Arrange multiple units into a clean box formation around the target point
      const col = index % cols;
      const row = Math.floor(index / cols);
      const offsetX = (col - (cols - 1) / 2) * spacing;
      const offsetY = (row - (Math.ceil(count / cols) - 1) / 2) * spacing;

      unit.targetX = this.clampToWorld(targetX + offsetX, true);
      unit.targetY = this.clampToWorld(targetY + offsetY, false);
    });
  }

  private updateUnitsMovement(): void {
    const unitList = Array.from(this.units.values());

    for (const unit of unitList) {
      if (unit.targetX !== null && unit.targetY !== null) {
        const dx = unit.targetX - unit.x;
        const dy = unit.targetY - unit.y;
        const dist = Math.hypot(dx, dy);

        if (dist <= unit.speed) {
          unit.x = unit.targetX;
          unit.y = unit.targetY;
          unit.targetX = null;
          unit.targetY = null;
        } else {
          const dirX = dx / dist;
          const dirY = dy / dist;
          unit.x += dirX * unit.speed;
          unit.y += dirY * unit.speed;
          unit.hullAngle = Math.atan2(dy, dx);
          unit.turretAngle = unit.hullAngle;
        }
      }
    }

    // Local unit separation (prevents overlapping)
    for (let i = 0; i < unitList.length; i++) {
      for (let j = i + 1; j < unitList.length; j++) {
        const a = unitList[i];
        const b = unitList[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minDist = a.radius + b.radius + 4;

        if (dist > 0 && dist < minDist) {
          const overlap = (minDist - dist) * 0.35;
          const nx = dx / dist;
          const ny = dy / dist;
          a.x = this.clampToWorld(a.x - nx * overlap, true);
          a.y = this.clampToWorld(a.y - ny * overlap, false);
          b.x = this.clampToWorld(b.x + nx * overlap, true);
          b.y = this.clampToWorld(b.y + ny * overlap, false);
        }
      }
    }
  }

  private clampToWorld(val: number, isX: boolean): number {
    const max = isX
      ? GAME_CONFIG.MAP_COLS * GAME_CONFIG.TILE_SIZE - 24
      : GAME_CONFIG.MAP_ROWS * GAME_CONFIG.TILE_SIZE - 24;
    return Math.max(24, Math.min(max, val));
  }
}

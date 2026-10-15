import {
  BuildingEntity,
  BuildingType,
  CATALOG,
  CommandPayload,
  GAME_CONFIG,
  GameCommand,
  ProductionItem,
  TiberiumPatch,
  UnitEntity,
  UnitType,
} from './types';

export class GameEngine {
  public currentTick = 0;
  public credits = 5000;
  public units: Map<number, UnitEntity> = new Map();
  public buildings: Map<number, BuildingEntity> = new Map();
  public tiberiumPatches: TiberiumPatch[] = [];
  public commandQueue: GameCommand[] = [];
  public lastCommandText = 'Select MCV & press [D] to deploy';

  // Dual C&C Production Queues (Structures vs Units)
  public buildingQueue: ProductionItem | null = null;
  public unitQueue: ProductionItem | null = null;

  private nextEntityId = 1;

  constructor() {
    this.seedInitialMap();
  }

  private seedInitialMap(): void {
    // Spawn starting GDI Strike Force
    this.spawnUnit('MCV', 360, 456);
    this.spawnUnit('HARVESTER', 460, 520);

    this.spawnUnit('MEDIUM_TANK', 540, 380);
    this.spawnUnit('MEDIUM_TANK', 540, 440);
    this.spawnUnit('MEDIUM_TANK', 540, 500);

    this.spawnUnit('LIGHT_INFANTRY', 610, 395);
    this.spawnUnit('LIGHT_INFANTRY', 610, 435);
    this.spawnUnit('LIGHT_INFANTRY', 610, 475);

    // Seed rich Tiberium crystal fields
    const patchCenters = [
      { cx: 16, cy: 10 },
      { cx: 20, cy: 15 },
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
      HARVESTER: { radius: 21, speed: 4.2, maxHp: 600 },
      MCV: { radius: 24, speed: 3.2, maxHp: 800 },
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
      harvesterState: type === 'HARVESTER' ? 'IDLE' : undefined,
      tiberiumLoad: 0,
      maxTiberiumLoad: 500,
      stateTimer: 0,
      targetRefineryId: null,
    };

    this.units.set(unit.id, unit);
    return unit;
  }

  public spawnBuilding(type: BuildingType, gridX: number, gridY: number, ownerId = 1): BuildingEntity {
    const entry = CATALOG[type];
    const bldg: BuildingEntity = {
      id: this.nextEntityId++,
      type,
      ownerId,
      gridX,
      gridY,
      widthTiles: entry.widthTiles ?? 2,
      heightTiles: entry.heightTiles ?? 2,
      hp: entry.maxHp,
      maxHp: entry.maxHp,
      powerProduced: entry.powerProduced ?? 0,
      powerConsumed: entry.powerConsumed ?? 0,
      selected: false,
    };

    this.buildings.set(bldg.id, bldg);

    // Classic C&C rule: Building a Refinery grants a free Harvester!
    if (type === 'REFINERY') {
      const dock = this.getRefineryDockWorldPos(bldg);
      this.spawnUnit('HARVESTER', dock.x, dock.y + 24, ownerId);
    }

    return bldg;
  }

  public getPowerStats(): { produced: number; consumed: number; isLowPower: boolean } {
    let produced = 0;
    let consumed = 0;
    for (const b of this.buildings.values()) {
      produced += b.powerProduced;
      consumed += b.powerConsumed;
    }
    return {
      produced,
      consumed,
      isLowPower: consumed > produced,
    };
  }

  public hasPrerequisites(itemType: BuildingType | UnitType): boolean {
    const reqs = CATALOG[itemType].prerequisites;
    const ownedTypes = new Set(Array.from(this.buildings.values()).map((b) => b.type));
    return reqs.every((r) => ownedTypes.has(r));
  }

  /**
   * Validates whether a structure of size (w, h) can be placed at (gridX, gridY).
   * Returns a per-tile validity matrix plus overall boolean.
   */
  public validateBuildingPlacement(
    type: BuildingType,
    gridX: number,
    gridY: number,
    ignoreAdjacency = false
  ): { valid: boolean; tileMatrix: boolean[][] } {
    const entry = CATALOG[type];
    const w = entry.widthTiles ?? 2;
    const h = entry.heightTiles ?? 2;
    const tileMatrix: boolean[][] = [];
    let allTilesClear = true;

    for (let dy = 0; dy < h; dy++) {
      const row: boolean[] = [];
      for (let dx = 0; dx < w; dx++) {
        const tx = gridX + dx;
        const ty = gridY + dy;
        const tileFree = this.isTileClearForBuilding(tx, ty);
        row.push(tileFree);
        if (!tileFree) allTilesClear = false;
      }
      tileMatrix.push(row);
    }

    // Check C&C Base Adjacency Rule (must be within BASE_ADJACENCY_TILES of an existing building)
    let withinAdjacency = ignoreAdjacency;
    if (!ignoreAdjacency) {
      const centerGX = gridX + w / 2;
      const centerGY = gridY + h / 2;
      for (const b of this.buildings.values()) {
        const bCenterX = b.gridX + b.widthTiles / 2;
        const bCenterY = b.gridY + b.heightTiles / 2;
        const dist = Math.hypot(centerGX - bCenterX, centerGY - bCenterY);
        if (dist <= GAME_CONFIG.BASE_ADJACENCY_TILES) {
          withinAdjacency = true;
          break;
        }
      }
    }

    return {
      valid: allTilesClear && withinAdjacency,
      tileMatrix: tileMatrix.map((row) => row.map((cell) => cell && withinAdjacency)),
    };
  }

  private isTileClearForBuilding(tx: number, ty: number, ignoreUnitId?: number): boolean {
    if (tx < 1 || ty < 1 || tx >= GAME_CONFIG.MAP_COLS - 1 || ty >= GAME_CONFIG.MAP_ROWS - 1) {
      return false;
    }

    // Check existing buildings
    for (const b of this.buildings.values()) {
      if (tx >= b.gridX && tx < b.gridX + b.widthTiles && ty >= b.gridY && ty < b.gridY + b.heightTiles) {
        return false;
      }
    }

    // Check Tiberium patches
    for (const p of this.tiberiumPatches) {
      if (p.gridX === tx && p.gridY === ty && p.amount > 0) {
        return false;
      }
    }

    // Check units occupying the tile
    const { TILE_SIZE } = GAME_CONFIG;
    const tileLeft = tx * TILE_SIZE;
    const tileRight = tileLeft + TILE_SIZE;
    const tileTop = ty * TILE_SIZE;
    const tileBottom = tileTop + TILE_SIZE;

    for (const u of this.units.values()) {
      if (u.id === ignoreUnitId) continue;
      if (u.x + u.radius > tileLeft && u.x - u.radius < tileRight && u.y + u.radius > tileTop && u.y - u.radius < tileBottom) {
        return false;
      }
    }

    return true;
  }

  public issueCommand(cmd: CommandPayload): void {
    this.commandQueue.push({
      ...cmd,
      tick: this.currentTick + 1,
    } as GameCommand);
  }

  /**
   * Advances simulation by 1 deterministic tick (50ms / 20 Hz).
   */
  public stepSimulationTick(): void {
    this.currentTick++;

    // 1. Save previous positions for smooth 60+ FPS interpolation
    for (const unit of this.units.values()) {
      unit.prevX = unit.x;
      unit.prevY = unit.y;
    }

    // 2. Execute scheduled player commands
    this.processCommandsForTick(this.currentTick);

    // 3. Step Trickle-Drain Production Queues
    this.updateProductionQueues();

    // 4. Step Automated Harvester State Machine
    this.updateHarvestersFSM();

    // 5. Step Unit Movement & Collision Separation
    this.updateUnitsMovement();
  }

  private processCommandsForTick(tick: number): void {
    const remaining: GameCommand[] = [];

    for (const cmd of this.commandQueue) {
      if (cmd.tick <= tick) {
        switch (cmd.type) {
          case 'MOVE':
            this.executeMoveCommand(cmd.unitIds, cmd.targetX, cmd.targetY);
            this.lastCommandText = `MOVE (${cmd.unitIds.length}) -> [${Math.round(cmd.targetX)}, ${Math.round(cmd.targetY)}]`;
            break;
          case 'DEPLOY_MCV':
            this.executeDeployMcv(cmd.unitId);
            break;
          case 'START_PRODUCTION':
            this.executeStartProduction(cmd.itemType);
            break;
          case 'CANCEL_PRODUCTION':
            this.executeCancelProduction(cmd.category);
            break;
          case 'PLACE_BUILDING':
            this.executePlaceBuilding(cmd.gridX, cmd.gridY);
            break;
          case 'DIRECT_HARVESTER':
            this.executeDirectHarvester(cmd.unitIds, cmd.targetGridX, cmd.targetGridY, cmd.refineryId);
            break;
        }
      } else {
        remaining.push(cmd);
      }
    }

    this.commandQueue = remaining;
  }

  private executeDeployMcv(unitId: number): void {
    const mcv = this.units.get(unitId);
    if (!mcv || mcv.type !== 'MCV') return;

    const { TILE_SIZE } = GAME_CONFIG;
    const gridX = Math.round(mcv.x / TILE_SIZE) - 1;
    const gridY = Math.round(mcv.y / TILE_SIZE) - 1;

    // Verify 3x3 tiles are clear (ignoring the MCV itself)
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        if (!this.isTileClearForBuilding(gridX + dx, gridY + dy, mcv.id)) {
          this.lastCommandText = 'Cannot deploy MCV: Area blocked!';
          return;
        }
      }
    }

    this.units.delete(mcv.id);
    this.spawnBuilding('CONSTRUCTION_YARD', gridX, gridY, mcv.ownerId);
    this.lastCommandText = 'MCV deployed into Construction Yard!';
  }

  private executeStartProduction(itemType: BuildingType | UnitType): void {
    const entry = CATALOG[itemType];
    if (!this.hasPrerequisites(itemType)) {
      this.lastCommandText = `Requires ${entry.prerequisites.join(' + ')}`;
      return;
    }

    const prodItem: ProductionItem = {
      category: entry.category,
      itemType,
      totalCost: entry.cost,
      paidCost: 0,
      totalTicks: entry.buildTicks,
      completedTicks: 0,
      readyToPlace: false,
      onHold: false,
    };

    if (entry.category === 'BUILDING') {
      if (this.buildingQueue) return;
      this.buildingQueue = prodItem;
      this.lastCommandText = `Constructing ${entry.name}...`;
    } else {
      if (this.unitQueue) return;
      this.unitQueue = prodItem;
      this.lastCommandText = `Training ${entry.name}...`;
    }
  }

  private executeCancelProduction(category: 'BUILDING' | 'UNIT'): void {
    if (category === 'BUILDING' && this.buildingQueue) {
      this.credits += Math.round(this.buildingQueue.paidCost);
      this.buildingQueue = null;
      this.lastCommandText = 'Structure construction cancelled (Refunded)';
    } else if (category === 'UNIT' && this.unitQueue) {
      this.credits += Math.round(this.unitQueue.paidCost);
      this.unitQueue = null;
      this.lastCommandText = 'Unit production cancelled (Refunded)';
    }
  }

  private executePlaceBuilding(gridX: number, gridY: number): void {
    if (!this.buildingQueue || !this.buildingQueue.readyToPlace) return;
    const bType = this.buildingQueue.itemType as BuildingType;

    const check = this.validateBuildingPlacement(bType, gridX, gridY);
    if (!check.valid) {
      this.lastCommandText = 'Invalid placement location!';
      return;
    }

    this.spawnBuilding(bType, gridX, gridY, 1);
    this.buildingQueue = null;
    this.lastCommandText = `${CATALOG[bType].name} deployed!`;
  }

  private updateProductionQueues(): void {
    const { isLowPower } = this.getPowerStats();
    // Low power halves production speed (advances only on even ticks)
    const canStepThisTick = !isLowPower || this.currentTick % 2 === 0;

    if (this.buildingQueue && !this.buildingQueue.readyToPlace && canStepThisTick) {
      this.stepSingleQueue(this.buildingQueue);
    }

    if (this.unitQueue && canStepThisTick) {
      this.stepSingleQueue(this.unitQueue);
      if (this.unitQueue && this.unitQueue.readyToPlace) {
        this.spawnCompletedUnit(this.unitQueue.itemType as UnitType);
        this.unitQueue = null;
      }
    }
  }

  private stepSingleQueue(q: ProductionItem): void {
    const remainingTicks = q.totalTicks - q.completedTicks;
    const remainingCost = q.totalCost - q.paidCost;
    const costThisTick = remainingTicks > 0 ? remainingCost / remainingTicks : 0;

    if (this.credits >= costThisTick) {
      this.credits -= costThisTick;
      q.paidCost += costThisTick;
      q.completedTicks++;
      q.onHold = false;

      if (q.completedTicks >= q.totalTicks) {
        q.readyToPlace = true;
        if (q.category === 'BUILDING') {
          this.lastCommandText = `${CATALOG[q.itemType].name} ready to place!`;
        }
      }
    } else {
      q.onHold = true;
    }
  }

  private spawnCompletedUnit(uType: UnitType): void {
    const producerType: BuildingType = uType === 'LIGHT_INFANTRY' ? 'BARRACKS' : 'WAR_FACTORY';
    const producer = Array.from(this.buildings.values()).find((b) => b.type === producerType);

    const { TILE_SIZE } = GAME_CONFIG;
    let spawnX = 400;
    let spawnY = 400;

    if (producer) {
      spawnX = (producer.gridX + producer.widthTiles / 2) * TILE_SIZE;
      spawnY = (producer.gridY + producer.heightTiles) * TILE_SIZE + 26;
    }

    const unit = this.spawnUnit(uType, spawnX, spawnY, 1);
    // Give newly spawned unit a slight move offset so the factory exit stays clear
    unit.targetX = spawnX + (this.currentTick % 3 - 1) * 28;
    unit.targetY = spawnY + 38;
    this.lastCommandText = `${CATALOG[uType].name} ready!`;
  }

  // ============================================================================
  // AUTOMATED HARVESTER FINITE STATE MACHINE
  // ============================================================================
  private updateHarvestersFSM(): void {
    const { TILE_SIZE } = GAME_CONFIG;

    for (const unit of this.units.values()) {
      if (unit.type !== 'HARVESTER' || !unit.harvesterState) continue;

      switch (unit.harvesterState) {
        case 'IDLE': {
          if (unit.tiberiumLoad >= unit.maxTiberiumLoad) {
            const refinery = this.findNearestRefinery(unit.x, unit.y);
            if (refinery) {
              const dock = this.getRefineryDockWorldPos(refinery);
              unit.targetRefineryId = refinery.id;
              unit.targetX = dock.x;
              unit.targetY = dock.y;
              unit.harvesterState = 'MOVING_TO_REFINERY';
            }
          } else {
            const patch = this.findNearestTiberiumPatch(unit.x, unit.y);
            if (patch) {
              unit.targetX = patch.gridX * TILE_SIZE + TILE_SIZE / 2;
              unit.targetY = patch.gridY * TILE_SIZE + TILE_SIZE / 2;
              unit.harvesterState = 'MOVING_TO_TIBERIUM';
            } else if (unit.tiberiumLoad > 0) {
              // No more Tiberium on map, return partial load
              const refinery = this.findNearestRefinery(unit.x, unit.y);
              if (refinery) {
                const dock = this.getRefineryDockWorldPos(refinery);
                unit.targetRefineryId = refinery.id;
                unit.targetX = dock.x;
                unit.targetY = dock.y;
                unit.harvesterState = 'MOVING_TO_REFINERY';
              }
            }
          }
          break;
        }

        case 'MOVING_TO_TIBERIUM': {
          if (unit.targetX === null && unit.targetY === null) {
            unit.harvesterState = 'HARVESTING';
            unit.stateTimer = 10; // Harvest scoop every 10 ticks (0.5s)
          }
          break;
        }

        case 'HARVESTING': {
          const gx = Math.floor(unit.x / TILE_SIZE);
          const gy = Math.floor(unit.y / TILE_SIZE);
          const patch = this.tiberiumPatches.find((p) => p.gridX === gx && p.gridY === gy && p.amount > 0);

          if (!patch) {
            unit.harvesterState = 'IDLE';
            break;
          }

          unit.stateTimer--;
          if (unit.stateTimer <= 0) {
            unit.stateTimer = 10;
            const scoop = Math.min(100, unit.maxTiberiumLoad - unit.tiberiumLoad);
            unit.tiberiumLoad += scoop;
            patch.amount -= 25;

            if (patch.amount <= 0) {
              this.tiberiumPatches = this.tiberiumPatches.filter((p) => p.amount > 0);
            }

            if (unit.tiberiumLoad >= unit.maxTiberiumLoad) {
              unit.harvesterState = 'IDLE';
            }
          }
          break;
        }

        case 'MOVING_TO_REFINERY': {
          const refinery = unit.targetRefineryId ? this.buildings.get(unit.targetRefineryId) : null;
          if (!refinery) {
            unit.harvesterState = 'IDLE';
            break;
          }

          if (unit.targetX === null && unit.targetY === null) {
            unit.harvesterState = 'UNLOADING';
            unit.stateTimer = 16; // Unload duration (0.8s)
          }
          break;
        }

        case 'UNLOADING': {
          unit.stateTimer--;
          if (unit.stateTimer <= 0) {
            this.credits += unit.tiberiumLoad;
            this.lastCommandText = `Harvester unloaded +$${unit.tiberiumLoad} credits`;
            unit.tiberiumLoad = 0;
            unit.harvesterState = 'IDLE';
          }
          break;
        }
      }
    }
  }

  private executeDirectHarvester(
    unitIds: number[],
    targetGridX?: number,
    targetGridY?: number,
    refineryId?: number
  ): void {
    const { TILE_SIZE } = GAME_CONFIG;
    for (const id of unitIds) {
      const u = this.units.get(id);
      if (!u || u.type !== 'HARVESTER') continue;

      if (refineryId !== undefined) {
        const ref = this.buildings.get(refineryId);
        if (ref && ref.type === 'REFINERY') {
          const dock = this.getRefineryDockWorldPos(ref);
          u.targetRefineryId = ref.id;
          u.targetX = dock.x;
          u.targetY = dock.y;
          u.harvesterState = 'MOVING_TO_REFINERY';
          this.lastCommandText = 'Harvester returning to Refinery';
        }
      } else if (targetGridX !== undefined && targetGridY !== undefined) {
        u.targetX = targetGridX * TILE_SIZE + TILE_SIZE / 2;
        u.targetY = targetGridY * TILE_SIZE + TILE_SIZE / 2;
        u.harvesterState = 'MOVING_TO_TIBERIUM';
        this.lastCommandText = 'Harvester directed to Tiberium patch';
      }
    }
  }

  private findNearestTiberiumPatch(x: number, y: number): TiberiumPatch | null {
    const { TILE_SIZE } = GAME_CONFIG;
    let best: TiberiumPatch | null = null;
    let bestDist = Infinity;

    for (const p of this.tiberiumPatches) {
      if (p.amount <= 0) continue;
      const px = p.gridX * TILE_SIZE + TILE_SIZE / 2;
      const py = p.gridY * TILE_SIZE + TILE_SIZE / 2;
      const d = Math.hypot(px - x, py - y);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  private findNearestRefinery(x: number, y: number): BuildingEntity | null {
    let best: BuildingEntity | null = null;
    let bestDist = Infinity;

    for (const b of this.buildings.values()) {
      if (b.type !== 'REFINERY') continue;
      const dock = this.getRefineryDockWorldPos(b);
      const d = Math.hypot(dock.x - x, dock.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    return best;
  }

  public getRefineryDockWorldPos(refinery: BuildingEntity): { x: number; y: number } {
    const { TILE_SIZE } = GAME_CONFIG;
    return {
      x: (refinery.gridX + refinery.widthTiles / 2) * TILE_SIZE,
      y: (refinery.gridY + refinery.heightTiles) * TILE_SIZE + 18,
    };
  }

  private executeMoveCommand(unitIds: number[], targetX: number, targetY: number): void {
    const count = unitIds.length;
    const cols = Math.ceil(Math.sqrt(count));
    const spacing = 46;

    unitIds.forEach((id, index) => {
      const unit = this.units.get(id);
      if (!unit) return;

      const col = index % cols;
      const row = Math.floor(index / cols);
      const offsetX = (col - (cols - 1) / 2) * spacing;
      const offsetY = (row - (Math.ceil(count / cols) - 1) / 2) * spacing;

      unit.targetX = this.clampToWorld(targetX + offsetX, true);
      unit.targetY = this.clampToWorld(targetY + offsetY, false);

      // If player manually moves a Harvester to open ground, pause auto-harvest until arrival
      if (unit.type === 'HARVESTER') {
        unit.harvesterState = 'IDLE';
      }
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

    // Unit-to-Unit separation
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

    // Push units outside of solid building footprints
    const { TILE_SIZE } = GAME_CONFIG;
    for (const unit of unitList) {
      for (const b of this.buildings.values()) {
        const left = b.gridX * TILE_SIZE;
        const right = (b.gridX + b.widthTiles) * TILE_SIZE;
        const top = b.gridY * TILE_SIZE;
        const bottom = (b.gridY + b.heightTiles) * TILE_SIZE;

        const closestX = Math.max(left, Math.min(unit.x, right));
        const closestY = Math.max(top, Math.min(unit.y, bottom));
        const dx = unit.x - closestX;
        const dy = unit.y - closestY;
        const dist = Math.hypot(dx, dy);

        if (dist < unit.radius) {
          if (dist === 0) {
            unit.y = bottom + unit.radius + 2;
          } else {
            const push = unit.radius - dist + 1;
            unit.x += (dx / dist) * push;
            unit.y += (dy / dist) * push;
          }
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

import {
  ArmorType,
  BuildingEntity,
  BuildingType,
  CATALOG,
  DAMAGE_MATRIX,
  ExplosionEffect,
  GAME_CONFIG,
  GameCommand,
  CommandPayload,
  ProductionItem,
  ProjectileEntity,
  TiberiumPatch,
  UnitEntity,
  UnitType,
  VisibilityState,
  WarheadType,
} from './types';

export class GameEngine {
  public currentTick = 0;
  public credits = 5000;
  public units: Map<number, UnitEntity> = new Map();
  public buildings: Map<number, BuildingEntity> = new Map();
  public projectiles: Map<number, ProjectileEntity> = new Map();
  public explosions: ExplosionEffect[] = [];
  public tiberiumPatches: TiberiumPatch[] = [];
  public commandQueue: GameCommand[] = [];
  public lastCommandText = 'Deploy MCV [D] & scout East for Nod forces!';

  // Fog of War Matrix: [row][col] -> 0 (Shroud), 1 (Explored Fog), 2 (Visible)
  public fogGrid: VisibilityState[][] = [];
  public fogEnabled = true;

  public buildingQueue: ProductionItem | null = null;
  public unitQueue: ProductionItem | null = null;

  private nextEntityId = 1;

  constructor() {
    this.initFogGrid();
    this.seedInitialMap();
    this.updateFogOfWar();
  }

  private initFogGrid(): void {
    const { MAP_ROWS, MAP_COLS } = GAME_CONFIG;
    this.fogGrid = [];
    for (let r = 0; r < MAP_ROWS; r++) {
      const row: VisibilityState[] = new Array(MAP_COLS).fill(0);
      this.fogGrid.push(row);
    }
  }

  private seedInitialMap(): void {
    // 1. Spawn Player (GDI - Owner 1) Strike Force on the West
    this.spawnUnit('MCV', 336, 480, 1);
    this.spawnUnit('HARVESTER', 430, 540, 1);

    this.spawnUnit('MEDIUM_TANK', 510, 390, 1);
    this.spawnUnit('MEDIUM_TANK', 510, 450, 1);
    this.spawnUnit('MEDIUM_TANK', 510, 510, 1);

    this.spawnUnit('ROCKET_SOLDIER', 575, 410, 1);
    this.spawnUnit('ROCKET_SOLDIER', 575, 470, 1);

    this.spawnUnit('LIGHT_INFANTRY', 625, 395, 1);
    this.spawnUnit('LIGHT_INFANTRY', 625, 435, 1);
    this.spawnUnit('LIGHT_INFANTRY', 625, 475, 1);
    this.spawnUnit('LIGHT_INFANTRY', 625, 515, 1);

    // 2. Seed Tiberium Crystal Fields (Central Valley)
    const patchCenters = [
      { cx: 15, cy: 10 },
      { cx: 18, cy: 15 },
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

    // 3. Seed Hostile Brotherhood of Nod Outpost (Owner 2) in the East
    this.spawnBuilding('CONSTRUCTION_YARD', 28, 8, 2);
    this.spawnBuilding('POWER_PLANT', 32, 8, 2);
    this.spawnBuilding('BARRACKS', 28, 12, 2);
    this.spawnBuilding('REFINERY', 31, 12, 2);
    this.spawnBuilding('GUARD_TOWER', 25, 10, 2);
    this.spawnBuilding('GUARD_TOWER', 25, 14, 2);

    // Forward Nod Patrol Squads
    this.spawnUnit('LIGHT_INFANTRY', 1050, 440, 2);
    this.spawnUnit('LIGHT_INFANTRY', 1050, 480, 2);
    this.spawnUnit('ROCKET_SOLDIER', 1090, 460, 2);
    this.spawnUnit('MEDIUM_TANK', 1140, 460, 2);

    // Nod Base Garrison
    this.spawnUnit('MEDIUM_TANK', 1300, 560, 2);
    this.spawnUnit('MEDIUM_TANK', 1300, 630, 2);
    this.spawnUnit('ROCKET_SOLDIER', 1250, 520, 2);
    this.spawnUnit('LIGHT_INFANTRY', 1250, 580, 2);
  }

  public spawnUnit(type: UnitType, x: number, y: number, ownerId = 1): UnitEntity {
    const entry = CATALOG[type];
    const radiusMap: Record<UnitType, number> = {
      LIGHT_INFANTRY: 9,
      ROCKET_SOLDIER: 10,
      MEDIUM_TANK: 18,
      HARVESTER: 21,
      MCV: 24,
    };
    const speedMap: Record<UnitType, number> = {
      LIGHT_INFANTRY: 4.5,
      ROCKET_SOLDIER: 3.8,
      MEDIUM_TANK: 5.8,
      HARVESTER: 4.2,
      MCV: 3.2,
    };

    const unit: UnitEntity = {
      id: this.nextEntityId++,
      type,
      ownerId,
      x,
      y,
      prevX: x,
      prevY: y,
      radius: radiusMap[type],
      speed: speedMap[type],
      targetX: null,
      targetY: null,
      hullAngle: ownerId === 1 ? 0 : Math.PI,
      turretAngle: ownerId === 1 ? 0 : Math.PI,
      hp: entry.maxHp,
      maxHp: entry.maxHp,
      armor: entry.armor,
      sightRangeTiles: entry.sightRangeTiles,
      selected: false,
      harvesterState: type === 'HARVESTER' ? 'IDLE' : undefined,
      tiberiumLoad: 0,
      maxTiberiumLoad: 500,
      stateTimer: 0,
      targetRefineryId: null,
      weapon: entry.weapon ? { ...entry.weapon } : null,
      attackCooldown: 0,
      targetEntityId: null,
      isAttackMove: false,
      attackMoveDestX: null,
      attackMoveDestY: null,
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
      armor: entry.armor,
      sightRangeTiles: entry.sightRangeTiles,
      powerProduced: entry.powerProduced ?? 0,
      powerConsumed: entry.powerConsumed ?? 0,
      selected: false,
      weapon: entry.weapon ? { ...entry.weapon } : null,
      attackCooldown: 0,
      targetEntityId: null,
      turretAngle: ownerId === 1 ? 0 : Math.PI,
    };

    this.buildings.set(bldg.id, bldg);

    // Free Harvester only for Player 1 when placing a Refinery
    if (type === 'REFINERY' && ownerId === 1) {
      const dock = this.getRefineryDockWorldPos(bldg);
      this.spawnUnit('HARVESTER', dock.x, dock.y + 24, ownerId);
    }

    return bldg;
  }

  public getPowerStats(ownerId = 1): { produced: number; consumed: number; isLowPower: boolean } {
    let produced = 0;
    let consumed = 0;
    for (const b of this.buildings.values()) {
      if (b.ownerId !== ownerId) continue;
      produced += b.powerProduced;
      consumed += b.powerConsumed;
    }
    return {
      produced,
      consumed,
      isLowPower: consumed > produced,
    };
  }

  public hasPrerequisites(itemType: BuildingType | UnitType, ownerId = 1): boolean {
    const reqs = CATALOG[itemType].prerequisites;
    const ownedTypes = new Set(
      Array.from(this.buildings.values())
        .filter((b) => b.ownerId === ownerId)
        .map((b) => b.type)
    );
    return reqs.every((r) => ownedTypes.has(r));
  }

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

    let withinAdjacency = ignoreAdjacency;
    if (!ignoreAdjacency) {
      const centerGX = gridX + w / 2;
      const centerGY = gridY + h / 2;
      for (const b of this.buildings.values()) {
        if (b.ownerId !== 1) continue;
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

    for (const b of this.buildings.values()) {
      if (tx >= b.gridX && tx < b.gridX + b.widthTiles && ty >= b.gridY && ty < b.gridY + b.heightTiles) {
        return false;
      }
    }

    for (const p of this.tiberiumPatches) {
      if (p.gridX === tx && p.gridY === ty && p.amount > 0) {
        return false;
      }
    }

    const { TILE_SIZE } = GAME_CONFIG;
    const tileLeft = tx * TILE_SIZE;
    const tileRight = tileLeft + TILE_SIZE;
    const tileTop = ty * TILE_SIZE;
    const tileBottom = tileTop + TILE_SIZE;

    for (const u of this.units.values()) {
      if (u.id === ignoreUnitId) continue;
      if (
        u.x + u.radius > tileLeft &&
        u.x - u.radius < tileRight &&
        u.y + u.radius > tileTop &&
        u.y - u.radius < tileBottom
      ) {
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

    // 1. Snapshot previous positions for smooth 60+ FPS interpolation
    for (const unit of this.units.values()) {
      unit.prevX = unit.x;
      unit.prevY = unit.y;
    }
    for (const proj of this.projectiles.values()) {
      proj.prevX = proj.x;
      proj.prevY = proj.y;
    }

    // 2. Process scheduled commands
    this.processCommandsForTick(this.currentTick);

    // 3. Step Trickle-Drain Economy Queues
    this.updateProductionQueues();

    // 4. Step Automated Harvester State Machine
    this.updateHarvestersFSM();

    // 5. Step Combat Target Acquisition, Turrets & Firing
    this.updateCombatSystem();

    // 6. Step Ballistic Projectiles & Explosion Effects
    this.updateProjectilesAndExplosions();

    // 7. Step Unit Movement & Collision Separation
    this.updateUnitsMovement();

    // 8. Recompute Two-Layer Fog of War
    this.updateFogOfWar();
  }

  private processCommandsForTick(tick: number): void {
    const remaining: GameCommand[] = [];

    for (const cmd of this.commandQueue) {
      if (cmd.tick <= tick) {
        switch (cmd.type) {
          case 'MOVE':
            this.executeMoveCommand(cmd.unitIds, cmd.targetX, cmd.targetY, false);
            this.lastCommandText = `MOVE (${cmd.unitIds.length}) -> [${Math.round(cmd.targetX)}, ${Math.round(cmd.targetY)}]`;
            break;
          case 'ATTACK_MOVE':
            this.executeMoveCommand(cmd.unitIds, cmd.targetX, cmd.targetY, true);
            this.lastCommandText = `ATTACK-MOVE (${cmd.unitIds.length}) -> [${Math.round(cmd.targetX)}, ${Math.round(cmd.targetY)}]`;
            break;
          case 'ATTACK':
            this.executeAttackCommand(cmd.unitIds, cmd.targetEntityId);
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

  private executeAttackCommand(unitIds: number[], targetEntityId: number): void {
    const targetPos = this.getEntityWorldPos(targetEntityId);
    if (!targetPos) return;

    for (const id of unitIds) {
      const u = this.units.get(id);
      if (!u || !u.weapon) continue;
      u.targetEntityId = targetEntityId;
      u.isAttackMove = false;
      u.attackMoveDestX = null;
      u.attackMoveDestY = null;
    }
    this.lastCommandText = `Engaging hostile target #${targetEntityId}!`;
  }

  private executeDeployMcv(unitId: number): void {
    const mcv = this.units.get(unitId);
    if (!mcv || mcv.type !== 'MCV') return;

    const { TILE_SIZE } = GAME_CONFIG;
    const gridX = Math.round(mcv.x / TILE_SIZE) - 1;
    const gridY = Math.round(mcv.y / TILE_SIZE) - 1;

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
    if (!this.hasPrerequisites(itemType, 1)) {
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
      this.lastCommandText = 'Structure cancelled (Refunded)';
    } else if (category === 'UNIT' && this.unitQueue) {
      this.credits += Math.round(this.unitQueue.paidCost);
      this.unitQueue = null;
      this.lastCommandText = 'Unit cancelled (Refunded)';
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
    const { isLowPower } = this.getPowerStats(1);
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
    const isInfantry = uType === 'LIGHT_INFANTRY' || uType === 'ROCKET_SOLDIER';
    const producerType: BuildingType = isInfantry ? 'BARRACKS' : 'WAR_FACTORY';
    const producer = Array.from(this.buildings.values()).find(
      (b) => b.ownerId === 1 && b.type === producerType
    );

    const { TILE_SIZE } = GAME_CONFIG;
    let spawnX = 400;
    let spawnY = 400;

    if (producer) {
      spawnX = (producer.gridX + producer.widthTiles / 2) * TILE_SIZE;
      spawnY = (producer.gridY + producer.heightTiles) * TILE_SIZE + 26;
    }

    const unit = this.spawnUnit(uType, spawnX, spawnY, 1);
    unit.targetX = spawnX + ((this.currentTick % 3) - 1) * 28;
    unit.targetY = spawnY + 38;
    this.lastCommandText = `${CATALOG[uType].name} ready!`;
  }

  // ============================================================================
  // PHASE 3: COMBAT, TURRET ROTATION, PROJECTILES & ARMOR MATRIX
  // ============================================================================
  private updateCombatSystem(): void {
    // 1. Armed Units Combat Step
    for (const unit of this.units.values()) {
      if (!unit.weapon) continue;
      if (unit.attackCooldown > 0) unit.attackCooldown--;

      // Validate existing target
      if (unit.targetEntityId !== null) {
        const targetInfo = this.getEntityWorldPos(unit.targetEntityId);
        if (!targetInfo || targetInfo.ownerId === unit.ownerId) {
          unit.targetEntityId = null;
        }
      }

      // Auto-acquire nearest hostile if idle or on Attack-Move
      const isIdle = unit.targetX === null && unit.targetY === null;
      if (unit.targetEntityId === null && (isIdle || unit.isAttackMove)) {
        const nearestEnemyId = this.findNearestHostileInRange(
          unit.x,
          unit.y,
          unit.weapon.range + 25,
          unit.ownerId
        );
        if (nearestEnemyId !== null) {
          unit.targetEntityId = nearestEnemyId;
        }
      }

      // Engage active target
      if (unit.targetEntityId !== null) {
        const targetInfo = this.getEntityWorldPos(unit.targetEntityId);
        if (targetInfo) {
          const dx = targetInfo.x - unit.x;
          const dy = targetInfo.y - unit.y;
          const dist = Math.hypot(dx, dy);
          const effectiveRange = unit.weapon.range + targetInfo.radius;

          if (dist <= effectiveRange) {
            // In weapon range: halt movement, rotate turret toward target, and fire
            unit.targetX = null;
            unit.targetY = null;

            const desiredAngle = Math.atan2(dy, dx);
            unit.turretAngle = this.rotateAngleTowards(unit.turretAngle, desiredAngle, 0.35);

            if (Math.abs(this.angleDiff(unit.turretAngle, desiredAngle)) <= 0.25 && unit.attackCooldown <= 0) {
              this.spawnProjectile(
                unit.ownerId,
                unit.x,
                unit.y,
                targetInfo.x,
                targetInfo.y,
                unit.targetEntityId,
                unit.weapon
              );
              unit.attackCooldown = unit.weapon.cooldownTicks;
            }
          } else {
            // Out of weapon range: chase target
            unit.targetX = targetInfo.x;
            unit.targetY = targetInfo.y;
          }
        }
      } else if (unit.isAttackMove && unit.attackMoveDestX !== null && unit.attackMoveDestY !== null) {
        // Resume Attack-Move march after clearing target
        unit.targetX = unit.attackMoveDestX;
        unit.targetY = unit.attackMoveDestY;
      }
    }

    // 2. Defensive Structures (Guard Towers) Combat Step
    for (const bldg of this.buildings.values()) {
      if (!bldg.weapon) continue;

      const { isLowPower } = this.getPowerStats(bldg.ownerId);
      // Low power halves turret cooldown recovery speed
      if (bldg.attackCooldown > 0 && (!isLowPower || this.currentTick % 2 === 0)) {
        bldg.attackCooldown--;
      }

      const bCenter = this.getBuildingCenterWorldPos(bldg);

      if (bldg.targetEntityId !== null) {
        const tInfo = this.getEntityWorldPos(bldg.targetEntityId);
        if (
          !tInfo ||
          tInfo.ownerId === bldg.ownerId ||
          Math.hypot(tInfo.x - bCenter.x, tInfo.y - bCenter.y) > bldg.weapon.range + tInfo.radius
        ) {
          bldg.targetEntityId = null;
        }
      }

      if (bldg.targetEntityId === null) {
        bldg.targetEntityId = this.findNearestHostileInRange(
          bCenter.x,
          bCenter.y,
          bldg.weapon.range,
          bldg.ownerId
        );
      }

      if (bldg.targetEntityId !== null) {
        const tInfo = this.getEntityWorldPos(bldg.targetEntityId);
        if (tInfo) {
          const desiredAngle = Math.atan2(tInfo.y - bCenter.y, tInfo.x - bCenter.x);
          bldg.turretAngle = this.rotateAngleTowards(bldg.turretAngle, desiredAngle, 0.4);

          if (bldg.attackCooldown <= 0) {
            this.spawnProjectile(
              bldg.ownerId,
              bCenter.x,
              bCenter.y,
              tInfo.x,
              tInfo.y,
              bldg.targetEntityId,
              bldg.weapon
            );
            bldg.attackCooldown = bldg.weapon.cooldownTicks;
          }
        }
      }
    }
  }

  private spawnProjectile(
    ownerId: number,
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    targetEntityId: number | null,
    weapon: NonNullable<UnitEntity['weapon']>
  ): void {
    const proj: ProjectileEntity = {
      id: this.nextEntityId++,
      ownerId,
      style: weapon.projectileStyle,
      warhead: weapon.warhead,
      damage: weapon.damage,
      x: startX,
      y: startY,
      prevX: startX,
      prevY: startY,
      targetX,
      targetY,
      targetEntityId,
      speed: weapon.projectileSpeed,
    };
    this.projectiles.set(proj.id, proj);
  }

  private updateProjectilesAndExplosions(): void {
    for (const [id, proj] of this.projectiles.entries()) {
      // Homing update for guided rockets or tracking live target coordinates
      if (proj.targetEntityId !== null) {
        const liveTarget = this.getEntityWorldPos(proj.targetEntityId);
        if (liveTarget) {
          proj.targetX = liveTarget.x;
          proj.targetY = liveTarget.y;
        }
      }

      const dx = proj.targetX - proj.x;
      const dy = proj.targetY - proj.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= proj.speed) {
        // Impact!
        this.applyProjectileImpact(proj);
        this.projectiles.delete(id);
      } else {
        proj.x += (dx / dist) * proj.speed;
        proj.y += (dy / dist) * proj.speed;
      }
    }

    // Step visual explosion timers
    this.explosions = this.explosions.filter((exp) => {
      exp.currentTick++;
      return exp.currentTick < exp.totalTicks;
    });
  }

  private applyProjectileImpact(proj: ProjectileEntity): void {
    // Spawn impact explosion effect
    const blastRadius = proj.style === 'BULLET' ? 7 : proj.style === 'ROCKET' ? 18 : 22;
    const blastColor = proj.style === 'BULLET' ? 0xffee77 : 0xff7733;
    this.explosions.push({
      id: this.nextEntityId++,
      x: proj.targetX,
      y: proj.targetY,
      maxRadius: blastRadius,
      currentTick: 0,
      totalTicks: 6,
      color: blastColor,
    });

    if (proj.targetEntityId === null) return;

    const targetUnit = this.units.get(proj.targetEntityId);
    if (targetUnit) {
      const dmg = this.computeMitigatedDamage(proj.damage, proj.warhead, targetUnit.armor);
      targetUnit.hp -= dmg;
      if (targetUnit.hp <= 0) {
        this.units.delete(targetUnit.id);
        this.explosions.push({
          id: this.nextEntityId++,
          x: targetUnit.x,
          y: targetUnit.y,
          maxRadius: targetUnit.radius * 1.8,
          currentTick: 0,
          totalTicks: 10,
          color: 0xff4422,
        });
      }
      return;
    }

    const targetBldg = this.buildings.get(proj.targetEntityId);
    if (targetBldg) {
      const dmg = this.computeMitigatedDamage(proj.damage, proj.warhead, targetBldg.armor);
      targetBldg.hp -= dmg;
      if (targetBldg.hp <= 0) {
        const center = this.getBuildingCenterWorldPos(targetBldg);
        this.buildings.delete(targetBldg.id);
        this.explosions.push({
          id: this.nextEntityId++,
          x: center.x,
          y: center.y,
          maxRadius: 46,
          currentTick: 0,
          totalTicks: 12,
          color: 0xff3311,
        });
      }
    }
  }

  private computeMitigatedDamage(baseDamage: number, warhead: WarheadType, armor: ArmorType): number {
    const mult = DAMAGE_MATRIX[warhead][armor];
    return Math.max(1, Math.round(baseDamage * mult));
  }

  private findNearestHostileInRange(
    x: number,
    y: number,
    range: number,
    ownerId: number
  ): number | null {
    let bestId: number | null = null;
    let bestDist = range;

    for (const u of this.units.values()) {
      if (u.ownerId === ownerId) continue;
      // Player 1 units only auto-acquire enemies currently visible in Fog of War
      if (ownerId === 1 && !this.isWorldPosVisibleToPlayer(u.x, u.y)) continue;

      const d = Math.hypot(u.x - x, u.y - y) - u.radius;
      if (d <= bestDist) {
        bestDist = d;
        bestId = u.id;
      }
    }

    for (const b of this.buildings.values()) {
      if (b.ownerId === ownerId) continue;
      const center = this.getBuildingCenterWorldPos(b);
      if (ownerId === 1 && !this.isWorldPosVisibleToPlayer(center.x, center.y)) continue;

      const bRadius = (Math.max(b.widthTiles, b.heightTiles) * GAME_CONFIG.TILE_SIZE) / 2;
      const d = Math.hypot(center.x - x, center.y - y) - bRadius;
      if (d <= bestDist) {
        bestDist = d;
        bestId = b.id;
      }
    }

    return bestId;
  }

  public getEntityWorldPos(
    entityId: number
  ): { x: number; y: number; radius: number; ownerId: number } | null {
    const u = this.units.get(entityId);
    if (u) {
      return { x: u.x, y: u.y, radius: u.radius, ownerId: u.ownerId };
    }
    const b = this.buildings.get(entityId);
    if (b) {
      const center = this.getBuildingCenterWorldPos(b);
      const radius = (Math.min(b.widthTiles, b.heightTiles) * GAME_CONFIG.TILE_SIZE) / 2;
      return { x: center.x, y: center.y, radius, ownerId: b.ownerId };
    }
    return null;
  }

  public getBuildingCenterWorldPos(b: BuildingEntity): { x: number; y: number } {
    const { TILE_SIZE } = GAME_CONFIG;
    return {
      x: (b.gridX + b.widthTiles / 2) * TILE_SIZE,
      y: (b.gridY + b.heightTiles / 2) * TILE_SIZE,
    };
  }

  private rotateAngleTowards(current: number, target: number, maxStep: number): number {
    const diff = this.angleDiff(current, target);
    if (Math.abs(diff) <= maxStep) return target;
    return current + Math.sign(diff) * maxStep;
  }

  private angleDiff(a: number, b: number): number {
    let diff = b - a;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    return diff;
  }

  // ============================================================================
  // PHASE 3: TWO-LAYER FOG OF WAR (SHROUD & EXPLORED FOG)
  // ============================================================================
  public updateFogOfWar(): void {
    const { MAP_ROWS, MAP_COLS, TILE_SIZE } = GAME_CONFIG;

    // 1. Downgrade currently VISIBLE (2) tiles to EXPLORED FOG (1)
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (this.fogGrid[r][c] === 2) {
          this.fogGrid[r][c] = 1;
        }
      }
    }

    // 2. Reveal tiles within sightRangeTiles of all Player 1 units & buildings
    for (const u of this.units.values()) {
      if (u.ownerId !== 1) continue;
      const gx = Math.floor(u.x / TILE_SIZE);
      const gy = Math.floor(u.y / TILE_SIZE);
      this.revealCircleOnFogGrid(gx, gy, u.sightRangeTiles);
    }

    for (const b of this.buildings.values()) {
      if (b.ownerId !== 1) continue;
      const gx = Math.floor(b.gridX + b.widthTiles / 2);
      const gy = Math.floor(b.gridY + b.heightTiles / 2);
      this.revealCircleOnFogGrid(gx, gy, b.sightRangeTiles);
    }
  }

  private revealCircleOnFogGrid(centerGX: number, centerGY: number, radiusTiles: number): void {
    const { MAP_ROWS, MAP_COLS } = GAME_CONFIG;
    const rSq = radiusTiles * radiusTiles;

    for (let dy = -radiusTiles; dy <= radiusTiles; dy++) {
      for (let dx = -radiusTiles; dx <= radiusTiles; dx++) {
        if (dx * dx + dy * dy <= rSq) {
          const tx = centerGX + dx;
          const ty = centerGY + dy;
          if (tx >= 0 && tx < MAP_COLS && ty >= 0 && ty < MAP_ROWS) {
            this.fogGrid[ty][tx] = 2;
          }
        }
      }
    }
  }

  public isWorldPosVisibleToPlayer(x: number, y: number): boolean {
    if (!this.fogEnabled) return true;
    const { TILE_SIZE, MAP_COLS, MAP_ROWS } = GAME_CONFIG;
    const gx = Math.max(0, Math.min(MAP_COLS - 1, Math.floor(x / TILE_SIZE)));
    const gy = Math.max(0, Math.min(MAP_ROWS - 1, Math.floor(y / TILE_SIZE)));
    return this.fogGrid[gy][gx] === 2;
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
            const refinery = this.findNearestRefinery(unit.x, unit.y, unit.ownerId);
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
              const refinery = this.findNearestRefinery(unit.x, unit.y, unit.ownerId);
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
            unit.stateTimer = 10;
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
            unit.stateTimer = 16;
          }
          break;
        }

        case 'UNLOADING': {
          unit.stateTimer--;
          if (unit.stateTimer <= 0) {
            if (unit.ownerId === 1) {
              this.credits += unit.tiberiumLoad;
              this.lastCommandText = `Harvester unloaded +$${unit.tiberiumLoad} credits`;
            }
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

  private findNearestRefinery(x: number, y: number, ownerId: number): BuildingEntity | null {
    let best: BuildingEntity | null = null;
    let bestDist = Infinity;

    for (const b of this.buildings.values()) {
      if (b.type !== 'REFINERY' || b.ownerId !== ownerId) continue;
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

  private executeMoveCommand(
    unitIds: number[],
    targetX: number,
    targetY: number,
    isAttackMove: boolean
  ): void {
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

      const destX = this.clampToWorld(targetX + offsetX, true);
      const destY = this.clampToWorld(targetY + offsetY, false);

      unit.targetX = destX;
      unit.targetY = destY;
      unit.targetEntityId = null;
      unit.isAttackMove = isAttackMove;
      unit.attackMoveDestX = isAttackMove ? destX : null;
      unit.attackMoveDestY = isAttackMove ? destY : null;

      if (unit.type === 'HARVESTER') {
        unit.harvesterState = 'IDLE';
      }
    });
  }

  private updateUnitsMovement(): void {
    const unitList = Array.from(this.units.values());
    const { TILE_SIZE } = GAME_CONFIG;

    // 1. Calculate intended movement with Context Ray-Probing Obstacle Avoidance
    for (const unit of unitList) {
      if (unit.targetX === null || unit.targetY === null) continue;

      const toTargetX = unit.targetX - unit.x;
      const toTargetY = unit.targetY - unit.y;
      const distToTarget = Math.hypot(toTargetX, toTargetY);

      if (distToTarget <= unit.speed) {
        unit.x = unit.targetX;
        unit.y = unit.targetY;
        unit.targetX = null;
        unit.targetY = null;
        if (unit.isAttackMove) {
          unit.isAttackMove = false;
          unit.attackMoveDestX = null;
          unit.attackMoveDestY = null;
        }
        continue;
      }

      // Check if target position is blocked by a stationary unit
      let destinationBlocked = false;
      for (const other of unitList) {
        if (other.id === unit.id) continue;
        const otherIsStationary = other.targetX === null && other.targetY === null;
        if (!otherIsStationary) continue;

        const targetDistToOther = Math.hypot(other.x - unit.targetX, other.y - unit.targetY);
        const distToOther = Math.hypot(other.x - unit.x, other.y - unit.y);

        // If destination is within other unit's radius and we are touching distance:
        if (targetDistToOther <= other.radius + 6 && distToOther <= unit.radius + other.radius + 8) {
          unit.targetX = null;
          unit.targetY = null;
          if (unit.isAttackMove) {
            unit.isAttackMove = false;
            unit.attackMoveDestX = null;
            unit.attackMoveDestY = null;
          }
          destinationBlocked = true;
          break;
        }
      }
      if (destinationBlocked) continue;

      const targetAngle = Math.atan2(toTargetY, toTargetX);
      const probeDist = unit.radius + unit.speed * 5 + 16;

      // Gather nearby stationary obstacles to detect impassable pinch gaps (e.g. 2 minigunners)
      const nearbyStationary: UnitEntity[] = [];
      for (const other of unitList) {
        if (other.id === unit.id) continue;
        if (other.targetX === null && other.targetY === null) {
          const d = Math.hypot(other.x - unit.x, other.y - unit.y);
          if (d <= probeDist + other.radius + 16) {
            nearbyStationary.push(other);
          }
        }
      }

      // Impassable barriers between two stationary units that are too close for this unit to fit through
      const minPassableGap = unit.radius * 2 + 4;
      interface BarrierSegment {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
      }
      const barriers: BarrierSegment[] = [];
      for (let i = 0; i < nearbyStationary.length; i++) {
        for (let j = i + 1; j < nearbyStationary.length; j++) {
          const s1 = nearbyStationary[i];
          const s2 = nearbyStationary[j];
          const d12 = Math.hypot(s2.x - s1.x, s2.y - s1.y);
          const gap = d12 - (s1.radius + s2.radius);
          if (gap < minPassableGap) {
            barriers.push({ x1: s1.x, y1: s1.y, x2: s2.x, y2: s2.y });
          }
        }
      }

      const ccw = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
        (cy - ay) * (bx - ax) > (by - ay) * (cx - ax);
      const lineIntersects = (
        p1x: number, p1y: number, p2x: number, p2y: number,
        q1x: number, q1y: number, q2x: number, q2y: number
      ) =>
        ccw(p1x, p1y, q1x, q1y, q2x, q2y) !== ccw(p2x, p2y, q1x, q1y, q2x, q2y) &&
        ccw(p1x, p1y, p2x, p2y, q1x, q1y) !== ccw(p1x, p1y, p2x, p2y, q2x, q2y);

      // Candidate angle offsets relative to target heading
      const candidateOffsets = [
        0,
        0.35, -0.35,
        0.7, -0.7,
        1.1, -1.1,
        1.55, -1.55,
        2.0, -2.0,
        2.5, -2.5,
        Math.PI,
      ];

      let bestAngle = targetAngle;
      let bestScore = -Infinity;

      for (const offset of candidateOffsets) {
        const testAngle = targetAngle + offset;
        const rx = Math.cos(testAngle);
        const ry = Math.sin(testAngle);

        // Desirability: prefer angles aligned with the target
        let score = Math.cos(offset) * 2.0;
        let maxDanger = 0;

        const rayEndX = unit.x + rx * probeDist;
        const rayEndY = unit.y + ry * probeDist;

        // Check if ray tries to penetrate an impassable narrow gap between two stationary units
        for (const b of barriers) {
          if (lineIntersects(unit.x, unit.y, rayEndX, rayEndY, b.x1, b.y1, b.x2, b.y2)) {
            maxDanger = Math.max(maxDanger, 4.0);
            break;
          }
        }

        // Danger from other units (especially stationary units)
        for (const other of unitList) {
          if (other.id === unit.id) continue;

          const dx = other.x - unit.x;
          const dy = other.y - unit.y;
          const distToOther = Math.hypot(dx, dy);
          const combinedRadius = unit.radius + other.radius + 4;

          if (distToOther > probeDist + other.radius || distToOther < 0.001) continue;

          const proj = dx * rx + dy * ry;
          if (proj < -unit.radius * 0.4) continue; // Behind test ray

          const perp = Math.abs(dx * (-ry) + dy * rx);
          if (perp < combinedRadius && proj < probeDist) {
            const otherIsStationary = other.targetX === null && other.targetY === null;
            const weight = otherIsStationary ? 2.8 : 1.2;
            const closeness = 1 - Math.max(0, proj) / probeDist;
            const lateral = 1 - perp / combinedRadius;
            const danger = closeness * lateral * weight;
            if (danger > maxDanger) maxDanger = danger;
          }
        }

        // Danger from buildings
        for (const b of this.buildings.values()) {
          // If this harvester is docking/unloading at this refinery, do not treat it as an obstacle!
          if (
            (unit.harvesterState === 'MOVING_TO_REFINERY' || unit.harvesterState === 'UNLOADING') &&
            b.id === unit.targetRefineryId
          ) {
            continue;
          }

          const left = b.gridX * TILE_SIZE - unit.radius - 2;
          const right = (b.gridX + b.widthTiles) * TILE_SIZE + unit.radius + 2;
          const top = b.gridY * TILE_SIZE - unit.radius - 2;
          const bottom = (b.gridY + b.heightTiles) * TILE_SIZE + unit.radius + 2;

          for (let step = unit.speed; step <= probeDist; step += unit.speed * 1.5) {
            const sx = unit.x + rx * step;
            const sy = unit.y + ry * step;
            if (sx >= left && sx <= right && sy >= top && sy <= bottom) {
              const danger = (1 - step / probeDist) * 3.0;
              if (danger > maxDanger) maxDanger = danger;
              break;
            }
          }
        }

        // Danger from world edge
        const testEndX = unit.x + rx * probeDist;
        const testEndY = unit.y + ry * probeDist;
        if (
          testEndX < 24 || testEndX > GAME_CONFIG.MAP_COLS * TILE_SIZE - 24 ||
          testEndY < 24 || testEndY > GAME_CONFIG.MAP_ROWS * TILE_SIZE - 24
        ) {
          maxDanger = Math.max(maxDanger, 2.5);
        }

        score -= maxDanger * 3.5;

        if (score > bestScore) {
          bestScore = score;
          bestAngle = testAngle;
        }
      }

      const stepX = Math.cos(bestAngle) * unit.speed;
      const stepY = Math.sin(bestAngle) * unit.speed;

      unit.x = this.clampToWorld(unit.x + stepX, true);
      unit.y = this.clampToWorld(unit.y + stepY, false);
      unit.hullAngle = bestAngle;
      if (unit.targetEntityId === null) {
        unit.turretAngle = unit.hullAngle;
      }

      // Track anti-stall progress
      const movedDist = Math.hypot(unit.x - unit.prevX, unit.y - unit.prevY);
      if (movedDist < 0.35) {
        unit.stuckTicks = (unit.stuckTicks || 0) + 1;
      } else {
        unit.stuckTicks = 0;
      }

      // If unit is wedged/stuck for > 12 ticks (~0.6s), pop out of pinch
      if (unit.stuckTicks > 12) {
        unit.stuckTicks = 0;
        let repelX = 0;
        let repelY = 0;
        for (const s of nearbyStationary) {
          const d = Math.hypot(unit.x - s.x, unit.y - s.y);
          if (d > 0 && d < unit.radius + s.radius + 8) {
            repelX += (unit.x - s.x) / d;
            repelY += (unit.y - s.y) / d;
          }
        }
        const repelMag = Math.hypot(repelX, repelY);
        if (repelMag > 0.01) {
          unit.x = this.clampToWorld(unit.x + (repelX / repelMag) * 10, true);
          unit.y = this.clampToWorld(unit.y + (repelY / repelMag) * 10, false);
        } else {
          unit.x = this.clampToWorld(unit.x + (unit.id % 2 === 0 ? 10 : -10), true);
        }

        if (unit.type === 'HARVESTER' && unit.harvesterState === 'MOVING_TO_TIBERIUM') {
          unit.targetX = null;
          unit.targetY = null;
          unit.harvesterState = 'IDLE';
        }
      }
    }

    // 2. Unit-to-Unit separation: STRICTLY protect stationary units from being displaced
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < unitList.length; i++) {
        for (let j = i + 1; j < unitList.length; j++) {
          const a = unitList[i];
          const b = unitList[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          const minDist = a.radius + b.radius + 3;

          if (dist > 0 && dist < minDist) {
            const overlap = (minDist - dist) * 0.5;
            const nx = dx / dist;
            const ny = dy / dist;

            const aMoving = a.targetX !== null && a.targetY !== null;
            const bMoving = b.targetX !== null && b.targetY !== null;

            if (aMoving && !bMoving) {
              // Stationary unit B remains completely fixed! Only moving unit A is pushed away.
              a.x = this.clampToWorld(a.x - nx * overlap * 2.0, true);
              a.y = this.clampToWorld(a.y - ny * overlap * 2.0, false);
            } else if (!aMoving && bMoving) {
              // Stationary unit A remains completely fixed! Only moving unit B is pushed away.
              b.x = this.clampToWorld(b.x + nx * overlap * 2.0, true);
              b.y = this.clampToWorld(b.y + ny * overlap * 2.0, false);
            } else if (aMoving && bMoving) {
              // Both units are moving: distribute displacement equally
              a.x = this.clampToWorld(a.x - nx * overlap, true);
              a.y = this.clampToWorld(a.y - ny * overlap, false);
              b.x = this.clampToWorld(b.x + nx * overlap, true);
              b.y = this.clampToWorld(b.y + ny * overlap, false);
            } else {
              // Both are stationary: only separate if heavily overlapping
              if (overlap > 1.5) {
                a.x = this.clampToWorld(a.x - nx * overlap * 0.5, true);
                a.y = this.clampToWorld(a.y - ny * overlap * 0.5, false);
                b.x = this.clampToWorld(b.x + nx * overlap * 0.5, true);
                b.y = this.clampToWorld(b.y + ny * overlap * 0.5, false);
              }
            }
          }
        }
      }
    }

    // 3. Push units outside of solid building footprints (skip docking Harvester at target refinery)
    for (const unit of unitList) {
      for (const b of this.buildings.values()) {
        if (
          (unit.harvesterState === 'MOVING_TO_REFINERY' || unit.harvesterState === 'UNLOADING') &&
          b.id === unit.targetRefineryId
        ) {
          continue;
        }

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
            unit.y = this.clampToWorld(bottom + unit.radius + 2, false);
          } else {
            const push = unit.radius - dist + 1;
            unit.x = this.clampToWorld(unit.x + (dx / dist) * push, true);
            unit.y = this.clampToWorld(unit.y + (dy / dist) * push, false);
          }

          // If unit's destination was inside or directly at this building wall, clear target
          if (unit.targetX !== null && unit.targetY !== null) {
            if (
              unit.targetX >= left - 6 &&
              unit.targetX <= right + 6 &&
              unit.targetY >= top - 6 &&
              unit.targetY <= bottom + 6
            ) {
              unit.targetX = null;
              unit.targetY = null;
            }
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
import { Application, Container, Graphics, Sprite } from 'pixi.js';
import { AudioSystem } from './AudioSystem';
import { GameEngine } from './GameEngine';
import { SpriteFactory } from './SpriteFactory';
import { VfxSystem } from './VfxSystem';
import {
  BuildingType,
  CATALOG,
  GAME_CONFIG,
  UnitEntity,
  UnitType,
} from './types';

interface UnitRig {
  container: Container;
  hull: Sprite;
  turret: Sprite | null;
}

interface BuildingRig {
  container: Container;
  base: Sprite;
  addon: Sprite | null;
}

async function bootstrap() {
  const viewport = document.getElementById('viewport')!;
  const app = new Application();

  await app.init({
    resizeTo: viewport,
    backgroundColor: 0x0b0e0b,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  viewport.appendChild(app.canvas);
  app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const sprites = new SpriteFactory();
  await sprites.init();

  const engine = new GameEngine();
  const audio = new AudioSystem();
  const vfx = new VfxSystem(sprites);

  // Scene Graph Hierarchy
  const worldContainer = new Container();
  const terrainContainer = new Container();
  const crystalContainer = new Container();
  const buildingSpriteLayer = new Container();
  const unitSpriteLayer = new Container();
  const tacticalHudGraphics = new Graphics(); // Selection brackets, health bars, lasers
  const projectileGraphics = new Graphics();
  const placementGraphics = new Graphics();
  const uiOverlayGraphics = new Graphics();

  worldContainer.addChild(terrainContainer);
  worldContainer.addChild(vfx.decalContainer);
  worldContainer.addChild(crystalContainer);
  worldContainer.addChild(buildingSpriteLayer);
  worldContainer.addChild(unitSpriteLayer);
  worldContainer.addChild(vfx.smokeContainer);
  worldContainer.addChild(tacticalHudGraphics);
  worldContainer.addChild(projectileGraphics);
  worldContainer.addChild(vfx.fogSprite);
  worldContainer.addChild(placementGraphics);
  app.stage.addChild(worldContainer);
  app.stage.addChild(uiOverlayGraphics);

  // Persistent Sprite Rigs
  const unitRigs: Map<number, UnitRig> = new Map();
  const buildingRigs: Map<number, BuildingRig> = new Map();
  const crystalSprites: Map<string, Sprite> = new Map();

  // Build Textured Terrain Tile Map
  function buildTerrainTileSprites(): void {
    const { MAP_COLS, MAP_ROWS, TILE_SIZE } = GAME_CONFIG;
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        const variantIdx = (c * 17 + r * 31) % sprites.terrainTiles.length;
        const tileSprite = new Sprite(sprites.terrainTiles[variantIdx]);
        tileSprite.x = c * TILE_SIZE;
        tileSprite.y = r * TILE_SIZE;
        terrainContainer.addChild(tileSprite);
      }
    }
  }
  buildTerrainTileSprites();

  // Camera & Interaction State
  const camera = {
    x: 40,
    y: 40,
    zoom: 1,
    panSpeed: 10,
    isMiddleDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
  };

  const mouseScreen = { x: 0, y: 0 };
  let isPlacementMode = false;
  let isAttackMoveMode = false;

  const selectionBox = {
    active: false,
    startX: 0,
    startY: 0,
    currX: 0,
    currY: 0,
  };

  let orderMarker: { x: number; y: number; alpha: number; color: number } | null = null;
  const controlGroups: Map<string, number[]> = new Map();
  const keysPressed: Set<string> = new Set();

  function screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - camera.x) / camera.zoom,
      y: (screenY - camera.y) / camera.zoom,
    };
  }

  // ============================================================================
  // INTERACTIVE RADAR MINIMAP
  // ============================================================================
  const radarCanvas = document.getElementById('radar-canvas') as HTMLCanvasElement;
  const radarCtx = radarCanvas.getContext('2d')!;
  const radarStatusTag = document.getElementById('radar-status-tag')!;
  let isDraggingRadar = false;

  radarCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function jumpCameraToRadarPoint(clientX: number, clientY: number): void {
    const rect = radarCanvas.getBoundingClientRect();
    const rx = (clientX - rect.left) / rect.width;
    const ry = (clientY - rect.top) / rect.height;
    const worldW = GAME_CONFIG.MAP_COLS * GAME_CONFIG.TILE_SIZE;
    const worldH = GAME_CONFIG.MAP_ROWS * GAME_CONFIG.TILE_SIZE;

    camera.x = app.screen.width / 2 - rx * worldW * camera.zoom;
    camera.y = app.screen.height / 2 - ry * worldH * camera.zoom;
  }

  radarCanvas.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button === 0) {
      isDraggingRadar = true;
      jumpCameraToRadarPoint(e.clientX, e.clientY);
    } else if (e.button === 2) {
      const rect = radarCanvas.getBoundingClientRect();
      const wx = ((e.clientX - rect.left) / rect.width) * GAME_CONFIG.MAP_COLS * GAME_CONFIG.TILE_SIZE;
      const wy = ((e.clientY - rect.top) / rect.height) * GAME_CONFIG.MAP_ROWS * GAME_CONFIG.TILE_SIZE;

      const selectedIds = Array.from(engine.units.values())
        .filter((u) => u.ownerId === 1 && u.selected)
        .map((u) => u.id);

      if (selectedIds.length > 0) {
        engine.issueCommand({
          type: isAttackMoveMode ? 'ATTACK_MOVE' : 'MOVE',
          unitIds: selectedIds,
          targetX: wx,
          targetY: wy,
        });
        orderMarker = { x: wx, y: wy, alpha: 1.0, color: isAttackMoveMode ? 0xff4444 : 0x55ff77 };
        isAttackMoveMode = false;
      }
    }
  });

  window.addEventListener('pointermove', (e: PointerEvent) => {
    if (isDraggingRadar) jumpCameraToRadarPoint(e.clientX, e.clientY);
  });

  window.addEventListener('pointerup', () => {
    isDraggingRadar = false;
  });

  function renderRadarMinimap(): void {
    const cw = radarCanvas.width;
    const ch = radarCanvas.height;
    const { MAP_COLS, MAP_ROWS, TILE_SIZE } = GAME_CONFIG;
    const tileW = cw / MAP_COLS;
    const tileH = ch / MAP_ROWS;
    const hasRadarSweep = engine.hasActiveRadar(1);

    radarStatusTag.textContent = hasRadarSweep ? 'DOME SWEEP ACTIVE' : 'LOCAL SENSORS';
    radarStatusTag.style.color = hasRadarSweep ? '#55ff77' : '#ffdd44';

    radarCtx.fillStyle = '#121812';
    radarCtx.fillRect(0, 0, cw, ch);

    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        const vis = engine.fogEnabled ? engine.fogGrid[r][c] : 2;
        radarCtx.fillStyle =
          vis === 0 && !hasRadarSweep ? '#040604' : vis === 1 ? '#141a13' : '#222b1f';
        radarCtx.fillRect(c * tileW, r * tileH, tileW + 0.5, tileH + 0.5);
      }
    }

    radarCtx.fillStyle = '#2ee65f';
    for (const p of engine.tiberiumPatches) {
      if (p.amount <= 0) continue;
      if (engine.fogEnabled && engine.fogGrid[p.gridY][p.gridX] === 0 && !hasRadarSweep) continue;
      radarCtx.fillRect(p.gridX * tileW, p.gridY * tileH, tileW, tileH);
    }

    for (const b of engine.buildings.values()) {
      if (b.ownerId !== 1 && engine.fogEnabled && engine.fogGrid[b.gridY][b.gridX] === 0 && !hasRadarSweep) {
        continue;
      }
      radarCtx.fillStyle = b.ownerId === 1 ? '#e6c34a' : '#ff3b3b';
      radarCtx.fillRect(b.gridX * tileW, b.gridY * tileH, b.widthTiles * tileW, b.heightTiles * tileH);
    }

    const worldW = MAP_COLS * TILE_SIZE;
    const worldH = MAP_ROWS * TILE_SIZE;
    for (const u of engine.units.values()) {
      if (u.ownerId !== 1 && !engine.isWorldPosVisibleToPlayer(u.x, u.y) && !hasRadarSweep) continue;
      radarCtx.fillStyle = u.ownerId === 1 ? '#55ff77' : '#ff4444';
      radarCtx.fillRect((u.x / worldW) * cw - 1.5, (u.y / worldH) * ch - 1.5, 3, 3);
    }

    radarCtx.strokeStyle = '#ffffff';
    radarCtx.lineWidth = 1.2;
    radarCtx.strokeRect(
      (-camera.x / camera.zoom / worldW) * cw,
      (-camera.y / camera.zoom / worldH) * ch,
      (app.screen.width / camera.zoom / worldW) * cw,
      (app.screen.height / camera.zoom / worldH) * ch
    );
  }

  // ============================================================================
  // SIDEBAR UI & INPUT HANDLERS
  // ============================================================================
  const structureTypes: BuildingType[] = [
    'POWER_PLANT',
    'REFINERY',
    'BARRACKS',
    'GUARD_TOWER',
    'WAR_FACTORY',
    'RADAR_DOME',
  ];
  const unitTypes: UnitType[] = [
    'LIGHT_INFANTRY',
    'ROCKET_SOLDIER',
    'MEDIUM_TANK',
    'HARVESTER',
    'MCV',
  ];

  const gridStructuresEl = document.getElementById('grid-structures')!;
  const gridUnitsEl = document.getElementById('grid-units')!;
  const btnDeployMcv = document.getElementById('btn-deploy-mcv') as HTMLButtonElement;
  const btnAttackMove = document.getElementById('btn-attack-move') as HTMLButtonElement;
  const btnToggleFog = document.getElementById('btn-toggle-fog') as HTMLButtonElement;
  const btnToggleAudio = document.getElementById('btn-toggle-audio') as HTMLButtonElement;
  const btnCancelBldg = document.getElementById('btn-cancel-bldg') as HTMLButtonElement;
  const btnCancelUnit = document.getElementById('btn-cancel-unit') as HTMLButtonElement;
  const modeBanner = document.getElementById('mode-banner')!;
  const matchOverlay = document.getElementById('match-overlay')!;
  const matchTitle = document.getElementById('match-title')!;
  const matchSubtitle = document.getElementById('match-subtitle')!;
  const btnRestart = document.getElementById('btn-restart') as HTMLButtonElement;

  const cardElements: Map<BuildingType | UnitType, HTMLDivElement> = new Map();

  for (const bKey of structureTypes) {
    const entry = CATALOG[bKey];
    const card = document.createElement('div');
    card.className = 'build-card';
    card.innerHTML = `<div class="build-title">${entry.name}</div><div class="build-cost">$${entry.cost}</div><div class="build-req" id="req-${bKey}"></div>`;
    card.addEventListener('click', () => {
      if (engine.buildingQueue?.readyToPlace && engine.buildingQueue.itemType === bKey) {
        isPlacementMode = true;
        isAttackMoveMode = false;
        return;
      }
      engine.issueCommand({ type: 'START_PRODUCTION', itemType: bKey });
    });
    gridStructuresEl.appendChild(card);
    cardElements.set(bKey, card);
  }

  for (const uKey of unitTypes) {
    const entry = CATALOG[uKey];
    const card = document.createElement('div');
    card.className = 'build-card';
    card.innerHTML = `<div class="build-title">${entry.name}</div><div class="build-cost">$${entry.cost}</div><div class="build-req" id="req-${uKey}"></div>`;
    card.addEventListener('click', () => {
      engine.issueCommand({ type: 'START_PRODUCTION', itemType: uKey });
    });
    gridUnitsEl.appendChild(card);
    cardElements.set(uKey, card);
  }

  btnDeployMcv.addEventListener('click', () => {
    const selectedMcv = Array.from(engine.units.values()).find(
      (u) => u.ownerId === 1 && u.selected && u.type === 'MCV'
    );
    if (selectedMcv) engine.issueCommand({ type: 'DEPLOY_MCV', unitId: selectedMcv.id });
  });

  btnAttackMove.addEventListener('click', () => {
    isAttackMoveMode = !isAttackMoveMode;
    if (isAttackMoveMode) isPlacementMode = false;
  });

  btnToggleFog.addEventListener('click', () => {
    engine.fogEnabled = !engine.fogEnabled;
    btnToggleFog.textContent = `FOG: ${engine.fogEnabled ? 'ON' : 'OFF'} [F]`;
  });

  btnToggleAudio.addEventListener('click', () => {
    audio.enabled = !audio.enabled;
    btnToggleAudio.textContent = `AUDIO: ${audio.enabled ? 'ON' : 'OFF'} [M]`;
  });

  btnCancelBldg.addEventListener('click', () => {
    isPlacementMode = false;
    engine.issueCommand({ type: 'CANCEL_PRODUCTION', category: 'BUILDING' });
  });

  btnCancelUnit.addEventListener('click', () => {
    engine.issueCommand({ type: 'CANCEL_PRODUCTION', category: 'UNIT' });
  });

  btnRestart.addEventListener('click', () => {
    vfx.clearDecals();
    engine.resetMatch();
    camera.x = 40;
    camera.y = 40;
    matchOverlay.style.display = 'none';
  });

  function findHostileAtWorldPos(wx: number, wy: number): number | null {
    for (const u of engine.units.values()) {
      if (u.ownerId === 1 || !engine.isWorldPosVisibleToPlayer(u.x, u.y)) continue;
      if (Math.hypot(u.x - wx, u.y - wy) <= u.radius + 8) return u.id;
    }
    const { TILE_SIZE } = GAME_CONFIG;
    for (const b of engine.buildings.values()) {
      if (b.ownerId === 1) continue;
      const left = b.gridX * TILE_SIZE;
      const right = (b.gridX + b.widthTiles) * TILE_SIZE;
      const top = b.gridY * TILE_SIZE;
      const bottom = (b.gridY + b.heightTiles) * TILE_SIZE;
      if (wx >= left && wx <= right && wy >= top && wy <= bottom) return b.id;
    }
    return null;
  }

  app.canvas.addEventListener('dblclick', (e: MouseEvent) => {
    const rect = app.canvas.getBoundingClientRect();
    const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    for (const u of engine.units.values()) {
      if (u.ownerId === 1 && u.type === 'MCV' && Math.hypot(u.x - worldPos.x, u.y - worldPos.y) <= u.radius + 8) {
        engine.issueCommand({ type: 'DEPLOY_MCV', unitId: u.id });
        break;
      }
    }
  });

  app.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    const rect = app.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const worldPos = screenToWorld(sx, sy);

    if (e.button === 0) {
      if (isPlacementMode && engine.buildingQueue?.readyToPlace) {
        const bType = engine.buildingQueue.itemType as BuildingType;
        const entry = CATALOG[bType];
        const w = entry.widthTiles ?? 2;
        const h = entry.heightTiles ?? 2;
        const gx = Math.floor(worldPos.x / GAME_CONFIG.TILE_SIZE - w / 2 + 0.5);
        const gy = Math.floor(worldPos.y / GAME_CONFIG.TILE_SIZE - h / 2 + 0.5);
        if (engine.validateBuildingPlacement(bType, gx, gy).valid) {
          engine.issueCommand({ type: 'PLACE_BUILDING', gridX: gx, gridY: gy });
          isPlacementMode = false;
        }
        return;
      }

      if (isAttackMoveMode) {
        const selectedIds = Array.from(engine.units.values())
          .filter((u) => u.ownerId === 1 && u.selected)
          .map((u) => u.id);
        if (selectedIds.length > 0) {
          engine.issueCommand({ type: 'ATTACK_MOVE', unitIds: selectedIds, targetX: worldPos.x, targetY: worldPos.y });
          orderMarker = { x: worldPos.x, y: worldPos.y, alpha: 1.0, color: 0xff4444 };
        }
        isAttackMoveMode = false;
        return;
      }

      selectionBox.active = true;
      selectionBox.startX = sx;
      selectionBox.startY = sy;
      selectionBox.currX = sx;
      selectionBox.currY = sy;
    } else if (e.button === 1) {
      camera.isMiddleDragging = true;
      camera.lastMouseX = sx;
      camera.lastMouseY = sy;
    } else if (e.button === 2) {
      if (isPlacementMode || isAttackMoveMode) {
        isPlacementMode = false;
        isAttackMoveMode = false;
        return;
      }

      const selectedUnits = Array.from(engine.units.values()).filter((u) => u.ownerId === 1 && u.selected);
      if (selectedUnits.length === 0) return;

      const hostileId = findHostileAtWorldPos(worldPos.x, worldPos.y);
      if (hostileId !== null) {
        engine.issueCommand({ type: 'ATTACK', unitIds: selectedUnits.map((u) => u.id), targetEntityId: hostileId });
        orderMarker = { x: worldPos.x, y: worldPos.y, alpha: 1.0, color: 0xff3333 };
        return;
      }

      const { TILE_SIZE } = GAME_CONFIG;
      const clickedGX = Math.floor(worldPos.x / TILE_SIZE);
      const clickedGY = Math.floor(worldPos.y / TILE_SIZE);
      const selectedHarvesterIds = selectedUnits.filter((u) => u.type === 'HARVESTER').map((u) => u.id);

      if (selectedHarvesterIds.length > 0) {
        const clickedRefinery = Array.from(engine.buildings.values()).find(
          (b) =>
            b.ownerId === 1 &&
            b.type === 'REFINERY' &&
            clickedGX >= b.gridX &&
            clickedGX < b.gridX + b.widthTiles &&
            clickedGY >= b.gridY &&
            clickedGY < b.gridY + b.heightTiles
        );
        if (clickedRefinery) {
          engine.issueCommand({ type: 'DIRECT_HARVESTER', unitIds: selectedHarvesterIds, refineryId: clickedRefinery.id });
          orderMarker = { x: worldPos.x, y: worldPos.y, alpha: 1.0, color: 0x55ff77 };
          return;
        }

        const clickedPatch = engine.tiberiumPatches.find((p) => p.gridX === clickedGX && p.gridY === clickedGY && p.amount > 0);
        if (clickedPatch) {
          engine.issueCommand({ type: 'DIRECT_HARVESTER', unitIds: selectedHarvesterIds, targetGridX: clickedGX, targetGridY: clickedGY });
          orderMarker = { x: worldPos.x, y: worldPos.y, alpha: 1.0, color: 0x55ff77 };
          return;
        }
      }

      engine.issueCommand({ type: 'MOVE', unitIds: selectedUnits.map((u) => u.id), targetX: worldPos.x, targetY: worldPos.y });
      orderMarker = { x: worldPos.x, y: worldPos.y, alpha: 1.0, color: 0x55ff77 };
    }
  });

  window.addEventListener('pointermove', (e: PointerEvent) => {
    const rect = app.canvas.getBoundingClientRect();
    mouseScreen.x = e.clientX - rect.left;
    mouseScreen.y = e.clientY - rect.top;

    if (selectionBox.active) {
      selectionBox.currX = mouseScreen.x;
      selectionBox.currY = mouseScreen.y;
    }
    if (camera.isMiddleDragging) {
      camera.x += mouseScreen.x - camera.lastMouseX;
      camera.y += mouseScreen.y - camera.lastMouseY;
      camera.lastMouseX = mouseScreen.x;
      camera.lastMouseY = mouseScreen.y;
    }
  });

  window.addEventListener('pointerup', (e: PointerEvent) => {
    if (e.button === 0 && selectionBox.active) {
      selectionBox.active = false;
      const isShift = e.shiftKey;
      const minSX = Math.min(selectionBox.startX, selectionBox.currX);
      const maxSX = Math.max(selectionBox.startX, selectionBox.currX);
      const minSY = Math.min(selectionBox.startY, selectionBox.currY);
      const maxSY = Math.max(selectionBox.startY, selectionBox.currY);

      const isSingleClick = maxSX - minSX < 6 && maxSY - minSY < 6;
      const p1 = screenToWorld(minSX, minSY);
      const p2 = screenToWorld(maxSX, maxSY);

      for (const unit of engine.units.values()) {
        if (unit.ownerId !== 1) continue;
        if (!isShift) unit.selected = false;
        if (isSingleClick) {
          if (Math.hypot(unit.x - p1.x, unit.y - p1.y) <= unit.radius + 6) unit.selected = true;
        } else if (unit.x >= p1.x && unit.x <= p2.x && unit.y >= p1.y && unit.y <= p2.y) {
          unit.selected = true;
        }
      }
    } else if (e.button === 1) {
      camera.isMiddleDragging = false;
    }
  });

  app.canvas.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      camera.zoom = Math.max(0.5, Math.min(2.0, camera.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    },
    { passive: false }
  );

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    keysPressed.add(key);

    if (key === 'd' && !e.ctrlKey && !e.metaKey) {
      const selectedMcv = Array.from(engine.units.values()).find((u) => u.ownerId === 1 && u.selected && u.type === 'MCV');
      if (selectedMcv) engine.issueCommand({ type: 'DEPLOY_MCV', unitId: selectedMcv.id });
    } else if (key === 'a' && !e.ctrlKey && !e.metaKey) {
      if (Array.from(engine.units.values()).some((u) => u.ownerId === 1 && u.selected)) {
        isAttackMoveMode = true;
        isPlacementMode = false;
      }
    } else if (key === 'f' && !e.ctrlKey && !e.metaKey) {
      engine.fogEnabled = !engine.fogEnabled;
      btnToggleFog.textContent = `FOG: ${engine.fogEnabled ? 'ON' : 'OFF'} [F]`;
    } else if (key === 'm' && !e.ctrlKey && !e.metaKey) {
      audio.enabled = !audio.enabled;
      btnToggleAudio.textContent = `AUDIO: ${audio.enabled ? 'ON' : 'OFF'} [M]`;
    } else if (key === 'escape') {
      isPlacementMode = false;
      isAttackMoveMode = false;
    }

    if (/^[1-9]$/.test(e.key)) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const ids = Array.from(engine.units.values()).filter((u) => u.ownerId === 1 && u.selected).map((u) => u.id);
        if (ids.length > 0) controlGroups.set(e.key, ids);
      } else {
        const groupIds = controlGroups.get(e.key);
        if (groupIds) {
          for (const unit of engine.units.values()) {
            if (unit.ownerId === 1) unit.selected = groupIds.includes(unit.id);
          }
        }
      }
    }
  });

  window.addEventListener('keyup', (e: KeyboardEvent) => {
    keysPressed.delete(e.key.toLowerCase());
  });

  // ============================================================================
  // PHASE 5 SPRITE SCENE GRAPH SYNCHRONIZATION
  // ============================================================================
  function syncCrystalSprites(): void {
    const { TILE_SIZE } = GAME_CONFIG;
    const activeKeys = new Set<string>();

    for (const patch of engine.tiberiumPatches) {
      if (patch.amount <= 0) continue;
      const key = `${patch.gridX}_${patch.gridY}`;
      activeKeys.add(key);

      let sp = crystalSprites.get(key);
      if (!sp) {
        sp = new Sprite(sprites.crystalStages[3]);
        sp.x = patch.gridX * TILE_SIZE;
        sp.y = patch.gridY * TILE_SIZE;
        crystalContainer.addChild(sp);
        crystalSprites.set(key, sp);
      }

      const stageIdx = Math.min(3, Math.max(0, Math.ceil((patch.amount / 100) * 4) - 1));
      sp.texture = sprites.crystalStages[stageIdx];
      sp.visible = !engine.fogEnabled || engine.fogGrid[patch.gridY][patch.gridX] > 0;
    }

    for (const [key, sp] of crystalSprites.entries()) {
      if (!activeKeys.has(key)) {
        crystalContainer.removeChild(sp);
        sp.destroy();
        crystalSprites.delete(key);
      }
    }
  }

  function syncBuildingRigs(): void {
    const { TILE_SIZE } = GAME_CONFIG;
    const activeIds = new Set<number>();

    for (const b of engine.buildings.values()) {
      activeIds.add(b.id);
      let rig = buildingRigs.get(b.id);

      if (!rig) {
        const container = new Container();
        const base = new Sprite(sprites.getBuildingBase(b.type, b.ownerId));
        container.addChild(base);

        let addon: Sprite | null = null;
        if (b.type === 'GUARD_TOWER') {
          addon = new Sprite(sprites.guardTowerTurret);
          addon.anchor.set(0.5);
          addon.x = (b.widthTiles * TILE_SIZE) / 2;
          addon.y = (b.heightTiles * TILE_SIZE) / 2;
          container.addChild(addon);
        } else if (b.type === 'RADAR_DOME') {
          addon = new Sprite(sprites.radarDishTexture);
          addon.anchor.set(0.5);
          addon.x = (b.widthTiles * TILE_SIZE) / 2;
          addon.y = (b.heightTiles * TILE_SIZE) / 2;
          container.addChild(addon);
        }

        buildingSpriteLayer.addChild(container);
        rig = { container, base, addon };
        buildingRigs.set(b.id, rig);
      }

      rig.container.x = b.gridX * TILE_SIZE;
      rig.container.y = b.gridY * TILE_SIZE;
      rig.container.visible =
        b.ownerId === 1 || !engine.fogEnabled || engine.fogGrid[b.gridY][b.gridX] > 0;

      if (rig.addon) {
        if (b.type === 'GUARD_TOWER') {
          const recoil = b.attackCooldown > 6 ? -3 : 0;
          rig.addon.rotation = b.turretAngle;
          rig.addon.x = (b.widthTiles * TILE_SIZE) / 2 + Math.cos(b.turretAngle) * recoil;
          rig.addon.y = (b.heightTiles * TILE_SIZE) / 2 + Math.sin(b.turretAngle) * recoil;
        } else if (b.type === 'RADAR_DOME') {
          rig.addon.rotation += 0.03;
        }
      }

      // Draw Building Health Bar on Tactical Layer
      if (rig.container.visible) {
        const w = b.widthTiles * TILE_SIZE;
        const hpRatio = Math.max(0, b.hp / b.maxHp);
        tacticalHudGraphics.rect(rig.container.x + 6, rig.container.y - 7, w - 12, 4).fill({ color: 0x111111 });
        tacticalHudGraphics
          .rect(rig.container.x + 6, rig.container.y - 7, (w - 12) * hpRatio, 4)
          .fill({ color: b.ownerId === 1 ? 0x55ff77 : 0xff4444 });
      }
    }

    for (const [id, rig] of buildingRigs.entries()) {
      if (!activeIds.has(id)) {
        buildingSpriteLayer.removeChild(rig.container);
        rig.container.destroy({ children: true });
        buildingRigs.delete(id);
      }
    }
  }

  function syncUnitRigs(alpha: number): { selectedCount: number; harvesterCount: number; nodCount: number } {
    const activeIds = new Set<number>();
    let selectedCount = 0;
    let harvesterCount = 0;
    let nodCount = 0;

    for (const unit of engine.units.values()) {
      activeIds.add(unit.id);
      if (unit.ownerId === 1) {
        if (unit.selected) selectedCount++;
        if (unit.type === 'HARVESTER') harvesterCount++;
      } else {
        nodCount++;
      }

      let rig = unitRigs.get(unit.id);
      if (!rig) {
        const container = new Container();
        const hull = new Sprite(sprites.getUnitHull(unit.type, unit.ownerId));
        hull.anchor.set(0.5);
        container.addChild(hull);

        let turret: Sprite | null = null;
        const turretTex = sprites.getUnitTurret(unit.type, unit.ownerId);
        if (turretTex) {
          turret = new Sprite(turretTex);
          turret.anchor.set(0.5);
          container.addChild(turret);
        }

        unitSpriteLayer.addChild(container);
        rig = { container, hull, turret };
        unitRigs.set(unit.id, rig);
      }

      const rx = unit.prevX + (unit.x - unit.prevX) * alpha;
      const ry = unit.prevY + (unit.y - unit.prevY) * alpha;
      const isVisible = unit.ownerId === 1 || engine.isWorldPosVisibleToPlayer(unit.x, unit.y);

      rig.container.visible = isVisible;
      if (!isVisible) continue;

      rig.container.x = rx;
      rig.container.y = ry;
      rig.hull.rotation = unit.hullAngle;

      if (rig.turret && unit.weapon) {
        rig.turret.rotation = unit.turretAngle;
        // Firing recoil kickback
        const kick = unit.attackCooldown > unit.weapon.cooldownTicks - 3 ? -3.5 : 0;
        rig.turret.x = Math.cos(unit.turretAngle) * kick;
        rig.turret.y = Math.sin(unit.turretAngle) * kick;
      }

      // Harvester 5-pip load indicator & Selection Brackets
      const r = unit.radius;
      if (unit.type === 'HARVESTER') {
        const pips = 5;
        const filled = Math.round((unit.tiberiumLoad / unit.maxTiberiumLoad) * pips);
        for (let i = 0; i < pips; i++) {
          tacticalHudGraphics
            .rect(rx - 14 + i * 6, ry + r + 3, 4, 4)
            .fill({ color: i < filled ? 0x2ee65f : 0x222a22 });
        }
      }

      if (unit.selected) {
        if (unit.targetEntityId !== null) {
          const tPos = engine.getEntityWorldPos(unit.targetEntityId);
          if (tPos) {
            tacticalHudGraphics.moveTo(rx, ry).lineTo(tPos.x, tPos.y).stroke({ width: 1.2, color: 0xff4444, alpha: 0.65 });
          }
        } else if (unit.targetX !== null && unit.targetY !== null) {
          tacticalHudGraphics
            .moveTo(rx, ry)
            .lineTo(unit.targetX, unit.targetY)
            .stroke({ width: 1, color: unit.isAttackMove ? 0xff8844 : 0x55ff77, alpha: 0.45 });
        }
      }

      if (unit.selected || unit.ownerId !== 1) {
        const b = r + 5;
        if (unit.selected) {
          tacticalHudGraphics.rect(rx - b, ry - b, b * 2, b * 2).stroke({ width: 1.5, color: 0x55ff77 });
        }
        const hpRatio = Math.max(0, unit.hp / unit.maxHp);
        tacticalHudGraphics.rect(rx - b, ry - b - 6, b * 2, 4).fill({ color: 0x111111 });
        tacticalHudGraphics
          .rect(rx - b, ry - b - 6, b * 2 * hpRatio, 4)
          .fill({ color: unit.ownerId === 1 ? 0x55ff77 : 0xff4444 });
      }
    }

    for (const [id, rig] of unitRigs.entries()) {
      if (!activeIds.has(id)) {
        unitSpriteLayer.removeChild(rig.container);
        rig.container.destroy({ children: true });
        unitRigs.delete(id);
      }
    }

    return { selectedCount, harvesterCount, nodCount };
  }

  function drawProjectilesAndExplosions(alpha: number): void {
    projectileGraphics.clear();

    for (const proj of engine.projectiles.values()) {
      if (!engine.isWorldPosVisibleToPlayer(proj.x, proj.y)) continue;
      const rx = proj.prevX + (proj.x - proj.prevX) * alpha;
      const ry = proj.prevY + (proj.y - proj.prevY) * alpha;

      if (proj.style === 'BULLET') {
        projectileGraphics.moveTo(proj.prevX, proj.prevY).lineTo(rx, ry).stroke({ width: 2, color: 0xffee66 });
      } else if (proj.style === 'SHELL') {
        projectileGraphics.circle(rx, ry, 4.5).fill({ color: 0xffaa33 }).stroke({ width: 1.2, color: 0xffffff });
      } else if (proj.style === 'ROCKET') {
        projectileGraphics.circle(rx, ry, 4).fill({ color: 0xff4422 });
        projectileGraphics.circle(proj.prevX, proj.prevY, 3.5).fill({ color: 0xbbbbbb, alpha: 0.65 });
      }
    }

    for (const exp of engine.explosions) {
      if (!engine.isWorldPosVisibleToPlayer(exp.x, exp.y)) continue;
      const progress = exp.currentTick / exp.totalTicks;
      const radius = exp.maxRadius * (0.3 + 0.7 * progress);
      const fade = 1 - progress;
      projectileGraphics
        .circle(exp.x, exp.y, radius)
        .fill({ color: exp.color, alpha: fade * 0.6 })
        .stroke({ width: 2, color: 0xffffaa, alpha: fade });
    }
  }

  function drawPlacementPreview(): void {
    placementGraphics.clear();

    if (isAttackMoveMode) {
      modeBanner.style.display = 'block';
      modeBanner.textContent = 'ATTACK-MOVE MODE: Left-Click Map or Radar | Right-Click to Cancel';
      return;
    }

    if (!engine.buildingQueue?.readyToPlace) {
      isPlacementMode = false;
      modeBanner.style.display = 'none';
      return;
    }

    modeBanner.style.display = isPlacementMode ? 'block' : 'none';
    modeBanner.textContent = 'PLACEMENT MODE: Left-Click Green Tiles | Right-Click to Cancel';
    if (!isPlacementMode) return;

    const { TILE_SIZE, BASE_ADJACENCY_TILES } = GAME_CONFIG;
    const bType = engine.buildingQueue.itemType as BuildingType;
    const entry = CATALOG[bType];
    const w = entry.widthTiles ?? 2;
    const h = entry.heightTiles ?? 2;

    for (const b of engine.buildings.values()) {
      if (b.ownerId !== 1) continue;
      placementGraphics
        .circle((b.gridX + b.widthTiles / 2) * TILE_SIZE, (b.gridY + b.heightTiles / 2) * TILE_SIZE, BASE_ADJACENCY_TILES * TILE_SIZE)
        .stroke({ width: 1.5, color: 0x55ff77, alpha: 0.3 });
    }

    const worldPos = screenToWorld(mouseScreen.x, mouseScreen.y);
    const gx = Math.floor(worldPos.x / TILE_SIZE - w / 2 + 0.5);
    const gy = Math.floor(worldPos.y / TILE_SIZE - h / 2 + 0.5);
    const check = engine.validateBuildingPlacement(bType, gx, gy);

    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const tileValid = check.tileMatrix[dy][dx];
        placementGraphics
          .rect((gx + dx) * TILE_SIZE + 2, (gy + dy) * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4)
          .fill({ color: tileValid ? 0x33ff66 : 0xff3333, alpha: 0.45 })
          .stroke({ width: 1.5, color: tileValid ? 0x55ff77 : 0xff5555 });
      }
    }
  }

  // Telemetry & Sidebar DOM Sync
  const elTick = document.getElementById('stat-tick')!;
  const elSelected = document.getElementById('stat-selected')!;
  const elHarvesters = document.getElementById('stat-harvesters')!;
  const elEnemies = document.getElementById('stat-enemies')!;
  const elWave = document.getElementById('stat-wave')!;
  const elCmd = document.getElementById('stat-cmd')!;
  const elCredits = document.getElementById('stat-credits')!;
  const elEconRate = document.getElementById('stat-econ-rate')!;
  const elPowerText = document.getElementById('stat-power-text')!;
  const elPowerBar = document.getElementById('stat-power-bar')!;
  const elStatusBldg = document.getElementById('status-bldg')!;
  const elProgBldg = document.getElementById('prog-bldg')!;
  const elStatusUnit = document.getElementById('status-unit')!;
  const elProgUnit = document.getElementById('prog-unit')!;

  let wasBuildingReadyLastFrame = false;

  function syncSidebarUI(): void {
    elCredits.textContent = `$ ${Math.floor(engine.credits).toLocaleString()}`;
    const power = engine.getPowerStats(1);
    elPowerText.textContent = `${power.produced} / ${power.consumed} MW`;
    const ratio = power.consumed === 0 ? 100 : Math.min(100, (power.produced / power.consumed) * 100);
    elPowerBar.style.width = `${ratio}%`;
    elPowerBar.style.backgroundColor = power.isLowPower ? '#ff4444' : '#55ff77';
    elEconRate.textContent = power.isLowPower ? 'LOW POWER (50% SPD)' : 'POWER NORMAL';
    elEconRate.style.color = power.isLowPower ? '#ff6666' : '#7a9a7e';

    btnDeployMcv.disabled = !Array.from(engine.units.values()).some((u) => u.ownerId === 1 && u.selected && u.type === 'MCV');
    btnAttackMove.classList.toggle('active-toggle', isAttackMoveMode);

    for (const [key, card] of cardElements.entries()) {
      const unlocked = engine.hasPrerequisites(key, 1);
      const reqEl = document.getElementById(`req-${key}`)!;
      card.classList.toggle('locked', !unlocked);
      reqEl.textContent = unlocked
        ? ''
        : `Req: ${CATALOG[key].prerequisites[CATALOG[key].prerequisites.length - 1].replace('_', ' ')}`;
      card.classList.toggle('active-place', Boolean(engine.buildingQueue?.readyToPlace && engine.buildingQueue.itemType === key));
    }

    if (engine.buildingQueue) {
      btnCancelBldg.style.display = 'inline-block';
      const pct = Math.floor((engine.buildingQueue.completedTicks / engine.buildingQueue.totalTicks) * 100);
      elProgBldg.style.width = `${pct}%`;
      if (engine.buildingQueue.readyToPlace) {
        elStatusBldg.textContent = `${CATALOG[engine.buildingQueue.itemType].name}: CLICK MAP`;
        if (!wasBuildingReadyLastFrame) {
          isPlacementMode = true;
          wasBuildingReadyLastFrame = true;
        }
      } else {
        wasBuildingReadyLastFrame = false;
        elStatusBldg.textContent = engine.buildingQueue.onHold ? 'ON HOLD (NO FUNDS)' : `${CATALOG[engine.buildingQueue.itemType].name} (${pct}%)`;
      }
    } else {
      wasBuildingReadyLastFrame = false;
      btnCancelBldg.style.display = 'none';
      elStatusBldg.textContent = 'Idle';
      elProgBldg.style.width = '0%';
    }

    if (engine.unitQueue) {
      btnCancelUnit.style.display = 'inline-block';
      const pct = Math.floor((engine.unitQueue.completedTicks / engine.unitQueue.totalTicks) * 100);
      elProgUnit.style.width = `${pct}%`;
      elStatusUnit.textContent = engine.unitQueue.onHold ? 'ON HOLD (NO FUNDS)' : `${CATALOG[engine.unitQueue.itemType].name} (${pct}%)`;
    } else {
      btnCancelUnit.style.display = 'none';
      elStatusUnit.textContent = 'Idle';
      elProgUnit.style.width = '0%';
    }

    if (engine.matchStatus !== 'PLAYING') {
      matchOverlay.style.display = 'flex';
      matchTitle.textContent = engine.matchStatus === 'VICTORY' ? 'GDI MISSION ACCOMPLISHED' : 'BROTHERHOOD OF NOD VICTORY';
      matchTitle.style.color = engine.matchStatus === 'VICTORY' ? '#55ff77' : '#ff4444';
      matchSubtitle.textContent =
        engine.matchStatus === 'VICTORY'
          ? 'All hostile structures and forces in this sector have been neutralized.'
          : 'Your expeditionary force was eliminated.';
    }
  }

  // Main Fixed-Timestep Loop
  let lastTime = performance.now();
  let accumulator = 0;

  app.ticker.add(() => {
    const now = performance.now();
    accumulator += Math.min(now - lastTime, 250);
    lastTime = now;

    while (accumulator >= GAME_CONFIG.TICK_MS) {
      engine.stepSimulationTick();
      accumulator -= GAME_CONFIG.TICK_MS;
    }

    for (const ev of engine.consumeEvents()) {
      if (ev.sfx) audio.playSfx(ev.sfx);
      if (ev.evaSpeech) audio.speakEva(ev.evaSpeech);
    }

    if (keysPressed.has('w') || keysPressed.has('arrowup')) camera.y += camera.panSpeed;
    if (keysPressed.has('s') || keysPressed.has('arrowdown')) camera.y -= camera.panSpeed;
    if (keysPressed.has('a') || keysPressed.has('arrowleft')) camera.x += camera.panSpeed;
    if (keysPressed.has('d') || keysPressed.has('arrowright')) camera.x -= camera.panSpeed;

    worldContainer.x = camera.x;
    worldContainer.y = camera.y;
    worldContainer.scale.set(camera.zoom);

    const alpha = accumulator / GAME_CONFIG.TICK_MS;
    tacticalHudGraphics.clear();

    if (orderMarker) {
      tacticalHudGraphics
        .circle(orderMarker.x, orderMarker.y, 15 * orderMarker.alpha)
        .stroke({ width: 2, color: orderMarker.color, alpha: orderMarker.alpha });
      orderMarker.alpha -= 0.04;
      if (orderMarker.alpha <= 0) orderMarker = null;
    }

    syncCrystalSprites();
    syncBuildingRigs();
    const counts = syncUnitRigs(alpha);
    for (const b of engine.buildings.values()) {
      if (b.ownerId !== 1) counts.nodCount++;
    }

    drawProjectilesAndExplosions(alpha);
    vfx.update(engine);
    drawPlacementPreview();
    renderRadarMinimap();

    uiOverlayGraphics.clear();
    if (selectionBox.active) {
      const x = Math.min(selectionBox.startX, selectionBox.currX);
      const y = Math.min(selectionBox.startY, selectionBox.currY);
      const w = Math.abs(selectionBox.currX - selectionBox.startX);
      const h = Math.abs(selectionBox.startY - selectionBox.currY);
      uiOverlayGraphics.rect(x, y, w, h).fill({ color: 0x55ff77, alpha: 0.15 }).stroke({ width: 1.5, color: 0x55ff77 });
    }

    elTick.textContent = String(engine.currentTick);
    elSelected.textContent = String(counts.selectedCount);
    elHarvesters.textContent = String(counts.harvesterCount);
    const waveRemainingSecs = Math.ceil(engine.aiWaveCountdownTicks / GAME_CONFIG.TICK_RATE);
    const waveMins = Math.floor(waveRemainingSecs / 60);
    const waveSecs = waveRemainingSecs % 60;
    elWave.textContent =
      waveMins > 0
        ? `Next Wave: ${waveMins}m ${waveSecs.toString().padStart(2, '0')}s`
        : `Next Wave: ${waveSecs}s`;
    elCmd.textContent = engine.lastCommandText;
    syncSidebarUI();
  });
}

bootstrap();
import { Application, Container, Graphics } from 'pixi.js';
import { AudioSystem } from './AudioSystem';
import { GameEngine } from './GameEngine';
import {
  BuildingType,
  CATALOG,
  GAME_CONFIG,
  UnitEntity,
  UnitType,
} from './types';

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

  const engine = new GameEngine();
  const audio = new AudioSystem();

  // Scene Graph Layers
  const worldContainer = new Container();
  const terrainGraphics = new Graphics();
  const tiberiumGraphics = new Graphics();
  const buildingGraphics = new Graphics();
  const unitGraphics = new Graphics();
  const projectileGraphics = new Graphics();
  const fogGraphics = new Graphics();
  const placementGraphics = new Graphics();
  const uiOverlayGraphics = new Graphics();

  worldContainer.addChild(terrainGraphics);
  worldContainer.addChild(tiberiumGraphics);
  worldContainer.addChild(buildingGraphics);
  worldContainer.addChild(unitGraphics);
  worldContainer.addChild(projectileGraphics);
  worldContainer.addChild(fogGraphics);
  worldContainer.addChild(placementGraphics);
  app.stage.addChild(worldContainer);
  app.stage.addChild(uiOverlayGraphics);

  // Camera & Interaction State
  const camera = {
    x: -110,
    y: -120,
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

  function drawStaticGrid(): void {
    terrainGraphics.clear();
    const { MAP_COLS, MAP_ROWS, TILE_SIZE } = GAME_CONFIG;
    const totalW = MAP_COLS * TILE_SIZE;
    const totalH = MAP_ROWS * TILE_SIZE;

    terrainGraphics.rect(0, 0, totalW, totalH).fill({ color: 0x1e241b });

    for (let c = 0; c <= MAP_COLS; c++) {
      terrainGraphics
        .moveTo(c * TILE_SIZE, 0)
        .lineTo(c * TILE_SIZE, totalH)
        .stroke({ width: 1, color: 0x283024, alpha: 0.7 });
    }
    for (let r = 0; r <= MAP_ROWS; r++) {
      terrainGraphics
        .moveTo(0, r * TILE_SIZE)
        .lineTo(totalW, r * TILE_SIZE)
        .stroke({ width: 1, color: 0x283024, alpha: 0.7 });
    }
  }
  drawStaticGrid();

  function screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - camera.x) / camera.zoom,
      y: (screenY - camera.y) / camera.zoom,
    };
  }

  // ============================================================================
  // INTERACTIVE RADAR MINIMAP SETUP
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
    const targetWorldX = rx * worldW;
    const targetWorldY = ry * worldH;

    camera.x = app.screen.width / 2 - targetWorldX * camera.zoom;
    camera.y = app.screen.height / 2 - targetWorldY * camera.zoom;
  }

  radarCanvas.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button === 0) {
      isDraggingRadar = true;
      jumpCameraToRadarPoint(e.clientX, e.clientY);
    } else if (e.button === 2) {
      // Right-click on Minimap issues MOVE / ATTACK_MOVE to selected units
      const rect = radarCanvas.getBoundingClientRect();
      const rx = (e.clientX - rect.left) / rect.width;
      const ry = (e.clientY - rect.top) / rect.height;
      const worldW = GAME_CONFIG.MAP_COLS * GAME_CONFIG.TILE_SIZE;
      const worldH = GAME_CONFIG.MAP_ROWS * GAME_CONFIG.TILE_SIZE;
      const wx = rx * worldW;
      const wy = ry * worldH;

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
        orderMarker = {
          x: wx,
          y: wy,
          alpha: 1.0,
          color: isAttackMoveMode ? 0xff4444 : 0x55ff77,
        };
        isAttackMoveMode = false;
      }
    }
  });

  window.addEventListener('pointermove', (e: PointerEvent) => {
    if (isDraggingRadar) {
      jumpCameraToRadarPoint(e.clientX, e.clientY);
    }
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

    // 1. Base background
    radarCtx.fillStyle = '#121812';
    radarCtx.fillRect(0, 0, cw, ch);

    // 2. Terrain & Fog of War tiles
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        const vis = engine.fogEnabled ? engine.fogGrid[r][c] : 2;
        if (vis === 0 && !hasRadarSweep) {
          radarCtx.fillStyle = '#040604';
        } else if (vis === 1) {
          radarCtx.fillStyle = '#141a13';
        } else {
          radarCtx.fillStyle = '#222b1f';
        }
        radarCtx.fillRect(c * tileW, r * tileH, tileW + 0.5, tileH + 0.5);
      }
    }

    // 3. Tiberium patches
    radarCtx.fillStyle = '#2ee65f';
    for (const p of engine.tiberiumPatches) {
      if (p.amount <= 0) continue;
      if (engine.fogEnabled && engine.fogGrid[p.gridY][p.gridX] === 0 && !hasRadarSweep) continue;
      radarCtx.fillRect(p.gridX * tileW, p.gridY * tileH, tileW, tileH);
    }

    // 4. Structures
    for (const b of engine.buildings.values()) {
      if (
        b.ownerId !== 1 &&
        engine.fogEnabled &&
        engine.fogGrid[b.gridY][b.gridX] === 0 &&
        !hasRadarSweep
      ) {
        continue;
      }
      radarCtx.fillStyle = b.ownerId === 1 ? '#e6c34a' : '#ff3b3b';
      radarCtx.fillRect(
        b.gridX * tileW,
        b.gridY * tileH,
        b.widthTiles * tileW,
        b.heightTiles * tileH
      );
    }

    // 5. Mobile Units
    const worldW = MAP_COLS * TILE_SIZE;
    const worldH = MAP_ROWS * TILE_SIZE;
    for (const u of engine.units.values()) {
      if (
        u.ownerId !== 1 &&
        !engine.isWorldPosVisibleToPlayer(u.x, u.y) &&
        !hasRadarSweep
      ) {
        continue;
      }
      radarCtx.fillStyle = u.ownerId === 1 ? '#55ff77' : '#ff4444';
      const ux = (u.x / worldW) * cw;
      const uy = (u.y / worldH) * ch;
      radarCtx.fillRect(ux - 1.5, uy - 1.5, 3, 3);
    }

    // 6. Camera Viewport Box
    const camLeft = (-camera.x / camera.zoom / worldW) * cw;
    const camTop = (-camera.y / camera.zoom / worldH) * ch;
    const camW = (app.screen.width / camera.zoom / worldW) * cw;
    const camH = (app.screen.height / camera.zoom / worldH) * ch;

    radarCtx.strokeStyle = '#ffffff';
    radarCtx.lineWidth = 1.2;
    radarCtx.strokeRect(camLeft, camTop, camW, camH);
  }

  // ============================================================================
  // SIDEBAR UI INITIALIZATION
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

  function createSidebarCards(): void {
    for (const bKey of structureTypes) {
      const entry = CATALOG[bKey];
      const card = document.createElement('div');
      card.className = 'build-card';
      card.innerHTML = `
        <div class="build-title">${entry.name}</div>
        <div class="build-cost">$${entry.cost}</div>
        <div class="build-req" id="req-${bKey}"></div>
      `;
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
      card.innerHTML = `
        <div class="build-title">${entry.name}</div>
        <div class="build-cost">$${entry.cost}</div>
        <div class="build-req" id="req-${uKey}"></div>
      `;
      card.addEventListener('click', () => {
        engine.issueCommand({ type: 'START_PRODUCTION', itemType: uKey });
      });
      gridUnitsEl.appendChild(card);
      cardElements.set(uKey, card);
    }
  }
  createSidebarCards();

  btnDeployMcv.addEventListener('click', () => {
    const selectedMcv = Array.from(engine.units.values()).find(
      (u) => u.ownerId === 1 && u.selected && u.type === 'MCV'
    );
    if (selectedMcv) {
      engine.issueCommand({ type: 'DEPLOY_MCV', unitId: selectedMcv.id });
    }
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
    engine.resetMatch();
    camera.x = -110;
    camera.y = -120;
    matchOverlay.style.display = 'none';
  });

  function findHostileAtWorldPos(wx: number, wy: number): number | null {
    for (const u of engine.units.values()) {
      if (u.ownerId === 1) continue;
      if (!engine.isWorldPosVisibleToPlayer(u.x, u.y)) continue;
      if (Math.hypot(u.x - wx, u.y - wy) <= u.radius + 8) {
        return u.id;
      }
    }
    const { TILE_SIZE } = GAME_CONFIG;
    for (const b of engine.buildings.values()) {
      if (b.ownerId === 1) continue;
      const left = b.gridX * TILE_SIZE;
      const right = (b.gridX + b.widthTiles) * TILE_SIZE;
      const top = b.gridY * TILE_SIZE;
      const bottom = (b.gridY + b.heightTiles) * TILE_SIZE;
      if (wx >= left && wx <= right && wy >= top && wy <= bottom) {
        return b.id;
      }
    }
    return null;
  }

  // ============================================================================
  // CANVAS POINTER & KEYBOARD INPUT
  // ============================================================================
  app.canvas.addEventListener('dblclick', (e: MouseEvent) => {
    const rect = app.canvas.getBoundingClientRect();
    const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    for (const u of engine.units.values()) {
      if (
        u.ownerId === 1 &&
        u.type === 'MCV' &&
        Math.hypot(u.x - worldPos.x, u.y - worldPos.y) <= u.radius + 8
      ) {
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

        const check = engine.validateBuildingPlacement(bType, gx, gy);
        if (check.valid) {
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
          engine.issueCommand({
            type: 'ATTACK_MOVE',
            unitIds: selectedIds,
            targetX: worldPos.x,
            targetY: worldPos.y,
          });
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

      const selectedUnits = Array.from(engine.units.values()).filter(
        (u) => u.ownerId === 1 && u.selected
      );
      if (selectedUnits.length === 0) return;

      const hostileId = findHostileAtWorldPos(worldPos.x, worldPos.y);
      if (hostileId !== null) {
        engine.issueCommand({
          type: 'ATTACK',
          unitIds: selectedUnits.map((u) => u.id),
          targetEntityId: hostileId,
        });
        orderMarker = { x: worldPos.x, y: worldPos.y, alpha: 1.0, color: 0xff3333 };
        return;
      }

      const { TILE_SIZE } = GAME_CONFIG;
      const clickedGX = Math.floor(worldPos.x / TILE_SIZE);
      const clickedGY = Math.floor(worldPos.y / TILE_SIZE);
      const selectedHarvesterIds = selectedUnits
        .filter((u) => u.type === 'HARVESTER')
        .map((u) => u.id);

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
          engine.issueCommand({
            type: 'DIRECT_HARVESTER',
            unitIds: selectedHarvesterIds,
            refineryId: clickedRefinery.id,
          });
          orderMarker = { x: worldPos.x, y: worldPos.y, alpha: 1.0, color: 0x55ff77 };
          return;
        }

        const clickedPatch = engine.tiberiumPatches.find(
          (p) => p.gridX === clickedGX && p.gridY === clickedGY && p.amount > 0
        );
        if (clickedPatch) {
          engine.issueCommand({
            type: 'DIRECT_HARVESTER',
            unitIds: selectedHarvesterIds,
            targetGridX: clickedGX,
            targetGridY: clickedGY,
          });
          orderMarker = { x: worldPos.x, y: worldPos.y, alpha: 1.0, color: 0x55ff77 };
          return;
        }
      }

      engine.issueCommand({
        type: 'MOVE',
        unitIds: selectedUnits.map((u) => u.id),
        targetX: worldPos.x,
        targetY: worldPos.y,
      });
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
          if (Math.hypot(unit.x - p1.x, unit.y - p1.y) <= unit.radius + 6) {
            unit.selected = true;
          }
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
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      camera.zoom = Math.max(0.5, Math.min(2.0, camera.zoom * zoomFactor));
    },
    { passive: false }
  );

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    keysPressed.add(key);

    if (key === 'd' && !e.ctrlKey && !e.metaKey) {
      const selectedMcv = Array.from(engine.units.values()).find(
        (u) => u.ownerId === 1 && u.selected && u.type === 'MCV'
      );
      if (selectedMcv) {
        engine.issueCommand({ type: 'DEPLOY_MCV', unitId: selectedMcv.id });
      }
    } else if (key === 'a' && !e.ctrlKey && !e.metaKey) {
      const hasSelected = Array.from(engine.units.values()).some(
        (u) => u.ownerId === 1 && u.selected
      );
      if (hasSelected) {
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
        const ids = Array.from(engine.units.values())
          .filter((u) => u.ownerId === 1 && u.selected)
          .map((u) => u.id);
        if (ids.length > 0) controlGroups.set(e.key, ids);
      } else {
        const groupIds = controlGroups.get(e.key);
        if (groupIds) {
          for (const unit of engine.units.values()) {
            if (unit.ownerId === 1) {
              unit.selected = groupIds.includes(unit.id);
            }
          }
        }
      }
    }
  });

  window.addEventListener('keyup', (e: KeyboardEvent) => {
    keysPressed.delete(e.key.toLowerCase());
  });

  // ============================================================================
  // RENDERING HELPERS
  // ============================================================================
  function drawTiberiumPatches(): void {
    tiberiumGraphics.clear();
    const { TILE_SIZE } = GAME_CONFIG;

    for (const patch of engine.tiberiumPatches) {
      if (patch.amount <= 0) continue;
      if (engine.fogEnabled && engine.fogGrid[patch.gridY][patch.gridX] === 0) continue;

      const cx = patch.gridX * TILE_SIZE + TILE_SIZE / 2;
      const cy = patch.gridY * TILE_SIZE + TILE_SIZE / 2;
      const scale = Math.max(0.35, patch.amount / 100);

      tiberiumGraphics.circle(cx, cy, 15 * scale).fill({ color: 0x23c552, alpha: 0.35 });
      tiberiumGraphics.circle(cx - 5 * scale, cy - 4 * scale, 5 * scale).fill({ color: 0x4dff79 });
      tiberiumGraphics.circle(cx + 6 * scale, cy + 3 * scale, 4 * scale).fill({ color: 0x4dff79 });
      tiberiumGraphics.circle(cx - 2 * scale, cy + 6 * scale, 4.5 * scale).fill({ color: 0x2ee65f });
    }
  }

  function drawBuildings(): void {
    buildingGraphics.clear();
    const { TILE_SIZE } = GAME_CONFIG;

    for (const b of engine.buildings.values()) {
      if (
        b.ownerId !== 1 &&
        engine.fogEnabled &&
        engine.fogGrid[b.gridY][b.gridX] === 0
      ) {
        continue;
      }

      const x = b.gridX * TILE_SIZE;
      const y = b.gridY * TILE_SIZE;
      const w = b.widthTiles * TILE_SIZE;
      const h = b.heightTiles * TILE_SIZE;
      const isGDI = b.ownerId === 1;
      const primaryColor = isGDI ? 0xd4af37 : 0xd93838;
      const darkFill = isGDI ? 0x8f7224 : 0x7a1f1f;

      buildingGraphics
        .rect(x + 3, y + 3, w - 6, h - 6)
        .fill({ color: 0x262b26 })
        .stroke({ width: 2, color: primaryColor });

      if (b.type === 'CONSTRUCTION_YARD') {
        buildingGraphics.rect(x + 12, y + 12, w - 24, h - 24).fill({ color: darkFill });
        buildingGraphics.circle(x + w * 0.35, y + h * 0.35, 18).fill({ color: primaryColor });
      } else if (b.type === 'POWER_PLANT') {
        buildingGraphics.circle(x + w * 0.35, y + h * 0.5, 16).fill({ color: 0x4b594d });
        buildingGraphics.circle(x + w * 0.35, y + h * 0.5, 9).fill({ color: 0x55ff77 });
        buildingGraphics.rect(x + w * 0.6, y + 14, 18, h - 28).fill({ color: primaryColor });
      } else if (b.type === 'REFINERY') {
        buildingGraphics.rect(x + 10, y + 10, w - 20, h * 0.55).fill({ color: darkFill });
        buildingGraphics.circle(x + 28, y + 28, 12).fill({ color: 0x2ee65f });
        buildingGraphics.circle(x + 58, y + 28, 12).fill({ color: 0x2ee65f });
        buildingGraphics
          .rect(x + w * 0.25, y + h * 0.62, w * 0.5, h * 0.33)
          .fill({ color: 0x1b241d })
          .stroke({ width: 1.5, color: primaryColor });
      } else if (b.type === 'BARRACKS') {
        buildingGraphics.rect(x + 12, y + 12, w - 24, h - 24).fill({ color: darkFill });
        buildingGraphics.circle(x + w / 2, y + h / 2, 12).fill({ color: primaryColor });
      } else if (b.type === 'WAR_FACTORY') {
        buildingGraphics.rect(x + 8, y + 8, w - 16, h - 18).fill({ color: darkFill });
        buildingGraphics.rect(x + 20, y + h - 18, w - 40, 12).fill({ color: primaryColor });
      } else if (b.type === 'GUARD_TOWER') {
        const cx = x + w / 2;
        const cy = y + h / 2;
        buildingGraphics.circle(cx, cy, 15).fill({ color: darkFill }).stroke({ width: 2, color: primaryColor });
        const bx = cx + Math.cos(b.turretAngle) * 20;
        const by = cy + Math.sin(b.turretAngle) * 20;
        buildingGraphics.moveTo(cx, cy).lineTo(bx, by).stroke({ width: 4, color: 0xeeeeee });
      } else if (b.type === 'RADAR_DOME') {
        buildingGraphics.rect(x + 10, y + 10, w - 20, h - 20).fill({ color: darkFill });
        buildingGraphics
          .circle(x + w / 2, y + h / 2, 22)
          .fill({ color: 0x1b2e20 })
          .stroke({ width: 2, color: 0x55ff77 });
      }

      const hpRatio = Math.max(0, b.hp / b.maxHp);
      buildingGraphics.rect(x + 6, y - 7, w - 12, 4).fill({ color: 0x111111 });
      buildingGraphics
        .rect(x + 6, y - 7, (w - 12) * hpRatio, 4)
        .fill({ color: isGDI ? 0x55ff77 : 0xff4444 });
    }
  }

  function drawUnit(unit: UnitEntity, rx: number, ry: number): void {
    if (unit.ownerId !== 1 && !engine.isWorldPosVisibleToPlayer(unit.x, unit.y)) {
      return;
    }

    const r = unit.radius;
    const isGDI = unit.ownerId === 1;
    const hullColor = isGDI ? 0xd9a74a : 0xd93b3b;
    const turretColor = isGDI ? 0xb8862d : 0x992222;

    if (unit.selected) {
      if (unit.targetEntityId !== null) {
        const tPos = engine.getEntityWorldPos(unit.targetEntityId);
        if (tPos) {
          unitGraphics
            .moveTo(rx, ry)
            .lineTo(tPos.x, tPos.y)
            .stroke({ width: 1.2, color: 0xff4444, alpha: 0.65 });
        }
      } else if (unit.targetX !== null && unit.targetY !== null) {
        unitGraphics
          .moveTo(rx, ry)
          .lineTo(unit.targetX, unit.targetY)
          .stroke({
            width: 1,
            color: unit.isAttackMove ? 0xff8844 : 0x55ff77,
            alpha: 0.45,
          });
      }
    }

    if (unit.type === 'LIGHT_INFANTRY') {
      unitGraphics.circle(rx, ry, r).fill({ color: hullColor }).stroke({ width: 1.5, color: 0x111111 });
    } else if (unit.type === 'ROCKET_SOLDIER') {
      unitGraphics.circle(rx, ry, r).fill({ color: hullColor }).stroke({ width: 2, color: 0xffffff });
      const bx = rx + Math.cos(unit.turretAngle) * (r + 5);
      const by = ry + Math.sin(unit.turretAngle) * (r + 5);
      unitGraphics.moveTo(rx, ry).lineTo(bx, by).stroke({ width: 3, color: 0xff6633 });
    } else if (unit.type === 'MEDIUM_TANK') {
      unitGraphics
        .rect(rx - r, ry - r * 0.8, r * 2, r * 1.6)
        .fill({ color: hullColor })
        .stroke({ width: 2, color: 0x222222 });
      unitGraphics
        .circle(rx, ry, r * 0.55)
        .fill({ color: turretColor })
        .stroke({ width: 1.5, color: 0x222222 });
      const bx = rx + Math.cos(unit.turretAngle) * (r * 1.3);
      const by = ry + Math.sin(unit.turretAngle) * (r * 1.3);
      unitGraphics.moveTo(rx, ry).lineTo(bx, by).stroke({ width: 4, color: 0x222222 });
    } else if (unit.type === 'HARVESTER') {
      unitGraphics
        .rect(rx - r, ry - r * 0.85, r * 2, r * 1.7)
        .fill({ color: isGDI ? 0xe6b800 : 0xb83232 })
        .stroke({ width: 2, color: 0x1f1f1f });

      const pips = 5;
      const filledPips = Math.round((unit.tiberiumLoad / unit.maxTiberiumLoad) * pips);
      for (let i = 0; i < pips; i++) {
        unitGraphics
          .rect(rx - r + 4 + i * 7, ry - 4, 5, 8)
          .fill({ color: i < filledPips ? 0x2ee65f : 0x2c352d });
      }
    } else if (unit.type === 'MCV') {
      unitGraphics
        .rect(rx - r, ry - r, r * 2, r * 2)
        .fill({ color: hullColor })
        .stroke({ width: 2.5, color: 0x111111 });
      unitGraphics.circle(rx, ry, r * 0.5).fill({ color: 0x55ff77 });
    }

    if (unit.selected || !isGDI) {
      const b = r + 5;
      if (unit.selected) {
        unitGraphics.rect(rx - b, ry - b, b * 2, b * 2).stroke({ width: 1.5, color: 0x55ff77 });
      }
      const hpRatio = Math.max(0, unit.hp / unit.maxHp);
      unitGraphics.rect(rx - b, ry - b - 6, b * 2, 4).fill({ color: 0x111111 });
      unitGraphics
        .rect(rx - b, ry - b - 6, b * 2 * hpRatio, 4)
        .fill({ color: isGDI ? 0x55ff77 : 0xff4444 });
    }
  }

  function drawProjectilesAndExplosions(alpha: number): void {
    projectileGraphics.clear();

    for (const proj of engine.projectiles.values()) {
      if (!engine.isWorldPosVisibleToPlayer(proj.x, proj.y)) continue;
      const rx = proj.prevX + (proj.x - proj.prevX) * alpha;
      const ry = proj.prevY + (proj.y - proj.prevY) * alpha;

      if (proj.style === 'BULLET') {
        projectileGraphics.circle(rx, ry, 2.5).fill({ color: 0xffee55 });
      } else if (proj.style === 'SHELL') {
        projectileGraphics.circle(rx, ry, 4.5).fill({ color: 0xffaa33 }).stroke({ width: 1, color: 0xffffff });
      } else if (proj.style === 'ROCKET') {
        projectileGraphics.circle(rx, ry, 4).fill({ color: 0xff4422 });
        projectileGraphics.circle(proj.prevX, proj.prevY, 3).fill({ color: 0xaaaaaa, alpha: 0.6 });
      }
    }

    for (const exp of engine.explosions) {
      if (!engine.isWorldPosVisibleToPlayer(exp.x, exp.y)) continue;
      const progress = exp.currentTick / exp.totalTicks;
      const radius = exp.maxRadius * (0.3 + 0.7 * progress);
      const fade = 1 - progress;
      projectileGraphics
        .circle(exp.x, exp.y, radius)
        .fill({ color: exp.color, alpha: fade * 0.55 })
        .stroke({ width: 2, color: 0xffffaa, alpha: fade });
    }
  }

  function drawFogOfWar(): void {
    fogGraphics.clear();
    if (!engine.fogEnabled) return;

    const { MAP_ROWS, MAP_COLS, TILE_SIZE } = GAME_CONFIG;
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        const state = engine.fogGrid[r][c];
        if (state === 0) {
          fogGraphics
            .rect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE)
            .fill({ color: 0x050705, alpha: 0.96 });
        } else if (state === 1) {
          fogGraphics
            .rect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE)
            .fill({ color: 0x080c08, alpha: 0.55 });
        }
      }
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
      const cx = (b.gridX + b.widthTiles / 2) * TILE_SIZE;
      const cy = (b.gridY + b.heightTiles / 2) * TILE_SIZE;
      placementGraphics
        .circle(cx, cy, BASE_ADJACENCY_TILES * TILE_SIZE)
        .stroke({ width: 1.5, color: 0x55ff77, alpha: 0.3 });
    }

    const worldPos = screenToWorld(mouseScreen.x, mouseScreen.y);
    const gx = Math.floor(worldPos.x / GAME_CONFIG.TILE_SIZE - w / 2 + 0.5);
    const gy = Math.floor(worldPos.y / GAME_CONFIG.TILE_SIZE - h / 2 + 0.5);
    const check = engine.validateBuildingPlacement(bType, gx, gy);

    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const tileValid = check.tileMatrix[dy][dx];
        const tx = (gx + dx) * TILE_SIZE;
        const ty = (gy + dy) * TILE_SIZE;
        placementGraphics
          .rect(tx + 2, ty + 2, TILE_SIZE - 4, TILE_SIZE - 4)
          .fill({ color: tileValid ? 0x33ff66 : 0xff3333, alpha: 0.45 })
          .stroke({ width: 1.5, color: tileValid ? 0x55ff77 : 0xff5555 });
      }
    }
  }

  // DOM Elements
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

    const mcvSelected = Array.from(engine.units.values()).some(
      (u) => u.ownerId === 1 && u.selected && u.type === 'MCV'
    );
    btnDeployMcv.disabled = !mcvSelected;
    btnAttackMove.classList.toggle('active-toggle', isAttackMoveMode);

    for (const [key, card] of cardElements.entries()) {
      const unlocked = engine.hasPrerequisites(key, 1);
      const reqEl = document.getElementById(`req-${key}`)!;
      if (unlocked) {
        card.classList.remove('locked');
        reqEl.textContent = '';
      } else {
        card.classList.add('locked');
        reqEl.textContent = `Req: ${CATALOG[key].prerequisites[CATALOG[key].prerequisites.length - 1]
          .replace('_', ' ')}`;
      }

      if (engine.buildingQueue?.readyToPlace && engine.buildingQueue.itemType === key) {
        card.classList.add('active-place');
      } else {
        card.classList.remove('active-place');
      }
    }

    if (engine.buildingQueue) {
      btnCancelBldg.style.display = 'inline-block';
      const pct = Math.floor(
        (engine.buildingQueue.completedTicks / engine.buildingQueue.totalTicks) * 100
      );
      elProgBldg.style.width = `${pct}%`;

      if (engine.buildingQueue.readyToPlace) {
        elStatusBldg.textContent = `${CATALOG[engine.buildingQueue.itemType].name}: CLICK MAP`;
        if (!wasBuildingReadyLastFrame) {
          isPlacementMode = true;
          wasBuildingReadyLastFrame = true;
        }
      } else {
        wasBuildingReadyLastFrame = false;
        elStatusBldg.textContent = engine.buildingQueue.onHold
          ? 'ON HOLD (NO FUNDS)'
          : `${CATALOG[engine.buildingQueue.itemType].name} (${pct}%)`;
      }
    } else {
      wasBuildingReadyLastFrame = false;
      btnCancelBldg.style.display = 'none';
      elStatusBldg.textContent = 'Idle';
      elProgBldg.style.width = '0%';
    }

    if (engine.unitQueue) {
      btnCancelUnit.style.display = 'inline-block';
      const pct = Math.floor(
        (engine.unitQueue.completedTicks / engine.unitQueue.totalTicks) * 100
      );
      elProgUnit.style.width = `${pct}%`;
      elStatusUnit.textContent = engine.unitQueue.onHold
        ? 'ON HOLD (NO FUNDS)'
        : `${CATALOG[engine.unitQueue.itemType].name} (${pct}%)`;
    } else {
      btnCancelUnit.style.display = 'none';
      elStatusUnit.textContent = 'Idle';
      elProgUnit.style.width = '0%';
    }

    // Victory / Defeat Overlay
    if (engine.matchStatus !== 'PLAYING') {
      matchOverlay.style.display = 'flex';
      if (engine.matchStatus === 'VICTORY') {
        matchTitle.textContent = 'GDI MISSION ACCOMPLISHED';
        matchTitle.style.color = '#55ff77';
        matchSubtitle.textContent =
          'All Brotherhood of Nod structures and forces in this sector have been neutralized.';
      } else {
        matchTitle.textContent = 'BROTHERHOOD OF NOD VICTORY';
        matchTitle.style.color = '#ff4444';
        matchSubtitle.textContent =
          'Your GDI expeditionary force was wiped out. Re-deploy and secure your perimeter early!';
      }
    }
  }

  // ============================================================================
  // MAIN FIXED-TIMESTEP ACCUMULATOR LOOP
  // ============================================================================
  let lastTime = performance.now();
  let accumulator = 0;

  app.ticker.add(() => {
    const now = performance.now();
    const frameDelta = Math.min(now - lastTime, 250);
    lastTime = now;
    accumulator += frameDelta;

    while (accumulator >= GAME_CONFIG.TICK_MS) {
      engine.stepSimulationTick();
      accumulator -= GAME_CONFIG.TICK_MS;
    }

    // Process synthesized audio & EVA events emitted during simulation ticks
    for (const ev of engine.consumeEvents()) {
      if (ev.sfx) audio.playSfx(ev.sfx);
      if (ev.evaSpeech) audio.speakEva(ev.evaSpeech);
    }

    // Camera Panning
    if (keysPressed.has('w') || keysPressed.has('arrowup')) camera.y += camera.panSpeed;
    if (keysPressed.has('s') || keysPressed.has('arrowdown')) camera.y -= camera.panSpeed;
    if (keysPressed.has('a') || keysPressed.has('arrowleft')) camera.x += camera.panSpeed;
    if (keysPressed.has('d') || keysPressed.has('arrowright')) camera.x -= camera.panSpeed;

    worldContainer.x = camera.x;
    worldContainer.y = camera.y;
    worldContainer.scale.set(camera.zoom);

    drawTiberiumPatches();
    drawBuildings();

    const alpha = accumulator / GAME_CONFIG.TICK_MS;
    unitGraphics.clear();

    if (orderMarker) {
      unitGraphics
        .circle(orderMarker.x, orderMarker.y, 15 * orderMarker.alpha)
        .stroke({ width: 2, color: orderMarker.color, alpha: orderMarker.alpha });
      orderMarker.alpha -= 0.04;
      if (orderMarker.alpha <= 0) orderMarker = null;
    }

    let selectedCount = 0;
    let harvesterCount = 0;
    let nodCount = 0;

    for (const unit of engine.units.values()) {
      if (unit.ownerId === 1) {
        if (unit.selected) selectedCount++;
        if (unit.type === 'HARVESTER') harvesterCount++;
      } else {
        nodCount++;
      }
      const renderX = unit.prevX + (unit.x - unit.prevX) * alpha;
      const renderY = unit.prevY + (unit.y - unit.prevY) * alpha;
      drawUnit(unit, renderX, renderY);
    }

    for (const b of engine.buildings.values()) {
      if (b.ownerId !== 1) nodCount++;
    }

    drawProjectilesAndExplosions(alpha);
    drawFogOfWar();
    drawPlacementPreview();
    renderRadarMinimap();

    uiOverlayGraphics.clear();
    if (selectionBox.active) {
      const x = Math.min(selectionBox.startX, selectionBox.currX);
      const y = Math.min(selectionBox.startY, selectionBox.currY);
      const w = Math.abs(selectionBox.currX - selectionBox.startX);
      const h = Math.abs(selectionBox.currY - selectionBox.startY);
      uiOverlayGraphics
        .rect(x, y, w, h)
        .fill({ color: 0x55ff77, alpha: 0.15 })
        .stroke({ width: 1.5, color: 0x55ff77 });
    }

    const waveSeconds = Math.ceil(engine.aiWaveCountdownTicks / GAME_CONFIG.TICK_RATE);
    elTick.textContent = String(engine.currentTick);
    elSelected.textContent = String(selectedCount);
    elHarvesters.textContent = String(harvesterCount);
    elEnemies.textContent = String(nodCount);
    elWave.textContent = `Next Wave: ${waveSeconds}s`;
    elCmd.textContent = engine.lastCommandText;
    syncSidebarUI();
  });
}

bootstrap();
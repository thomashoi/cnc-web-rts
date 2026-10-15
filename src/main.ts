import { Application, Container, Graphics } from 'pixi.js';
import { GameEngine } from './GameEngine';
import {
  BuildingEntity,
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
    backgroundColor: 0x141814,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  viewport.appendChild(app.canvas);
  app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const engine = new GameEngine();

  // Scene Graph Layers
  const worldContainer = new Container();
  const terrainGraphics = new Graphics();
  const tiberiumGraphics = new Graphics();
  const buildingGraphics = new Graphics();
  const unitGraphics = new Graphics();
  const placementGraphics = new Graphics();
  const uiOverlayGraphics = new Graphics();

  worldContainer.addChild(terrainGraphics);
  worldContainer.addChild(tiberiumGraphics);
  worldContainer.addChild(buildingGraphics);
  worldContainer.addChild(unitGraphics);
  worldContainer.addChild(placementGraphics);
  app.stage.addChild(worldContainer);
  app.stage.addChild(uiOverlayGraphics);

  // Camera & Mouse State
  const camera = {
    x: -140,
    y: -120,
    zoom: 1,
    panSpeed: 10,
    isMiddleDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
  };

  const mouseScreen = { x: 0, y: 0 };
  let isPlacementMode = false;

  const selectionBox = {
    active: false,
    startX: 0,
    startY: 0,
    currX: 0,
    currY: 0,
  };

  let moveOrderMarker: { x: number; y: number; alpha: number } | null = null;
  const controlGroups: Map<string, number[]> = new Map();
  const keysPressed: Set<string> = new Set();

  // Draw static map grid
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
  // SIDEBAR UI INITIALIZATION
  // ============================================================================
  const structureTypes: BuildingType[] = ['POWER_PLANT', 'REFINERY', 'BARRACKS', 'WAR_FACTORY'];
  const unitTypes: UnitType[] = ['LIGHT_INFANTRY', 'MEDIUM_TANK', 'HARVESTER', 'MCV'];

  const gridStructuresEl = document.getElementById('grid-structures')!;
  const gridUnitsEl = document.getElementById('grid-units')!;
  const btnDeployMcv = document.getElementById('btn-deploy-mcv') as HTMLButtonElement;
  const btnCancelBldg = document.getElementById('btn-cancel-bldg') as HTMLButtonElement;
  const btnCancelUnit = document.getElementById('btn-cancel-unit') as HTMLButtonElement;
  const placementBanner = document.getElementById('placement-banner')!;

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
      (u) => u.selected && u.type === 'MCV'
    );
    if (selectedMcv) {
      engine.issueCommand({ type: 'DEPLOY_MCV', unitId: selectedMcv.id });
    }
  });

  btnCancelBldg.addEventListener('click', () => {
    isPlacementMode = false;
    engine.issueCommand({ type: 'CANCEL_PRODUCTION', category: 'BUILDING' });
  });

  btnCancelUnit.addEventListener('click', () => {
    engine.issueCommand({ type: 'CANCEL_PRODUCTION', category: 'UNIT' });
  });

  // ============================================================================
  // CANVAS POINTER & KEYBOARD INPUT
  // ============================================================================
  app.canvas.addEventListener('dblclick', (e: MouseEvent) => {
    const rect = app.canvas.getBoundingClientRect();
    const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    for (const u of engine.units.values()) {
      if (u.type === 'MCV' && Math.hypot(u.x - worldPos.x, u.y - worldPos.y) <= u.radius + 8) {
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
      // If in Building Placement Mode, attempt to place on the grid
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

      // Otherwise begin standard green box selection
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
      // Right-click cancels placement preview if active
      if (isPlacementMode) {
        isPlacementMode = false;
        return;
      }

      const selectedUnits = Array.from(engine.units.values()).filter((u) => u.selected);
      if (selectedUnits.length === 0) return;

      const { TILE_SIZE } = GAME_CONFIG;
      const clickedGX = Math.floor(worldPos.x / TILE_SIZE);
      const clickedGY = Math.floor(worldPos.y / TILE_SIZE);

      // Check if right-clicking a Refinery or Tiberium patch with Harvesters selected
      const selectedHarvesterIds = selectedUnits
        .filter((u) => u.type === 'HARVESTER')
        .map((u) => u.id);

      if (selectedHarvesterIds.length > 0) {
        const clickedRefinery = Array.from(engine.buildings.values()).find(
          (b) =>
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
          moveOrderMarker = { x: worldPos.x, y: worldPos.y, alpha: 1.0 };
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
          moveOrderMarker = { x: worldPos.x, y: worldPos.y, alpha: 1.0 };
          return;
        }
      }

      // Standard Move Order
      engine.issueCommand({
        type: 'MOVE',
        unitIds: selectedUnits.map((u) => u.id),
        targetX: worldPos.x,
        targetY: worldPos.y,
      });
      moveOrderMarker = { x: worldPos.x, y: worldPos.y, alpha: 1.0 };
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

    // Hotkey 'D' deploys selected MCV
    if (key === 'd' && !e.ctrlKey && !e.metaKey) {
      const selectedMcv = Array.from(engine.units.values()).find(
        (u) => u.selected && u.type === 'MCV'
      );
      if (selectedMcv) {
        engine.issueCommand({ type: 'DEPLOY_MCV', unitId: selectedMcv.id });
      }
    }

    if (key === 'escape' && isPlacementMode) {
      isPlacementMode = false;
    }

    if (/^[1-9]$/.test(e.key)) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const ids = Array.from(engine.units.values())
          .filter((u) => u.selected)
          .map((u) => u.id);
        if (ids.length > 0) controlGroups.set(e.key, ids);
      } else {
        const groupIds = controlGroups.get(e.key);
        if (groupIds) {
          for (const unit of engine.units.values()) {
            unit.selected = groupIds.includes(unit.id);
          }
        }
      }
    }
  });

  window.addEventListener('keyup', (e: KeyboardEvent) => {
    keysPressed.delete(e.key.toLowerCase());
  });

  // ============================================================================
  // RENDERING HELPERS (TIBERIUM, STRUCTURES, UNITS, FOOTPRINT)
  // ============================================================================
  function drawTiberiumPatches(): void {
    tiberiumGraphics.clear();
    const { TILE_SIZE } = GAME_CONFIG;

    for (const patch of engine.tiberiumPatches) {
      if (patch.amount <= 0) continue;
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
      const x = b.gridX * TILE_SIZE;
      const y = b.gridY * TILE_SIZE;
      const w = b.widthTiles * TILE_SIZE;
      const h = b.heightTiles * TILE_SIZE;

      // Foundation pad
      buildingGraphics
        .rect(x + 3, y + 3, w - 6, h - 6)
        .fill({ color: 0x2c322c })
        .stroke({ width: 2, color: 0xd4af37 });

      if (b.type === 'CONSTRUCTION_YARD') {
        buildingGraphics.rect(x + 12, y + 12, w - 24, h - 24).fill({ color: 0x8f7224 });
        buildingGraphics.circle(x + w * 0.35, y + h * 0.35, 18).fill({ color: 0xd4af37 });
        buildingGraphics
          .moveTo(x + w * 0.35, y + h * 0.35)
          .lineTo(x + w * 0.78, y + h * 0.75)
          .stroke({ width: 6, color: 0xe6c34a });
      } else if (b.type === 'POWER_PLANT') {
        buildingGraphics.circle(x + w * 0.35, y + h * 0.5, 16).fill({ color: 0x4b594d });
        buildingGraphics.circle(x + w * 0.35, y + h * 0.5, 9).fill({ color: 0x55ff77 });
        buildingGraphics.rect(x + w * 0.6, y + 14, 18, h - 28).fill({ color: 0xc59b27 });
      } else if (b.type === 'REFINERY') {
        // Silo tanks + Bottom harvester unloading bay
        buildingGraphics.rect(x + 10, y + 10, w - 20, h * 0.55).fill({ color: 0x99792c });
        buildingGraphics.circle(x + 28, y + 28, 12).fill({ color: 0x2ee65f });
        buildingGraphics.circle(x + 58, y + 28, 12).fill({ color: 0x2ee65f });
        // Docking bay apron
        buildingGraphics
          .rect(x + w * 0.25, y + h * 0.62, w * 0.5, h * 0.33)
          .fill({ color: 0x1b241d })
          .stroke({ width: 1.5, color: 0x55ff77 });
      } else if (b.type === 'BARRACKS') {
        buildingGraphics.rect(x + 12, y + 12, w - 24, h - 24).fill({ color: 0x6e5c2b });
        buildingGraphics.circle(x + w / 2, y + h / 2, 12).fill({ color: 0xd4af37 });
      } else if (b.type === 'WAR_FACTORY') {
        buildingGraphics.rect(x + 8, y + 8, w - 16, h - 18).fill({ color: 0x7a6226 });
        // Factory roof stripes & roll-out bay door
        buildingGraphics.rect(x + 20, y + h - 18, w - 40, 12).fill({ color: 0xd4af37 });
      }

      // Building HP Bar
      const hpRatio = b.hp / b.maxHp;
      buildingGraphics.rect(x + 6, y - 7, w - 12, 4).fill({ color: 0x111111 });
      buildingGraphics.rect(x + 6, y - 7, (w - 12) * hpRatio, 4).fill({ color: 0x55ff77 });
    }
  }

  function drawUnit(unit: UnitEntity, rx: number, ry: number): void {
    const r = unit.radius;

    if (unit.selected && unit.targetX !== null && unit.targetY !== null) {
      unitGraphics
        .moveTo(rx, ry)
        .lineTo(unit.targetX, unit.targetY)
        .stroke({ width: 1, color: 0x55ff77, alpha: 0.45 });
    }

    if (unit.type === 'LIGHT_INFANTRY') {
      unitGraphics.circle(rx, ry, r).fill({ color: 0xd4af37 }).stroke({ width: 1.5, color: 0x111111 });
    } else if (unit.type === 'MEDIUM_TANK') {
      unitGraphics
        .rect(rx - r, ry - r * 0.8, r * 2, r * 1.6)
        .fill({ color: 0xd9a74a })
        .stroke({ width: 2, color: 0x222222 });
      unitGraphics.circle(rx, ry, r * 0.55).fill({ color: 0xb8862d }).stroke({ width: 1.5, color: 0x222222 });
      const bx = rx + Math.cos(unit.turretAngle) * (r * 1.25);
      const by = ry + Math.sin(unit.turretAngle) * (r * 1.25);
      unitGraphics.moveTo(rx, ry).lineTo(bx, by).stroke({ width: 4, color: 0x222222 });
    } else if (unit.type === 'HARVESTER') {
      unitGraphics
        .rect(rx - r, ry - r * 0.85, r * 2, r * 1.7)
        .fill({ color: 0xe6b800 })
        .stroke({ width: 2, color: 0x1f1f1f });

      // Harvester 5-pip Tiberium crystal load gauge
      const pips = 5;
      const filledPips = Math.round((unit.tiberiumLoad / unit.maxTiberiumLoad) * pips);
      for (let i = 0; i < pips; i++) {
        unitGraphics
          .rect(rx - r + 4 + i * 7, ry - 4, 5, 8)
          .fill({ color: i < filledPips ? 0x2ee65f : 0x2c352d });
      }

      // Active harvesting beam / unloading effect
      if (unit.harvesterState === 'HARVESTING') {
        unitGraphics.circle(rx, ry, r + 5).stroke({ width: 2, color: 0x4dff79, alpha: 0.7 });
      } else if (unit.harvesterState === 'UNLOADING') {
        unitGraphics.circle(rx, ry, r + 6).stroke({ width: 2, color: 0xffdd44, alpha: 0.85 });
      }
    } else if (unit.type === 'MCV') {
      unitGraphics
        .rect(rx - r, ry - r, r * 2, r * 2)
        .fill({ color: 0xe0aa3e })
        .stroke({ width: 2.5, color: 0x111111 });
      unitGraphics.circle(rx, ry, r * 0.5).fill({ color: 0x55ff77 });
    }

    if (unit.selected) {
      const b = r + 5;
      unitGraphics.rect(rx - b, ry - b, b * 2, b * 2).stroke({ width: 1.5, color: 0x55ff77 });
      const hpRatio = unit.hp / unit.maxHp;
      unitGraphics.rect(rx - b, ry - b - 6, b * 2, 4).fill({ color: 0x111111 });
      unitGraphics.rect(rx - b, ry - b - 6, b * 2 * hpRatio, 4).fill({ color: 0x55ff77 });
    }
  }

  function drawPlacementPreview(): void {
    placementGraphics.clear();

    // Auto-activate placement mode the moment a building finishes constructing
    if (!engine.buildingQueue?.readyToPlace) {
      isPlacementMode = false;
      placementBanner.style.display = 'none';
      return;
    }

    placementBanner.style.display = isPlacementMode ? 'block' : 'none';
    if (!isPlacementMode) return;

    const { TILE_SIZE, BASE_ADJACENCY_TILES } = GAME_CONFIG;
    const bType = engine.buildingQueue.itemType as BuildingType;
    const entry = CATALOG[bType];
    const w = entry.widthTiles ?? 2;
    const h = entry.heightTiles ?? 2;

    // Draw adjacency rings around existing friendly structures
    for (const b of engine.buildings.values()) {
      const cx = (b.gridX + b.widthTiles / 2) * TILE_SIZE;
      const cy = (b.gridY + b.heightTiles / 2) * TILE_SIZE;
      placementGraphics
        .circle(cx, cy, BASE_ADJACENCY_TILES * TILE_SIZE)
        .stroke({ width: 1.5, color: 0x55ff77, alpha: 0.3 });
    }

    const worldPos = screenToWorld(mouseScreen.x, mouseScreen.y);
    const gx = Math.floor(worldPos.x / TILE_SIZE - w / 2 + 0.5);
    const gy = Math.floor(worldPos.y / TILE_SIZE - h / 2 + 0.5);
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

  // DOM Elements for Telemetry & Sidebar Updates
  const elTick = document.getElementById('stat-tick')!;
  const elSelected = document.getElementById('stat-selected')!;
  const elHarvesters = document.getElementById('stat-harvesters')!;
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

    const power = engine.getPowerStats();
    elPowerText.textContent = `${power.produced} / ${power.consumed} MW`;
    const ratio = power.consumed === 0 ? 100 : Math.min(100, (power.produced / power.consumed) * 100);
    elPowerBar.style.width = `${ratio}%`;
    elPowerBar.style.backgroundColor = power.isLowPower ? '#ff4444' : '#55ff77';
    elEconRate.textContent = power.isLowPower ? 'LOW POWER (50% SPD)' : 'POWER NORMAL';
    elEconRate.style.color = power.isLowPower ? '#ff6666' : '#7a9a7e';

    // Enable MCV Deploy button if an MCV is selected
    const mcvSelected = Array.from(engine.units.values()).some(
      (u) => u.selected && u.type === 'MCV'
    );
    btnDeployMcv.disabled = !mcvSelected;

    // Update Prerequisite Locks on Cards
    for (const [key, card] of cardElements.entries()) {
      const unlocked = engine.hasPrerequisites(key);
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

    // Structure Queue Progress
    if (engine.buildingQueue) {
      btnCancelBldg.style.display = 'inline-block';
      const pct = Math.floor(
        (engine.buildingQueue.completedTicks / engine.buildingQueue.totalTicks) * 100
      );
      elProgBldg.style.width = `${pct}%`;

      if (engine.buildingQueue.readyToPlace) {
        elStatusBldg.textContent = `${CATALOG[engine.buildingQueue.itemType].name}: CLICK MAP TO PLACE`;
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

    // Unit Queue Progress
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

    if (moveOrderMarker) {
      unitGraphics
        .circle(moveOrderMarker.x, moveOrderMarker.y, 14 * moveOrderMarker.alpha)
        .stroke({ width: 2, color: 0x55ff77, alpha: moveOrderMarker.alpha });
      moveOrderMarker.alpha -= 0.04;
      if (moveOrderMarker.alpha <= 0) moveOrderMarker = null;
    }

    let selectedCount = 0;
    let harvesterCount = 0;
    for (const unit of engine.units.values()) {
      if (unit.selected) selectedCount++;
      if (unit.type === 'HARVESTER') harvesterCount++;
      const renderX = unit.prevX + (unit.x - unit.prevX) * alpha;
      const renderY = unit.prevY + (unit.y - unit.prevY) * alpha;
      drawUnit(unit, renderX, renderY);
    }

    drawPlacementPreview();

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

    elTick.textContent = String(engine.currentTick);
    elSelected.textContent = String(selectedCount);
    elHarvesters.textContent = String(harvesterCount);
    elCmd.textContent = engine.lastCommandText;
    syncSidebarUI();
  });
}

bootstrap();

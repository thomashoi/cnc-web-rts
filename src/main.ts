import { Application, Container, Graphics } from 'pixi.js';
import { GameEngine } from './GameEngine';
import { GAME_CONFIG, UnitEntity } from './types';

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

  // Scene graph layers
  const worldContainer = new Container();
  const terrainGraphics = new Graphics();
  const unitGraphics = new Graphics();
  const uiOverlayGraphics = new Graphics();

  worldContainer.addChild(terrainGraphics);
  worldContainer.addChild(unitGraphics);
  app.stage.addChild(worldContainer);
  app.stage.addChild(uiOverlayGraphics);

  // Camera state
  const camera = {
    x: -180,
    y: -140,
    zoom: 1,
    panSpeed: 10,
    isMiddleDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
  };

  // Selection Box state (Screen coordinates)
  const selectionBox = {
    active: false,
    startX: 0,
    startY: 0,
    currX: 0,
    currY: 0,
  };

  // Move order click feedback effect
  let moveOrderMarker: { x: number; y: number; alpha: number } | null = null;

  // Control groups (Ctrl + 1..9)
  const controlGroups: Map<string, number[]> = new Map();
  const keysPressed: Set<string> = new Set();

  // Pre-render static map grid and Tiberium crystals
  function drawStaticTerrain(): void {
    terrainGraphics.clear();
    const { MAP_COLS, MAP_ROWS, TILE_SIZE } = GAME_CONFIG;
    const totalW = MAP_COLS * TILE_SIZE;
    const totalH = MAP_ROWS * TILE_SIZE;

    // Ground fill
    terrainGraphics.rect(0, 0, totalW, totalH).fill({ color: 0x1e241b });

    // Grid lines
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

    // Tiberium crystal patches
    for (const patch of engine.tiberiumPatches) {
      const cx = patch.gridX * TILE_SIZE + TILE_SIZE / 2;
      const cy = patch.gridY * TILE_SIZE + TILE_SIZE / 2;
      terrainGraphics.circle(cx, cy, 14).fill({ color: 0x23c552, alpha: 0.35 });
      terrainGraphics.circle(cx - 5, cy - 4, 5).fill({ color: 0x4dff79 });
      terrainGraphics.circle(cx + 6, cy + 3, 4).fill({ color: 0x4dff79 });
      terrainGraphics.circle(cx - 2, cy + 6, 4).fill({ color: 0x2ee65f });
    }
  }

  drawStaticTerrain();

  // Helper: Convert Screen coordinates to World coordinates
  function screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - camera.x) / camera.zoom,
      y: (screenY - camera.y) / camera.zoom,
    };
  }

  // Mouse Input Handlers
  app.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    const rect = app.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (e.button === 0) {
      // Left Click: Begin box selection
      selectionBox.active = true;
      selectionBox.startX = sx;
      selectionBox.startY = sy;
      selectionBox.currX = sx;
      selectionBox.currY = sy;
    } else if (e.button === 1) {
      // Middle Click: Camera drag
      camera.isMiddleDragging = true;
      camera.lastMouseX = sx;
      camera.lastMouseY = sy;
    } else if (e.button === 2) {
      // Right Click: Issue Move Command to selected units
      const selectedIds = Array.from(engine.units.values())
        .filter((u) => u.selected)
        .map((u) => u.id);

      if (selectedIds.length > 0) {
        const worldPos = screenToWorld(sx, sy);
        engine.issueCommand({
          type: 'MOVE',
          unitIds: selectedIds,
          targetX: worldPos.x,
          targetY: worldPos.y,
        });
        moveOrderMarker = { x: worldPos.x, y: worldPos.y, alpha: 1.0 };
      }
    }
  });

  window.addEventListener('pointermove', (e: PointerEvent) => {
    const rect = app.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (selectionBox.active) {
      selectionBox.currX = sx;
      selectionBox.currY = sy;
    }

    if (camera.isMiddleDragging) {
      camera.x += sx - camera.lastMouseX;
      camera.y += sy - camera.lastMouseY;
      camera.lastMouseX = sx;
      camera.lastMouseY = sy;
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
          const dist = Math.hypot(unit.x - p1.x, unit.y - p1.y);
          if (dist <= unit.radius + 6) {
            unit.selected = true;
          }
        } else {
          if (unit.x >= p1.x && unit.x <= p2.x && unit.y >= p1.y && unit.y <= p2.y) {
            unit.selected = true;
          }
        }
      }
    } else if (e.button === 1) {
      camera.isMiddleDragging = false;
    }
  });

  // Mouse Wheel Zoom
  app.canvas.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      camera.zoom = Math.max(0.5, Math.min(2.0, camera.zoom * zoomFactor));
    },
    { passive: false }
  );

  // Keyboard Controls (WASD + Control Groups 1..9)
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    keysPressed.add(e.key.toLowerCase());

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

  // Draw individual unit with interpolated coordinates
  function drawUnit(unit: UnitEntity, rx: number, ry: number): void {
    const r = unit.radius;

    // 1. Target waypoint line if selected and moving
    if (unit.selected && unit.targetX !== null && unit.targetY !== null) {
      unitGraphics
        .moveTo(rx, ry)
        .lineTo(unit.targetX, unit.targetY)
        .stroke({ width: 1, color: 0x55ff77, alpha: 0.45 });
    }

    // 2. Unit body based on C&C archetype
    if (unit.type === 'LIGHT_INFANTRY') {
      unitGraphics.circle(rx, ry, r).fill({ color: 0xd4af37 }).stroke({ width: 1.5, color: 0x111111 });
    } else if (unit.type === 'MEDIUM_TANK') {
      unitGraphics
        .rect(rx - r, ry - r * 0.8, r * 2, r * 1.6)
        .fill({ color: 0xd9a74a })
        .stroke({ width: 2, color: 0x222222 });
      // Tank Turret + Barrel
      unitGraphics.circle(rx, ry, r * 0.55).fill({ color: 0xb8862d }).stroke({ width: 1.5, color: 0x222222 });
      const bx = rx + Math.cos(unit.turretAngle) * (r * 1.25);
      const by = ry + Math.sin(unit.turretAngle) * (r * 1.25);
      unitGraphics.moveTo(rx, ry).lineTo(bx, by).stroke({ width: 4, color: 0x222222 });
    } else if (unit.type === 'HARVESTER') {
      unitGraphics
        .rect(rx - r, ry - r * 0.85, r * 2, r * 1.7)
        .fill({ color: 0xe6b800 })
        .stroke({ width: 2, color: 0x1f1f1f });
      unitGraphics.rect(rx + r * 0.4, ry - r * 0.6, r * 0.5, r * 1.2).fill({ color: 0x2ee65f });
    } else if (unit.type === 'MCV') {
      unitGraphics
        .rect(rx - r, ry - r, r * 2, r * 2)
        .fill({ color: 0xe0aa3e })
        .stroke({ width: 2.5, color: 0x111111 });
      unitGraphics.circle(rx, ry, r * 0.5).fill({ color: 0x55ff77 });
    }

    // 3. Classic C&C Selection Brackets & Health Bar
    if (unit.selected) {
      const b = r + 5;
      unitGraphics
        .rect(rx - b, ry - b, b * 2, b * 2)
        .stroke({ width: 1.5, color: 0x55ff77 });

      // Top health bar
      const hpRatio = unit.hp / unit.maxHp;
      unitGraphics
        .rect(rx - b, ry - b - 6, b * 2, 4)
        .fill({ color: 0x111111 })
        .stroke({ width: 1, color: 0x000000 });
      unitGraphics
        .rect(rx - b, ry - b - 6, b * 2 * hpRatio, 4)
        .fill({ color: 0x55ff77 });
    }
  }

  // DOM HUD References
  const elTick = document.getElementById('stat-tick')!;
  const elSelected = document.getElementById('stat-selected')!;
  const elCmd = document.getElementById('stat-cmd')!;

  // Fixed-Timestep Accumulator Loop (20 Hz Simulation + 60+ FPS Render)
  let lastTime = performance.now();
  let accumulator = 0;

  app.ticker.add(() => {
    const now = performance.now();
    const frameDelta = Math.min(now - lastTime, 250);
    lastTime = now;
    accumulator += frameDelta;

    // 1. Run deterministic 20 Hz simulation steps
    while (accumulator >= GAME_CONFIG.TICK_MS) {
      engine.stepSimulationTick();
      accumulator -= GAME_CONFIG.TICK_MS;
    }

    // 2. Camera Keyboard Panning
    if (keysPressed.has('w') || keysPressed.has('arrowup')) camera.y += camera.panSpeed;
    if (keysPressed.has('s') || keysPressed.has('arrowdown')) camera.y -= camera.panSpeed;
    if (keysPressed.has('a') || keysPressed.has('arrowleft')) camera.x += camera.panSpeed;
    if (keysPressed.has('d') || keysPressed.has('arrowright')) camera.x -= camera.panSpeed;

    worldContainer.x = camera.x;
    worldContainer.y = camera.y;
    worldContainer.scale.set(camera.zoom);

    // 3. Interpolated Rendering (0.0 -> 1.0 alpha between tick N-1 and tick N)
    const alpha = accumulator / GAME_CONFIG.TICK_MS;
    unitGraphics.clear();

    // Draw right-click move order marker
    if (moveOrderMarker) {
      unitGraphics
        .circle(moveOrderMarker.x, moveOrderMarker.y, 14 * moveOrderMarker.alpha)
        .stroke({ width: 2, color: 0x55ff77, alpha: moveOrderMarker.alpha });
      moveOrderMarker.alpha -= 0.04;
      if (moveOrderMarker.alpha <= 0) moveOrderMarker = null;
    }

    let selectedCount = 0;
    for (const unit of engine.units.values()) {
      if (unit.selected) selectedCount++;
      const renderX = unit.prevX + (unit.x - unit.prevX) * alpha;
      const renderY = unit.prevY + (unit.y - unit.prevY) * alpha;
      drawUnit(unit, renderX, renderY);
    }

    // 4. Draw Green Selection Box on Screen Overlay
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

    // 5. Update Telemetry HUD
    elTick.textContent = String(engine.currentTick);
    elSelected.textContent = String(selectedCount);
    elCmd.textContent = engine.lastCommandText;
  });
}

bootstrap();

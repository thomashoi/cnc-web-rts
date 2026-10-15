# Command & Conquer: Web RTS - Agent & Developer Guide

## Overview
A web-based Command & Conquer style Real-Time Strategy (RTS) engine built using TypeScript, PixiJS v8, and Vite. The architecture implements a classic lockstep-ready RTS simulation loop decoupling the simulation tick from the rendering frame rate.

---

## Architecture Principles

### 1. Deterministic 20 Hz Simulation Loop
- **Tick Rate**: 20 Hz fixed timestep (`GAME_CONFIG.TICK_RATE = 20`, 50ms per tick).
- **Simulation Logic**: Located in `src/GameEngine.ts`.
- **Decoupled Render**: Handled in `src/main.ts` via an accumulator pattern on `app.ticker`. Units snapshot `prevX` and `prevY` at each tick and interpolate (`alpha = accumulator / TICK_MS`) during rendering to guarantee 60+ FPS smooth visuals regardless of display refresh rate.

### 2. Command Architecture
- Commands (`GameCommand`, `MoveCommand`) are queued for execution on future ticks (`tick: currentTick + 1`).
- Multi-unit movements calculate grid/box formation offsets so units travel to distinct, spaced positions rather than collapsing onto a single point.
- Flocking / Boids-style separation prevents overlapping units.

### 3. Rendering Pipeline (PixiJS v8)
- Scene graph is organized into layered containers:
  - `worldContainer`: Holds `terrainGraphics` (grid lines, terrain fill, Tiberium crystal patches) and `unitGraphics` (chassis, turrets, health bars, selection brackets, move markers).
  - `uiOverlayGraphics`: Dedicated screen-space layer for the selection drag box and HUD overlays.
- Viewport and camera support WASD / arrow panning, middle-mouse drag, and wheel zooming.

### 4. User Interface & Controls
- Classic EVA Command & Conquer sidebar layout.
- Controls:
  - **Left Click / Drag**: Unit selection / box selection.
  - **Shift + Click**: Additive selection.
  - **Right Click**: Issue Move order.
  - **WASD / Arrows / Middle Drag**: Pan camera.
  - **Scroll Wheel**: Camera zoom (clamped between 0.5x and 2.0x).
  - **Ctrl + 1..9**: Save control group.
  - **1..9**: Recall control group.

---

## Project Structure
```
cnc-web-rts/
├── AGENTS.md        # Architecture & developer reference
├── index.html       # HTML entry point with EVA sidebar and HUD
├── package.json     # Dependencies (PixiJS v8, Vite, TypeScript)
├── tsconfig.json    # TypeScript configuration
└── src/
    ├── types.ts      # Data types, commands, entities, and constants
    ├── GameEngine.ts # 20 Hz simulation engine & command processor
    └── main.ts       # PixiJS setup, render loop, input listeners
```

---

## Development Scripts
- `npm run dev`: Launch Vite development server with HMR.
- `npm run build`: Compile TypeScript and build production bundle.
- `npm run preview`: Preview production build locally.

# Command & Conquer Web RTS — Architecture Guidelines

## Core Engineering Rules
1. **Strict Separation of Simulation and Rendering:**
   - `src/GameEngine.ts` runs at a fixed 20 Hz (`GAME_CONFIG.TICK_MS = 50ms`).
   - Never mutate unit, building, or production state directly from DOM or PixiJS events. Always emit a serializable command via `engine.issueCommand(...)`.
2. **PixiJS v8 Standards:**
   - Use async `await app.init(...)` and v8 chainable `Graphics` methods (`rect().fill().stroke()`).
3. **Roadmap Status:**
   - [x] **Phase 1:** 20Hz Simulation Loop, Interpolated Renderer, Camera Pan/Zoom, Box Selection, Control Groups, Formation Move & Separation.
   - [x] **Phase 2:** MCV Deployment (`DEPLOY_MCV`), Grid Building Placement & Adjacency Validation (`PLACE_BUILDING`), Trickle-Drain Dual Sidebar Queues (`START_PRODUCTION`), Power Balance System, and Automated Harvester FSM.
   - [ ] **Phase 3 (Next):** Combat & Combined Arms (Target Acquisition, Turret Rotation, Ballistic Projectiles, Guard Towers/Obelisks, Armor vs. Warhead Damage Matrix, and Two-Layer Fog of War).
   - [ ] **Phase 4:** Skirmish AI Opponent, Radar Minimap, and Spatial EVA Audio.

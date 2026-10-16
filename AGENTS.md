# Command & Conquer Web RTS — Architecture Guidelines

## Core Engineering Rules
1. **Strict Separation of Simulation, Audio, and Rendering:**
   - `src/GameEngine.ts` runs at a fixed 20 Hz (`GAME_CONFIG.TICK_MS = 50ms`).
   - Never mutate unit, building, combat, or production state directly from DOM or PixiJS events. Always emit a serializable command via `engine.issueCommand(...)`.
   - Audio and EVA voice alerts are queued inside the simulation via `engine.pendingEvents` and consumed by `src/AudioSystem.ts` on the render frame.
2. **PixiJS v8 Standards:**
   - Use async `await app.init(...)` and v8 chainable `Graphics` methods (`rect().fill().stroke()`).
3. **Completed 4-Phase Roadmap:**
   - [x] **Phase 1:** 20Hz Simulation Loop, Interpolated Renderer, Camera Pan/Zoom, Box Selection, Control Groups, Formation Move & Separation.
   - [x] **Phase 2:** MCV Deployment (`DEPLOY_MCV`), Grid Building Placement & Adjacency Validation (`PLACE_BUILDING`), Trickle-Drain Dual Sidebar Queues (`START_PRODUCTION`), Power Balance System, and Automated Harvester FSM.
   - [x] **Phase 3:** Combined Arms Combat (`ATTACK`, `ATTACK_MOVE`), Armor vs. Warhead Damage Matrix (`SA`, `AP`, `HE`), Separate Hull/Turret Rotation, Ballistic Projectiles & Explosions, Guard Towers, Radar Dome, Rocket Soldiers, Two-Layer Fog of War, and Hostile Nod Outpost.
   - [x] **Phase 4:** Autonomous Nod Skirmish AI (Harvester economy + War Factory expansion + 45s timed attack waves), Interactive Tactical Minimap Radar (`#radar-canvas`), Web Audio API SFX Synthesizer & EVA Voice Announcer (`src/AudioSystem.ts`), and Victory/Defeat Skirmish Loop.
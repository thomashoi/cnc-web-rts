# Command & Conquer: Web RTS 🪖⚡

> *"Created my own Command & Conquer web-based real-time strategy game that I played when I was a kid!"*

A browser-based, high-performance **Command & Conquer** Real-Time Strategy (RTS) engine built from the ground up in modern **TypeScript**, **PixiJS v8**, and **Vite**. Features the classic GDI vs. Brotherhood of Nod skirmish experience with authentic retro visual styling, deterministic simulation, dynamic economy, tactical radar, and procedural audio synthesis.

---

## 🎮 Key Features

### ⚙️ Simulation & Architecture
- **20 Hz Deterministic Simulation Loop**: All gameplay logic, pathfinding, combat resolution, and state updates run on a fixed 50ms tick rate (`GAME_CONFIG.TICK_RATE = 20`).
- **60+ FPS Interpolated Renderer**: Decoupled rendering with sub-tick position interpolation (`alpha = accumulator / TICK_MS`) ensures fluid visuals regardless of display refresh rate.
- **Strict Command Pattern**: All unit orders and player actions are dispatched through serializable commands (`engine.issueCommand(...)`).
- **Collision & Separation**: Local boids-style separation and formation offset routing prevent unit clumping.

### 🏭 Economy & Base Building
- **MCV Deployment**: Deploy your Mobile Construction Vehicle (MCV) into a Construction Yard to unlock base structures.
- **Dual Production Queues**: Classic trickle-drain dual queues for simultaneous building construction and combat unit training.
- **Tiberium Harvesting Loop**: Fully automated Harvester FSM with Tiberium harvesting, dock pathfinding, and credit unloading.
- **Power Grid Management**: Balance Power Plants and energy consumption. Low power slows radar functionality and production rates.

### ⚔️ Tactical Combat & Skirmish AI
- **Combined Arms**: GDI strike forces (Minigunners, Rocket Soldiers, Medium Tanks, Harvesters, MCVs) vs. Brotherhood of Nod forces (Light Tanks, Buggies, Nod Infantry, Guard Towers).
- **Armor vs. Warhead Matrix**: Authentic damage calculations with Small Arms (`SA`), Armor Piercing (`AP`), and High Explosive (`HE`) profiles against unarmored, light, and heavy hulls.
- **Turret Tracking & Recoil**: Independent hull and turret rotation mechanics with dynamic kickback recoil animations upon firing.
- **Ballistic Projectiles & Explosions**: High-speed tank shells, arcing rockets with smoke trails, and hit impact explosions.
- **Autonomous Nod AI**: Fully automated Nod skirmish AI managing an independent Tiberium economy, base expansion, and timed attack waves.

### 🗺️ Visuals, Fog of War & Minimap
- **Two-Layer Fog of War**: Unexplored shroud (black) and explored fog of war with smooth bilinear filtering.
- **Dynamic Decal System**: Persistent shell crater decals and damage smoke trails.
- **Interactive Tactical Radar**: Real-time minimap with viewport camera frustum box, terrain visualization, unit blips, and click-to-pan navigation.

### 🔊 Procedural Audio & EVA Voice Alerts
- **Web Audio API SFX Synthesizer**: Zero-dependency procedural synthesis for machine gun fire, heavy tank cannons, missile launches, structural explosions, and harvester docking.
- **EVA Voice System**: Real-time synthesized Electronic Video Agent alerts (*"Unit ready"*, *"Building"*, *"Construction complete"*, *"New construction options"*, *"Enemy attack incoming"*).

---

## 🕹️ Controls & Hotkeys

| Action | Control |
| :--- | :--- |
| **Select Unit / Building** | `Left Click` |
| **Box Select** | `Click & Drag (Left Mouse)` |
| **Add / Remove Selection** | `Shift + Left Click` |
| **Issue Move / Attack / Harvest** | `Right Click` |
| **Deploy MCV** | `Select MCV` → Click **DEPLOY** (or `Right Click` on MCV) |
| **Pan Camera** | `W` `A` `S` `D` / `Arrow Keys` / `Middle Mouse Drag` |
| **Zoom Viewport** | `Mouse Wheel` (0.5× to 2.0×) |
| **Control Groups** | `Ctrl + 1..9` to save, `1..9` to recall |
| **Deselect All** | `Escape` |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** (v18.0.0 or higher recommended)
- **npm** (v9.0.0 or higher)

### Installation & Local Run

1. **Clone the repository:**
   ```bash
   git clone https://github.com/thomashoi/cnc-web-rts.git
   cd cnc-web-rts
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start local development server:**
   ```bash
   npm run dev
   ```
   Open your browser at `http://localhost:5173/`.  
   *(The server also exposes on your local network, e.g. `http://<your-lan-ip>:5173/`)*.

4. **Production Build:**
   ```bash
   npm run build
   ```
   Compiles static production assets to the `dist/` directory.

---

## 🌐 VPS Deployment

### Option A: Using Caddy (Recommended)

Caddy provides automatic zero-touch HTTPS / SSL certificates:

1. Build the production files on your VPS:
   ```bash
   cd /var/www/cnc-web-rts
   npm install
   npm run build
   ```

2. Add your domain/subdomain to `/etc/caddy/Caddyfile`:
   ```caddyfile
   cnc.yourdomain.com {
       root * /var/www/cnc-web-rts/dist
       encode gzip zstd
       try_files {path} /index.html
       file_server
   }
   ```

3. Reload Caddy:
   ```bash
   sudo systemctl reload caddy
   ```

---

### Option B: Using Nginx

1. Add a server block in `/etc/nginx/sites-available/cnc.yourdomain.com`:
   ```nginx
   server {
       listen 80;
       server_name cnc.yourdomain.com;
       root /var/www/cnc-web-rts/dist;
       index index.html;

       location / {
           try_files $uri $uri/ /index.html;
       }

       location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
           expires 30d;
           add_header Cache-Control "public, no-transform";
       }
   }
   ```

2. Link and restart:
   ```bash
   sudo ln -s /etc/nginx/sites-available/cnc.yourdomain.com /etc/nginx/sites-enabled/
   sudo systemctl restart nginx
   ```

---

## 🛠️ Tech Stack

- **Language**: [TypeScript](https://www.typescriptlang.org/) (Strict ES2022)
- **Rendering Engine**: [PixiJS v8](https://pixijs.com/) (WebGPU / WebGL2 auto-fallback)
- **Bundler & Tooling**: [Vite 6](https://vitejs.dev/)
- **Audio**: Web Audio API (Synthesizer & EVA Speech synthesis)
- **Styles**: Custom retro C&C green CRT / radar HUD styling

---

## 📜 License

MIT License. Command & Conquer is a registered trademark of Electronic Arts. This is a non-commercial educational fan recreation.

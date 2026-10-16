import { Assets, Texture } from 'pixi.js';
import { BuildingType, GAME_CONFIG, UnitType } from './types';

export class SpriteFactory {
  public terrainTiles: Texture[] = [];
  public crystalStages: Texture[] = [];
  public craterTexture!: Texture;
  public smokeTexture!: Texture;

  private unitHulls: Map<string, Texture> = new Map();
  private unitTurrets: Map<string, Texture> = new Map();
  private buildingBases: Map<string, Texture> = new Map();
  public guardTowerTurret!: Texture;
  public radarDishTexture!: Texture;

  /**
   * Initializes all procedural textures and optionally loads custom PNG overrides
   * from public/assets/ if present.
   */
  public async init(): Promise<void> {
    this.bakeTerrainTextures();
    this.bakeCrystalTextures();
    this.craterTexture = this.bakeCraterTexture();
    this.smokeTexture = this.bakeSmokeTexture();

    for (const ownerId of [1, 2]) {
      this.bakeUnitTexturesForOwner(ownerId);
      this.bakeBuildingTexturesForOwner(ownerId);
    }

    this.guardTowerTurret = this.bakeGuardTowerTurret();
    this.radarDishTexture = this.bakeRadarDish();
  }

  /**
   * Optional helper: call this to override any procedural key with a custom PNG
   * placed in public/assets/ (e.g. '/assets/units/medium_tank_hull.png').
   */
  public async tryLoadCustomTexture(url: string, fallback: Texture): Promise<Texture> {
    try {
      const tex = await Assets.load<Texture>(url);
      return tex ?? fallback;
    } catch {
      return fallback;
    }
  }

  public getUnitHull(type: UnitType, ownerId: number): Texture {
    return this.unitHulls.get(`${type}_${ownerId}`)!;
  }

  public getUnitTurret(type: UnitType, ownerId: number): Texture | null {
    return this.unitTurrets.get(`${type}_${ownerId}`) ?? null;
  }

  public getBuildingBase(type: BuildingType, ownerId: number): Texture {
    return this.buildingBases.get(`${type}_${ownerId}`)!;
  }

  private createCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    return [canvas, ctx];
  }

  private bakeTerrainTextures(): void {
    const s = GAME_CONFIG.TILE_SIZE;
    const palettes = [
      { bg: '#21271d', speck1: '#2a3225', speck2: '#181d15' },
      { bg: '#23291f', speck1: '#2d3527', speck2: '#1a2017' },
      { bg: '#1f251b', speck1: '#283023', speck2: '#161b13' },
    ];

    this.terrainTiles = palettes.map((pal, idx) => {
      const [canvas, ctx] = this.createCanvas(s, s);
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, s, s);

      // Deterministic grit & pebble noise
      for (let i = 0; i < 36; i++) {
        const px = ((i * 19 + idx * 7) % (s - 4)) + 2;
        const py = ((i * 31 + idx * 13) % (s - 4)) + 2;
        ctx.fillStyle = i % 2 === 0 ? pal.speck1 : pal.speck2;
        ctx.fillRect(px, py, i % 3 === 0 ? 3 : 2, 2);
      }

      // Subtle tactical grid border
      ctx.strokeStyle = 'rgba(55, 70, 50, 0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, s - 1, s - 1);

      return Texture.from(canvas);
    });
  }

  private bakeCrystalTextures(): void {
    const s = GAME_CONFIG.TILE_SIZE;
    // 4 stages: 25%, 50%, 75%, 100% density
    const counts = [3, 5, 8, 12];

    this.crystalStages = counts.map(( shardCount ) => {
      const [canvas, ctx] = this.createCanvas(s, s);
      const cx = s / 2;
      const cy = s / 2;

      // Ground radiation glow
      const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, s * 0.42);
      grad.addColorStop(0, 'rgba(46, 230, 95, 0.45)');
      grad.addColorStop(1, 'rgba(46, 230, 95, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
      ctx.fill();

      // Crystal shards
      for (let i = 0; i < shardCount; i++) {
        const angle = (i / shardCount) * Math.PI * 2;
        const dist = (i % 3) * 4 + 3;
        const sx = cx + Math.cos(angle) * dist;
        const sy = cy + Math.sin(angle) * dist;

        ctx.fillStyle = i % 2 === 0 ? '#2ee65f' : '#6bff95';
        ctx.beginPath();
        ctx.moveTo(sx, sy - 6);
        ctx.lineTo(sx + 4, sy + 2);
        ctx.lineTo(sx, sy + 5);
        ctx.lineTo(sx - 4, sy + 2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#0f3818';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      return Texture.from(canvas);
    });
  }

  private bakeCraterTexture(): Texture {
    const [canvas, ctx] = this.createCanvas(48, 48);
    const grad = ctx.createRadialGradient(24, 24, 3, 24, 24, 20);
    grad.addColorStop(0, 'rgba(8, 10, 8, 0.85)');
    grad.addColorStop(0.6, 'rgba(24, 26, 22, 0.55)');
    grad.addColorStop(1, 'rgba(24, 26, 22, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(24, 24, 20, 0, Math.PI * 2);
    ctx.fill();
    return Texture.from(canvas);
  }

  private bakeSmokeTexture(): Texture {
    const [canvas, ctx] = this.createCanvas(24, 24);
    const grad = ctx.createRadialGradient(12, 12, 2, 12, 12, 11);
    grad.addColorStop(0, 'rgba(60, 60, 60, 0.75)');
    grad.addColorStop(1, 'rgba(20, 20, 20, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(12, 12, 11, 0, Math.PI * 2);
    ctx.fill();
    return Texture.from(canvas);
  }

  private getFactionColors(ownerId: number) {
    return ownerId === 1
      ? { main: '#d9a74a', light: '#f2c96d', dark: '#8c6722', accent: '#55ff77' }
      : { main: '#c93434', light: '#ef5353', dark: '#731919', accent: '#ff4444' };
  }

  private bakeUnitTexturesForOwner(ownerId: number): void {
    const col = this.getFactionColors(ownerId);

    // 1. LIGHT INFANTRY (32x32)
    {
      const [c, ctx] = this.createCanvas(32, 32);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.arc(17, 18, 8, 0, Math.PI * 2);
      ctx.fill();

      // Shoulders
      ctx.fillStyle = col.dark;
      ctx.fillRect(10, 9, 10, 14);
      // Rifle
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(16, 18);
      ctx.lineTo(28, 18);
      ctx.stroke();
      // Helmet
      ctx.fillStyle = col.main;
      ctx.beginPath();
      ctx.arc(15, 16, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      this.unitHulls.set(`LIGHT_INFANTRY_${ownerId}`, Texture.from(c));
    }

    // 2. ROCKET SOLDIER (32x32)
    {
      const [c, ctx] = this.createCanvas(32, 32);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.arc(17, 18, 9, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = col.dark;
      ctx.fillRect(9, 8, 11, 16);
      // Heavy Rocket Launcher Tube on right shoulder
      ctx.fillStyle = '#4a524a';
      ctx.fillRect(8, 19, 21, 5);
      ctx.fillStyle = '#ff5522';
      ctx.fillRect(27, 19, 3, 5);

      ctx.fillStyle = col.light;
      ctx.beginPath();
      ctx.arc(15, 15, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      this.unitHulls.set(`ROCKET_SOLDIER_${ownerId}`, Texture.from(c));
    }

    // 3. MEDIUM TANK HULL (56x56) & TURRET (56x56)
    {
      const [c, ctx] = this.createCanvas(56, 56);
      // Drop shadow
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(12, 15, 36, 30);

      // Left & Right Treads
      ctx.fillStyle = '#222622';
      ctx.fillRect(9, 10, 38, 7);
      ctx.fillRect(9, 39, 38, 7);
      ctx.strokeStyle = '#3b423b';
      for (let x = 11; x < 45; x += 4) {
        ctx.strokeRect(x, 10, 2, 7);
        ctx.strokeRect(x, 39, 2, 7);
      }

      // Main Armored Hull
      ctx.fillStyle = col.main;
      ctx.fillRect(11, 15, 34, 26);
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(11, 15, 34, 26);

      // Rear Engine Deck Louvers & Front Glacis Highlight
      ctx.fillStyle = col.dark;
      ctx.fillRect(13, 18, 9, 20);
      ctx.fillStyle = col.light;
      ctx.fillRect(38, 17, 5, 22);

      this.unitHulls.set(`MEDIUM_TANK_${ownerId}`, Texture.from(c));

      // Tank Turret
      const [tc, tctx] = this.createCanvas(56, 56);
      // Twin / Heavy Cannon Barrel
      tctx.fillStyle = '#2b2b2b';
      tctx.fillRect(28, 25, 23, 6);
      tctx.fillStyle = '#555555';
      tctx.fillRect(47, 24, 5, 8);

      // Turret Housing
      tctx.fillStyle = col.dark;
      tctx.beginPath();
      tctx.arc(26, 28, 10, 0, Math.PI * 2);
      tctx.fill();
      tctx.strokeStyle = '#151515';
      tctx.lineWidth = 1.5;
      tctx.stroke();

      // Commander Hatch
      tctx.fillStyle = col.light;
      tctx.beginPath();
      tctx.arc(24, 28, 4.5, 0, Math.PI * 2);
      tctx.fill();

      this.unitTurrets.set(`MEDIUM_TANK_${ownerId}`, Texture.from(tc));
    }

    // 4. HARVESTER (60x60)
    {
      const [c, ctx] = this.createCanvas(60, 60);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(10, 14, 42, 36);

      // Heavy Treads
      ctx.fillStyle = '#1f241f';
      ctx.fillRect(8, 10, 40, 8);
      ctx.fillRect(8, 42, 40, 8);

      // Harvester Body & Ore Hopper
      ctx.fillStyle = col.main;
      ctx.fillRect(10, 15, 38, 30);
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(10, 15, 38, 30);

      // Front Tiberium Collector Claws
      ctx.fillStyle = '#384038';
      ctx.fillRect(46, 17, 7, 26);
      ctx.fillStyle = '#2ee65f';
      ctx.fillRect(48, 20, 4, 20);

      this.unitHulls.set(`HARVESTER_${ownerId}`, Texture.from(c));
    }

    // 5. MCV (64x64)
    {
      const [c, ctx] = this.createCanvas(64, 64);
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.fillRect(10, 12, 46, 44);

      ctx.fillStyle = col.dark;
      ctx.fillRect(8, 10, 46, 44);
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2;
      ctx.strokeRect(8, 10, 46, 44);

      // Crane Boom & ConYard Beacon
      ctx.fillStyle = col.light;
      ctx.fillRect(14, 16, 34, 12);
      ctx.fillStyle = col.accent;
      ctx.beginPath();
      ctx.arc(31, 38, 8, 0, Math.PI * 2);
      ctx.fill();

      this.unitHulls.set(`MCV_${ownerId}`, Texture.from(c));
    }
  }

  private bakeBuildingTexturesForOwner(ownerId: number): void {
    const col = this.getFactionColors(ownerId);
    const ts = GAME_CONFIG.TILE_SIZE;

    const specs: Array<{ type: BuildingType; w: number; h: number }> = [
      { type: 'CONSTRUCTION_YARD', w: 3, h: 3 },
      { type: 'POWER_PLANT', w: 2, h: 2 },
      { type: 'REFINERY', w: 3, h: 2 },
      { type: 'BARRACKS', w: 2, h: 2 },
      { type: 'WAR_FACTORY', w: 3, h: 2 },
      { type: 'GUARD_TOWER', w: 1, h: 1 },
      { type: 'RADAR_DOME', w: 2, h: 2 },
    ];

    for (const s of specs) {
      const pw = s.w * ts;
      const ph = s.h * ts;
      const [c, ctx] = this.createCanvas(pw, ph);

      // Concrete Foundation Pad + Bevel
      ctx.fillStyle = '#242924';
      ctx.fillRect(2, 2, pw - 4, ph - 4);
      ctx.strokeStyle = col.main;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(3, 3, pw - 6, ph - 6);

      if (s.type === 'CONSTRUCTION_YARD') {
        ctx.fillStyle = col.dark;
        ctx.fillRect(12, 12, pw - 24, ph - 24);
        // Assembly Crane & Helipad Cross
        ctx.strokeStyle = col.light;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(28, 28);
        ctx.lineTo(pw - 26, ph - 26);
        ctx.stroke();
        ctx.fillStyle = col.main;
        ctx.beginPath();
        ctx.arc(38, 38, 16, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.type === 'POWER_PLANT') {
        ctx.fillStyle = col.dark;
        ctx.fillRect(10, 10, pw - 20, ph - 20);
        // Twin Cooling Turbines
        for (const cx of [30, 66]) {
          ctx.fillStyle = '#182218';
          ctx.beginPath();
          ctx.arc(cx, ph / 2, 15, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#55ff77';
          ctx.beginPath();
          ctx.arc(cx, ph / 2, 8, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (s.type === 'REFINERY') {
        ctx.fillStyle = col.dark;
        ctx.fillRect(8, 8, pw - 16, ph * 0.56);
        // Storage Silos
        for (const sx of [30, 64, 98]) {
          ctx.fillStyle = '#333b33';
          ctx.beginPath();
          ctx.arc(sx, 28, 13, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#2ee65f';
          ctx.beginPath();
          ctx.arc(sx, 28, 7, 0, Math.PI * 2);
          ctx.fill();
        }
        // Harvester Unloading Apron
        ctx.fillStyle = '#161c16';
        ctx.fillRect(pw * 0.22, ph * 0.58, pw * 0.56, ph * 0.36);
        ctx.strokeStyle = '#55ff77';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(pw * 0.22, ph * 0.58, pw * 0.56, ph * 0.36);
      } else if (s.type === 'BARRACKS') {
        ctx.fillStyle = col.dark;
        ctx.fillRect(10, 10, pw - 20, ph - 20);
        ctx.fillStyle = col.light;
        ctx.fillRect(18, 16, pw - 36, 18);
        // Parade Ground Star
        ctx.fillStyle = col.accent;
        ctx.beginPath();
        ctx.arc(pw / 2, ph * 0.65, 10, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.type === 'WAR_FACTORY') {
        ctx.fillStyle = col.dark;
        ctx.fillRect(8, 8, pw - 16, ph - 16);
        // Sawtooth Factory Roof Bays
        ctx.fillStyle = col.main;
        for (let y = 14; y < ph - 26; y += 16) {
          ctx.fillRect(14, y, pw - 28, 10);
        }
        // Roll-out Bay Door
        ctx.fillStyle = '#d4af37';
        ctx.fillRect(24, ph - 18, pw - 48, 12);
      } else if (s.type === 'GUARD_TOWER') {
        ctx.fillStyle = col.dark;
        ctx.beginPath();
        ctx.arc(pw / 2, ph / 2, 16, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.type === 'RADAR_DOME') {
        ctx.fillStyle = col.dark;
        ctx.fillRect(10, 10, pw - 20, ph - 20);
        ctx.strokeStyle = '#55ff77';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pw / 2, ph / 2, 26, 0, Math.PI * 2);
        ctx.stroke();
      }

      this.buildingBases.set(`${s.type}_${ownerId}`, Texture.from(c));
    }
  }

  private bakeGuardTowerTurret(): Texture {
    const [c, ctx] = this.createCanvas(48, 48);
    ctx.fillStyle = '#dcdcdc';
    ctx.fillRect(24, 20, 19, 3);
    ctx.fillRect(24, 25, 19, 3);
    ctx.fillStyle = '#4a544a';
    ctx.beginPath();
    ctx.arc(24, 24, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    return Texture.from(c);
  }

  private bakeRadarDish(): Texture {
    const [c, ctx] = this.createCanvas(48, 48);
    ctx.fillStyle = '#1c3322';
    ctx.beginPath();
    ctx.ellipse(24, 24, 18, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#55ff77';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#55ff77';
    ctx.beginPath();
    ctx.arc(24, 24, 4, 0, Math.PI * 2);
    ctx.fill();
    return Texture.from(c);
  }
}
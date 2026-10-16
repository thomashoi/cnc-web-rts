import { Container, Sprite, Texture } from 'pixi.js';
import { GameEngine } from './GameEngine';
import { SpriteFactory } from './SpriteFactory';
import { GAME_CONFIG } from './types';

interface SmokeParticle {
  sprite: Sprite;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

export class VfxSystem {
  public decalContainer = new Container();
  public smokeContainer = new Container();
  public fogSprite: Sprite;

  private fogCanvas: HTMLCanvasElement;
  private fogCtx: CanvasRenderingContext2D;
  private fogTexture: Texture;

  private stampedExplosionIds: Set<number> = new Set();
  private craterSprites: Sprite[] = [];
  private smokeParticles: SmokeParticle[] = [];

  constructor(private sprites: SpriteFactory) {
    // 1. Setup Smooth Bilinear Fog of War Texture (40x40 scaled smoothly to 1920x1920)
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = GAME_CONFIG.MAP_COLS;
    this.fogCanvas.height = GAME_CONFIG.MAP_ROWS;
    this.fogCtx = this.fogCanvas.getContext('2d')!;

    this.fogTexture = Texture.from(this.fogCanvas);
    this.fogTexture.source.scaleMode = 'linear';

    this.fogSprite = new Sprite(this.fogTexture);
    this.fogSprite.width = GAME_CONFIG.MAP_COLS * GAME_CONFIG.TILE_SIZE;
    this.fogSprite.height = GAME_CONFIG.MAP_ROWS * GAME_CONFIG.TILE_SIZE;
  }

  public update(engine: GameEngine): void {
    this.updateSmoothFog(engine);
    this.updateCraterDecals(engine);
    this.updateDamageSmoke(engine);
  }

  private updateSmoothFog(engine: GameEngine): void {
    this.fogSprite.visible = engine.fogEnabled;
    if (!engine.fogEnabled) return;

    const { MAP_COLS, MAP_ROWS } = GAME_CONFIG;
    const imgData = this.fogCtx.createImageData(MAP_COLS, MAP_ROWS);
    const data = imgData.data;

    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        const idx = (r * MAP_COLS + c) * 4;
        const state = engine.fogGrid[r][c];
        data[idx] = 5;     // R
        data[idx + 1] = 8; // G
        data[idx + 2] = 5; // B
        // 0 = Unexplored Shroud (248 alpha), 1 = Explored Dimmed (140 alpha), 2 = Clear (0 alpha)
        data[idx + 3] = state === 0 ? 248 : state === 1 ? 140 : 0;
      }
    }

    this.fogCtx.putImageData(imgData, 0, 0);
    this.fogTexture.source.update();
  }

  private updateCraterDecals(engine: GameEngine): void {
    for (const exp of engine.explosions) {
      if (exp.maxRadius >= 16 && !this.stampedExplosionIds.has(exp.id)) {
        this.stampedExplosionIds.add(exp.id);

        const crater = new Sprite(this.sprites.craterTexture);
        crater.anchor.set(0.5);
        crater.x = exp.x;
        crater.y = exp.y;
        crater.rotation = (exp.id * 1.7) % (Math.PI * 2);
        const scale = exp.maxRadius / 22;
        crater.scale.set(scale);
        crater.alpha = 0.75;

        this.decalContainer.addChild(crater);
        this.craterSprites.push(crater);

        // Cap crater decals at 120 to keep GPU memory fixed
        if (this.craterSprites.length > 120) {
          const oldest = this.craterSprites.shift()!;
          this.decalContainer.removeChild(oldest);
          oldest.destroy();
        }
      }
    }
  }

  private updateDamageSmoke(engine: GameEngine): void {
    // Spawn smoke on damaged structures & vehicles (< 50% HP)
    if (Math.random() < 0.35) {
      for (const b of engine.buildings.values()) {
        if (b.hp / b.maxHp < 0.5) {
          const center = engine.getBuildingCenterWorldPos(b);
          if (engine.isWorldPosVisibleToPlayer(center.x, center.y)) {
            this.spawnSmokePuff(
              center.x + (Math.random() - 0.5) * 24,
              center.y + (Math.random() - 0.5) * 24
            );
          }
        }
      }
      for (const u of engine.units.values()) {
        if (u.hp / u.maxHp < 0.5 && engine.isWorldPosVisibleToPlayer(u.x, u.y)) {
          this.spawnSmokePuff(u.x, u.y);
        }
      }
    }

    // Step active smoke particles
    this.smokeParticles = this.smokeParticles.filter((p) => {
      p.life++;
      p.sprite.x += p.vx;
      p.sprite.y += p.vy;
      const ratio = p.life / p.maxLife;
      p.sprite.scale.set(0.5 + ratio * 1.1);
      p.sprite.alpha = (1 - ratio) * 0.65;

      if (p.life >= p.maxLife) {
        this.smokeContainer.removeChild(p.sprite);
        p.sprite.destroy();
        return false;
      }
      return true;
    });
  }

  private spawnSmokePuff(x: number, y: number): void {
    const sp = new Sprite(this.sprites.smokeTexture);
    sp.anchor.set(0.5);
    sp.x = x;
    sp.y = y;
    this.smokeContainer.addChild(sp);

    this.smokeParticles.push({
      sprite: sp,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -0.6 - Math.random() * 0.4,
      life: 0,
      maxLife: 38,
    });
  }

  public clearDecals(): void {
    for (const c of this.craterSprites) {
      this.decalContainer.removeChild(c);
      c.destroy();
    }
    this.craterSprites = [];
    this.stampedExplosionIds.clear();
  }
}
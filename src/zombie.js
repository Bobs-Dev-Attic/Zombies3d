// Zombie entities: several types, each a boxy 3D model with a shambling walk,
// simple chase AI, melee attacks, and (for spitters) ranged acid. Models are
// tagged so the game's raycasts can map any hit part back to its zombie and
// detect headshots.
import * as THREE from "three";
import { rand, chance, angleLerp, TAU } from "./util.js";

export const ZOMBIE_TYPES = {
  walker: { hp: 70,  speed: 2.0, radius: 0.55, dmg: 9,  attackCd: 1.0, scale: 1.0,  color: 0x5f7d4a, score: 100 },
  runner: { hp: 46,  speed: 4.7, radius: 0.48, dmg: 7,  attackCd: 0.8, scale: 0.9,  color: 0x7a6a3a, score: 150 },
  brute:  { hp: 260, speed: 1.6, radius: 0.9,  dmg: 22, attackCd: 1.3, scale: 1.55, color: 0x4a5a3a, score: 300 },
  spitter:{ hp: 55,  speed: 2.2, radius: 0.5,  dmg: 0,  attackCd: 2.2, scale: 0.95, color: 0x6a7a3a, score: 200, ranged: true, shootRange: 24 },
};

let SHARED = null;
function sharedGeo() {
  if (SHARED) return SHARED;
  SHARED = {
    head: new THREE.BoxGeometry(0.52, 0.5, 0.5),
    torso: new THREE.BoxGeometry(0.7, 0.85, 0.42),
    limb: new THREE.BoxGeometry(0.22, 0.75, 0.22),
    eye: new THREE.BoxGeometry(0.1, 0.1, 0.06),
  };
  return SHARED;
}

export class Zombie {
  constructor(type, x, z, wave) {
    const cfg = ZOMBIE_TYPES[type];
    this.type = type;
    this.cfg = cfg;
    // Health scales gently with wave depth.
    const hpMul = 1 + wave * 0.06;
    this.maxHp = cfg.hp * hpMul;
    this.hp = this.maxHp;
    this.speed = cfg.speed * (0.9 + rand(0, 0.25));
    this.radius = cfg.radius * cfg.scale;
    this.dmg = cfg.dmg;
    this.attackCd = cfg.attackCd;
    this.x = x; this.z = z;
    this.yaw = rand(0, TAU);
    this.dead = false;
    this.attackTimer = rand(0, 0.5);
    this.shootTimer = rand(1, 2.5);
    this.walkPhase = rand(0, TAU);
    this.knockX = 0; this.knockZ = 0;
    this.lunge = 0;
    this.hitFlash = 0;
    this._build();
  }

  _build() {
    const g = sharedGeo();
    const s = this.cfg.scale;
    const group = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: this.cfg.color, roughness: 0.95 });
    this.mat = skin;

    const torso = new THREE.Mesh(g.torso, skin);
    torso.position.y = 0.95; torso.castShadow = true; torso.userData.zombie = this;
    group.add(torso);

    const head = new THREE.Mesh(g.head, skin);
    head.position.y = 1.62; head.castShadow = true;
    head.userData.zombie = this; head.userData.isHead = true;
    group.add(head);
    this.headMesh = head;
    this.headY = 1.62 * s;

    // Glowing eyes.
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3322 });
    const eL = new THREE.Mesh(g.eye, eyeMat); eL.position.set(-0.12, 1.66, 0.26);
    const eR = new THREE.Mesh(g.eye, eyeMat); eR.position.set(0.12, 1.66, 0.26);
    group.add(eL, eR);

    // Arms (reach forward, shamble).
    this.armL = new THREE.Mesh(g.limb, skin);
    this.armR = new THREE.Mesh(g.limb, skin);
    for (const arm of [this.armL, this.armR]) { arm.castShadow = true; arm.userData.zombie = this; }
    this.armL.position.set(-0.46, 1.1, 0.15);
    this.armR.position.set(0.46, 1.1, 0.15);
    this.armL.rotation.x = this.armR.rotation.x = -1.1; // reaching out
    group.add(this.armL, this.armR);

    // Legs.
    this.legL = new THREE.Mesh(g.limb, skin);
    this.legR = new THREE.Mesh(g.limb, skin);
    for (const leg of [this.legL, this.legR]) { leg.castShadow = true; leg.userData.zombie = this; }
    this.legL.position.set(-0.18, 0.38, 0);
    this.legR.position.set(0.18, 0.38, 0);
    group.add(this.legL, this.legR);

    group.scale.setScalar(s);
    group.userData.zombie = this;
    group.position.set(this.x, 0, this.z);
    this.model = group;
    this.limp = chance(0.3) ? rand(0.6, 1) : 0;
  }

  // Apply damage; returns { died, headshot }. Knockback is a world-space impulse.
  hurt(amount, headshot, knockX = 0, knockZ = 0) {
    if (this.dead) return { died: false };
    this.hp -= amount;
    this.hitFlash = 1;
    this.knockX += knockX;
    this.knockZ += knockZ;
    if (this.hp <= 0) { this.dead = true; return { died: true, headshot }; }
    return { died: false, headshot };
  }

  update(dt, player, world, game) {
    if (this.dead) return;

    const dx = player.x - this.x;
    const dz = player.z - this.z;
    const distToPlayer = Math.hypot(dx, dz) || 1e-3;
    const targetYaw = Math.atan2(dx, -dz);
    this.yaw = angleLerp(this.yaw, targetYaw, Math.min(1, dt * 6));

    let moveX = 0, moveZ = 0;
    const reach = this.radius + player.radius + 0.3;

    if (this.cfg.ranged && distToPlayer < this.cfg.shootRange && distToPlayer > 6) {
      // Spitter holds range and lobs acid.
      this.shootTimer -= dt;
      if (this.shootTimer <= 0) {
        this.shootTimer = this.attackCd + rand(0, 0.8);
        game.spawnAcid(this, player);
      }
      // Gentle strafe / keep distance.
      if (distToPlayer < 12) { moveX = -dx / distToPlayer; moveZ = -dz / distToPlayer; }
    } else if (distToPlayer > reach) {
      moveX = dx / distToPlayer;
      moveZ = dz / distToPlayer;
    } else {
      // In melee range — attack.
      this.attackTimer -= dt;
      if (this.attackTimer <= 0 && this.dmg > 0) {
        this.attackTimer = this.attackCd;
        this.lunge = 1;
        player.damage(this.dmg);
        game.onPlayerHit();
      }
    }

    // Separation from other zombies is handled coarsely by world.resolve on
    // overlap with the player; here we just apply movement + knockback.
    let vx = moveX * this.speed;
    let vz = moveZ * this.speed;
    vx += this.knockX; vz += this.knockZ;
    this.knockX *= Math.exp(-8 * dt);
    this.knockZ *= Math.exp(-8 * dt);

    const nx = this.x + vx * dt;
    const nz = this.z + vz * dt;
    const r = world.resolve(nx, nz, this.radius);
    this.x = r.x; this.z = r.z;

    // Occasional groan.
    if (chance(dt * 0.25)) game.sfx.play(this.cfg.ranged ? "hiss" : "groan");

    this._animate(dt, Math.hypot(moveX, moveZ));
  }

  _animate(dt, moving) {
    this.walkPhase += dt * (4 + this.speed) * (moving > 0.01 ? 1 : 0.15);
    const swing = Math.sin(this.walkPhase) * (moving > 0.01 ? 0.7 : 0.1);
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing - this.limp * 0.3;
    // Arms sway a bit around their reach.
    this.armL.rotation.z = Math.sin(this.walkPhase + 1) * 0.15;
    this.armR.rotation.z = -Math.sin(this.walkPhase + 1) * 0.15;

    if (this.lunge > 0) {
      this.lunge = Math.max(0, this.lunge - dt * 4);
      const l = this.lunge;
      this.armL.rotation.x = -1.1 - l * 0.6;
      this.armR.rotation.x = -1.1 - l * 0.6;
    } else {
      this.armL.rotation.x = -1.1; this.armR.rotation.x = -1.1;
    }

    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
      this.mat.emissive = this.mat.emissive || new THREE.Color();
      this.mat.emissive.setRGB(this.hitFlash * 0.9, 0, 0);
    }

    this.model.position.set(this.x, 0, this.z);
    this.model.rotation.y = this.yaw;
  }

  dispose(scene) {
    if (this.model && this.model.parent) this.model.parent.remove(this.model);
  }
}

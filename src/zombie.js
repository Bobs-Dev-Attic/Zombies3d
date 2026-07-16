// Zombie entities: several types, each an anatomically-jointed 3D model with a
// shambling walk, simple chase AI, melee attacks, and (for spitters) ranged
// acid. Models are tagged so the game's raycasts can map any hit part back to
// its zombie and detect headshots.
import * as THREE from "three";
import { rand, chance, angleLerp, TAU } from "./util.js";

export const ZOMBIE_TYPES = {
  walker: { hp: 70,  speed: 2.0, radius: 0.55, dmg: 9,  attackCd: 1.0, scale: 1.0,  color: 0x5f7d4a, score: 100 },
  runner: { hp: 46,  speed: 4.7, radius: 0.48, dmg: 7,  attackCd: 0.8, scale: 0.9,  color: 0x7a6a3a, score: 150 },
  brute:  { hp: 260, speed: 1.6, radius: 0.9,  dmg: 22, attackCd: 1.3, scale: 1.55, color: 0x4a5a3a, score: 300 },
  spitter:{ hp: 55,  speed: 2.2, radius: 0.5,  dmg: 0,  attackCd: 2.2, scale: 0.95, color: 0x6a7a3a, score: 200, ranged: true, shootRange: 24 },
};

// Shared geometry, built once and reused across every zombie for cheap detail.
let SHARED = null;
function sharedGeo() {
  if (SHARED) return SHARED;
  SHARED = {
    head: new THREE.SphereGeometry(0.24, 10, 8),
    jaw: new THREE.BoxGeometry(0.3, 0.13, 0.28),
    neck: new THREE.CylinderGeometry(0.1, 0.12, 0.16, 8),
    chest: new THREE.BoxGeometry(0.62, 0.56, 0.34),
    pelvis: new THREE.BoxGeometry(0.5, 0.32, 0.3),
    shoulder: new THREE.SphereGeometry(0.15, 8, 6),
    upperArm: new THREE.CylinderGeometry(0.1, 0.085, 0.42, 8),
    foreArm: new THREE.CylinderGeometry(0.085, 0.07, 0.4, 8),
    hand: new THREE.BoxGeometry(0.13, 0.15, 0.11),
    thigh: new THREE.CylinderGeometry(0.14, 0.11, 0.44, 8),
    shin: new THREE.CylinderGeometry(0.1, 0.08, 0.42, 8),
    foot: new THREE.BoxGeometry(0.17, 0.13, 0.34),
    eye: new THREE.BoxGeometry(0.08, 0.08, 0.05),
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
    const tag = (mesh) => { mesh.castShadow = true; mesh.userData.zombie = this; return mesh; };

    // Torso: pelvis + a slightly hunched chest.
    const pelvis = tag(new THREE.Mesh(g.pelvis, skin)); pelvis.position.y = 0.95; group.add(pelvis);
    const chest = tag(new THREE.Mesh(g.chest, skin)); chest.position.set(0, 1.3, 0); chest.rotation.x = -0.14; group.add(chest);

    // Shoulders.
    const shL = tag(new THREE.Mesh(g.shoulder, skin)); shL.position.set(-0.37, 1.5, 0); group.add(shL);
    const shR = tag(new THREE.Mesh(g.shoulder, skin)); shR.position.set(0.37, 1.5, 0); group.add(shR);

    // Neck, head + jaw (both count as headshot targets).
    const neck = tag(new THREE.Mesh(g.neck, skin)); neck.position.set(0, 1.58, 0.02); neck.rotation.x = 0.18; group.add(neck);
    const head = tag(new THREE.Mesh(g.head, skin)); head.position.set(0, 1.74, 0.05); head.userData.isHead = true; group.add(head);
    const jaw = tag(new THREE.Mesh(g.jaw, skin)); jaw.position.set(0, 1.63, 0.12); jaw.userData.isHead = true; group.add(jaw);
    this.headMesh = head;
    this.headY = 1.74 * s;

    // Glowing eyes.
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3322 });
    const eL = new THREE.Mesh(g.eye, eyeMat); eL.position.set(-0.1, 1.78, 0.22); group.add(eL);
    const eR = new THREE.Mesh(g.eye, eyeMat); eR.position.set(0.1, 1.78, 0.22); group.add(eR);

    // Arms: shoulder pivot → upper arm → elbow → forearm + hand, reaching out.
    const makeArm = (side) => {
      const grp = new THREE.Group();
      grp.position.set(side * 0.37, 1.5, 0);
      const upper = tag(new THREE.Mesh(g.upperArm, skin)); upper.position.y = -0.2; grp.add(upper);
      const elbow = new THREE.Group(); elbow.position.y = -0.42; grp.add(elbow);
      const fore = tag(new THREE.Mesh(g.foreArm, skin)); fore.position.y = -0.2; elbow.add(fore);
      const hand = tag(new THREE.Mesh(g.hand, skin)); hand.position.y = -0.44; elbow.add(hand);
      grp.rotation.x = -1.35;   // reach forward
      elbow.rotation.x = -0.35; // slight bend at the elbow
      grp.userData.elbow = elbow;
      group.add(grp);
      return grp;
    };
    this.armL = makeArm(-1);
    this.armR = makeArm(1);

    // Legs: hip pivot → thigh → knee → shin + foot.
    const makeLeg = (side) => {
      const grp = new THREE.Group();
      grp.position.set(side * 0.16, 0.95, 0);
      const thigh = tag(new THREE.Mesh(g.thigh, skin)); thigh.position.y = -0.22; grp.add(thigh);
      const knee = new THREE.Group(); knee.position.y = -0.44; grp.add(knee);
      const shin = tag(new THREE.Mesh(g.shin, skin)); shin.position.y = -0.21; knee.add(shin);
      const foot = tag(new THREE.Mesh(g.foot, skin)); foot.position.set(0, -0.43, 0.08); knee.add(foot);
      grp.userData.knee = knee;
      group.add(grp);
      return grp;
    };
    this.legL = makeLeg(-1);
    this.legR = makeLeg(1);

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

    let vx = moveX * this.speed;
    let vz = moveZ * this.speed;
    vx += this.knockX; vz += this.knockZ;
    this.knockX *= Math.exp(-8 * dt);
    this.knockZ *= Math.exp(-8 * dt);

    const nx = this.x + vx * dt;
    const nz = this.z + vz * dt;
    const r = world.resolve(nx, nz, this.radius);
    this.x = r.x; this.z = r.z;

    if (chance(dt * 0.25)) game.sfx.play(this.cfg.ranged ? "hiss" : "groan");

    this._animate(dt, Math.hypot(moveX, moveZ));
  }

  _animate(dt, moving) {
    this.walkPhase += dt * (4 + this.speed) * (moving > 0.01 ? 1 : 0.15);
    const swing = Math.sin(this.walkPhase) * (moving > 0.01 ? 0.7 : 0.08);

    // Legs swing at the hips and bend at the knees on the trailing leg.
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing - this.limp * 0.3;
    const kneeL = this.legL.userData.knee, kneeR = this.legR.userData.knee;
    if (kneeL) kneeL.rotation.x = Math.max(0, -swing) * 1.1 + 0.12;
    if (kneeR) kneeR.rotation.x = Math.max(0, swing) * 1.1 + 0.12;

    // Arms sway a little around their forward reach.
    const armSwing = Math.sin(this.walkPhase + Math.PI) * (moving > 0.01 ? 0.25 : 0.05);
    this.armL.rotation.x = -1.35 + armSwing;
    this.armR.rotation.x = -1.35 - armSwing;
    this.armL.rotation.z = Math.sin(this.walkPhase) * 0.07;
    this.armR.rotation.z = -Math.sin(this.walkPhase) * 0.07;

    if (this.lunge > 0) {
      this.lunge = Math.max(0, this.lunge - dt * 4);
      const l = this.lunge;
      this.armL.rotation.x = -1.35 - l * 0.7;
      this.armR.rotation.x = -1.35 - l * 0.7;
    }

    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
      this.mat.emissive.setRGB(this.hitFlash * 0.9, 0, 0);
    }

    this.model.position.set(this.x, 0, this.z);
    this.model.rotation.y = this.yaw;
  }

  dispose(scene) {
    if (this.model && this.model.parent) this.model.parent.remove(this.model);
  }
}

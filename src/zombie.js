// Zombie entities: several types, each an anatomically-jointed 3D model that
// varies per-instance in height, girth, gait and injuries — some are
// disfigured with their guts hanging out, some drag a ruined leg, and the
// worst haul themselves along the ground with no legs at all. Models are
// tagged so the game's raycasts map any hit part back to its zombie and detect
// headshots.
import * as THREE from "three";
import { rand, chance, angleLerp, TAU, clamp } from "./util.js";

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
    neck: new THREE.CylinderGeometry(0.11, 0.13, 0.26, 8),
    chest: new THREE.BoxGeometry(0.62, 0.56, 0.34),
    pelvis: new THREE.BoxGeometry(0.5, 0.32, 0.3),
    shoulder: new THREE.SphereGeometry(0.15, 8, 6),
    upperArm: new THREE.CylinderGeometry(0.1, 0.085, 0.42, 8),
    foreArm: new THREE.CylinderGeometry(0.085, 0.07, 0.4, 8),
    hand: new THREE.BoxGeometry(0.13, 0.15, 0.11),
    thigh: new THREE.CylinderGeometry(0.14, 0.11, 0.44, 8),
    shin: new THREE.CylinderGeometry(0.1, 0.08, 0.42, 8),
    foot: new THREE.BoxGeometry(0.17, 0.13, 0.34),
    stump: new THREE.CylinderGeometry(0.14, 0.09, 0.26, 8),
    eye: new THREE.BoxGeometry(0.08, 0.08, 0.05),
    gut: new THREE.SphereGeometry(0.08, 6, 5),
  };
  return SHARED;
}

export class Zombie {
  constructor(type, x, z, wave) {
    const cfg = ZOMBIE_TYPES[type];
    this.type = type;
    this.cfg = cfg;
    this.prof = this._makeProfile();

    const hpMul = 1 + wave * 0.06;
    this.maxHp = cfg.hp * hpMul;
    this.hp = this.maxHp;
    this.speed = cfg.speed * (0.9 + rand(0, 0.25)) * this.prof.speedMul;
    this.radius = cfg.radius * cfg.scale * (this.prof.crawl ? 0.8 : this.prof.widthMul);
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

  // Per-instance body / gait / injury profile — this is what makes every
  // zombie in the horde read differently.
  _makeProfile() {
    const t = this.type;
    const canMaim = t === "walker" || t === "spitter"; // runners/brutes keep both legs
    let legs = 2;
    if (canMaim) { const r = Math.random(); legs = r < 0.1 ? 0 : r < 0.24 ? 1 : 2; }
    return {
      legs,
      legSide: chance(0.5) ? 1 : -1,   // which leg survives when legs === 1
      heightMul: rand(0.82, 1.22),
      widthMul: rand(0.85, 1.2),
      guts: chance(0.34),
      headTilt: rand(-0.4, 0.4),
      missingEye: chance(0.18),
      jawOpen: chance(0.4) ? rand(0.15, 0.45) : 0,
      hunch: rand(0.05, 0.34),
      strideAmp: rand(0.45, 0.95),
      armAmp: rand(0.1, 0.42),
      armReachL: rand(-1.55, -0.95),
      armReachR: rand(-1.55, -0.95),
      armLenL: rand(0.85, 1.12),
      armLenR: rand(0.85, 1.12),
      limp: (legs === 2 && chance(0.35)) ? rand(0.4, 1) : 0,
      phaseSpeed: rand(0.8, 1.35),
      speedMul: legs === 0 ? 0.5 : legs === 1 ? 0.66 : rand(0.9, 1.1),
      crawl: legs === 0,
    };
  }

  _build() {
    const g = sharedGeo();
    const p = this.prof;
    const s = this.cfg.scale;
    const root = new THREE.Group();       // handles world position + yaw
    const body = new THREE.Group();       // handles crawl tilt + per-instance scale
    root.add(body);
    const skin = new THREE.MeshStandardMaterial({ color: this.cfg.color, roughness: 0.95 });
    this.mat = skin;
    const gore = new THREE.MeshStandardMaterial({ color: 0x7a1414, roughness: 0.7 });
    const tag = (mesh) => { mesh.castShadow = true; mesh.userData.zombie = this; return mesh; };

    // Torso: pelvis + a hunched chest.
    const pelvis = tag(new THREE.Mesh(g.pelvis, skin)); pelvis.position.y = 0.95; body.add(pelvis);
    const chest = tag(new THREE.Mesh(g.chest, skin)); chest.position.set(0, 1.3, 0); chest.rotation.x = -p.hunch; body.add(chest);

    // Shoulders.
    const shL = tag(new THREE.Mesh(g.shoulder, skin)); shL.position.set(-0.37, 1.5, 0); body.add(shL);
    const shR = tag(new THREE.Mesh(g.shoulder, skin)); shR.position.set(0.37, 1.5, 0); body.add(shR);

    // Exposed neck, head + jaw (both count as headshot targets).
    const neck = tag(new THREE.Mesh(g.neck, skin)); neck.position.set(0, 1.55, 0.01); neck.rotation.x = 0.16 + p.hunch * 0.5; body.add(neck);
    const head = tag(new THREE.Mesh(g.head, skin)); head.position.set(0, 1.74, 0.05); head.rotation.z = p.headTilt; head.userData.isHead = true; body.add(head);
    const jaw = tag(new THREE.Mesh(g.jaw, skin)); jaw.position.set(0, 1.63 - p.jawOpen * 0.06, 0.12); jaw.rotation.x = p.jawOpen; jaw.userData.isHead = true; body.add(jaw);
    this.headMesh = head;

    // Glowing eyes (one may be missing).
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3322 });
    const eL = new THREE.Mesh(g.eye, eyeMat); eL.position.set(-0.1, 1.78, 0.22);
    const eR = new THREE.Mesh(g.eye, eyeMat); eR.position.set(0.1, 1.78, 0.22);
    eL.rotation.z = eR.rotation.z = p.headTilt;
    if (p.missingEye) (chance(0.5) ? eL : eR).visible = false;
    body.add(eL, eR);

    // Hanging guts — a cluster of entrails dangling from a torn abdomen.
    if (p.guts) {
      const guts = new THREE.Group();
      guts.position.set(rand(-0.12, 0.12), 0.92, 0.2);
      const n = 3 + (Math.random() * 3 | 0);
      for (let i = 0; i < n; i++) {
        const strand = new THREE.Group();
        strand.position.set(rand(-0.14, 0.14), 0, 0);
        const links = 2 + (Math.random() * 2 | 0);
        for (let j = 0; j < links; j++) {
          const bead = tag(new THREE.Mesh(g.gut, gore));
          bead.position.y = -0.08 - j * 0.11;
          bead.scale.set(1, rand(1.1, 1.6), 1);
          strand.add(bead);
        }
        strand.rotation.x = rand(-0.2, 0.2);
        guts.add(strand);
      }
      body.add(guts);
      this.guts = guts;
    }

    // Arms: shoulder pivot → upper arm → elbow → forearm + hand.
    const makeArm = (side, reach, len) => {
      const grp = new THREE.Group();
      grp.position.set(side * 0.37, 1.5, 0);
      const upper = tag(new THREE.Mesh(g.upperArm, skin)); upper.position.y = -0.2 * len; upper.scale.y = len; grp.add(upper);
      const elbow = new THREE.Group(); elbow.position.y = -0.42 * len; grp.add(elbow);
      const fore = tag(new THREE.Mesh(g.foreArm, skin)); fore.position.y = -0.2 * len; fore.scale.y = len; elbow.add(fore);
      const hand = tag(new THREE.Mesh(g.hand, skin)); hand.position.y = -0.44 * len; elbow.add(hand);
      grp.rotation.x = reach;
      elbow.rotation.x = -0.35;
      grp.userData.elbow = elbow;
      body.add(grp);
      return grp;
    };
    this.armL = makeArm(-1, p.armReachL, p.armLenL);
    this.armR = makeArm(1, p.armReachR, p.armLenR);

    // Legs: full leg, or a severed stump.
    const makeLeg = (side) => {
      const grp = new THREE.Group();
      grp.position.set(side * 0.16, 0.95, 0);
      const thigh = tag(new THREE.Mesh(g.thigh, skin)); thigh.position.y = -0.22; grp.add(thigh);
      const knee = new THREE.Group(); knee.position.y = -0.44; grp.add(knee);
      const shin = tag(new THREE.Mesh(g.shin, skin)); shin.position.y = -0.21; knee.add(shin);
      const foot = tag(new THREE.Mesh(g.foot, skin)); foot.position.set(0, -0.43, 0.08); knee.add(foot);
      grp.userData.knee = knee;
      body.add(grp);
      return grp;
    };
    const makeStump = (side) => {
      const grp = new THREE.Group();
      grp.position.set(side * 0.16, 0.95, 0);
      const st = tag(new THREE.Mesh(g.stump, gore)); st.position.y = -0.13; grp.add(st);
      body.add(grp);
      return grp;
    };

    this.legL = this.legR = null;
    if (p.legs === 2) {
      this.legL = makeLeg(-1); this.legR = makeLeg(1);
    } else if (p.legs === 1) {
      const good = makeLeg(p.legSide);
      const stump = makeStump(-p.legSide);
      if (p.legSide < 0) { this.legL = good; this.legR = stump; }
      else { this.legR = good; this.legL = stump; }
      this._oneLeg = good;
    } else {
      // Legless crawler: two hip stumps, body pitched forward onto the ground.
      makeStump(-1); makeStump(1);
    }

    // Per-instance size (non-uniform → some are lanky, some squat/disfigured).
    body.scale.set(p.widthMul, p.heightMul, p.widthMul);

    if (p.crawl) {
      body.rotation.x = -1.3;      // pitch prone
      body.position.y = 0.12;
      this.headY = 0.55 * s;
    } else {
      this.headY = 1.74 * p.heightMul * s;
    }

    root.scale.setScalar(s);
    root.userData.zombie = this;
    root.position.set(this.x, 0, this.z);
    this.model = root;
    this.body = body;
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
    // Model front is +Z, so face the player with atan2(dx, dz).
    const targetYaw = Math.atan2(dx, dz);
    this.yaw = angleLerp(this.yaw, targetYaw, Math.min(1, dt * 6));

    let moveX = 0, moveZ = 0;
    const reach = this.radius + player.radius + 0.3;

    if (this.cfg.ranged && distToPlayer < this.cfg.shootRange && distToPlayer > 6) {
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
    const p = this.prof;
    const m = moving > 0.01 ? 1 : 0.15;
    this.walkPhase += dt * (4 + this.speed) * p.phaseSpeed * m;
    const ph = this.walkPhase;

    if (p.crawl) {
      // Legless: haul forward with alternating arm pulls, body heaving.
      const pull = Math.sin(ph);
      this.armL.rotation.x = -1.1 + pull * 0.6;
      this.armR.rotation.x = -1.1 - pull * 0.6;
      this.body.position.y = 0.12 + Math.abs(Math.sin(ph)) * 0.05 * (moving > 0.01 ? 1 : 0);
    } else {
      const swing = Math.sin(ph) * p.strideAmp * m;
      // Legs swing at hips; knees bend on the trailing leg.
      if (p.legs === 2) {
        this.legL.rotation.x = swing;
        this.legR.rotation.x = -swing - p.limp * 0.3;
        const kL = this.legL.userData.knee, kR = this.legR.userData.knee;
        if (kL) kL.rotation.x = Math.max(0, -swing) * 1.1 + 0.12;
        if (kR) kR.rotation.x = Math.max(0, swing) * 1.1 + 0.12 + p.limp * 0.4;
      } else if (p.legs === 1) {
        const leg = this._oneLeg;
        leg.rotation.x = Math.sin(ph) * 0.6 * m;
        const k = leg.userData.knee; if (k) k.rotation.x = Math.max(0, -Math.sin(ph)) * 1.2 + 0.15;
        // Hop the body on the single leg.
        this.body.position.y = Math.abs(Math.sin(ph)) * 0.12 * (moving > 0.01 ? 1 : 0) - 0.04;
        this.body.rotation.z = 0.12 * p.legSide; // list toward the missing side
      }

      const armSwing = Math.sin(ph + Math.PI) * p.armAmp * m;
      this.armL.rotation.x = p.armReachL + armSwing;
      this.armR.rotation.x = p.armReachR - armSwing;
      this.armL.rotation.z = Math.sin(ph) * 0.07;
      this.armR.rotation.z = -Math.sin(ph) * 0.07;
    }

    if (this.guts) this.guts.rotation.x = Math.sin(ph * 1.3) * 0.18 * m;

    if (this.lunge > 0) {
      this.lunge = Math.max(0, this.lunge - dt * 4);
      const l = this.lunge;
      this.armL.rotation.x = (p.crawl ? -1.1 : p.armReachL) - l * 0.7;
      this.armR.rotation.x = (p.crawl ? -1.1 : p.armReachR) - l * 0.7;
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

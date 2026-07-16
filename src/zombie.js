// Zombie entities: anatomically-jointed 3D models that vary per-instance in
// height, girth, gait and injuries, react to being shot with procedural
// impulse physics (flinch + stagger while alive, a crumpling ragdoll on
// death), and shamble with a more natural gait. Models are tagged so the
// game's raycasts map any hit part back to its zombie and detect headshots.
import * as THREE from "three";
import { rand, chance, angleLerp, lerp, clamp, TAU } from "./util.js";

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
    // Procedural hit-reaction state.
    this.stagger = 0; this.staggerRoll = 0;
    this.headSnap = 0; this.limbFlinch = 0; this.hitLimb = null;
    this.rag = null; // ragdoll state once dead
    this._build();
  }

  _makeProfile() {
    const t = this.type;
    const canMaim = t === "walker" || t === "spitter";
    let legs = 2;
    if (canMaim) { const r = Math.random(); legs = r < 0.1 ? 0 : r < 0.24 ? 1 : 2; }
    return {
      legs,
      legSide: chance(0.5) ? 1 : -1,
      heightMul: rand(0.82, 1.22),
      widthMul: rand(0.85, 1.2),
      guts: chance(0.34),
      headTilt: rand(-0.4, 0.4),
      missingEye: chance(0.18),
      jawOpen: chance(0.4) ? rand(0.15, 0.45) : 0,
      hunch: rand(0.05, 0.34),
      strideAmp: rand(0.5, 1.0),
      armAmp: rand(0.12, 0.44),
      armReachL: rand(-1.55, -0.95),
      armReachR: rand(-1.55, -0.95),
      armLenL: rand(0.85, 1.12),
      armLenR: rand(0.85, 1.12),
      limp: (legs === 2 && chance(0.35)) ? rand(0.4, 1) : 0,
      phaseSpeed: rand(0.85, 1.3),
      speedMul: legs === 0 ? 0.5 : legs === 1 ? 0.66 : rand(0.9, 1.1),
      crawl: legs === 0,
    };
  }

  _build() {
    const g = sharedGeo();
    const p = this.prof;
    const s = this.cfg.scale;
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const skin = new THREE.MeshStandardMaterial({ color: this.cfg.color, roughness: 0.95 });
    this.mat = skin;
    const gore = new THREE.MeshStandardMaterial({ color: 0x7a1414, roughness: 0.7 });
    const tag = (mesh) => { mesh.castShadow = true; mesh.userData.zombie = this; return mesh; };

    const pelvis = tag(new THREE.Mesh(g.pelvis, skin)); pelvis.position.y = 0.95; body.add(pelvis);
    const chest = tag(new THREE.Mesh(g.chest, skin)); chest.position.set(0, 1.3, 0); chest.rotation.x = -p.hunch; body.add(chest);
    this.chest = chest;

    const shL = tag(new THREE.Mesh(g.shoulder, skin)); shL.position.set(-0.37, 1.5, 0); body.add(shL);
    const shR = tag(new THREE.Mesh(g.shoulder, skin)); shR.position.set(0.37, 1.5, 0); body.add(shR);

    const neck = tag(new THREE.Mesh(g.neck, skin)); neck.position.set(0, 1.55, 0.01); neck.rotation.x = 0.16 + p.hunch * 0.5; body.add(neck);
    const head = tag(new THREE.Mesh(g.head, skin)); head.position.set(0, 1.74, 0.05); head.rotation.z = p.headTilt; head.userData.isHead = true; body.add(head);
    const jaw = tag(new THREE.Mesh(g.jaw, skin)); jaw.position.set(0, 1.63 - p.jawOpen * 0.06, 0.12); jaw.rotation.x = p.jawOpen; jaw.userData.isHead = true; body.add(jaw);
    this.headMesh = head;

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3322 });
    const eL = new THREE.Mesh(g.eye, eyeMat); eL.position.set(-0.1, 1.78, 0.22);
    const eR = new THREE.Mesh(g.eye, eyeMat); eR.position.set(0.1, 1.78, 0.22);
    eL.rotation.z = eR.rotation.z = p.headTilt;
    if (p.missingEye) (chance(0.5) ? eL : eR).visible = false;
    body.add(eL, eR);

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

    const makeArm = (side, reach, len) => {
      const grp = new THREE.Group();
      grp.position.set(side * 0.37, 1.5, 0);
      const upper = tag(new THREE.Mesh(g.upperArm, skin)); upper.position.y = -0.2 * len; upper.scale.y = len; grp.add(upper);
      const elbow = new THREE.Group(); elbow.position.y = -0.42 * len; grp.add(elbow);
      const fore = tag(new THREE.Mesh(g.foreArm, skin)); fore.position.y = -0.2 * len; fore.scale.y = len; elbow.add(fore);
      const hand = tag(new THREE.Mesh(g.hand, skin)); hand.position.y = -0.44 * len; elbow.add(hand);
      grp.rotation.x = reach; elbow.rotation.x = -0.35;
      grp.userData.elbow = elbow;
      body.add(grp);
      return grp;
    };
    this.armL = makeArm(-1, p.armReachL, p.armLenL);
    this.armR = makeArm(1, p.armReachR, p.armLenR);

    const makeLeg = (side) => {
      const grp = new THREE.Group();
      grp.position.set(side * 0.16, 0.95, 0);
      const thigh = tag(new THREE.Mesh(g.thigh, skin)); thigh.position.y = -0.22; grp.add(thigh);
      const knee = new THREE.Group(); knee.position.y = -0.44; grp.add(knee);
      const shin = tag(new THREE.Mesh(g.shin, skin)); shin.position.y = -0.21; knee.add(shin);
      const foot = tag(new THREE.Mesh(g.foot, skin)); foot.position.set(0, -0.43, 0.08); knee.add(foot);
      grp.userData.knee = knee; knee.userData.foot = foot;
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
      if (p.legSide < 0) { this.legL = good; this.legR = stump; } else { this.legR = good; this.legL = stump; }
      this._oneLeg = good;
    } else {
      makeStump(-1); makeStump(1);
    }

    body.scale.set(p.widthMul, p.heightMul, p.widthMul);

    if (p.crawl) { body.rotation.x = -1.3; body.position.y = 0.12; this.headY = 0.55 * s; }
    else { this.headY = 1.74 * p.heightMul * s; }

    root.scale.setScalar(s);
    root.userData.zombie = this;
    root.position.set(this.x, 0, this.z);
    this.model = root;
    this.body = body;
  }

  // Apply damage + a procedural hit reaction. hitY is the world height of the
  // impact so the right region flinches. Returns { died, headshot }.
  hurt(amount, headshot, knockX = 0, knockZ = 0, hitY = null) {
    if (this.dead) return { died: false };
    this.hp -= amount;
    this.hitFlash = 1;
    this.knockX += knockX;
    this.knockZ += knockZ;
    this._lastKx = knockX; this._lastKz = knockZ;

    // Stagger scales with the shove; pick the flinching region from hit height.
    const kmag = Math.hypot(knockX, knockZ);
    this.stagger = Math.min(1.2, this.stagger + 0.35 + kmag * 0.03);
    this.staggerRoll = rand(-1, 1) * 0.14;
    const hy = hitY != null ? hitY : this.headY * 0.6;
    if (headshot || hy > this.headY * 0.82) {
      this.headSnap = Math.min(1.3, this.headSnap + 0.9);
    } else if (hy < this.headY * 0.42 && (this.legL || this.legR)) {
      this.hitLimb = chance(0.5) ? this.legL : this.legR; this.limbFlinch = 1;
    } else {
      this.hitLimb = chance(0.5) ? this.armL : this.armR; this.limbFlinch = 0.85;
    }

    if (this.hp <= 0) { this.dead = true; return { died: true, headshot }; }
    return { died: false, headshot };
  }

  update(dt, player, world, game) {
    if (this.dead) return;

    const dx = player.x - this.x;
    const dz = player.z - this.z;
    const distToPlayer = Math.hypot(dx, dz) || 1e-3;
    const targetYaw = Math.atan2(dx, dz); // model front is +Z
    this.yaw = angleLerp(this.yaw, targetYaw, Math.min(1, dt * 6));

    let moveX = 0, moveZ = 0;
    const reach = this.radius + player.radius + 0.3;

    if (this.cfg.ranged && distToPlayer < this.cfg.shootRange && distToPlayer > 6) {
      this.shootTimer -= dt;
      if (this.shootTimer <= 0) { this.shootTimer = this.attackCd + rand(0, 0.8); game.spawnAcid(this, player); }
      if (distToPlayer < 12) { moveX = -dx / distToPlayer; moveZ = -dz / distToPlayer; }
    } else if (distToPlayer > reach) {
      moveX = dx / distToPlayer; moveZ = dz / distToPlayer;
    } else {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0 && this.dmg > 0) {
        this.attackTimer = this.attackCd; this.lunge = 1;
        player.damage(this.dmg); game.onPlayerHit();
      }
    }

    let vx = moveX * this.speed, vz = moveZ * this.speed;
    vx += this.knockX; vz += this.knockZ;
    this.knockX *= Math.exp(-8 * dt);
    this.knockZ *= Math.exp(-8 * dt);

    const r = world.resolve(this.x + vx * dt, this.z + vz * dt, this.radius);
    this.x = r.x; this.z = r.z;

    if (chance(dt * 0.25)) game.sfx.play(this.cfg.ranged ? "hiss" : "groan");

    this._animate(dt, Math.hypot(moveX, moveZ));
  }

  _animate(dt, moving) {
    const p = this.prof;
    const m = moving > 0.01 ? 1 : 0.15;
    this.walkPhase += dt * (2.6 + this.speed) * p.phaseSpeed * m;
    const ph = this.walkPhase;

    // Decay the procedural reaction state.
    this.stagger = Math.max(0, this.stagger - dt * 4.5);
    this.headSnap = Math.max(0, this.headSnap - dt * 6);
    this.limbFlinch = Math.max(0, this.limbFlinch - dt * 5);

    let bodyY = 0, bodyPitch, bodyRoll = 0;

    if (p.crawl) {
      const pull = Math.sin(ph);
      this.armL.rotation.x = -1.1 + pull * 0.6;
      this.armR.rotation.x = -1.1 - pull * 0.6;
      bodyY = 0.12 + Math.abs(Math.sin(ph)) * 0.05 * (moving > 0.01 ? 1 : 0);
      bodyPitch = -1.3;
    } else {
      const swing = Math.sin(ph) * p.strideAmp * m;
      if (p.legs === 2) {
        this.legL.rotation.x = swing;
        this.legR.rotation.x = -swing - p.limp * 0.3;
        const kL = this.legL.userData.knee, kR = this.legR.userData.knee;
        // Knee bends through the swing phase (leg travelling forward), extends to plant.
        if (kL) { kL.rotation.x = Math.max(0, Math.sin(ph + 1.1)) * 1.3 + 0.1; this._ankle(kL, ph); }
        if (kR) { kR.rotation.x = Math.max(0, Math.sin(ph + 1.1 + Math.PI)) * 1.3 + 0.1 + p.limp * 0.4; this._ankle(kR, ph + Math.PI); }
        // Pelvis bobs up at mid-stance (legs together) and rolls with the weight shift.
        bodyY = (Math.cos(2 * ph) * 0.5 + 0.5) * 0.05 * m;
        bodyRoll = Math.sin(ph) * 0.05 * m;
      } else if (p.legs === 1) {
        const leg = this._oneLeg;
        leg.rotation.x = Math.sin(ph) * 0.6 * m;
        const k = leg.userData.knee; if (k) k.rotation.x = Math.max(0, Math.sin(ph + 1.1)) * 1.4 + 0.15;
        bodyY = Math.abs(Math.sin(ph)) * 0.12 * (moving > 0.01 ? 1 : 0) - 0.04;
        bodyRoll = 0.12 * p.legSide;
      }
      bodyPitch = -m * 0.08; // lean into the walk

      const armSwing = Math.sin(ph + Math.PI) * p.armAmp * m;
      this.armL.rotation.x = p.armReachL + armSwing;
      this.armR.rotation.x = p.armReachR - armSwing;
      this.armL.rotation.z = Math.sin(ph) * 0.07;
      this.armR.rotation.z = -Math.sin(ph) * 0.07;
      // Subtle head bob / nod.
      this.headMesh.rotation.x = Math.sin(2 * ph) * 0.04 * m;
    }

    // Fold in the shot reaction: stagger back, roll, head snap, limb flail.
    bodyPitch -= this.stagger * 0.5;
    bodyRoll += this.staggerRoll * this.stagger;
    this.body.position.y = bodyY;
    this.body.rotation.x = bodyPitch;
    this.body.rotation.z = bodyRoll;
    if (this.headSnap > 0) this.headMesh.rotation.x -= this.headSnap;
    if (this.limbFlinch > 0 && this.hitLimb) this.hitLimb.rotation.x += this.limbFlinch * (this.hitLimb === this.legL || this.hitLimb === this.legR ? 0.6 : -0.7);

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

  _ankle(knee, ph) {
    const foot = knee.userData.foot;
    if (foot) foot.rotation.x = clamp(-Math.sin(ph) * 0.4, -0.4, 0.5);
  }

  // ---- Death ragdoll (lightweight procedural physics) ----
  startRagdoll(kx, kz) {
    const mag = Math.hypot(kx, kz) || 1;
    this.rag = {
      vy: clamp(0.6 + mag * 0.05, 0.5, 3.0),
      spinY: rand(-2.6, 2.6),
      rollZ: rand(-0.55, 0.55),
      slideX: (kx / mag) * clamp(mag * 0.22, 0.4, 4),
      slideZ: (kz / mag) * clamp(mag * 0.22, 0.4, 4),
      headTilt: this.prof.headTilt + rand(-0.7, 0.7),
      t: 0,
    };
    this.model.position.y = 0.01;
  }

  // Advance the ragdoll one step; returns elapsed seconds since death.
  ragdollStep(dt, world) {
    const r = this.rag;
    r.t += dt;
    const k = 1 - Math.exp(-9 * dt);

    // Crumple: pitch onto the back, roll, and let the limbs go limp.
    this.body.rotation.x += (-1.5 - this.body.rotation.x) * k;
    this.body.rotation.z += (r.rollZ - this.body.rotation.z) * k;
    this.armL.rotation.x += (-0.1 - this.armL.rotation.x) * k;
    this.armR.rotation.x += (-0.1 - this.armR.rotation.x) * k;
    this.armL.rotation.z += (0.5 - this.armL.rotation.z) * k;
    this.armR.rotation.z += (-0.5 - this.armR.rotation.z) * k;
    if (this.legL) { this.legL.rotation.x += (0.15 - this.legL.rotation.x) * k; const kn = this.legL.userData.knee; if (kn) kn.rotation.x += (0.1 - kn.rotation.x) * k; }
    if (this.legR) { this.legR.rotation.x += (-0.15 - this.legR.rotation.x) * k; const kn = this.legR.userData.knee; if (kn) kn.rotation.x += (0.1 - kn.rotation.x) * k; }
    this.headMesh.rotation.z += (r.headTilt - this.headMesh.rotation.z) * k;
    this.headMesh.rotation.x += (0.3 - this.headMesh.rotation.x) * k;

    // Vertical pop under gravity, bounce off the floor.
    r.vy -= 11 * dt;
    let y = this.model.position.y + r.vy * dt;
    if (y <= 0) { y = 0; if (r.vy < -0.5) r.vy *= -0.25; else r.vy = 0; }
    this.model.position.y = y;

    // Spin + slide, decaying, colliding with the world.
    this.model.rotation.y += r.spinY * dt; r.spinY *= Math.exp(-3 * dt);
    this.x += r.slideX * dt; this.z += r.slideZ * dt;
    r.slideX *= Math.exp(-6 * dt); r.slideZ *= Math.exp(-6 * dt);
    const rr = world.resolve(this.x, this.z, this.radius * 0.6);
    this.x = rr.x; this.z = rr.z;
    this.model.position.x = this.x; this.model.position.z = this.z;
    return r.t;
  }

  dispose() {
    if (this.model && this.model.parent) this.model.parent.remove(this.model);
  }
}

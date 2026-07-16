// Core game: scene/renderer setup, the fixed loop, waves, combat (hitscan +
// projectiles + melee), particles, pickups, the radar minimap, and all the
// HUD wiring. This is the 3D counterpart to the original top-down game.js.
import * as THREE from "three";
import { World, SETTINGS, ARENA_HALF } from "./world.js";
import { Player } from "./player.js";
import { Zombie, ZOMBIE_TYPES } from "./zombie.js";
import { WEAPONS, WEAPON_ORDER, newLoadout } from "./weapons.js";
import { Input } from "./input.js";
import { sfx } from "./audio.js";
import { clamp, rand, randInt, chance, distXZ, pick } from "./util.js";

const WAVES_PER_SETTING = 4;

export class Game {
  constructor(canvas, cb = {}) {
    this.canvas = canvas;
    this.cb = cb;
    this.sfx = sfx;

    // ---- Renderer / scene / camera ----
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 220);

    // Lighting: soft sky/ground fill + a low directional "moon".
    this.scene.add(new THREE.HemisphereLight(0x9aa8b8, 0x2a2a20, 1.05));
    const sun = new THREE.DirectionalLight(0xcfd6dc, 0.7);
    sun.position.set(-30, 60, 20);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0x40503f, 0.5));
    // A soft lamp that follows the player so nearby zombies stay readable.
    this.playerLamp = new THREE.PointLight(0xffe8c0, 0.7, 22, 1.6);
    this.scene.add(this.playerLamp);

    this.world = new World(this.scene);
    this.player = new Player(this.camera);
    this.input = new Input(canvas);

    this.zombieGroup = new THREE.Group();
    this.scene.add(this.zombieGroup);
    this.fxGroup = new THREE.Group();
    this.scene.add(this.fxGroup);
    this.pickupGroup = new THREE.Group();
    this.scene.add(this.pickupGroup);

    this.zombies = [];
    this.particles = [];
    this.projectiles = [];
    this.pickups = [];
    this.shells = [];

    this.raycaster = new THREE.Raycaster();
    this._camDir = new THREE.Vector3();

    // Muzzle flash light attached to the camera. Distance + decay make it
    // splash light onto nearby walls and zombies, fading off with distance.
    this.muzzle = new THREE.PointLight(0xffd18a, 0, 18, 2.0);
    this.muzzle.position.set(0.2, -0.14, -0.95);
    this.camera.add(this.muzzle);
    this.scene.add(this.camera);
    this.viewmodel = new THREE.Group();
    this.camera.add(this.viewmodel);

    // Shared particle geometry + per-colour material cache.
    this._pGeo = new THREE.SphereGeometry(0.09, 5, 4);
    this._pMats = new Map();

    this.running = false;
    this.paused = false;
    this.shake = 0;
    this._last = 0;
    this._statT = 0;
    this._miniT = 0;

    this.mini = document.getElementById("minimap");
    this.miniCtx = this.mini ? this.mini.getContext("2d") : null;
    this.vignette = document.getElementById("damage-vignette");
    this.hitmark = document.getElementById("hitmark");

    window.addEventListener("resize", () => this._resize());
    canvas.addEventListener("click", () => {
      if (this.running && !this.paused && !this.input.usingTouch) this.input.requestPointerLock();
    });
    document.addEventListener("pointerlockchange", () => {
      const locked = document.pointerLockElement === canvas;
      if (!locked && this.running && !this.paused && !this.input.usingTouch && !this._exiting) {
        this.setPaused(true);
      }
    });

    this._loop = this._loop.bind(this);
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------- Lifecycle ----------------
  start() {
    this.settingIndex = 0;
    this.score = 0;
    this.kills = 0;
    this.loadout = newLoadout();
    this.reloading = 0;
    this._triggerHeld = false;
    this._fireTimer = 0;
    this._corpses = [];
    this._tracers = [];
    this._buildViewmodel();
    this._beginSetting(0);
    this.running = true;
    this.paused = false;
    this.player.alive = true;
    this._last = performance.now();
    this.input.requestPointerLock();
    requestAnimationFrame(this._loop);
    this._emitStats();
  }

  _beginSetting(index) {
    this.settingIndex = index;
    const s = SETTINGS[index % SETTINGS.length];
    this.world.build(index);
    this.player.reset();
    this._clearEntities();
    this.wave = 0;
    this.spawnQueue = 0;
    this.spawnTimer = 0;
    this._waveDelay = 1.2;
    this._exitReady = false;
    this.cb.onSetting?.(s.name);
    this.cb.onToast?.(s.name, "Clear the horde");
    this._setObjective("Clear the horde");
    this._spawnWeaponPickups(index);
    this._nextWave();
  }

  _clearEntities() {
    for (const z of this.zombies) z.dispose();
    this.zombies.length = 0;
    for (const p of this.particles) this.fxGroup.remove(p.mesh);
    this.particles.length = 0;
    for (const pr of this.projectiles) this.fxGroup.remove(pr.mesh);
    this.projectiles.length = 0;
    for (const pk of this.pickups) this.pickupGroup.remove(pk.mesh);
    this.pickups.length = 0;
    for (const s of this.shells) this.fxGroup.remove(s.mesh);
    this.shells.length = 0;
  }

  setPaused(p) {
    if (this.paused === p || !this.running) return;
    this.paused = p;
    this.cb.onPause?.(p);
    if (p) {
      this._exiting = true;
      if (document.exitPointerLock) document.exitPointerLock();
      setTimeout(() => (this._exiting = false), 60);
    } else {
      this._last = performance.now();
      if (!this.input.usingTouch) this.input.requestPointerLock();
    }
  }

  pause(hidden) { if (hidden) this.setPaused(true); }

  quit() {
    this.running = false;
    this._clearEntities();
    if (document.exitPointerLock && document.pointerLockElement) document.exitPointerLock();
  }

  // ---------------- Waves ----------------
  _nextWave() {
    this.wave++;
    const w = this.wave + this.settingIndex * WAVES_PER_SETTING;
    this.spawnQueue = 5 + Math.floor(w * 2.4);
    this.spawnTimer = 0.4;
    this.cb.onWave?.(this.wave);
    this.sfx.play("wave");
    this.cb.onToast?.("WAVE " + this.wave, this.spawnQueue + " incoming");
    this._setObjective(`Wave ${this.wave} / ${WAVES_PER_SETTING}`);
  }

  _pickType() {
    const w = this.wave + this.settingIndex * WAVES_PER_SETTING;
    const roll = Math.random();
    if (w >= 3 && roll < 0.12) return "brute";
    if (w >= 2 && roll < 0.32) return "spitter";
    if (w >= 2 && roll < 0.62) return "runner";
    return "walker";
  }

  _spawnZombie() {
    const p = this.world.spawnPoint(this.player, 26);
    const z = new Zombie(this._pickType(), p.x, p.z, this.wave + this.settingIndex * WAVES_PER_SETTING);
    this.zombies.push(z);
    this.zombieGroup.add(z.model);
  }

  _updateWaves(dt) {
    if (this.spawnQueue > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this._spawnZombie();
        this.spawnQueue--;
        this.spawnTimer = clamp(1.1 - this.wave * 0.05, 0.35, 1.1);
      }
    } else if (this.zombies.length === 0) {
      // Wave cleared.
      if (this.wave >= WAVES_PER_SETTING) {
        if (!this._exitReady) {
          this._exitReady = true;
          this.world.setExitActive(true);
          this.cb.onToast?.("AREA CLEAR", "Reach the EXIT");
          this._setObjective("▶ Reach the EXIT");
          this.sfx.play("clear");
        }
      } else {
        this._waveDelay -= dt;
        if (this._waveDelay <= 0) { this._waveDelay = 3.5; this._nextWave(); }
      }
    }
  }

  // ---------------- Weapons & firing ----------------
  get weapon() { return WEAPONS[this.loadout.current]; }

  clipOf(id) {
    if (this.loadout.clip[id] === undefined) this.loadout.clip[id] = WEAPONS[id].clip || 0;
    return this.loadout.clip[id];
  }

  selectWeapon(id) {
    if (!this.loadout.owned[id] || this.loadout.current === id) return;
    this.loadout.current = id;
    this.reloading = 0;
    this._buildViewmodel();
    this.sfx.play("click");
    this._emitStats();
  }

  swapWeapon(dir = 1) {
    const owned = WEAPON_ORDER.filter((id) => this.loadout.owned[id]);
    const i = owned.indexOf(this.loadout.current);
    this.selectWeapon(owned[(i + dir + owned.length) % owned.length]);
  }

  selectSlot(n) {
    const owned = WEAPON_ORDER.filter((id) => this.loadout.owned[id]);
    if (owned[n]) this.selectWeapon(owned[n]);
  }

  startReload() {
    const wp = this.weapon;
    if (wp.melee || this.reloading > 0) return;
    const clip = this.clipOf(this.loadout.current);
    const reserve = this.loadout.ammo[wp.ammoType] || 0;
    if (clip >= wp.clip || reserve <= 0) return;
    this.reloading = wp.reload;
    this._reloadTotal = wp.reload;
    this.sfx.play("reload");
    this._dropMagazine();
    this._emitStats();
  }

  // A spent magazine tumbles from the grip and thuds on the floor.
  _dropMagazine() {
    this.camera.getWorldDirection(this._camDir);
    const up = new THREE.Vector3(0, 1, 0);
    const origin = this.player.position.addScaledVector(this._camDir, 0.35).addScaledVector(up, -0.5);
    this._magGeo = this._magGeo || new THREE.BoxGeometry(0.06, 0.16, 0.07);
    this._magMat = this._magMat || new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.7, metalness: 0.3 });
    const mesh = new THREE.Mesh(this._magGeo, this._magMat);
    mesh.position.copy(origin);
    mesh.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    this.fxGroup.add(mesh);
    this.shells.push({
      mesh, x: origin.x, y: origin.y, z: origin.z,
      vx: this._camDir.x * 0.5 + rand(-0.3, 0.3), vy: -0.4, vz: this._camDir.z * 0.5 + rand(-0.3, 0.3),
      spinX: rand(-6, 6), spinZ: rand(-6, 6), life: 4.5, bounces: 0, landed: false, sound: "magdrop",
    });
  }

  _finishReload() {
    const wp = this.weapon;
    const id = this.loadout.current;
    const need = wp.clip - this.clipOf(id);
    const take = Math.min(need, this.loadout.ammo[wp.ammoType] || 0);
    this.loadout.clip[id] += take;
    this.loadout.ammo[wp.ammoType] -= take;
    this._emitStats();
  }

  _tryFire() {
    const wp = this.weapon;
    if (this.reloading > 0) return;
    const id = this.loadout.current;

    if (!wp.melee) {
      if (this.clipOf(id) <= 0) {
        if ((this.loadout.ammo[wp.ammoType] || 0) > 0) this.startReload();
        else { this.sfx.play("click"); this._fireTimer = 0.25; }
        return;
      }
      this.loadout.clip[id]--;
    }

    this.sfx.play(wp.sound);
    this._fireTimer = 1 / wp.fireRate;
    this._recoil(wp);

    if (wp.melee) this._melee(wp);
    else if (wp.projectile) this._fireRocket(wp);
    else { this._fireHitscan(wp); this._ejectShell(wp); }

    this._emitStats();
  }

  _recoil(wp) {
    if (!wp.melee) {
      // Flash brightness scales with the weapon; the point light splashes onto
      // nearby surfaces and falls off with distance.
      this.muzzle.intensity = wp.explosive ? 12 : Math.min(9, 3.5 + wp.damage / 13);
      this._muzzleT = wp.explosive ? 0.09 : 0.05;
      if (this._flashMesh) {
        this._flashMesh.visible = true;
        const spread = wp.explosive ? 2.2 : (wp.pellets > 1 ? 1.6 : 1);
        this._flashMesh.scale.set(spread * rand(0.8, 1.3), rand(0.8, 1.5), spread * rand(0.8, 1.3));
        this._flashMesh.rotation.z = rand(0, Math.PI);
        this._flashT = 0.05;
      }
    }
    // Positional kick back toward the eye + rotational muzzle rise.
    this._vmKick = wp.explosive ? 0.16 : wp.melee ? 0.05 : 0.05 + (wp.damage / 800);
    this._vmKickRot = wp.melee ? 0.08 : Math.min(0.5, 0.12 + wp.damage / 300);
    if (!wp.melee) this.player.pitch = clamp(this.player.pitch - (wp.knockback * 0.0009 + 0.004), -1.35, 1.35);
    this.shake = Math.min(1, this.shake + (wp.explosive ? 0.9 : wp.melee ? 0.05 : 0.14));
  }

  // Eject a spent brass casing to the right of the gun; it tumbles, bounces and
  // clinks when it hits the ground. Only cartridge weapons eject.
  _ejectShell(wp) {
    this.camera.getWorldDirection(this._camDir);
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(this._camDir, up).normalize();
    const origin = this.player.position
      .addScaledVector(right, 0.32)
      .addScaledVector(this._camDir, 0.25)
      .addScaledVector(up, -0.12);
    this._shellGeo = this._shellGeo || new THREE.CylinderGeometry(0.028, 0.03, 0.11, 6);
    this._shellMat = this._shellMat || new THREE.MeshStandardMaterial({ color: 0xcaa24a, metalness: 0.85, roughness: 0.35 });
    const mesh = new THREE.Mesh(this._shellGeo, this._shellMat);
    mesh.position.copy(origin);
    mesh.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
    this.fxGroup.add(mesh);
    this.shells.push({
      mesh, x: origin.x, y: origin.y, z: origin.z,
      vx: right.x * rand(2.2, 3.4) + this._camDir.x * rand(-1.2, -0.4),
      vy: rand(2.6, 3.6),
      vz: right.z * rand(2.2, 3.4) + this._camDir.z * rand(-1.2, -0.4),
      spinX: rand(-14, 14), spinZ: rand(-14, 14),
      life: 3.4, bounces: 0, landed: false,
    });
    if (this.shells.length > 40) { const old = this.shells.shift(); this.fxGroup.remove(old.mesh); }
  }

  _updateShells(dt) {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.life -= dt;
      s.vy -= 20 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.y <= 0.05) {
        s.y = 0.05;
        if (s.vy < -0.4 && s.bounces < 3) {
          s.vy *= -0.4; s.vx *= 0.55; s.vz *= 0.55; s.spinX *= 0.5; s.spinZ *= 0.5;
          s.bounces++;
          if (!s.landed) this.sfx.play(s.sound || "shell"); // clink / thud on hitting the floor
        } else { s.vy = 0; s.vx *= 0.7; s.vz *= 0.7; s.landed = true; }
      }
      s.mesh.position.set(s.x, s.y, s.z);
      if (!s.landed) { s.mesh.rotation.x += s.spinX * dt; s.mesh.rotation.z += s.spinZ * dt; }
      if (s.life < 0.5) s.mesh.scale.setScalar(Math.max(0.02, s.life / 0.5));
      if (s.life <= 0) { this.fxGroup.remove(s.mesh); this.shells.splice(i, 1); }
    }
  }

  _melee(wp) {
    const fwd = this.player.forward();
    let hitAny = false;
    for (const z of this.zombies) {
      if (z.dead) continue;
      const dx = z.x - this.player.x, dz = z.z - this.player.z;
      const d = Math.hypot(dx, dz);
      if (d > wp.range + z.radius) continue;
      const dot = (dx / d) * fwd.x + (dz / d) * fwd.z;
      if (dot < Math.cos(wp.arc / 2)) continue;
      const headshot = chance(wp.hs);
      const dmg = wp.damage * (headshot ? 2.2 : 1);
      this._applyHit(z, dmg, headshot, fwd.x * wp.knockback, fwd.z * wp.knockback, z.headY * 0.9 + rand(-0.2, 0.2));
      hitAny = true;
    }
    if (hitAny) this._flashHit(false);
  }

  _fireHitscan(wp) {
    const origin = this.player.position;
    this.camera.getWorldDirection(this._camDir);
    const pellets = wp.pellets || 1;
    for (let p = 0; p < pellets; p++) {
      const dir = this._camDir.clone();
      dir.x += rand(-wp.spread, wp.spread);
      dir.y += rand(-wp.spread, wp.spread);
      dir.z += rand(-wp.spread, wp.spread);
      dir.normalize();
      this._castBullet(origin, dir, wp);
    }
  }

  _castBullet(origin, dir, wp) {
    this.raycaster.set(origin, dir);
    this.raycaster.far = wp.range;
    const hits = this.raycaster.intersectObjects([this.zombieGroup, this.world.group], true);
    let pierce = wp.pierce || 0;
    let endPoint = origin.clone().addScaledVector(dir, wp.range);
    let killedHead = false, hitZ = false;
    for (const h of hits) {
      const z = this._zombieOf(h.object);
      if (z && !z.dead) {
        const headshot = !!h.object.userData.isHead || chance(wp.hs);
        const dmg = wp.damage * (headshot ? 2.4 : 1);
        const kb = wp.knockback;
        const res = this._applyHit(z, dmg, headshot, dir.x * kb, dir.z * kb, h.point.y);
        hitZ = true;
        if (res.died && headshot) killedHead = true;
        if (pierce > 0) { pierce--; continue; }
        endPoint = h.point.clone();
        break;
      } else if (z && z.dead) {
        continue;
      } else {
        // World geometry blocks the shot.
        endPoint = h.point.clone();
        this._spawnParticles(h.point.x, h.point.y, h.point.z, 0xaaaaaa, 4, 3, 0.35, 6);
        break;
      }
    }
    this._tracer(origin, endPoint);
    if (hitZ) this._flashHit(killedHead);
  }

  _fireRocket(wp) {
    const origin = this.player.position;
    this.camera.getWorldDirection(this._camDir);
    const dir = this._camDir.clone().normalize();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x552200, emissiveIntensity: 1 })
    );
    const start = origin.clone().addScaledVector(dir, 0.8);
    mesh.position.copy(start);
    this.fxGroup.add(mesh);
    this.projectiles.push({
      type: "rocket", mesh, wp,
      x: start.x, y: start.y, z: start.z,
      vx: dir.x * wp.speed, vy: dir.y * wp.speed, vz: dir.z * wp.speed,
      life: 4,
    });
  }

  // Spitter acid — a gravity-arced blob aimed at the player.
  spawnAcid(zombie, player) {
    this.sfx.play("hiss");
    const sx = zombie.x, sy = 1.5, sz = zombie.z;
    const dx = player.x - sx, dz = player.z - sz;
    const d = Math.hypot(dx, dz) || 1;
    const t = clamp(d / 16, 0.4, 1.4);
    const speed = 15;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 7, 6),
      new THREE.MeshBasicMaterial({ color: 0x9bd843 })
    );
    mesh.position.set(sx, sy, sz);
    this.fxGroup.add(mesh);
    // Ballistic solve toward the player's feet.
    const g = 20;
    this.projectiles.push({
      type: "acid", mesh, grav: g,
      x: sx, y: sy, z: sz,
      vx: (dx / d) * speed, vy: g * t * 0.5, vz: (dz / d) * speed,
      life: 3.5,
    });
  }

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      if (pr.grav) pr.vy -= pr.grav * dt;
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt;
      pr.mesh.position.set(pr.x, pr.y, pr.z);
      let done = pr.life <= 0;

      if (pr.type === "rocket") {
        // Hit ground, a wall, or a zombie?
        if (pr.y <= 0.2) done = "explode";
        const res = this.world.resolve(pr.x, pr.z, 0.3);
        if (Math.abs(res.x - pr.x) > 0.01 || Math.abs(res.z - pr.z) > 0.01) done = "explode";
        for (const z of this.zombies) {
          if (!z.dead && distXZ(pr, z) < z.radius + 0.4 && Math.abs(pr.y - 1) < 1.5) { done = "explode"; break; }
        }
        if (done === "explode") { this._explode(pr.x, pr.y, pr.z, pr.wp); done = true; }
        else if (done) { this._explode(pr.x, pr.y, pr.z, pr.wp); }
      } else if (pr.type === "acid") {
        if (pr.y <= 0.2) {
          this._spawnParticles(pr.x, 0.2, pr.z, 0x9bd843, 8, 4, 0.5, 8);
          this.sfx.play("splat");
          done = true;
        }
        if (distXZ(pr, this.player) < 1.1 && pr.y < 2) {
          this.player.damage(9);
          this.onPlayerHit();
          this._spawnParticles(pr.x, pr.y, pr.z, 0x9bd843, 6, 4, 0.4, 8);
          done = true;
        }
      }

      if (done) { this.fxGroup.remove(pr.mesh); this.projectiles.splice(i, 1); }
    }
  }

  _explode(x, y, z, wp) {
    this.sfx.play("explode");
    this._spawnParticles(x, Math.max(0.4, y), z, 0xff8822, 26, 12, 0.7, 10);
    this._spawnParticles(x, Math.max(0.4, y), z, 0x552211, 14, 6, 1.0, 12);
    this.shake = 1;
    const R = wp.explosive;
    this.camera.getWorldDirection(this._camDir);
    for (const zb of this.zombies) {
      if (zb.dead) continue;
      const d = distXZ({ x, z }, zb);
      if (d < R) {
        const falloff = 1 - d / R;
        const kb = 14 * falloff;
        const kx = (zb.x - x) / (d || 1), kz = (zb.z - z) / (d || 1);
        this._applyHit(zb, wp.damage * falloff, false, kx * kb, kz * kb, zb.headY);
      }
    }
    if (distXZ({ x, z }, this.player) < R) {
      const d = distXZ({ x, z }, this.player);
      this.player.damage((1 - d / R) * 40);
      this.onPlayerHit();
    }
  }

  // Shared damage application + kill handling.
  _applyHit(z, dmg, headshot, kx, kz, y) {
    const res = z.hurt(dmg, headshot, kx, kz);
    this._spawnParticles(z.x, y != null ? y : 1.2, z.z, 0x8a0f0f, headshot ? 10 : 5, headshot ? 7 : 5, 0.5, 9);
    if (res.died) this._killZombie(z);
    return res;
  }

  _killZombie(z) {
    this.kills++;
    this.score += z.cfg.score;
    this._spawnParticles(z.x, 1.0, z.z, 0x8a0f0f, 14, 8, 0.7, 9);
    this.sfx.play("groan");
    // Fade the corpse into the ground, then remove.
    z.model.userData.corpse = 0;
    this._corpses = this._corpses || [];
    this._corpses.push(z);
    // Loot drop.
    this._maybeDrop(z);
    this._emitStats();
  }

  _maybeDrop(z) {
    const r = Math.random();
    if (r < 0.10) this._spawnPickup(z.x, z.z, "health", 25);
    else if (r < 0.34) {
      const type = pick(["rounds", "rounds", "shells", "rockets"]);
      const amt = type === "rounds" ? randInt(18, 34) : type === "shells" ? randInt(4, 10) : 1;
      this._spawnPickup(z.x, z.z, "ammo", amt, null, type);
    }
  }

  _updateCorpses(dt) {
    if (!this._corpses) return;
    for (let i = this._corpses.length - 1; i >= 0; i--) {
      const z = this._corpses[i];
      z.model.userData.corpse += dt;
      const t = z.model.userData.corpse;
      // Topple then sink.
      z.model.rotation.z = Math.min(Math.PI / 2, t * 3);
      z.model.position.y = -Math.max(0, (t - 1.2)) * 1.4;
      if (t > 2.4) {
        z.dispose();
        this._corpses.splice(i, 1);
        const idx = this.zombies.indexOf(z);
        if (idx >= 0) this.zombies.splice(idx, 1);
      }
    }
    // Remove dead-but-not-corpsed refs from the live list so waves can clear.
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      if (this.zombies[i].dead && this._corpses.indexOf(this.zombies[i]) < 0) this.zombies.splice(i, 1);
    }
  }

  // ---------------- Pickups ----------------
  _spawnWeaponPickups(index) {
    // Progressively make stronger weapons available across the settings.
    const table = [
      ["smg", "shotgun"],
      ["shotgun", "rifle"],
      ["rifle", "bazooka"],
      ["bazooka", "smg"],
    ];
    const wanted = table[index % table.length];
    for (const id of wanted) {
      if (this.loadout.owned[id]) continue;
      let x, zc, tries = 0;
      do { x = rand(-ARENA_HALF + 8, ARENA_HALF - 8); zc = rand(-ARENA_HALF + 8, ARENA_HALF - 8); tries++; }
      while (Math.hypot(x, zc) < 10 && tries < 20);
      this._spawnPickup(x, zc, "weapon", 0, id);
    }
  }

  _spawnPickup(x, z, kind, value, weaponId = null, ammoType = null) {
    let color = 0x7dd35b, geo;
    if (kind === "health") { color = 0xd64545; geo = new THREE.BoxGeometry(0.5, 0.5, 0.5); }
    else if (kind === "ammo") { color = 0xe0a24a; geo = new THREE.BoxGeometry(0.45, 0.35, 0.6); }
    else { color = 0x6fb3e0; geo = new THREE.BoxGeometry(0.8, 0.3, 0.3); }
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.6 }));
    mesh.position.set(x, 0.8, z);
    this.pickupGroup.add(mesh);
    this.pickups.push({ mesh, x, z, kind, value, weaponId, ammoType, t: rand(0, 6) });
  }

  _updatePickups(dt) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.t += dt;
      pk.mesh.position.y = 0.8 + Math.sin(pk.t * 2) * 0.12;
      pk.mesh.rotation.y += dt * 1.4;
      if (distXZ(pk, this.player) < 1.5) {
        this._grab(pk);
        this.pickupGroup.remove(pk.mesh);
        this.pickups.splice(i, 1);
      }
    }
  }

  _grab(pk) {
    if (pk.kind === "health") {
      this.player.heal(pk.value);
      this.sfx.play("heal");
      this.cb.onToast?.("+" + pk.value + " HP");
    } else if (pk.kind === "ammo") {
      this.loadout.ammo[pk.ammoType] = (this.loadout.ammo[pk.ammoType] || 0) + pk.value;
      this.sfx.play("pickup");
      this.cb.onToast?.("+" + pk.value + " " + pk.ammoType);
    } else if (pk.kind === "weapon") {
      const id = pk.weaponId;
      const wp = WEAPONS[id];
      const isNew = !this.loadout.owned[id];
      this.loadout.owned[id] = true;
      if (this.loadout.clip[id] === undefined) this.loadout.clip[id] = wp.clip || 0;
      // Bundle a little ammo with a new weapon.
      if (wp.ammoType) this.loadout.ammo[wp.ammoType] = (this.loadout.ammo[wp.ammoType] || 0) + (wp.ammoType === "rockets" ? 2 : wp.ammoType === "shells" ? 12 : 40);
      this.sfx.play("pickup");
      this.cb.onToast?.(wp.name, isNew ? "New weapon!" : "Ammo");
      if (isNew) this.selectWeapon(id);
    }
    this._emitStats();
  }

  // ---------------- Combat feedback ----------------
  onPlayerHit() {
    this.sfx.play("hurt");
    if (this.vignette) {
      this.vignette.style.opacity = String(clamp(1 - this.player.hp / this.player.maxHp, 0.25, 0.85));
      clearTimeout(this._vigT);
      this._vigT = setTimeout(() => { if (this.vignette) this.vignette.style.opacity = "0"; }, 120);
    }
    this.shake = Math.min(1, this.shake + 0.4);
    this.cb.vibrate?.(30);
  }

  _flashHit(kill) {
    if (!this.hitmark) return;
    this.hitmark.classList.toggle("kill", !!kill);
    this.hitmark.classList.remove("hidden");
    clearTimeout(this._hmT);
    this._hmT = setTimeout(() => this.hitmark.classList.add("hidden"), 90);
  }

  // ---------------- Particles ----------------
  _matFor(color) {
    let m = this._pMats.get(color);
    if (!m) { m = new THREE.MeshBasicMaterial({ color }); this._pMats.set(color, m); }
    return m;
  }

  _spawnParticles(x, y, z, color, count, speed, life, grav) {
    const mat = this._matFor(color);
    for (let i = 0; i < count; i++) {
      if (this.particles.length > 360) break;
      const mesh = new THREE.Mesh(this._pGeo, mat);
      mesh.position.set(x, y, z);
      const s = rand(0.4, 1.1);
      mesh.scale.setScalar(s);
      this.fxGroup.add(mesh);
      const ang = rand(0, Math.PI * 2), up = rand(0.2, 1);
      const sp = speed * rand(0.4, 1);
      this.particles.push({
        mesh,
        vx: Math.cos(ang) * sp, vy: up * sp, vz: Math.sin(ang) * sp,
        life: life * rand(0.6, 1), maxLife: life, grav: grav || 8, s0: s,
      });
    }
  }

  _updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.vy -= p.grav * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      if (p.mesh.position.y < 0.05) { p.mesh.position.y = 0.05; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      const f = Math.max(0, p.life / p.maxLife);
      p.mesh.scale.setScalar(p.s0 * f);
      if (p.life <= 0) { this.fxGroup.remove(p.mesh); this.particles.splice(i, 1); }
    }
  }

  _tracer(a, b) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffee88, transparent: true, opacity: 0.5 }));
    this.fxGroup.add(line);
    this._tracers = this._tracers || [];
    this._tracers.push({ line, life: 0.05 });
  }

  _updateTracers(dt) {
    if (!this._tracers) return;
    for (let i = this._tracers.length - 1; i >= 0; i--) {
      const t = this._tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.05) * 0.5;
      if (t.life <= 0) { this.fxGroup.remove(t.line); t.line.geometry.dispose(); this._tracers.splice(i, 1); }
    }
  }

  // ---------------- Viewmodel ----------------
  _buildViewmodel() {
    this.viewmodel.clear();
    const wp = this.weapon;
    const mat = new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.6, metalness: 0.4 });
    const g = new THREE.Group();
    if (wp.melee) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), new THREE.MeshStandardMaterial({ color: 0xcfd6da, metalness: 0.8, roughness: 0.3 }));
      blade.position.set(0, 0, -0.35);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.18), mat);
      g.add(blade, grip);
      this._vmSlide = this._vmMag = null;
    } else {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.5), mat);
      body.position.set(0, 0, -0.25);
      // Slide sits on top and racks back during reload / firing.
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.46), new THREE.MeshStandardMaterial({ color: 0x2c3136, roughness: 0.5, metalness: 0.55 }));
      slide.position.set(0, 0.07, -0.24);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, wp.explosive ? 0.8 : 0.4, 8), mat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, -0.5 - (wp.explosive ? 0.2 : 0));
      if (wp.explosive) { barrel.scale.set(2.4, 1, 2.4); }
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.11), mat);
      grip.position.set(0, -0.15, -0.06);
      grip.rotation.x = 0.18;
      // Magazine seated in the grip; drops out on reload.
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.19, 0.09), new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.7, metalness: 0.3 }));
      mag.position.set(0, -0.16, -0.05);
      g.add(body, slide, barrel, grip, mag);
      this._vmSlide = slide; this._slideBaseZ = slide.position.z;
      this._vmMag = mag; this._magBaseY = mag.position.y;
    }
    // Muzzle flash sprite at the barrel tip (hidden until a shot fires).
    if (!wp.melee) {
      const flash = new THREE.Mesh(
        new THREE.ConeGeometry(0.09, 0.24, 6),
        new THREE.MeshBasicMaterial({ color: 0xffe4a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      flash.rotation.x = -Math.PI / 2; // point the cone forward (-Z)
      flash.position.set(0, 0.02, -0.72 - (wp.explosive ? 0.2 : 0));
      flash.visible = false;
      g.add(flash);
      this._flashMesh = flash;
    } else {
      this._flashMesh = null;
    }

    g.position.set(0.28, -0.26, -0.55);
    g.rotation.set(0, -0.05, 0);
    this.viewmodel.add(g);
    this._vm = g;
  }

  _updateViewmodel(dt) {
    if (!this._vm) return;
    this._vmKick = (this._vmKick || 0) * Math.exp(-12 * dt);
    this._vmKickRot = (this._vmKickRot || 0) * Math.exp(-11 * dt);
    const sway = Math.sin(this.player.bob) * 0.01 * this.player.bobAmt;

    const reloading = this.reloading > 0 && this._reloadTotal > 0;
    const p = reloading ? clamp(1 - this.reloading / this._reloadTotal, 0, 1) : 0;

    // Base pose (+ recoil), dipping and tilting into view while reloading.
    const dip = reloading ? Math.sin(p * Math.PI) * 0.12 : 0;
    const tilt = reloading ? Math.sin(p * Math.PI) * 0.5 : 0;
    this._vm.position.set(0.28 + sway, -0.26 + Math.abs(sway) * 0.5 - dip, -0.55 + this._vmKick);
    this._vm.rotation.set(-this._vmKickRot, -0.05, tilt);

    // Magazine drops out early, a fresh one seats around the middle.
    if (this._vmMag) {
      if (reloading) {
        let drop = 0, vis = true;
        if (p < 0.35) drop = p / 0.35;                     // pulled out, falling
        else if (p < 0.55) { drop = 1; vis = false; }      // empty grip
        else if (p < 0.78) drop = 1 - (p - 0.55) / 0.23;   // new mag slides up
        this._vmMag.visible = vis;
        this._vmMag.position.y = this._magBaseY - drop * 0.42;
      } else {
        this._vmMag.visible = true;
        this._vmMag.position.y = this._magBaseY;
      }
    }
    // Slide racks back at the end of the reload (and nudges when firing).
    if (this._vmSlide) {
      let back = reloading && p > 0.8 ? Math.sin((p - 0.8) / 0.2 * Math.PI) : 0;
      back = Math.max(back, this._vmKick * 0.5);
      this._vmSlide.position.z = this._slideBaseZ + back * 0.12;
    }

    if (this._flashMesh && this._flashMesh.visible) {
      this._flashT -= dt;
      this._flashMesh.material.opacity = Math.max(0, this._flashT / 0.05) * 0.9;
      if (this._flashT <= 0) this._flashMesh.visible = false;
    }
  }

  // ---------------- HUD ----------------
  _setObjective(text) {
    const el = document.getElementById("objective");
    if (el) el.textContent = text;
  }

  _ammoString() {
    const wp = this.weapon;
    if (wp.melee) return "∞";
    return this.clipOf(this.loadout.current) + " / " + (this.loadout.ammo[wp.ammoType] || 0);
  }

  _emitStats() {
    const wp = this.weapon;
    this.cb.onStats?.({
      hp: this.player.hp / this.player.maxHp,
      stamina: this.player.stamina,
      exhausted: this.player.exhausted,
      wave: this.wave,
      score: this.score,
      weapon: wp.name,
      ammo: this._ammoString(),
      lowAmmo: !wp.melee && this.clipOf(this.loadout.current) === 0,
      owned: WEAPON_ORDER.filter((id) => this.loadout.owned[id]),
      current: this.loadout.current,
      reloading: this.reloading > 0,
      reloadProgress: this.reloading > 0 && this._reloadTotal ? clamp(1 - this.reloading / this._reloadTotal, 0, 1) : 0,
    });
  }

  _drawMinimap() {
    if (!this.miniCtx) return;
    const ctx = this.miniCtx, W = this.mini.width, H = this.mini.height;
    const scale = W / (ARENA_HALF * 2);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(0, 0, W, H);
    const toX = (x) => W / 2 + x * scale;
    const toY = (z) => H / 2 + z * scale;
    // Exit.
    if (this.world.exit) {
      ctx.fillStyle = this.world.exit.active ? "#7dd35b" : "#3a5a30";
      ctx.fillRect(toX(this.world.exit.x) - 3, toY(this.world.exit.z) - 3, 6, 6);
    }
    // Zombies.
    for (const z of this.zombies) {
      if (z.dead) continue;
      ctx.fillStyle = z.type === "brute" ? "#d64545" : z.type === "spitter" ? "#9bd843" : "#c98";
      ctx.fillRect(toX(z.x) - 1.5, toY(z.z) - 1.5, 3, 3);
    }
    // Player arrow.
    ctx.save();
    ctx.translate(toX(this.player.x), toY(this.player.z));
    ctx.rotate(-this.player.yaw + Math.PI);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(0, -5); ctx.lineTo(4, 4); ctx.lineTo(-4, 4); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ---------------- Main loop ----------------
  _loop(t) {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    let dt = (t - this._last) / 1000;
    this._last = t;
    if (this.paused) { this.renderer.render(this.scene, this.camera); return; }
    dt = clamp(dt, 0, 0.05);

    this.input.sampleKeyboard();
    const actions = this.input.consume();
    if (actions.pause) { this.setPaused(true); return; }
    if (actions.reload) this.startReload();
    if (actions.swap) this.swapWeapon(1);
    if (actions.select >= 0) this.selectSlot(actions.select);

    this.player.update(dt, this.input, this.world);
    if (this.playerLamp) this.playerLamp.position.set(this.player.x, 2.6, this.player.z);

    // Firing.
    this._fireTimer = (this._fireTimer || 0) - dt;
    const wp = this.weapon;
    const canRepeat = wp.auto || wp.melee;
    if (this.input.firing && this._fireTimer <= 0 && this.reloading <= 0) {
      if (canRepeat || !this._triggerHeld) this._tryFire();
    }
    this._triggerHeld = this.input.firing;

    // Reload progression.
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) { this.reloading = 0; this._finishReload(); }
    }

    // Muzzle flash decay.
    if (this._muzzleT > 0) { this._muzzleT -= dt; if (this._muzzleT <= 0) this.muzzle.intensity = 0; }
    else this.muzzle.intensity *= Math.exp(-20 * dt);

    // Entities.
    for (const z of this.zombies) if (!z.dead) z.update(dt, this.player, this.world, this);
    this._updateCorpses(dt);
    this._updateProjectiles(dt);
    this._updateParticles(dt);
    this._updateTracers(dt);
    this._updateShells(dt);
    this._updatePickups(dt);
    this._updateViewmodel(dt);
    this._updateWaves(dt);
    this.world.animate(t / 1000);

    // Reached the exit?
    if (this._exitReady && this.world.exit && distXZ(this.player, this.world.exit) < this.world.exit.radius) {
      this._advanceSetting();
      return;
    }

    // Death.
    if (!this.player.alive) { this._gameOver(); return; }

    // HUD (throttled a touch).
    this._statT -= dt;
    if (this._statT <= 0) { this._statT = 0.1; this._emitStats(); }
    this._miniT -= dt;
    if (this._miniT <= 0) { this._miniT = 0.08; this._drawMinimap(); }

    // Screen shake.
    this.shake *= Math.exp(-6 * dt);
    if (this.shake > 0.001) {
      this.camera.position.x += rand(-1, 1) * this.shake * 0.25;
      this.camera.position.y += rand(-1, 1) * this.shake * 0.25;
      this.camera.position.z += rand(-1, 1) * this.shake * 0.25;
    }

    this.renderer.render(this.scene, this.camera);
  }

  _advanceSetting() {
    const next = (this.settingIndex + 1);
    const nextName = SETTINGS[next % SETTINGS.length].name;
    this.setPaused(false);
    this._exiting = true;
    if (document.exitPointerLock && document.pointerLockElement) document.exitPointerLock();
    this.running = false;
    this.cb.onLevelClear?.({ next: nextName, index: next });
  }

  continueToNextSetting() {
    this._beginSetting(this.settingIndex + 1);
    this.running = true;
    this.paused = false;
    this._last = performance.now();
    if (!this.input.usingTouch) this.input.requestPointerLock();
    requestAnimationFrame(this._loop);
    this._emitStats();
  }

  _gameOver() {
    this.running = false;
    if (document.exitPointerLock && document.pointerLockElement) document.exitPointerLock();
    this.cb.onGameOver?.({ score: this.score, wave: this.wave, kills: this.kills });
  }

  _zombieOf(obj) {
    while (obj) {
      if (obj.userData && obj.userData.zombie) return obj.userData.zombie;
      obj = obj.parent;
    }
    return null;
  }
}

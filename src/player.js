// First-person player controller: mouse/touch look, WASD/stick movement,
// sprint + stamina, collision against the world, health, and a little
// head-bob to sell the walk. Owns the camera it drives.
import * as THREE from "three";
import { clamp } from "./util.js";

const EYE = 1.7;         // camera height above the ground
const WALK = 6.2;        // units / sec
const SPRINT = 10.0;
const ACCEL = 14;        // velocity smoothing
const LOOK_SENS = 0.0022; // radians per pixel

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.x = 0; this.z = 0;
    this.yaw = 0; this.pitch = 0;
    this.vx = 0; this.vz = 0;
    this.radius = 0.55;
    this.maxHp = 100; this.hp = 100;
    this.stamina = 1; this.exhausted = false;
    this.bob = 0; this.bobAmt = 0;
    this.hurtFlash = 0;
    this.alive = true;
  }

  reset() {
    this.x = 0; this.z = 12; this.yaw = Math.PI; this.pitch = 0;
    this.vx = this.vz = 0;
    this.hp = this.maxHp; this.stamina = 1; this.exhausted = false;
    this.bob = 0; this.bobAmt = 0; this.hurtFlash = 0; this.alive = true;
    this._applyCamera();
  }

  get position() { return new THREE.Vector3(this.x, EYE, this.z); }

  // Unit facing vector on the ground plane, matching the camera's look
  // direction (camera looks down local -Z rotated by yaw about +Y).
  forward() { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }

  applyLook(dx, dy) {
    this.yaw -= dx * LOOK_SENS;
    this.pitch = clamp(this.pitch - dy * LOOK_SENS, -1.35, 1.35);
  }

  damage(amt) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amt);
    this.hurtFlash = 1;
    if (this.hp <= 0) this.alive = false;
  }

  heal(amt) { this.hp = Math.min(this.maxHp, this.hp + amt); }

  update(dt, input, world) {
    if (!this.alive) return;

    // --- Look ---
    const look = input.takeLook();
    this.applyLook(look.dx, look.dy);

    // --- Stamina / sprint ---
    const wantMove = Math.abs(input.moveF) + Math.abs(input.moveS) > 0.05;
    let sprinting = input.sprint && wantMove && !this.exhausted && this.stamina > 0.02;
    if (sprinting) {
      this.stamina = Math.max(0, this.stamina - dt * 0.42);
      if (this.stamina <= 0) this.exhausted = true;
    } else {
      this.stamina = Math.min(1, this.stamina + dt * 0.28);
      if (this.exhausted && this.stamina > 0.35) this.exhausted = false;
    }
    const speed = sprinting ? SPRINT : WALK;

    // --- Desired velocity in world space from local input + yaw ---
    const fwd = this.forward();
    const rightX = -fwd.z, rightZ = fwd.x; // right = forward rotated -90°
    let dvx = (fwd.x * input.moveF + rightX * input.moveS);
    let dvz = (fwd.z * input.moveF + rightZ * input.moveS);
    const mag = Math.hypot(dvx, dvz);
    if (mag > 1) { dvx /= mag; dvz /= mag; }
    const targetVx = dvx * speed;
    const targetVz = dvz * speed;

    // Smooth toward target velocity.
    const k = 1 - Math.exp(-ACCEL * dt);
    this.vx += (targetVx - this.vx) * k;
    this.vz += (targetVz - this.vz) * k;

    // --- Integrate + collide ---
    const nx = this.x + this.vx * dt;
    const nz = this.z + this.vz * dt;
    const r = world.resolve(nx, nz, this.radius);
    // If collision cancelled motion on an axis, damp that velocity.
    if (Math.abs(r.x - nx) > 1e-4) this.vx *= 0.3;
    if (Math.abs(r.z - nz) > 1e-4) this.vz *= 0.3;
    this.x = r.x; this.z = r.z;

    // --- Head-bob ---
    const moveSpeed = Math.hypot(this.vx, this.vz);
    this.bobAmt += (Math.min(moveSpeed / SPRINT, 1) - this.bobAmt) * Math.min(1, dt * 8);
    this.bob += dt * moveSpeed * 1.5;

    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);

    this._applyCamera();
  }

  _applyCamera() {
    const bobY = Math.sin(this.bob * 2) * 0.06 * this.bobAmt;
    const bobX = Math.cos(this.bob) * 0.04 * this.bobAmt;
    this.camera.position.set(this.x + bobX, EYE + bobY, this.z);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
  }
}

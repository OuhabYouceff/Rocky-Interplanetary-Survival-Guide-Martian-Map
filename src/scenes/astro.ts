// A suited astronaut with real joints so it can be posed: stand, walk, kneel, lie, haul.
// buildAstronaut() returns at once with a figure built from simple shapes (proportions of an EVA suit, about 1.9 m), then
// swaps in a rigged low-poly suit model (public/models/astronaut.glb, CC-BY 3.0, see public/models/CREDITS.md) when it has
// loaded. The joint groups stay the source of truth either way: every pose (and any caller) turns the joint groups, and the
// model's skeleton copies them each frame, so `root`, the joints and the five poses mean the same thing with or without it.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { skyEnv } from './world';

const HEIGHT = 1.9, PELVIS = .95;                     // standing height of the suited figure and its hip height, metres
// Suit fabric is a touch cool so it reads white under the warm Martian light instead of tan.
const SUIT = 0xe4ecfa, TRIM = 0x7d828a, DARK = 0x34373d;
let suitModel: Promise<GLTF> | null = null;
const loadSuit = () => (suitModel ??= new GLTFLoader().loadAsync('models/astronaut.glb').then((g) => {
  // soften the low-poly facets of the fabric while keeping hard edges (backpack, rings) crisp
  g.scene.traverse((o) => { if (o instanceof THREE.SkinnedMesh) o.geometry = toCreasedNormals(o.geometry, o.parent?.name === 'Helmet' ? 1.25 : .75); });
  return g;
}));

export function buildAstronaut(band: number) {
  const env = skyEnv();
  const mat = (color: number, roughness = .8, envI = .35) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, envMap: env, envMapIntensity: envI });
  const white = mat(SUIT, .74, .5), grey = mat(TRIM, .6), dark = mat(DARK, .7, .2), stripe = mat(band, .65, .2);
  const visor = new THREE.MeshStandardMaterial({ color: 0xe0a53c, roughness: .1, metalness: 1, envMap: env, envMapIntensity: 1.4 });
  const part = (geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  const joint = (parent: THREE.Object3D, x: number, y: number, z: number) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
  const cap = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 8, 20), ring = (r: number, h: number) => new THREE.CylinderGeometry(r, r, h, 24);
  const box = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 5, r);

  const root = new THREE.Group(), pelvis = joint(root, 0, PELVIS, 0), torso = joint(pelvis, 0, 0, 0);
  part(cap(.2, .34), white, torso, 0, .3, 0);                           // hard upper torso
  part(cap(.185, .12), white, pelvis, 0, -.02, 0);                      // hips
  part(ring(.207, .06), grey, torso, 0, .03, 0);                        // waist bearing
  part(box(.42, .6, .24, .07), white, torso, 0, .4, -.26);              // life-support backpack
  part(box(.3, .1, .06, .02), grey, torso, 0, .68, -.31);
  part(box(.24, .16, .1, .03), grey, torso, 0, .36, .19);               // chest control unit
  part(ring(.14, .05), grey, torso, 0, .6, 0);                          // neck ring
  part(new THREE.SphereGeometry(.2, 32, 24), white, torso, 0, .78, 0);  // helmet
  part(new THREE.SphereGeometry(.178, 32, 24), visor, torso, 0, .785, .055).scale.set(1, .86, 1);
  const limb = (parent: THREE.Object3D, x: number, y: number, upperR: number, upperLen: number, lowerR: number, lowerLen: number, drop: number) => {
    const top = joint(parent, x, y, 0);
    part(new THREE.SphereGeometry(upperR + .012, 16, 12), white, top, 0, 0, 0);
    part(cap(upperR, upperLen), white, top, 0, -drop / 2, 0);
    part(ring(upperR + .007, .06), stripe, top, 0, -drop * .5, 0);      // the coloured band that tells the two crew apart
    const mid = joint(top, 0, -drop, 0);
    part(ring(upperR + .004, .05), grey, mid, 0, 0, 0);
    part(cap(lowerR, lowerLen), white, mid, 0, -drop / 2 + .02, 0);
    return [top, mid] as const;
  };
  const [armL, elbowL] = limb(torso, .285, .52, .078, .2, .07, .18, .32), [armR, elbowR] = limb(torso, -.285, .52, .078, .2, .07, .18, .32);
  const [legL, kneeL] = limb(pelvis, .118, 0, .098, .24, .088, .22, .45), [legR, kneeR] = limb(pelvis, -.118, 0, .098, .24, .088, .22, .45);
  for (const e of [elbowL, elbowR]) part(new THREE.SphereGeometry(.08, 16, 12), grey, e, 0, -.31, 0);     // gloves
  for (const k of [kneeL, kneeR]) part(box(.17, .12, .31, .04), dark, k, 0, -.435, .045);                  // boots
  const J = { root, pelvis, torso, armL, armR, elbowL, elbowR, legL, legR, kneeL, kneeR };
  const simple: THREE.Mesh[] = []; root.traverse((o) => { if (o instanceof THREE.Mesh) simple.push(o); });

  // ---- the rigged model, driven by the joints above -------------------------------------------------------------------
  loadSuit().then((gltf) => {
    const model = SkeletonUtils.clone(gltf.scene), suit = new THREE.Group(); suit.add(model);
    const bone = (n: string) => model.getObjectByName(`mixamorig${n}`) as THREE.Bone;
    // materials: plain white suit, dark grey joints and gloves, gold visor reflecting the sky, the flag patch in the band colour
    const mats: Record<string, THREE.Material> = { white, gray: dark, transparent_mask: visor, patch: stripe };
    model.traverse((o) => { if (o instanceof THREE.SkinnedMesh) { o.material = mats[(o.material as THREE.Material).name] ?? white; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    // scale to HEIGHT with the boots on the ground (the file stands in a T-pose)
    model.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(model, true), s = HEIGHT / (bb.max.y - bb.min.y);
    model.scale.setScalar(s); model.position.y = -bb.min.y * s; suit.updateMatrixWorld(true);
    // bring the arms down and straighten every limb so the model's rest pose is the joints' rest pose (limbs hanging straight)
    const down = new THREE.Vector3(0, -1, 0), a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Quaternion(), pq = new THREE.Quaternion();
    const worldQ = (o: THREE.Object3D, out: THREE.Quaternion) => { o.matrixWorld.decompose(a, out, b); return out; };
    const aim = (o: THREE.Object3D, child: THREE.Object3D) => {
      a.setFromMatrixPosition(child.matrixWorld).sub(b.setFromMatrixPosition(o.matrixWorld)).normalize();
      q.setFromUnitVectors(a, down).multiply(worldQ(o, new THREE.Quaternion()));
      o.quaternion.copy(worldQ(o.parent!, pq).invert().multiply(q)); o.updateMatrixWorld(true);
    };
    for (const side of ['Left', 'Right']) {
      aim(bone(`${side}Arm`), bone(`${side}ForeArm`)); aim(bone(`${side}ForeArm`), bone(`${side}Hand`));
      aim(bone(`${side}UpLeg`), bone(`${side}Leg`)); aim(bone(`${side}Leg`), bone(`${side}Foot`));
    }
    { const bb2 = new THREE.Box3().setFromObject(model, true); model.position.y -= bb2.min.y; suit.updateMatrixWorld(true); }   // boots on the ground again
    // arm bands: a ring round each upper arm, sized from the arm's own vertices
    let body: THREE.SkinnedMesh | undefined; model.traverse((o) => { if (o instanceof THREE.SkinnedMesh && (!body || o.geometry.attributes.position.count > body.geometry.attributes.position.count)) body = o; });
    for (const side of ['Left', 'Right']) {
      const arm = bone(`${side}Arm`), sk = body?.skeleton, bi = sk ? sk.bones.indexOf(arm) : -1;
      let r = .1, len = 1;
      if (body && sk && bi >= 0) {
        len = bone(`${side}ForeArm`).position.length(); r = 0;
        const inv = sk.boneInverses[bi], p = new THREE.Vector3(), pos = body.geometry.attributes.position, ji = body.geometry.attributes.skinIndex, wi = body.geometry.attributes.skinWeight;
        for (let i = 0; i < pos.count; i++) {
          let w = 0; for (let c = 0; c < 4; c++) if (ji.getComponent(i, c) === bi) w += wi.getComponent(i, c);
          if (w < .5) continue; p.fromBufferAttribute(pos, i).applyMatrix4(body.bindMatrix).applyMatrix4(inv);
          if (Math.abs(p.y / len - .45) < .2) r = Math.max(r, Math.hypot(p.x, p.z));
        }
        if (!r) r = len * .3;
      }
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.06, r * 1.06, len * .16, 24, 1, true), stripe);
      ring.position.y = len * .45; ring.castShadow = true; arm.add(ring);
    }
    // rest orientations relative to the root (the joints' rest orientations are all the identity)
    suit.updateMatrixWorld(true);
    const map: [THREE.Object3D, THREE.Bone, number][] = [[pelvis, bone('Hips'), 1], [torso, bone('Spine'), 1 / 3], [torso, bone('Spine1'), 2 / 3], [torso, bone('Spine2'), 1],
      [armL, bone('LeftArm'), 1], [elbowL, bone('LeftForeArm'), 1], [armR, bone('RightArm'), 1], [elbowR, bone('RightForeArm'), 1],
      [legL, bone('LeftUpLeg'), 1], [kneeL, bone('LeftLeg'), 1], [legR, bone('RightUpLeg'), 1], [kneeR, bone('RightLeg'), 1]];
    const rest = map.map(([, bn]) => worldQ(bn, new THREE.Quaternion()));
    const hips = bone('Hips'), hipRest = new THREE.Vector3().setFromMatrixPosition(hips.matrixWorld), k = hipRest.y / PELVIS;
    for (const m of simple) m.visible = false;
    root.add(suit);

    const rootQ = new THREE.Quaternion(), jq = new THREE.Quaternion(), tq = new THREE.Quaternion(), pelvisQ = new THREE.Quaternion(), m4 = new THREE.Matrix4(), v = new THREE.Vector3();
    const base = root.updateMatrixWorld.bind(root);
    root.updateMatrixWorld = (force?: boolean) => {
      base(force);
      if (!suit.visible) return;
      worldQ(root, rootQ).invert();
      map.forEach(([j, bn, f], i) => {
        jq.multiplyQuaternions(rootQ, worldQ(j, jq));                         // joint orientation relative to the root
        if (j === pelvis) pelvisQ.copy(jq); else if (f < 1) jq.slerpQuaternions(pelvisQ, jq, f);   // the spine shares the torso's bend
        tq.multiplyQuaternions(jq, rest[i]);                                  // wanted bone orientation relative to the root
        bn.quaternion.copy(worldQ(bn.parent!, pq).premultiply(rootQ).invert().multiply(tq));
        if (j === pelvis) {                                                    // the hips follow the pelvis, scaled to the model's legs
          v.copy(pelvis.position).sub(a.set(0, PELVIS, 0)).multiplyScalar(k).add(hipRest).applyMatrix4(root.matrixWorld);
          bn.position.copy(v.applyMatrix4(m4.copy(bn.parent!.matrixWorld).invert()));
        }
        bn.updateMatrixWorld(true);
      });
    };
  }).catch((e) => console.error('astronaut model not loaded, keeping the simple figure:', e));

  const reset = () => { for (const j of [pelvis, torso, armL, armR, elbowL, elbowR, legL, legR, kneeL, kneeR]) j.rotation.set(0, 0, 0); pelvis.position.set(0, PELVIS, 0); armL.rotation.z = .2; armR.rotation.z = -.2; root.rotation.set(0, root.rotation.y, 0); };
  return {
    ...J,
    /** Standing, arms held a little away from the body as a pressurised suit does. */
    stand() { reset(); elbowL.rotation.x = elbowR.rotation.x = -.35; torso.rotation.x = .06; },
    /** Walking; phase in radians (2 pi = two steps). */
    walk(ph: number) {
      reset(); const sw = Math.sin(ph) * .5;
      legL.rotation.x = -sw; legR.rotation.x = sw;
      kneeL.rotation.x = .1 + Math.max(0, Math.sin(ph + 1.9)) * .9; kneeR.rotation.x = .1 + Math.max(0, Math.sin(ph + 1.9 + Math.PI)) * .9;
      armL.rotation.x = -.2 + sw * .7; armR.rotation.x = -.2 - sw * .7; elbowL.rotation.x = elbowR.rotation.x = -.7;
      torso.rotation.x = .18; pelvis.position.y = .92 + Math.abs(Math.sin(ph)) * .04;
    },
    /** Kneeling on the right knee, leaning forward with both hands low (tending to someone on the ground). */
    kneel() {
      reset(); pelvis.position.y = .58; torso.rotation.x = .55;
      legL.rotation.x = -1.45; kneeL.rotation.x = 1.6;                  // left foot planted in front
      legR.rotation.x = .15; kneeR.rotation.x = 1.7;                    // right knee on the ground
      armL.rotation.x = armR.rotation.x = -.9; elbowL.rotation.x = elbowR.rotation.x = -.5;
    },
    /** Lying face up, limp. The root stays upright; the body is laid back about the hips so it rests on its backpack. */
    lie() {
      reset(); pelvis.position.y = .3; pelvis.rotation.x = -Math.PI / 2 + .26;      // back propped on the backpack, seat and heels on the ground
      legL.rotation.x = .02; legR.rotation.x = -.06; legR.rotation.z = -.08; kneeL.rotation.x = .1; kneeR.rotation.x = .22;
      armL.rotation.x = .5; armR.rotation.x = .42; armL.rotation.z = .38; armR.rotation.z = -.3; elbowL.rotation.x = -.35; elbowR.rotation.x = -.2;   // arms fallen to the ground
    },
    /** Hauling: walking backwards bent forward over the load, hips low and back, knees bent, both arms reaching down to a
     *  harness just in front of the feet. Root faces the load, so the direction of travel is reversed. */
    haul(ph: number) {
      reset(); const sw = Math.sin(ph) * .2;
      pelvis.position.y = .86 + Math.abs(Math.sin(ph)) * .02;                         // hips low and back, knees well bent
      legL.rotation.x = -.55 - sw; legR.rotation.x = -.55 + sw;                         // feet planted ahead of the hips, towards the load
      kneeL.rotation.x = .95 + Math.max(0, Math.sin(ph + 1.9)) * .3; kneeR.rotation.x = .95 + Math.max(0, Math.sin(ph + 1.9 + Math.PI)) * .3;
      torso.rotation.x = .75;                                                           // chest over the knees
      armL.rotation.x = armR.rotation.x = -.85; armL.rotation.z = .1; armR.rotation.z = -.1; elbowL.rotation.x = elbowR.rotation.x = -.1;   // hands low, on the harness
    },
  };
}
export type Astronaut = ReturnType<typeof buildAstronaut>;

/** A small pressurised habitat: dome, airlock and a mast. A placeholder shape, not a real design. */
export function buildHabitat() {
  const g = new THREE.Group(), white = new THREE.MeshStandardMaterial({ color: 0xe9e6de, roughness: .7 }), grey = new THREE.MeshStandardMaterial({ color: 0x8b8d92, roughness: .6 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  add(new THREE.SphereGeometry(4.2, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), white, 0, 0, 0);
  add(new THREE.CylinderGeometry(4.25, 4.4, .5, 40), grey, 0, .25, 0);
  add(new RoundedBoxGeometry(2.4, 2.4, 3.4, 4, .3), white, 0, 1.2, 5);                 // airlock
  add(new THREE.BoxGeometry(1.1, 1.9, .1), grey, 0, 1.05, 6.72);                        // hatch
  add(new THREE.CylinderGeometry(.05, .05, 6, 8), grey, -3.2, 3, -2.4);                 // mast
  add(new THREE.BoxGeometry(3.4, .08, 1.6), new THREE.MeshStandardMaterial({ color: 0x1d2a4a, roughness: .4, metalness: .3 }), 6.4, .9, -1).rotation.z = -.35;   // solar panel
  return g;
}

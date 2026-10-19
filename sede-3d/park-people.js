import * as THREE from 'three';
import {restorePeacePose,applyPeacePose,peaceCollisionRadius} from './peace-behavior.js';
import { cloneCharacterMaterial } from './lighting.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createAppearance } from '../cube-world-lab/appearance.js';
import { findPath, isWalkable, segmentClear } from './navigation.js';

// IDS: reuse Cube World, seeded skin palettes and the office's swept collision
// checks. This module owns only four ambient people; they never become agents.
const PARK = { minX: -30, maxX: 30, minZ: -22, maxZ: 33 };
const BUILDING = { minX: -11.4, maxX: 11.4, minZ: -11.3, maxZ: 8.7 };
const node = (x, z, pause = 0, yaw = null) => ({ x, z, pause, yaw });
const ROUTES = [
  [node(-14, -13.8, 2.4), node(14, -13.8), node(14, 11.1, 3.2), node(-14, 11.1)],
  [node(14, 11.1), node(-14, 11.1, 2.3), node(-14, -13.8), node(14, -13.8, 2.8)],
  [node(-.66, 30.8, 4.2, Math.PI), node(-.66, 16.6), node(-21, 16.6), node(-21, 17.75, 6, 0), node(.66, 17.75), node(.66, 30.8)],
  [node(.66, 24), node(.66, 16.6), node(21, 16.6), node(21, 17.75, 5, 0), node(-.66, 17.75), node(-.66, 24, 3.6, Math.PI)],
];
const SPECS = [
  { model: 'cube-woman', height: 1.58, speed: .88 },
  { model: 'steve', height: 1.72, speed: .94 },
  { model: 'cube-guy', height: 1.66, speed: .82 },
  { model: 'cube-woman', height: 1.73, speed: .91 },
];
// An inscribed box leaves the starting point available when two round
// colliders are already close. Swept circle checks still enforce full radii.
const circleBox = person => { const half = person.radius / Math.SQRT2; return { minX: person.x - half, maxX: person.x + half, minZ: person.z - half, maxZ: person.z + half }; };

/** A deterministic promenade controller, independent of rendering and the agent simulation. */
export function createParkMovement({ getObstacles = () => [], getVisitor = () => null, getActors = () => [] } = {}) {
  const people = ROUTES.map((route, index) => ({
    id: `park-person-${index}`, x: route[0].x, z: route[0].z, radius: .44,
    yaw: 0, state: 'idle', speed: SPECS[index].speed, routeIndex: 1,
    pause: index * .85, wait: 0, retry: 0, path: [], pathIndex: 0, visited: 0, distance: 0, yielding: false,
    greetingCooldown: index * 2.3, gestureRemaining: 0, gestureTarget: null, greetings: 0, lookTime: 0, restYaw: 0,
  }));
  let disposed = false;
  const solids = () => [BUILDING, ...getObstacles()];
  function plan(person, obstacles) {
    const destination = ROUTES[people.indexOf(person)][person.routeIndex];
    // Every leg stays in a narrow corridor around the paved segment, even if
    // a bench or a visitor requires a small detour. No shortcut through rooms.
    const margin = 1.65;
    const bounds = {
      minX: Math.max(PARK.minX, Math.min(person.x, destination.x) - margin),
      maxX: Math.min(PARK.maxX, Math.max(person.x, destination.x) + margin),
      minZ: Math.max(PARK.minZ, Math.min(person.z, destination.z) - margin),
      maxZ: Math.min(PARK.maxZ, Math.max(person.z, destination.z) + margin),
    };
    const path = findPath(person, destination, obstacles, person.radius + .035, bounds);
    person.path = path || []; person.pathIndex = 1; person.retry = 1.4; person.yielding = false;
  }
  function detour(person, obstacles, others) {
    const destination = ROUTES[people.indexOf(person)][person.routeIndex], padding = person.radius + .025;
    const nearby = others.filter(other => Math.hypot(other.x-person.x,other.z-person.z)<4);
    const boxes = nearby.map(other => ({minX:other.x-other.radius-.04,maxX:other.x+other.radius+.04,minZ:other.z-other.radius-.04,maxZ:other.z+other.radius+.04}));
    const solids = [...obstacles,...boxes], candidates=[];
    // At close diagonal contact, a box around the other person can contain our
    // starting point even though the circles are separate. First take a swept,
    // collision-safe sidestep, then let the existing grid route around the box.
    for(const radius of [1.2,1.8])for(let i=0;i<12;i++){
      const angle=i*Math.PI/6,point={x:person.x+Math.cos(angle)*radius,z:person.z+Math.sin(angle)*radius};
      if(isWalkable(point.x,point.z,solids,padding,PARK)&&segmentClear(person,point,obstacles,padding,others,PARK))candidates.push(point);
    }
    candidates.sort((a,b)=>Math.hypot(a.x-destination.x,a.z-destination.z)-Math.hypot(b.x-destination.x,b.z-destination.z));
    for(const point of isWalkable(destination.x,destination.z,solids,padding,PARK)?candidates:[]){
      const bounds={minX:Math.max(PARK.minX,Math.min(person.x,point.x,destination.x)-1.65),maxX:Math.min(PARK.maxX,Math.max(person.x,point.x,destination.x)+1.65),minZ:Math.max(PARK.minZ,Math.min(person.z,point.z,destination.z)-1.65),maxZ:Math.min(PARK.maxZ,Math.max(person.z,point.z,destination.z)+1.65)};
      const path=findPath(point,destination,solids,padding,bounds);
      if(!path)continue;
      person.path=[{x:person.x,z:person.z},...path];person.pathIndex=1;person.retry=1.4;person.yielding=false;return true;
    }
    // Two walkers can occupy each other's next waypoint. One steps aside first
    // (stable ID priority); requiring a complete route here would deadlock both.
    const occupant=nearby.find(other=>Math.hypot(other.x-destination.x,other.z-destination.z)<other.radius+padding+.04);
    const shouldYield=!occupant?.id?.startsWith('park-person-')||person.id>occupant.id;
    if(shouldYield&&candidates.length){person.path=[{x:person.x,z:person.z},candidates[0]];person.pathIndex=1;person.retry=1.4;person.yielding=true;return true;}
    return false;
  }
  function update(dt) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(dt, .1), obstacles = solids(), candidate = getVisitor();
    const visitor = candidate && Number.isFinite(candidate.x) && Number.isFinite(candidate.z)
      && (!Number.isFinite(candidate.y) || candidate.y < 2)
      ? { x: candidate.x, z: candidate.z, radius: Number.isFinite(candidate.radius) ? Math.max(.2, candidate.radius) : .3 } : null;
    const actors = (getActors() || []).filter(actor => actor && [actor.x, actor.z, actor.radius].every(Number.isFinite)
      && actor.radius > 0 && (!Number.isFinite(actor.y) || actor.y < 2));
    for (const person of people) {
      if(person.peaceRoot?.userData.peaceBehavior)continue;
      const personIndex = people.indexOf(person);
      person.retry = Math.max(0, person.retry - step);
      person.greetingCooldown = Math.max(0, person.greetingCooldown - step);
      person.gestureRemaining = Math.max(0, person.gestureRemaining - step);
      if (person.pause > 0) {
        person.pause -= step; person.lookTime += step;
        const neighbors = [...people.filter(other => other !== person), ...actors, ...(visitor ? [visitor] : [])];
        if (!person.gestureRemaining && !person.greetingCooldown) {
          const target = neighbors.filter(other => {
            const gap = Math.hypot(other.x - person.x, other.z - person.z);
            return gap > 1.4 && gap < 3.8 && segmentClear(person, other, obstacles, .1, [], PARK);
          }).sort((a, b) => Math.hypot(a.x-person.x,a.z-person.z)-Math.hypot(b.x-person.x,b.z-person.z))[0];
          if (target) {
            person.gestureTarget = { x: target.x, z: target.z }; person.gestureRemaining = 1.4 + personIndex * .12;
            person.greetingCooldown = 18 + personIndex * 3; person.greetings++;
          }
        }
        if (person.gestureRemaining && person.gestureTarget) {
          person.state = 'waving'; person.yaw = Math.atan2(person.gestureTarget.x-person.x,person.gestureTarget.z-person.z);
        } else { person.state = 'looking'; person.yaw = person.restYaw + Math.sin(person.lookTime * .65 + personIndex) * .18; }
        continue;
      }
      const route = ROUTES[people.indexOf(person)], destination = route[person.routeIndex];
      if (Math.hypot(destination.x - person.x, destination.z - person.z) < .025) {
        person.pause = destination.pause; if (destination.yaw !== null) person.yaw = destination.yaw;
        person.restYaw = person.yaw; person.lookTime = 0; person.gestureRemaining = 0; person.gestureTarget = null;
        person.routeIndex = (person.routeIndex + 1) % route.length; person.visited++;
        person.path = []; person.retry = 0; person.state = 'idle'; continue;
      }
      if (!person.path.length && person.retry === 0) plan(person, obstacles);
      if (!person.path.length) { person.state = 'idle'; continue; }
      let target = person.path[person.pathIndex];
      if (Math.hypot(target.x - person.x, target.z - person.z) < .025 && person.pathIndex < person.path.length - 1) target = person.path[++person.pathIndex];
      const distance = Math.hypot(target.x - person.x, target.z - person.z);
      if(person.yielding&&distance<.025&&person.pathIndex===person.path.length-1){person.path=[];person.retry=0;person.yielding=false;person.state='idle';continue;}
      const travel = Math.min(distance, person.speed * step);
      const next = { x: person.x + (target.x - person.x) / (distance || 1) * travel, z: person.z + (target.z - person.z) / (distance || 1) * travel };
      const others = people.filter(other => other !== person).map(other => ({ id: other.id, x: other.x, z: other.z, radius: peaceCollisionRadius(other.peaceRoot,other.radius + .025) }));
      // Office agents now share the promenade. Their circle is checked on every
      // movement edge, including while an old route is waiting for a replan.
      others.push(...actors.filter(actor => actor.id !== person.id));
      if (visitor) others.push({ ...visitor, radius: visitor.radius + .12 });
      if (!segmentClear(person, next, obstacles, person.radius + .025, others, PARK)) {
        person.state = 'idle'; person.wait += step;
        if (person.wait > 1.3 && person.retry === 0) {
          // Yield first, then try a clear lane. Never push or relocate a visitor.
          const nearPeople = others.filter(other => Math.hypot(other.x - person.x, other.z - person.z) < 4)
            .map(other => circleBox({ ...other, radius: other.radius + .09 }))
            .filter(box => isWalkable(person.x, person.z, [box], person.radius + .035, PARK));
          if(!detour(person,obstacles,others))plan(person, [...obstacles, ...nearPeople]);
        }
        continue;
      }
      let facingX=target.x-person.x,facingZ=target.z-person.z;
      const upcoming=person.path[person.pathIndex+1];
      if(upcoming&&distance<.6){const blend=(1-distance/.6)*.55;facingX=facingX*(1-blend)+(upcoming.x-target.x)*blend;facingZ=facingZ*(1-blend)+(upcoming.z-target.z)*blend;}
      person.yaw = Math.atan2(facingX, facingZ);
      person.x = next.x; person.z = next.z; person.distance += travel;
      person.state = 'walking'; person.wait = 0;
    }
  }
  function getColliders() { return disposed ? [] : people.map(person => ({ id:person.id,x:person.x,z:person.z,radius:peaceCollisionRadius(person.peaceRoot,person.radius) })); }
  return { people, update, getColliders, dispose() { disposed = true; } };
}

function recolor(source, entry, appearance, textures) {
  if (!source?.image) return source;
  const canvas = document.createElement('canvas'); canvas.width = source.image.width; canvas.height = source.image.height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('Could not create the park character palette.');
  context.drawImage(source.image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height), original = new Uint8ClampedArray(pixels.data);
  for (const channel of ['shirt', 'hair', 'skin']) {
    const colors = entry.colorRegions?.[channel]; if (!colors?.length) continue;
    const replacement = [1, 3, 5].map(start => parseInt(appearance[channel].slice(start, start + 2), 16));
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (!colors.some(color => Math.hypot(original[i] - color[0], original[i + 1] - color[1], original[i + 2] - color[2]) < 10)) continue;
      for (let c = 0; c < 3; c++) pixels.data[i + c] = replacement[c];
    }
  }
  context.putImageData(pixels, 0, 0);
  const texture = source.clone(); texture.source = new THREE.Source(canvas);
  texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true; textures.add(texture); return texture;
}

/** Four local pedestrians. Shares model geometry, owns palettes, skeletons and mixers. */
export async function createParkPeople({ scene, manifest, loadModel, getObstacles, getVisitor, getActors }) {
  if (!scene?.isScene || !Array.isArray(manifest?.models) || typeof loadModel !== 'function') throw new TypeError('Park people require a scene, character manifest and model loader.');
  const movement = createParkMovement({ getObstacles, getVisitor, getActors }), group = new THREE.Group();
  group.name = 'Vida no parque · pedestres';
  const records = [], materials = new Set(), textures = new Set(), skeletons = new Set();
  let disposed = false;
  function dispose() {
    if (disposed) return; disposed = true; movement.dispose();
    records.forEach(record => { record.mixer.stopAllAction(); record.mixer.uncacheRoot(record.model); });
    materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose()); skeletons.forEach(skeleton => skeleton.dispose());
    group.removeFromParent();
  }
  try {
    const loaded = await Promise.all([...new Set(SPECS.map(spec => spec.model))].map(async id => {
      const entry = manifest.models.find(model => model.id === id); if (!entry) throw new Error(`Missing park model: ${id}`);
      const gltf = await loadModel(id); if (!gltf?.scene) throw new Error(`Park model failed to load: ${id}`); return [id, { entry, gltf }];
    }));
    const assets = new Map(loaded);
    for (const [index, spec] of SPECS.entries()) {
      const { entry, gltf } = assets.get(spec.model), appearance = createAppearance(`park-walker-${index}`, [spec.model]);
      const root = new THREE.Group(), model = cloneSkeleton(gltf.scene); root.name = `Passeante ${index + 1}`; root.userData.ambientPerson = true;
      model.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(model), height = box.max.y - box.min.y;
      if (!Number.isFinite(height) || height <= 0) throw new Error(`Invalid park character bounds: ${spec.model}`);
      const scale = spec.height / height; model.scale.setScalar(scale); model.position.y = -box.min.y * scale;
      const materialCache = new Map(), textureCache = new Map();
      function cloneMaterial(source) {
        if (materialCache.has(source)) return materialCache.get(source);
        const material = cloneCharacterMaterial(source); materials.add(material);
        if (source.map) {
          if (!textureCache.has(source.map)) textureCache.set(source.map, recolor(source.map, entry, appearance, textures));
          material.map = textureCache.get(source.map);
        }
        materialCache.set(source, material); return material;
      }
      model.traverse(object => {
        if (!object.isMesh) return;
        object.material = Array.isArray(object.material) ? object.material.map(cloneMaterial) : cloneMaterial(object.material);
        object.castShadow = true; object.receiveShadow = true; object.frustumCulled = false;
        if (object.skeleton) skeletons.add(object.skeleton);
      });
      root.add(model); group.add(root);
      const mixer = new THREE.AnimationMixer(model), actions = {};
      for (const source of gltf.animations || []) {
        const name = source.name.split('|').pop().replace(/\.\d+$/, ''); if (!['Walk', 'Idle', 'Wave'].includes(name) || actions[name]) continue;
        const clip = source.clone(); clip.tracks = clip.tracks.filter(track => !/^(CharacterArmature|Armature|Root)\.(position|quaternion)$/.test(track.name)); actions[name] = mixer.clipAction(clip);
      }
      const record = { root, model, mixer, actions, active: null, appearance, animationTime: 0 };
      records.push(record);movement.people[index].peaceRoot=root;root.position.set(movement.people[index].x, 0, movement.people[index].z);
      const idle = actions.Idle || actions.Walk; if (idle) { idle.play(); record.active = idle; mixer.update(index * .37); }
    }
    scene.add(group);
  } catch (error) { dispose(); throw error; }
  function update(dt, { camera } = {}) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return;
    movement.update(dt); const step = Math.min(dt, .1);
    records.forEach((record, index) => {
      const person = movement.people[index]; record.root.position.set(person.x, 0, person.z);
      const turn = Math.atan2(Math.sin(person.yaw - record.root.rotation.y), Math.cos(person.yaw - record.root.rotation.y));
      record.root.rotation.y += turn * Math.min(1, step * 8);
      const reaction=record.root.userData.peaceBehavior;restorePeacePose(record);
      const action = record.actions[reaction?(reaction.moving?'Walk':'Idle'):person.state === 'walking' ? 'Walk' : person.state === 'waving' ? 'Wave' : 'Idle'] || record.actions.Idle || record.actions.Walk;
      if (action && action !== record.active) { record.active?.fadeOut(.22); action.reset().fadeIn(.22).play(); record.active = action; }
      action?.setEffectiveTimeScale(reaction?.moving?2.4:1);
      record.animationTime += step;
      if (!camera?.position || camera.position.distanceTo(record.root.position) < 45 || record.animationTime >= .12) { record.mixer.update(record.animationTime); record.animationTime = 0; }
      applyPeacePose(record);record.root.userData.state = reaction?.phase||person.state;
    });
  }
  const getPeaceBindings=()=>records.map((record,index)=>{const person=movement.people[index];return {
    id:record.root.uuid,root:record.root,model:record.model,radius:person.radius+.025,bounds:PARK,launchHeight:1,
    getPosition:()=>({x:person.x,y:0,z:person.z}),setPosition:p=>{person.x=p.x;person.z=p.z;record.root.position.set(p.x,0,p.z);},setYaw:y=>{person.yaw=y;record.root.rotation.y=y;},
    getObstacles:()=>[BUILDING,...(getObstacles?.()||[])],getActors:()=>[...movement.getColliders().filter(p=>p.id!==person.id),...(getActors?.()||[]),...(getVisitor?.()?[getVisitor()]:[])],
    canMove:()=>true,begin:()=>!disposed,end:()=>{person.path=[];person.retry=0;person.wait=0;person.yielding=false;}
  };});
  return { update, getColliders: movement.getColliders, count: records.length, dispose,getPeaceBindings,
    getSnapshot: () => movement.people.map(({ id, x, z, state, visited, greetings }) => ({ id, x, z, state, visited, greetings })) };
}

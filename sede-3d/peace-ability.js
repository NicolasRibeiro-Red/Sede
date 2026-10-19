import * as THREE from 'three';

// Original comic prop. Reuse Three.js and the campus target hierarchy; no physics,
// renderer mutation, input listeners, imported weapon asset or persistent damage.
export const PEACE_RULES = Object.freeze({ capacity: 6, cooldown: .3, drawSeconds: .32, holsterSeconds: .26, reloadSeconds: 1.5, range: 48, particles: 64, marks: 12, tracers: 8, waves: 12 });
const UP = new THREE.Vector3(0, 0, 1), CENTER = new THREE.Vector2(), TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function rendered(object, materialIndex) {
  for (let node = object; node; node = node.parent) if (!node.visible || node.userData?.peaceIgnore) return false;
  const material = Array.isArray(object.material) ? object.material[materialIndex ?? 0] : object.material;
  return !material || (material.visible !== false && material.depthTest !== false && (!material.transparent || material.opacity > .02));
}

function surfaceMatrix(object, instanceId) {
  const matrix = object.matrixWorld.clone();
  if (object.isInstancedMesh && instanceId !== undefined) {
    const instance = new THREE.Matrix4(); object.getMatrixAt(instanceId, instance); matrix.multiply(instance);
  }
  return matrix;
}

/** Select the first visible surface, then its most specific registered owner. */
export function pickPeaceTarget(camera, targets, { near = .05, far = PEACE_RULES.range, origin, direction } = {}) {
  const entries = (Array.isArray(targets) ? targets : []).filter(target => target?.object?.isObject3D && ['actor', 'structure'].includes(target.kind));
  if (!camera?.isCamera || !entries.length) return null;
  camera.updateWorldMatrix(true, false);
  const roots = [...new Set(entries.map(target => target.object))];
  roots.forEach(root => root.updateWorldMatrix(true, true));
  // Three caches these bounds; walking/sitting bones can leave their old volume.
  const checked = new Set();
  roots.forEach(root => root.traverse(object => {
    if (!object.isSkinnedMesh || checked.has(object)) return;
    checked.add(object); object.skeleton?.update(); object.computeBoundingSphere();
    if (object.boundingBox) object.computeBoundingBox();
  }));
  const owners = new Map(entries.map(target => [target.object, target]));
  const ray = new THREE.Raycaster(); ray.near = near; ray.far = far;
  if (origin?.isVector3 && direction?.isVector3) ray.set(origin, direction.clone().normalize()); else ray.setFromCamera(CENTER, camera);
  for (const hit of ray.intersectObjects(roots, true)) {
    if (!rendered(hit.object, hit.face?.materialIndex)) continue;
    let owner = null;
    for (let node = hit.object; node; node = node.parent) if (owners.has(node)) { owner = owners.get(node); break; }
    if (!owner) continue;
    const matrix = surfaceMatrix(hit.object, hit.instanceId);
    const normal = hit.face?.normal?.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(matrix)).normalize() || ray.ray.direction.clone().negate();
    if (normal.dot(ray.ray.direction) > 0) normal.negate();
    return { target: owner, object: hit.object, point: hit.point.clone(), normal, direction: ray.ray.direction.clone(), distance: hit.distance, instanceId: hit.instanceId };
  }
  return null;
}

export function createPeaceAbility({ scene, camera, element, getTargets = () => [], onFeedback = () => {}, onShot = () => {}, reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false } = {}) {
  if (!scene?.isObject3D || !camera?.isCamera) throw new TypeError('A habilidade precisa da cena e da câmera do campus.');
  const geometries = new Set(), materials = new Set(), own = value => (geometries.add(value), value);
  const material = (color, options = {}) => {
    const value = new THREE.MeshStandardMaterial({ color, roughness: .48, metalness: .22, depthTest: true, depthWrite: true, fog: false, ...options });
    materials.add(value); return value;
  };
  const blue = material('#629c9c'), dark = material('#263640'), silver = material('#c8d5d4', { metalness: .48, roughness: .32 }), grip = material('#b7794e', { roughness: .8 }), gold = material('#dfbc72');
  const glove = material('#e2ded0', { metalness: 0, roughness: .9 }), seam = material('#b4b5aa', { metalness: 0, roughness: .9 });
  const cube = own(new THREE.BoxGeometry(1, 1, 1));
  const overlayScene = new THREE.Scene();
  overlayScene.add(new THREE.HemisphereLight('#e4f2f5', '#655b53', 2.2));
  const key = new THREE.DirectionalLight('#fff4df', 1.6); key.position.set(-2, 4, 3); overlayScene.add(key);
  const group = new THREE.Group(); group.name = 'A paz é a única opção · revólver de brincadeira'; group.userData.peaceIgnore = true;
  const hand = new THREE.Group(), model = new THREE.Group(); model.name = 'Revólver · escala confortável'; model.scale.setScalar(.85); group.add(hand); hand.add(model); overlayScene.add(group); group.visible = false;
  function mesh(geometry, surface, parent = model) { const value = new THREE.Mesh(geometry, surface); value.renderOrder = 1000; value.frustumCulled = false; parent.add(value); return value; }
  function box(size, position, surface, parent) { const value = mesh(cube, surface, parent); value.scale.set(...size); value.position.set(...position); return value; }
  function beveled(size, location, surface, parent = model, bevel = .005) {
    const [w, h, depth] = size, shape = new THREE.Shape();
    shape.moveTo(-w / 2 + bevel, -h / 2); shape.lineTo(w / 2 - bevel, -h / 2); shape.lineTo(w / 2, -h / 2 + bevel); shape.lineTo(w / 2, h / 2 - bevel); shape.lineTo(w / 2 - bevel, h / 2); shape.lineTo(-w / 2 + bevel, h / 2); shape.lineTo(-w / 2, h / 2 - bevel); shape.lineTo(-w / 2, -h / 2 + bevel); shape.closePath();
    const geometry = own(new THREE.ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1 })); geometry.translate(0, 0, -depth / 2 + bevel);
    const part = mesh(geometry, surface, parent); part.position.set(...location); return part;
  }
  // A thin open frame exposes the drum instead of presenting a solid blue block.
  beveled([.102, .023, .215], [0, .108, -.014], blue);
  beveled([.086, .025, .175], [0, -.046, .006], blue);
  beveled([.083, .132, .032], [0, .026, .086], blue);
  const hammer = beveled([.028, .048, .036], [0, .117, .09], dark); hammer.rotation.x = -.28;
  const handle = beveled([.073, .174, .074], [0, -.142, .094], grip, model, .008); handle.rotation.x = -.28;
  const handlePanel = beveled([.009, .126, .062], [.041, -.142, .094], dark, model, .003); handlePanel.rotation.x = -.28;
  beveled([.084, .019, .084], [0, -.225, .117], gold);
  const screw = mesh(own(new THREE.CylinderGeometry(.008, .008, .004, 8)), gold); screw.rotation.z = Math.PI / 2; screw.position.set(.049, -.136, .092);
  const guard = mesh(own(new THREE.TorusGeometry(.044, .008, 6, 18)), dark); guard.rotation.y = Math.PI / 2; guard.scale.set(1.12, .86, 1); guard.position.set(0, -.09, -.015);
  const trigger = mesh(own(new THREE.TorusGeometry(.025, .005, 5, 10, 1.8)), gold); trigger.rotation.set(.2, Math.PI / 2, .4); trigger.position.set(0, -.067, -.003);
  const barrel = mesh(own(new THREE.CylinderGeometry(.032, .037, .26, 8)), blue); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, .061, -.219);
  const underlug = beveled([.039, .025, .25], [0, .025, -.214], silver);
  underlug.name = 'Cano octogonal · contrapeso';
  const muzzle = mesh(own(new THREE.TorusGeometry(.025, .008, 6, 12)), silver); muzzle.position.set(0, .061, -.351);
  const bore = mesh(own(new THREE.CircleGeometry(.024, 12)), dark); bore.rotation.y = Math.PI; bore.position.set(0, .061, -.349);
  beveled([.012, .025, .027], [0, .1, -.32], dark, model, .002);
  box([.006, .007, .01], [0, .114, -.32], gold);
  beveled([.048, .012, .024], [0, .127, .055], dark, model, .002);
  const cylinderHinge = new THREE.Group(), cylinder = new THREE.Group(); model.add(cylinderHinge); cylinderHinge.position.set(0, .027, -.006); cylinderHinge.add(cylinder); cylinder.name = 'Tambor · seis câmaras';
  const drum = mesh(own(new THREE.CylinderGeometry(.067, .067, .118, 24)), silver, cylinder); drum.rotation.x = Math.PI / 2;
  const chamberGeometry = own(new THREE.CylinderGeometry(.0145, .0145, .004, 10)); chamberGeometry.rotateX(Math.PI / 2);
  const chambers = new THREE.InstancedMesh(chamberGeometry, dark, 12); chambers.name = 'Seis câmaras · frente e verso'; chambers.renderOrder = 1001; cylinder.add(chambers);
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3();
  const lips = new THREE.InstancedMesh(own(new THREE.TorusGeometry(.015, .003, 4, 10)), gold, 12); lips.renderOrder = 1000; cylinder.add(lips);
  const flutes = new THREE.InstancedMesh(own(new THREE.BoxGeometry(.017, .003, .071)), blue, 6); flutes.renderOrder = 1000; cylinder.add(flutes);
  for (let side = 0; side < 2; side++) for (let i = 0; i < 6; i++) { const angle = i * TAU / 6; matrix.makeTranslation(Math.cos(angle) * .041, Math.sin(angle) * .041, side ? .060 : -.060); chambers.setMatrixAt(side * 6 + i, matrix); lips.setMatrixAt(side * 6 + i, matrix); }
  for (let i = 0; i < 6; i++) { const angle = i * TAU / 6; rotation.setFromAxisAngle(UP, angle - Math.PI / 2); matrix.compose(position.set(Math.cos(angle) * .067, Math.sin(angle) * .067, 0), rotation, scale.setScalar(1)); flutes.setMatrixAt(i, matrix); }
  const axis = mesh(own(new THREE.CylinderGeometry(.009, .009, .128, 8)), dark, cylinder); axis.rotation.x = Math.PI / 2;
  chambers.instanceMatrix.needsUpdate = true;
  // Compact glove: separate bent fingers, thumb and cuff, leaving the frame clear.
  const palm = beveled([.065, .104, .068], [.021, -.157, .134], glove, model, .009); palm.rotation.x = -.28;
  for (let i = 0; i < 3; i++) { const finger = beveled([.063, .021, .038], [.017, -.122 - i * .026, .058 + i * .006], glove, model, .006); finger.rotation.x = -.2; }
  const thumb = beveled([.026, .071, .033], [.051, -.105, .113], glove, model, .006); thumb.rotation.z = -.32;
  const indexFinger = beveled([.026, .023, .079], [.047, -.073, .028], glove, model, .006); indexFinger.rotation.x = -.15;
  beveled([.071, .025, .073], [.021, -.214, .153], seam, model, .005);
  const sleeve = beveled([.089, .105, .105], [.023, -.269, .18], dark, model, .009); sleeve.rotation.x = -.22;
  const starShape = new THREE.Shape();
  for (let i = 0; i < 12; i++) { const angle = i * Math.PI / 6, radius = i % 2 ? .025 : .069; const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius; if (!i) starShape.moveTo(x, y); else starShape.lineTo(x, y); } starShape.closePath();
  const flashMaterial = new THREE.MeshBasicMaterial({ color: '#ffe09b', side: THREE.DoubleSide, depthTest: true, depthWrite: true, toneMapped: false }); materials.add(flashMaterial);
  const flash = mesh(own(new THREE.ShapeGeometry(starShape)), flashMaterial); flash.name = 'Estrela de paz · boca do cano'; flash.position.set(0, .061, -.375); flash.visible = false;
  const muzzlePoint = new THREE.Object3D(); muzzlePoint.name = 'Boca do cano · origem do disparo'; muzzlePoint.position.set(0, .061, -.37); model.add(muzzlePoint);

  const effects = new THREE.Group(); effects.name = 'Paz · confetes e marcas temporárias'; effects.userData.peaceIgnore = true; scene.add(effects);
  const confettiMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', depthWrite: false, toneMapped: false }); materials.add(confettiMaterial);
  const confetti = new THREE.InstancedMesh(own(new THREE.BoxGeometry(.035, .065, .015)), confettiMaterial, PEACE_RULES.particles); confetti.frustumCulled = false; effects.add(confetti);
  const markMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, toneMapped: false }); materials.add(markMaterial);
  const marks = new THREE.InstancedMesh(own(new THREE.RingGeometry(.055, .08, 16)), markMaterial, PEACE_RULES.marks); marks.frustumCulled = false; effects.add(marks);
  const tracerMaterial = new THREE.MeshBasicMaterial({ color: '#ffdf87', depthTest: true, depthWrite: false, toneMapped: false }); materials.add(tracerMaterial);
  const tracers = new THREE.InstancedMesh(own(new THREE.CylinderGeometry(1, 1, 1, 6)), tracerMaterial, PEACE_RULES.tracers); tracers.name = 'Rastros · propostas de paz'; tracers.frustumCulled = false; effects.add(tracers);
  const heads = new THREE.InstancedMesh(own(new THREE.OctahedronGeometry(.09, 0)), tracerMaterial, PEACE_RULES.tracers); heads.frustumCulled = false; effects.add(heads);
  const waveMaterial = new THREE.MeshBasicMaterial({ color: '#dbf3e9', transparent: true, opacity: .65, depthTest: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }); materials.add(waveMaterial);
  const waves = new THREE.InstancedMesh(own(new THREE.RingGeometry(.1, .13, 16)), waveMaterial, PEACE_RULES.waves); waves.frustumCulled = false; effects.add(waves);
  const palette = ['#f1d87a', '#8ed1cb', '#f3b3a8', '#b6b9ed'];
  const particles = Array.from({ length: PEACE_RULES.particles }, () => ({ age: 99, life: .8, position: new THREE.Vector3(), velocity: new THREE.Vector3() }));
  const stamps = Array.from({ length: PEACE_RULES.marks }, () => ({ age: 99, life: 5, position: new THREE.Vector3(), normal: new THREE.Vector3(), rotation: new THREE.Quaternion(), object: null, instanceId: undefined }));
  const bolts = Array.from({ length: PEACE_RULES.tracers }, () => ({ age: 99, life: 1, start: new THREE.Vector3(), end: new THREE.Vector3(), direction: new THREE.Vector3(), head: new THREE.Vector3(), distance: 0 }));
  const pulses = Array.from({ length: PEACE_RULES.waves }, () => ({ age: 99, life: .4, position: new THREE.Vector3(), direction: new THREE.Vector3(), rotation: new THREE.Quaternion() }));
  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  particles.forEach((_, i) => { confetti.setMatrixAt(i, hiddenMatrix); confetti.setColorAt(i, new THREE.Color(palette[i % palette.length])); });
  stamps.forEach((_, i) => { marks.setMatrixAt(i, hiddenMatrix); marks.setColorAt(i, new THREE.Color(palette[i % palette.length])); });
  bolts.forEach((_, i) => { tracers.setMatrixAt(i, hiddenMatrix); heads.setMatrixAt(i, hiddenMatrix); }); pulses.forEach((_, i) => waves.setMatrixAt(i, hiddenMatrix));
  for (const pool of [confetti, marks, tracers, heads, waves]) pool.instanceMatrix.needsUpdate = true;
  let particleIndex = 0, markIndex = 0, boltIndex = 0, waveIndex = 0, elapsed = 0, enabled = true, equipped = false, active = false, running = true, ammo = PEACE_RULES.capacity;
  let reloadTime = 0, cooldown = 0, draw = 0, recoil = 0, drumAngle = 0, drumTarget = 0, shots = 0, disposed = false, lastHit = null, lastShot = null, audioContext = null;
  function feedback(kind, extra = {}) { try { onFeedback({ kind, ...extra }); } catch { /* UI failure must not break the scene. */ } }
  function sound(empty = false) {
    if (reducedMotion || !element?.ownerDocument?.defaultView) return;
    const win = element.ownerDocument.defaultView, Audio = win.AudioContext || win.webkitAudioContext;
    if (!Audio) return;
    try {
      audioContext ||= new Audio(); if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(), now = audioContext.currentTime;
      oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(empty ? 210 : 380, now); oscillator.frequency.exponentialRampToValueAtTime(empty ? 140 : 90, now + .07);
      gain.gain.setValueAtTime(.018, now); gain.gain.exponentialRampToValueAtTime(.0001, now + .085); oscillator.connect(gain); gain.connect(audioContext.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); }; oscillator.start(now); oscillator.stop(now + .09);
    } catch { /* Audio is optional, including autoplay-restricted browsers. */ }
  }
  function impact(hit) {
    const count = reducedMotion ? 3 : 8;
    for (let i = 0; i < count; i++) {
      const particle = particles[particleIndex++ % particles.length], angle = i * TAU / count + shots * .7;
      particle.age = 0; particle.life = reducedMotion ? .45 : .7 + i * .035;
      particle.position.copy(hit.point).addScaledVector(hit.normal, .035);
      particle.velocity.set(Math.cos(angle) * .75, .6 + (i % 3) * .12, Math.sin(angle) * .75).addScaledVector(hit.normal, .6);
      if (reducedMotion) particle.velocity.multiplyScalar(.3);
    }
    if (hit.target.kind === 'structure') {
      const stamp = stamps[markIndex++ % stamps.length], matrix = surfaceMatrix(hit.object, hit.instanceId);
      stamp.age = 0; stamp.object = hit.object; stamp.instanceId = hit.instanceId;
      stamp.position.copy(hit.point).applyMatrix4(matrix.clone().invert());
      stamp.normal.copy(hit.normal).applyMatrix3(new THREE.Matrix3().getNormalMatrix(matrix).invert()).normalize();
    }
  }
  function launch(start, end) {
    const bolt = bolts[boltIndex++ % bolts.length]; bolt.start.copy(start); bolt.end.copy(end); bolt.direction.subVectors(end, start); bolt.distance = bolt.direction.length(); bolt.direction.normalize(); bolt.head.copy(start); bolt.age = 0;
    // The projectile is gameplay feedback: keep its travel legible regardless of
    // decorative-motion preference. Reduced motion still removes recoil/flash/waves.
    bolt.life = clamp(.20 + bolt.distance / 45, .26, .72);
    if (!reducedMotion) for (let i = 0; i < 2; i++) {
      const pulse = pulses[waveIndex++ % pulses.length]; pulse.age = -i * .045; pulse.position.copy(start); pulse.direction.copy(bolt.direction); pulse.rotation.setFromUnitVectors(UP, pulse.direction);
    }
    updateEffects(0);
  }
  function setEnabled(value) {
    if (disposed) return false;
    enabled = Boolean(value);
    if (!enabled) holster();
    return enabled;
  }
  function holster({ immediate = false } = {}) {
    if (disposed) return false;
    const changed = equipped || reloadTime > 0;
    equipped = false; reloadTime = 0; recoil = 0; flash.visible = false;
    if (immediate) { draw = 0; group.visible = false; }
    if (changed) feedback('holstered', { label: 'Revólver guardado.' });
    return changed;
  }
  function toggle() {
    if (disposed || !enabled || !active || !running) return false;
    if (equipped) { holster(); return false; }
    equipped = true;
    feedback('equipped', { label: 'A paz é a única opção' }); return true;
  }
  function fire() {
    if (disposed || !enabled || !equipped || !active || !running || reloadTime > 0 || cooldown > 0 || draw < .99) return false;
    if (!ammo) { cooldown = PEACE_RULES.cooldown; sound(true); feedback('empty', { label: 'Acabou a diplomacia. R para recarregar.' }); return false; }
    ammo--; shots++; cooldown = PEACE_RULES.cooldown; recoil = reducedMotion ? 0 : 1; drumTarget += TAU / PEACE_RULES.capacity; sound();
    const targets = getTargets(), origin = camera.getWorldPosition(new THREE.Vector3()), aim = camera.getWorldDirection(new THREE.Vector3());
    let hit = pickPeaceTarget(camera, targets);
    const end = hit ? hit.point.clone() : origin.clone().addScaledVector(aim, PEACE_RULES.range);
    group.updateWorldMatrix(true, true); const muzzleOrigin = muzzlePoint.getWorldPosition(new THREE.Vector3()), cameraToMuzzle = muzzleOrigin.clone().sub(origin), muzzleDistance = cameraToMuzzle.length();
    // The overlay never clips into walls visually. Its world-space shot still must:
    // prevent a muzzle beyond a nearby wall from sending a tracer through it.
    const obstruction = pickPeaceTarget(camera, targets, { origin, direction: cameraToMuzzle, near: .01, far: muzzleDistance });
    if (obstruction) muzzleOrigin.copy(obstruction.point).addScaledVector(obstruction.normal, .025);
    const flight = end.clone().sub(muzzleOrigin), distance = flight.length();
    const crossedSurface = distance > .001 ? pickPeaceTarget(camera, targets, { origin: muzzleOrigin, direction: flight, near: .001, far: distance + .002 }) : null;
    if (crossedSurface) { hit = crossedSurface; end.copy(hit.point); }
    launch(muzzleOrigin, end);
    lastShot = { shotId: shots, origin: origin.toArray(), direction: aim.toArray(), muzzle: muzzleOrigin.toArray(), end: end.toArray(), targetId: hit?.target.id || null, muzzleBlocked: Boolean(obstruction) };
    try { onShot({ shotId: shots, origin: origin.clone(), direction: aim.clone(), muzzle: muzzleOrigin.clone(), end: end.clone(), hit, targetId: hit?.target.id || null }); } catch { /* Optional proximity reactions must not break a shot. */ }
    lastHit = hit ? { targetId: hit.target.id, kind: hit.target.kind, label: hit.target.label || hit.target.id, distance: hit.distance, point: hit.point.toArray() } : null;
    if (hit) {
      impact(hit);
      try { hit.target.onHit?.({ ...hit, targetId: hit.target.id }); } catch { feedback('reaction-error', { targetId: hit.target.id, label: 'A reação deste personagem está indisponível.' }); }
      feedback('hit', { ...lastHit, kind: 'hit', targetKind: hit.target.kind });
    } else feedback('miss', { label: 'Diplomacia enviada ao horizonte.' });
    return true;
  }
  function reload() {
    if (disposed || !enabled || !equipped || !active || !running || draw < .99 || reloadTime > 0 || ammo === PEACE_RULES.capacity) return false;
    reloadTime = PEACE_RULES.reloadSeconds; feedback('reload', { label: 'Recarregando a paz…' }); return true;
  }
  function updateEffects(dt) {
    let dirtyParticles = false, dirtyMarks = false;
    particles.forEach((particle, index) => {
      if (particle.age >= particle.life) return;
      dirtyParticles = true; particle.age += dt;
      if (particle.age >= particle.life) { confetti.setMatrixAt(index, hiddenMatrix); return; }
      particle.velocity.y -= dt * 1.9; particle.position.addScaledVector(particle.velocity, dt);
      const fade = Math.min(1, (1 - particle.age / particle.life) * 3);
      rotation.setFromEuler(new THREE.Euler(particle.age * 4, index, particle.age * 3)); matrix.compose(particle.position, rotation, scale.setScalar(fade)); confetti.setMatrixAt(index, matrix);
    });
    stamps.forEach((stamp, index) => {
      if (stamp.age >= stamp.life) return;
      dirtyMarks = true; stamp.age += dt;
      if (stamp.age >= stamp.life) { marks.setMatrixAt(index, hiddenMatrix); return; }
      if (!rendered(stamp.object)) { marks.setMatrixAt(index, hiddenMatrix); return; }
      stamp.object.updateWorldMatrix(true, false);
      const transform = surfaceMatrix(stamp.object, stamp.instanceId), normal = stamp.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(transform)).normalize();
      position.copy(stamp.position).applyMatrix4(transform).addScaledVector(normal, .014); stamp.rotation.setFromUnitVectors(UP, normal);
      matrix.compose(position, stamp.rotation, scale.setScalar(Math.min(1, (stamp.life - stamp.age) * 1.6))); marks.setMatrixAt(index, matrix);
    });
    confetti.instanceMatrix.needsUpdate = dirtyParticles; marks.instanceMatrix.needsUpdate = dirtyMarks;
    let dirtyBolts = false, dirtyWaves = false;
    bolts.forEach((bolt, index) => {
      if (bolt.age >= bolt.life) return;
      dirtyBolts = true; bolt.age += dt;
      if (bolt.age >= bolt.life) { bolt.head.copy(bolt.end); tracers.setMatrixAt(index, hiddenMatrix); heads.setMatrixAt(index, hiddenMatrix); return; }
      const traveled = Math.min(bolt.distance, Math.max(.03, bolt.distance * bolt.age / bolt.life));
      const tail = Math.min(traveled, clamp(bolt.distance * .2, .18, 1.4));
      bolt.head.copy(bolt.start).addScaledVector(bolt.direction, traveled);
      rotation.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bolt.direction);
      position.copy(bolt.head).addScaledVector(bolt.direction, -tail / 2);
      matrix.compose(position, rotation, scale.set(.038, tail, .038)); tracers.setMatrixAt(index, matrix);
      matrix.compose(bolt.head, rotation, scale.setScalar(1)); heads.setMatrixAt(index, matrix);
    });
    pulses.forEach((pulse, index) => {
      if (pulse.age >= pulse.life) return;
      dirtyWaves = true; pulse.age += dt;
      if (pulse.age < 0 || pulse.age >= pulse.life) { waves.setMatrixAt(index, hiddenMatrix); return; }
      const progress = pulse.age / pulse.life; position.copy(pulse.position).addScaledVector(pulse.direction, progress * .24);
      matrix.compose(position, pulse.rotation, scale.setScalar((.3 + progress * 1.8) * Math.min(1, (1 - progress) * 5))); waves.setMatrixAt(index, matrix);
    });
    tracers.instanceMatrix.needsUpdate = dirtyBolts; heads.instanceMatrix.needsUpdate = dirtyBolts; waves.instanceMatrix.needsUpdate = dirtyWaves;
  }
  function update(delta, context = {}) {
    if (disposed) return;
    active = Boolean(context.active); running = context.running !== false;
    const dt = running && Number.isFinite(delta) ? clamp(delta, 0, .1) : 0;
    elapsed += dt; cooldown = Math.max(0, cooldown - dt);
    if (reloadTime > 0) { reloadTime = Math.max(0, reloadTime - dt); if (!reloadTime) { ammo = PEACE_RULES.capacity; feedback('reloaded', { label: 'Seis novas propostas de paz.' }); } }
    const target = enabled && equipped && active ? 1 : 0;
    draw = clamp(draw + (target ? 1 : -1) * dt / (target ? PEACE_RULES.drawSeconds : PEACE_RULES.holsterSeconds), 0, 1);
    if (!active) draw = 0;
    recoil = Math.max(0, recoil - dt * 7); drumAngle += (drumTarget - drumAngle) * (1 - Math.exp(-dt * 23));
    group.visible = active && draw > 0;
    camera.getWorldPosition(group.position); camera.getWorldQuaternion(group.quaternion);
    const smoothDraw = draw * draw * (3 - 2 * draw), reloadProgress = reloadTime ? 1 - reloadTime / PEACE_RULES.reloadSeconds : 0;
    const swing = reloadTime ? Math.sin(reloadProgress * Math.PI) : 0, moving = clamp(Number(context.moving) || 0, 0, 1);
    hand.position.set(.16, -.135 - (1 - smoothDraw) * .32, -.51 + recoil * .021);
    hand.rotation.set((1 - smoothDraw) * .7 + recoil * .065 - swing * .12, .17, -.06 - swing * .25);
    if (!reducedMotion) { hand.position.y += Math.sin(elapsed * 7) * .0025 * moving; hand.position.x += Math.sin(elapsed * 3.5) * .002 * moving; }
    cylinderHinge.position.x = -.105 * swing; cylinder.rotation.z = drumAngle + swing * Math.PI * 1.5; flash.visible = !reducedMotion && group.visible && recoil > .42 && running;
    flash.rotation.z = shots * .45; flash.scale.setScalar(.7 + (1 - recoil) * .6);
    updateEffects(dt);
  }
  function getSnapshot() {
    return { name: 'A paz é a única opção', enabled, equipped, visible: group.visible, active, running, ammo, capacity: PEACE_RULES.capacity, reloading: reloadTime > 0,
      transition: equipped ? (draw < .99 ? 'drawing' : 'ready') : (draw > 0 ? 'holstering' : 'holstered'),
      reloadProgress: reloadTime ? 1 - reloadTime / PEACE_RULES.reloadSeconds : 0, cooldown, draw, shots, lastHit, reducedMotion, disposed,
      particles: particles.filter(item => item.age < item.life).length, marks: stamps.filter(item => item.age < item.life).length, drumAngle, recoil, lastShot,
      tracers: bolts.filter(item => item.age < item.life).map(item => ({ age: item.age, life: item.life, start: item.start.toArray(), end: item.end.toArray(), head: item.head.toArray() })), waves: pulses.filter(item => item.age >= 0 && item.age < item.life).length };
  }
  function renderOverlay(renderer) {
    if (disposed || !group.visible || !renderer?.render) return;
    // The campus composites its distant horizon after the scene. Draw the prop
    // last, retaining target/layers/color and clearing only depth. Normal depth
    // testing then keeps the rear chambers hidden behind the solid cylinder.
    const autoClear = renderer.autoClear;
    try { renderer.autoClear = false; renderer.clearDepth(); renderer.render(overlayScene, camera); }
    finally { renderer.autoClear = autoClear; }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; equipped = false; active = false; enabled = false; reloadTime = 0; group.visible = false;
    group.removeFromParent(); effects.removeFromParent(); geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose());
    audioContext?.close?.().catch(() => {}); audioContext = null;
  }
  return { group, effects, toggle, holster, setEnabled, fire, reload, update, renderOverlay, getSnapshot, dispose };
}

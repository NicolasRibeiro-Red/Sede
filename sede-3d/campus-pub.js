import * as THREE from 'three';
import {restorePeacePose,applyPeacePose,peaceCollisionRadius} from './peace-behavior.js';
import { cloneCharacterMaterial } from './lighting.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAppearance } from '../cube-world-lab/appearance.js';
import { moveWithCollision } from './navigation.js';

// IDS: Cube World clones/palettes follow park-people.js.
// Only new pub geometry, cloned materials and rigs are owned.
const BOUNDS = { minX: -55.65, maxX: -33.35, minZ: -7.65, maxZ: 13.65 };
const STAFF = [
  { id: 'pub-bartender', name: 'Ben', model: 'cube-guy', height: 1.76, x: -45.5, z: -2, yaw: 0, bartender: true },
  { id: 'pub-patron-1', name: 'Júlia', model: 'cube-woman', height: 1.62, x: -50.2, z: 5, yaw: 0, seated: true },
  { id: 'pub-patron-2', name: 'Tom', model: 'steve', height: 1.72, x: -50.2, z: 8, yaw: Math.PI, seated: true },
  { id: 'pub-patron-3', name: 'Eva', model: 'cube-woman', height: 1.68, x: -38.5, z: 3.2, yaw: Math.PI },
  { id: 'pub-patron-4', name: 'Ivo', model: 'cube-guy', height: 1.7, x: -38.5, z: 5, yaw: 0, seated: true },
  { id: 'pub-patron-5', name: 'Lia', model: 'cube-woman', height: 1.65, x: -38.5, z: 8, yaw: Math.PI, seated: true },
  { id: 'pub-patron-6', name: 'Bia', model: 'cube-woman', height: 1.66, x: -40, z: 10.8, yaw: Math.PI / 3, dancer: true },
  { id: 'pub-patron-7', name: 'Caio', model: 'steve', height: 1.73, x: -38.4, z: 11.3, yaw: Math.PI, dancer: true },
  { id: 'pub-patron-8', name: 'Sol', model: 'cube-guy', height: 1.69, x: -36.8, z: 10.2, yaw: -Math.PI / 3, dancer: true },
];

// Original lines written for Ben: inspirations, never attributed quotations.
// Each completed order advances once; all nine are heard before the cycle repeats.
const REFLECTION_SECONDS = 14;
const REFLECTIONS = [
  { inspiration: 'Friedrich Nietzsche', text: 'Quem vive só de aprovação acaba terceirizando a própria coragem.' },
  { inspiration: 'Arthur Schopenhauer', text: 'O desejo pede outro copo; a paz talvez esteja em saborear este.' },
  { inspiration: 'Zygmunt Bauman', text: 'Se tudo passa depressa, ficar presente já é uma forma de resistência.' },
  { inspiration: 'Friedrich Nietzsche', text: 'Antes de conquistar o mundo, descubra quais vontades são realmente suas.' },
  { inspiration: 'Arthur Schopenhauer', text: 'Às vezes, o melhor luxo é uma vontade que deixou de mandar em você.' },
  { inspiration: 'Zygmunt Bauman', text: 'Conexão cabe na tela; encontro exige um pouco mais de demora.' },
  { inspiration: 'Friedrich Nietzsche', text: 'Nem toda subida merece seu esforço. Escolha a montanha antes da pressa.' },
  { inspiration: 'Arthur Schopenhauer', text: 'Um intervalo não resolve tudo, mas devolve silêncio ao que estava gritando.' },
  { inspiration: 'Zygmunt Bauman', text: 'Relações leves demais podem evaporar antes de virar abrigo.' },
];

/** Local interactive pub; no purchases, remote services or agent metrics. */
export async function createCampusPub({ scene, manifest, loadModel, getVisitor = () => null, getActors = () => [] }) {
  if (!scene?.isScene || !Array.isArray(manifest?.models) || typeof loadModel !== 'function') throw new TypeError('The pub requires a scene, character manifest and model loader.');
  const group = new THREE.Group(); group.name = 'THE WAIT PUB · pausa no campus';
  const roof = new THREE.Group(); roof.name = 'Pub · teto removível'; group.add(roof); roof.visible = false;
  const obstacles = [], records = [], materials = new Set(), textures = new Set(), geometries = new Set(), skeletons = new Set();
  const queues = new Map(), queue = [];
  let disposed = false, elapsed = 0, orders = 0, drinksServed = 0, activeOrder = null, serviceSeconds = 0, lastServed = 0, night = 0, musicPlaying = false, musicSeconds = 0;
  let philosophy = null, speechHold = 0;
  const speakerPosition = new THREE.Vector3();
  const ownGeometry = geometry => (geometries.add(geometry), geometry);
  const ownMaterial = material => (materials.add(material), material);
  const boxGeometry = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const cylinderGeometry = ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 8));
  const leafGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 0));
  const palette = {
    plaster: '#e1cfaa', wood: '#946443', timber: '#573e32', green: '#354f43', stone: '#d3c5ab',
    brass: '#be9658', burgundy: '#87544c', paper: '#eee2c2', leaf: '#63805c', bottle: '#557663',
  };
  const mats = Object.fromEntries(Object.entries(palette).map(([name, color]) => [name, ownMaterial(new THREE.MeshStandardMaterial({ color, roughness: name === 'brass' ? 0.4 : 0.86, metalness: name === 'brass' ? 0.45 : 0 }))]));
  const lampMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#ffe4ad', emissive: '#ffdb94', emissiveIntensity: 0.8, roughness: 0.4 }));
  const glassMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#a5b5a2', transparent: true, opacity: 0.13, roughness: 0.2, metalness: 0.05, depthWrite: false }));
  const lights = [[-47, 2.9, 1], [-40, 2.9, 8]].map((position, index) => {
    const light = new THREE.PointLight('#ffe9cf', 12, 26, 2); light.position.set(...position); light.name = index ? 'Pub · luz quente lateral' : 'Pub · luz quente'; group.add(light); return light;
  });
  const floorMaterials = ['#946f52', '#987357'].map(color => ownMaterial(new THREE.MeshStandardMaterial({ color, roughness: .86 })));
  const danceMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#9e7958', roughness: .78, emissive: '#dbb27b', emissiveIntensity: .04 }));

  function solid(x, z, width, depth, id) { obstacles.push({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2, id: `pub-${id}` }); }
  function part(material, size, position, parent = group, geometry = boxGeometry, yaw = 0) {
    if (!queues.has(parent)) queues.set(parent, new Map());
    const batches = queues.get(parent), key = `${material.uuid}:${geometry.uuid}`;
    if (!batches.has(key)) batches.set(key, { material, geometry, instances: [] });
    batches.get(key).instances.push({ position, size, yaw });
  }
  function flush() {
    const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3();
    for (const [parent, batches] of queues) for (const { material, geometry, instances } of batches.values()) {
      const batch = new THREE.InstancedMesh(geometry, material, instances.length);
      instances.forEach((item, index) => { position.set(...item.position); scale.set(...item.size); quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, item.yaw); matrix.compose(position, quaternion, scale); batch.setMatrixAt(index, matrix); });
      batch.instanceMatrix.needsUpdate = true; batch.castShadow = material !== lampMaterial && material !== glassMaterial && !floorMaterials.includes(material);
      if (floorMaterials.includes(material)) batch.name = 'Pub · tábuas do assoalho';
      batch.receiveShadow = material !== lampMaterial; parent.add(batch);
    }
    queues.clear();
  }
  function sign(title, subtitle, width, height, position, color = '#e9d6ac') {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('The pub signage canvas is unavailable.');
    ctx.fillStyle = '#29463c'; ctx.fillRect(0, 0, 1024, 256); ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 91px Inter, Arial, sans-serif'; ctx.fillText(title, 512, subtitle ? 99 : 132, 944);
    if (subtitle) { ctx.font = '31px Inter, Arial, sans-serif'; ctx.fillText(subtitle, 512, 190, 930); }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
    const material = ownMaterial(new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: '#ffffff', emissiveIntensity: 0.3, roughness: 0.8 }));
    const mesh = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(width, height)), material); mesh.position.set(...position); mesh.name = title; mesh.userData.text = title; group.add(mesh); return mesh;
  }
  function recolor(source, entry, appearance) {
    if (!source?.image) return source;
    const canvas = document.createElement('canvas'); canvas.width = source.image.width; canvas.height = source.image.height;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('The pub avatar palette is unavailable.');
    ctx.drawImage(source.image, 0, 0); const image = ctx.getImageData(0, 0, canvas.width, canvas.height), original = new Uint8ClampedArray(image.data);
    for (const channel of ['shirt', 'hair', 'skin']) {
      const sources = entry.colorRegions?.[channel]; if (!sources?.length) continue;
      const color = [1, 3, 5].map(start => parseInt(appearance[channel].slice(start, start + 2), 16));
      for (let index = 0; index < image.data.length; index += 4) {
        if (!sources.some(rgb => Math.hypot(original[index] - rgb[0], original[index + 1] - rgb[1], original[index + 2] - rgb[2]) < 10)) continue;
        for (let component = 0; component < 3; component++) image.data[index + component] = color[component];
      }
    }
    ctx.putImageData(image, 0, 0); const texture = source.clone(); texture.source = new THREE.Source(canvas);
    texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false; texture.needsUpdate = true; textures.add(texture); return texture;
  }
  function dispose() {
    if (disposed) return; disposed = true; group.removeFromParent();
    for (const record of records) { record.mixer?.stopAllAction(); record.mixer?.uncacheRoot(record.model); }
    for (const resource of [...materials, ...textures, ...geometries, ...skeletons]) resource.dispose();
    queue.length = 0; philosophy = null; speechHold = 0;
  }

  let servedCup, contactShadows, readyOrder = 0;
  const contactMatrix = new THREE.Matrix4();
  try {
    const assetPairs = await Promise.all([...new Set(STAFF.map(person => person.model))].map(async id => {
      const entry = manifest.models.find(item => item.id === id); if (!entry) throw new Error(`Missing pub model: ${id}`);
      const gltf = await loadModel(id); if (!gltf?.scene) throw new Error(`Pub model failed to load: ${id}`); return [id, { entry, gltf }];
    }));
    const assets = new Map(assetPairs);

    // Level flooring, small boards and inset rugs keep the pub in the same world.
    part(mats.stone, [23, 0.12, 22], [-44.5, -0.06, 3]);
    // Keep subtle grain variation, not dark structural beams across every row.
    // Bottom .001 / top .019: separate from the foundation and the rugs above.
    for (let row = 0; row < 38; row++) part(floorMaterials[Math.floor(row / 2) % 2], [22.65, 0.018, 0.55], [-44.5, 0.01, -7.45 + row * 0.565]);
    for (const x of [-50.2, -38.5]) part(mats.burgundy, [5.5, 0.014, 6.7], [x, 0.029, 6.5]);
    part(mats.green, [3.4, 0.014, 3.2], [-44, 0.029, 11.8]);
    // A small side floor leaves the entrance-to-counter corridor unobstructed.
    part(danceMaterial, [5.6, .018, 3.7], [-38.4, .032, 10.9]);
    for (const x of [-40.6, -39.5, -38.4, -37.3, -36.2]) part(mats.brass, [.028, .012, 3.6], [x, .048, 10.9]);

    // Transparent perimeter above the waist; the back remains a warm solid wall.
    part(mats.plaster, [23, 3.8, 0.28], [-44.5, 1.9, -7.85]); solid(-44.5, -7.85, 23, 0.3, 'back-wall');
    for (const x of [-55.85, -33.15]) {
      part(mats.plaster, [0.28, 0.75, 21.7], [x, 0.375, 3]);
      part(glassMaterial, [0.06, 2.6, 21.6], [x, 2.05, 3]);
      solid(x, 3, 0.3, 22, 'side-wall');
      for (const z of [-7.6, -3.3, 1, 5.3, 9.6, 13.75]) part(mats.timber, [0.25, 3.8, 0.22], [x, 1.9, z]);
      part(mats.timber, [0.32, 0.16, 21.9], [x, 0.82, 3]);
    }
    for (const [x, width] of [[-50.8, 10], [-37.75, 8.9]]) {
      part(mats.plaster, [width, 0.75, 0.28], [x, 0.375, 13.85]); part(glassMaterial, [width, 2.55, 0.06], [x, 2.05, 13.85]);
      solid(x, 13.85, width, 0.3, 'front-wall');
      for (const postX of [x - width / 2, x, x + width / 2]) part(mats.timber, [0.23, 3.8, 0.26], [postX, 1.9, 13.85]);
      part(mats.timber, [width, 0.16, 0.32], [x, 0.82, 13.85]);
    }
    for (const x of [-45.8, -42.2]) { part(mats.green, [0.24, 3.8, 0.4], [x, 1.9, 13.85]); solid(x, 13.85, 0.24, 0.4, 'door-jamb'); }
    part(mats.green, [23.3, 0.42, 0.45], [-44.5, 3.63, 13.85]);
    part(mats.green, [23.3, 0.42, 0.42], [-44.5, 3.63, -7.85]);
    for (const x of [-55.85, -33.15]) part(mats.green, [0.42, 0.42, 22], [x, 3.63, 3]);
    // Always-open leaves flank the broad doorway rather than require another UI.
    for (const x of [-45.62, -42.38]) { part(mats.wood, [0.09, 2.65, 1.5], [x, 1.325, 13.07]); solid(x, 13.07, 0.1, 1.5, 'open-door'); }
    part(mats.green, [23.6, 0.18, 22.6], [-44.5, 3.91, 3], roof);
    part(mats.paper, [22.8, 0.04, 21.8], [-44.5, 3.805, 3], roof);
    for (const z of [-4, 3, 10]) part(mats.timber, [22.8, 0.22, 0.18], [-44.5, 3.7, z], roof);
    sign('THE WAIT PUB', 'BOAS CONVERSAS ENTRE UMA TAREFA E OUTRA', 7.7, 1.25, [-44, 4.18, 14.12]);
    for (const x of [-48.15, -39.85]) part(mats.brass, [0.11, 1.35, 0.14], [x, 4.2, 14]);

    // Counter, backbar shelves, taps and bottles form a readable destination.
    part(mats.green, [12, 0.92, 1.05], [-44, 0.46, 0]); part(mats.wood, [12.35, 0.13, 1.32], [-44, 0.985, 0]); solid(-44, 0, 12.35, 1.32, 'counter');
    for (const x of [-49, -47, -45, -43, -41, -39]) part(mats.brass, [0.06, 0.69, 0.04], [x, 0.47, 0.55]);
    part(mats.brass, [11.4, 0.06, 0.06], [-44, 0.22, 0.91]);
    solid(-44, 0.91, 11.4, 0.07, 'counter-rail');
    part(mats.wood, [14.7, 0.14, 0.55], [-44, 0.65, -6.85]);
    for (const y of [1.55, 2.45]) part(mats.wood, [14.7, 0.11, 0.52], [-44, y, -6.85]);
    for (const x of [-51.2, -44, -36.8]) part(mats.brass, [0.07, 2.1, 0.09], [x, 1.5, -7.08]);
    for (let bottle = 0; bottle < 19; bottle++) {
      const x = -50.7 + bottle * 0.74, y = bottle % 2 ? 1.82 : 2.72;
      part(bottle % 3 ? mats.bottle : mats.burgundy, [0.12, 0.39, 0.12], [x, y, -6.85], group, cylinderGeometry);
      part(mats.brass, [0.045, 0.11, 0.045], [x, y + 0.25, -6.85], group, cylinderGeometry);
      part(mats.paper, [0.18, 0.11, 0.02], [x, y, -6.72]);
    }
    for (const x of [-46.2, -45.35, -44.5]) {
      part(mats.brass, [0.075, 0.52, 0.075], [x, 1.31, -0.25], group, cylinderGeometry);
      part(mats.brass, [0.12, 0.09, 0.31], [x, 1.55, -0.1]);
      part(mats.green, [0.08, 0.2, 0.08], [x, 1.69, -0.18]);
    }
    sign('EM PAUSA', 'SEM PRESSA · SEM NOTIFICAÇÕES', 4.3, 1.05, [-44, 2.92, -7.67]);
    sign('PEÇA NO BALCÃO', 'CAFÉ · CHÁ · O BRINDE DA CASA', 2.6, 0.72, [-37.2, 1.95, -7.66]);

    // Two generous communal tables, chibi-height benches and boot rails.
    for (const x of [-50.2, -38.5]) {
      part(mats.wood, [3.8, 0.12, 1.45], [x, 0.83, 6.5]); solid(x, 6.5, 3.85, 1.5, 'table');
      for (const legX of [x - 1.4, x + 1.4]) part(mats.green, [0.18, 0.78, 1.05], [legX, 0.39, 6.5]);
      for (const z of [5, 8]) {
        part(mats.wood, [4.1, 0.15, 0.6], [x, 0.39, z]); part(mats.burgundy, [3.9, 0.08, 0.52], [x, 0.505, z]);
        for (const legX of [x - 1.5, x + 1.5]) part(mats.green, [0.13, 0.34, 0.44], [legX, 0.17, z]);
        part(mats.brass, [3.6, 0.05, 0.06], [x, 0.25, z + (z < 6 ? 0.34 : -0.34)]);
        solid(x, z, 4.15, 0.66, 'bench');
      }
      part(mats.paper, [0.24, 0.21, 0.24], [x, 1, 6.5], group, cylinderGeometry);
      part(mats.leaf, [0.25, 0.2, 0.25], [x, 1.22, 6.5], group, leafGeometry);
    }
    // Plants and short timber dividers furnish the otherwise empty corners.
    for (const [x, z] of [[-54.5, 11.8], [-34.5, 11.8], [-54.2, -5.3], [-34.8, -5.3]]) {
      part(mats.burgundy, [0.65, 0.58, 0.65], [x, 0.29, z]);
      part(mats.leaf, [0.72, 0.95, 0.62], [x, 1.22, z], group, leafGeometry); solid(x, z, 0.8, 0.8, 'planter');
    }
    for (const x of [-52.8, -36]) for (const z of [10.4, 11.2, 12]) part(mats.timber, [0.08, 1.15, 0.08], [x, 0.575, z]);
    // Warm hanging pendants remain visible when the roof is cut for an overview.
    for (const [x, z] of [[-50.2, 6.5], [-38.5, 6.5], [-44, 2.4], [-44, -3.5]]) {
      part(mats.brass, [0.035, 0.66, 0.035], [x, 3.4, z]);
      part(mats.green, [0.58, 0.18, 0.58], [x, 3.02, z], group, cylinderGeometry);
      part(lampMaterial, [0.45, 0.055, 0.45], [x, 2.91, z], group, cylinderGeometry);
    }
    for (const x of [-46.4, -41.6]) {
      part(mats.green, [0.22, 0.44, 0.25], [x, 2.35, 14.02]); part(lampMaterial, [0.14, 0.28, 0.08], [x, 2.35, 14.18]);
    }
    flush();
    // Contact shading stays crisp even beyond the headquarters' sun-shadow range.
    const contactPixels = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const radius = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5), index = (y * 32 + x) * 4;
      contactPixels.set([25, 20, 16, Math.round(95 * Math.max(0, 1 - radius) ** 1.3)], index);
    }
    const contactTexture = new THREE.DataTexture(contactPixels, 32, 32); contactTexture.colorSpace = THREE.SRGBColorSpace;
    contactTexture.magFilter = THREE.LinearFilter; contactTexture.minFilter = THREE.LinearFilter; contactTexture.needsUpdate = true; textures.add(contactTexture);
    const contactMaterial = ownMaterial(new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false, toneMapped: false }));
    const contacts = [[-44, 0, 13.3, 2.5], ...[-50.2, -38.5].flatMap(x => [[x, 6.5, 4.5, 2.3], [x, 5, 4.6, 1], [x, 8, 4.6, 1]])];
    contactShadows = new THREE.InstancedMesh(ownGeometry(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), contactMaterial, contacts.length + STAFF.length);
    contactShadows.name = 'Pub · sombras de contato'; contactShadows.userData.actorOffset = contacts.length;
    contacts.forEach(([x, z, width, depth], index) => { contactMatrix.makeScale(width, 1, depth).setPosition(x, 0.039, z); contactShadows.setMatrixAt(index, contactMatrix); });
    group.add(contactShadows);

    // One shared low-poly mug geometry; every held cup follows an actual hand.
    const mugParts = [new THREE.CylinderGeometry(0.075, 0.064, 0.15, 8),
      new THREE.BoxGeometry(0.04, 0.12, 0.035).translate(0.1, 0, 0),
      new THREE.BoxGeometry(0.065, 0.025, 0.035).translate(0.082, 0.05, 0),
      new THREE.BoxGeometry(0.065, 0.025, 0.035).translate(0.082, -0.05, 0)];
    const mugGeometry = ownGeometry(mergeGeometries(mugParts)); mugParts.forEach(geometry => geometry.dispose());
    const drinkGeometry = ownGeometry(new THREE.CylinderGeometry(0.061, 0.061, 0.012, 8));
    function cup(name) {
      const object = new THREE.Group(); object.name = name;
      const mug = new THREE.Mesh(mugGeometry, mats.paper), drink = new THREE.Mesh(drinkGeometry, mats.brass); drink.position.y = 0.074;
      object.add(mug, drink); group.add(object); return object;
    }
    servedCup = cup('Pub · pedido servido no balcão'); servedCup.visible = false;
    for (const spec of STAFF) {
      const { entry, gltf } = assets.get(spec.model), root = new THREE.Group(), model = cloneSkeleton(gltf.scene);
      const record = { ...spec, root, model, mixer: null, actions: {}, action: null, state: 'idle', elapsed: 0, routeIndex: 0, pause: 0, radius: 0.5, cup: null, modelRestY: 0 };
      records.push(record); root.name = `${spec.name} · ${spec.bartender ? 'barman' : 'cliente do pub'}`; root.userData.ambientPerson = true; root.userData.pubId = spec.id;
      model.traverse(object => { if (object.skeleton) skeletons.add(object.skeleton); });
      model.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(model), height = box.max.y - box.min.y;
      if (!Number.isFinite(height) || height <= 0) throw new Error(`Invalid pub character: ${spec.model}`);
      const scale = spec.height / height; model.scale.setScalar(scale); model.position.y = -box.min.y * scale;
      record.modelRestY = model.position.y;
      const appearance = createAppearance(spec.id, [spec.model]); if (spec.bartender) appearance.shirt = '#33594a'; record.appearance = appearance;
      const clonedMaterials = new Map(), clonedTextures = new Map();
      function cloneMaterial(source) {
        if (clonedMaterials.has(source)) return clonedMaterials.get(source);
        const material = ownMaterial(cloneCharacterMaterial(source));
        if (source.map) { if (!clonedTextures.has(source.map)) clonedTextures.set(source.map, recolor(source.map, entry, appearance)); material.map = clonedTextures.get(source.map); }
        clonedMaterials.set(source, material); return material;
      }
      model.traverse(object => { if (!object.isMesh) return; object.material = Array.isArray(object.material) ? object.material.map(cloneMaterial) : cloneMaterial(object.material); object.castShadow = true; object.receiveShadow = true; object.frustumCulled = false; });
      root.add(model); root.position.set(spec.x, spec.seated ? 0.14 : 0, spec.z); root.rotation.y = spec.yaw; group.add(root);
      record.mixer = new THREE.AnimationMixer(model);
      for (const source of gltf.animations || []) {
        const name = source.name.split('|').pop().replace(/\.\d+$/, ''); if (!['Idle', 'Idle_Hold', 'Walk', 'Wave', 'Yes'].includes(name) || record.actions[name]) continue;
        const clip = source.clone(); clip.tracks = clip.tracks.filter(track => !/^(CharacterArmature|Armature|Root)\.(position|quaternion)$/.test(track.name)); record.actions[name] = record.mixer.clipAction(clip);
      }
      const bone = name => model.getObjectByName(name.replace('.', '')) || model.getObjectByName(name);
      record.bones = Object.fromEntries(['UpperArm.L', 'LowerArm.L', 'Fist.L', 'UpperArm.R', 'LowerArm.R', 'Fist.R', 'Fist.R_end', 'UpperLeg.L', 'LowerLeg.L', 'LowerLeg.L_end', 'UpperLeg.R', 'LowerLeg.R', 'LowerLeg.R_end'].map(name => [name, bone(name)]));
      record.cup = cup(`Copo de ${spec.name} · mão direita`); play(record, 'Idle_Hold'); record.mixer.update(0);
    }
    scene.add(group); setNight(0);
  } catch (error) { dispose(); throw error; }

  function play(record, name) {
    const next = record.actions[name] || record.actions.Idle || Object.values(record.actions)[0]; if (!next || next === record.action) return;
    record.action?.fadeOut(0.2); next.reset().fadeIn(0.2).play(); record.action = next;
  }
  const origin = new THREE.Vector3(), current = new THREE.Vector3(), toward = new THREE.Vector3(), worldQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion(), deltaQ = new THREE.Quaternion();
  function aim(record, bone, child, localTarget) {
    if (!bone || !child) return;
    record.root.updateMatrixWorld(true); bone.getWorldPosition(origin); child.getWorldPosition(current).sub(origin).normalize();
    toward.set(...localTarget); record.root.localToWorld(toward); toward.sub(origin).normalize();
    deltaQ.setFromUnitVectors(current, toward); bone.getWorldQuaternion(worldQ); worldQ.premultiply(deltaQ); bone.parent.getWorldQuaternion(parentQ).invert(); bone.quaternion.copy(parentQ.multiply(worldQ));
  }
  function pose(record, sip) {
    const bones = record.bones;
    if (record.seated) for (const [side, sign] of [['L', 1], ['R', -1]]) {
      aim(record, bones[`UpperLeg.${side}`], bones[`LowerLeg.${side}`], [sign * 0.17, 0.36, 0.24]);
      aim(record, bones[`LowerLeg.${side}`], bones[`LowerLeg.${side}_end`], [sign * 0.17, 0.09, 0.26]);
    }
    if (record.state !== 'walking' && record.state !== 'waving') {
      aim(record, bones['UpperArm.R'], bones['LowerArm.R'], [-0.38, 0.83 + sip * 0.13, 0.18]);
      aim(record, bones['LowerArm.R'], bones['Fist.R'], [-0.19, 0.83 + sip * 0.31, 0.44]);
    }
    record.root.updateMatrixWorld(true);
    const hand = bones['Fist.R'], end = bones['Fist.R_end'];
    record.cup.visible = !!hand && record.state !== 'walking' && record.state !== 'waving';
    if (hand) {
      hand.getWorldPosition(origin); if (end) { end.getWorldPosition(current); origin.lerp(current, 0.65); }
      origin.y += 0.055; group.worldToLocal(origin); record.cup.position.copy(origin); record.cup.rotation.set(-sip * 0.2, record.root.rotation.y, 0);
    }
  }
  function dancePose(record, phase) {
    // Bone aiming stays in model space; feet keep their physical floor position.
    const swing = Math.sin(phase), lift = Math.sin(phase * .5);
    record.model.position.y = record.modelRestY + Math.max(0, Math.sin(phase * 2)) * .018;
    record.root.rotation.y = record.yaw + swing * .09;
    for (const [side, sign] of [['L', 1], ['R', -1]]) {
      aim(record, record.bones[`UpperArm.${side}`], record.bones[`LowerArm.${side}`], [sign * .48, .94 + sign * lift * .12, .1]);
      aim(record, record.bones[`LowerArm.${side}`], record.bones[`Fist.${side}`], [sign * (.37 + swing * .08), 1.24 + sign * lift * .12, .3]);
    }
    record.cup.visible = false;
  }
  function move(record, target, dt) {
    const dx = target.x - record.root.position.x, dz = target.z - record.root.position.z, distance = Math.hypot(dx, dz);
    if (distance < 0.06) return true;
    const occupants = records.filter(other => other !== record).map(other => ({ x: other.root.position.x, z: other.root.position.z, radius: peaceCollisionRadius(other.root,other.radius) }));
    occupants.push(...(getActors() || []).filter(other => other && other.id !== record.id && [other.x, other.z, other.radius].every(Number.isFinite) && other.radius > 0 && (!Number.isFinite(other.y) || other.y < 2)));
    const visitor = getVisitor(); if (visitor && Number.isFinite(visitor.x) && Number.isFinite(visitor.z) && (!Number.isFinite(visitor.y) || visitor.y < 2)) occupants.push({ x: visitor.x, z: visitor.z, radius: Number.isFinite(visitor.radius) ? Math.max(0.2, visitor.radius) : 0.35 });
    const travel = Math.min(distance, 0.85 * dt), beforeX = record.root.position.x, beforeZ = record.root.position.z;
    const next = moveWithCollision({ x: beforeX, z: beforeZ }, dx / distance * travel, dz / distance * travel, obstacles, occupants, BOUNDS, record.radius);
    record.root.position.x = next.x; record.root.position.z = next.z;
    const yaw = Math.atan2(dx, dz), turn = Math.atan2(Math.sin(yaw - record.root.rotation.y), Math.cos(yaw - record.root.rotation.y)); record.root.rotation.y += turn * Math.min(1, dt * 8);
    record.state = Math.hypot(next.x - beforeX, next.z - beforeZ) > 0.001 ? 'walking' : 'waiting';
    return false;
  }
  function update(dt, { running = true, camera } = {}) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(dt, 0.1);
    for (const light of lights) {
      const distance = camera?.position ? camera.position.distanceTo(light.position) : 0;
      light.visible = distance < 45; light.intensity = 12 + night * 18;
    }
    if (!running) return; elapsed += step; if (musicPlaying) musicSeconds += step;
    if (philosophy) {
      philosophy.remainingSeconds = Math.max(0, philosophy.remainingSeconds - step);
      if (philosophy.remainingSeconds < 1e-9) philosophy.remainingSeconds = 0;
    }
    const bartenderReacting=records.some(record=>record.bartender&&record.root.userData.peaceBehavior);
    if(!bartenderReacting)speechHold = Math.max(0, speechHold - step);
    if (speechHold < 1e-9) speechHold = 0;
    if (!bartenderReacting && !activeOrder && !speechHold && queue.length) { activeOrder = queue.shift(); serviceSeconds = 0; servedCup.visible = false; }
    for (const [index, record] of records.entries()) {
      restorePeacePose(record);const reaction=record.root.userData.peaceBehavior;
      if(reaction){
        play(record,reaction.moving?'Walk':'Idle');record.action?.setEffectiveTimeScale(reaction.moving?2.5:1);record.mixer.update(step);
        if(record.seated)pose(record,0);applyPeacePose(record);record.cup.visible=false;record.root.userData.state=reaction.phase;
        contactMatrix.makeScale(1.1,1,.9).setPosition(record.root.position.x,.04,record.root.position.z);contactShadows.setMatrixAt(contactShadows.userData.actorOffset+index,contactMatrix);continue;
      }
      record.action?.setEffectiveTimeScale(1);
      record.elapsed += step;
      const phase = ((elapsed + index * 4.7) % (20 + index * 1.3)) / (20 + index * 1.3) * 20;
      if (record.bartender) {
        if (speechHold > 0) {
          // Give the hand-off a human beat. Only Ben holds; other patrons,
          // music and the longer reflection timer continue normally.
          const visitor = getVisitor();
          const yaw = visitor && Number.isFinite(visitor.x) && Number.isFinite(visitor.z)
            ? Math.atan2(visitor.x - record.root.position.x, visitor.z - record.root.position.z) : 0;
          record.root.rotation.y += Math.atan2(Math.sin(yaw - record.root.rotation.y), Math.cos(yaw - record.root.rotation.y)) * Math.min(1, step * 8);
          record.state = 'talking';
        } else {
          const destination = activeOrder ? { x: -44, z: -1.45 } : { x: record.routeIndex % 2 ? -42.5 : -46, z: -2.1 };
          if (move(record, destination, step)) {
            record.root.rotation.y += Math.atan2(Math.sin(-record.root.rotation.y), Math.cos(-record.root.rotation.y)) * Math.min(1, step * 8);
            record.state = activeOrder ? 'serving' : 'idle';
            if (activeOrder) {
              serviceSeconds += step;
              if (serviceSeconds > 1.5) { servedCup.visible = true; servedCup.position.set(-44, 1.13, THREE.MathUtils.lerp(-0.4, 0.4, Math.min(1, (serviceSeconds - 1.5) / 2))); }
              if (serviceSeconds >= 4) {
                philosophy = { orderId: activeOrder.id, ...REFLECTIONS[drinksServed % REFLECTIONS.length], speaker: 'Ben', remainingSeconds: REFLECTION_SECONDS };
                drinksServed++; lastServed = activeOrder.id; readyOrder = lastServed; activeOrder = null; record.pause = 3; speechHold = 4;
              }
            } else if ((record.pause -= step) <= 0) { record.routeIndex++; record.pause = 4; }
          }
        }
      } else if (record.dancer) {
        record.state = musicPlaying ? 'dancing' : phase < 3 ? 'waving' : 'talking';
        if (!musicPlaying) { record.model.position.y = record.modelRestY; record.root.rotation.y = record.yaw; }
      } else if (record.seated) record.state = phase < 3 ? 'waving' : phase > 11 && phase < 16 ? 'drinking' : 'talking';
      else {
        const route = [{ x: -38.5, z: 3.2 }, { x: -39.5, z: 1.85 }, { x: -37.2, z: 3.2 }];
        if (record.pause > 0) { record.pause -= step; record.state = record.pause > 2 ? 'drinking' : 'waving'; }
        else if (move(record, route[record.routeIndex], step)) { record.routeIndex = (record.routeIndex + 1) % route.length; record.pause = 6; record.state = 'drinking'; }
      }
      play(record, record.state === 'walking' ? 'Walk' : record.state === 'waving' ? 'Wave' : record.state === 'talking' ? 'Yes' : record.state === 'dancing' ? 'Idle' : 'Idle_Hold');
      record.mixer.update(step);
      const sip = record.state === 'drinking' ? (1 - Math.cos((elapsed + index * 1.7) * (1.25 + index % 3 * .16))) * 0.5 : 0;
      if (record.state === 'dancing') dancePose(record, musicSeconds * Math.PI * 2 * 1.8 + index * .7);
      else pose(record, sip);
      record.root.userData.state = record.state;
      contactMatrix.makeScale(1.1, 1, 0.9).setPosition(record.root.position.x, 0.04, record.root.position.z);
      contactShadows.setMatrixAt(contactShadows.userData.actorOffset + index, contactMatrix);
    }
    contactShadows.instanceMatrix.needsUpdate = true;
  }
  function setNight(amount) {
    if (!Number.isFinite(amount) || disposed) return false; night = THREE.MathUtils.clamp(amount, 0, 1);
    lampMaterial.emissiveIntensity = 0.8 + night * 1.8;
    danceMaterial.emissiveIntensity = .04 + night * .16;
    for (const material of [mats.wood, mats.plaster, mats.timber]) { material.emissive.copy(material.color); material.emissiveIntensity = night * 0.12; }
    for (const light of lights) light.intensity = 12 + night * 18;
    return true;
  }
  function setMusicState({ playing, beatTime } = {}) {
    if (disposed || typeof playing !== 'boolean' || (beatTime !== undefined && (!Number.isFinite(beatTime) || beatTime < 0))) return false;
    musicPlaying = playing; if (beatTime !== undefined) musicSeconds = beatTime; return true;
  }
  function orderDrink() {
    if (disposed) return { ok: false, message: 'O pub está fechado.' };
    if (queue.length >= 5) return { ok: false, message: 'O barman já tem cinco pedidos na fila. Espere um instante.' };
    const order = { id: ++orders }; queue.push(order);
    return { ok: true, order: order.id, message: `Pedido #${order.id} recebido. O barman vai preparar o brinde da casa.` };
  }
  function getSnapshot() {
    // Position is the real bartender's world-space head anchor. Return fresh
    // objects so a DOM balloon/inspector cannot mutate simulation state.
    const speaker = records.find(record => record.bartender);
    if (philosophy && speaker) speaker.root.getWorldPosition(speakerPosition);
    const reflection = philosophy ? { ...philosophy, position: { x: speakerPosition.x, y: speakerPosition.y + 2.3, z: speakerPosition.z } } : null;
    return { orders, patrons: disposed ? 0 : STAFF.length - 1, musicPlaying: !disposed && musicPlaying, dancers: disposed ? 0 : records.filter(record => record.state === 'dancing').length, queued: queue.length + Number(!!activeOrder), drinksServed,
      philosophy: reflection, readyOrder,
      service: disposed ? 'Fechado' : activeOrder ? `Preparando pedido #${activeOrder.id}` : queue.length ? 'Pedido recebido' : lastServed ? `Pedido #${lastServed} servido no balcão` : 'Balcão aberto · peça uma pausa',
      people: records.map(record => ({ id: record.id, name: record.name, x: record.root.position.x, z: record.root.position.z, state: record.state, seated: !!record.seated })) };
  }
  const interactable = { kind: 'pub', name: 'Pedir no balcão', position: new THREE.Vector3(-44, 0, 2) };
  update(0.001);
  const getPeaceBindings=()=>records.map(record=>({
    id:record.root.uuid,root:record.root,model:record.model,radius:record.radius+.025,launchHeight:.62,
    bounds:record.bartender?{minX:-54,maxX:-34,minZ:-6,maxZ:-1.1}:{minX:-55.5,maxX:-33.5,minZ:-6.5,maxZ:13.4},
    getPosition:()=>record.root.position.clone(),setPosition:p=>{record.root.position.x=p.x;record.root.position.z=p.z;},setYaw:y=>{record.root.rotation.y=y;},
    getObstacles:()=>obstacles,getActors:()=>[...records.filter(other=>other!==record).map(other=>({id:other.id,x:other.root.position.x,z:other.root.position.z,radius:peaceCollisionRadius(other.root,other.radius)})),...(getActors?.()||[]),...(getVisitor?.()?[getVisitor()]:[])],
    canMove:()=>!record.seated,begin:()=>!disposed,end:()=>{}
  }));
  return { group, obstacles, interactable, update, setNight, setMusicState, orderDrink, getSnapshot, dispose,getPeaceBindings,
    takeDrink(id) { if (disposed || !id || id !== readyOrder) return false; readyOrder = 0; servedCup.visible = false; return true; },
    setView({ firstPerson = false } = {}) { if (!disposed) roof.visible = Boolean(firstPerson); },
    getColliders: () => disposed ? [] : records.map(record => ({ id: record.id, x: record.root.position.x, z: record.root.position.z, radius: peaceCollisionRadius(record.root,record.radius) })),
  };
}

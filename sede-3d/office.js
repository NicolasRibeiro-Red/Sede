import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROOMS, DOOR_WIDTH, DOOR_HEIGHT } from './layout.js';

const PALETTES = {
  studio: { floor: '#d7c4a4', base: '#ad9d83', wall: '#e8e4d8', trim: '#f2f0e8', wood: '#a77c54', dark: '#314a43', teal: '#537b69', fabric: '#8fa88d', paper: '#f2ebd7', rug: '#cad3b9', gold: '#d8a260', glass: '#c3dcd7', leaf: '#386b45', pot: '#c58a65', seam: '#bda98a' },
  night: { floor: '#7c6d59', base: '#34443f', wall: '#41564e', trim: '#708278', wood: '#927451', dark: '#1b3736', teal: '#456b61', fabric: '#738d79', paper: '#c9c7ad', rug: '#788b75', gold: '#c99a60', glass: '#70948c', leaf: '#4c7359', pot: '#a87859', seam: '#665b4d' },
  mint: { floor: '#dfceb0', base: '#a4b49b', wall: '#d2e0d0', trim: '#f0f1dc', wood: '#b89b6f', dark: '#36564b', teal: '#739582', fabric: '#a1b99c', paper: '#f4ecd3', rug: '#dbe0bd', gold: '#d9a36f', glass: '#c0dfd1', leaf: '#69916c', pot: '#c69a73', seam: '#c0af8c' },
};
const OPEN_TIME = 0.9;
// A restrained baked-style bounce supports distant interiors; nearby shared
// lights still provide the directional shading on people and furniture.
const NIGHT_BOUNCE = { floor: 0.18, wall: 0.12, trim: 0.08, wood: 0.12, paper: 0.14, rug: 0.12, fabric: 0.04, seam: 0.04 };

export function createOffice(scene) {
  const group = new THREE.Group();
  group.name = 'Sede · Primeiro andar';
  const cutaway = new THREE.Group();
  cutaway.name = 'Teto e fachadas frontal/direita';
  group.add(cutaway);
  const materials = Object.fromEntries(Object.entries(PALETTES.studio).map(([name, color]) => [name, new THREE.MeshStandardMaterial({ color, roughness: 0.87, metalness: 0 })]));
  materials.glass.transparent = true;
  materials.glass.opacity = 0.12;
  materials.glass.roughness = 0.18;
  materials.glass.depthWrite = false;
  materials.wood.roughness = 0.78; materials.dark.roughness = 0.48; materials.dark.metalness = 0.18;
  const lampMaterial = new THREE.MeshStandardMaterial({ color: '#fff0c8', emissive: '#ffe3a2', emissiveIntensity: 0.55, roughness: 0.8 });
  lampMaterial.name = 'Luminárias · luz quente';
  const dayLampColor = lampMaterial.emissive.clone();
  const nightLampColor = new THREE.Color('#ffd28d');
  const ceilingMaterial = new THREE.MeshStandardMaterial({ color: '#e8e4da', roughness: 0.95, emissive: '#ddd7c7', emissiveIntensity: 0.2 });
  ceilingMaterial.name = 'Teto · rebote difuso neutro';
  const bounceTint = new THREE.Color('#ffe0ad');
  let nightAmount = 0;
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
  const leafGeometry = new THREE.IcosahedronGeometry(1, 0);
  const roundedGeometries = new Map();
  const staticObstacles = [];
  const occluders = [];
  const doorColliders = new Map();
  const doorVisuals = new Map();
  const stationMaterials = new Map();
  const activeStations = new Map();
  const interactables = [];
  let elapsed = 0;
  let coffeeTime = 0;
  let floorIndex = 0;

  function mesh(geometry, material, position, parent = group) {
    const object = new THREE.Mesh(geometry, typeof material === 'string' ? materials[material] : material);
    object.position.set(...position);
    object.castShadow = material !== 'glass';
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function box(size, position, material, parent = group) {
    const object = mesh(unitBox, material, position, parent);
    object.scale.set(...size);
    if (material === 'wall' || material === 'glass') occluders.push(object);
    return object;
  }
  function rounded(size, position, material, parent = group) {
    const key = size.join(',');
    if (!roundedGeometries.has(key)) {
      const [width, height, depth] = size;
      const bevel = Math.min(0.025, height * 0.2, depth * 0.15, width * 0.15);
      const x = width / 2 - bevel, z = depth / 2 - bevel, r = Math.min(0.12, x * 0.25, z * 0.25);
      const shape = new THREE.Shape();
      shape.moveTo(-x + r, -z); shape.lineTo(x - r, -z); shape.quadraticCurveTo(x, -z, x, -z + r);
      shape.lineTo(x, z - r); shape.quadraticCurveTo(x, z, x - r, z); shape.lineTo(-x + r, z);
      shape.quadraticCurveTo(-x, z, -x, z - r); shape.lineTo(-x, -z + r); shape.quadraticCurveTo(-x, -z, -x + r, -z);
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: height - bevel * 2, steps: 1, curveSegments: 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
      geometry.rotateX(-Math.PI / 2); geometry.center();
      roundedGeometries.set(key, geometry);
    }
    return mesh(roundedGeometries.get(key), material, position, parent);
  }
  function cylinder(radius, height, position, material, parent = group) {
    const object = mesh(cylinderGeometry, material, position, parent);
    object.scale.set(radius, height, radius);
    return object;
  }
  function collider(x, z, width, depth, id) {
    const obstacle = { minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 };
    if (id) obstacle.id = id;
    return obstacle;
  }
  function blockFloor(x, z, width, depth, id) { staticObstacles.push(collider(x, z, width, depth, id)); }
  function canvasTexture(width, height, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('O navegador não disponibilizou o canvas das placas.');
    draw(context, width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { texture, context, width, height };
  }
  function sign(title, subtitle, width, height, position, yaw = 0, parent = group) {
    const surface = canvasTexture(768, 192, (ctx, w, h) => {
      ctx.fillStyle = '#f4efdf'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#2b493d'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '700 64px sans-serif'; ctx.fillText(title, w / 2, subtitle ? 72 : 100);
      if (subtitle) { ctx.fillStyle = '#697567'; ctx.font = '28px sans-serif'; ctx.fillText(subtitle, w / 2, 143); }
    });
    const material = new THREE.MeshBasicMaterial({ map: surface.texture, toneMapped: false });
    const label = mesh(new THREE.PlaneGeometry(width, height), material, position, parent);
    label.rotation.y = yaw; label.castShadow = false;
    return label;
  }
  function plant(x, z, scale = 1) {
    cylinder(0.32 * scale, 0.45 * scale, [x, 0.225 * scale, z], 'pot');
    cylinder(0.04 * scale, 0.9 * scale, [x, 0.86 * scale, z], 'wood');
    const first = mesh(leafGeometry, 'leaf', [x, 1.45 * scale, z]); first.scale.set(0.5 * scale, 0.62 * scale, 0.46 * scale);
    const second = mesh(leafGeometry, 'fabric', [x + 0.28 * scale, 1.12 * scale, z + 0.08]); second.scale.set(0.36 * scale, 0.42 * scale, 0.36 * scale);
    blockFloor(x, z, 0.72 * scale, 0.72 * scale, 'plant');
  }

  // Full floor, with narrow seams instanced as one draw call.
  rounded([22.5, 0.38, 16.5], [0, -0.28, 0], 'base');
  rounded([22.08, 0.18, 16.08], [0, -0.09, 0], 'floor');
  const seams = new THREE.InstancedMesh(unitBox, materials.seam, 27);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 27; i++) { matrix.makeScale(0.009, 0.003, 15.9); matrix.setPosition(-10.4 + i * 0.8, 0.002, 0); seams.setMatrixAt(i, matrix); }
  seams.instanceMatrix.needsUpdate = true; seams.receiveShadow = true; group.add(seams);
  rounded([3.36, 0.014, 12.1], [0, 0.014, 0.2], 'rug');
  const entrySign = sign('Sede', 'ANDAR 01', 1.6, 0.4, [0, 0.027, 5.9]);
  entrySign.rotation.set(-Math.PI / 2, 0, 0);

  // Only these exterior faces and the roof disappear in overview. Colliders stay.
  for (const x of [-6.15, 6.15]) {
    box([9.7, 0.76, 0.18], [x, 0.38, 8], 'wall', cutaway);
    box([9.7, 2.12, 0.04], [x, 1.87, 8], 'glass', cutaway);
    box([9.7, 0.37, 0.18], [x, 3.115, 8], 'wall', cutaway);
    box([9.7, 0.1, 0.27], [x, 0.8, 7.93], 'wood', cutaway);
    for (const offset of [-4.78, -1.6, 1.6, 4.78]) box([0.09, 2.17, 0.19], [x + offset, 1.87, 8], 'wood', cutaway);
  }
  box([2.6, 0.5, 0.18], [0, 3.05, 8], 'wall', cutaway);
  const upperFrontWall = new THREE.Group(); upperFrontWall.name = 'Janela frontal dos pisos superiores'; cutaway.add(upperFrontWall);
  box([2.6, 0.76, 0.18], [0, 0.38, 8], 'wall', upperFrontWall);
  box([2.6, 2.04, 0.04], [0, 1.78, 8], 'glass', upperFrontWall);
  box([2.6, 0.1, 0.26], [0, 0.8, 8], 'wood', upperFrontWall);
  for (const x of [-1.255, 1.255]) box([0.09, 2.8, 0.18], [x, 1.4, 8], 'wood', upperFrontWall);
  upperFrontWall.visible = false;
  box([0.18, 0.76, 16], [11, 0.38, 0], 'wall', cutaway);
  box([0.18, 0.37, 16], [11, 3.115, 0], 'wall', cutaway);
  box([0.04, 2.12, 15.85], [11, 1.87, 0], 'glass', cutaway);
  box([0.27, 0.1, 16], [10.93, 0.8, 0], 'wood', cutaway);
  for (const z of [-7.94, -4, 0, 4, 7.94]) box([0.19, 2.17, 0.09], [11, 1.87, z], 'wood', cutaway);
  box([22.2, 0.16, 16.2], [0, 3.4, 0], ceilingMaterial, cutaway).castShadow = false;
  for (const z of [-5, 0, 5]) box([0.12, 0.035, 3.3], [0, 3.3, z], lampMaterial, cutaway).castShadow = false;
  for (const x of [-6.15, 6.15]) box([9.7, 0.14, 0.08], [x, 0.08, 7.86], 'wood', cutaway);
  box([0.08, 0.14, 16], [10.86, 0.08, 0], 'wood', cutaway);
  for (const x of [-6.25, 6.25]) blockFloor(x, 8, 9.9, 0.22, 'exterior-front');
  for (const x of [-6.2, 6.2]) blockFloor(x, -8, 10, 0.22, 'exterior-back');
  blockFloor(-11, 0, 0.22, 16.4, 'exterior-left');
  blockFloor(11, 0, 0.22, 16.4, 'exterior-right');

  // The north portal opens straight into the lift. No floor collider crosses it.
  for (const x of [-6.1, 6.1]) box([9.8, 0.96, 0.18], [x, 0.48, -8], 'wall');
  box([22, 0.42, 0.18], [0, 3.09, -8], 'wall');
  for (const x of [-1.7, 1.7]) box([1, 1.92, 0.18], [x, 1.92, -8], 'wall');
  sign('ELEVADOR', 'T · 1 · 2 · 3', 1.65, 0.31, [0, 3.09, -7.88]);
  for (const x of [-6.6, 6.6]) {
    box([8.55, 1.84, 0.04], [x, 1.92, -7.96], 'glass');
    box([8.65, 0.1, 0.3], [x, 0.98, -7.88], 'wood');
    for (const offset of [-4.24, 0, 4.24]) box([0.1, 1.95, 0.19], [x + offset, 1.92, -7.92], 'trim');
  }
  box([22.14, 0.1, 0.25], [0, 3.35, -8], 'trim');
  box([0.18, 0.96, 16], [-11, 0.48, 0], 'wall');
  box([0.18, 0.42, 16], [-11, 3.09, 0], 'wall');
  for (const [z, depth] of [[-7, 2], [0, 4], [7, 2]]) box([0.18, 1.92, depth], [-11, 1.92, z], 'wall');
  for (const z of [-4, 4]) {
    box([0.04, 1.84, 3.98], [-10.96, 1.92, z], 'glass');
    box([0.32, 0.1, 4.08], [-10.87, 0.98, z], 'wood');
    for (const offset of [-2, 0, 2]) box([0.17, 1.94, 0.09], [-10.92, 1.92, z + offset], 'trim');
  }
  box([0.25, 0.1, 16.15], [-11, 3.35, 0], 'trim');

  function glassPartition(x, z, length, alongX = false) {
    const thickness = 0.1;
    box(alongX ? [length, 3.06, 0.035] : [0.035, 3.06, length], [x, 1.67, z], 'glass');
    for (const y of [0.15, 3.22]) box(alongX ? [length, 0.15, thickness] : [thickness, 0.15, length], [x, y, z], 'wood');
    for (const side of [-1, 1]) box([thickness, 3.3, thickness], [x + (alongX ? side * length / 2 : 0), 1.65, z + (alongX ? 0 : side * length / 2)], 'wood');
    blockFloor(x, z, alongX ? length : thickness, alongX ? thickness : length, 'partition');
  }
  for (const x of [-2.2, 2.2]) {
    for (const [start, end] of [[-8, -4.8], [-2.8, 2.8], [4.8, 8]]) glassPartition(x, (start + end) / 2, end - start);
  }
  glassPartition(-6.6, 0, 8.8, true);
  glassPartition(6.6, 0, 8.8, true);

  const doors = ROOMS.map(room => {
    const state = { id: room.id, name: room.name, position: { ...room.door }, isOpen: false, progress: 0, targetOpen: false };
    const side = Math.sign(room.door.x);
    const panel = new THREE.Group(); panel.position.set(room.door.x + side * 0.075, 0, room.door.z); group.add(panel);
    occluders.push(panel);
    box([0.045, DOOR_HEIGHT - 0.12, DOOR_WIDTH - 0.08], [0, DOOR_HEIGHT / 2, 0], 'glass', panel);
    for (const z of [-DOOR_WIDTH / 2 + 0.045, DOOR_WIDTH / 2 - 0.045]) box([0.085, DOOR_HEIGHT, 0.085], [0, DOOR_HEIGHT / 2, z], 'wood', panel);
    for (const y of [0.05, DOOR_HEIGHT - 0.05]) box([0.085, 0.1, DOOR_WIDTH], [0, y, 0], 'wood', panel);
    box([0.11, 0.43, 0.04], [-side * 0.075, 1.32, 0.66], 'dark', panel);
    box([0.19, 0.11, 2.2], [room.door.x, DOOR_HEIGHT + 0.03, room.door.z], 'dark');
    sign(room.name.toUpperCase(), room.subtitle, 1.76, 0.44, [room.door.x - side * 0.13, 3.02, room.door.z], -side * Math.PI / 2);
    doorVisuals.set(room.id, { panel, axis: 'z', base: room.door.z, slide: room.door.z < 0 ? DOOR_WIDTH + 0.08 : -DOOR_WIDTH - 0.08 });
    doorColliders.set(room.id, collider(room.door.x, room.door.z, 0.19, DOOR_WIDTH, `door-${room.id}`));
    return state;
  });

  const entrance = { id: 'entrance', name: 'Entrada do parque', position: { x: 0, z: 8 }, isOpen: false, progress: 0, targetOpen: false };
  const entrancePanel = new THREE.Group(); entrancePanel.position.set(0, 0, 8.04); cutaway.add(entrancePanel); occluders.push(entrancePanel);
  box([2.5, 2.64, 0.045], [0, 1.4, 0], 'glass', entrancePanel);
  for (const x of [-1.255, 1.255]) box([0.09, 2.8, 0.095], [x, 1.4, 0], 'wood', entrancePanel);
  for (const y of [0.05, 2.75]) box([2.6, 0.1, 0.095], [0, y, 0], 'wood', entrancePanel);
  box([0.05, 0.48, 0.14], [-0.94, 1.36, -0.05], 'dark', entrancePanel);
  const entranceSign = sign('PARQUE', 'Entrada · térreo', 1.8, 0.32, [0, 3.05, 7.89], Math.PI, cutaway);
  doorVisuals.set('entrance', { panel: entrancePanel, axis: 'x', base: 0, slide: 2.72 });
  doorColliders.set('entrance', collider(0, 8, 2.6, 0.22, 'door-entrance'));
  doors.push(entrance);

  function chair(x, z, yaw = 0, color = 'teal') {
    const chairGroup = new THREE.Group(); chairGroup.position.set(x, 0, z); chairGroup.rotation.y = yaw; group.add(chairGroup);
    cylinder(0.055, 0.5, [0, 0.27, 0], 'dark', chairGroup);
    box([0.55, 0.06, 0.42], [0, 0.045, 0], 'dark', chairGroup);
    rounded([0.62, 0.14, 0.48], [0, 0.56, 0], color, chairGroup);
    rounded([0.62, 0.55, 0.12], [0, 0.86, 0.2], color, chairGroup);
    blockFloor(x, z, 0.66, 0.56, 'chair');
  }
  function workstation(x, z, roomId) {
    rounded([2.5, 0.14, 1.04], [x, 1.1, z], 'paper');
    for (const offset of [-0.94, 0.94]) box([0.12, 1.02, 0.77], [x + offset, 0.51, z], 'wood');
    box([0.09, 0.26, 0.09], [x, 1.3, z - 0.1], 'dark');
    rounded([1.14, 0.7, 0.1], [x, 1.69, z - 0.13], 'dark');
    const screen = box([1.03, 0.58, 0.015], [x, 1.7, z - 0.069], stationMaterials.get(roomId)); screen.castShadow = false;
    box([0.19, 0.36, 0.01], [x - 0.33, 1.7, z - 0.058], 'fabric').castShadow = false;
    box([0.4, 0.08, 0.01], [x + 0.1, 1.8, z - 0.058], 'paper').castShadow = false;
    rounded([0.7, 0.025, 0.24], [x - 0.07, 1.185, z + 0.27], 'dark');
    cylinder(0.09, 0.15, [x + 0.85, 1.245, z + 0.21], 'pot');
    blockFloor(x, z, 2.52, 1.08, 'desk');
    chair(x, -6.63);
  }
  for (const room of ROOMS) {
    stationMaterials.set(room.id, new THREE.MeshStandardMaterial({ color: '#345a52', emissive: '#73b89c', emissiveIntensity: 0.04, roughness: 0.7 }));
    activeStations.set(room.id, false);
    box([3.4, 0.08, 1.35], [room.x, 3.25, room.z], lampMaterial, cutaway).castShadow = false;
    interactables.push({ id: `station-${room.id}`, kind: room.id === 'meeting' ? 'projector' : room.id === 'lounge' ? 'coffee' : 'desk', roomId: room.id, name: room.id === 'meeting' ? 'Projetor da reunião' : room.id === 'lounge' ? 'Máquina de café' : `Estação · ${room.name}`, position: { ...room.station } });
  }
  workstation(-8.3, -7.05, 'studio'); workstation(-4.8, -7.05, 'studio');
  workstation(4.8, -7.05, 'engineering'); workstation(8.3, -7.05, 'engineering');

  // Studio: a materials shelf and a quiet composition wall.
  rounded([3.6, 0.66, 0.72], [-8.5, 0.35, -0.68], 'wood'); blockFloor(-8.5, -0.68, 3.64, 0.76, 'studio-shelf');
  for (const x of [-9.55, -8.5, -7.45]) box([0.7, 0.39, 0.045], [x, 0.42, -0.289], 'paper');
  box([0.09, 1.5, 2.9], [-10.83, 2.12, -2.93], 'paper');
  for (const [z, color] of [[-3.65, 'pot'], [-2.93, 'fabric'], [-2.21, 'gold']]) box([0.025, 0.8, 0.55], [-10.77, 2.12, z], color);
  rounded([4.5, 0.012, 3.4], [-6.5, 0.02, -3.3], 'rug');

  // Engineering: slim rack stays on the perimeter, away from the agent and route.
  rounded([0.88, 2.25, 1.12], [10.12, 1.15, -3.25], 'dark');
  for (let i = 0; i < 5; i++) box([0.028, 0.21, 0.9], [9.663, 0.45 + i * 0.33, -3.25], i % 2 ? 'wood' : 'teal');
  box([0.03, 1.7, 0.07], [9.641, 1.1, -2.95], stationMaterials.get('engineering'));
  blockFloor(10.12, -3.25, 0.93, 1.17, 'rack');
  rounded([4.5, 0.012, 3.4], [6.5, 0.02, -3.3], 'rug');

  // Meeting: door-to-room circulation runs around a central table.
  rounded([3.25, 0.14, 1.7], [-6.2, 1.03, 3.8], 'paper');
  for (const x of [-7.4, -5]) box([0.18, 0.95, 1.1], [x, 0.475, 3.8], 'wood');
  blockFloor(-6.2, 3.8, 3.3, 1.74, 'meeting-table');
  for (const x of [-7.1, -5.3]) { chair(x, 2.58, Math.PI, 'fabric'); chair(x, 5.02, 0, 'fabric'); }
  chair(-8.27, 3.8, -Math.PI / 2, 'fabric'); chair(-4.5, 3.8, Math.PI / 2, 'fabric');
  rounded([0.64, 0.15, 0.44], [-6.2, 1.18, 3.8], 'dark');
  cylinder(0.08, 0.025, [-6.2, 1.27, 3.8], 'gold');
  rounded([0.75, 0.91, 0.62], [-9.65, 0.46, 2], 'wood'); blockFloor(-9.65, 2, 0.8, 0.67, 'projector-console');
  box([0.025, 0.22, 0.34], [-9.26, 0.84, 2], stationMaterials.get('meeting'));
  box([3.7, 1.85, 0.1], [-6.4, 2.1, 0.15], 'dark');
  const projection = box([3.47, 1.63, 0.025], [-6.4, 2.1, 0.217], stationMaterials.get('meeting')); projection.castShadow = false;
  sign('IDEIAS EM CONVERSA', 'Reunião · use o controle do projetor', 2.65, 0.66, [-6.4, 2.1, 0.237]);

  // Lounge: sofa faces into the room; the coffee station stands at the right wall.
  rounded([3.5, 0.3, 1.22], [5, 0.33, 6.75], 'teal');
  rounded([3.5, 0.82, 0.24], [5, 0.87, 7.25], 'teal');
  for (const x of [4.15, 5.85]) rounded([1.62, 0.23, 0.94], [x, 0.59, 6.67], 'fabric');
  for (const x of [3.3, 6.7]) rounded([0.22, 0.58, 1.22], [x, 0.65, 6.75], 'teal');
  rounded([0.45, 0.47, 0.23], [3.85, 0.96, 7.02], 'gold');
  blockFloor(5, 6.75, 3.66, 1.29, 'sofa');
  rounded([2, 0.1, 0.86], [5.4, 0.6, 3.85], 'paper');
  for (const x of [4.65, 6.15]) box([0.12, 0.55, 0.55], [x, 0.275, 3.85], 'wood');
  blockFloor(5.4, 3.85, 2.04, 0.9, 'coffee-table');
  box([0.39, 0.045, 0.27], [5.15, 0.68, 3.87], 'pot').rotation.y = -0.2;
  rounded([1.08, 1.04, 2.72], [10.08, 0.53, 5.7], 'teal');
  rounded([1.17, 0.1, 2.83], [10.08, 1.1, 5.7], 'paper');
  blockFloor(10.08, 5.7, 1.2, 2.86, 'coffee-counter');
  for (const z of [4.95, 6.45]) box([0.035, 0.15, 0.04], [9.51, 0.77, z], 'gold');
  rounded([0.63, 0.68, 0.67], [10.05, 1.49, 5.7], 'paper');
  box([0.02, 0.34, 0.46], [9.724, 1.37, 5.7], 'dark');
  box([0.07, 0.045, 0.11], [9.69, 1.62, 5.7], 'gold');
  const coffeeCup = cylinder(0.09, 0.13, [9.64, 1.23, 5.7], 'pot');
  let coffeeReady = false, coffeeReserved = false;
  const coffeeSurface = cylinder(0.071, 0.008, [9.64, 1.295, 5.7], 'dark');
  coffeeSurface.visible = false;
  sign('CAFÉ & ENCONTROS', 'Uma pausa também faz parte.', 2.55, 0.64, [7.65, 2.18, 0.14]);
  // The lounge plaque is on the north divider and faces +Z.
  const steamGeometry = new THREE.BufferGeometry();
  const steamPositions = new Float32Array(9 * 3);
  steamGeometry.setAttribute('position', new THREE.BufferAttribute(steamPositions, 3));
  const steam = new THREE.Points(steamGeometry, new THREE.PointsMaterial({ color: '#f9efdb', size: 0.075, transparent: true, opacity: 0.48, depthWrite: false }));
  steam.visible = false; steam.frustumCulled = false; group.add(steam);

  for (const [x, z, scale] of [[-10.15, -1.9, 1], [-3.2, -7.1, 0.85], [10.1, -0.8, 1], [3.3, -7.1, 0.85], [-10.1, 6.9, 1.15], [-3.1, 6.9, 1], [10.15, 1.1, 1.1], [3.35, 1.1, 0.85]]) plant(x, z, scale);

  // One feathered, instanced contact layer anchors furniture even in indirect room light.
  const contactPixels = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const radius = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5), index = (y * 32 + x) * 4;
    contactPixels.set([35, 49, 41, Math.round(75 * Math.max(0, 1 - radius) ** 1.4)], index);
  }
  const contactMap = new THREE.DataTexture(contactPixels, 32, 32); contactMap.colorSpace = THREE.SRGBColorSpace;
  contactMap.magFilter = THREE.LinearFilter; contactMap.minFilter = THREE.LinearFilter; contactMap.needsUpdate = true;
  const contactMaterial = new THREE.MeshBasicMaterial({ map: contactMap, transparent: true, depthWrite: false, toneMapped: false });
  const contactSupports = staticObstacles.filter(obstacle => ['desk', 'sofa', 'plant', 'meeting-table', 'coffee-counter', 'coffee-table', 'rack', 'studio-shelf'].includes(obstacle.id));
  const contacts = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), contactMaterial, contactSupports.length);
  contacts.name = 'Contato suave · móveis e vasos';
  contactSupports.forEach((obstacle, index) => {
    matrix.makeScale((obstacle.maxX - obstacle.minX) * 1.45, 1, (obstacle.maxZ - obstacle.minZ) * 1.65);
    matrix.setPosition((obstacle.minX + obstacle.maxX) / 2, 0.03, (obstacle.minZ + obstacle.maxZ) / 2); contacts.setMatrixAt(index, matrix);
  });
  contacts.instanceMatrix.needsUpdate = true; group.add(contacts);

  // Canvas is updated only when real local progress is supplied by the app.
  const boardSurface = canvasTexture(1024, 640, () => {});
  const boardMaterial = new THREE.MeshBasicMaterial({ map: boardSurface.texture, toneMapped: false });
  rounded([3.25, 2.12, 0.13], [-2.05, 1.86, 0], 'wood').rotation.y = Math.PI / 2;
  const boardFace = mesh(new THREE.PlaneGeometry(3.07, 1.92), boardMaterial, [-1.973, 1.86, 0]);
  boardFace.rotation.y = Math.PI / 2; boardFace.castShadow = false;
  interactables.push({ id: 'board', kind: 'board', roomId: null, name: 'Quadro de tarefas', position: { x: -1, z: 0 } });

  function setBoardProgress(done, total) {
    const count = Math.max(0, Math.trunc(Number(total) || 0));
    const complete = Math.max(0, Math.min(count, Math.trunc(Number(done) || 0)));
    const { context: ctx, width: w, height: h } = boardSurface;
    ctx.fillStyle = '#f2ecd9'; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'left'; ctx.fillStyle = '#49644f'; ctx.font = '700 38px sans-serif'; ctx.fillText('HOJE NA SEDE', 70, 92);
    ctx.fillStyle = '#263f35'; ctx.font = '700 100px sans-serif'; ctx.fillText(count ? `${complete} / ${count}` : 'Vamos começar.', 70, 245);
    ctx.font = '38px sans-serif'; ctx.fillText(count ? 'tarefas concluídas' : 'Quadro de trabalho', 73, 315);
    ctx.fillStyle = '#d5dcc4'; ctx.fillRect(73, 390, 875, 30);
    if (count) { ctx.fillStyle = '#5f8365'; ctx.fillRect(73, 390, 875 * complete / count, 30); }
    ctx.fillStyle = '#6c7865'; ctx.font = '27px sans-serif'; ctx.fillText('Atividades desta sessão · teste local', 73, 531);
    boardSurface.texture.needsUpdate = true;
    group.userData.boardProgress = { done: complete, total: count };
  }
  function occupied(door, occupants) {
    const aperture = doorColliders.get(door.id);
    return occupants.some(person => {
      if (!Number.isFinite(person?.x) || !Number.isFinite(person?.z)) return false;
      const radius = Number.isFinite(person.radius) ? Math.max(0, person.radius) : 0.3;
      const x = THREE.MathUtils.clamp(person.x, aperture.minX - 0.06, aperture.maxX + 0.06);
      const z = THREE.MathUtils.clamp(person.z, aperture.minZ - 0.06, aperture.maxZ + 0.06);
      return Math.hypot(person.x - x, person.z - z) <= radius;
    });
  }
  function getDoor(id) { return doors.find(door => door.id === id) || null; }
  function toggleDoor(id, occupants = []) {
    const door = getDoor(id);
    if (!door) return { ok: false, message: 'Porta não encontrada.' };
    if (id === 'entrance' && floorIndex !== 0) return { ok: false, message: 'A entrada do parque fica no térreo.' };
    const opening = !door.targetOpen;
    if (!opening && occupied(door, occupants)) return { ok: false, message: `A passagem de ${door.name} está ocupada.` };
    door.targetOpen = opening;
    if (!opening) door.isOpen = false;
    return { ok: true, message: `${opening ? 'Abrindo' : 'Fechando'} ${door.name}.` };
  }
  function setStationActive(roomId, value) {
    const material = stationMaterials.get(roomId);
    if (!material) return false;
    const active = Boolean(value); activeStations.set(roomId, active);
    material.color.set(active ? '#83bba4' : '#345a52'); material.emissiveIntensity = active ? 0.5 : 0.04;
    group.userData.stationStates = Object.fromEntries(activeStations);
    return true;
  }
  function brewCoffee({ forPlayer = false } = {}) {
    if (coffeeTime > 0) { if (forPlayer) coffeeReserved = true; return { ok: forPlayer, message: 'O café já está sendo preparado.' }; }
    if (coffeeReady) return { ok: forPlayer, message: 'Seu café está pronto. Chegue perto para pegar.' };
    coffeeReserved = forPlayer;
    coffeeTime = 3.5; steam.visible = true; coffeeSurface.visible = true;
    coffeeCup.visible = true;
    group.userData.coffeeBrewing = true;
    return { ok: true, message: 'Preparando um café.' };
  }
  function takeCoffee() { if (!coffeeReady) return false; coffeeReady = false; coffeeReserved = false; coffeeCup.visible = false; coffeeSurface.visible = false; return true; }
  function getCoffeeSnapshot() { return { brewing: coffeeTime > 0, ready: coffeeReady }; }
  function update(dt, occupants = [], { coffeeRunning = true } = {}) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    elapsed += dt;
    for (const door of doors) {
      if (!door.targetOpen && door.progress > 0 && occupied(door, occupants)) door.targetOpen = true;
      door.progress = THREE.MathUtils.clamp(door.progress + (door.targetOpen ? 1 : -1) * dt / OPEN_TIME, 0, 1);
      door.isOpen = door.targetOpen && door.progress === 1;
      const t = door.progress < 0.5 ? 2 * door.progress ** 2 : 1 - (-2 * door.progress + 2) ** 2 / 2;
      const visual = doorVisuals.get(door.id); visual.panel.position[visual.axis] = visual.base + visual.slide * t;
    }
    if (coffeeTime > 0 && coffeeRunning) {
      coffeeTime = Math.max(0, coffeeTime - dt);
      if (coffeeTime === 0) coffeeReady = coffeeReserved;
      for (let i = 0; i < 9; i++) { const t = (elapsed * 0.65 + i / 9) % 1; steamPositions[i * 3] = 9.64 + Math.sin(t * 5 + i) * 0.035; steamPositions[i * 3 + 1] = 1.34 + t * 0.55; steamPositions[i * 3 + 2] = 5.7 + Math.cos(t * 4 + i) * 0.035; }
      steamGeometry.attributes.position.needsUpdate = true;
      steam.visible = coffeeTime > 0; group.userData.coffeeBrewing = coffeeTime > 0;
    }
  }
  function setTheme(name) {
    const palette = PALETTES[name] || PALETTES.studio;
    for (const [key, value] of Object.entries(palette)) materials[key].color.set(value);
    materials.glass.opacity = name === 'night' ? 0.16 : 0.12;
    group.userData.theme = PALETTES[name] ? name : 'studio';
    setNight(nightAmount);
  }
  function setNight(amount) {
    if (!Number.isFinite(amount)) return nightAmount;
    nightAmount = THREE.MathUtils.clamp(amount, 0, 1);
    lampMaterial.emissive.copy(dayLampColor).lerp(nightLampColor, nightAmount);
    lampMaterial.emissiveIntensity = 0.55 + nightAmount * 1.45;
    ceilingMaterial.emissiveIntensity = 0.2 + nightAmount * 0.3;
    for (const [name, strength] of Object.entries(NIGHT_BOUNCE)) {
      const material = materials[name];
      if (nightAmount === 0) {
        material.emissive.setHex(0x000000);
        material.emissiveIntensity = 1;
      } else {
        material.emissive.copy(material.color).multiply(bounceTint);
        material.emissiveIntensity = strength * nightAmount;
      }
    }
    group.userData.nightAmount = nightAmount;
    return nightAmount;
  }
  function setFloor(index) {
    floorIndex = THREE.MathUtils.clamp(Math.trunc(Number(index) || 0), 0, 3);
    entrance.targetOpen = false; entrance.isOpen = false; entrance.progress = 0;
    entrancePanel.position.x = 0; entrancePanel.visible = floorIndex === 0;
    entranceSign.visible = floorIndex === 0; upperFrontWall.visible = floorIndex !== 0;
    group.userData.floor = floorIndex;
    return floorIndex;
  }
  // Keep dynamic doors, the cup and visibility groups independent. All fixed
  // furniture is flattened by material into its owning visibility group.
  function mergeStatic(parent, preserve = new Set()) {
    const buckets = new Map();
    parent.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(parent.matrixWorld).invert();
    function collect(object) {
      if (preserve.has(object) || object.isInstancedMesh || object.isPoints || object.isLight) return;
      if (object.isMesh) {
        const geometry = object.geometry.clone();
        geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld));
        if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.attributes.position.count }, (_, index) => index));
        const key = `${object.material.uuid}:${object.castShadow}:${object.receiveShadow}`;
        if (!buckets.has(key)) buckets.set(key, { material: object.material, castShadow: object.castShadow, receiveShadow: object.receiveShadow, geometries: [], sources: [] });
        const bucket = buckets.get(key); bucket.geometries.push(geometry); bucket.sources.push(object);
      } else for (const child of [...object.children]) collect(child);
    }
    for (const child of [...parent.children]) collect(child);
    for (const bucket of buckets.values()) {
      const geometry = mergeGeometries(bucket.geometries, false);
      if (!geometry) throw new Error('Falha ao compactar a geometria estática do escritório.');
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const merged = new THREE.Mesh(geometry, bucket.material); merged.name = 'Estático · material compartilhado';
      merged.castShadow = bucket.castShadow; merged.receiveShadow = bucket.receiveShadow; parent.add(merged);
      for (const source of bucket.sources) source.removeFromParent();
      for (const temporary of bucket.geometries) temporary.dispose();
    }
  }
  const dynamicPanels = [...doorVisuals.values()].map(visual => visual.panel);
  mergeStatic(group, new Set([cutaway, coffeeCup, coffeeSurface, ...dynamicPanels]));
  mergeStatic(cutaway, new Set([entrancePanel, entranceSign, upperFrontWall]));
  mergeStatic(upperFrontWall);
  for (const panel of dynamicPanels) mergeStatic(panel);
  // Raycasts must reference the new scene meshes, never detached originals.
  occluders.length = 0;
  group.traverse(object => { if (object.isMesh && [materials.wall, materials.glass].includes(object.material)) occluders.push(object); });
  // Source geometry caches are construction-only. Dispose copies that are no
  // longer referenced; the merged buffers remain owned by their visible mesh.
  const liveGeometries = new Set(); group.traverse(object => { if (object.geometry) liveGeometries.add(object.geometry); });
  for (const geometry of [unitBox, cylinderGeometry, leafGeometry, ...roundedGeometries.values()]) if (!liveGeometries.has(geometry)) geometry.dispose();
  setBoardProgress(0, 0);
  setNight(0);
  group.userData.stationStates = Object.fromEntries(activeStations);
  group.userData.coffeeBrewing = false;
  cutaway.visible = false;
  scene.add(group);
  return {
    group, staticObstacles, doors, getDoor, toggleDoor, update, setStationActive, brewCoffee, takeCoffee, getCoffeeSnapshot, setBoardProgress, interactables, occluders,
    getObstacles() { return [...staticObstacles, ...doors.filter(door => !door.isOpen).map(door => doorColliders.get(door.id))]; },
    setCutaway(value) { cutaway.visible = !Boolean(value); group.userData.cutaway = Boolean(value); },
    setTheme, setFloor, setNight,
  };
}

import * as THREE from 'three';
import { LOCAL_LIGHTING_PROFILE } from './lighting.js';

const FLOOR_HEIGHT = 4;
const FLOOR_COLORS = ['#608065', '#b97d61', '#648f9b', '#a79761'];
const FLOOR_NAMES = ['TÉRREO · RECEPÇÃO', '01 · CRIAÇÃO', '02 · ENGENHARIA', '03 · ESTRATÉGIA'];
const DOOR_TIME = 0.9;

/** Exterior stays at ground level; only elevator.group is translated by setLiftHeight. */
export function createWorld(scene) {
  const group = new THREE.Group(); group.name = 'Sede · Parque e edifício';
  const landscape = new THREE.Group(); landscape.name = 'Parque caminhável'; group.add(landscape);
  const building = new THREE.Group(); building.name = 'Fachada · quatro andares'; group.add(building);
  const bounds = { minX: -62, maxX: 80, minZ: -34, maxZ: 42 };
  const obstacles = [];
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const leafGeometry = new THREE.IcosahedronGeometry(1, 0);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);
  const palette = {
    stone: '#dcdacb', concrete: '#bcbeb1', wall: '#e8e4d8', wood: '#a77c54', dark: '#314a43',
    glass: '#698d80', grass: '#6c963f', grassLight: '#7ea74c', leaf: '#386b45', leafLight: '#5a8b48',
    bark: '#8b6b4e', sand: '#d9cbb0', metal: '#314a43', paper: '#f1ead3', lamp: '#f4e6b9',
  };
  const materials = Object.fromEntries(Object.entries(palette).map(([name, color]) => [name, new THREE.MeshStandardMaterial({ color, roughness: name === 'glass' ? 0.32 : 0.91, metalness: name === 'glass' ? 0.13 : 0 })]));
  materials.lamp.emissive.set('#f4dfab'); materials.lamp.emissiveIntensity = 0.5;
  materials.wood.roughness = 0.78; materials.stone.roughness = 0.93;
  materials.metal.roughness = 0.48; materials.metal.metalness = 0.52;
  const liftRingMaterial = new THREE.MeshStandardMaterial({ color: '#91c58b', emissive: '#91c58b', emissiveIntensity: 0.15, roughness: 0.35, metalness: 0.25 });
  const liftRingGeometry = new THREE.TorusGeometry(0.06, 0.008, 6, 20);
  const liftButtonGeometry = new THREE.CylinderGeometry(0.045, 0.045, 0.018, 16);
  const indicator = surface(256, 512);
  const indicatorMaterial = new THREE.MeshBasicMaterial({ map: indicator.texture, toneMapped: false });
  const accentMaterials = FLOOR_COLORS.map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.84 }));
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), scaleVector = new THREE.Vector3(), positionVector = new THREE.Vector3();

  function mesh(geometry, material, position, scale, parent = group) {
    const object = new THREE.Mesh(geometry, typeof material === 'string' ? materials[material] : material);
    object.position.set(...position); object.scale.set(...scale);
    object.castShadow = true; object.receiveShadow = true; parent.add(object);
    return object;
  }
  function box(size, position, material, parent = group) { return mesh(boxGeometry, material, position, size, parent); }
  function collider(x, z, width, depth, id) { return { minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2, id }; }
  function block(x, z, width, depth, id) { obstacles.push(collider(x, z, width, depth, id)); }
  function batch(geometry, material, items, parent) {
    const object = new THREE.InstancedMesh(geometry, typeof material === 'string' ? materials[material] : material, items.length);
    for (let index = 0; index < items.length; index++) {
      const item = items[index]; positionVector.set(...item.position); scaleVector.set(...item.scale);
      if (item.quaternion) rotation.copy(item.quaternion);
      else rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, item.yaw || 0);
      matrix.compose(positionVector, rotation, scaleVector); object.setMatrixAt(index, matrix);
    }
    object.instanceMatrix.needsUpdate = true; object.castShadow = true; object.receiveShadow = true;
    parent.add(object); return object;
  }
  function surface(width, height) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível criar a sinalização da sede.');
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return { context, texture, width, height };
  }
  function label(text, subtitle, width, height, position, parent, yaw = 0, color = '#344a3d') {
    const { context: ctx, texture } = surface(768, 192);
    ctx.fillStyle = '#efe8d3'; ctx.fillRect(0, 0, 768, 192);
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 58px sans-serif'; ctx.fillText(text, 384, subtitle ? 72 : 100);
    if (subtitle) { ctx.font = '26px sans-serif'; ctx.fillText(subtitle, 384, 143); }
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    const object = mesh(new THREE.PlaneGeometry(width, height), material, position, [1, 1, 1], parent);
    object.rotation.y = yaw; object.castShadow = false; return object;
  }

  // Visual terrain continues beyond the walkable park, so upper windows never expose a cut edge.
  const terrain = box([640, 0.16, 640], [0, -0.15, 2], 'grass', landscape);
  terrain.name = 'Chão contínuo do horizonte'; terrain.castShadow = false;
  const horizon = new THREE.Group(); horizon.name = 'Horizonte · cidade e montanhas'; landscape.add(horizon);
  const distantMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  function distantBatch(name, geometry, instances, colors) {
    const object = batch(geometry, distantMaterial, instances, horizon); object.name = name;
    instances.forEach((_, index) => object.setColorAt(index, new THREE.Color(colors[index % colors.length])));
    object.instanceColor.needsUpdate = true;
    // Distant scenery costs no shadow draw calls and cannot affect local collision.
    object.castShadow = false; object.receiveShadow = false;
    return object;
  }
  // Three depth layers share one draw batch. A deterministic skyline avoids visual reshuffling.
  const city = [], cityColors = [], windows = [];
  const cityPalette = ['#b6bfae', '#c9c8b3', '#aab9b0', '#c5beb0', '#a9b5b5'];
  const cityLayers = [{ count: 40, radius: 126, height: 12 }, { count: 32, radius: 161, height: 18 }, { count: 26, radius: 195, height: 23 }];
  for (const [layer, specification] of cityLayers.entries()) for (let index = 0; index < specification.count; index++) {
    const angle = index * Math.PI * 2 / specification.count + layer * 0.091;
    const radius = specification.radius + 8 * (0.5 + 0.5 * Math.sin(index * 2.39 + layer));
    const height = specification.height + (index * 7 % 14), width = 3.4 + (index % 4) * 1.05, depth = 3.8 + (index % 3);
    const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius;
    const color = cityPalette[(index + layer * 2) % cityPalette.length];
    const addBlock = (position, scale) => { city.push({ position, scale, yaw: angle }); cityColors.push(color); };
    addBlock([x, height / 2 - 0.07, z], [width, height, depth]);
    if (index % 3 !== 1) addBlock([x, height + 0.74, z], [width * 0.64, 1.55, depth * 0.65]);
    if (index % 5 === 0) {
      addBlock([x, height + 2.08, z], [width * 0.32, 1.3, depth * 0.34]);
      addBlock([x, height + 3.5, z], [0.11, 1.65, 0.11]);
    }
    if (index % 4 === 2) addBlock([x + Math.cos(angle) * width * 0.36, height + 0.42, z - Math.sin(angle) * width * 0.36], [0.25, 0.98, depth * 0.86]);
    // Only the inward and side faces need windows; the distant layer remains a quieter silhouette.
    if (layer > 1) continue;
    const columns = Math.max(2, Math.floor(width / 1.15)), rows = Math.floor((height - 1.1) / 3.4);
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      if ((index * 5 + row * 3 + column + layer) % 5 === 0) continue;
      const localX = (column - (columns - 1) / 2) * 1.05, localZ = -depth / 2 - 0.025;
      windows.push({ position: [x + Math.cos(angle) * localX + Math.sin(angle) * localZ, 1.5 + row * 3.4, z - Math.sin(angle) * localX + Math.cos(angle) * localZ], scale: [0.43, 0.7, 0.03], yaw: angle });
      if (column === 0 && row % 2 === 0) for (const side of [-1, 1]) {
        windows.push({ position: [x + Math.cos(angle) * side * (width / 2 + 0.025), 1.5 + row * 3.4, z - Math.sin(angle) * side * (width / 2 + 0.025)], scale: [0.03, 0.7, 0.48], yaw: angle });
      }
    }
  }
  const citySolids = distantBatch('Cidade distante · blocos instanciados', boxGeometry, city, cityColors);
  citySolids.userData.buildings = cityLayers.reduce((total, layer) => total + layer.count, 0);
  const cityWindowMaterial = new THREE.MeshStandardMaterial({ color: '#9caeab', emissive: '#ffd28d', emissiveIntensity: 0, roughness: 0.38, metalness: 0.06 });
  const cityWindows = batch(boxGeometry, cityWindowMaterial, windows, horizon);
  cityWindows.name = 'Cidade · janelas acesas'; cityWindows.castShadow = false; cityWindows.receiveShadow = false;
  windows.forEach((_, index) => cityWindows.setColorAt(index, new THREE.Color(['#e2ceb0', '#b8cbd3', '#e8d9b3'][index % 3])));
  cityWindows.instanceColor.needsUpdate = true;
  const mountains = [];
  for (let index = 0; index < 28; index++) {
    const angle = index * Math.PI * 2 / 28 + 0.06, radius = 214 + 7 * Math.sin(index * 1.8);
    const height = 21 + (index * 11 % 17);
    mountains.push({ position: [Math.sin(angle) * radius, height / 2 - 0.08, Math.cos(angle) * radius],
      scale: [17 + (index % 4) * 2.5, height, 15 + (index % 3) * 3], yaw: angle + index * 0.37 });
  }
  distantBatch('Montanhas distantes · relevo instanciado', new THREE.ConeGeometry(1, 1, 5, 1), mountains, ['#91a69c', '#a4b5aa', '#9aaba3', '#acb9ae']);

  // Continuous level paths around the building, including the lift shaft.
  const paths = [
    { position: [0, -0.035, 21.15], scale: [4.4, 0.07, 26.3] },
    { position: [0, -0.035, 11.1], scale: [31.2, 0.07, 4.2] },
    { position: [0, -0.035, -13.8], scale: [31.2, 0.07, 4.2] },
    { position: [-14, -0.035, -1.4], scale: [3.2, 0.07, 25.6] },
    { position: [14, -0.035, -1.4], scale: [3.2, 0.07, 25.6] },
    { position: [-13, -0.035, 17], scale: [21.6, 0.07, 2.5] },
    { position: [13, -0.035, 17], scale: [21.6, 0.07, 2.5] },
    { position: [0, -0.034, 8.6], scale: [4.4, 0.068, 1.4] },
    { position: [-17.4, -0.035, 6.5], scale: [3.6, 0.07, 1.3] },
    { position: [16.9, -0.035, -3], scale: [2.6, 0.07, 1.3] },
  ];
  for (const z of [19.2, 20.4, 21.6, 22.8]) paths.push({ position: [18, -0.035, z], scale: [1.3, 0.07, 0.9] });
  batch(boxGeometry, 'stone', paths, landscape).castShadow = false;
  const joints = [];
  for (let z = 10; z <= 32; z += 2) joints.push({ position: [0, 0.002, z], scale: [4.35, 0.003, 0.013] });
  batch(boxGeometry, 'concrete', joints, landscape).castShadow = false;
  // Flat planted strips add texture at walking height without new collision volumes.
  const lawnStrips = [];
  for (const x of [-8, 8]) for (const z of [22, 27, 32]) lawnStrips.push({ position: [x, -0.066, z], scale: [8.8, 0.006, 2.6] });
  const lawn = batch(boxGeometry, 'grassLight', lawnStrips, landscape); lawn.name = 'Gramado · faixas de manutenção'; lawn.castShadow = false;
  box([4.5, 0.035, 3.8], [-21, -0.025, 18.4], 'sand', landscape);
  box([4.5, 0.035, 3.8], [21, -0.025, 18.4], 'sand', landscape);

  // The shell is thin and visual only; these footprint colliders protect every exterior wall.
  for (const x of [-6.275, 6.275]) block(x, 8, 9.95, 0.48, 'building-front');
  for (const x of [-6.225, 6.225]) block(x, -8, 10.05, 0.48, 'building-back');
  for (const x of [-11, 11]) block(x, 0, 0.48, 16.4, 'building-side');

  const shellFloors = [];
  for (let floor = 0; floor < 4; floor++) {
    const storey = new THREE.Group(); storey.name = FLOOR_NAMES[floor]; storey.position.y = floor * FLOOR_HEIGHT; building.add(storey); shellFloors.push(storey);
    const parts = new Map();
    function part(size, position, material) { if (!parts.has(material)) parts.set(material, []); parts.get(material).push({ position, scale: size }); }
    // Perimeter beams do not cap the occupied interior or the moving cabin.
    for (const z of [-8.15, 8.15]) {
      part([22.45, 0.28, 0.38], [0, 3.72, z], 'stone');
      part([22.45, 0.14, 0.46], [0, 3.96, z], floor);
    }
    for (const x of [-11.15, 11.15]) {
      part([0.38, 0.28, 16.45], [x, 3.72, 0], 'stone');
      part([0.46, 0.14, 16.45], [x, 3.96, 0], floor);
      part([0.16, 0.72, 16.3], [x, 0.36, 0], 'wall');
      // Office instances own the transparent glass: avoid a second tinted pane.
      for (const z of [-8, -4, 0, 4, 8]) part([0.23, 3.6, 0.17], [x, 1.8, z], 'wood');
      part([0.24, 0.12, 16.2], [x, 0.78, 0], 'wood');
    }
    for (const x of [-6.25, 6.25]) {
      for (const z of [-8.15, 8.15]) {
        part([9.6, 0.72, 0.16], [x, 0.36, z], 'wall');
        part([9.65, 0.12, 0.24], [x, 0.78, z], 'wood');
      }
    }
    for (const x of [-10.95, -7.55, -4.15, -1.43, 1.43, 4.15, 7.55, 10.95]) {
      for (const z of [-8.17, 8.17]) part([0.17, 3.6, 0.23], [x, 1.8, z], 'wood');
    }
    if (floor > 0) part([2.6, 0.72, 0.16], [0, 0.36, 8.17], floor);
    part([2.76, 0.55, 0.16], [0, 3.31, 8.17], floor);
    // Real call plates sit against the existing portal wall without narrowing its opening.
    part([0.36, 0.94, 0.075], [1.72, 1.52, -7.84], 'dark');
    part([0.32, 0.9, 0.018], [1.72, 1.52, -7.792], 'metal');
    const callDisplay = mesh(new THREE.PlaneGeometry(0.26, 0.52), indicatorMaterial, [1.72, 1.7, -7.779], [1, 1, 1], storey);
    callDisplay.name = `Chamada do elevador · piso ${floor}`; callDisplay.castShadow = false;
    const ring = mesh(liftRingGeometry, liftRingMaterial, [1.72, 1.25, -7.769], [1, 1, 1], storey); ring.castShadow = false;
    const button = mesh(liftButtonGeometry, 'paper', [1.72, 1.25, -7.768], [1, 1, 1], storey); button.rotation.x = Math.PI / 2;
    for (const [material, instances] of parts) batch(boxGeometry, typeof material === 'number' ? accentMaterials[material] : material, instances, storey);
    label(FLOOR_NAMES[floor], '', 2.34, 0.43, [0, 3.31, 8.272], storey, 0, FLOOR_COLORS[floor]);
  }
  // Lift shaft is separate from the facade and stops outside the north office wall.
  const shaft = new THREE.Group(); shaft.name = 'Poço externo do elevador'; building.add(shaft);
  const shaftFloors = [];
  for (let floor = 0; floor < 4; floor++) {
    const segment = new THREE.Group(); segment.name = `Poço · piso ${floor}`; segment.position.y = floor * FLOOR_HEIGHT; shaft.add(segment); shaftFloors.push(segment);
    batch(boxGeometry, 'wall', [-1.52, 1.52].map(x => ({ position: [x, 2, -9.47], scale: [0.17, 4, 2.9] })), segment);
    box([3.2, 4, 0.18], [0, 2, -10.9], 'dark', segment);
  }
  const roof = new THREE.Group(); roof.name = 'Cobertura e identificação'; building.add(roof);
  box([3.2, 0.22, 3.08], [0, 16.35, -9.45], 'stone', roof);
  block(-1.52, -9.48, 0.2, 3, 'shaft-side'); block(1.52, -9.48, 0.2, 3, 'shaft-side'); block(0, -10.9, 3.24, 0.2, 'shaft-back');
  box([6.1, 0.18, 1.48], [0, 3.62, 8.85], 'dark', building);
  box([5.9, 0.06, 1.4], [0, 3.5, 8.85], 'wood', building);
  box([4.7, 1.27, 0.12], [0, 17, -0.08], 'wood', roof);
  for (const x of [-1.7, 1.7]) box([0.13, 1.2, 0.13], [x, 16.55, -0.08], 'dark', roof);
  label('Sede', 'Um lugar para boas ideias.', 4.4, 1.1, [0, 17, 0], roof);
  // Rooftop parapet without another full interior instance.
  for (const z of [-8.14, 8.14]) box([22.48, 0.54, 0.18], [0, 16.28, z], 'wall', roof);
  for (const x of [-11.14, 11.14]) box([0.18, 0.54, 16.3], [x, 16.28, 0], 'wall', roof);
  box([22.1, 0.12, 16.1], [0, 16.04, 0], 'stone', roof);

  // Furniture is instanced by material; the main entry and perimeter paths stay clear.
  const benchWood = [], benchMetal = [];
  for (const [x, z, yaw] of [[-21, 19, 0], [21, 19, 0], [-21, -7, Math.PI / 2], [21, -7, -Math.PI / 2], [-19, 27, 0], [19, 27, 0], [-21, -19, 0], [21, -19, 0]]) {
    const wood = [-0.22, 0, 0.22].map(offset => ({ position: [0, 0.51, offset], scale: [2.6, 0.12, 0.195] }));
    for (const y of [0.8, 1.03, 1.26]) wood.push({ position: [0, y, 0.3], scale: [2.6, 0.195, 0.1] });
    const metal = [-0.94, 0.94].map(offset => ({ position: [offset, 0.25, 0], scale: [0.12, 0.5, 0.56] }));
    for (const [items, output] of [[wood, benchWood], [metal, benchMetal]]) for (const item of items) {
      const local = new THREE.Vector3(...item.position).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      output.push({ position: [x + local.x, local.y, z + local.z], scale: item.scale, yaw });
    }
    block(x, z, yaw === 0 ? 2.75 : 0.85, yaw === 0 ? 0.85 : 2.75, 'bench');
  }
  // The two outdoor rooms reuse the furniture batches, rather than many small meshes.
  const gardenStone = [], gardenBeds = [], gardenShrubs = [], gardenFlowers = [], gatheringLights = [], gatheringPools = [], gatheringStrings = [];
  function furniturePart(output, position, scale, yaw = 0) { output.push({ position, scale, yaw }); }
  function slenderBeam(output, start, end, thickness = 0.055) {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end), direction = b.clone().sub(a);
    output.push({ position: a.add(b).multiplyScalar(0.5).toArray(), scale: [thickness, direction.length(), thickness], quaternion: new THREE.Quaternion().setFromUnitVectors(THREE.Object3D.DEFAULT_UP, direction.normalize()) });
  }
  // Left: a warm slatted pergola, with an open eastern entrance and level deck.
  for (let plank = 0; plank < 20; plank++) furniturePart(benchWood, [-21.9, -0.035, 2.14 + plank * 0.3], [6.1, 0.07, 0.28]);
  for (const x of [-24.8, -19]) for (const z of [2, 8]) {
    furniturePart(benchWood, [x, 1.48, z], [0.22, 2.96, 0.22]); block(x, z, 0.26, 0.26, 'pergola-post');
  }
  for (const z of [2, 8]) furniturePart(benchWood, [-21.9, 2.93, z], [6.4, 0.21, 0.18]);
  for (const x of [-24.8, -19]) furniturePart(benchWood, [x, 2.93, 5], [0.18, 0.21, 6.4]);
  for (let rafter = 0; rafter < 10; rafter++) furniturePart(benchWood, [-24.85 + rafter * 0.65, 3.08, 5], [0.12, 0.16, 6.65]);
  for (const z of [3.8, 6.3]) {
    furniturePart(benchWood, [-21.9, 0.78, z], [0.9, 0.09, 0.9]);
    furniturePart(benchMetal, [-21.9, 0.37, z], [0.12, 0.74, 0.12]);
    block(-21.9, z, 0.95, 0.95, 'cafe-table');
    for (const x of [-23, -20.8]) {
      furniturePart(benchWood, [x, 0.48, z], [0.42, 0.09, 0.42]);
      furniturePart(benchMetal, [x, 0.22, z], [0.12, 0.44, 0.12]);
      block(x, z, 0.44, 0.44, 'cafe-stool');
    }
    furniturePart(gardenStone, [-21.68, 0.895, z], [0.13, 0.14, 0.13]);
  }
  furniturePart(benchWood, [-24.2, 0.9, 5], [0.7, 0.12, 2.9]);
  furniturePart(benchWood, [-24.48, 0.45, 5], [0.12, 0.9, 2.9]);
  for (const z of [3.85, 6.15]) furniturePart(benchMetal, [-24.2, 0.4, z], [0.16, 0.8, 0.16]);
  block(-24.2, 5, 0.78, 3, 'cafe-counter');
  // Vines frame the western edge; sparse leaves retain the roof's striped light.
  for (let leaf = 0; leaf < 8; leaf++) {
    const z = 2.2 + leaf * 0.78;
    gardenShrubs.push({ position: [-24.72 + Math.sin(leaf * 1.6) * 0.15, 2.96, z], scale: [0.5, 0.25, 0.45], yaw: leaf * 0.7 });
  }
  for (const z of [2.8, 7.2]) {
    for (let bulb = 0; bulb < 6; bulb++) {
      const x = -24.5 + bulb * 1.04, y = 2.78 - Math.sin(bulb / 5 * Math.PI) * 0.27;
      gatheringLights.push({ position: [x, y, z], scale: [0.12, 0.15, 0.12] });
      if (bulb > 0) {
        const previousX = -24.5 + (bulb - 1) * 1.04, previousY = 2.78 - Math.sin((bulb - 1) / 5 * Math.PI) * 0.27;
        gatheringStrings.push(previousX, previousY + 0.08, z, x, y + 0.08, z);
      }
    }
  }
  gatheringPools.push({ position: [-21.9, 0.016, 5], scale: [6.5, 1, 6.5] });
  label('CAFÉ DO PARQUE', '', 2.1, 0.33, [-21.9, 2.82, 8.12], landscape);

  // Right: an octagonal water garden. The full basin is solid to walking avatars.
  for (let side = 0; side < 8; side++) {
    const angle = side * Math.PI / 4;
    gardenStone.push({ position: [23 + Math.sin(angle) * 1.59, 0.18, 23 + Math.cos(angle) * 1.59], scale: [1.36, 0.36, 0.19], yaw: angle });
  }
  furniturePart(gardenStone, [23, 0.17, 23], [0.55, 0.34, 0.55]);
  furniturePart(gardenStone, [23, 0.43, 23], [0.3, 0.2, 0.3]);
  block(23, 23, 3.7, 3.7, 'water-garden');
  const waterMaterial = new THREE.MeshStandardMaterial({ color: '#74a6a0', roughness: 0.25, metalness: 0.12, emissive: '#558a81', emissiveIntensity: 0 });
  const water = batch(cylinderGeometry, waterMaterial, [
    { position: [23, 0.235, 23], scale: [1.48, 0.035, 1.48], yaw: Math.PI / 8 },
    { position: [23, 0.72, 23], scale: [0.038, 0.38, 0.038] },
    { position: [23, 0.91, 23], scale: [0.1, 0.045, 0.1] },
  ], landscape);
  water.name = 'Jardim da água · espelho e fonte'; water.castShadow = false;
  gatheringPools.push({ position: [23, 0.016, 23], scale: [6.6, 1, 6.6] });

  // Small amenities: two real bicycle silhouettes, a rack and a wood-clad bin.
  const wheelInstances = [], wheelGeometry = new THREE.TorusGeometry(0.34, 0.04, 4, 12);
  for (const z of [-3.4, -2.6]) {
    const rear = [19.35, 0.38, z], front = [20.65, 0.38, z], crank = [20, 0.38, z], seat = [19.8, 0.97, z], head = [20.48, 0.98, z];
    for (const [a, b] of [[rear, seat], [seat, crank], [crank, rear], [seat, head], [head, crank], [head, front]]) slenderBeam(benchMetal, a, b);
    slenderBeam(benchMetal, head, [20.43, 1.15, z]); slenderBeam(benchMetal, [20.43, 1.15, z - 0.19], [20.43, 1.15, z + 0.19]);
    furniturePart(benchWood, [19.8, 1.02, z], [0.28, 0.07, 0.18]);
    for (const point of [rear, front]) {
      wheelInstances.push({ position: point, scale: [1, 1, 1] });
      for (const angle of [0, Math.PI / 3, Math.PI * 2 / 3]) gatheringStrings.push(point[0] - Math.cos(angle) * 0.31, point[1] - Math.sin(angle) * 0.31, z, point[0] + Math.cos(angle) * 0.31, point[1] + Math.sin(angle) * 0.31, z);
    }
  }
  const tireMaterial = new THREE.MeshStandardMaterial({ color: '#243a33', roughness: 0.85 });
  batch(wheelGeometry, tireMaterial, wheelInstances, landscape).name = 'Bicicletário · rodas';
  for (const z of [-3.8, -2.2]) furniturePart(benchMetal, [20, 0.3, z], [0.08, 0.6, 0.08]);
  furniturePart(benchMetal, [20, 0.61, -3], [0.08, 0.08, 1.68]);
  block(20, -3, 3, 1.8, 'bicycle-rack');
  furniturePart(benchMetal, [-17, 0.39, 9], [0.48, 0.78, 0.48]);
  for (const y of [0.15, 0.38, 0.61]) for (const z of [8.75, 9.25]) furniturePart(benchWood, [-17, y, z], [0.52, 0.11, 0.04]);
  block(-17, 9, 0.56, 0.56, 'park-bin');

  // Low planting islands create a rhythm in the lawn, away from every promenade.
  for (const [bedIndex, [x, z]] of [[-7, 24], [7, 24], [-7, 30], [7, 30], [-18, -19], [18, -19]].entries()) {
    gardenBeds.push({ position: [x, -0.025, z], scale: [1.7, 0.07, 0.88], yaw: bedIndex % 2 ? 0.2 : -0.2 });
    for (let shrub = 0; shrub < 3; shrub++) {
      const offset = shrub - 1;
      gardenShrubs.push({ position: [x + offset * 0.75, 0.26 + (shrub % 2) * 0.08, z + Math.sin(shrub + bedIndex) * 0.18], scale: [0.52, 0.4, 0.45], yaw: shrub + bedIndex });
    }
    for (let flower = 0; flower < 4; flower++) gardenFlowers.push({ position: [x - 1.05 + flower * 0.69, 0.52, z + Math.cos(flower * 1.7 + bedIndex) * 0.38], scale: [0.1, 0.075, 0.1], yaw: flower });
    block(x, z, 3.4, 1.76, 'ornamental-bed');
  }
  batch(boxGeometry, 'wood', benchWood, landscape).name = 'Bancos · oito lugares de encontro'; batch(boxGeometry, 'metal', benchMetal, landscape);
  const contactPixels = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const radius = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5), index = (y * 32 + x) * 4;
    contactPixels.set([35, 49, 41, Math.round(85 * Math.max(0, 1 - radius) ** 1.4)], index);
  }
  const contactMap = new THREE.DataTexture(contactPixels, 32, 32); contactMap.colorSpace = THREE.SRGBColorSpace;
  contactMap.magFilter = THREE.LinearFilter; contactMap.minFilter = THREE.LinearFilter; contactMap.needsUpdate = true;
  const contactMaterial = new THREE.MeshBasicMaterial({ map: contactMap, transparent: true, depthWrite: false, toneMapped: false });
  const benchContacts = obstacles.filter(obstacle => obstacle.id === 'bench').map(obstacle => ({ position: [(obstacle.minX + obstacle.maxX) / 2, 0.008, (obstacle.minZ + obstacle.maxZ) / 2], scale: [(obstacle.maxX - obstacle.minX) * 1.4, 1, (obstacle.maxZ - obstacle.minZ) * 1.6] }));
  const contacts = batch(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), contactMaterial, benchContacts, landscape);
  contacts.name = 'Contato suave · bancos'; contacts.castShadow = false; contacts.receiveShadow = false;
  const treeTrunks = [], crowns = [], lightCrowns = [];
  const trees = [[-24, 25, 1.1], [-14, 25, 0.9], [14, 26, 1.15], [25, 25, 0.95], [-26, 8, 1.3], [26, 7, 1.15], [-23, -16, 1.1], [23, -17, 1.2], [-13, -23, 1.05], [0, -24, 1.25], [13, -23, 1.1], [-28, -5, 0.95], [28, -6, 1.05]];
  trees.forEach(([x, z, size], index) => {
    treeTrunks.push({ position: [x, 1.4 * size, z], scale: [0.22 * size, 2.8 * size, 0.22 * size], yaw: index * 0.7 });
    crowns.push({ position: [x, 3.6 * size, z], scale: [1.9 * size, 2 * size, 1.75 * size], yaw: index * 0.8 });
    lightCrowns.push({ position: [x + 0.85 * size, 3.05 * size, z + 0.4 * size], scale: [1.18 * size, 1.35 * size, 1.18 * size], yaw: index });
    block(x, z, 0.55 * size, 0.55 * size, 'tree');
  });
  batch(cylinderGeometry, 'bark', treeTrunks, landscape); batch(leafGeometry, 'leaf', crowns, landscape); batch(leafGeometry, 'leafLight', lightCrowns, landscape);
  const beds = [...trees.map(([x, z, size]) => ({ position: [x, -0.055, z], scale: [0.95 * size, 0.015, 0.95 * size] })), ...gardenBeds];
  const mulch = batch(cylinderGeometry, 'bark', beds, landscape); mulch.name = 'Canteiros nivelados das árvores'; mulch.castShadow = false;
  const planterFrames = [], planterSoil = [], shrubs = [], flowers = [];
  for (const [x, z] of [[-18, 5], [18, 5], [-22, 12], [22, 12]]) {
    planterFrames.push({ position: [x, 0.23, z], scale: [1.8, 0.46, 1.1] });
    planterSoil.push({ position: [x, 0.468, z], scale: [1.6, 0.025, 0.9] });
    for (const offset of [-0.5, 0, 0.5]) {
      shrubs.push({ position: [x + offset, 0.63, z], scale: [0.43, 0.36, 0.39], yaw: offset * 2 });
      flowers.push({ position: [x + offset + 0.08, 0.93, z - 0.05], scale: [0.09, 0.065, 0.09], yaw: offset });
    }
    block(x, z, 1.8, 1.1, 'park-planter');
  }
  planterFrames.push(...gardenStone); shrubs.push(...gardenShrubs); flowers.push(...gardenFlowers);
  batch(boxGeometry, 'stone', planterFrames, landscape).name = 'Jardineiras · bordas de pedra';
  batch(boxGeometry, 'bark', planterSoil, landscape).castShadow = false;
  batch(leafGeometry, 'leafLight', shrubs, landscape).name = 'Canteiros · arbustos compactos';
  const flowerMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
  const flowerMesh = batch(leafGeometry, flowerMaterial, flowers, landscape); flowerMesh.castShadow = false; flowerMesh.name = 'Jardins · flores por grupos';
  flowers.forEach((_, index) => flowerMesh.setColorAt(index, new THREE.Color(index < 12 ? '#c69279' : ['#c69279', '#dbcaa0', '#b7a3bb'][Math.floor((index - 12) / 4) % 3])));
  flowerMesh.instanceColor.needsUpdate = true;
  // A small tethered bunch marks the lounge; it stays clear of the route and sightlines.
  const balloonGroup = new THREE.Group(); balloonGroup.name = 'Convívio · balões amarrados'; landscape.add(balloonGroup);
  const balloonAnchor = [-23, 0, 20.9];
  box([0.58, 0.32, 0.58], [balloonAnchor[0], 0.16, balloonAnchor[2]], 'stone', balloonGroup);
  block(balloonAnchor[0], balloonAnchor[2], 0.7, 0.7, 'balloon-anchor');
  const balloons = [[-0.43, 2.72, 0.05, '#b97d61'], [0.1, 3.12, 0.03, '#a8bd7c'], [0.53, 2.64, 0.12, '#78a9b4']];
  const balloonGeometry = new THREE.IcosahedronGeometry(1, 1);
  const balloonMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.56, metalness: 0.02 });
  const balloonItems = balloons.map(([x, y, z]) => ({ position: [balloonAnchor[0] + x, y, balloonAnchor[2] + z], scale: [0.36, 0.46, 0.36] }));
  const balloonMesh = batch(balloonGeometry, balloonMaterial, balloonItems, balloonGroup);
  balloons.forEach((item, index) => balloonMesh.setColorAt(index, new THREE.Color(item[3]))); balloonMesh.instanceColor.needsUpdate = true;
  const stringPositions = [...gatheringStrings];
  for (const [x, y, z] of balloons) stringPositions.push(balloonAnchor[0], 0.3, balloonAnchor[2], balloonAnchor[0] + x, y - 0.43, balloonAnchor[2] + z);
  const stringGeometry = new THREE.BufferGeometry(); stringGeometry.setAttribute('position', new THREE.Float32BufferAttribute(stringPositions, 3));
  balloonGroup.add(new THREE.LineSegments(stringGeometry, new THREE.LineBasicMaterial({ color: '#657b71' })));
  const detailGroups = [];
  for (const quadrant of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const smallDetails = new THREE.Group(); smallDetails.name = `Detalhe próximo · ${quadrant.join(',')}`; landscape.add(smallDetails);
    const items = [];
    for (const [x, z, size] of trees.filter(([x, z]) => Math.sign(x || 1) === quadrant[0] && Math.sign(z) === quadrant[1])) {
      for (let stem = 0; stem < 5; stem++) {
        const angle = stem * Math.PI * 2 / 5;
        // Short sprouts fit inside the existing trunk collider, not across walkable paths.
        items.push({ position: [x + Math.cos(angle) * 0.18 * size, 0.045 * size, z + Math.sin(angle) * 0.18 * size], scale: [0.07 * size, 0.19 * size, 0.07 * size], yaw: angle });
      }
    }
    if (!items.length) { smallDetails.removeFromParent(); continue; }
    batch(leafGeometry, 'leafLight', items, smallDetails).castShadow = false;
    smallDetails.userData.center = new THREE.Vector3(quadrant[0] * 23, 0, quadrant[1] * 18);
    detailGroups.push(smallDetails);
  }
  const bollardPosts = [], bollardLamps = [], lightPools = [];
  const outdoorLampMaterial = new THREE.MeshStandardMaterial({ color: '#eee4c7', emissive: '#ffe1a3', emissiveIntensity: 0.04, roughness: 0.45 });
  for (const x of [-3.15, 3.15]) for (const z of [14, 22, 30]) {
    bollardPosts.push({ position: [x, 0.41, z], scale: [0.14, 0.82, 0.14] });
    bollardLamps.push({ position: [x, 0.86, z], scale: [0.24, 0.12, 0.24] }); block(x, z, 0.28, 0.28, 'path-light');
    lightPools.push({ position: [x, 0.016, z], scale: [3.9, 1, 3.9] });
  }
  const lampLocations = [[-8, 20], [8, 20], [-8, 29], [8, 29], [-18, -11], [18, -11]];
  for (const [x, z] of lampLocations) {
    bollardPosts.push({ position: [x, 1.65, z], scale: [0.12, 3.3, 0.12] },
      { position: [x, 0.14, z], scale: [0.3, 0.28, 0.3] },
      { position: [x, 3.4, z], scale: [0.58, 0.09, 0.58] },
      { position: [x, 3.18, z], scale: [0.44, 0.06, 0.44] });
    bollardLamps.push({ position: [x, 3.28, z], scale: [0.38, 0.18, 0.38] });
    lightPools.push({ position: [x, 0.017, z], scale: [8.4, 1, 8.4] });
    block(x, z, 0.4, 0.4, 'park-lamp');
  }
  for (const [x, z] of [[-18.3, 2], [-18.3, 8], [20.6, 22], [25.4, 22], [23, 25.4]]) {
    bollardPosts.push({ position: [x, 0.34, z], scale: [0.14, 0.68, 0.14] });
    bollardLamps.push({ position: [x, 0.72, z], scale: [0.21, 0.1, 0.21] });
    gatheringPools.push({ position: [x, 0.016, z], scale: [3.6, 1, 3.6] });
    block(x, z, 0.26, 0.26, 'garden-bollard');
  }
  // Sconces attach to the existing ground-floor timber posts, never floating on upper cuts.
  for (const x of [-7.55, -4.15, 4.15, 7.55]) {
    bollardPosts.push({ position: [x, 2.2, 8.31], scale: [0.18, 0.34, 0.12] });
    bollardLamps.push({ position: [x, 2.2, 8.385], scale: [0.11, 0.21, 0.04] });
    gatheringPools.push({ position: [x, 0.016, 8.6], scale: [2.8, 1, 2.8] });
  }
  bollardLamps.push(...gatheringLights); lightPools.push(...gatheringPools);
  batch(boxGeometry, 'metal', bollardPosts, landscape).name = 'Iluminação · postes e balizadores';
  batch(boxGeometry, outdoorLampMaterial, bollardLamps, landscape).name = 'Iluminação · luminárias externas';
  // Soft radial pools provide the paths and gathering spaces in one transparent draw.
  const poolPixels = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const radius = Math.hypot((x - 31.5) / 31.5, (y - 31.5) / 31.5), pixel = (y * 64 + x) * 4;
    poolPixels.set([255, 213, 139, Math.round(255 * Math.max(0, 1 - radius * radius) ** 2.5)], pixel);
  }
  const poolMap = new THREE.DataTexture(poolPixels, 64, 64); poolMap.colorSpace = THREE.SRGBColorSpace;
  poolMap.magFilter = THREE.LinearFilter; poolMap.minFilter = THREE.LinearFilter; poolMap.needsUpdate = true;
  const poolMaterial = new THREE.MeshBasicMaterial({ map: poolMap, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const pools = batch(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMaterial, lightPools, landscape);
  pools.name = 'Iluminação · luz suave no chão'; pools.castShadow = false; pools.receiveShadow = false; pools.visible = false;
  // Two fixed-budget lights reveal moving visitors and furniture near the camera; no shadow maps.
  const nearLights = Array.from({ length: 2 }, (_, index) => {
    const light = new THREE.PointLight(LOCAL_LIGHTING_PROFILE.exteriorColor, 0, LOCAL_LIGHTING_PROFILE.exteriorRange, 2); light.name = `Iluminação próxima · ${index + 1}`;
    light.visible = false; light.userData.lampIndex = -1; landscape.add(light); return light;
  });
  let nightAmount = 0;
  const detailCamera = new THREE.Vector3(0, 40, 45);
  const illuminationAnchors = [...lampLocations.map(([x, z]) => [x, z, 3.12]), [-21.9, 5, 2.62], [23, 23, 1.3]];
  function updateNearLights(position) {
    const previous = new Set(nearLights.map(light => light.userData.lampIndex));
    const nearest = illuminationAnchors.map(([x, z, y], index) => ({ index, distance: Math.hypot(position.x - x, position.y - y, position.z - z) })).sort((a, b) => (a.distance - (previous.has(a.index) ? 2 : 0)) - (b.distance - (previous.has(b.index) ? 2 : 0))).slice(0, 2);
    // Keep stable slots when the same pair swaps distance order across a path.
    const retained = new Set(nearLights.map(light => light.userData.lampIndex).filter(index => nearest.some(candidate => candidate.index === index)));
    const assignments = nearLights.map(light => {
      const current = nearest.find(candidate => candidate.index === light.userData.lampIndex);
      if (current) return current;
      const next = nearest.find(candidate => !retained.has(candidate.index)); retained.add(next.index); return next;
    });
    nearLights.forEach((light, index) => {
      const candidate = assignments[index];
      if (candidate.index !== light.userData.lampIndex && light.intensity > .12) {
        // Fade at the old fixture before reusing a slot; never teleport a lit lamp.
        light.intensity *= .72; return;
      }
      light.userData.lampIndex = candidate.index;
      const [x, z, y] = illuminationAnchors[candidate.index];
      const visibility = 1 - THREE.MathUtils.smoothstep(candidate.distance, 15, 23);
      light.position.set(x, y, z);
      light.intensity = THREE.MathUtils.lerp(light.intensity, LOCAL_LIGHTING_PROFILE.exteriorIntensity * nightAmount * visibility, 0.13);
      light.visible = nightAmount > 0.001 && visibility > 0.001;
    });
  }
  function setNight(amount = 0) {
    if (!Number.isFinite(amount)) return false;
    nightAmount = THREE.MathUtils.clamp(amount, 0, 1);
    outdoorLampMaterial.emissiveIntensity = 0.04 + 2.4 * nightAmount;
    cityWindowMaterial.emissiveIntensity = 1.65 * nightAmount;
    waterMaterial.emissiveIntensity = 0.16 * nightAmount;
    poolMaterial.opacity = 0.22 * nightAmount; pools.visible = nightAmount > 0.001;
    if (nightAmount === 0) for (const light of nearLights) { light.intensity = 0; light.visible = false; }
    group.userData.nightAmount = nightAmount;
    return true;
  }
  box([0.15, 1.25, 0.15], [-4.5, 0.625, 13.2], 'wood', landscape); block(-4.5, 13.2, 0.22, 0.22, 'park-sign');
  label('BEM-VINDO À SEDE', 'Entre, explore e encontre o time.', 3.4, 0.85, [-4.5, 1.6, 13.2], landscape);

  // A single moving cabin. Its front edge meets the 2.4 m office portal at z = -8.
  const cabin = new THREE.Group(); cabin.name = 'Elevador · cabine móvel'; group.add(cabin);
  const elevator = { group: cabin, position: { x: 0, z: -9.3 }, doorPosition: { x: 0, z: -7.95 }, callPosition: { x: 1.72, z: -7.77 }, isOpen: false, progress: 0, targetOpen: false };
  box([2.8, 0.1, 2.64], [0, -0.05, -9.25], 'stone', cabin);
  box([2.7, 0.012, 2.48], [0, 0.006, -9.3], 'sand', cabin);
  for (const x of [-1.4, 1.4]) box([0.12, 3.12, 2.6], [x, 1.56, -9.3], 'wall', cabin);
  box([2.8, 3.12, 0.12], [0, 1.56, -10.55], 'wood', cabin);
  box([2.92, 0.12, 2.72], [0, 3.18, -9.3], 'dark', cabin);
  box([1.4, 0.04, 1.2], [0, 3.098, -9.35], 'lamp', cabin).castShadow = false;
  const cabinLight = new THREE.PointLight('#fff0cc', 3.5, 5, 2); cabinLight.position.set(0, 2.85, -9.35); cabin.add(cabinLight);
  box([2.4, 0.065, 0.07], [0, 1, -10.44], 'dark', cabin);
  for (const x of [-1.3, 1.3]) box([0.2, 3.12, 0.16], [x, 1.56, -7.98], 'dark', cabin);
  box([2.8, 0.22, 0.2], [0, 2.98, -7.98], 'dark', cabin);
  const leftDoor = box([1.195, 2.78, 0.07], [-0.6, 1.39, -7.95], 'metal', cabin);
  const rightDoor = box([1.195, 2.78, 0.07], [0.6, 1.39, -7.95], 'metal', cabin);
  leftDoor.name = 'Porta esquerda do elevador'; rightDoor.name = 'Porta direita do elevador';
  box([0.42, 1.02, 0.06], [0.86, 1.62, -10.465], 'dark', cabin);
  box([0.38, 0.98, 0.018], [0.86, 1.62, -10.425], 'metal', cabin);
  const display = mesh(new THREE.PlaneGeometry(0.32, 0.64), indicatorMaterial, [0.86, 1.77, -10.411], [1, 1, 1], cabin);
  display.name = 'Elevador · display de andar e direção'; display.castShadow = false;
  const cabinRing = mesh(liftRingGeometry, liftRingMaterial, [0.86, 1.26, -10.4], [1, 1, 1], cabin); cabinRing.castShadow = false;
  const cabinButton = mesh(liftButtonGeometry, 'paper', [0.86, 1.26, -10.399], [1, 1, 1], cabin); cabinButton.rotation.x = Math.PI / 2;
  label('ELEVADOR', 'T · 1 · 2 · 3', 1.35, 0.34, [-0.3, 2.2, -10.475], cabin);
  for (const x of [-1.4, 1.4]) block(x, -9.3, 0.12, 2.6, 'cabin-side');
  block(0, -10.55, 2.8, 0.12, 'cabin-back');
  for (const x of [-1.3, 1.3]) block(x, -7.98, 0.2, 0.16, 'lift-jamb');
  const doorObstacle = collider(0, -7.95, 2.4, 0.16, 'door-elevator');
  let currentFloor = -1;
  let liftTravel = { moving: false, direction: 0, targetFloor: 0 };
  let indicatorKey = '';

  function refreshIndicator() {
    const key = `${currentFloor}:${liftTravel.moving}:${liftTravel.direction}:${liftTravel.targetFloor}:${elevator.targetOpen}:${elevator.isOpen}`;
    if (key === indicatorKey) return;
    indicatorKey = key;
    const color = liftTravel.moving || (elevator.targetOpen && !elevator.isOpen) ? '#d6a25c' : '#91c58b';
    const ctx = indicator.context;
    ctx.fillStyle = '#233c34'; ctx.fillRect(0, 0, 256, 512); ctx.fillStyle = color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 168px sans-serif';
    ctx.fillText(currentFloor === 0 ? 'T' : String(currentFloor), 128, 150);
    ctx.font = '700 72px sans-serif'; ctx.fillText(liftTravel.moving ? (liftTravel.direction > 0 ? '↑' : '↓') : '•', 128, 292);
    ctx.font = '700 25px sans-serif'; ctx.fillText(liftTravel.moving ? `DESTINO ${liftTravel.targetFloor || 'T'}` : elevator.isOpen ? 'ABERTO' : 'ELEVADOR', 128, 385);
    ctx.fillStyle = '#e8e4d8'; ctx.font = '700 26px sans-serif'; ctx.fillText(liftTravel.moving ? 'EM VIAGEM' : '[F] ACESSAR', 128, 455);
    indicator.texture.needsUpdate = true;
    liftRingMaterial.color.set(color); liftRingMaterial.emissive.set(color);
    liftRingMaterial.emissiveIntensity = liftTravel.moving || elevator.targetOpen ? 0.6 : 0.12;
    cabin.userData.indicator = { floor: currentFloor, ...liftTravel, doorOpen: elevator.isOpen };
  }
  function setLiftTravel({ moving = false, direction = 0, targetFloor = currentFloor } = {}) {
    liftTravel = { moving: Boolean(moving), direction: Math.sign(Number(direction) || 0), targetFloor: THREE.MathUtils.clamp(Math.trunc(Number(targetFloor) || 0), 0, 3) };
    refreshIndicator();
  }

  function occupied(occupants) {
    return occupants.some(person => {
      if (!Number.isFinite(person?.x) || !Number.isFinite(person?.z)) return false;
      const radius = Number.isFinite(person.radius) ? Math.max(0, person.radius) : 0.3;
      const x = THREE.MathUtils.clamp(person.x, doorObstacle.minX - 0.06, doorObstacle.maxX + 0.06);
      const z = THREE.MathUtils.clamp(person.z, doorObstacle.minZ - 0.06, doorObstacle.maxZ + 0.06);
      return Math.hypot(person.x - x, person.z - z) <= radius;
    });
  }
  function toggleElevator(occupants = []) {
    const opening = !elevator.targetOpen;
    if (!opening && occupied(occupants)) return { ok: false, message: 'A passagem do elevador está ocupada.' };
    elevator.targetOpen = opening; if (!opening) elevator.isOpen = false;
    refreshIndicator();
    return { ok: true, message: `${opening ? 'Abrindo' : 'Fechando'} o elevador.` };
  }
  function update(dt, occupants = []) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (!elevator.targetOpen && elevator.progress > 0 && occupied(occupants)) elevator.targetOpen = true;
    elevator.progress = THREE.MathUtils.clamp(elevator.progress + (elevator.targetOpen ? 1 : -1) * dt / DOOR_TIME, 0, 1);
    elevator.isOpen = elevator.targetOpen && elevator.progress === 1;
    const t = elevator.progress < 0.5 ? 2 * elevator.progress ** 2 : 1 - (-2 * elevator.progress + 2) ** 2 / 2;
    leftDoor.position.x = -0.6 - 1.25 * t; rightDoor.position.x = 0.6 + 1.25 * t;
    refreshIndicator();
  }
  function setLiftHeight(y) {
    if (!Number.isFinite(y)) return false;
    cabin.position.y = THREE.MathUtils.clamp(y, 0, 3 * FLOOR_HEIGHT);
    const floor = Math.round(cabin.position.y / FLOOR_HEIGHT);
    if (floor !== currentFloor) {
      currentFloor = floor; cabin.userData.floor = floor; refreshIndicator();
    }
    return true;
  }
  function setExteriorVisible(value) { landscape.visible = Boolean(value); building.visible = Boolean(value); }
  function setView({ floor = 0, exterior = false, cutaway = true } = {}) {
    const selected = THREE.MathUtils.clamp(Math.trunc(Number(floor) || 0), 0, 3);
    const inspectFloor = Boolean(cutaway) && !exterior;
    landscape.visible = true; building.visible = true;
    shellFloors.forEach((storey, index) => { storey.visible = !inspectFloor || index <= selected; });
    shaftFloors.forEach((segment, index) => { segment.visible = !inspectFloor || index <= selected; });
    roof.visible = !inspectFloor;
    cabin.visible = true;
    // A ceiling is useful in first person but hides the visitor in the overview.
    for (const object of cabin.children) if (object.isMesh && object.position.y > 3.09) object.visible = !inspectFloor;
    group.userData.view = { floor: selected, exterior: Boolean(exterior), cutaway: Boolean(cutaway) };
  }
  function updateDetails(camera) {
    const position = camera?.position || camera;
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return;
    detailCamera.copy(position); updateNearLights(detailCamera);
    for (const detail of detailGroups) {
      const distance = detail.userData.center.distanceTo(position);
      if (detail.visible && distance > 42) detail.visible = false;
      else if (!detail.visible && distance < 34) detail.visible = true;
    }
  }
  setLiftHeight(0); setView(); setNight(0); scene.add(group);
  return { group, obstacles, bounds, elevator, toggleElevator, update, setLiftHeight, setLiftTravel, setExteriorVisible, setView, updateDetails, setNight,
    getObstacles() { return elevator.isOpen ? [...obstacles] : [...obstacles, doorObstacle]; },
  };
}

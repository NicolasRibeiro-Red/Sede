import * as THREE from 'three';

// Geometry uses initial world axes relative to Head, with the avatar 1.72 m tall.
// The caller applies Head position, quaternion delta and the user's avatar size.
const COLORS = { shell: '#285a57', cushion: '#172f31', metal: '#547773', gold: '#dca365', cap: '#be704e', capDark: '#8c503a', lens: '#b4d7c9' };

function roundedPath(width, height, radius, Path = THREE.Shape) {
  const path = new Path();
  const x = width / 2, y = height / 2, r = Math.min(radius, x * 0.8, y * 0.8);
  path.moveTo(-x + r, -y); path.lineTo(x - r, -y); path.quadraticCurveTo(x, -y, x, -y + r);
  path.lineTo(x, y - r); path.quadraticCurveTo(x, y, x - r, y);
  path.lineTo(-x + r, y); path.quadraticCurveTo(-x, y, -x, y - r);
  path.lineTo(-x, -y + r); path.quadraticCurveTo(-x, -y, -x + r, -y);
  path.closePath();
  return path;
}

function extrusion(shape, depth, bevel = 0) {
  return new THREE.ExtrudeGeometry(shape, {
    depth, steps: 1, curveSegments: 3, bevelEnabled: bevel > 0,
    bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1,
  });
}

function nearestSection(sections, y) {
  return sections.filter(s => s.head).reduce((closest, section) => !closest || Math.abs(section.y - y) < Math.abs(closest.y - y) ? section : closest, null)?.head;
}

function crownGeometry(width, depth, baseY, hairTop) {
  const rings = [[baseY, 1, 0.045], [hairTop + 0.015, 1, 0.045], [hairTop + 0.078, 0.92, 0.07]];
  const positions = [], indices = [];
  for (const [y, scale, corner] of rings) {
    const x = width * scale / 2, z = depth * scale / 2;
    for (const [cx, cz, start] of [[x - corner, z - corner, 0], [-x + corner, z - corner, Math.PI / 2], [-x + corner, -z + corner, Math.PI], [x - corner, -z + corner, Math.PI * 1.5]]) {
      for (let i = 0; i <= 3; i++) {
        const angle = start + i * Math.PI / 6;
        positions.push(cx + Math.cos(angle) * corner, y, cz + Math.sin(angle) * corner);
      }
    }
  }
  const count = positions.length / 3 / rings.length;
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count, a = ring * count + i, b = ring * count + next, c = a + count, d = b + count;
      indices.push(a, c, b, b, c, d);
    }
  }
  const center = positions.length / 3;
  positions.push(0, hairTop + 0.078, 0);
  for (let i = 0; i < count; i++) indices.push(center, 2 * count + (i + 1) % count, 2 * count + i);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** kind: headset | cap | glasses | none. Each returned group owns all its resources. */
export function createAccessory(kind, fit) {
  const group = new THREE.Group();
  group.name = `Accessory · ${kind}`;
  group.userData.kind = kind;
  group.userData.coordinateSpace = 'Head-relative initial world axes, normalized height 1.72, front +Z';
  if (kind === 'none') return group;
  if (!['headset', 'cap', 'glasses'].includes(kind)) throw new RangeError(`Unknown accessory: ${kind}`);
  const geometry = fit?.geometry;
  if (!geometry?.headBounds || !Array.isArray(fit.eyeOffset) || ![...fit.eyeOffset, fit.eyeSpacing, fit.headTopOffset].every(Number.isFinite)) {
    throw new TypeError('Accessory requires measured head geometry and eye fitting data.');
  }
  const head = geometry.headBounds;
  if (![head.min, head.max].every(values => Array.isArray(values) && values.length === 3 && values.every(Number.isFinite))
    || head.min.some((value, axis) => value >= head.max[axis]) || fit.eyeSpacing <= 0) {
    throw new TypeError('Accessory head bounds must be finite and have positive dimensions.');
  }
  const sections = geometry.horizontalSections || [];
  const eye = fit.eyeOffset;
  const materials = new Map();
  function material(name) {
    if (!materials.has(name)) materials.set(name, new THREE.MeshStandardMaterial({
      color: COLORS[name], roughness: name === 'lens' ? 0.25 : 0.79, metalness: 0,
      ...(name === 'lens' ? { transparent: true, opacity: 0.19, depthWrite: false, side: THREE.DoubleSide } : {}),
    }));
    return materials.get(name);
  }
  function add(name, shape, color, position = [0, 0, 0]) {
    const mesh = new THREE.Mesh(shape, material(color));
    mesh.name = name; mesh.position.set(...position); mesh.castShadow = color !== 'lens'; mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  function block(name, width, height, depth, color, position) {
    const bevel = Math.min(0.009, width * 0.12, height * 0.12, depth * 0.12);
    const shape = roundedPath(width - bevel * 2, height - bevel * 2, Math.min(0.025, width / 5, height / 5));
    const box = extrusion(shape, depth - bevel * 2, bevel);
    box.center();
    return add(name, box, color, position);
  }
  function rod(name, start, end, radius, color) {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end), direction = b.clone().sub(a);
    const mesh = add(name, new THREE.CylinderGeometry(radius, radius, direction.length(), 6), color);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return mesh;
  }

  if (kind === 'headset') {
    const bandSection = geometry.headbandProfileAtZ;
    const bandZ = bandSection?.z ?? (head.min[2] + head.max[2]) / 2;
    const innerLeft = head.min[0] - 0.026, innerRight = head.max[0] + 0.026;
    const innerTop = (bandSection?.bounds?.max[1] ?? head.max[1]) + 0.042;
    const earY = eye[1] + 0.035, bottom = earY - 0.04, thickness = 0.045, radius = 0.035;
    const outerLeft = innerLeft - thickness, outerRight = innerRight + thickness, outerTop = innerTop + thickness;
    const band = new THREE.Shape();
    band.moveTo(outerLeft, bottom); band.lineTo(outerLeft, outerTop - radius);
    band.quadraticCurveTo(outerLeft, outerTop, outerLeft + radius, outerTop);
    band.lineTo(outerRight - radius, outerTop); band.quadraticCurveTo(outerRight, outerTop, outerRight, outerTop - radius);
    band.lineTo(outerRight, bottom); band.lineTo(innerRight, bottom); band.lineTo(innerRight, innerTop - radius);
    band.quadraticCurveTo(innerRight, innerTop, innerRight - radius, innerTop);
    band.lineTo(innerLeft + radius, innerTop); band.quadraticCurveTo(innerLeft, innerTop, innerLeft, innerTop - radius);
    band.lineTo(innerLeft, bottom); band.closePath();
    add('headset-band', extrusion(band, 0.12), 'shell', [0, 0, bandZ - 0.06]);
    for (const side of [-1, 1]) {
      const surfaceX = side < 0 ? head.min[0] : head.max[0];
      const cushionX = surfaceX + side * 0.044;
      block(`headset-cushion-${side}`, 0.05, 0.23, 0.225, 'cushion', [cushionX, earY, bandZ]);
      block(`headset-cup-${side}`, 0.082, 0.27, 0.255, 'shell', [surfaceX + side * 0.098, earY, bandZ]);
      block(`headset-mark-${side}`, 0.012, 0.07, 0.09, 'gold', [surfaceX + side * 0.144, earY, bandZ]);
    }
    const micX = head.max[0] + 0.13, micZ = Math.max(head.max[2], eye[2]) + 0.065, micY = earY - 0.145;
    rod('headset-boom-side', [micX, earY - 0.065, bandZ + 0.1], [micX, micY, micZ], 0.014, 'metal');
    rod('headset-boom-front', [micX, micY, micZ], [eye[0] + 0.21, micY, micZ], 0.014, 'metal');
    block('headset-microphone', 0.12, 0.065, 0.065, 'cushion', [eye[0] + 0.2, micY, micZ]);
    group.userData.fitEnvelope = { innerLeft, innerRight, innerTop, bandZ, earY };
  }

  if (kind === 'glasses') {
    const frameWidth = THREE.MathUtils.clamp(fit.eyeSpacing * 0.74, 0.27, 0.36);
    const frameHeight = Math.max(0.23, (fit.eyePatchHeight || 0.12) + 0.075);
    const rim = 0.023, front = eye[2] + 0.028;
    const eyeSection = nearestSection(sections, eye[1]) || head;
    for (const side of [-1, 1]) {
      const x = eye[0] + side * fit.eyeSpacing / 2;
      const frame = roundedPath(frameWidth, frameHeight, 0.045);
      frame.holes.push(roundedPath(frameWidth - rim * 2, frameHeight - rim * 2, 0.026, THREE.Path));
      add(`glasses-frame-${side}`, extrusion(frame, 0.026), 'shell', [x, eye[1], front]);
      add(`glasses-lens-${side}`, new THREE.ShapeGeometry(roundedPath(frameWidth - rim * 2, frameHeight - rim * 2, 0.026), 3), 'lens', [x, eye[1], front + 0.015]);
      const outerX = x + side * (frameWidth / 2 - 0.01);
      const templeX = (side < 0 ? eyeSection.min[0] : eyeSection.max[0]) + side * 0.033;
      const templeFront = Math.max(front + 0.01, eyeSection.max[2] + 0.027);
      rod(`glasses-hinge-${side}`, [outerX, eye[1] + 0.035, front + 0.012], [templeX, eye[1] + 0.035, templeFront], 0.016, 'shell');
      rod(`glasses-temple-${side}`, [templeX, eye[1] + 0.035, templeFront], [templeX, eye[1] + 0.02, 0.015], 0.016, 'shell');
    }
    block('glasses-bridge', fit.eyeSpacing - frameWidth + 0.03, 0.027, 0.03, 'gold', [eye[0], eye[1] + 0.018, front + 0.012]);
    group.userData.fitEnvelope = { front, eyeY: eye[1], frameWidth, frameHeight, eyeSpacing: fit.eyeSpacing };
  }

  if (kind === 'cap') {
    const hairTop = geometry.capEnvelope?.highestHairY ?? head.max[1];
    const baseY = Math.max(eye[1] + 0.22, hairTop - 0.22);
    const below = sections.filter(section => section.head && section.y <= baseY).at(-1);
    const upper = sections.filter(section => section.head && section.y >= baseY).map(section => section.head);
    if (below) upper.push(below.head);
    const envelope = upper.length ? {
      min: [Math.min(...upper.map(b => b.min[0])), baseY, Math.min(...upper.map(b => b.min[2]))],
      max: [Math.max(...upper.map(b => b.max[0])), hairTop, Math.max(...upper.map(b => b.max[2]))],
    } : head;
    const centerX = (envelope.min[0] + envelope.max[0]) / 2, centerZ = (envelope.min[2] + envelope.max[2]) / 2;
    const width = envelope.max[0] - envelope.min[0] + 0.07, depth = envelope.max[2] - envelope.min[2] + 0.07;
    add('cap-crown', crownGeometry(width, depth, baseY, hairTop), 'cap', [centerX, 0, centerZ]);
    const band = roundedPath(width, depth, 0.045);
    band.holes.push(roundedPath(width - 0.035, depth - 0.035, 0.035, THREE.Path));
    // Finish the rim below the open crown: overlapping vertical faces shimmer.
    const bandHeight = 0.026;
    const bandGeometry = extrusion(band, bandHeight);
    bandGeometry.rotateX(-Math.PI / 2);
    add('cap-band', bandGeometry, 'capDark', [centerX, baseY - bandHeight, centerZ]);
    const visorWidth = width * 0.9, visorDepth = 0.34, visorFront = centerZ + depth / 2;
    const visorGeometry = extrusion(roundedPath(visorWidth, visorDepth, 0.11), 0.038);
    visorGeometry.rotateX(-Math.PI / 2);
    const visor = add('cap-visor', visorGeometry, 'cap', [centerX, baseY - 0.012, visorFront + visorDepth / 2 - 0.055]);
    visor.rotation.x = -0.045;
    const underside = extrusion(roundedPath(visorWidth * 0.96, visorDepth * 0.93, 0.1), 0.006);
    underside.rotateX(-Math.PI / 2);
    const lower = add('cap-visor-underside', underside, 'capDark', [centerX, baseY - 0.017, visorFront + visorDepth / 2 - 0.055]);
    lower.rotation.x = -0.045;
    block('cap-badge', 0.105, 0.085, 0.012, 'gold', [centerX, baseY + 0.11, visorFront + 0.008]);
    add('cap-button', new THREE.CylinderGeometry(0.031, 0.031, 0.019, 8), 'capDark', [centerX, hairTop + 0.087, centerZ]);
    group.userData.fitEnvelope = { baseY, hairTop, centerX, centerZ, width, depth, clearance: 0.035 };
  }
  return group;
}

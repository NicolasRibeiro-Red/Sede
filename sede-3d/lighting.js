import * as THREE from 'three';

export const CHARACTER_LIGHTING_PROFILE = Object.freeze({ roughness: .78, metalness: 0 });
export const LOCAL_LIGHTING_PROFILE = Object.freeze({
  exteriorRange: 15, exteriorIntensity: 25, exteriorColor: 0xffe6be,
  interiorRange: 14, interiorDayIntensity: 4, interiorNightIntensity: 12, interiorColor: 0xffedd5,
});

/** Own only the material: recolored atlas textures remain owned by each actor. */
export function cloneCharacterMaterial(source) {
  if (!source?.isMaterial) throw new TypeError('A character material is required.');
  let material;
  if (source.isMeshStandardMaterial) material = source.clone();
  else {
    // Keep imported unlit palettes usable without making the body self-lit.
    material = new THREE.MeshStandardMaterial();
    for (const key of ['name', 'map', 'alphaMap', 'aoMap', 'aoMapIntensity', 'opacity', 'transparent', 'alphaTest', 'side', 'depthTest', 'depthWrite', 'vertexColors', 'fog', 'visible']) {
      if (source[key] !== undefined) material[key] = source[key];
    }
    if (source.color) material.color.copy(source.color);
    material.userData = structuredClone(source.userData || {});
  }
  Object.assign(material, CHARACTER_LIGHTING_PROFILE);
  material.toneMapped = true;
  return material;
}

/** Targets for the two existing interior lights; creates no Three objects. */
export function getInteriorLightPlacements({ cameraPosition, nightFactor = 0, floorHeights = [0, 4, 8, 12] } = {}) {
  if (![cameraPosition?.x, cameraPosition?.y, cameraPosition?.z, nightFactor].every(Number.isFinite) || !Array.isArray(floorHeights) || floorHeights.length < 2 || !floorHeights.every(Number.isFinite)) throw new TypeError('Interior lighting requires a finite camera, night factor and at least two floor heights.');
  const night = THREE.MathUtils.clamp(nightFactor, 0, 1);
  const heights = [...new Set(floorHeights)].sort((a, b) => Math.abs(a + 1.55 - cameraPosition.y) - Math.abs(b + 1.55 - cameraPosition.y)).slice(0, 2).sort((a, b) => a - b);
  if (heights.length < 2) throw new RangeError('Interior lighting needs two distinct floors.');
  // Position over an existing ceiling fixture, close to the room being visited.
  const x = Math.abs(cameraPosition.x) < 2.2 ? 0 : Math.sign(cameraPosition.x) * 6.5;
  const z = x === 0 ? THREE.MathUtils.clamp(cameraPosition.z, -5, 5) : cameraPosition.z < 0 ? -4 : 4;
  return heights.map(height => ({
    position: { x, y: height + 3.05, z },
    intensity: LOCAL_LIGHTING_PROFILE.interiorDayIntensity + night * (LOCAL_LIGHTING_PROFILE.interiorNightIntensity - LOCAL_LIGHTING_PROFILE.interiorDayIntensity),
    distance: LOCAL_LIGHTING_PROFILE.interiorRange, decay: 2, color: LOCAL_LIGHTING_PROFILE.interiorColor,
  }));
}

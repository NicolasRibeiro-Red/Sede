// A seed can later be the agent ID: the same ID keeps the same visual identity.
// Colors are independent of function, temperament or any inferred personality.
// Keep palette order stable: each index is part of the seeded identity contract.
export const APPEARANCE_PALETTES = Object.freeze({
  shirt: Object.freeze(['#477c60','#ca7955','#445d7e','#977043','#817297','#387d83','#a85562','#d0ab55']),
  hair: Object.freeze(['#352c27','#664732','#a97847','#d2b482','#c6c8c0','#753b32']),
  skin: Object.freeze(['#f0c8a4','#deb38f','#c79672','#ac7c57','#87604a','#644638']),
  accessory: Object.freeze(['none','headset','glasses','cap']),
});

export function createAppearance(seed, modelIds) {
  if (!modelIds?.length) throw new Error('At least one model is required.');
  let state = 2166136261;
  for (const character of String(seed)) state = Math.imul(state ^ character.charCodeAt(0), 16777619) >>> 0;
  const random = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const pick = values => values[Math.floor(random() * values.length)];
  return {
    model: pick(modelIds),
    shirt: pick(APPEARANCE_PALETTES.shirt),
    hair: pick(APPEARANCE_PALETTES.hair),
    skin: pick(APPEARANCE_PALETTES.skin),
    size: pick([.9,.95,1,1.05,1.1]),
    accessory: pick(APPEARANCE_PALETTES.accessory),
    palette: 'custom',
  };
}

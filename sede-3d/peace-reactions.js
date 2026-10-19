import * as THREE from 'three';

const CAPACITY = 6, DURATION = 2.5;
const LINES = [
  'Calma, eu já ia entregar.',
  'Isso entra no retro?',
  'Conflito resolvido. Café?',
  'Paz aceita. Prazo mantido.',
  'Vou chamar isso de feedback.',
  'Uma reunião teria sido pior.',
];

// Cosmetic reactions never change the simulation, skeleton or shared materials.
// Construct once after campus people and office actors have been created.
export function createPeaceReactions({scene, camera, viewport, getAgents = () => [], getOccluders, onActorHit} = {}) {
  if (!scene?.isScene || !camera?.isCamera || !viewport?.ownerDocument) throw new TypeError('Peace reactions need a scene, camera and viewport.');
  const document = viewport.ownerDocument, records = new Map();
  for (const record of getAgents() || []) if (record?.root?.isObject3D && !record.person) records.set(record.root, record);
  scene.traverse(object => {
    if (object.userData?.ambientPerson && !records.has(object)) records.set(object, {root:object, name:object.name.split(' · ')[0]});
  });
  const actors = [...records.values()].map(record => ({...record, head:record.head || record.root.getObjectByName('Head'), hits:0}));
  const actorRoots = new Set(records.keys());
  const belongsToActor = object => { for (let node=object; node; node=node.parent) if (actorRoots.has(node)) return true; return false; };
  const isEffect = object => { for (let node=object; node; node=node.parent) if (node.userData?.peaceIgnore || node.userData?.peaceEffect) return true; return false; };
  const attachedAndVisible = object => {
    for (let node=object; node; node=node.parent) { if (!node.visible) return false; if (node===scene) return true; }
    return false;
  };
  const opaque = object => {
    if (!object.isMesh || !object.material) return false;
    return (Array.isArray(object.material) ? object.material : [object.material]).some(material => material.visible && (!material.transparent || material.opacity >= .8));
  };
  const cachedOccluders = [];
  if (typeof getOccluders !== 'function') scene.traverse(object => {
    if (opaque(object) && !belongsToActor(object) && !isEffect(object)) cachedOccluders.push(object);
  });
  const overlay = document.createElement('div'); overlay.className='peace-reactions'; overlay.setAttribute('aria-hidden','true');
  Object.assign(overlay.style, {position:'absolute', inset:'0', overflow:'hidden', pointerEvents:'none', zIndex:'5'}); viewport.appendChild(overlay);
  const group = new THREE.Group(); group.name='Reações · A paz é a única opção'; group.userData.peaceEffect=true; group.userData.peaceIgnore=true; scene.add(group);
  const ring = new THREE.RingGeometry(.16,.185,32), stem = new THREE.PlaneGeometry(.025,.34), branch = new THREE.PlaneGeometry(.025,.18);
  const geometries = [ring,stem,branch], materials = [];
  const slots = Array.from({length:CAPACITY}, () => {
    const material = new THREE.MeshBasicMaterial({color:'#ffd46a',side:THREE.DoubleSide,transparent:true,depthWrite:false,toneMapped:false}); materials.push(material);
    const icon = new THREE.Group(); icon.visible=false; icon.userData.peaceEffect=true;
    icon.add(new THREE.Mesh(ring,material),new THREE.Mesh(stem,material));
    for (const sign of [-1,1]) { const bar=new THREE.Mesh(branch,material); bar.rotation.z=sign*Math.PI/4; bar.position.set(sign*.063,-.063,0); icon.add(bar); }
    group.add(icon);
    const badge=document.createElement('div'); badge.className='peace-reaction'; badge.hidden=true;
    Object.assign(badge.style,{position:'absolute',pointerEvents:'none',transform:'translate(-50%, -100%)'});
    const symbol=document.createElement('span'); symbol.className='peace-reaction-icon'; symbol.textContent='☮';
    const copy=document.createElement('span'); copy.className='peace-reaction-copy'; badge.append(symbol,copy); overlay.appendChild(badge);
    return {actor:null,age:0,order:0,icon,material,badge,copy,hiddenByWall:false,occlusionElapsed:1,shown:false};
  });
  const cameraPosition=new THREE.Vector3(), anchor=new THREE.Vector3(), projected=new THREE.Vector3(), viewPoint=new THREE.Vector3(), direction=new THREE.Vector3(), cameraQuaternion=new THREE.Quaternion();
  const raycaster=new THREE.Raycaster();
  let disposed=false, sequence=0, simulationTime=0, running=true, visible=true;
  function release(slot) { slot.actor=null; slot.age=0; slot.icon.visible=false; slot.badge.hidden=true; slot.shown=false; }
  function hit(actor) {
    if (disposed || !running || !visible || !attachedAndVisible(actor.root)) return false;
    const slot=slots.find(slot=>slot.actor===actor) || slots.find(slot=>!slot.actor) || slots.reduce((oldest,slot)=>slot.order<oldest.order?slot:oldest);
    actor.hits++; slot.actor=actor; slot.age=0; slot.order=++sequence; slot.occlusionElapsed=1;
    slot.copy.textContent=LINES[(sequence-1)%LINES.length]; slot.badge.dataset.actorId=actor.root.uuid;
    slot.badge.setAttribute('aria-label',`${actor.name || 'Pessoa'}: ${slot.copy.textContent}`);
    return true;
  }
  const targets=actors.map(actor=>{
    const target={id:actor.root.uuid,kind:'actor',object:actor.root,label:actor.name || 'Pessoa',onHit:event=>{
      const accepted=hit(actor);if(accepted)onActorHit?.(event,target);return accepted;
    }};return target;
  });
  function getActorTargets() { return disposed ? [] : targets.filter(target=>attachedAndVisible(target.object)); }
  function update(dt, options={}) {
    if (disposed) return;
    running=options.running ?? true; visible=options.visible ?? true;
    const step=running && Number.isFinite(dt) && dt>0 ? Math.min(dt,.1) : 0;
    simulationTime+=step; overlay.hidden=!visible; group.visible=visible;
    camera.getWorldPosition(cameraPosition); camera.getWorldQuaternion(cameraQuaternion);
    // Projection needs fresh camera inverses even before the next render.
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    for (const slot of slots) {
      if (!slot.actor) continue;
      slot.age+=step;
      if (slot.age>=DURATION || !attachedAndVisible(slot.actor.root)) { release(slot); continue; }
      if (!visible) { slot.badge.hidden=true; slot.icon.visible=false; slot.shown=false; continue; }
      const actor=slot.actor;
      if (actor.head) { actor.head.getWorldPosition(anchor); anchor.y+=(actor.headTop ?? .65)+.18; }
      else { actor.root.getWorldPosition(anchor); anchor.y+=(actor.height || 1.72)+.18; }
      anchor.y+=Math.sin(slot.age*3.5)*.045;
      viewPoint.copy(anchor).applyMatrix4(camera.matrixWorldInverse); projected.copy(anchor).project(camera);
      const inView=viewPoint.z<0 && projected.z>=-1 && projected.z<=1 && Math.abs(projected.x)<1 && Math.abs(projected.y)<1;
      slot.occlusionElapsed+=step;
      if (inView && slot.occlusionElapsed>=.12) {
        slot.occlusionElapsed=0; direction.copy(anchor).sub(cameraPosition); const distance=direction.length(); direction.normalize();
        raycaster.set(cameraPosition,direction); raycaster.near=.04; raycaster.far=Math.max(.04,distance-.08);
        const occluders=(typeof getOccluders==='function' ? getOccluders() : cachedOccluders) || [];
        slot.hiddenByWall=raycaster.intersectObjects(occluders,true).some(intersection=>attachedAndVisible(intersection.object) && opaque(intersection.object) && !belongsToActor(intersection.object) && !isEffect(intersection.object));
      }
      slot.shown=inView && !slot.hiddenByWall; slot.badge.hidden=!slot.shown; slot.icon.visible=slot.shown;
      if (!slot.shown) continue;
      const fade=Math.min(1,slot.age/.09,(DURATION-slot.age)/.32);
      slot.material.opacity=.9*Math.max(.12,fade); slot.badge.style.opacity=String(Math.max(.12,fade));
      slot.icon.position.copy(anchor); slot.icon.quaternion.copy(cameraQuaternion); slot.icon.scale.setScalar(1+Math.sin(slot.age*4)*.07);
      slot.badge.style.left=`${((projected.x+1)*viewport.clientWidth/2).toFixed(1)}px`;
      slot.badge.style.top=`${((1-projected.y)*viewport.clientHeight/2-21).toFixed(1)}px`;
    }
  }
  function dispose() {
    if (disposed) return; disposed=true;
    slots.forEach(release); overlay.remove(); group.removeFromParent(); group.clear();
    geometries.forEach(geometry=>geometry.dispose()); materials.forEach(material=>material.dispose());
  }
  return {getActorTargets,update,dispose,getSnapshot:()=>({disposed,capacity:CAPACITY,totalHits:sequence,simulationTime,actors:actors.length,
    reactions:slots.filter(slot=>slot.actor).map(slot=>({id:slot.actor.root.uuid,label:slot.actor.name,age:slot.age,phrase:slot.copy.textContent,visible:slot.shown,occluded:slot.hiddenByWall,hits:slot.actor.hits}))})};
}

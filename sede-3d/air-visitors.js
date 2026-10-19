import * as THREE from 'three';
import {restorePeacePose,applyPeacePose,peaceCollisionRadius} from './peace-behavior.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {cloneCharacterMaterial} from './lighting.js';
import {createAppearance} from '../cube-world-lab/appearance.js';
import {findPath,isWalkable,segmentClear} from './navigation.js';

// Physical visits are ambient fiction, independent of the agent/task metrics.
export const VISIT_PLANS=Object.freeze([
 {id:'air-silver',name:'Rafa',model:'cube-guy',pad:{x:-32,z:25,side:1},destination:'office',delay:5,stay:17,
  route:[{x:-27,z:24.85},{x:-27,z:17},{x:-20,z:17},{x:-20,z:10.8},{x:0,z:10.8},{x:0,z:6.4},{x:-.6,z:5.5}]},
 {id:'air-blue',name:'Lina',model:'cube-woman',pad:{x:-42,z:23,side:-1},destination:'pub',delay:24,stay:22,
  route:[{x:-44,z:17},{x:-44,z:11},{x:-44,z:4.5}]},
 {id:'air-wine',name:'Otávio',model:'steve',pad:{x:19,z:32,side:-1},destination:'office',delay:43,stay:19,
  route:[{x:0,z:32},{x:0,z:10.8},{x:0,z:6.4},{x:.65,z:4.8}]},
]);
const circleBox=actor=>({minX:actor.x-actor.radius-.035,maxX:actor.x+actor.radius+.035,minZ:actor.z-actor.radius-.035,maxZ:actor.z+actor.radius+.035});
const ease=value=>value*value*(3-2*value);

/** Rendering-independent, fixed-step passenger lifecycle. */
export function createVisitMovement({plans=VISIT_PLANS,bounds,getObstacles=()=>[],getActors=()=>[],getVehicleObstacles=()=>[],onDoor=()=>{}}){
 const people=plans.map(plan=>({id:`${plan.id}-visitor`,carId:plan.id,name:plan.name,plan,x:plan.pad.x,y:0,z:plan.pad.z-.15,yaw:0,radius:.43,
  state:'aboard',visible:false,phase:0,waypoint:0,path:[],pathIndex:1,retry:0,wait:0,completed:0,distance:0}));
 let disposed=false;
 const solids=person=>[...getObstacles(),...getVehicleObstacles().filter(box=>box.id!==person.carId)];
 const collider=person=>({id:person.id,x:person.x,y:person.y,z:person.z,radius:peaceCollisionRadius(person.peaceRoot,person.radius)});
 const others=person=>[...(getActors()||[]),...people.filter(p=>p!==person&&p.visible).map(collider)].filter(p=>p.id!==person.id&&[p.x,p.z,p.radius].every(Number.isFinite)&&p.radius>0&&(!Number.isFinite(p.y)||p.y<2.2));
 const threshold=person=>({x:person.plan.pad.x+person.plan.pad.side*2.85,z:person.plan.pad.z-.15});
 const cabin=person=>({x:person.plan.pad.x+person.plan.pad.side*.35,z:person.plan.pad.z-.15});
 function requestDoor(person,target){if(person.plan.destination==='office'&&Math.hypot(person.x,person.z-8)<3.1)onDoor({id:'entrance',x:person.x,z:person.z,radius:person.radius,visitorId:person.id,target});}
 function begin(id){const person=people.find(p=>p.carId===id);if(!person||disposed||person.state!=='aboard')return false;
  const start=cabin(person);Object.assign(person,{...start,y:0,state:'exiting',visible:false,phase:0,waypoint:0,reverseRoute:[],path:[],pathIndex:1,retry:0,wait:0});return true;
 }
 function planPath(person,target,obstacles,actors){
  const corridor={minX:Math.max(bounds.minX,Math.min(person.x,target.x)-4.8),maxX:Math.min(bounds.maxX,Math.max(person.x,target.x)+4.8),minZ:Math.max(bounds.minZ,Math.min(person.z,target.z)-4.8),maxZ:Math.min(bounds.maxZ,Math.max(person.z,target.z)+4.8)};
  const boxes=actors.filter(actor=>Math.hypot(actor.x-person.x,actor.z-person.z)<5).map(circleBox).filter(box=>isWalkable(person.x,person.z,[box],person.radius+.025,bounds));
  person.path=findPath(person,target,[...obstacles,...boxes],person.radius+.025,corridor)||[];person.pathIndex=1;person.retry=1;
 }
 function sidestep(person,target,obstacles,actors){
  const padding=person.radius+.025,nearby=actors.filter(actor=>Math.hypot(actor.x-person.x,actor.z-person.z)<5),solid=[...obstacles,...nearby.map(circleBox)],candidates=[];
  // Two circles can be separate while the other's conservative planning box
  // contains our start. Move sideways along a circle-safe edge first instead
  // of repeatedly dropping that box and planning the same blocked straight line.
  for(const distance of [1.25,1.9])for(let i=0;i<12;i++){
   const angle=i*Math.PI/6,point={x:person.x+Math.cos(angle)*distance,z:person.z+Math.sin(angle)*distance};
   if(isWalkable(point.x,point.z,solid,padding,bounds)&&segmentClear(person,point,obstacles,padding,actors,bounds))candidates.push(point);
  }
  candidates.sort((a,b)=>Math.hypot(a.x-target.x,a.z-target.z)-Math.hypot(b.x-target.x,b.z-target.z));
  for(const point of candidates){
   const corridor={minX:Math.max(bounds.minX,Math.min(person.x,point.x,target.x)-4.8),maxX:Math.min(bounds.maxX,Math.max(person.x,point.x,target.x)+4.8),minZ:Math.max(bounds.minZ,Math.min(person.z,point.z,target.z)-4.8),maxZ:Math.min(bounds.maxZ,Math.max(person.z,point.z,target.z)+4.8)};
   const path=findPath(point,target,solid,padding,corridor);if(!path)continue;
   person.path=[{x:person.x,z:person.z},...path];person.pathIndex=1;person.retry=1;person.yielding=false;return true;
  }
  if(candidates.length&&nearby.some(actor=>Math.hypot(actor.x-person.x,actor.z-person.z)<person.radius+actor.radius+.2)){
   person.path=[{x:person.x,z:person.z},candidates[0]];person.pathIndex=1;person.retry=1.2;person.yielding=true;return true;
  }
  return false;
 }
 function walk(person,step){
  const route=person.state==='returning'?person.reverseRoute:person.plan.route;
  let target=route[person.waypoint];
  if(!target){person.state=person.state==='returning'?'boarding':'visiting';person.phase=0;person.path=[];return;}
  const obstacles=solids(person),actors=others(person);
  // Waypoints describe a corridor, not reserved standing spots. A person on
  // an intermediate point must not block an otherwise usable route beyond it.
  while(person.waypoint<route.length-1&&actors.some(actor=>Math.hypot(actor.x-target.x,actor.z-target.z)<person.radius+actor.radius+.08)){
   target=route[++person.waypoint];person.path=[];person.retry=0;person.yielding=false;
  }
  requestDoor(person,target);person.retry=Math.max(0,person.retry-step);
  if(Math.hypot(person.x-target.x,person.z-target.z)<.035){person.waypoint++;person.path=[];person.retry=0;return;}
  if(!person.path.length&&person.retry===0){if(person.wait<.7||!sidestep(person,target,obstacles,actors))planPath(person,target,obstacles,actors);}
  if(!person.path.length){person.wait+=step;return;}
  let next=person.path[person.pathIndex];
  if(person.yielding&&person.pathIndex===person.path.length-1&&Math.hypot(next.x-person.x,next.z-person.z)<.025){person.path=[];person.yielding=false;person.retry=.8;return;}
  if(Math.hypot(next.x-person.x,next.z-person.z)<.025&&person.pathIndex<person.path.length-1)next=person.path[++person.pathIndex];
  const distance=Math.hypot(next.x-person.x,next.z-person.z),travel=Math.min(distance,1.22*step);
  const candidate={x:person.x+(next.x-person.x)/(distance||1)*travel,z:person.z+(next.z-person.z)/(distance||1)*travel};
  if(!segmentClear(person,candidate,obstacles,person.radius+.025,actors,bounds)){
   person.wait+=step;if(person.retry===0){person.path=[];if(person.wait<.7||!sidestep(person,target,obstacles,actors))planPath(person,target,obstacles,actors);}return;
  }
  person.yaw=Math.atan2(candidate.x-person.x,candidate.z-person.z);person.x=candidate.x;person.z=candidate.z;person.distance+=travel;person.wait=0;
 }
 function doorway(person,step){
  const boarding=person.state==='boarding',old=person.phase;
  // A brief glance back before boarding makes the intention legible.
  if(boarding&&old<1){person.phase=Math.min(1,old+step);return;}
  const offset=boarding?1:0,t=Math.min(1,(old+step-offset)/2.4),a=boarding?threshold(person):cabin(person),b=boarding?cabin(person):threshold(person),u=ease(t);
  const candidate={x:a.x+(b.x-a.x)*u,z:a.z+(b.z-a.z)*u};
  if(!segmentClear(person,candidate,solids(person),person.radius+.025,others(person),bounds)){person.wait+=step;return;}
  person.phase=old+step;person.x=candidate.x;person.z=candidate.z;person.y=0;person.yaw=person.plan.pad.side*(boarding?-Math.PI/2:Math.PI/2);person.wait=0;
  // Visibility changes only while the passenger is inside the opaque cabin.
  person.visible=Math.abs(person.x-person.plan.pad.x)>.68;
  if(t===1){person.phase=0;person.path=[];person.retry=0;person.waypoint=0;
   if(boarding){person.state='aboard';person.visible=false;person.completed++;}else{person.state='outbound';person.y=0;person.visible=true;}
  }
 }
 function update(step){if(disposed||!Number.isFinite(step)||step<=0)return;
  for(const person of people){
   if(person.peaceRoot?.userData.peaceBehavior)continue;
   if(person.state==='aboard')continue;
   if(person.state==='exiting'||person.state==='boarding')doorway(person,step);
   else if(person.state==='outbound'||person.state==='returning')walk(person,step);
   else if(person.state==='visiting'){person.phase+=step;person.yaw=person.plan.destination==='pub'?Math.PI:0;if(person.phase>=person.plan.stay){person.state='returning';person.reverseRoute=[...person.plan.route].reverse().slice(1).concat(threshold(person));person.waypoint=0;person.path=[];person.retry=0;person.phase=0;}}
  }
 }
 const getColliders=()=>disposed?[]:people.filter(person=>person.visible).map(collider);
 return {people,begin,update,getColliders,getPeaceNavigation:person=>({bounds,getObstacles:()=>solids(person),getActors:()=>others(person)}),getState:id=>people.find(person=>person.carId===id),dispose(){disposed=true;people.forEach(p=>p.visible=false);}};
}

function recolor(source,entry,appearance,textures){
 if(!source?.image)return source;
 const canvas=document.createElement('canvas');canvas.width=source.image.width;canvas.height=source.image.height;
 const context=canvas.getContext('2d');if(!context)throw new Error('Visitor palette needs a canvas.');context.drawImage(source.image,0,0);
 const pixels=context.getImageData(0,0,canvas.width,canvas.height),original=new Uint8ClampedArray(pixels.data);
 for(const channel of ['skin','hair','shirt']){const colors=entry.colorRegions?.[channel];if(!colors?.length)continue;const rgb=[1,3,5].map(start=>parseInt(appearance[channel].slice(start,start+2),16));
  for(let i=0;i<pixels.data.length;i+=4)if(colors.some(c=>Math.hypot(original[i]-c[0],original[i+1]-c[1],original[i+2]-c[2])<10))for(let j=0;j<3;j++)pixels.data[i+j]=rgb[j];
 }
 context.putImageData(pixels,0,0);const texture=source.clone();texture.source=new THREE.Source(canvas);texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;textures.add(texture);return texture;
}

export async function createAirVisitors({scene,manifest,loadModel,...options}){
 if(!Array.isArray(manifest?.models)||typeof loadModel!=='function')throw new TypeError('Campus visitors require the local character manifest and model loader.');
 const movement=createVisitMovement(options),group=new THREE.Group();group.name='Visitas ao campus · passageiros';
 const records=[],materials=new Set(),textures=new Set(),skeletons=new Set(),geometries=new Set();let disposed=false;
 const cupGeometry=new THREE.CylinderGeometry(.07,.06,.14,10),cupMaterial=new THREE.MeshStandardMaterial({color:'#eee4cb',roughness:.56});geometries.add(cupGeometry);materials.add(cupMaterial);
 function dispose(){if(disposed)return;disposed=true;movement.dispose();records.forEach(r=>{r.mixer.stopAllAction();r.mixer.uncacheRoot(r.model);});materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());skeletons.forEach(s=>s.dispose());geometries.forEach(g=>g.dispose());group.removeFromParent();group.clear();}
 try{
  const assets=await Promise.all(movement.people.map(person=>loadModel(person.plan.model)));
  for(const [index,person]of movement.people.entries()){
   const gltf=assets[index],entry=manifest.models.find(model=>model.id===person.plan.model);if(!entry||!gltf?.scene)throw new Error(`Missing campus visitor model: ${person.plan.model}`);
   const head=entry.accessoryFit?.geometry?.headBounds?.size,heightRatio=(1.64+index*.04)/1.72;
   person.radius=Math.max(.43,Math.max(head?.[0]||.8,head?.[2]||.7)*heightRatio*.5+.04);
   const appearance=createAppearance(`campus-visit-${index}`,[entry.id]),root=new THREE.Group(),model=cloneSkeleton(gltf.scene),cache=new Map(),mapCache=new Map();root.name=`${person.name} · visita local`;root.userData.ambientPerson=true;root.visible=false;
   model.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(model),height=box.max.y-box.min.y;if(!Number.isFinite(height)||height<=0)throw new Error('Invalid visitor model bounds.');const scale=(1.64+index*.04)/height;model.scale.setScalar(scale);model.position.y=-box.min.y*scale;
   const cloneMaterial=source=>{if(cache.has(source))return cache.get(source);const material=cloneCharacterMaterial(source);materials.add(material);if(source.map){if(!mapCache.has(source.map))mapCache.set(source.map,recolor(source.map,entry,appearance,textures));material.map=mapCache.get(source.map);}cache.set(source,material);return material;};
   model.traverse(mesh=>{if(!mesh.isMesh)return;mesh.material=Array.isArray(mesh.material)?mesh.material.map(cloneMaterial):cloneMaterial(mesh.material);mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;if(mesh.skeleton)skeletons.add(mesh.skeleton);});root.add(model);group.add(root);
   const mixer=new THREE.AnimationMixer(model),actions={};
   for(const source of gltf.animations||[]){const name=source.name.split('|').pop().replace(/\.\d+$/,'');if(!['Walk','Idle','Idle_Hold','Wave'].includes(name)||actions[name])continue;const clip=source.clone();clip.tracks=clip.tracks.filter(track=>!/^(CharacterArmature|Armature|Root)\.(position|quaternion)$/.test(track.name));actions[name]=mixer.clipAction(clip);if(name==='Wave'){actions[name].setLoop(THREE.LoopOnce,1);actions[name].clampWhenFinished=true;}}
   const cup=new THREE.Mesh(cupGeometry,cupMaterial);cup.name=`Café de ${person.name}`;cup.visible=false;cup.castShadow=true;group.add(cup);
   person.peaceRoot=root;records.push({root,model,mixer,actions,cup,active:null,fist:model.getObjectByName('Fist.R')||model.getObjectByName('FistR'),appearance});
  }
  scene.add(group);
 }catch(error){dispose();throw error;}
 const point=new THREE.Vector3(),rotation=new THREE.Quaternion();
 function render(step){records.forEach((record,index)=>{const person=movement.people[index];record.root.visible=person.visible;record.root.position.set(person.x,person.y,person.z);record.root.rotation.y=person.yaw;
  const waving=person.state==='visiting'&&person.phase<2||person.state==='boarding'&&person.phase<1;
  const walking=['outbound','returning','exiting','boarding'].includes(person.state)&&person.wait<.02&&!waving;
  const reaction=record.root.userData.peaceBehavior;restorePeacePose(record);
  const wanted=reaction?(reaction.moving?'Walk':'Idle'):waving?'Wave':walking?'Walk':person.state==='visiting'?'Idle_Hold':'Idle',action=record.actions[wanted]||record.actions.Idle;
  if(action&&record.active!==action){record.active?.fadeOut(.18);action.reset().fadeIn(.18).play();record.active=action;}
  action?.setEffectiveTimeScale(reaction?.moving?2.5:1);if(person.visible)record.mixer.update(step);applyPeacePose(record);record.root.updateMatrixWorld(true);
  record.cup.visible=!reaction&&person.visible&&person.state==='visiting'&&person.phase>=2&&person.phase<person.plan.stay-3&&!!record.fist;
  if(record.cup.visible){record.fist.getWorldPosition(point);record.cup.position.copy(point);record.cup.position.y+=.065;record.cup.quaternion.copy(record.root.getWorldQuaternion(rotation));}
 });}
 const getPeaceBindings=()=>records.map((record,index)=>{const person=movement.people[index];return {
  id:record.root.uuid,root:record.root,model:record.model,radius:person.radius+.025,launchHeight:.62,...movement.getPeaceNavigation(person),
  getPosition:()=>({x:person.x,y:person.y,z:person.z}),setPosition:p=>{person.x=p.x;person.z=p.z;record.root.position.set(person.x,person.y,person.z);},setYaw:y=>{person.yaw=y;record.root.rotation.y=y;},
  canMove:()=>['outbound','returning','visiting'].includes(person.state),begin:()=>!disposed&&person.visible&&person.state!=='aboard',end:()=>{person.path=[];person.retry=0;person.wait=0;}
 };});
 return {...movement,group,render,getPeaceBindings,update(step){movement.update(step);render(step);},dispose};
}

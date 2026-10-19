import * as THREE from 'three';
import {restorePeacePose,applyPeacePose,peaceCollisionRadius} from './peace-behavior.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {createAppearance,APPEARANCE_PALETTES} from '../cube-world-lab/appearance.js?v=20261019-personalize';
import {createAccessory} from '../cube-world-lab/accessories.js';
import {AGENT_CONFIGS,ROOMS,SPAWN} from './layout.js';
import {cloneCharacterMaterial} from './lighting.js';

const HEIGHT=1.72;
const cleanName=name=>name.split('|').pop().replace(/\.\d+$/,'');
const safeName=(value,fallback)=>String(value??'').trim().slice(0,40)||fallback;
const rgb=hex=>[1,3,5].map(start=>parseInt(hex.slice(start,start+2),16));
const hex=channels=>'#'+channels.map(value=>value.toString(16).padStart(2,'0')).join('');
const APPEARANCE_CHANNELS=['skin','hair','shirt','accessory'];
const visitorOriginal={skin:'#cfa78b',hair:'#cf9f41',shirt:'#526a86'};
const appearanceLabels={skin:['Pêssego claro','Areia','Mel','Caramelo','Castanho','Cacau'],hair:['Castanho escuro','Castanho','Cobre','Loiro','Grisalho','Ruivo'],shirt:['Verde','Terracota','Azul','Ocre','Lavanda','Petróleo','Rosa','Mostarda'],accessory:['Sem acessório','Headset','Óculos','Boné']};
export const CUSTOMIZATION_OPTIONS=Object.freeze(Object.fromEntries(APPEARANCE_CHANNELS.map(channel=>[channel,Object.freeze([
 ...APPEARANCE_PALETTES[channel].map((value,index)=>Object.freeze({value,label:appearanceLabels[channel][index]})),
 ...(visitorOriginal[channel]&&!APPEARANCE_PALETTES[channel].includes(visitorOriginal[channel])?[Object.freeze({value:visitorOriginal[channel],label:'Original da pessoa'})]:[]),
])])));
const appearanceValues=Object.fromEntries(APPEARANCE_CHANNELS.map(channel=>[channel,new Set(CUSTOMIZATION_OPTIONS[channel].map(option=>option.value))]));

/** Local scene characters. Roles and activity are demonstration states, not connected agents. */
export async function createActors({scene,viewport,manifest,loadModel,configs=AGENT_CONFIGS,baseY=0}){
 if(!scene||!viewport||!Array.isArray(manifest?.models)||typeof loadModel!=='function')throw new TypeError('Actors require a scene, viewport, manifest and model loader.');
 if(!Array.isArray(configs)||!Number.isFinite(baseY))throw new TypeError('Actor configs and floor height are invalid.');
 const specs=[{id:'visitor',name:'Você',role:'Pessoa',model:'cube-guy',person:true},...configs];
 const models=await Promise.all(specs.map(async spec=>{
  const entry=manifest.models.find(model=>model.id===spec.model);
  if(!entry)throw new Error(`Missing character model: ${spec.model}`);
  const gltf=await loadModel(spec.model);if(!gltf?.scene)throw new Error(`Character did not load: ${spec.model}`);
  return {spec,entry,gltf};
 }));
 const document=viewport.ownerDocument;
 const overlay=document.createElement('div');overlay.className='actor-tags';overlay.setAttribute('aria-label','Pessoas e agentes da sede');
 Object.assign(overlay.style,{position:'absolute',inset:'0',pointerEvents:'none',overflow:'hidden',zIndex:'1'});viewport.appendChild(overlay);
 const records=[],agents=[];
 const point=new THREE.Vector3(),projected=new THREE.Vector3(),viewPoint=new THREE.Vector3(),forward=new THREE.Vector3(),cameraPosition=new THREE.Vector3(),rayDirection=new THREE.Vector3(),quaternion=new THREE.Quaternion();
 const raycaster=new THREE.Raycaster();
 let disposed=false,visible=true,occlusionElapsed=.15,lastFirstPerson=false,lastShowVisitor=true;

 function createTag(spec,color){
  const element=document.createElement(spec.person?'div':'button');element.className='actor-tag';element.dataset.actorId=spec.id;element.dataset.identity=spec.person?'person':'agent';element.style.display='none';
  if(!spec.person){element.type='button';element.setAttribute('aria-label',`Acompanhar ${spec.name}`);}
  const copy=document.createElement('div');copy.className='tag-copy';
  const kind=document.createElement('span');kind.className='tag-kind';kind.textContent=spec.person?'Pessoa':'Agente';
  const name=document.createElement('strong');name.className='tag-name';name.textContent=safeName(spec.name,spec.person?'Você':'Agente');
  copy.append(kind,name);
  if(!spec.person){const role=document.createElement('span');role.className='tag-role';role.textContent=spec.role;copy.appendChild(role);}
  element.appendChild(copy);
  const toolIcon=spec.person?null:document.createElement('span');
  if(toolIcon){toolIcon.className='tag-tool-icon';toolIcon.hidden=true;toolIcon.setAttribute('aria-hidden','true');element.appendChild(toolIcon);}
  const activity=document.createElement('span');activity.className='tag-activity';activity.style.display='none';element.appendChild(activity);
  overlay.appendChild(element);return {element,name,activity,toolIcon};
 }
 function recolor(source,entry,appearance,owned){
  if(!source?.image)return source;
  const canvas=document.createElement('canvas');canvas.width=source.image.width;canvas.height=source.image.height;
  const context=canvas.getContext('2d');if(!context)throw new Error('A 2D canvas is required to color the characters.');
  context.drawImage(source.image,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height),original=new Uint8ClampedArray(pixels.data);
  for(const channel of ['shirt','hair','skin']){
   const sources=entry.colorRegions?.[channel],target=appearance[channel];if(!sources?.length||!target)continue;
   const color=rgb(target);
   for(let i=0;i<pixels.data.length;i+=4){if(!sources.some(sourceRgb=>Math.hypot(original[i]-sourceRgb[0],original[i+1]-sourceRgb[1],original[i+2]-sourceRgb[2])<10))continue;for(let c=0;c<3;c++)pixels.data[i+c]=color[c];}
  }
  context.putImageData(pixels,0,0);
  // Texture.clone shares Source. A new Source keeps every avatar's palette independent.
  const texture=source.clone();texture.source=new THREE.Source(canvas);texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;owned.add(texture);return texture;
 }
 function createCharacter({spec,entry,gltf}){
  const room=spec.person?null:ROOMS.find(room=>room.id===spec.room);
  if(!spec.person&&!room)throw new Error(`Missing room for agent: ${spec.id}`);
  const appearance=spec.person?{model:spec.model,shirt:visitorOriginal.shirt,hair:hex(entry.colorRegions?.hair?.[0]||rgb(visitorOriginal.hair)),skin:hex(entry.colorRegions?.skin?.[0]||rgb(visitorOriginal.skin)),size:1,accessory:'none'}:createAppearance(spec.seed,[spec.model]);
  const root=new THREE.Group();root.name=`${spec.name} · ${spec.person?'Pessoa':'Agente'}`;
  root.position.set(spec.person?SPAWN.x:room.agent.x,baseY,spec.person?SPAWN.z:room.agent.z);root.rotation.y=spec.person?Math.PI:room.agent.yaw;
  const model=cloneSkeleton(gltf.scene);model.name=`Avatar · ${spec.id}`;model.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(model),height=bounds.max.y-bounds.min.y;
  if(!Number.isFinite(height)||height<=0)throw new Error(`Character has invalid bounds: ${spec.model}`);
  const scale=HEIGHT/height*appearance.size;model.scale.setScalar(scale);model.position.y=-bounds.min.y*scale;
  const materials=new Set(),textures=new Set(),skeletons=new Set(),ownedGeometry=new Set(),materialClones=new Map(),textureClones=new Map();
  const record={id:spec.id,name:spec.name,role:spec.role,roomId:spec.room??null,root,position:root.position,state:spec.person?'idle':'working',appearance,model,materials,textures,skeletons,ownedGeometry,actions:{},currentAction:null,mixer:null,head:null,headRestInverse:null,accessory:null,tag:null,hiddenByWall:false,waveRemaining:0,returnState:'working',person:!!spec.person,headTop:(entry.accessoryFit?.headTopOffset??.73)*appearance.size,height:HEIGHT*appearance.size};
  record.appearanceEntry=entry;record.appearanceSources=new Map();record.initialAppearance=Object.freeze(Object.fromEntries(APPEARANCE_CHANNELS.map(channel=>[channel,appearance[channel]])));
  // Register ownership before allocation so partial construction can be cleaned up safely.
  records.push(record);root.add(model);scene.add(root);
  const cloneMaterial=source=>{
   if(materialClones.has(source))return materialClones.get(source);
   const material=cloneCharacterMaterial(source);materials.add(material);
   if(source.map){record.appearanceSources.set(material,source.map);if(!textureClones.has(source.map))textureClones.set(source.map,recolor(source.map,entry,appearance,textures));material.map=textureClones.get(source.map);}
   materialClones.set(source,material);return material;
  };
  model.traverse(object=>{if(!object.isMesh)return;object.castShadow=true;object.receiveShadow=true;object.frustumCulled=false;object.material=Array.isArray(object.material)?object.material.map(cloneMaterial):cloneMaterial(object.material);if(object.skeleton)skeletons.add(object.skeleton);});
  // Measure Head with actor yaw removed. Accessories are authored in initial world axes.
  const yaw=root.rotation.y;root.rotation.y=0;root.updateMatrixWorld(true);record.head=model.getObjectByName('Head');
  if(record.head)record.headRestInverse=record.head.getWorldQuaternion(new THREE.Quaternion()).invert();
  root.rotation.y=yaw;root.updateMatrixWorld(true);
  if(appearance.accessory!=='none'&&record.head)installAccessory(record,createAccessory(appearance.accessory,entry.accessoryFit));
  updateAccessory(record);
  const headBounds=entry.accessoryFit?.geometry?.headBounds?.size;
  // A horizontal capsule follows the head's widest axis. Using the bounding
  // box diagonal over-counts empty hair corners and blocks ordinary doorways.
  record.radius=Math.max(.4,Math.max(headBounds?.[0]??.85,headBounds?.[2]??.7)*.5*appearance.size+.06);
  root.userData.actorId=spec.id;root.userData.radius=record.radius;root.userData.state=record.state;
  record.mixer=new THREE.AnimationMixer(model);
  for(const sourceClip of gltf.animations||[]){const name=cleanName(sourceClip.name);if(record.actions[name])continue;const clip=sourceClip.clone();clip.tracks=clip.tracks.filter(track=>!(/^(CharacterArmature|Armature|Root)\.(position|quaternion)$/.test(track.name)));const action=record.mixer.clipAction(clip);if(name==='Wave'){action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;}record.actions[name]=action;}
  record.modelRestPosition=model.position.clone();record.poseRestore=[];record.holdingCup=false;record.seatHeight=.48;
  // Idle clips do not key every bone. Portraits need an untouched rest pose,
  // independent of seated foot offsets, cup IK or the current wave animation.
  record.boneRestPose=[];model.traverse(bone=>{if(bone.isBone)record.boneRestPose.push({name:bone.name,position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone()});});
  const bone=name=>model.getObjectByName(name)||model.getObjectByName(name.replaceAll('.',''));
  record.poseBones={hips:bone('Hips'),upperArm:bone('UpperArm.R'),lowerArm:bone('LowerArm.R'),fist:bone('Fist.R'),fistEnd:bone('Fist.R_end'),legs:['L','R'].map(side=>({upper:bone(`UpperLeg.${side}`),lower:bone(`LowerLeg.${side}`),end:bone(`LowerLeg.${side}_end`),foot:bone(`Foot.${side}`)}))};
  const seatedBones=[bone('Body'),record.poseBones.hips,...record.poseBones.legs.flatMap(leg=>[leg.upper,leg.lower,leg.end,leg.foot])].filter(Boolean);
  record.seatedBasePose=seatedBones.map(bone=>({bone,...record.boneRestPose.find(pose=>pose.name===bone.name)}));
  if(!spec.person)createCup(record);
  record.tag=createTag(spec,spec.person?'#526a86':'#376b54');playState(record,record.state,0);
  if(!spec.person)agents.push(record);return record;
 }
 function playState(record,state,fade=.18){
  if(state==='paused')return;
  const name=state==='waving'?'Wave':state==='walking'?'Walk':state==='resting'&&record.actions.Sit?'Sit':['working','coffee','resting'].includes(state)?'Idle_Hold':'Idle';
  const next=record.actions[name]||record.actions.Idle||Object.values(record.actions)[0];
  if(!next)return;
  if(record.currentAction&&record.currentAction!==next)record.currentAction.fadeOut(fade);
  if(record.currentAction!==next||state==='waving')next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).fadeIn(fade).play();record.currentAction=next;
 }
 function setAgentState(id,state){
  if(!['working','walking','coffee','resting','idle','waving','paused'].includes(state))throw new RangeError(`Unknown agent state: ${state}`);
  const agent=agents.find(agent=>agent.id===id);if(!agent||disposed)return false;
  if(state==='waving'){if(agent.state!=='waving')agent.returnState=agent.state;agent.waveRemaining=2;}else agent.waveRemaining=0;
  if(state==='paused'&&agent.state!=='paused')agent.pausedPose=agent.state;
  agent.state=state;agent.root.userData.state=state;playState(agent,state);updateToolBadge(agent);return true;
 }
 function createCup(record){
  const cup=new THREE.Group();cup.name=`Xícara · ${record.id}`;cup.visible=false;record.cup=cup;scene.add(cup);
  const ceramic=new THREE.MeshStandardMaterial({color:'#f5efe3',roughness:.42}),coffee=new THREE.MeshStandardMaterial({color:'#382318',roughness:.65});record.materials.add(ceramic);record.materials.add(coffee);
  const add=(geometry,material,y=0)=>{record.ownedGeometry.add(geometry);const mesh=new THREE.Mesh(geometry,material);mesh.position.y=y;mesh.castShadow=true;mesh.receiveShadow=true;cup.add(mesh);return mesh;};
  add(new THREE.CylinderGeometry(.072,.061,.14,12),ceramic);
  add(new THREE.CylinderGeometry(.062,.062,.006,12),coffee,.071);
  const rim=add(new THREE.TorusGeometry(.068,.008,5,12),ceramic,.074);rim.rotation.x=Math.PI/2;
  const handle=add(new THREE.TorusGeometry(.045,.011,5,12),ceramic);handle.position.x=.082;
  cup.scale.setScalar(record.appearance.size||1);
 }
 function setRestState(id,{holdingCup,seatHeight}={}){
  const record=agents.find(record=>record.id===id);if(!record||disposed)return false;
  if(holdingCup!==undefined)record.holdingCup=Boolean(holdingCup);
  if(Number.isFinite(seatHeight))record.seatHeight=Math.max(.2,Math.min(.9,seatHeight));
  return true;
 }
 function restorePose(record){
  for(const saved of record.poseRestore){saved.bone.position.copy(saved.position);saved.bone.quaternion.copy(saved.quaternion);}
  record.poseRestore=[];record.model.position.copy(record.modelRestPosition);
 }
 function saveBone(record,bone){if(bone&&!record.poseRestore.some(saved=>saved.bone===bone))record.poseRestore.push({bone,position:bone.position.clone(),quaternion:bone.quaternion.clone()});}
 function aimBone(record,bone,child,localTarget){
  if(!bone||!child)return;saveBone(record,bone);record.root.updateMatrixWorld(true);
  const origin=bone.getWorldPosition(new THREE.Vector3()),from=child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize(),target=record.root.localToWorld(localTarget.clone()).sub(origin).normalize();
  const rotation=new THREE.Quaternion().setFromUnitVectors(from,target).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));record.root.updateMatrixWorld(true);
 }
 function applyRestPose(record){
  if(record.person)return;
  const seated=record.state==='resting'||record.state==='waving'&&record.returnState==='resting',bones=record.poseBones,size=record.appearance.size||1;
  if(seated&&bones.hips&&!record.actions.Sit){
   // Standing clips sway/twist the pelvis and legs. Keep seated support fixed
   // while the upper-body bones continue to animate normally.
   for(const pose of record.seatedBasePose){saveBone(record,pose.bone);pose.bone.position.copy(pose.position);pose.bone.quaternion.copy(pose.quaternion);}
   record.root.updateMatrixWorld(true);const hip=record.root.worldToLocal(bones.hips.getWorldPosition(new THREE.Vector3()));
   // These chibi thighs cannot reach a deep bench's edge from its centre.
   // Sit on the front slat, with horizontal thighs and the shins in front.
   record.model.position.y+=record.seatHeight+.06+.2*size-hip.y;record.model.position.z+=.2;record.root.updateMatrixWorld(true);
   for(const leg of bones.legs){
    if(!leg.upper||!leg.lower)continue;
    const origin=record.root.worldToLocal(leg.upper.getWorldPosition(new THREE.Vector3()));
    aimBone(record,leg.upper,leg.lower,new THREE.Vector3(origin.x,origin.y,1));
    const knee=record.root.worldToLocal(leg.lower.getWorldPosition(new THREE.Vector3()));
    if(leg.end)aimBone(record,leg.lower,leg.end,new THREE.Vector3(knee.x,knee.y-1,knee.z));
    if(leg.foot&&leg.end){saveBone(record,leg.foot);leg.foot.position.copy(leg.foot.parent.worldToLocal(leg.end.getWorldPosition(new THREE.Vector3())));}
   }
   if(record.seatSupportOffset===undefined){
    // Measure the actual skinned thigh once; model variants have different
    // thicknesses. A 2 mm clearance avoids both sinking and a visible air gap.
    let supportY=Infinity;const vertex=new THREE.Vector3(),upperLegs=new Set(bones.legs.map(leg=>leg.upper));
    record.root.updateMatrixWorld(true);
    record.model.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;
     const indices=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight');
     for(let i=0;i<indices.count;i++){
      let thigh=false;for(let j=0;j<4;j++)if(weights.getComponent(i,j)>.3&&upperLegs.has(mesh.skeleton.bones[indices.getComponent(i,j)]))thigh=true;
      if(!thigh)continue;mesh.getVertexPosition(i,vertex);vertex.applyMatrix4(mesh.matrixWorld);record.root.worldToLocal(vertex);
      if(vertex.z<.165&&vertex.z>-.765)supportY=Math.min(supportY,vertex.y);
     }
    });
    record.seatSupportOffset=Number.isFinite(supportY)?record.seatHeight+.062-supportY:0;
   }
   record.model.position.y+=record.seatSupportOffset;record.root.updateMatrixWorld(true);
  }
  const carrying=record.holdingCup||record.state==='coffee'||seated;
  if(carrying&&bones.upperArm&&bones.lowerArm&&bones.fist){
   const handY=seated?record.seatHeight+.35:1.03*size;
   aimBone(record,bones.upperArm,bones.lowerArm,new THREE.Vector3(-.4*size,handY-.14,.14));
   aimBone(record,bones.lowerArm,bones.fist,new THREE.Vector3(-.35*size,handY,.42));
  }
 }
 function updateCup(record){
  if(!record.cup)return;
  const pose=record.state==='paused'?record.pausedPose:record.state,seated=pose==='resting'||pose==='waving'&&record.returnState==='resting';
  record.cup.visible=record.root.visible&&!record.root.userData.peaceBehavior&&(record.holdingCup||pose==='coffee'||seated)&&!!record.poseBones.fist;
  if(!record.cup.visible)return;
  record.root.updateMatrixWorld(true);const {fist,fistEnd}=record.poseBones;fist.getWorldPosition(record.cup.position);if(fistEnd)record.cup.position.lerp(fistEnd.getWorldPosition(point),.45);
  record.cup.quaternion.copy(record.root.getWorldQuaternion(quaternion));record.cup.position.y+=.065*(record.appearance.size||1);
 }
 function updateToolBadge(record){
  if(!record.tag?.toolIcon)return;
  const tool=record.state==='working'?record.tag.activity.textContent.match(/^([⌕▱◇▦✧])\s+(.+)$/u):null;
  record.tag.toolIcon.hidden=!tool;record.tag.toolIcon.textContent=tool?.[1]||'';
  record.tag.toolIcon.title=tool?`Ferramenta em uso: ${tool[2]}`:'';
  record.tag.element.setAttribute('aria-label',`Acompanhar ${record.name}${tool?` · ${tool[2]} em uso`:''}`);
 }
 function setName(id,value){
  const record=records.find(record=>record.id===id);if(!record||disposed)return false;
  record.name=safeName(value,record.person?'Você':'Agente');record.tag.name.textContent=record.name;updateToolBadge(record);record.root.name=`${record.name} · ${record.person?'Pessoa':'Agente'}`;return true;
 }
 function accessoryResources(accessory){
  const geometries=new Set(),materials=new Set();
  accessory?.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.material)for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);});
  return {geometries,materials};
 }
 function installAccessory(record,accessory){
  record.accessory=accessory;if(!accessory)return;
  accessory.scale.setScalar(record.appearance.size);scene.add(accessory);
  const resources=accessoryResources(accessory);resources.geometries.forEach(value=>record.ownedGeometry.add(value));resources.materials.forEach(value=>record.materials.add(value));
 }
 function releaseAccessory(record){
  if(!record.accessory)return;const resources=accessoryResources(record.accessory);record.accessory.removeFromParent();record.accessory=null;
  resources.geometries.forEach(value=>{record.ownedGeometry.delete(value);value.dispose();});resources.materials.forEach(value=>{record.materials.delete(value);value.dispose();});
 }
 function updateAccessory(record){
  record.headTop=((record.appearanceEntry.accessoryFit?.headTopOffset??.73)+(['cap','headset'].includes(record.appearance.accessory)?.12:0))*record.appearance.size;
  if(!record.accessory||!record.head)return;
  record.root.updateMatrixWorld(true);record.head.getWorldPosition(record.accessory.position);record.accessory.quaternion.copy(record.head.getWorldQuaternion(quaternion)).multiply(record.headRestInverse);record.accessory.visible=record.root.visible;
 }
 function getAppearance(id){
  const record=records.find(record=>record.id===id);return !record||disposed?null:Object.fromEntries(APPEARANCE_CHANNELS.map(channel=>[channel,record.appearance[channel]]));
 }
 /** Synchronous and atomic: original atlases are immutable; model, rig and collision size never change. */
 function setAppearance(id,patch){
  const record=records.find(record=>record.id===id);if(!record||disposed)return null;
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||![Object.prototype,null].includes(Object.getPrototypeOf(patch)))throw new TypeError('Appearance must be an object of editable channels.');
  const normalized={};
  for(const [channel,value]of Object.entries(patch)){
   if(!APPEARANCE_CHANNELS.includes(channel))throw new RangeError(`Appearance channel is not editable: ${channel}`);
   if(typeof value!=='string')throw new TypeError(`Appearance ${channel} must be a string.`);
   const option=channel==='accessory'?value:value.toLowerCase();
   if(!appearanceValues[channel].has(option))throw new RangeError(`Unknown ${channel} option: ${value}`);
   normalized[channel]=option;
  }
  const next={...record.appearance,...normalized};
  const colorsChanged=['skin','hair','shirt'].some(channel=>next[channel]!==record.appearance[channel]);
  const accessoryChanged=next.accessory!==record.appearance.accessory;
  if(!colorsChanged&&!accessoryChanged)return getAppearance(id);
  if(accessoryChanged&&next.accessory!=='none'&&!record.head)throw new Error('This character has no head anchor for an accessory.');
  const stagedTextures=new Set(),textureBySource=new Map(),replacements=new Map();let accessory=null;
  try{
   if(colorsChanged)for(const [material,source]of record.appearanceSources){
    if(!textureBySource.has(source))textureBySource.set(source,recolor(source,record.appearanceEntry,next,stagedTextures));
    replacements.set(material,textureBySource.get(source));
   }
   if(accessoryChanged&&next.accessory!=='none')accessory=createAccessory(next.accessory,record.appearanceEntry.accessoryFit);
  }catch(error){stagedTextures.forEach(value=>value.dispose());const resources=accessoryResources(accessory);resources.geometries.forEach(value=>value.dispose());resources.materials.forEach(value=>value.dispose());throw error;}
  const oldTextures=new Set();
  for(const [material,texture]of replacements){if(record.textures.has(material.map))oldTextures.add(material.map);material.map=texture;}
  stagedTextures.forEach(value=>record.textures.add(value));oldTextures.forEach(value=>{record.textures.delete(value);value.dispose();});
  if(accessoryChanged)releaseAccessory(record);
  Object.assign(record.appearance,next);
  if(accessoryChanged)installAccessory(record,accessory);
  updateAccessory(record);return getAppearance(id);
 }
 function resetAppearance(id){const record=records.find(record=>record.id===id);return !record||disposed?null:setAppearance(id,record.initialAppearance);}
 function setActivity(id,{label='',detail=''}={}){const record=records.find(record=>record.id===id);if(!record||disposed)return false;const text=String(label).slice(0,36);record.tag.activity.textContent=text;record.tag.activity.title=String(detail).slice(0,180);record.tag.activity.style.display=text?'':'none';updateToolBadge(record);return true;}
 function hideTag(record){if(!record.tag)return;record.tag.element.style.display='none';record.tag.element.hidden=true;}
 function objectVisible(object){for(let node=object;node;node=node.parent)if(!node.visible)return false;return true;}
 function updateTag(record,camera,firstPerson,occluders,checkOcclusion,focusedId){
  if(!record.root.visible){hideTag(record);return;}
  if(record.head){record.head.getWorldPosition(point);point.y+=record.headTop+.075;}else{record.root.getWorldPosition(point);point.y+=record.height+.075;}
  viewPoint.copy(point).applyMatrix4(camera.matrixWorldInverse);projected.copy(point).project(camera);
  if(viewPoint.z>=0||projected.z< -1||projected.z>1||Math.abs(projected.x)>1||Math.abs(projected.y)>1){hideTag(record);return;}
  if(!firstPerson||!occluders.length)record.hiddenByWall=false;
  else if(checkOcclusion){
   rayDirection.copy(point).sub(cameraPosition);const distance=rayDirection.length();rayDirection.normalize();raycaster.set(cameraPosition,rayDirection);raycaster.near=.03;raycaster.far=Math.max(.03,distance-.03);
   record.hiddenByWall=raycaster.intersectObjects(occluders,true).some(hit=>objectVisible(hit.object));
  }
  if(record.hiddenByWall){hideTag(record);return;}
  const element=record.tag.element;element.hidden=false;element.dataset.detail=String(!!record.root.userData.selected||record.id===focusedId);element.style.display='grid';element.style.left=`${((projected.x+1)*viewport.clientWidth/2).toFixed(1)}px`;element.style.top=`${((1-projected.y)*viewport.clientHeight/2).toFixed(1)}px`;
 }
 function update({camera,firstPerson=false,showVisitor=true,showTags=true,dt=0,occluders=[],focusedId=null}){
  if(disposed)return;
  const step=Number.isFinite(dt)&&dt>0?Math.min(dt,.1):0;
  // The walker owns the physical position. Camera bob/sway must never move
  // the saved body or its collision position when first person is exited.
  if(visible&&firstPerson){camera.getWorldDirection(forward);if(Math.hypot(forward.x,forward.z)>.001)visitor.rotation.y=Math.atan2(forward.x,forward.z);}
  lastShowVisitor=showVisitor;visitor.visible=visible&&showVisitor&&!firstPerson;
  occlusionElapsed+=step;const checkOcclusion=occlusionElapsed>=.15||lastFirstPerson!==firstPerson;if(checkOcclusion)occlusionElapsed=0;lastFirstPerson=firstPerson;
  for(const record of records){
   const reaction=record.root.userData.peaceBehavior;
   if(!reaction&&record.waveRemaining>0){record.waveRemaining-=step;if(record.waveRemaining<=0)setAgentState(record.id,record.returnState);}
   if(visible&&record.state!=='paused'){
    restorePeacePose(record);restorePose(record);
    if(reaction||record.peaceWasActive)playState(record,reaction?(reaction.moving?'walking':'idle'):record.state);record.peaceWasActive=!!reaction;
    record.currentAction?.setEffectiveTimeScale(reaction?.moving?2.2:1);record.mixer.update(step);
    if(reaction){if(record.state==='resting')applyRestPose(record);applyPeacePose(record);}else applyRestPose(record);
   }record.root.updateMatrixWorld(true);updateCup(record);
   updateAccessory(record);
  }
  if(!visible)return;
  if(!showTags){for(const record of records)hideTag(record);return;}
  camera.updateMatrixWorld(true);camera.getWorldPosition(cameraPosition);
  if(checkOcclusion)for(const object of occluders)object.updateWorldMatrix(true,true);
  for(const record of records)updateTag(record,camera,firstPerson,occluders,checkOcclusion,focusedId);
 }
 function setVisible(value){visible=Boolean(value);for(const record of records){record.root.visible=visible&&(!record.person||(lastShowVisitor&&!lastFirstPerson));if(record.accessory)record.accessory.visible=record.root.visible;updateCup(record);if(!visible)hideTag(record);}overlay.style.display=visible?'':'none';}
 function getColliders({includeVisitor=false}={}){return disposed||!visible?[]:records.filter(record=>includeVisitor||!record.person).map(record=>({id:record.id,x:record.root.position.x,z:record.root.position.z,radius:peaceCollisionRadius(record.root,record.radius)}));}
 function dispose(){
  if(disposed)return;disposed=true;
  for(const record of records){record.mixer?.stopAllAction();record.mixer?.uncacheRoot(record.model);scene.remove(record.root);if(record.accessory)scene.remove(record.accessory);if(record.cup)scene.remove(record.cup);record.materials.forEach(material=>material.dispose());record.textures.forEach(texture=>texture.dispose());record.skeletons.forEach(skeleton=>skeleton.dispose());record.ownedGeometry.forEach(geometry=>geometry.dispose());}
  overlay.remove();
 }
 let visitor;
 try{for(const model of models){const record=createCharacter(model);if(record.person)visitor=record.root;}}catch(error){dispose();throw error;}
 return {visitor,agents,records,getColliders,update,setAgentState,setRestState,setName,setActivity,getAppearance,setAppearance,resetAppearance,setVisible,dispose,get visible(){return visible;}};
}

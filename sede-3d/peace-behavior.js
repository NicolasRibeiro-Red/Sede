import * as THREE from 'three';
import {findPath,isWalkable,segmentClear} from './navigation.js';

const LIMIT=6, MAX_SECONDS=12, COOLDOWN=4;
export const PEACE_STUNT_RULES=Object.freeze({flightSeconds:1.5,verticalSeconds:.9,landingSeconds:.5,getupSeconds:.8,maxTravel:4,maxEpisodeSeconds:MAX_SECONDS,cooldownSeconds:COOLDOWN});
const LAUNCH_CLEARANCE=.12, TAU=Math.PI*2;
const smooth=value=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};
function flightAngles(t,vertical){return {pitch:vertical?0:-TAU*smooth((t-.08)/.82),roll:vertical?0:.14*Math.sin(Math.PI*t)*Math.sin(TAU*t),spin:0};}
function recoveryShape(t,vertical,gettingUp=false){
  if(gettingUp){const u=smooth(t),weight=1-u;return {pitch:vertical?0:.35*weight,roll:vertical?0:.8*weight+.055*Math.sin(t*TAU*2)*weight,scaleY:(vertical?.82:.66)+(vertical?.18:.34)*u};}
  return {pitch:vertical?0:.35*smooth(t/.65),roll:vertical?0:.8*smooth(t/.6)+.08*Math.sin(t*TAU*2)*(1-t),scaleY:1-(vertical?.26:.42)*smooth(t/.32)+.08*smooth((t-.45)/.55)};
}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const point=p=>p && Number.isFinite(p.x) && Number.isFinite(p.z) ? {x:p.x,y:Number.isFinite(p.y)?p.y:0,z:p.z} : null;
const visible=root=>{if(!root?.parent)return false;for(let node=root;node;node=node.parent)if(!node.visible)return false;return true;};
const peerBox=p=>({minX:p.x-p.radius-.015,maxX:p.x+p.radius+.015,minZ:p.z-p.radius-.015,maxZ:p.z+p.radius+.015});
const phase=(entry,value)=>{entry.state.phase=value;entry.state.phaseTime=0;entry.state.moving=false;entry.blocked=0;entry.replan=0;};
const poseCache=new WeakMap();
const launchPoseCache=new WeakMap();

/** Peers reserve the complete visible stunt volume, without changing their own radius. */
export function peaceCollisionRadius(root,base){
  const state=root?.userData?.peaceBehavior;
  return state?.somersault===true&&['flight','landing','getup'].includes(state.phase)&&Number.isFinite(state.launchRadius)?Math.max(base,state.launchRadius):base;
}

/** Restore exactly the local pose captured after the owner's previous mixer/IK. */
export function restorePeacePose(record){
  const key=record?.root || record?.model,saved=key && poseCache.get(key);if(!saved)return;
  if(saved.modelTransform){saved.model.position.copy(saved.position);saved.model.quaternion.copy(saved.quaternion);saved.model.scale.copy(saved.scale);}
  for(const item of saved.bones){item.bone.quaternion.copy(item.quaternion);if(item.position)item.bone.position.copy(item.position);if(item.scale)item.bone.scale.copy(item.scale);}
  poseCache.delete(key);
  record.root?.updateMatrixWorld(true);
}

/** Small comic startle/duck on owned bones; the owner's physical root stays fixed. */
export function applyPeacePose(record){
  const root=record?.root,model=record?.model,state=root?.userData?.peaceBehavior;if(!root || !model || !state)return;
  restorePeacePose(record);
  const saved={model,modelTransform:model!==root,position:model.position.clone(),quaternion:model.quaternion.clone(),scale:model.scale.clone(),bones:[]};poseCache.set(root,saved);
  const bone=name=>model.getObjectByName(name)||model.getObjectByName(name.replaceAll('.',''));
  const save=object=>{if(object&&!saved.bones.some(item=>item.bone===object))saved.bones.push({bone:object,quaternion:object.quaternion.clone()});};
  const head=record.head||bone('Head'),guard=['startled','hiding'].includes(state.phase);
  if(['flight','landing','getup'].includes(state.phase)&&saved.modelTransform){
    const frozen=launchPoseCache.get(root);
    if(frozen){
      // Hold the exact impact skeleton throughout the stunt. Its measured
      // envelope must not drift as the owner's animation mixer keeps ticking.
      for(const item of frozen){
        const object=item.object;
        if(object!==model)saved.bones.push({bone:object,position:object.position.clone(),quaternion:object.quaternion.clone(),scale:object.scale.clone()});
        object.position.copy(item.position);object.quaternion.copy(item.quaternion);object.scale.copy(item.scale);
      }
    }
    // Rotate around the torso, not the feet. Canonical Y and the collision
    // cylinder remain on the floor while only this rendered model arcs up.
    const height=Number.isFinite(record.height)?record.height:1.72*(record.appearance?.size||1);
    const pivot=new THREE.Vector3(0,state.launchPivot??height*.48,0),turn=new THREE.Quaternion().setFromEuler(new THREE.Euler(state.launchPitch||0,state.launchSpin||0,state.launchRoll||0,'YXZ'));
    const basePosition=model.position.clone(),baseRotation=model.quaternion.clone(),scaleY=state.launchScaleY??1;
    model.scale.y*=scaleY;model.quaternion.copy(baseRotation).premultiply(turn);
    model.position.copy(basePosition).sub(pivot);model.position.y*=scaleY;model.position.applyQuaternion(turn).add(pivot);model.position.y+=(state.launchLift||0)+(state.recoveryOffsetY||0);
    root.updateMatrixWorld(true);return;
  }
  const intensity=state.phase==='startled'?Math.min(1,.45+Math.sin(Math.min(1,state.phaseTime/.62)*Math.PI)*.55):state.phase==='hiding'?.78:.18;
  if(head){save(head);head.rotateZ(Math.sin(state.age*7)*.055*intensity);head.rotateX(.09*intensity);}
  if(guard){
    root.updateMatrixWorld(true);
    const headPoint=head?root.worldToLocal(head.getWorldPosition(new THREE.Vector3())):new THREE.Vector3(0,1.25,0);
    const aim=(joint,child,target)=>{
      if(!joint||!child)return;save(joint);root.updateMatrixWorld(true);
      const origin=joint.getWorldPosition(new THREE.Vector3()),from=child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
      const toward=root.localToWorld(target.clone()).sub(origin).normalize();
      const world=new THREE.Quaternion().setFromUnitVectors(from,toward).multiply(joint.getWorldQuaternion(new THREE.Quaternion()));
      joint.quaternion.copy(joint.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    };
    for(const [side,sign] of record.peaceKeepArms?[]:[['L',1],['R',-1]]){
      const upper=bone(`UpperArm.${side}`),lower=bone(`LowerArm.${side}`),fist=bone(`Fist.${side}`);
      aim(upper,lower,new THREE.Vector3(sign*.42,headPoint.y-.15,headPoint.z+.12));
      aim(lower,fist,new THREE.Vector3(sign*.23,headPoint.y+.15,headPoint.z+.25));
    }
    if(!state.stationary&&saved.modelTransform){
      const squash=1-.055*intensity;model.scale.y=saved.scale.y*squash;model.scale.x=saved.scale.x*(1+.014*intensity);model.scale.z=saved.scale.z*(1+.014*intensity);
      model.position.y=saved.position.y*squash;
    }
  }
  root.updateMatrixWorld(true);
}

/** Temporary physical ownership, exposed through adapters to each NPC controller. */
export function createPeaceBehavior({bindings=[],getOrigin=()=>null,reducedMotion=false}={}){
  const entries=new Map(),aliases=new Map(),active=new Map(),cooldowns=new Map(),history=[];
  let disposed=false,running=true,clock=0,serial=0;
  for(const binding of bindings){
    if(!binding?.root?.isObject3D || typeof binding.getPosition!=='function' || typeof binding.setPosition!=='function')continue;
    const id=binding.root.uuid;entries.set(id,binding);aliases.set(id,id);if(binding.id)aliases.set(binding.id,id);
  }
  function obstacles(binding,bounds){return (binding.getObstacles?.()||[]).filter(box=>[box.minX,box.maxX,box.minZ,box.maxZ].every(Number.isFinite)
    && (!bounds || box.maxX>=bounds.minX-1 && box.minX<=bounds.maxX+1 && box.maxZ>=bounds.minZ-1 && box.minZ<=bounds.maxZ+1));}
  function actors(binding){
    const self=point(binding.getPosition());return (binding.getActors?.()||[]).filter(actor=>actor && actor.id!==binding.id && actor.id!==binding.root.uuid && [actor.x,actor.z,actor.radius].every(Number.isFinite) && actor.radius>0 && (!Number.isFinite(actor.y)||Math.abs(actor.y-self.y)<2));
  }
  function boundsFor(binding,start){
    const bounds=binding.bounds || {minX:start.x-6,maxX:start.x+6,minZ:start.z-6,maxZ:start.z+6};
    return {minX:Math.max(bounds.minX,start.x-5.5),maxX:Math.min(bounds.maxX,start.x+5.5),minZ:Math.max(bounds.minZ,start.z-5.5),maxZ:Math.min(bounds.maxZ,start.z+5.5)};
  }
  function pathFor(entry,start,end){
    const solids=obstacles(entry.binding,entry.bounds),peers=actors(entry.binding),radius=entry.radius,bounds=entry.bounds;
    if(segmentClear(start,end,solids,radius,peers,bounds))return [{x:start.x,z:start.z},{x:end.x,z:end.z}];
    const boxes=peers.filter(peer=>distance(peer,start)<8).map(peerBox);
    const route=findPath(start,end,[...solids,...boxes],radius,bounds);
    return route && route.slice(1).every((next,index)=>segmentClear(route[index],next,solids,radius,peers,bounds))?route:null;
  }
  function planEscape(entry){
    const origin=point(entry.binding.getPosition()),source=entry.source,solids=obstacles(entry.binding,entry.bounds),peers=actors(entry.binding),radius=entry.radius,candidates=[];
    if(!isWalkable(origin.x,origin.z,solids,radius,entry.bounds))return null;
    // Candidate on the far side of a nearby furnishing, beyond its full support
    // extent. Large walls are not cover destinations outside the usable room.
    for(const box of solids){
      const width=box.maxX-box.minX,depth=box.maxZ-box.minZ,center={x:(box.minX+box.maxX)/2,z:(box.minZ+box.maxZ)/2};
      if(width<.2||depth<.2||width>4.5||depth>4.5||distance(center,origin)>4)continue;
      const dx=center.x-source.x,dz=center.z-source.z,length=Math.hypot(dx,dz)||1,ux=dx/length,uz=dz/length;
      const reach=Math.abs(ux)*width/2+Math.abs(uz)*depth/2+radius+.24;
      const target={x:center.x+ux*reach,z:center.z+uz*reach,cover:true};
      if(distance(target,origin)>.8&&distance(target,origin)<4.5)candidates.push(target);
    }
    const away=Math.atan2(origin.x-source.x,origin.z-source.z);
    for(const offset of [0,-.45,.45,-.9,.9,-1.4,1.4])for(const length of [2.2,1.4,3])candidates.push({x:origin.x+Math.sin(away+offset)*length,z:origin.z+Math.cos(away+offset)*length,cover:false});
    const choices=candidates.filter(candidate=>segmentClear(candidate,candidate,solids,radius,peers,entry.bounds));
    choices.sort((a,b)=>Number(b.cover)-Number(a.cover) || distance(a,origin)-distance(b,origin));
    for(const candidate of choices.slice(0,12)){
      const route=pathFor(entry,origin,candidate);if(!route)continue;
      const length=route.slice(1).reduce((total,next,index)=>total+distance(route[index],next),0);
      if(length>6.8)continue;
      return {path:route.slice(1),target:candidate,cover:candidate.cover};
    }
    return null;
  }
  function startLaunch(entry,shot){
    const binding=entry.binding,current=point(binding.getPosition());
    if(reducedMotion||!entry.movable||binding.canMove?.()===false||binding.canLaunch?.()===false||binding.peaceKeepArms||!binding.model||binding.model===binding.root||entry.state.launchedOnce||entry.state.age>MAX_SECONDS-6)return false;
    const raw=point(shot.direction),source=point(shot.origin||shot.source)||entry.source;
    let dx=raw?.x??current.x-source.x,dz=raw?.z??current.z-source.z,length=Math.hypot(dx,dz);
    if(length<.001){dx=current.x-source.x;dz=current.z-source.z;length=Math.hypot(dx,dz);}
    if(length<.001)return false;dx/=length;dz/=length;
    const rawHeight=binding.getLaunchHeight?.()??binding.launchHeight??.62;
    let height=Math.max(0,Math.min(1.65,Number.isFinite(rawHeight)?rawHeight:.62));
    restorePeacePose(binding);binding.root.updateMatrixWorld(true);
    // Freeze and measure the actual posed vertices. A complete sphere about the
    // torso contains every intermediate angle of a full somersault, not only
    // the sampled silhouettes used by the previous small twist.
    const inverse=binding.root.matrixWorld.clone().invert(),vertices=[],vertex=new THREE.Vector3();let minY=Infinity,maxY=-Infinity;
    binding.model.traverse(mesh=>{
      if(!mesh.isMesh||!mesh.visible||!mesh.geometry?.attributes?.position)return;
      if(mesh.isSkinnedMesh)mesh.skeleton.update();
      const positions=mesh.geometry.attributes.position;
      for(let i=0;i<positions.count;i++){
        mesh.getVertexPosition(i,vertex).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);vertices.push(vertex.x,vertex.y,vertex.z);minY=Math.min(minY,vertex.y);maxY=Math.max(maxY,vertex.y);
      }
    });
    if(!vertices.length)return false;
    const pivot=(minY+maxY)*.5,worldScale=binding.root.getWorldScale(new THREE.Vector3()),scaleMax=Math.max(worldScale.x,worldScale.y,worldScale.z),groundOffset=Math.max(0,.008-minY);
    const profile={vertices:new Float32Array(vertices),pivot,groundOffset,minY,maxY};
    let visualRadius=entry.radius;
    for(let i=0;i<vertices.length;i+=3)visualRadius=Math.max(visualRadius,Math.hypot(vertices[i],vertices[i+1]-pivot,vertices[i+2])*scaleMax+.06);
    const ceiling=Number.isFinite(binding.ceilingY)?(binding.ceilingY-current.y)/worldScale.y-.12:Infinity;
    const verticalHeight=Math.min(.62,height,ceiling-maxY-groundOffset);
    let requiredHeight=0,allowedHeight=height,fullAllowed=true;
    for(let i=1;i<80;i++){
      const t=i/80,angles=flightAngles(t,false),range=visualY(profile,angles.pitch,angles.roll,1),arc=4*t*(1-t);
      requiredHeight=Math.max(requiredHeight,(.012-range.min-groundOffset)/arc);
      allowedHeight=Math.min(allowedHeight,(ceiling-range.max-groundOffset)/arc);
    }
    for(let i=0;i<=40;i++)for(const gettingUp of [false,true]){
      const shape=recoveryShape(i/40,false,gettingUp),range=visualY(profile,shape.pitch,shape.roll,shape.scaleY);
      if(range.max-range.min+.012>ceiling)fullAllowed=false;
    }
    if(allowedHeight<Math.max(.24,requiredHeight+.025))fullAllowed=false;
    const solids=obstacles(binding,entry.bounds),peers=actors(binding),radius=Math.max(entry.radius+LAUNCH_CLEARANCE,visualRadius);
    let end=null;
    for(const travel of fullAllowed?[4,3.2,2.4,1.8]:[]){
      const candidate={x:current.x+dx*travel,z:current.z+dz*travel};
      if(segmentClear(current,candidate,solids,radius,peers,entry.bounds)){end=candidate;break;}
    }
    const vertical=!end;
    if(vertical){
      // A stationary hop retains the already occupied silhouette. It is only
      // available from a valid standing position and with enough headroom.
      if(verticalHeight<.18||!segmentClear(current,current,solids,entry.radius,peers,entry.bounds)){entry.state.launchBlocked=true;entry.state.launchRadius=radius;return false;}
      end={x:current.x,z:current.z};height=verticalHeight;
    }else height=allowedHeight;
    const frozen=[];binding.model.traverse(object=>frozen.push({object,position:object.position.clone(),quaternion:object.quaternion.clone(),scale:object.scale.clone()}));launchPoseCache.set(binding.root,frozen);
    entry.source=source;entry.launch={start:{...current},end,height,radius,vertical,profile,yaw:binding.root.rotation.y,stopped:false,duration:vertical?PEACE_STUNT_RULES.verticalSeconds:PEACE_STUNT_RULES.flightSeconds};entry.path=[];entry.target={...end};entry.escapePlanned=false;
    phase(entry,'flight');Object.assign(entry.state,{launchedOnce:true,launchVertical:vertical,somersault:!vertical,completedTurns:0,launchProgress:0,launchLift:0,launchRoll:0,launchSpin:0,launchPitch:0,launchScaleY:1,recoveryOffsetY:groundOffset,landingProgress:0,getupProgress:0,launchDistance:distance(current,end),launchRadius:radius,launchPivot:pivot,launchBlocked:false,stationary:false});
    binding.setYaw?.(vertical?entry.launch.yaw:Math.atan2(-dx,-dz));return true;
  }
  function visualY(profile,pitch,roll,scaleY){
    const rotation=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitch,0,roll,'YXZ')).elements,vertices=profile.vertices;let min=Infinity,max=-Infinity;
    for(let i=0;i<vertices.length;i+=3){const y=profile.pivot+rotation[1]*vertices[i]+rotation[5]*(vertices[i+1]-profile.pivot)*scaleY+rotation[9]*vertices[i+2];min=Math.min(min,y);max=Math.max(max,y);}
    return {min,max};
  }
  function recoveryPose(entry,gettingUp){
    const state=entry.state,launch=entry.launch,duration=gettingUp?PEACE_STUNT_RULES.getupSeconds:PEACE_STUNT_RULES.landingSeconds,t=Math.min(1,state.phaseTime/duration);
    const shape=recoveryShape(t,launch.vertical,gettingUp),range=visualY(launch.profile,shape.pitch,shape.roll,shape.scaleY);
    Object.assign(state,{launchLift:0,launchPitch:shape.pitch,launchRoll:shape.roll,launchSpin:0,launchScaleY:shape.scaleY,recoveryOffsetY:.008-range.min,moving:false});
    state[gettingUp?'getupProgress':'landingProgress']=t;
    if(t>=1){
      if(!gettingUp){phase(entry,'getup');recoveryPose(entry,true);}
      else {restorePeacePose(entry.binding);launchPoseCache.delete(entry.binding.root);entry.launch=null;Object.assign(state,{launchPitch:0,launchRoll:0,launchScaleY:1,recoveryOffsetY:0});startReturn(entry);}
    }
  }
  function advanceLaunch(entry,step){
    const state=entry.state,launch=entry.launch,current=point(entry.binding.getPosition()),t=Math.min(1,state.phaseTime/launch.duration),ease=1-(1-t)*(1-t);
    if(launch.vertical)entry.binding.setYaw?.(launch.yaw);
    if(!launch.stopped&&!launch.vertical){
      const candidate={x:launch.start.x+(launch.end.x-launch.start.x)*ease,y:current.y,z:launch.start.z+(launch.end.z-launch.start.z)*ease};
      if(segmentClear(current,candidate,obstacles(entry.binding,entry.bounds),launch.radius,actors(entry.binding),entry.bounds))entry.binding.setPosition(candidate);
      else {launch.stopped=true;state.launchBlocked=true;}
    }
    // Keep owners on Idle; movement is controlled solely by this arc.
    state.moving=false;state.launchProgress=t;state.launchLift=4*launch.height*t*(1-t);
    const angles=flightAngles(t,launch.vertical);state.launchSpin=angles.spin;state.launchRoll=angles.roll;state.launchPitch=angles.pitch;state.launchScaleY=1;state.recoveryOffsetY=launch.profile.groundOffset;
    if(!launch.vertical&&t>=.9)state.completedTurns=1;
    if(t>=1){
      Object.assign(state,{launchLift:0,launchRoll:0,launchSpin:0,launchPitch:0});phase(entry,'landing');recoveryPose(entry,false);
    }
  }
  function trigger(id,shot={}){
    const key=aliases.get(id),binding=entries.get(key);
    if(disposed||!running||!binding||!visible(binding.root))return false;
    if(active.has(key)){const entry=active.get(key);entry.state.hits++;if(shot.direct)startLaunch(entry,shot);return true;}
    if((cooldowns.get(key)||0)>clock||active.size>=LIMIT)return false;
    const origin=point(binding.getPosition());if(!origin)return false;
    const source=point(shot.origin||shot.source||getOrigin()) || {...origin,z:origin.z-1};
    if(Math.abs(source.y-origin.y)>2.5 && !shot.direct)return false;
    const movable=binding.canMove?.()!==false;
    if(binding.begin?.()===false)return false;
    const state={phase:'startled',phaseTime:0,age:0,moving:false,cover:false,hits:1,stationary:!movable};
    const entry={id:key,binding,state,origin,source,originalYaw:binding.root.rotation.y,radius:Math.max(.2,binding.radius||.45),bounds:boundsFor(binding,origin),movable,path:[],target:null,blocked:0,replan:0,escapePlanned:false,serial:++serial};
    binding.root.userData.peaceBehavior=state;active.set(key,entry);if(shot.direct)startLaunch(entry,shot);return true;
  }
  function finish(entry,returned,reason){
    restorePeacePose(entry.binding);launchPoseCache.delete(entry.binding.root);delete entry.binding.root.userData.peaceBehavior;active.delete(entry.id);cooldowns.set(entry.id,clock+COOLDOWN);
    if(returned)entry.binding.setYaw?.(entry.originalYaw);
    const result={returned,reason,position:point(entry.binding.getPosition())};
    history.push({id:entry.id,label:entry.binding.root.name,seconds:entry.state.age,hits:entry.state.hits,cover:entry.state.cover,...result});if(history.length>24)history.shift();
    entry.binding.end?.(result);
  }
  function startReturn(entry){
    phase(entry,'returning');entry.path=[];entry.target=entry.origin;
    const route=pathFor(entry,point(entry.binding.getPosition()),entry.origin);if(route)entry.path=route.slice(1);
  }
  function advance(entry,step){
    const current=point(entry.binding.getPosition());
    if(!entry.path.length)return false;
    while(entry.path.length>1&&distance(current,entry.path[0])<.035)entry.path.shift();
    const next=entry.path[0],length=distance(current,next),speed=entry.state.phase==='fleeing'?2.65:1.65,travel=Math.min(length,speed*step);
    const candidate={x:current.x+(next.x-current.x)/(length||1)*travel,y:current.y,z:current.z+(next.z-current.z)/(length||1)*travel};
    if(!segmentClear(current,candidate,obstacles(entry.binding,entry.bounds),entry.radius,actors(entry.binding),entry.bounds)){entry.blocked+=step;entry.state.moving=false;return false;}
    entry.binding.setPosition(candidate);entry.binding.setYaw?.(Math.atan2(next.x-current.x,next.z-current.z));entry.state.moving=travel>1e-6;entry.blocked=0;
    if(length<=travel+.00001)entry.path.shift();return !entry.path.length;
  }
  function stepEntry(entry,step){
    const state=entry.state;state.age+=step;state.phaseTime+=step;entry.replan=Math.max(0,entry.replan-step);
    const current=point(entry.binding.getPosition());if(!current){finish(entry,false,'unavailable');return;}
    if(state.age>=MAX_SECONDS){finish(entry,distance(current,entry.origin)<.06,'return-timeout');return;}
    if(state.phase==='flight')advanceLaunch(entry,step);
    else if(state.phase==='landing')recoveryPose(entry,false);
    else if(state.phase==='getup')recoveryPose(entry,true);
    else if(state.phase==='startled'){
      entry.binding.setYaw?.(Math.atan2(entry.source.x-current.x,entry.source.z-current.z));
      if(state.phaseTime<.62)return;
      const escape=!entry.escapePlanned&&entry.movable?planEscape(entry):null;entry.escapePlanned=true;
      if(escape){entry.path=escape.path;entry.target=escape.target;state.cover=escape.cover;phase(entry,'fleeing');}
      else {state.stationary=true;if(state.phaseTime>=1.4){if(distance(current,entry.origin)>.025)startReturn(entry);else finish(entry,true,'startle-only');}}
    }else if(state.phase==='fleeing'){
      if(advance(entry,step)){phase(entry,'hiding');entry.binding.setYaw?.(Math.atan2(entry.source.x-current.x,entry.source.z-current.z));}
      else if(entry.blocked>.8||state.phaseTime>3.8)startReturn(entry);
    }else if(state.phase==='hiding'){
      if(state.phaseTime>=1.7+(entry.serial%3)*.15)startReturn(entry);
    }else if(state.phase==='returning'){
      if(distance(current,entry.origin)<.025){finish(entry,true,'returned');return;}
      if((!entry.path.length||entry.blocked>.5)&&!entry.replan){const route=pathFor(entry,current,entry.origin);entry.path=route?route.slice(1):[];entry.replan=.7;}
      if(advance(entry,step))finish(entry,true,'returned');
    }
  }
  function update(dt,options={}){
    if(disposed)return;running=options.running??true;
    if(!running||!Number.isFinite(dt)||dt<=0)return;
    let remaining=Math.min(dt,.2);
    while(remaining>1e-9){const step=Math.min(.05,remaining);clock+=step;for(const entry of [...active.values()])stepEntry(entry,step);remaining-=step;}
  }
  function dispose(){if(disposed)return;disposed=true;for(const entry of [...active.values()]){const current=point(entry.binding.getPosition());finish(entry,!!current&&distance(current,entry.origin)<.025,'disposed');}cooldowns.clear();}
  return {trigger,update,dispose,getSnapshot:()=>({disposed,running,reducedMotion,capacity:LIMIT,clock,registered:entries.size,completed:history.map(item=>({...item,position:{...item.position}})),
    active:[...active.values()].map(entry=>({id:entry.id,label:entry.binding.root.name,...entry.state,position:point(entry.binding.getPosition()),origin:{...entry.origin},target:entry.target?{...entry.target}:null}))})};
}

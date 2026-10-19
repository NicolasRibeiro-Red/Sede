import * as THREE from 'three';

const STEP=1/120;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const angleDelta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
const spring=(state,target,frequency,dt)=>{
 const error=state.value-target,impulse=state.velocity+frequency*error,decay=Math.exp(-frequency*dt);
 state.value=target+(error+impulse*dt)*decay;
 state.velocity=(state.velocity-frequency*impulse*dt)*decay;
};
const scalar=value=>({value,velocity:0});

/** Segment against an expanded solid. Camera collision never changes car physics. */
function hitFraction(start,end,box,padding=.24){
 let near=0,far=1;
 for(const [axis,min,max]of [['x',box.minX-padding,box.maxX+padding],['y',(box.minY??0)-padding,(box.maxY??box.height??2)+padding],['z',box.minZ-padding,box.maxZ+padding]]){
  const direction=end[axis]-start[axis];
  if(Math.abs(direction)<1e-9){if(start[axis]<min||start[axis]>max)return null;continue;}
  let a=(min-start[axis])/direction,b=(max-start[axis])/direction;if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);if(near>far)return null;
 }
 return near>=0&&near<=1?near:null;
}

/**
 * Upright arcade chase rig. Heading, boom position, look target and lens use
 * critically damped springs, stepped at 120 Hz with interpolated car input.
 * Inverted car pitch never flips the horizon. The car sits around the lower
 * third; speed adds modest look-ahead/distance instead of a wide-angle jump.
 */
export function createChaseCamera({getObstacles=()=>[],getGroundHeight=()=>0,loop=null}={}){
 let initialized=false,previous=null,activeCamera=null,originalFov=null;
 let yaw=scalar(0),lens=scalar(54),distance=scalar(7.6),height=scalar(3.25),ahead=scalar(5.3),loopBlend=scalar(0);
 const boom={x:scalar(0),y:scalar(0),z:scalar(0)},aim={x:scalar(0),y:scalar(0),z:scalar(0)};
 const eye=new THREE.Vector3(),target=new THREE.Vector3();
 let obstructed=false,detourAngle=0;
 function reset(){initialized=false;previous=null;detourAngle=0;}
 function release(){if(activeCamera&&originalFov!==null){activeCamera.fov=originalFov;activeCamera.updateProjectionMatrix();}activeCamera=null;originalFov=null;reset();}
 function goals(vehicle){
  const speed=clamp(Math.abs(vehicle.speed||0)/13.2,0,1),air=vehicle.flight||vehicle.looping;
  return {distance:vehicle.rolling?10:air?8.5:7.6+speed*.7,height:vehicle.looping?4.3:vehicle.flight?3.6:3.25,ahead:vehicle.rolling?2.5:vehicle.looping?3.3:5.3+speed*.9,fov:vehicle.looping||vehicle.rolling?60:vehicle.flight?58:54+speed*4};
 }
 function loopInfluence(vehicle){
  if(!loop)return 0;if(vehicle.looping)return 1;if(vehicle.flight)return 0;
  const dx=vehicle.position.x-loop.x,dz=vehicle.position.z-loop.z,sy=Math.sin(loop.heading),cy=Math.cos(loop.heading);
  const along=dx*sy+dz*cy,lateral=dx*cy-dz*sy;
  const smooth=t=>{const v=clamp(t,0,1);return v*v*(3-2*v);};
  // Prepare the side view before the rear boom enters the broad ribbon. The
  // same view protects cars passing the portal without activating the loop.
  const outside=Math.max(0,lateral-3,-lateral-(loop.separation||0)-3);
  return smooth((along+10)/6)*(1-smooth((along-7)/7))*(1-smooth(outside/4))*smooth((Math.cos(vehicle.heading-loop.heading)-.2)/.6);
 }
 function frameGoals(p,vehicle){
  const fx=Math.sin(yaw.value),fz=Math.cos(yaw.value);
  const eye={x:p.x-fx*distance.value,y:p.y+height.value,z:p.z-fz*distance.value},aim={x:p.x+fx*ahead.value,y:p.y+1.05,z:p.z+fz*ahead.value};
  if(loop&&loopBlend.value>.00001){
   const sy=Math.sin(loop.heading),cy=Math.cos(loop.heading),pitch=vehicle.looping?(vehicle.pitch||0):0;
   const up=new THREE.Vector3(0,.65,0).applyEuler(new THREE.Euler(pitch,vehicle.heading,vehicle.roll||0,'YXZ'));
   const body={x:p.x+up.x,y:p.y+up.y,z:p.z+up.z};
   const portalSide=((p.x-loop.x)*sy+(p.z-loop.z)*cy)<0?-1:1;
   // During the loop, both the camera's XY projection and the body centre
   // stay inside the loop circle. Their sightline cannot cross its ribbon.
   // Looking from outside the side edge keeps the car and complete arc legible.
   const sideEye=vehicle.looping
    ? {x:loop.x+(body.x-loop.x)*.4-sy*1.5+cy*10.5,y:loop.radius+(body.y-loop.radius)*.4+.6,z:body.z-cy*1.5-sy*10.5}
    : {x:p.x+sy*(portalSide<0?-1.2:2.1)+cy*10.5,y:p.y+(portalSide<0?2.2:1.4),z:p.z+cy*(portalSide<0?-1.2:2.1)-sy*10.5};
   const sideAim={x:body.x,y:body.y+.75,z:body.z};
   for(const key of ['x','y','z']){eye[key]+=(sideEye[key]-eye[key])*loopBlend.value;aim[key]+=(sideAim[key]-aim[key])*loopBlend.value;}
  }
  return {eye,aim};
 }
 function resolve(anchor,candidate,obstacles,nominal){
  const fractionTo=end=>{let fraction=1;for(const box of obstacles){const hit=hitFraction(anchor,end,box);if(hit!==null)fraction=Math.min(fraction,Math.max(0,hit-.012));}return fraction;};
  const ideal=new THREE.Vector3(nominal.x,nominal.y,nominal.z),idealDelta=ideal.clone().sub(anchor),up=new THREE.Vector3(0,1,0);
  if(detourAngle&&fractionTo(ideal)>.995)detourAngle=0;
  let fraction=fractionTo(candidate);
  if(detourAngle||fraction*candidate.distanceTo(anchor)<3.6){
   const angles=detourAngle?[detourAngle,-detourAngle,.35,-.35,.7,-.7,1.05,-1.05]:[.35,-.35,.7,-.7,1.05,-1.05];
   for(const angle of angles){const side=idealDelta.clone().applyAxisAngle(up,angle).add(anchor),allowed=fractionTo(side);if(allowed*side.distanceTo(anchor)<4.2)continue;candidate.lerpVectors(anchor,side,allowed);detourAngle=angle;fraction=1;break;}
  }
  obstructed=fraction<1||detourAngle!==0;
  if(fraction<1)candidate.lerpVectors(anchor,candidate,fraction);
  candidate.y=Math.max(candidate.y,getGroundHeight(candidate)+.4);
  return candidate;
 }
 function update(dt,vehicle,camera){
  if(!camera?.isPerspectiveCamera||!vehicle?.position||![vehicle.position.x,vehicle.position.y,vehicle.position.z,vehicle.heading,dt].every(Number.isFinite)||dt<0)return;
  if(activeCamera!==camera){release();activeCamera=camera;originalFov=camera.fov;}
  const settings=goals(vehicle),anchor=new THREE.Vector3(vehicle.position.x,vehicle.position.y+1.05,vehicle.position.z);
  const obstacles=getObstacles({x:vehicle.position.x,z:vehicle.position.z})||[];
  if(!initialized){
   yaw=scalar(vehicle.heading);lens=scalar(settings.fov);distance=scalar(settings.distance);height=scalar(settings.height);ahead=scalar(settings.ahead);loopBlend=scalar(loopInfluence(vehicle));
   const goal=frameGoals(vehicle.position,vehicle);
   eye.set(goal.eye.x,goal.eye.y,goal.eye.z);target.set(goal.aim.x,goal.aim.y,goal.aim.z);
   resolve(anchor,eye,obstacles,goal.eye);for(const key of ['x','y','z']){boom[key]=scalar(eye[key]);aim[key]=scalar(target[key]);}
   initialized=true;
  }else if(dt>0){
   const elapsed=Math.min(dt,.25),count=Math.max(1,Math.ceil(elapsed/STEP)),step=elapsed/count;
   const from=previous||vehicle,headingEnd=from.heading+angleDelta(from.heading,vehicle.heading);
   for(let index=1;index<=count;index++){
    const t=index/count,p={x:from.position.x+(vehicle.position.x-from.position.x)*t,y:from.position.y+(vehicle.position.y-from.position.y)*t,z:from.position.z+(vehicle.position.z-from.position.z)*t};
    const heading=from.heading+(headingEnd-from.heading)*t;
    spring(yaw,yaw.value+angleDelta(yaw.value,heading),12,step);
    spring(loopBlend,loopInfluence({...vehicle,position:p,heading}),10,step);
    for(const [state,value]of [[lens,settings.fov],[distance,settings.distance],[height,settings.height],[ahead,settings.ahead]])spring(state,value,8,step);
    const goal=frameGoals(p,vehicle);
    for(const key of ['x','y','z']){spring(boom[key],goal.eye[key],vehicle.looping?24:detourAngle?14:20,step);spring(aim[key],goal.aim[key],vehicle.looping?28:24,step);}
   }
   eye.set(boom.x.value,boom.y.value,boom.z.value);target.set(aim.x.value,aim.y.value,aim.z.value);
   resolve(anchor,eye,obstacles,frameGoals(vehicle.position,vehicle).eye);
   // Collision compresses the boom immediately; the springs extend it again
   // smoothly after clearance, without storing a camera inside a building.
   if(obstructed)for(const key of ['x','y','z']){boom[key].value=eye[key];boom[key].velocity=0;}
  }
  previous={...vehicle,position:{...vehicle.position}};
  camera.position.copy(eye);camera.up.set(0,1,0);camera.lookAt(target);
  if(Math.abs(camera.fov-lens.value)>.005){camera.fov=lens.value;camera.updateProjectionMatrix();}
  camera.updateMatrixWorld(true);
 }
 return {update,reset,release,getSnapshot:()=>({initialized,heading:yaw.value,position:eye.toArray(),target:target.toArray(),fov:lens.value,obstructed,loopBlend:loopBlend.value})};
}

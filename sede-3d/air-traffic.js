import * as THREE from 'three';
import { createRoadster } from './roadster.js';

const TAU = Math.PI * 2;
const CAMPUS = { minX: -62, maxX: 80, minZ: -34, maxZ: 42 };
const ROUTES = [
  { id: 'air-silver', color: '#dce0e0', x: -3, z: 10, rx: 30, rz: 19, height: 26.8, rise: .35, period: 52, direction: 1, phase: .3 },
  { id: 'air-blue', color: '#607d90', x: -16, z: 4, rx: 34, rz: 23, height: 30.6, rise: .4, period: 64, direction: -1, phase: 2.5 },
  { id: 'air-wine', color: '#803d48', x: 10, z: 0, rx: 38, rz: 26, height: 34.4, rise: .35, period: 73, direction: 1, phase: 4.5 },
];

function poseAt(route, seconds) {
  const omega = TAU / route.period * route.direction;
  const angle = route.phase + seconds * omega;
  const vx = -route.rx * Math.sin(angle) * omega, vz = route.rz * Math.cos(angle) * omega;
  const vy = route.rise * Math.cos(angle * 2 + route.phase) * omega * 2;
  const horizontalSpeed = Math.hypot(vx, vz);
  const yawRate = -route.rx * route.rz * omega ** 3 / horizontalSpeed ** 2;
  return {
    position: { x: route.x + route.rx * Math.cos(angle), y: route.height + route.rise * Math.sin(angle * 2 + route.phase), z: route.z + route.rz * Math.sin(angle) },
    heading: Math.atan2(vx, vz), pitch: -Math.atan2(vy, horizontalSpeed),
    roll: THREE.MathUtils.clamp(-yawRate * horizontalSpeed / 9.81, -.09, .09), speed: Math.hypot(horizontalSpeed, vy),
  };
}

// Conservative envelope includes the full-size body, gentle bank and all four jets.
// Its lowest point stays above 25 m, clear of the player's 22 m flight ceiling.
function envelope(pose) {
  const p = pose.position;
  return { minX: p.x - 2.3, maxX: p.x + 2.3, minY: p.y - 1.1, maxY: p.y + 1.6, minZ: p.z - 2.3, maxZ: p.z + 2.3 };
}
function intersects(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;
}
function flightObstacles(items) {
  return (items || []).map(box => ({ ...box, minY: box.minY ?? 0, maxY: box.maxY ?? ((box.minY ?? 0) + (box.height ?? 6)) }))
    .filter(box => box.maxY > 25 && ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'].every(key => Number.isFinite(box[key])));
}

/**
 * Ambient traffic and optional campus visits; never produces agent metrics.
 * update(dt,{running}) freezes routes AND jet animation when paused; setNight(0..1)
 * only changes existing emissive materials. Without assets this remains the
 * synchronous flight-only demo. With manifest/loadModel it returns a Promise
 * and loads three passengers. getObstacles supplies real ground solids/doors;
 * getFlightObstacles supplies static 3D volumes; getActors supplies other people
 * and the pilot vehicle. Callbacks must exclude this controller's own outputs.
 * Descending cars wait for a clear column and sweep every step before moving.
 */
export function createAirTraffic({ scene, bounds = CAMPUS, getObstacles = () => [], manifest, loadModel, getFlightObstacles = () => [], getActors = () => [], onDoor = () => {} } = {}) {
  if (!scene?.add || typeof getObstacles !== 'function') throw new TypeError('Air traffic requires a scene and an obstacle callback.');
  const limits = { ...bounds };
  if (!['minX', 'maxX', 'minZ', 'maxZ'].every(key => Number.isFinite(limits[key]))) throw new TypeError('Air traffic bounds must be finite.');
  const initialObstacles = flightObstacles(getObstacles());
  const within = box => box.minX >= limits.minX && box.maxX <= limits.maxX && box.minZ >= limits.minZ && box.maxZ <= limits.maxZ;
  // Validate complete reserved routes before allocating model resources.
  for (const route of ROUTES) for (let i = 0; i < 720; i++) {
    const box = envelope(poseAt(route, route.period * i / 720));
    if (!within(box) || initialObstacles.some(obstacle => intersects(box, obstacle))) throw new RangeError(`Air corridor unavailable: ${route.id}.`);
  }
  const group = new THREE.Group(); group.name = 'Roadsters · tráfego aéreo';
  const cars = ROUTES.map(route => {
    const model = createRoadster({ name: route.id, color: route.color }); group.add(model.group);
    // These distant cars do not need additional shadow-map draw calls.
    model.group.traverse(object => { if (object.isMesh) object.castShadow = false; });
    return { route, model, seconds: 0, pose: poseAt(route, 0), blocked: false, state: 'cruising', stateSeconds: 0, completedVisits: 0, nextVisit: 0, transition: null };
  });
  let disposed = false, elapsed = 0, night = 0, visitors = null, padGroup = null;
  const padResources=[];
  function apply(car) {
    car.model.group.position.set(car.pose.position.x, car.pose.position.y, car.pose.position.z);
    car.model.group.rotation.set(car.pose.pitch, car.pose.heading, car.pose.roll, 'YXZ');
    const close=!!visitors&&car.pose.position.y<5;if(close!==car.shadowNear){car.shadowNear=close;car.model.group.traverse(node=>{if(node.isMesh&&node.name!=='Ar comprimido · quatro toberas')node.castShadow=close;});}
  }
  for (const car of cars) { apply(car); car.model.update(0, { flight: true, pressure: 45 }); }
  scene.add(group);
  const smooth=t=>t*t*t*(t*(t*6-15)+10);
  function prepareCanopy(car){
    // Only this owned traffic instance changes; the shared Roadster builder and
    // the user's car keep their original geometry. Identify parts by material
    // and transform rather than depending on child order.
    const glass=car.model.group.children.find(node=>node.isMesh&&!node.isInstancedMesh&&node.material?.color?.getHexString()==='2e2a24');
    if(!glass)return;
    const hinge=new THREE.Group();hinge.name='Canopy · embarque';hinge.position.set(0,.76,-1.14);car.model.group.add(hinge);glass.position.sub(hinge.position);hinge.add(glass);
    let roof=null;const matrix=new THREE.Matrix4(),position=new THREE.Vector3();
    car.model.group.traverse(mesh=>{if(!mesh.isInstancedMesh||mesh.material?.color?.getHexString()!=='10191c')return;for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);if(Math.abs(position.y-1.255)<.002&&Math.abs(position.z+.3)<.002)roof={mesh,index:i,matrix:matrix.clone()};}});
    car.canopy={hinge,roof,progress:0,transform:new THREE.Matrix4(),translation:new THREE.Matrix4(),rotation:new THREE.Matrix4()};
  }
  function updateCanopy(car,step){
    if(!car.canopy)return;const passenger=visitors.getState(car.route.id),open=car.state==='landed'||car.state==='visiting'&&['exiting','boarding'].includes(passenger.state),canopy=car.canopy;
    canopy.progress=THREE.MathUtils.clamp(canopy.progress+(open?1:-1)*step/.65,0,1);const angle=-smooth(canopy.progress)*1.05;canopy.hinge.rotation.x=angle;
    if(canopy.roof){const p=canopy.hinge.position;canopy.transform.makeTranslation(p.x,p.y,p.z).multiply(canopy.rotation.makeRotationX(angle)).multiply(canopy.translation.makeTranslation(-p.x,-p.y,-p.z)).multiply(canopy.roof.matrix);canopy.roof.mesh.setMatrixAt(canopy.roof.index,canopy.transform);canopy.roof.mesh.instanceMatrix.needsUpdate=true;}
  }
  const carEnvelope=car=>({...envelope(car.pose),maxY:car.pose.position.y+(car.canopy?.progress>.01?2.75:1.6)});
  const getVehicleObstacles=()=>disposed?[]:cars.filter(car=>car.pose.position.y<3.2).map(car=>({id:car.route.id,...carEnvelope(car)}));
  const getVehicleVolumes=()=>disposed?[]:cars.map(car=>({id:car.route.id,...carEnvelope(car)}));
  function motion(car,state,target,duration,{endVelocity=false}={}){
    const from={...car.pose.position},to={...target.position},horizontal=Math.hypot(to.x-from.x,to.z-from.z)>.01;
    duration=Math.max(duration,Math.hypot(to.x-from.x,to.z-from.z)/4);
    const tangent=horizontal&&state==='approaching'?6:0,exit=horizontal&&endVelocity?6:0;
    const clampX=x=>THREE.MathUtils.clamp(x,limits.minX+2.5,limits.maxX-2.5),clampZ=z=>THREE.MathUtils.clamp(z,limits.minZ+2.5,limits.maxZ-2.5);
    car.transition={from,to,duration,fromHeading:car.pose.heading,toHeading:target.heading,fromPitch:car.pose.pitch,fromRoll:car.pose.roll,
      p1:{x:clampX(from.x+Math.sin(car.pose.heading)*tangent),z:clampZ(from.z+Math.cos(car.pose.heading)*tangent)},
      p2:{x:clampX(to.x-Math.sin(target.heading)*exit),z:clampZ(to.z-Math.cos(target.heading)*exit)}};
    car.state=state;car.stateSeconds=0;car.blocked=false;
  }
  function motionPose(car,seconds){
    const m=car.transition,t=Math.min(1,seconds/m.duration),u=smooth(t),a=1-t;
    const turn=Math.atan2(Math.sin(m.toHeading-m.fromHeading),Math.cos(m.toHeading-m.fromHeading));
    return {position:{x:a*a*a*m.from.x+3*a*a*t*m.p1.x+3*a*t*t*m.p2.x+t*t*t*m.to.x,
      z:a*a*a*m.from.z+3*a*a*t*m.p1.z+3*a*t*t*m.p2.z+t*t*t*m.to.z,y:m.from.y+(m.to.y-m.from.y)*u},
      heading:m.fromHeading+turn*u,pitch:m.fromPitch*(1-u),roll:m.fromRoll*(1-u),speed:0};
  }
  function visitSolids(){
    const boxes=[...getFlightObstacles(),...getObstacles().map(box=>({...box,minY:box.minY??0,maxY:box.maxY??box.height??3.6}))];
    for(const actor of getActors()||[])if([actor.x,actor.z,actor.radius].every(Number.isFinite)&&actor.radius>0){const y=Number.isFinite(actor.y)?actor.y:0;boxes.push({id:actor.id,minX:actor.x-actor.radius,maxX:actor.x+actor.radius,minZ:actor.z-actor.radius,maxZ:actor.z+actor.radius,minY:y,maxY:y+(actor.height||1.9)});}
    return boxes.filter(box=>['minX','maxX','minZ','maxZ','minY','maxY'].every(key=>Number.isFinite(box[key])));
  }
  function clear(car,next,solids){
    const a=envelope(car.pose),b=envelope(next),swept=Object.fromEntries(['X','Y','Z'].flatMap(axis=>[[`min${axis}`,Math.min(a[`min${axis}`],b[`min${axis}`])-.002],[`max${axis}`,Math.max(a[`max${axis}`],b[`max${axis}`])+.002]]));
    return within(b)&&!solids.some(box=>intersects(swept,box))&&!cars.some(other=>other!==car&&intersects(swept,envelope(other.pose)));
  }
  function columnClear(car,solids){const pad=car.plan.pad,box={minX:pad.x-2.35,maxX:pad.x+2.35,minZ:pad.z-2.35,maxZ:pad.z+2.35,minY:-.02,maxY:car.route.height+2};return !solids.some(other=>intersects(box,other))&&!cars.some(other=>other!==car&&intersects(box,envelope(other.pose)));}
  function advanceVisit(car,step,solids){
    const passenger=visitors.getState(car.route.id),pad=car.plan.pad;
    car.blocked=false;
    if(car.state==='cruising'){
      if(elapsed>=car.nextVisit){car.returnPose=poseAt(car.route,car.seconds);motion(car,'approaching',{position:{x:pad.x,y:car.pose.position.y,z:pad.z},heading:0},10);return;}
      const next=poseAt(car.route,car.seconds+step);car.blocked=!clear(car,next,solids);if(!car.blocked){car.seconds+=step;car.pose=next;}return;
    }
    if(car.state==='holding'){
      car.blocked=!columnClear(car,solids);if(!car.blocked)motion(car,'descending',{position:{x:pad.x,y:0,z:pad.z},heading:0},car.pose.position.y<15?9:12);return;
    }
    if(car.state==='landed'){
      car.stateSeconds+=step;if(car.stateSeconds>=.8&&visitors.begin(car.route.id))car.state='visiting';return;
    }
    if(car.state==='visiting'){
      if(passenger.state==='aboard'&&passenger.completed>car.completedVisits){car.completedVisits=passenger.completed;car.state='launch-wait';car.stateSeconds=0;}return;
    }
    if(car.state==='launch-wait'){
      car.stateSeconds+=step;car.blocked=!columnClear(car,solids);if(car.stateSeconds>=1&&!car.blocked)motion(car,'ascending',{position:{x:pad.x,y:car.returnPose.position.y,z:pad.z},heading:0},12);return;
    }
    const next=motionPose(car,car.stateSeconds+step);car.blocked=!clear(car,next,solids);
    if(car.blocked)return;
    next.speed=Math.hypot(next.position.x-car.pose.position.x,next.position.y-car.pose.position.y,next.position.z-car.pose.position.z)/step;car.pose=next;car.stateSeconds+=step;
    if(car.stateSeconds+1e-8>=car.transition.duration){
      if(car.state==='approaching'){car.state='holding';car.stateSeconds=0;}
      else if(car.state==='descending'){car.state='landed';car.stateSeconds=0;car.pose.speed=0;}
      else if(car.state==='ascending')motion(car,'departing',car.returnPose,10,{endVelocity:true});
      else if(car.state==='departing'){car.pose=poseAt(car.route,car.seconds);car.state='cruising';car.nextVisit=elapsed+28+cars.indexOf(car)*8;car.stateSeconds=0;}
    }
  }
  const api={
    group,
    update(dt, { running = true } = {}) {
      if (disposed || !running) return;
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Air traffic dt must be a finite, non-negative number.');
      if (!dt) return;
      const obstacles = visitors?visitSolids():flightObstacles(getObstacles());
      // At most 10 cm travel per sample; frame rate changes do not change route speed.
      // Small substeps also respect createRoadster's 0.1 s jet-animation time limit.
      const steps = Math.max(1, Math.ceil(dt * 60)), step = dt / steps;
      for (let i = 0; i < steps; i++) { elapsed += step;for (const car of cars) {
        if(visitors){advanceVisit(car,step,obstacles);updateCanopy(car,step);car.model.update(step,{flight:car.pose.position.y>.65,pressure:car.state==='cruising'?45:30});continue;}
        const next = poseAt(car.route, car.seconds + step), a = envelope(car.pose), b = envelope(next);
        const swept = Object.fromEntries(['X', 'Y', 'Z'].flatMap(axis => [[`min${axis}`, Math.min(a[`min${axis}`], b[`min${axis}`]) - .002], [`max${axis}`, Math.max(a[`max${axis}`], b[`max${axis}`]) + .002]]));
        car.blocked = !within(b) || obstacles.some(obstacle => intersects(swept, obstacle));
        if (!car.blocked) { car.seconds += step; car.pose = next; }
        car.model.update(step, { flight: true, pressure: 45 });
      }if(visitors)visitors.update(step);}
      for (const car of cars) apply(car);
    },
    setNight(amount = 0) {
      if (disposed || !Number.isFinite(amount)) return false;
      night = THREE.MathUtils.clamp(amount, 0, 1); cars.forEach(car => car.model.setNight(night));if(padGroup)padGroup.children[1].material.emissiveIntensity=.04+night*.55;return true;
    },
    getSnapshot() {
      return { count: disposed ? 0 : cars.length, elapsed, night, disposed,
        cars: disposed ? [] : cars.map(({ route, pose, seconds, blocked,state,plan,completedVisits }) => ({ id: route.id, color: route.color, seconds, blocked,state,destination:plan?.destination||null,pad:plan?{...plan.pad}:null,completedVisits,
          visitor:visitors?(({id,name,x,y,z,radius,state,visible,completed})=>({id,name,x,y,z,radius,position:{x,y,z},state,visible,completed}))(visitors.getState(route.id)):null,
          position: { ...pose.position }, heading: pose.heading, pitch: pose.pitch, roll: pose.roll, speed: blocked||['landed','visiting','holding','launch-wait'].includes(state) ? 0 : pose.speed })) };
    },
    getObstacles:getVehicleObstacles,getFlightObstacles:getVehicleVolumes,getColliders:()=>visitors?.getColliders()||[],getPeaceBindings:()=>visitors?.getPeaceBindings()||[],
    dispose() {
      if (disposed) return; disposed = true;
      visitors?.dispose();cars.forEach(car => car.model.dispose());padResources.forEach(resource=>resource.dispose());padGroup?.removeFromParent(); group.removeFromParent(); group.clear();
    },
  };
  // Keep the former flight-only factory synchronous for standalone demos.
  // Supplying the local assets enables the async, complete campus lifecycle.
  if(!manifest&&!loadModel)return api;
  return import('./air-visitors.js?v=20261019-beta1').then(async({createAirVisitors,VISIT_PLANS})=>{
    visitors=await createAirVisitors({scene,manifest,loadModel,bounds:limits,getObstacles,getActors,getVehicleObstacles,onDoor});
    cars.forEach((car,index)=>{car.plan=VISIT_PLANS[index];car.nextVisit=index?car.plan.delay:0;car.returnPose=poseAt(car.route,car.seconds);prepareCanopy(car);});
    const first=cars[0];first.pose={position:{x:first.plan.pad.x,y:12,z:first.plan.pad.z},heading:0,pitch:0,roll:0,speed:0};first.state='holding';apply(first);
    padGroup=new THREE.Group();padGroup.name='Chegadas · três pontos de pouso';
    const slab=new THREE.CircleGeometry(2.65,32).rotateX(-Math.PI/2),ring=new THREE.RingGeometry(2.36,2.41,32).rotateX(-Math.PI/2);
    const concrete=new THREE.MeshStandardMaterial({color:'#b5b9aa',roughness:.95}),marking=new THREE.MeshStandardMaterial({color:'#eee9ce',roughness:.8,emissive:'#f0d8a1',emissiveIntensity:.04});padResources.push(slab,ring,concrete,marking);
    for(const [geometry,material,y]of [[slab,concrete,.008],[ring,marking,.012]]){const mesh=new THREE.InstancedMesh(geometry,material,cars.length);mesh.receiveShadow=true;const matrix=new THREE.Matrix4();cars.forEach((car,index)=>mesh.setMatrixAt(index,matrix.makeTranslation(car.plan.pad.x,y,car.plan.pad.z)));padGroup.add(mesh);}scene.add(padGroup);
    return api;
  }).catch(error=>{api.dispose();throw error;});
}


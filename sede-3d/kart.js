import * as THREE from 'three';
import {TRACK_PIT as PIT, LOOP, LOOP_RANGE, TRACK_WIDTH, TRACK_LENGTH, ROADSTER_TRACK, sampleTrack, nearestTrack, trackSurface, loopPose, createTrackRibbon} from './track.js?v=20261019-maneuvers3';
import {createRoadster} from './roadster.js';
import {createChaseCamera} from './chase-camera.js?v=20261019-maneuvers3';

const TAU=Math.PI*2, PHYSICS_STEP=1/120, PLAYER_RADIUS=.88;
export const ROADSTER_HANDLING=Object.freeze({groundSpeed:9.2,groundBoost:13.2,reverseSpeed:3.3,acceleration:5.2,boostAcceleration:7.5,braking:12,coasting:3.2,steeringResponse:12,baseRadius:2.45,radiusSpeedFactor:.035,flightSpeed:11.5,flightBoost:17});
const DEFAULT_BOUNDS={minX:-62,maxX:80,minZ:-34,maxZ:42};
const PIT_HEADING=Math.atan2(LOOP.x-PIT.x,LOOP.z-PIT.z);
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const wrap=a=>((a%TAU)+TAU)%TAU;
const deltaAngle=(from,to)=>Math.atan2(Math.sin(to-from),Math.cos(to-from));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const onTrack=p=>nearestTrack(p).distance<=TRACK_WIDTH/2-.22;
export {ROADSTER_TRACK as KART_TRACK};
/** The vehicle can leave the circuit and drive throughout the shared campus. */
export function isKartDrivable(p,bounds=DEFAULT_BOUNDS){return !!p&&Number.isFinite(p.x)&&Number.isFinite(p.z)&&p.x>=bounds.minX+PLAYER_RADIUS&&p.x<=bounds.maxX-PLAYER_RADIUS&&p.z>=bounds.minZ+PLAYER_RADIUS&&p.z<=bounds.maxZ-PLAYER_RADIUS;}
const boxTop=box=>Number.isFinite(box.maxY)?box.maxY:Number.isFinite(box.height)?box.height:2;
function sphereBox(p,radius,box){const x=clamp(p.x,box.minX,box.maxX),z=clamp(p.z,box.minZ,box.maxZ);return Math.hypot(p.x-x,p.z-z)<radius-1e-7;}
// Conservative world-space envelope of the 2.08 × 1.3 × 3.8 m car, including
// mirrors and its actual YXZ loop rotation. The upright driving capsule alone
// misses the hanging nose/roof when the vehicle is inverted or descending.
function loopBodyBox(pose){
 const matrix=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pose.pitch||0,pose.heading,pose.roll||0,'YXZ')).setPosition(pose.x,pose.y,pose.z);
 const box=new THREE.Box3(new THREE.Vector3(-1.04,0,-1.9),new THREE.Vector3(1.04,1.3,1.9)).applyMatrix4(matrix);
 return {minX:box.min.x,maxX:box.max.x,minY:box.min.y,maxY:box.max.y,minZ:box.min.z,maxZ:box.max.z};
}

// Collision uses the exact opaque loop ribbon, including its lateral separation.
const loopGeometry=createTrackRibbon({loop:true,width:LOOP.width,segments:180,yOffset:0}),loopTriangles=[];
for(let i=0;i<loopGeometry.index.count;i+=3){const points=[0,1,2].map(offset=>new THREE.Vector3().fromBufferAttribute(loopGeometry.attributes.position,loopGeometry.index.getX(i+offset)));loopTriangles.push({triangle:new THREE.Triangle(...points),box:new THREE.Box3().setFromPoints(points)});}loopGeometry.dispose();
function hitsLoopSurface(pose){if(pose.x<LOOP.x-LOOP.radius-4||pose.x>LOOP.x+LOOP.radius+4||pose.z<LOOP.z-5||pose.z>LOOP.z+LOOP.separation+5||pose.y>LOOP.radius*2+3)return false;const b=loopBodyBox(pose),box=new THREE.Box3(new THREE.Vector3(b.minX,b.minY+.12,b.minZ),new THREE.Vector3(b.maxX,b.maxY,b.maxZ));return loopTriangles.some(item=>item.box.max.y>.22&&box.intersectsBox(item.box)&&box.intersectsTriangle(item.triangle));}
const ease=t=>{t=clamp(t,0,1);return t*t*t*(10+t*(-15+6*t));};
function barrelPose(spec,t){const travel=t-Math.sin(TAU*t)/TAU;return {x:spec.start.x+Math.sin(spec.heading)*spec.travel*travel,y:spec.start.y+spec.rise*Math.sin(Math.PI*t)**2,z:spec.start.z+Math.cos(spec.heading)*spec.travel*travel,heading:spec.heading,pitch:0,roll:TAU*ease((t-.14)/.72)};}

/** Checkpoints are geometric; visiting the pit or reversing invalidates a lap. */
export function createKartLapCounter() {
  let previous = null, clock = 0, started = null, checkpoint = 0, lap = 0, bestLap = null, lastLap = null;
  const getSnapshot = () => ({ lap, bestLap, lastLap, lapTime: started === null ? null : clock - started, nextCheckpoint: started === null ? 0 : (checkpoint + 1) % 4 });
  return {
    update({ angle, dt, track = true }) {
      if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(angle)) throw new TypeError('Lap updates require finite angle and non-negative dt.');
      clock += dt;
      if (!track) { previous = null; started = null; checkpoint = 0; return getSnapshot(); }
      const current = wrap(angle);
      if (previous !== null) {
        const change = deltaAngle(previous, current);
        if (change < -1e-5 || Math.abs(change) > .35) { started = null; checkpoint = 0; }
        else if (change > 1e-8) {
          for (let gate = 0; gate < 4; gate++) {
            const ahead = wrap(gate * Math.PI / 2 - previous);
            if (ahead <= 1e-8 || ahead > change + 1e-8) continue;
            const crossedAt = clock - dt + dt * ahead / change;
            if (gate === 0) {
              if (started !== null && checkpoint === 3) {
                lastLap = crossedAt - started; lap++; bestLap = bestLap === null ? lastLap : Math.min(bestLap, lastLap);
              }
              started = crossedAt; checkpoint = 0;
            } else if (started !== null && gate === checkpoint + 1) checkpoint = gate;
            else { started = null; checkpoint = 0; }
          }
        }
      }
      previous = current; return getSnapshot();
    },
    reset({ keepBest = true } = {}) { previous = null; clock = 0; started = null; checkpoint = 0; lap = 0; lastLap = null; if (!keepBest) bestLap = null; return getSnapshot(); },
    getSnapshot,
  };
}

/** Fixed-step arcade driving and cold-gas-inspired flight; no DOM or renderer. */
export function createKartController({initialPosition=PIT,initialHeading=PIT_HEADING,bounds=DEFAULT_BOUNDS,getObstacles=()=>[],getActors=()=>[],getFlightObstacles=()=>[]}={}){
 if(!isKartDrivable(initialPosition,bounds)||!Number.isFinite(initialHeading))throw new RangeError('Roadster must start inside the campus bounds.');
 const position={x:initialPosition.x,y:initialPosition.y??trackSurface(initialPosition),z:initialPosition.z},lapCounter=createKartLapCounter();
 let heading=initialHeading,pitch=0,roll=0,speed=0,steering=0,active=false,flight=false,landing=false,pressure=100,loopTime=null,loopCooldown=0,loopBlocked=false,loopWaitSeconds=0,loopCruiseSpeed=8,loopArmed=false,loopQueued=false,loopLane=0,loopHeadingOffset=0,maneuverMessage=null,barrel=null,rollCooldown=0,rollBlocked=false;
 let input={throttle:0,steer:0,brake:false,lift:0,boost:false};
 let obstacles=[],actors=[];
 function playerLoopPose(t,lane=loopLane,yawOffset=loopHeadingOffset){const pose=loopPose(t),blend=1-ease(t/.35);return {...pose,x:pose.x+pose.right.x*lane*blend,y:pose.y+pose.right.y*lane*blend,z:pose.z+pose.right.z*lane*blend,heading:pose.heading+yawOffset*(1-ease(t/.25))};}
 const loopEligible=()=>active&&!flight&&!barrel&&loopTime===null&&loopCooldown<=0&&(speed>=6||loopQueued)&&position.x>=LOOP.x-4&&position.x<=LOOP.x+.2&&Math.abs(position.z-LOOP.z)<=.7&&Math.abs(deltaAngle(heading,LOOP.heading))<=.35;
 const rollEligible=()=>active&&!landing&&loopTime===null&&!barrel&&rollCooldown<=0&&(!flight||position.y>=3);
 const snapshots=()=>({...lapCounter.getSnapshot(),speed,steering,active,position:{...position},heading,pitch,roll,altitude:position.y,flight,pressure,pressureMode:'arcade-auto',looping:loopTime!==null,loopReady:loopEligible(),loopArmed,loopBlocked,loopWaitSeconds,notice:maneuverMessage,loopMessage:loopBlocked?'Aguardando a pista liberar.':maneuverMessage,rolling:!!barrel,rollReady:rollEligible(),rollBlocked,rollProgress:barrel?barrel.time/barrel.seconds:0,rollMessage:rollBlocked?'Giro aguardando espaço livre.':maneuverMessage,onTrack:onTrack(position),inPit:distance(position,PIT)<5,mode:barrel?'roll':loopTime!==null?'loop':landing?'landing':flight?'flight':'ground'});
 function samplesAt(p,yaw=heading){return [-1,0,1].map(offset=>({x:p.x+Math.sin(yaw)*offset,y:p.y,z:p.z+Math.cos(yaw)*offset}));}
 function valid(p,yaw=heading,{person=false,recover=false,ignoreRibbon=false}={}){
  if(!isKartDrivable(p,bounds))return false;
  const radius=person?.38:PLAYER_RADIUS,checks=person?[p]:samplesAt(p,yaw);
  const boxes=[...obstacles,...getFlightObstacles({x:p.x,z:p.z})];
  if(!checks.every(point=>isKartDrivable(point,bounds)&&!boxes.some(box=>p.y+1.2>(box.minY??0)&&p.y<boxTop(box)+.04&&sphereBox(point,radius,box))))return false;
  const leavingLoop=loopCooldown>0&&p.x>=LOOP.x-.2&&p.x<=LOOP.x+4&&Math.abs(p.z-(LOOP.z+LOOP.separation))<1.6&&Math.cos(yaw-LOOP.heading)>.7;
  if(!person&&!ignoreRibbon&&!loopEligible()&&!leavingLoop&&hitsLoopSurface({...p,heading:yaw,pitch,roll}))return false;
  const before=recover?samplesAt(position):null;
  return actors.every(other=>{
   if(!other||!Number.isFinite(other.x)||!Number.isFinite(other.z))return true;
   const bottom=other.y??0,top=bottom+(other.height??1.8),margin=radius+(other.radius??.4);
   const gap=Math.min(...checks.map(point=>distance(point,other)))-margin;
   if(p.y>=top||p.y+1.2<=bottom||gap>=-1e-7)return true;
   if(!recover||person||position.y>=top||position.y+1.2<=bottom)return false;
   const oldGap=Math.min(...before.map(point=>distance(point,other)))-margin;
   if(oldGap>=0)return false;
   // Another moving actor can create an overlap between frames. Recover only
   // by separating that existing contact; never relax static walls or roofs.
   const movingAway=gap>oldGap+1e-8&&p.y>=position.y-1e-8;
   const rising=p.y>position.y+1e-8&&p.y>=bottom&&gap>=oldGap-1e-8;
   return movingAway||rising;
  });
 }
 function refresh(others=[]){obstacles=getObstacles()||[];actors=[...(getActors()||[]),...others];}
 function validLoopPose(pose){
  if(!valid(pose,pose.heading,{ignoreRibbon:true}))return false;
  const body=loopBodyBox(pose),boxes=[...obstacles,...getFlightObstacles({x:pose.x,z:pose.z})];
  if(body.minX<bounds.minX||body.maxX>bounds.maxX||body.minZ<bounds.minZ||body.maxZ>bounds.maxZ)return false;
  if(boxes.some(box=>body.maxY>(box.minY??0)&&body.minY<boxTop(box)+.04&&body.minX<box.maxX&&body.maxX>box.minX&&body.minZ<box.maxZ&&body.maxZ>box.minZ))return false;
  return actors.every(other=>!other||!Number.isFinite(other.x)||!Number.isFinite(other.z)||body.minY>=(other.y??0)+(other.height??1.8)||body.maxY<=(other.y??0)||!sphereBox(other,other.radius??.4,body));
 }
 function setInput(patch){const next={...input,...patch};if(![next.throttle,next.steer,next.lift].every(v=>Number.isFinite(v)&&v>=-1&&v<=1)||typeof next.brake!=='boolean'||typeof next.boost!=='boolean')throw new TypeError('Roadster controls require normalized axes and boolean brake/boost.');input=next;}
 function stop(){speed=0;steering=0;input={throttle:0,steer:0,brake:false,lift:0,boost:false};}
 function reset(){position.x=PIT.x;position.y=0;position.z=PIT.z;heading=PIT_HEADING;pitch=roll=0;flight=false;landing=false;pressure=100;loopTime=null;loopCooldown=0;loopBlocked=false;loopWaitSeconds=0;loopArmed=loopQueued=false;barrel=null;rollCooldown=0;rollBlocked=false;maneuverMessage=null;stop();lapCounter.reset();return snapshots();}
 function toggleFlight(){if(!active||loopTime!==null||barrel)return false;if(flight){landing=!landing;}else{flight=true;landing=false;lapCounter.update({angle:nearestTrack(position).progress*TAU,dt:0,track:false});}return snapshots();}
 function getExitPosition({others=[]}={}){
  refresh(others);if(flight||loopTime!==null||position.y>trackSurface(position)+.2)return null;
  for(const radius of [1.9,2.5,3.2,4])for(const angle of [Math.PI/2,-Math.PI/2,Math.PI,0,Math.PI/4,-Math.PI/4]){
   const yaw=heading+angle,p={x:position.x+Math.sin(yaw)*radius,y:trackSurface(position),z:position.z+Math.cos(yaw)*radius};
   if(trackSurface(p)>.2)continue;p.y=0;if(valid(p,heading,{person:true}))return p;
  }return null;
 }
 function startLoop({others=[]}={}){
  if(!loopEligible()){if(loopTime===null&&!barrel)maneuverMessage='Loop: alinhe na entrada e acelere acima de 22 km/h.';return false;}
  refresh(others);for(let i=0;i<=96;i++){if(!validLoopPose(playerLoopPose(i/96,LOOP.z-position.z,deltaAngle(LOOP.heading,heading)))){maneuverMessage='Loop ocupado. Aguarde a passagem liberar.';return false;}}
  loopArmed=true;maneuverMessage='Loop automático · mantenha a reta.';return true;
 }
 function startBarrelRoll({others=[]}={}){
  if(!rollEligible()){maneuverMessage='Giro: use B no chão ou acima de 3 m, com espaço livre.';return false;}
  refresh(others);const spec={start:{...position},heading,seconds:2.8,time:0,travel:clamp(Math.abs(speed)*2.8,6,18),rise:Math.min(5,22-position.y),wasFlight:flight};
  for(let i=0;i<=120;i++){const pose=barrelPose(spec,i/120);if(!validLoopPose(pose)||hitsLoopSurface(pose)){maneuverMessage='Sem espaço para o giro. Afaste-se dos obstáculos.';return false;}}
  barrel=spec;rollBlocked=false;flight=true;landing=false;maneuverMessage=null;lapCounter.update({angle:nearestTrack(position).progress*TAU,dt:0,track:false});return true;
 }
 function update(dt,{others=[]}={}){
  if(!Number.isFinite(dt)||dt<0)throw new RangeError('Roadster dt must be finite and non-negative.');
  if(!active||dt===0)return snapshots();refresh(others);let remaining=Math.min(dt,.25);
  while(remaining>1e-9){const step=Math.min(remaining,PHYSICS_STEP);remaining-=step;loopCooldown=Math.max(0,loopCooldown-step);rollCooldown=Math.max(0,rollCooldown-step);
   if(loopQueued){
    // Retain an already-earned entry when traffic interrupts the approach.
    // Requiring another 6 m/s here would trap the car against the same ribbon.
    if(input.brake||input.throttle<0||flight){loopQueued=loopArmed=loopBlocked=false;loopWaitSeconds=0;maneuverMessage=null;}
    else{
     speed=0;loopBlocked=true;loopWaitSeconds+=step;
     if(input.throttle>0&&startLoop({others})){
      const pose=playerLoopPose(0),mid={...pose,x:(position.x+pose.x)/2,y:(position.y+pose.y)/2,z:(position.z+pose.z)/2};
      if(validLoopPose(mid)&&validLoopPose(pose)){Object.assign(position,{x:pose.x,y:pose.y,z:pose.z});heading=pose.heading;pitch=pose.pitch;roll=pose.roll;loopTime=0;loopQueued=loopBlocked=false;loopWaitSeconds=0;speed=loopCruiseSpeed;}
     }
     continue;
    }
   }
   if(barrel){
    const nextTime=Math.min(barrel.seconds,barrel.time+step),pose=barrelPose(barrel,nextTime/barrel.seconds),midpoint=barrelPose(barrel,(barrel.time+nextTime)/2/barrel.seconds);
    rollBlocked=!validLoopPose(midpoint)||!validLoopPose(pose)||hitsLoopSurface(midpoint)||hitsLoopSurface(pose);
    if(rollBlocked)speed=0;else{const previous={...position};barrel.time=nextTime;Object.assign(position,{x:pose.x,y:pose.y,z:pose.z});heading=pose.heading;pitch=pose.pitch;roll=pose.roll;speed=Math.hypot(position.x-previous.x,position.z-previous.z)/step;pressure=Math.max(18,pressure-step*5);}
    if(barrel.time>=barrel.seconds-1e-8){flight=barrel.wasFlight;barrel=null;roll=0;pitch=0;speed=0;rollCooldown=2;rollBlocked=false;}continue;
   }
   if(loopTime!==null){
    const nextTime=Math.min(LOOP.seconds,loopTime+step),pose=playerLoopPose(nextTime/LOOP.seconds),midpoint=playerLoopPose((loopTime+nextTime)/2/LOOP.seconds);
    // The landing area can become occupied after takeoff. Keep the last safe
    // physical pose and freeze only route progress; never reset or move actors.
    loopBlocked=!validLoopPose(midpoint)||!validLoopPose(pose);
    if(loopBlocked){speed=0;loopWaitSeconds+=step;}
    else {loopTime=nextTime;loopWaitSeconds=0;speed=loopCruiseSpeed;Object.assign(position,{x:pose.x,y:pose.y,z:pose.z});heading=pose.heading;pitch=pose.pitch;roll=pose.roll;}
    lapCounter.update({angle:nearestTrack(position).progress*TAU,dt:step,track:true});
    if(loopTime>=LOOP.seconds-1e-8){loopTime=null;loopCooldown=5;pitch=roll=0;loopBlocked=false;loopWaitSeconds=0;loopArmed=false;maneuverMessage=null;}continue;
   }
   const tune=ROADSTER_HANDLING,boosted=input.boost&&pressure>20;
   steering+=(input.steer-steering)*(1-Math.exp(-tune.steeringResponse*step));
   const maxSpeed=flight?(boosted?tune.flightBoost:tune.flightSpeed):(boosted?tune.groundBoost:tune.groundSpeed)*(1-.18*Math.abs(steering));
   if(input.brake)speed=Math.sign(speed)*Math.max(0,Math.abs(speed)-tune.braking*step);
   else if(input.throttle){const target=input.throttle>0?input.throttle*maxSpeed:input.throttle*tune.reverseSpeed,opposing=speed*input.throttle<0;const acceleration=opposing?tune.braking:boosted?tune.boostAcceleration:tune.acceleration;speed+=clamp(target-speed,-acceleration*step,acceleration*step);}
   else speed=Math.sign(speed)*Math.max(0,Math.abs(speed)-(flight?1.2:tune.coasting)*step);
   const radius=tune.baseRadius+tune.radiusSpeedFactor*speed*speed,yawRate=flight?(.9+Math.min(Math.abs(speed),12)*.025)*(speed<0?-1:1):speed/radius;
   const nextHeading=wrap(heading-steering*yawRate*step);
   if(valid(position,nextHeading))heading=nextHeading;
   const proposal={x:position.x+Math.sin(heading)*speed*step,y:position.y,z:position.z+Math.cos(heading)*speed*step};
   if(loopEligible()&&position.x<=LOOP.x&&proposal.x>=LOOP.x){
    const fraction=(LOOP.x-position.x)/(proposal.x-position.x),entryZ=position.z+(proposal.z-position.z)*fraction;
    loopLane=LOOP.z-entryZ;loopHeadingOffset=deltaAngle(LOOP.heading,heading);
    if((loopArmed||startLoop({others}))&&validLoopPose(playerLoopPose(0))){loopTime=0;loopBlocked=false;loopWaitSeconds=0;loopCruiseSpeed=Math.max(speed,8);const pose=playerLoopPose(0);Object.assign(position,{x:pose.x,y:pose.y,z:pose.z});heading=pose.heading;pitch=pose.pitch;roll=pose.roll;continue;}
    loopCruiseSpeed=Math.max(speed,8);speed=0;loopArmed=false;loopQueued=true;loopBlocked=true;continue;
   }
   const ground=trackSurface(proposal);
   if(flight){
    let vertical=landing?-2.8:input.lift*4.4;
    if(!landing&&!input.lift&&position.y<ground+1.25)vertical=2.2;
    proposal.y=clamp(position.y+vertical*step,ground,22);pitch+=(clamp(-speed*.009,-.15,.15)-pitch)*Math.min(1,step*5);
   }else{proposal.y=ground;const track=nearestTrack(proposal);pitch=track.distance<TRACK_WIDTH/2?track.pitch*Math.cos(deltaAngle(heading,track.heading)):0;}
   if(valid(proposal,heading,{recover:true})){Object.assign(position,proposal);}
   else {
    // Preserve safe ascent/descent when horizontal movement meets a wall, and
    // preserve horizontal steering if a roof blocks descent. Never phase inside.
    const vertical={...position,y:proposal.y},horizontal={...proposal,y:position.y};
    if(flight&&valid(vertical,heading,{recover:true}))position.y=vertical.y;
    if(flight&&valid(horizontal,heading,{recover:true})){position.x=horizontal.x;position.z=horizontal.z;}else speed*=.45;
   }
   if(flight&&landing&&position.y<=trackSurface(position)+.015){flight=false;landing=false;position.y=trackSurface(position);pitch=0;}
   // Regenerative arcade reserve keeps navigation playable; it is not a real
   // pressure/fuel model and deliberately cannot strand a player in the sky.
   pressure=clamp(pressure+step*(flight?pressure<24?2:boosted?-8:-2:boosted?-5:10),18,100);
   const track=nearestTrack(position);lapCounter.update({angle:track.progress*TAU,dt:step,track:!flight&&track.distance<TRACK_WIDTH/2-.22});
  }return snapshots();
 }
 return {update,setInput,stop,reset,toggleFlight,startLoop,startBarrelRoll,getExitPosition,getSnapshot:snapshots,
  enter(){if(active)return false;active=true;stop();return true;},
  exit({others=[]}={}){if(flight||loopTime!==null)return {ok:false,message:'Aterre para sair.',...snapshots()};const exitPosition=getExitPosition({others});if(!exitPosition)return {ok:false,message:'Encontre um espaço livre para sair.',...snapshots()};active=false;stop();return {ok:true,...snapshots(),exitPosition};},
  get active(){return active;}};
}

export function createKartTrack({scene,document:ownerDocument=globalThis.document,getObstacles=()=>[],getActors=()=>[],getFlightObstacles=()=>[],bounds=DEFAULT_BOUNDS}={}){
 if(!scene?.add)throw new TypeError('Roadster circuit needs a Three.js scene.');
 const group=new THREE.Group();group.name='Circuito Sede · Roadster Rocket';
 const geometries=new Set(),materials=new Set(),textures=new Set(),obstacles=[],batches=new Map();
 const own=g=>(geometries.add(g),g),material=(color,options={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.84,...options});materials.add(m);return m;};
 const asphalt=material('#3e484e',{side:THREE.DoubleSide}),white=material('#e8e6db'),red=material('#b34e43'),dark=material('#263139'),wood=material('#9e7956'),lamp=material('#dcf5ff',{emissive:'#c6edff',emissiveIntensity:.5});
 const cube=own(new THREE.BoxGeometry(1,1,1)),matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),s=new THREE.Vector3();
 function part(mat,p,size,yaw=0){if(!batches.has(mat))batches.set(mat,[]);batches.get(mat).push({p,size,yaw});}
 function block(x,z,w,d,id,height=1){obstacles.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2,id,height});}
 function ribbon(options,mat){const mesh=new THREE.Mesh(own(createTrackRibbon(options)),mat);mesh.receiveShadow=true;group.add(mesh);return mesh;}
 ribbon({},asphalt);for(const side of [-1,1])ribbon({width:.11,offset:side*(TRACK_WIDTH/2-.17),yOffset:.04},white);
 for(const side of [-1,1]){
  const points=Array.from({length:181},(_,i)=>{const p=loopPose(i/180);return new THREE.Vector3(p.x+p.right.x*side*LOOP.width/2+p.up.x*.055,p.y+p.right.y*side*LOOP.width/2+p.up.y*.055,p.z+p.right.z*side*LOOP.width/2+p.up.z*.055);});
  const rail=new THREE.Mesh(own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),100,.055,4,false)),red);group.add(rail);
 }
 // Open curbs mark the circuit; free driving is allowed across the campus.
 for(let i=0;i<200;i++)for(const side of [-1,1]){const p=sampleTrack(i/200,side*(TRACK_WIDTH/2+.12));if(!p.looping)part(i%2?white:red,[p.x,p.y+.045,p.z],[.25,.07,.77],p.heading);}
 part(asphalt,[35.7,.015,21.3],[9,.03,6.4]);
 const join=sampleTrack(0),joinLength=distance(PIT,join),joinHeading=Math.atan2(join.x-PIT.x,join.z-PIT.z);part(asphalt,[(PIT.x+join.x)/2,.018,(PIT.z+join.z)/2],[4,.035,joinLength+1],joinHeading);
 // The painted finish line shares progress zero with the lap checkpoints.
 for(let row=0;row<2;row++)for(let col=0;col<8;col++){
  const forward=(row-.5)*.35,side=(col-3.5)*.5;
  part((row+col)%2?white:dark,[join.x+Math.sin(join.heading)*forward+Math.cos(join.heading)*side,.06,join.z+Math.cos(join.heading)*forward-Math.sin(join.heading)*side],[.5,.02,.35],join.heading);
 }
 for(const x of [31.1,37.4])for(const z of [18.7,24]){part(wood,[x,1.55,z],[.18,3.1,.18]);block(x,z,.24,.24,'roadster-pit-post',3.1);}
 const pitCanopy=new THREE.Group();pitCanopy.name='Circuito · cobertura dos boxes';group.add(pitCanopy);const roof=new THREE.Mesh(cube,red);roof.position.set(34.25,3.15,21.3);roof.scale.set(7,.18,5.7);roof.castShadow=true;pitCanopy.add(roof);
 for(const [x,z]of [[30.8,16.5],[75.8,-22],[76.5,21.5]]){part(dark,[x,1.55,z],[.12,3.1,.12]);part(red,[x+.46,2.7,z],[.92,.55,.07]);block(x,z,.2,.2,'roadster-flag',3.1);}
 const canvas=ownerDocument?.createElement?.('canvas');if(canvas?.getContext){canvas.width=1024;canvas.height=160;const ctx=canvas.getContext('2d');if(ctx){ctx.fillStyle='#263139';ctx.fillRect(0,0,1024,160);ctx.fillStyle='#f4eddf';ctx.textAlign='center';ctx.font='600 58px sans-serif';ctx.fillText('ROADSTER · CIRCUITO SEDE',512,72);ctx.font='26px sans-serif';ctx.fillText('LOOP AUTOMÁTICO / L  ·  B: GIRO  ·  V: VOO',512,124);const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;textures.add(tex);const signMat=new THREE.MeshBasicMaterial({map:tex});materials.add(signMat);const sign=new THREE.Mesh(own(new THREE.PlaneGeometry(6.4,1)),signMat);sign.position.set(34.3,3.8,24.2);group.add(sign);}}
 for(const [mat,parts]of batches){const mesh=new THREE.InstancedMesh(cube,mat,parts.length);parts.forEach(({p,size,yaw},i)=>{matrix.compose(v.set(...p),q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,yaw),s.set(...size));mesh.setMatrixAt(i,matrix);});mesh.instanceMatrix.needsUpdate=true;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
 const controller=createKartController({bounds,getObstacles:()=>[...obstacles,...getObstacles()],getActors,getFlightObstacles}),player=createRoadster();group.add(player.group);
 const interactable={kind:'kart',name:'Pilotar Roadster',position:new THREE.Vector3()};
 const npcs=['#bd5145','#c4c9c7','#638485'].map((color,i)=>{const car=createRoadster({name:`Roadster · piloto ${i+1}`,color});group.add(car.group);return {car,progress:[.32,.56,.8][i],speed:[5.3,5.8,5.5][i],lane:[-.5,.5,0][i]};});
 function placeNpc(npc){const pose=sampleTrack(npc.progress,npc.lane);npc.car.group.position.set(pose.x,pose.y,pose.z);npc.car.group.rotation.set(pose.pitch,pose.heading,pose.roll||0,'YXZ');}
 npcs.forEach(placeNpc);
 function syncPlayer(dt=0){const value=controller.getSnapshot();player.group.position.set(value.position.x,value.position.y,value.position.z);interactable.position.copy(player.group.position);player.group.rotation.set(value.pitch,value.heading,value.roll,'YXZ');player.update(dt,{flight:value.flight||value.rolling,boost:value.rolling||keys.has('ShiftLeft')||keys.has('ShiftRight'),pressure:value.pressure});}
 function getColliders(){
  if(disposed)return [];
  return [{root:player.group,ownerId:'roadster-player'},...npcs.map((npc,i)=>({root:npc.car.group,ownerId:`roadster-npc-${i+1}`}))]
   .filter(({root})=>root.position.y<1.9).flatMap(({root,ownerId})=>chassis(root.position,root.rotation.y,ownerId));
 }
 function chassis(position,heading,ownerId){return [-1,0,1].map((offset,index)=>({id:`${ownerId}-${index}`,ownerId,x:position.x+Math.sin(heading)*offset,y:position.y,z:position.z+Math.cos(heading)*offset,radius:PLAYER_RADIUS,height:1.3}));}
 function npcColliders(){return npcs.flatMap((npc,i)=>chassis(npc.car.group.position,npc.car.group.rotation.y,`roadster-npc-${i+1}`));}
 const keys=new Set(),handlers=[],chase=createChaseCamera({getObstacles:point=>[...obstacles,...getObstacles(),...getFlightObstacles(point)],getGroundHeight:trackSurface,loop:LOOP});let disposed=false,inputEnabled=true;
 const isControl=target=>Boolean(target?.closest?.('dialog[open],input,select,textarea,button,a,[contenteditable],[role="slider"],[role="button"]'));
 const modalOpen=()=>Boolean(ownerDocument?.querySelector?.('dialog[open]'));
 const codes=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyR','KeyV','KeyE','KeyQ','ShiftLeft','ShiftRight','KeyL','KeyB']);
 function listen(target,type,handler){if(target?.addEventListener){target.addEventListener(type,handler);handlers.push([target,type,handler]);}}
 function clearInput(stop=false){keys.clear();controller.setInput({throttle:0,steer:0,brake:false,lift:0,boost:false});if(stop)controller.stop();}
 listen(ownerDocument,'keydown',event=>{if(disposed||!controller.active||!inputEnabled||modalOpen()||isControl(event.target)||event.ctrlKey||event.altKey||event.metaKey||!codes.has(event.code))return;event.preventDefault();if(['KeyR','KeyV','KeyB'].includes(event.code)){if(!event.repeat){if(event.code==='KeyR'){clearInput(true);controller.reset();chase.reset();syncPlayer();}if(event.code==='KeyV')controller.toggleFlight();if(event.code==='KeyB')controller.startBarrelRoll({others:npcColliders()});}return;}keys.add(event.code);});
 listen(ownerDocument,'keyup',event=>{keys.delete(event.code);if(controller.active&&inputEnabled&&!modalOpen()&&codes.has(event.code)&&!isControl(event.target))event.preventDefault();});
 listen(ownerDocument,'visibilitychange',()=>{if(ownerDocument.hidden)clearInput(true);});listen(ownerDocument?.defaultView,'blur',()=>clearInput(true));
 function update(dt,{running=true,camera}={}){
  if(disposed||!Number.isFinite(dt)||dt<=0)return;const step=Math.min(dt,.25);if(ownerDocument?.hidden){clearInput(true);return;}
  if(controller.active){const blocked=!inputEnabled||modalOpen()||isControl(ownerDocument?.activeElement);if(blocked)clearInput(true);
   controller.setInput({throttle:Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown')),steer:Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft')),brake:keys.has('Space'),lift:Number(keys.has('KeyE'))-Number(keys.has('KeyQ')),boost:keys.has('ShiftLeft')||keys.has('ShiftRight')});
   if(!blocked){controller.update(step,{others:npcColliders()});if(keys.has('KeyL'))controller.startLoop({others:npcColliders()});}syncPlayer(step);
   if(camera)chase.update(step,controller.getSnapshot(),camera);
  }
  if(running)for(const npc of npcs){
   const nextProgress=(npc.progress+npc.speed*step/TRACK_LENGTH)%1,next=sampleTrack(nextProgress,npc.lane);
   const nearby=[...getActors(),...npcs.filter(n=>n!==npc).flatMap(n=>chassis(n.car.group.position,n.car.group.rotation.y)),...chassis(player.group.position,player.group.rotation.y)];
   const candidate=chassis(next,next.heading);
   const blocked=candidate.some(point=>nearby.some(actor=>next.y<(actor.y??0)+(actor.height??1.8)&&next.y+1.3>(actor.y??0)&&distance(point,actor)<PLAYER_RADIUS+(actor.radius??.4)+.08));
   if(!blocked){npc.progress=nextProgress;placeNpc(npc);}npc.car.update(step);
  }
 }
 function setNight(amount){if(disposed||!Number.isFinite(amount))return;const t=clamp(amount,0,1);asphalt.emissive.setHex(0x786951);asphalt.emissiveIntensity=t*.08;lamp.emissiveIntensity=.5+t;player.setNight(t);npcs.forEach(n=>n.car.setNight(t));group.userData.nightAmount=t;}
 scene.add(group);syncPlayer();setNight(0);
 return {group,obstacles,interactable,getColliders,update,setNight,
  reset(){if(disposed)return;clearInput(true);const state=controller.reset();chase.reset();syncPlayer();return state;},
  enter(){if(disposed)return false;clearInput(true);const result=controller.enter();if(result)chase.reset();pitCanopy.visible=!controller.active;return result;},
  exit(){if(disposed)return {ok:false,message:'Circuito fechado.'};const result=controller.exit({others:npcColliders()});if(result.ok){clearInput(true);chase.release();syncPlayer();pitCanopy.visible=true;}return result;},
  getExitPosition:()=>controller.getExitPosition({others:npcColliders()}),getSnapshot:controller.getSnapshot,get active(){return controller.active;},
  setInputEnabled(value){inputEnabled=Boolean(value);if(!inputEnabled)clearInput(true);},
  dispose(){if(disposed)return;disposed=true;clearInput(true);chase.release();controller.reset();controller.exit();for(const [target,type,fn]of handlers)target.removeEventListener?.(type,fn);group.removeFromParent();player.dispose();npcs.forEach(n=>n.car.dispose());geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}
 };
}

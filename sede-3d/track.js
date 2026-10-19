import * as THREE from 'three';

const TAU = Math.PI * 2;
export const TRACK_PIT = Object.freeze({ x: 33.6, y: 0, z: 22 });
export const LOOP = Object.freeze({ x: 45, z: 23, radius: 4.7, width: 4.2, heading: Math.PI / 2, seconds: 4.2, separation: 6.6 });
export const TRACK_WIDTH = 4.4;
const points = [[40,23],[57,23],[71,21],[74,13],[69,5],[74,-4],[74,-14],[68,-21],[52,-21],[47,-13],[54,-7],[48,1],[38,-3],[34,3],[35,13]];
// Corner cutting rounds the S/hairpin before interpolation. Raw waypoints had
// a 0.74 m radius: narrower than the car could turn on this 4.4 m road.
// Four fixed passes preserve a continuous spline with a measured >=3.5 m
// centre-line radius, suitable for a deliberate ~5 m/s approach to the bends.
let rounded=points;
for(let pass=0;pass<4;pass++){
 const next=[];
 for(let i=0;i<rounded.length;i++){
  const a=rounded[i],b=rounded[(i+1)%rounded.length];
  next.push(a.map((v,j)=>v*.75+b[j]*.25),a.map((v,j)=>v*.25+b[j]*.75));
 }
 rounded=next;
}
const curve = new THREE.CatmullRomCurve3(rounded.map(([x,z]) => new THREE.Vector3(x,0,z)), true, 'centripetal');
curve.arcLengthDivisions = 4800;
const BASE_LENGTH = curve.getLength();
const wrap = value => ((value % 1) + 1) % 1;
function height(progress) { const t = (wrap(progress) - .29) / .14; return t > 0 && t < 1 ? 1.65 * Math.sin(Math.PI * t) ** 2 : 0; }
function sampleBase(progress, lane = 0) {
  const t = wrap(progress), point = curve.getPointAt(t), tangent = curve.getTangentAt(t).normalize();
  const y = height(t), dy = (height(t + .0005) - height(t - .0005)) / (.001 * BASE_LENGTH);
  return { x: point.x + tangent.z * lane, y, z: point.z - tangent.x * lane, heading: Math.atan2(tangent.x,tangent.z), pitch: -Math.atan(dy), progress: t };
}
const before = sampleBase(.94), after = sampleBase(.08), end = loopPose(1);
const v = p => new THREE.Vector3(p.x, p.y || 0, p.z);
const approach = new THREE.CubicBezierCurve3(v(before), v({ x: before.x + Math.sin(before.heading) * 2.2, z: before.z + Math.cos(before.heading) * 2.2 }), v({ x: LOOP.x - 2.2, z: LOOP.z }), v(LOOP));
const departure = new THREE.CubicBezierCurve3(v(end), v({ x: end.x + 6, z: end.z }), v({ x: after.x - Math.sin(after.heading) * 6, z: after.z - Math.cos(after.heading) * 6 }), v(after));
approach.arcLengthDivisions = departure.arcLengthDivisions = 1000;
const approachLength = approach.getLength(), departureLength = departure.getLength();
const loopSamples = Array.from({ length: 721 }, (_, i) => ({ pose: loopPose(i / 720), distance: 0, t: i / 720 }));
for (let i = 1; i < loopSamples.length; i++) loopSamples[i].distance = loopSamples[i - 1].distance + v(loopSamples[i].pose).distanceTo(v(loopSamples[i - 1].pose));
export const LOOP_LENGTH = loopSamples.at(-1).distance;
const baseRemainder = BASE_LENGTH * .86;
export const TRACK_LENGTH = approachLength + LOOP_LENGTH + departureLength + baseRemainder;
export const LOOP_RANGE = Object.freeze({ start: approachLength / TRACK_LENGTH, end: (approachLength + LOOP_LENGTH) / TRACK_LENGTH });
function loopAtDistance(metres) {
  let low = 0, high = loopSamples.length - 1;
  while (low + 1 < high) { const mid = (low + high) >> 1; if (loopSamples[mid].distance < metres) low = mid; else high = mid; }
  const a = loopSamples[low], b = loopSamples[high]; return loopPose(a.t + (b.t - a.t) * (metres - a.distance) / (b.distance - a.distance));
}
export function sampleTrack(progress, lane = 0) {
  const t = wrap(progress), metres = t * TRACK_LENGTH;
  let pose, segment;
  if (metres < approachLength) segment = { curve: approach, progress: metres / approachLength };
  else if (metres < approachLength + LOOP_LENGTH) pose = { ...loopAtDistance(metres - approachLength), looping: true };
  else if (metres < approachLength + LOOP_LENGTH + departureLength) segment = { curve: departure, progress: (metres - approachLength - LOOP_LENGTH) / departureLength };
  else pose = sampleBase(.08 + (metres - approachLength - LOOP_LENGTH - departureLength) / BASE_LENGTH);
  if (segment) { const p = segment.curve.getPointAt(segment.progress), d = segment.curve.getTangentAt(segment.progress); pose = { x: p.x, y: p.y, z: p.z, heading: Math.atan2(d.x, d.z), pitch: 0, roll: 0 }; }
  const right = pose.right || { x: Math.cos(pose.heading), y: 0, z: -Math.sin(pose.heading) };
  return { ...pose, x: pose.x + right.x * lane, y: pose.y + right.y * lane, z: pose.z + right.z * lane, progress: t, roll: pose.roll || 0 };
}
const samples = Array.from({length:1201}, (_,i) => sampleTrack(i / 1200));
export function nearestTrack(point) {
  let bestDistance=Infinity,bestProgress=0;
  for (let i=0;i<1200;i++) {
    const a=samples[i], b=samples[i+1], dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z;
    const py=point.y??0,t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(py-a.y)*dy+(point.z-a.z)*dz)/(dx*dx+dy*dy+dz*dz)));
    const x=a.x+dx*t,y=a.y+dy*t,z=a.z+dz*t,distance=Math.hypot(point.x-x,py-y,point.z-z);
    if(distance<bestDistance){bestDistance=distance;bestProgress=(i+t)/1200;}
  }
  return {...sampleTrack(bestProgress),distance:bestDistance};
}
export function trackSurface(point) { const track=nearestTrack({x:point.x,y:0,z:point.z});return !track.looping && track.distance <= TRACK_WIDTH / 2 + .15 ? track.y : 0; }
export function loopPose(t) {
  t=Math.max(0,Math.min(1,t));const angle=t*TAU;
  const forward=new THREE.Vector3(Math.cos(angle)*LOOP.radius*TAU,Math.sin(angle)*LOOP.radius*TAU,LOOP.separation*6*t*(1-t)).normalize();
  const up=new THREE.Vector3(-Math.sin(angle),Math.cos(angle),0),right=new THREE.Vector3().crossVectors(up,forward).normalize();
  const matrix=new THREE.Matrix4().makeBasis(right,up,forward),rotation=new THREE.Euler().setFromRotationMatrix(matrix,'YXZ');
  return {x:LOOP.x+Math.sin(angle)*LOOP.radius,y:(1-Math.cos(angle))*LOOP.radius,z:LOOP.z+LOOP.separation*t*t*(3-2*t),heading:rotation.y,pitch:rotation.x,roll:rotation.z,right:{x:right.x,y:right.y,z:right.z},up:{x:up.x,y:up.y,z:up.z}};
}

/** Ribbon surfaces follow the exact same path and ramp height as the controller. */
export function createTrackRibbon({start=0,end=1,width=TRACK_WIDTH,offset=0,yOffset=.025,segments=600,loop=false}={}) {
  const positions=[],indices=[];
  for(let i=0;i<=segments;i++) {
    const t=start+(end-start)*i/segments;
    if(loop) {const p=loopPose(t);for(const side of [-1,1])positions.push(p.x+p.right.x*side*width/2+p.up.x*yOffset,p.y+p.right.y*side*width/2+p.up.y*yOffset,p.z+p.right.z*side*width/2+p.up.z*yOffset);}
    else for(const side of [-1,1]) {const p=sampleTrack(t,offset+side*width/2),up=p.up||{x:0,y:1,z:0};positions.push(p.x+up.x*yOffset,p.y+up.y*yOffset,p.z+up.z*yOffset);}
    if(i<segments){const n=i*2;indices.push(n,n+2,n+1,n+1,n+2,n+3);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

export const ROADSTER_TRACK = Object.freeze({pit:TRACK_PIT,width:TRACK_WIDTH,length:TRACK_LENGTH,loop:LOOP,waypoints:points.map(([x,z])=>Object.freeze({x,z}))});

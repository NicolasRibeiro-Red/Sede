import { FLOOR_BOUNDS } from './layout.js';

const RADIUS = .25;
const EPSILON = 1e-8;
const STEP = .08;

export function isWalkable(x, z, obstacles = [], padding = RADIUS, bounds = FLOOR_BOUNDS) {
  if (![x,z,padding,bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ].every(Number.isFinite) || padding < 0) return false;
  const b = bounds;
  return x >= b.minX + padding && x <= b.maxX - padding
    && z >= b.minZ + padding && z <= b.maxZ - padding
    && !obstacles.some(o => x > o.minX - padding + EPSILON && x < o.maxX + padding - EPSILON
      && z > o.minZ - padding + EPSILON && z < o.maxZ + padding - EPSILON);
}

// Open-interior slab intersection: tangent movement along an edge is allowed.
function crossesBox(a, b, box, padding) {
  let enter = 0, exit = 1;
  for (const [start, delta, min, max] of [
    [a.x, b.x - a.x, box.minX - padding + EPSILON, box.maxX + padding - EPSILON],
    [a.z, b.z - a.z, box.minZ - padding + EPSILON, box.maxZ + padding - EPSILON],
  ]) {
    if (Math.abs(delta) < EPSILON) {
      if (start <= min || start >= max) return false;
    } else {
      let near = (min - start) / delta, far = (max - start) / delta;
      if (near > far) [near, far] = [far, near];
      enter = Math.max(enter, near);
      exit = Math.min(exit, far);
      if (enter >= exit) return false;
    }
  }
  return exit > EPSILON && enter < 1 - EPSILON;
}

/** Strict collision test for a complete path edge, including both endpoint bounds. */
export function segmentClear(a, b, obstacles = [], padding = RADIUS, actors = [], bounds = FLOOR_BOUNDS) {
  return checkSegment(a,b,obstacles,padding,actors,bounds,false);
}

function checkSegment(a,b,obstacles,padding,actors,bounds,allowActorEscape) {
  if (!isWalkable(a.x,a.z,obstacles,padding,bounds) || !isWalkable(b.x,b.z,obstacles,padding,bounds)
    || obstacles.some(o => crossesBox(a,b,o,padding))) return false;
  const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
  return actors.every(actor => {
    if (![actor.x, actor.z, actor.radius].every(Number.isFinite) || actor.radius <= 0) return true;
    const ax=a.x-actor.x,az=a.z-actor.z,radius=actor.radius+padding;
    const initial2=ax*ax+az*az;
    if(allowActorEscape && initial2 < (radius-EPSILON)**2) {
      // A walking agent may overlap us between frames. Only a continuous move
      // away from its centre is allowed; no snapping through another collider.
      return ax*dx+az*dz>=-EPSILON && (b.x-actor.x)**2+(b.z-actor.z)**2>initial2+EPSILON;
    }
    const t = length2 ? Math.max(0, Math.min(1, ((actor.x - a.x) * dx + (actor.z - a.z) * dz) / length2)) : 0;
    return Math.hypot(a.x + t * dx - actor.x, a.z + t * dz - actor.z) >= radius - EPSILON;
  });
}

/** Actors supply their own radius; the visitor radius is added here. No input is mutated. */
export function moveWithCollision(position, dx, dz, obstacles = [], actors = [], bounds = FLOOR_BOUNDS, padding = RADIUS) {
  if (![position.x, position.z, dx, dz].every(Number.isFinite)) throw new TypeError('Movement coordinates must be finite.');
  let p = {x: position.x, z: position.z};
  // A closed door or new object must never trigger a recovery teleport through a wall.
  if (!isWalkable(p.x,p.z,obstacles,padding,bounds)) return p;
  const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / STEP));
  const sx = dx / count, sz = dz / count;
  for (let i = 0; i < count; i++) {
    const full = {x: p.x + sx, z: p.z + sz};
    if (checkSegment(p,full,obstacles,padding,actors,bounds,true)) p = full;
    else {
      const alongX = {x: p.x + sx, z: p.z};
      if (Math.abs(sx)>EPSILON && checkSegment(p,alongX,obstacles,padding,actors,bounds,true)) p=alongX;
      const alongZ = {x: p.x, z: p.z + sz};
      if (Math.abs(sz)>EPSILON && checkSegment(p,alongZ,obstacles,padding,actors,bounds,true)) p=alongZ;
    }
  }
  return p;
}

/** Small A* floor grid. Both endpoint connectors and every grid edge are collision checked. */
export function findPath(start, end, obstacles = [], padding = .28, bounds = FLOOR_BOUNDS) {
  if (!isWalkable(start.x,start.z,obstacles,padding,bounds) || !isWalkable(end.x,end.z,obstacles,padding,bounds)) return null;
  if (segmentClear(start,end,obstacles,padding,[],bounds)) return [{x:start.x,z:start.z}, {x:end.x,z:end.z}];
  const b=bounds,spacing=.3;
  const minX = b.minX + padding, minZ = b.minZ + padding;
  const nx = Math.floor((b.maxX - padding - minX) / spacing) + 1;
  const nz = Math.floor((b.maxZ - padding - minZ) / spacing) + 1;
  // Avoid allocating an unbounded grid if a caller accidentally supplies an enormous world.
  if(nx<1||nz<1||nx*nz>60000)return null;
  const nodes = Array.from({length:nx*nz}, (_, id) => {
    const gx = id % nx, gz = Math.floor(id / nx), x = minX + gx*spacing, z = minZ + gz*spacing;
    return {id,gx,gz,x,z,valid:isWalkable(x,z,obstacles,padding,bounds),g:Infinity,f:Infinity,parent:null};
  });
  const connector = point => nodes.filter(n => n.valid && Math.hypot(n.x-point.x,n.z-point.z) < spacing*3)
    .sort((a,c)=>Math.hypot(a.x-point.x,a.z-point.z)-Math.hypot(c.x-point.x,c.z-point.z))
    .find(n=>segmentClear(point,n,obstacles,padding,[],bounds));
  const first = connector(start), last = connector(end);
  if (!first || !last) return null;
  first.g = 0; first.f = Math.hypot(first.x-last.x,first.z-last.z);
  // Binary heap keeps exterior searches from repeatedly sorting thousands of nodes.
  const open=[],closed=new Set();
  function enqueue(node){
    const entry={node,g:node.g,f:node.f};let index=open.length;open.push(entry);
    while(index>0){const parent=(index-1)>>1;if(open[parent].f<=entry.f)break;open[index]=open[parent];index=parent;}
    open[index]=entry;
  }
  function dequeue(){
    const firstEntry=open[0],lastEntry=open.pop();
    if(open.length){let index=0;while(true){let child=index*2+1;if(child>=open.length)break;if(child+1<open.length&&open[child+1].f<open[child].f)child++;if(open[child].f>=lastEntry.f)break;open[index]=open[child];index=child;}open[index]=lastEntry;}
    return firstEntry;
  }
  enqueue(first);
  while (open.length) {
    const entry=dequeue(),current=entry.node;
    if(closed.has(current.id)||entry.g!==current.g)continue;
    if (current === last) {
      const path = [{x:end.x,z:end.z}];
      for (let n=last;n;n=n.parent) path.push({x:n.x,z:n.z});
      path.push({x:start.x,z:start.z});
      return path.reverse();
    }
    closed.add(current.id);
    for (let dz=-1;dz<=1;dz++) for(let dx=-1;dx<=1;dx++) {
      if (!dx&&!dz) continue;
      const x=current.gx+dx,z=current.gz+dz;
      if(x<0||z<0||x>=nx||z>=nz) continue;
      const next=nodes[z*nx+x];
      if (!next.valid || closed.has(next.id) || !segmentClear(current,next,obstacles,padding,[],bounds)) continue;
      const g=current.g+Math.hypot(dx,dz)*spacing;
      if(g>=next.g) continue;
      next.g=g; next.f=g+Math.hypot(next.x-last.x,next.z-last.z); next.parent=current;
      enqueue(next);
    }
  }
  return null;
}

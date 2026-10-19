import {findPath,isWalkable,moveWithCollision,segmentClear} from './navigation.js';
import {FLOOR_BOUNDS} from './layout.js';

const LABELS={work:'Estação de trabalho',coffee:'Café',meeting:'Sala de reunião',rest:'Área de descanso','rest-coffee':'Café da pausa'};
const WORK_POINTS=[{x:-8.3,z:-5.48},{x:8.3,z:-5.48},{x:-4.8,z:-5.48},{x:4.8,z:-5.48}];
const TOOLS=[
 {id:'browser',label:'Navegador',icon:'⌕',step:'Pesquisar referências',skill:'Pesquisa de referências'},
 {id:'drive',label:'Drive MCP',icon:'▱',step:'Reunir contexto no Drive',skill:'Organização de contexto'},
 {id:'gemini',label:'Gemini',icon:'◇',step:'Explorar uma imagem',skill:'Exploração visual'},
 {id:'sheets',label:'Planilha',icon:'▦',step:'Comparar opções',skill:'Análise de alternativas'},
 {id:'review',label:'Revisão',icon:'✧',step:'Revisar a entrega',skill:'Revisão de qualidade'},
];
const TITLES=[
 'Explorar a identidade da sede','Validar a navegação do espaço','Planejar as próximas entregas','Organizar referências do projeto',
 'Criar a linguagem de ícones','Escrever os avisos do espaço','Revisar textos e estados','Pesquisar referências de ambientes',
 'Validar os percursos dos agentes','Desenhar rotinas de automação','Comparar consumo por atividade','Revisar colisões e acessibilidade',
 'Sintetizar referências de produto','Comparar cenários de evolução','Organizar prioridades do time','Consolidar indicadores do teste',
];
const statusClip=status=>status==='waiting'?'idle':status;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const roomAt=point=>Math.abs(point.x)<2.25?null:point.x<0?(point.z<0?'studio':'meeting'):(point.z<0?'engineering':'lounge');
const peerBox=peer=>({minX:peer.x-peer.radius,maxX:peer.x+peer.radius,minZ:peer.z-peer.radius,maxZ:peer.z+peer.radius});

/** Deterministic local simulation. Tokens, tasks, tools and cost are illustrative, never API usage. */
export function createLife({actors,office,floorId=0,getVisitor=()=>null,getOutdoorObstacles=()=>[],getOutdoorActors=()=>[],outdoorBounds,restSpots=[]}){
 if(!actors?.agents?.length||!Array.isArray(office?.staticObstacles)||typeof office.getObstacles!=='function')throw new TypeError('Life requires actors and a navigable office.');
 let clock=0,serial=0,running=true,disposed=false,corridorOwner=null;
 const reservations=new Map(),managedDoors=new Map(),stationStates=new Map(),seatReservations=new Map();
 const outdoorEnabled=floorId===0&&restSpots.length>0;
 const movementBounds=outdoorEnabled?(outdoorBounds||{minX:-32,maxX:32,minZ:-30,maxZ:34}):FLOOR_BOUNDS;
 const seats=outdoorEnabled?restSpots.map((spot,index)=>({id:spot.id||`park-seat-${index}`,yaw:0,seatY:.48,...spot})): [{id:'sofa-left',x:4.15,z:6.35,yaw:Math.PI,seatY:.7},{id:'sofa-right',x:5.85,z:6.35,yaw:Math.PI,seatY:.7}];
 const floorSeed=[...String(floorId)].reduce((sum,char)=>sum+char.charCodeAt(0),0);
 const entries=actors.agents.map((agent,index)=>({agent,index,id:agent.id,radius:agent.radius+.025,speed:1.1+((index+floorSeed)%4)*.1,status:'idle',paused:false,path:[],target:null,destination:'work',pending:null,retryAt:0,requestedAt:0,remaining:0,duration:0,workElapsed:0,workStarted:false,workDone:false,cycles:0,tokens:0,completedTasks:0,blockedTime:0,nextReplan:0,enteredCorridor:false,activity:'',waitingForTask:false,restPhase:null,restSpot:null,restAutomatic:false,seatAccess:false}));
 const initialObstacles=office.getObstacles();
 const doorSizes=new Map((office.doors||[]).map(door=>{const box=initialObstacles.find(box=>box.id===`door-${door.id}`);return [door.id,box?{x:(box.maxX-box.minX)/2,z:(box.maxZ-box.minZ)/2}:door.id==='entrance'?{x:1.3,z:.11}:{x:.095,z:1}];}));

 function visitorCollider(){const visitor=getVisitor();return visitor&&[visitor.x,visitor.z,visitor.radius].every(Number.isFinite)&&visitor.radius>0?visitor:null;}
 function occupants(){
  const visitor=visitorCollider(),radii=new Map((actors.getColliders?.()||[]).map(collider=>[collider.id,collider.radius]));
  return [...entries.map(entry=>({id:entry.id,x:entry.agent.position.x,z:entry.agent.position.z,radius:Math.max(entry.radius,radii.get(entry.id)||0)})),...(visitor?[visitor]:[]),...(outdoorEnabled?getOutdoorActors():[])];
 }
 function peers(entry){return occupants().filter(peer=>peer.id!==entry.id);}
 const outside=point=>outdoorEnabled&&(Math.abs(point.x)>10.72||point.z>7.72||point.z< -7.72);
 const areaAt=point=>outside(point)?'exterior':roomAt(point);
 function pathBetween(entry,start,end,obstacles,other,bounds){
  // Use the same circular people volumes as movement, including connectors.
  // A square around a person can falsely seal a doorway or reject a nearby start.
  if(segmentClear(start,end,obstacles,entry.radius,other,bounds))return [{x:start.x,z:start.z},{x:end.x,z:end.z}];
  const nearby=other.filter(peer=>peer.x+peer.radius+entry.radius>=bounds.minX&&peer.x-peer.radius-entry.radius<=bounds.maxX&&peer.z+peer.radius+entry.radius>=bounds.minZ&&peer.z-peer.radius-entry.radius<=bounds.maxZ);
  const squarePath=findPath(start,end,[...obstacles,...nearby.map(peerBox)],entry.radius,bounds);
  if(squarePath)return squarePath;
  // Reuse the bounded A* with a conservative staircase around each forbidden
  // circle. Static boxes are expanded once; every band encloses the true disk.
  const expanded=obstacles.map(box=>({minX:box.minX-entry.radius,maxX:box.maxX+entry.radius,minZ:box.minZ-entry.radius,maxZ:box.maxZ+entry.radius}));
  for(const peer of nearby){
   const radius=peer.radius+entry.radius,bands=48;
   for(let i=0;i<bands;i++){
    const low=-radius+2*radius*i/bands,high=-radius+2*radius*(i+1)/bands;
    const closest=low<=0&&high>=0?0:Math.min(Math.abs(low),Math.abs(high)),half=Math.sqrt(Math.max(0,radius*radius-closest*closest));
    expanded.push({minX:peer.x-half,maxX:peer.x+half,minZ:peer.z+low-1e-7,maxZ:peer.z+high+1e-7});
   }
  }
  const inset={minX:bounds.minX+entry.radius,maxX:bounds.maxX-entry.radius,minZ:bounds.minZ+entry.radius,maxZ:bounds.maxZ-entry.radius};
  const path=findPath(start,end,expanded,0,inset);
  return path&&path.slice(1).every((point,index)=>segmentClear(path[index],point,obstacles,entry.radius,other,bounds))?path:null;
 }
 function solids(entry,dynamic=false){
  let result=[...(dynamic?office.getObstacles():office.staticObstacles),...(outdoorEnabled?getOutdoorObstacles():[])];
  if(!outdoorEnabled&&entry?.seatAccess){
   // Assigned occupants may approach the cushion; the sofa back and arms stay solid.
   result=result.filter(box=>box.id!=='sofa');
   result.push({minX:3.17,maxX:6.83,minZ:7.13,maxZ:7.4,id:'sofa-back'},...[[3.17,3.41],[6.59,6.83]].map(([minX,maxX])=>({minX,maxX,minZ:6.1,maxZ:7.4,id:'sofa-arm'})));
  }
  return result;
 }
 function freePoint(preferred,radius,entry){
  const obstacles=solids(entry);
  if(isWalkable(preferred.x,preferred.z,obstacles,radius,movementBounds))return {...preferred};
  for(let ring=.15;ring<=1.5;ring+=.15)for(let i=0;i<16;i++){const angle=i*Math.PI/8,point={x:preferred.x+Math.cos(angle)*ring,z:preferred.z+Math.sin(angle)*ring};if(isWalkable(point.x,point.z,obstacles,radius,movementBounds))return point;}
  throw new Error(`No safe activity point near ${preferred.x}, ${preferred.z}.`);
 }
 function pathFor(entry,target,obstacles,other){
  const start=entry.agent.position,stages=[];
  const gateway=z=>{for(const dz of [0,-.8,.8])for(const x of [0,-.9,.9]){const point={x,z:z+dz};if(segmentClear(point,point,obstacles,entry.radius,other,movementBounds))return point;}return {x:0,z};};
  // Bench backs form a continuous row: approach its open front, never attempt
  // to squeeze through the half-metre gaps between occupied seats.
  if(outdoorEnabled&&entry.destination==='rest')stages.push({x:-20,z:16.7},{x:target.x,z:16.7});
  else if(outdoorEnabled&&outside(start)&&start.x< -5&&start.z>13.5&&['work','rest-coffee'].includes(entry.destination))stages.push({x:start.x,z:16.7},{x:entry.destination==='work'?0:-20,z:16.7});
  if(outdoorEnabled&&outside(start)!==outside(target))stages.push(...(outside(start)?[gateway(10.7),gateway(5.5)]:[gateway(5.5),gateway(10.7)]));
  stages.push(target);let previous=start;const route=[{x:start.x,z:start.z}];
  for(const end of stages){
   const exterior=outdoorEnabled&&(outside(previous)||outside(end));
   const bounds=exterior?{minX:Math.max(movementBounds.minX,Math.min(previous.x,end.x)-2.5),maxX:Math.min(movementBounds.maxX,Math.max(previous.x,end.x)+2.5),minZ:Math.max(movementBounds.minZ,Math.min(previous.z,end.z)-2.5),maxZ:Math.min(movementBounds.maxZ,Math.max(previous.z,end.z)+2.5)}:FLOOR_BOUNDS;
   const relevant=obstacles.filter(box=>box.maxX>=bounds.minX-entry.radius&&box.minX<=bounds.maxX+entry.radius&&box.maxZ>=bounds.minZ-entry.radius&&box.minZ<=bounds.maxZ+entry.radius);
   const segment=pathBetween(entry,previous,end,relevant,other,bounds);if(!segment)return null;route.push(...segment.slice(1));previous=end;
  }
  return route;
 }
 function reserveSeat(entry){
  if(entry.restSpot)return true;
  for(let offset=0;offset<seats.length;offset++){const seat=seats[(entry.index+offset)%seats.length];if(seatReservations.has(seat.id))continue;seatReservations.set(seat.id,entry.id);entry.restSpot=seat;return true;}return false;
 }
 function releaseSeat(entry){if(entry.restSpot&&seatReservations.get(entry.restSpot.id)===entry.id)seatReservations.delete(entry.restSpot.id);entry.restSpot=null;}
 function beginRest(entry,manual){
  entry.waitingForTask=manual;entry.restAutomatic=!manual;entry.restPhase='going';reserveSeat(entry);request(entry,'rest-coffee');
 }
 function targetFor(entry,kind){
  if(kind==='rest'){const point=entry.restSpot;if(!point)return null;return {...point,roomId:outdoorEnabled?'exterior':'lounge'};}
  if(kind==='rest-coffee'){const preferred=outdoorEnabled?{x:-19.4,z:12.9}:{x:8.45,z:5.7};return {...freePoint(preferred,entry.radius,entry),roomId:outdoorEnabled?'exterior':'lounge',yaw:Math.PI/2};}
  const preferred=kind==='work'?WORK_POINTS[entry.index%WORK_POINTS.length]:kind==='coffee'?{x:8.45,z:5.7}:{x:-8.4,z:1.2};
  const point=freePoint(preferred,entry.radius,entry);return {...point,roomId:roomAt(point),yaw:kind==='work'?Math.PI:kind==='coffee'?Math.PI/2:0};
 }
 function clip(entry,status){if(entry.agent.state!=='waving'&&entry.agent.state!==statusClip(status))actors.setAgentState(entry.id,statusClip(status));}
 function taskFor(entry){
  const phase=Math.min(TOOLS.length-1,Math.floor(entry.workElapsed/Math.max(1,entry.duration)*TOOLS.length));
  const tool=TOOLS[phase];return {title:`${TITLES[(floorSeed%4)*4+entry.index%4]} · ${entry.completedTasks+(entry.workDone?0:1)}`,skill:tool.skill,tool:{id:tool.id,label:tool.label,icon:tool.icon},steps:TOOLS.map((step,index)=>({label:step.step,state:!entry.workStarted?'pending':entry.workDone||index<phase?'done':index===phase?'active':'pending'})),simulated:true};
 }
 function activity(entry){
  let label,detail='Atividade simulada · sem conexão externa';
  if(entry.agent.root.userData.peaceBehavior){actors.setActivity?.(entry.id,{label:'! Procurando a paz',detail:'Reação temporária · a tarefa será retomada'});entry.activity='';return;}
  const status=!running||entry.paused?'paused':entry.agent.state==='waving'?'waving':entry.status;
  if(status==='working'){const task=taskFor(entry);label=`${task.tool.icon} ${task.tool.label}`;detail=`Simulação · ${task.skill}`;}
  else label={walking:entry.restPhase?'↗ Indo descansar':'↗ Caminhando',coffee:'☕ Pausa café',resting:entry.waitingForTask?'☕ Aguardando tarefa':'☕ Descansando',waiting:entry.waitingForTask?'· Esperando lugar':'· Aguardando',paused:'Ⅱ Pausado',waving:'↝ Acenando',idle:entry.destination==='meeting'?'◇ Em reunião':'· Disponível'}[status]||'· Disponível';
  if(entry.activity!==label){entry.activity=label;actors.setActivity?.(entry.id,{label,detail});}
 }
 function releaseReservation(entry){for(const [resource,owner] of reservations)if(owner===entry.id)reservations.delete(resource);}
 function request(entry,kind){
  if(!Object.hasOwn(LABELS,kind))throw new RangeError(`Unknown destination: ${kind}`);
  entry.peaceResume=null;
  releaseReservation(entry);entry.destination=kind;entry.pending=kind;entry.path=[];entry.target=null;entry.retryAt=clock;entry.requestedAt=++serial;entry.status='waiting';entry.blockedTime=0;
  if(corridorOwner===entry.id&&(Math.abs(entry.agent.position.x)>2.25+entry.radius+.2||entry.agent.position.z>10.2)){corridorOwner=null;entry.enteredCorridor=false;}
  if(!entry.paused)clip(entry,'waiting');
 }
 function plan(entry){
  if(entry.agent.root.userData.peaceBehavior||!entry.pending||entry.paused||entry.agent.state==='waving'||clock<entry.retryAt)return;
  const kind=entry.pending;if((kind==='rest'||kind==='rest-coffee')&&!reserveSeat(entry)){entry.retryAt=clock+1;return;}
  if(kind==='rest'&&!outdoorEnabled)entry.seatAccess=true;
  const resource=kind==='work'?`work:${entry.id}`:kind==='rest'?`seat:${entry.restSpot.id}`:kind==='rest-coffee'&&!outdoorEnabled?'coffee':kind,owner=reservations.get(resource);
  if(owner&&owner!==entry.id){entry.retryAt=clock+.6;return;}
  const target=targetFor(entry,kind),other=peers(entry);
  const crossing=target.roomId!==areaAt(entry.agent.position);
  // Reserve a crossing before leaving the room, keeping waiting avatars away
  // from door apertures rather than creating opposing queues inside the hall.
  if(crossing&&corridorOwner&&corridorOwner!==entry.id){entry.retryAt=clock+.5;return;}
  // Waiting at a real destination prevents stacking even if its reservation just changed.
  if(other.some(peer=>distance(target,peer)<entry.radius+peer.radius+.04)){entry.retryAt=clock+.8;return;}
  const path=pathFor(entry,target,solids(entry),other);
  if(!path){entry.retryAt=clock+1.5;return;}
  reservations.set(resource,entry.id);if(crossing)corridorOwner=entry.id;entry.pending=null;entry.target=target;entry.path=path.slice(1);entry.status='walking';entry.blockedTime=0;entry.nextReplan=clock+1.5;clip(entry,'walking');
  if(distance(entry.agent.position,target)<.08)arrive(entry);
 }
 function arrive(entry){
  entry.path=[];entry.agent.root.rotation.y=entry.target.yaw;entry.agent.roomId=entry.target.roomId;entry.blockedTime=0;
  if(corridorOwner===entry.id){corridorOwner=null;entry.enteredCorridor=false;}
  if(entry.peaceResume){Object.assign(entry,entry.peaceResume);entry.peaceResume=null;clip(entry,entry.status);return;}
  if(entry.destination==='work'){
   entry.status='working';entry.duration=12+((entry.index*5+floorSeed+entry.cycles*7)%14);entry.remaining=entry.duration;entry.workElapsed=0;entry.workStarted=true;entry.workDone=false;entry.restPhase=null;entry.restAutomatic=false;entry.seatAccess=false;actors.setRestState?.(entry.id,{holdingCup:false});
  }else if(entry.destination==='rest-coffee'){
   entry.status='coffee';entry.restPhase='coffee';entry.remaining=3.5+entry.index*.45;entry.duration=entry.remaining;actors.setRestState?.(entry.id,{holdingCup:true});if(!outdoorEnabled)office.brewCoffee?.();
  }else if(entry.destination==='rest'){
   entry.status='resting';entry.restPhase='seated';entry.duration=15+((entry.index*3+entry.cycles)%11);entry.remaining=entry.waitingForTask?Infinity:entry.duration;actors.setRestState?.(entry.id,{holdingCup:true,seatHeight:entry.restSpot.seatY});
  }else if(entry.destination==='coffee'){entry.status='coffee';entry.duration=5+((entry.index+floorSeed+entry.cycles)%5);entry.remaining=entry.duration;office.brewCoffee?.();}
  else {entry.status='idle';entry.duration=6+((entry.index+entry.cycles)%4);entry.remaining=entry.duration;office.setStationActive?.('meeting',true);}
  clip(entry,entry.status);
 }
 // Surround the complete expanded aperture, including corners and door axis.
 // The old fixed Z sensor trapped wide avatars before they could open the door.
 function doorNeeded(door,entry){const half=doorSizes.get(door.id);return entry.path.length>0&&!entry.paused&&Math.abs(entry.agent.position.x-door.position.x)<half.x+entry.radius+.65&&Math.abs(entry.agent.position.z-door.position.z)<half.z+entry.radius+.65;}
 function manageDoors(){
  const people=occupants();
  for(const door of office.doors||[]){
   if(entries.some(entry=>doorNeeded(door,entry))){
    if(!door.targetOpen){const result=office.toggleDoor(door.id,people);if(result?.ok)managedDoors.set(door.id,clock);}
    if(managedDoors.has(door.id))managedDoors.set(door.id,clock);
   }else if(managedDoors.has(door.id)&&clock-managedDoors.get(door.id)>1.2){
    const half=doorSizes.get(door.id),near=people.some(person=>Math.abs(person.x-door.position.x)<half.x+person.radius+.25&&Math.abs(person.z-door.position.z)<half.z+person.radius+.25);
    if(!near&&door.targetOpen){const result=office.toggleDoor(door.id,people);if(result?.ok)managedDoors.delete(door.id);}
   }
  }
 }
 function advance(entry,dt){
  if(!entry.path.length||!entry.target)return;
  const position=entry.agent.position;
  while(entry.path.length>1&&distance(position,entry.path[0])<.08)entry.path.shift();
  // Skip grid corners only when the whole segment has clearance for this avatar.
  if(entry.seatAccess&&entry.destination!=='rest'&&position.z<5.5)entry.seatAccess=false;
  const obstacles=solids(entry,true),other=peers(entry);
  for(let i=Math.min(entry.path.length-1,14);i>0;i--)if(segmentClear(position,entry.path[i],obstacles,entry.radius,other,movementBounds)){entry.path.splice(0,i);break;}
  const next=entry.path[0],dx=next.x-position.x,dz=next.z-position.z,length=Math.hypot(dx,dz),step=Math.min(length,entry.speed*dt);
  if(length<.025){entry.path.shift();if(!entry.path.length)arrive(entry);return;}
  const proposed={x:position.x+dx/length*step,z:position.z+dz/length*step};
  const needsCorridor=entry.target.roomId!==areaAt(position)||Math.abs(position.x)<2.3+entry.radius;
  const corridorEdge=2.25+entry.radius+.18;
  if(needsCorridor&&Math.abs(proposed.x)<corridorEdge&&proposed.z<10.2){
   if(corridorOwner&&corridorOwner!==entry.id){entry.status='waiting';clip(entry,'waiting');return;}
   corridorOwner=entry.id;
  }
  const moved=moveWithCollision(position,dx/length*step,dz/length*step,obstacles,other,movementBounds,entry.radius);
  const progress=distance(position,moved);
  if(progress>.0001){
   position.x=moved.x;position.z=moved.z;entry.status='walking';entry.blockedTime=0;clip(entry,'walking');
   const desired=Math.atan2(dx,dz),delta=((desired-entry.agent.root.rotation.y+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;entry.agent.root.rotation.y+=delta*Math.min(1,dt*8);
   if(corridorOwner===entry.id){
    if(Math.abs(position.x)<2.25+entry.radius*.5)entry.enteredCorridor=true;
    // Only an outbound crossing releases the entrance once outside. A returning
    // agent already owns its approach from the garden until it reaches its room;
    // releasing merely because it is still outside creates opposing door queues.
    if(position.z>10.2&&entry.target.roomId==='exterior'){corridorOwner=null;entry.enteredCorridor=false;}
   }
   if(distance(position,entry.target)<.045)arrive(entry);
  }else{
   entry.blockedTime+=dt;entry.status='waiting';clip(entry,'waiting');
   if(entry.blockedTime>1.3&&clock>=entry.nextReplan){
    // Dynamic peers may have stopped in the old path. Replan at most once every 2 seconds.
    const path=pathFor(entry,entry.target,solids(entry),other);if(path)entry.path=path.slice(1);entry.nextReplan=clock+2;
   }
  }
 }
 function updateStations(){
  for(const room of ['studio','engineering']){
   const active=running&&entries.some(entry=>!entry.agent.root.userData.peaceBehavior&&!entry.paused&&entry.status==='working'&&entry.target?.roomId===room);
   if(stationStates.get(room)!==active){stationStates.set(room,active);office.setStationActive?.(room,active);}
  }
 }
 function update(dt){
  if(disposed||!Number.isFinite(dt)||dt<=0)return;
  if(!running){for(const entry of entries)activity(entry);return;}
  const step=Math.min(dt,.2);clock+=step;
  for(const entry of [...entries].sort((a,b)=>a.requestedAt-b.requestedAt))plan(entry);
  manageDoors();
  for(const entry of [...entries].sort((a,b)=>(b.id===corridorOwner)-(a.id===corridorOwner))){
   if(entry.agent.root.userData.peaceBehavior||entry.paused||entry.agent.state==='waving'){activity(entry);continue;}
   if(entry.path.length)advance(entry,step);
   else if(!entry.pending&&entry.remaining>0){
    const consumed=Math.min(entry.remaining,step);entry.remaining-=consumed;
    if(entry.status==='working'){entry.tokens+=consumed*(18+entry.index*3);entry.workElapsed+=consumed;}
    if(entry.remaining<=1e-8){
     if(entry.status==='working'){entry.completedTasks++;entry.workDone=true;entry.cycles++;if(outdoorEnabled)beginRest(entry,false);else request(entry,entry.cycles%2?'coffee':'meeting');}
     else if(entry.destination==='rest-coffee'){entry.restPhase='going';request(entry,'rest');}
     else if(entry.destination==='rest'){releaseSeat(entry);entry.restPhase='returning';actors.setRestState?.(entry.id,{holdingCup:false});request(entry,'work');}
     else request(entry,'work');
    }
   }
   activity(entry);
  }
  updateStations();
 }
 function getSnapshot(){return entries.map(entry=>({id:entry.id,name:entry.agent.name,floorId,status:!running||entry.paused?'paused':entry.agent.root.userData.peaceBehavior?'reacting':entry.agent.state==='waving'?'waving':entry.status,destination:LABELS[entry.destination],waitingForTask:entry.waitingForTask,restPhase:entry.restPhase,restSeat:entry.restSpot?.id||null,tokens:Math.floor(entry.tokens+1e-7),cost:Math.floor(entry.tokens+1e-7)*2/1e6,completedTasks:entry.completedTasks,task:taskFor(entry),simulated:true}));}
 function setPaused(id,value){
  const entry=entries.find(entry=>entry.id===id);if(!entry||disposed)return false;entry.paused=Boolean(value);
  if(entry.paused){
   // A paused avatar still inside its room must not hold a future corridor or
   // coffee reservation. Resume replans and reacquires both without teleporting.
   if(entry.path.length&&Math.abs(entry.agent.position.x)>2.25+entry.radius+.25)request(entry,entry.destination);
   actors.setAgentState(id,'paused');
  }else if(running)clip(entry,entry.path.length?'walking':entry.status);
  activity(entry);updateStations();return true;
 }
 function setWaiting(id,value){
  const entry=entries.find(entry=>entry.id===id);if(!entry||disposed)return false;
  if(value){if(entry.waitingForTask)return true;if(entry.restPhase==='seated'){entry.waitingForTask=true;entry.restAutomatic=false;entry.remaining=Infinity;}else beginRest(entry,true);}
  else{entry.waitingForTask=false;entry.restAutomatic=false;releaseSeat(entry);entry.restPhase='returning';actors.setRestState?.(entry.id,{holdingCup:false});request(entry,'work');}
  if(!entry.paused&&running)plan(entry);activity(entry);updateStations();return true;
 }
 function sendTo(id,kind){const entry=entries.find(entry=>entry.id===id);if(!entry||disposed)return false;if(kind==='rest')return setWaiting(id,true);if(entry.waitingForTask||entry.restPhase){entry.waitingForTask=false;entry.restAutomatic=false;releaseSeat(entry);entry.restPhase=kind==='work'?'returning':null;actors.setRestState?.(entry.id,{holdingCup:false});}request(entry,kind);if(!entry.paused&&running)plan(entry);activity(entry);return true;}
 function setRunning(value){if(disposed)return;running=Boolean(value);for(const entry of entries){if(!running)actors.setAgentState(entry.id,'paused');else if(!entry.paused)clip(entry,entry.path.length?'walking':entry.status);activity(entry);}if(!running)for(const room of ['studio','engineering']){stationStates.set(room,false);office.setStationActive?.(room,false);}else updateStations();}
 function dispose(){disposed=true;reservations.clear();managedDoors.clear();seatReservations.clear();}

 // Two work immediately, one crosses rooms, and one walks toward the coffee station.
 for(const entry of entries){
  if(entry.index<2){entry.target=targetFor(entry,'work');entry.agent.position.x=entry.target.x;entry.agent.position.z=entry.target.z;reservations.set(`work:${entry.id}`,entry.id);arrive(entry);}
  else{
   const preferred=entry.index===3?{x:7.3,z:3.3}:entry.index===2?{x:0,z:3.8}:entry.agent.position,safe=freePoint(preferred,entry.radius);entry.agent.position.x=safe.x;entry.agent.position.z=safe.z;request(entry,entry.index===3?'coffee':'work');plan(entry);
  }
  activity(entry);
 }
 updateStations();
 function getPeaceBindings(){return entries.map(entry=>({
  id:entry.agent.root.uuid,root:entry.agent.root,model:entry.agent.model,radius:entry.radius,bounds:movementBounds,launchHeight:.62,
  getPosition:()=>entry.agent.position.clone(),setPosition:p=>{entry.agent.position.x=p.x;entry.agent.position.z=p.z;},setYaw:y=>{entry.agent.root.rotation.y=y;},
  getObstacles:()=>solids(entry,true),getActors:()=>peers(entry),
  canMove:()=>!entry.paused&&entry.restPhase!=='seated'&&Math.abs(entry.agent.position.x)>2.8&&entry.agent.position.z<7.2,
  begin:()=>!disposed&&running,
  end:()=>{if(entry.path.length||entry.pending){entry.path=[];entry.pending=entry.destination;entry.retryAt=clock;}else if(entry.target&&distance(entry.agent.position,entry.target)>.12){entry.peaceResume={remaining:entry.remaining,duration:entry.duration,status:entry.status};entry.status='waiting';entry.path=[];entry.pending=entry.destination;entry.retryAt=clock;}clip(entry,entry.paused?'paused':entry.path.length?'walking':entry.status);activity(entry);}
 }));}
 return {update,getSnapshot,setPaused,setWaiting,sendTo,setRunning,dispose,getPeaceBindings};
}

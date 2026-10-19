import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createOffice} from './office.js?v=20261019-ced1';
import {createPlayerDrink} from './player-drink.js?v=20261019-beta3';
import {createWorld} from './world.js?v=20261019-ced1';
import {createDayCycle} from './day-cycle.js';
import {createSky} from './sky.js';
import {createAtmosphere} from './atmosphere.js?v=20261019-2';
import {createParkPeople} from './park-people.js?v=20261019-beta1';
import {createCampusGround} from './campus-ground.js';
import {createCampusPub} from './campus-pub.js?v=20261019-beta2';
import {createKartTrack} from './kart.js?v=20261019-maneuvers3';
import {createAirTraffic} from './air-traffic.js?v=20261019-beta1';
import {createActors,CUSTOMIZATION_OPTIONS} from './actors.js?v=20261019-beta1';
import {createActorPortraits} from './portraits.js?v=20261019-qa2';
import {createTaskComposer} from './task-composer.js?v=20261019-qa2';
import {createCustomizationPanel} from './customization.js?v=20261019-1';
import {createLife} from './life.js?v=20261019-beta1';
import {createPeaceAbility,pickPeaceTarget} from './peace-ability.js?v=20261019-beta1';
import {createPeaceBehavior} from './peace-behavior.js';
import {createPeaceControls} from './peace-controls.js?v=20261019-beta1';
import {createPeaceReactions} from './peace-reactions.js?v=20261019-peace3';
import {getInteriorLightPlacements} from './lighting.js';
import {createAnalyticsStore} from './analytics-data.js';
import {createAnalyticsPanel} from './analytics-ui.js?v=20261019-qa';
import {createAnalyticsBoards} from './analytics-board.js';
import {createMusicPlayer} from './music.js';
import {createWalker,WALKER_SPEEDS} from './walker.js?v=20261019-driving';
import {ROOMS,SPAWN,FLOORS,FLOOR_HEIGHT,INTERNAL_BOUNDS,LIFT_SPAWN,agentsForFloor} from './layout.js';

const $=id=>document.getElementById(id),viewport=$('viewport');
const scene=new THREE.Scene();scene.background=new THREE.Color('#c9dee4');scene.fog=new THREE.Fog('#c9dee4',55,155);
const camera=new THREE.PerspectiveCamera(39,1,.1,420);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.15));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
renderer.domElement.setAttribute('aria-label','Mundo 3D contínuo da sede');viewport.prepend(renderer.domElement);
const hemi=new THREE.HemisphereLight('#d9e8f1','#566b50',1.25);scene.add(hemi);
const sun=new THREE.DirectionalLight('#fff1da',2.8);sun.position.set(-18,38,22);sun.target.position.set(0,5,0);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-40,right:40,top:40,bottom:-40,far:150});sun.shadow.normalBias=.025;sun.shadow.bias=-.00015;scene.add(sun,sun.target);
const fill=new THREE.DirectionalLight('#d8e7f1',.35);fill.position.set(10,18,-14);scene.add(fill);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;controls.enablePan=false;controls.minDistance=8;controls.maxDistance=165;controls.maxPolarAngle=Math.PI*.47;
const world=createWorld(scene),campusGround=createCampusGround(scene),kart=createKartTrack({scene,
 getObstacles:()=>[...world.getObstacles(),...campusGround.obstacles,...(pub?.obstacles||[]),...(airTraffic?.getObstacles()||[])],
 getActors:()=>[...(floors[0]?.actors?.getColliders()||[]),...(parkPeople?.getColliders()||[]),...(pub?.getColliders()||[]),...(airTraffic?.getColliders()||[]),...(walker?.active?[{...walker.position,radius:.4}]:[])],
 getFlightObstacles:()=>[...staticFlightObstacles(),...(airTraffic?.getFlightObstacles?.()||[])]
});
const dayCycle=createDayCycle({durationSeconds:1200,initialTime:.16}),sky=createSky(scene);
let airTraffic=null;
let environment=dayCycle.getSnapshot(),parkPeople=null,pub=null;
function staticFlightObstacles(){return [{minX:-11.5,maxX:11.5,minZ:-11.5,maxZ:8.5,minY:0,maxY:17.7},{minX:-56,maxX:-33,minZ:-8,maxZ:14,minY:0,maxY:5},...world.getObstacles().filter(b=>['tree','park-lamp','pergola-post'].includes(b.id)).map(b=>({...b,maxY:b.id==='tree'?7.4:4}))];}
const interiorLights=Array.from({length:2},()=>{const light=new THREE.PointLight('#ffe3b9',0,17,2);scene.add(light);return light;});
const floors=FLOORS.map(info=>{const office=createOffice(scene);office.setFloor(info.id);office.group.position.y=info.id*FLOOR_HEIGHT;return {info,office,actors:null,life:null,coffee:0};});
const analyticsStore=createAnalyticsStore(),analyticsBoards=createAnalyticsBoards(floors);
let analyticsPanel=null,musicPlayer=null,customizationPanel=null,taskComposer=null,interiorLightingInitialized=false;
let peaceAbility=null,peaceControls=null,peaceReactions=null,peaceBehavior=null,peaceBindings=[],playerDrink=null;
const overlayBlocksMovement=()=>Boolean(taskComposer?.isOpen||customizationPanel?.isOpen||analyticsPanel?.getState().open||(musicPlayer?.getState().open&&!musicPlayer.getState().minimized));
const atmosphere=createAtmosphere({renderer,scene,camera,horizon:world.group.getObjectByName('Horizonte · cidade e montanhas'),terrain:world.group.getObjectByName('Chão contínuo do horizonte'),sky:sky.group,lights:[hemi,sun,fill]});
let currentFloor=0,campus=false,walker,ready=false,nearby=null,selected=null,simulationRunning=true,trip=null,groundY=0,toastUntil=0,lastFrame=0,nextFrameAt=0,lastUi=0,lastStats=0,frames=0,vehicleNotice='',metricsOpen=window.innerWidth>760;
const direction=new THREE.Vector3(),candidateDirection=new THREE.Vector3(),pickRay=new THREE.Raycaster();
const pubSpeechPoint=new THREE.Vector3();
const state=()=>floors[currentFloor],office=()=>state().office,actors=()=>state().actors,life=()=>state().life;
const pstate=()=>kart.active?kart.getSnapshot().position:walker?.active?walker.position:actors()?.visitor.position??SPAWN;
const groundVisitor=()=>{if(currentFloor!==0||kart.active)return null;const p=pstate();return {id:'visitor',x:p.x,y:0,z:p.z,radius:.4};};
const occupants=index=>{const team=floors[index].actors;if(!team)return [];const list=team.getColliders();if(index===0)list.push(...(airTraffic?.getColliders()||[]));if(index===currentFloor){const p=pstate();list.push({id:'visitor',x:p.x,z:p.z,radius:.4});}return list;};
const roomById=id=>ROOMS.find(room=>room.id===id);
const labels={working:'Trabalhando',walking:'Caminhando',coffee:'No café',paused:'Pausado',idle:'Disponível',waiting:'Aguardando',waving:'Acenando',resting:'Descansando'};
const inPause=item=>['paused','coffee','resting'].includes(item.status)||item.waitingForTask||['going','coffee','seated'].includes(item.restPhase);
const activityLabel=item=>item.status==='reacting'?'Procurando a paz':item.status==='paused'?'Rotina pausada':item.restPhase==='going'?(item.status==='waiting'?'Aguardando passagem · pausa':'Indo descansar'):item.restPhase==='coffee'?'Tomando café':item.restPhase==='seated'||item.status==='resting'?'Descansando':item.waitingForTask?'Esperando tarefa':labels[item.status]||item.status;
const money=value=>'US$ '+Number(value||0).toFixed(4).replace('.',',');
const count=value=>Math.floor(value||0).toLocaleString('pt-BR');
const snapshot=()=>life()?.getSnapshot()||[];
const insideCabin=()=>Math.abs(pstate().x)<1.05&&pstate().z< -8.55&&pstate().z> -10.25;
const outdoorObstacles=()=>[...world.getObstacles(),...campusGround.obstacles,...(pub?.obstacles||[]),...kart.obstacles,...(airTraffic?.getObstacles()||[])];
const outdoorActors=()=>[...(parkPeople?.getColliders()||[]),...(pub?.getColliders()||[]),...(kart.getColliders?.()||[]),...(airTraffic?.getColliders()||[])];
const outside=()=>currentFloor===0&&(Math.abs(pstate().x)>11.2||pstate().z>8.15||pstate().z< -10.8);
function toast(message){$('toast').textContent=message;$('toast').hidden=false;toastUntil=performance.now()+3400;}
function node(tag,text,cls){const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(cls)item.className=cls;return item;}
function action(parent,label,handler,primary=false){const item=node('button',label,primary?'primary':'quiet');item.addEventListener('click',handler);parent.append(item);return item;}
const peaceContext=()=>({active:ready&&Boolean(walker?.active)&&!kart.active&&!trip,blocked:overlayBlocksMovement()||!$('inspector').hidden||Boolean(playerDrink&&playerDrink.getSnapshot().phase!=='empty'),running:simulationRunning});
function canOrderDrink(){if(!simulationRunning){toast('Retome a simulação para preparar sua bebida.');return false;}if(playerDrink?.getSnapshot().phase!=='empty'){toast('Termine sua bebida atual primeiro.');return false;}return true;}
function orderPlayerCoffee(){
 if(!canOrderDrink())return;const floor=state(),result=floor.office.brewCoffee({forPlayer:true});if(!result.ok){toast(result.message);return;}
 floor.coffee++;playerDrink.begin({kind:'coffee',floor:currentFloor,position:roomById('lounge').station,ready:()=>floor.office.getCoffeeSnapshot().ready,claim:()=>floor.office.takeCoffee()});
 metricsOpen=false;closeInspector();peaceControls?.holster();toast('Preparando café. Chegue à máquina para pegar sua xícara.');viewport.focus({preventScroll:true});
}
function orderPlayerPub(){
 if(!canOrderDrink())return;if(!walker.active||Math.hypot(walker.position.x-pub.interactable.position.x,walker.position.z-pub.interactable.position.z)>3){walkCampusArea('pub');toast('Chegue ao balcão e pressione F para fazer o pedido.');return;}
 const result=pub.orderDrink();if(result.ok){const order=result.order;playerDrink.begin({kind:'pub',floor:0,position:pub.interactable.position,ready:()=>pub.getSnapshot().readyOrder===order,claim:()=>pub.takeDrink(order)});metricsOpen=false;closeInspector();peaceControls?.holster();viewport.focus({preventScroll:true});}toast(result.message);refreshCampusUi();
}
function sipPlayerDrink(){updatePlayerDrink(0);const ok=playerDrink?.sip();if(ok)viewport.focus({preventScroll:true});return ok;}
function updatePlayerDrink(dt){
 if(!playerDrink)return;const before=playerDrink.getSnapshot(),p=pstate(),nearSource=before.sourceFloor===currentFloor&&before.source&&Math.hypot(p.x-before.source.x,p.z-before.source.z)<2.8;
 const active=ready&&walker.active&&!kart.active&&!trip,blocked=overlayBlocksMovement()||!$('inspector').hidden;
 playerDrink.update(dt,{active,blocked,running:simulationRunning,nearSource,appearance:actors()?.getAppearance('visitor')});
 const value=playerDrink.getSnapshot(),hud=$('drink-hud');hud.hidden=!active||blocked||value.phase==='empty';viewport.dataset.drink=JSON.stringify(value);
 $('drink-title').textContent=value.kind==='pub'?'Um brinde à pausa':'Café quentinho';
 const label=!simulationRunning?'Simulação pausada':value.phase==='waiting'?(value.ready?'Pronto. Chegue perto do balcão para pegar.':value.kind==='pub'?'Ben está preparando seu brinde.':'A máquina está preparando seu café.'):value.phase==='pickup'?'Pegando sua bebida…':value.phase==='held'?'Na sua mão. F para dar um gole.':'Um gole. Sem pressa.';
 if($('drink-status').textContent!==label)$('drink-status').textContent=label;
 $('drink-sip').hidden=value.phase==='waiting';$('drink-sip').disabled=value.phase!=='held'||!simulationRunning;$('drink-progress').hidden=value.phase!=='sipping';$('drink-progress').value=value.progress;
}
function reactToPeaceShot(shot){
 const targets=peaceTargets(),near=peaceBindings.filter(binding=>binding.root.uuid!==shot.targetId).map(binding=>({binding,point:binding.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,1.2,0))})).filter(item=>item.point.distanceTo(shot.origin)<5.2&&Math.abs(item.point.y-shot.origin.y)<2).sort((a,b)=>a.point.distanceToSquared(shot.origin)-b.point.distanceToSquared(shot.origin));
 let count=0;for(const {binding,point} of near){if(count>=2)break;const ray=point.clone().sub(shot.origin),distance=ray.length();if(distance<.1)continue;const hit=pickPeaceTarget(camera,targets,{origin:shot.origin,direction:ray.normalize(),far:distance+.6});if(hit?.target.id===binding.root.uuid&&peaceBehavior?.trigger(binding.root.uuid,shot))count++;}
}
function peaceTargets(){return [...(peaceReactions?.getActorTargets()||[]),...floors.map(floor=>({id:`floor-${floor.info.id}`,kind:'structure',label:floor.info.name,object:floor.office.group})),...[[world.group,'Campus'],[campusGround.group,'Jardim'],[pub?.group,'The Wait Pub'],[kart.group,'Circuito Sede'],[airTraffic?.group,'Roadster']].filter(([object])=>object).map(([object,label])=>({id:object.uuid,kind:'structure',label,object}))];}
function peaceFeedback(event){
 viewport.dataset.peaceFeedback=event.kind;viewport.dataset.peaceTarget=event.targetKind||'';
 if(event.kind==='hit'){viewport.dataset.peaceLastHit=event.targetId||'';if(event.targetKind==='structure')toast(`${event.label} recebeu sua proposta de paz.`);}
 else if(['empty','reload','reaction-error'].includes(event.kind))toast(event.label);
}
function row(parent,label,value,id){const item=node('div',undefined,'status-row');item.append(node('span',label));const strong=node('strong',value);if(id)strong.id=id;item.append(strong);parent.append(item);return strong;}
function applyEnvironment(value){
 environment=value;const focusX=walker?.active||kart.active?camera.position.x:controls.target.x,focusZ=walker?.active||kart.active?camera.position.z:controls.target.z;sun.target.position.set(focusX,5,focusZ);sun.position.set(value.sunPosition.x+focusX,value.sunPosition.y,value.sunPosition.z+focusZ);sun.color.setHex(value.sunColor);sun.intensity=value.sunIntensity;
 hemi.color.setHex(value.hemiSky);hemi.groundColor.setHex(value.hemiGround);hemi.intensity=value.hemiIntensity;fill.color.setHex(value.fillColor);fill.intensity=value.fillIntensity;
 const viewAllowance=walker?.active||kart.active?0:camera.position.distanceTo(controls.target)*.5;
 scene.fog.color.setHex(value.fogColor);scene.fog.near=value.fogNear+18+viewAllowance;scene.fog.far=value.fogFar+72+viewAllowance;scene.background.copy(scene.fog.color);renderer.toneMappingExposure=value.exposure;
 world.setNight(value.nightFactor);campusGround.setNight(value.nightFactor);pub?.setNight(value.nightFactor);kart.setNight(value.nightFactor);airTraffic?.setNight(value.nightFactor);for(const floor of floors)floor.office.setNight(value.nightFactor);
 renderer.shadowMap.autoUpdate=value.sunIntensity>.01;
 const placements=getInteriorLightPlacements({cameraPosition:camera.position,nightFactor:value.nightFactor,floorHeights:floors.map(f=>f.info.id*FLOOR_HEIGHT)});
 interiorLights.forEach((light,index)=>{const target=placements[index];if(!interiorLightingInitialized)light.position.set(target.position.x,target.position.y,target.position.z);else{light.position.x+=(target.position.x-light.position.x)*.075;light.position.y+=(target.position.y-light.position.y)*.075;light.position.z+=(target.position.z-light.position.z)*.075;}light.intensity=target.intensity;light.distance=target.distance;light.decay=target.decay;light.color.setHex(target.color);light.visible=true;});interiorLightingInitialized=true;
 sky.update(value,camera);
}
function refreshEnvironment(){
 $('world-clock').textContent=environment.clock;$('world-clock-icon').textContent=environment.nightFactor>.7?'☾':'☀';
 document.body.classList.toggle('night-scene',environment.nightFactor>.65);
 $('environment-button').setAttribute('aria-label',`${environment.phaseLabel}, ${environment.clock}. Ajustar ambiente`);
 viewport.dataset.dayPhase=environment.phase;viewport.dataset.worldTime=environment.clock;viewport.dataset.nightFactor=environment.nightFactor.toFixed(3);viewport.dataset.cycleRunning=String(environment.running);viewport.dataset.cycleDuration=String(environment.durationSeconds);viewport.dataset.pedestrians=String((parkPeople?.count||0)+(pub?(pub.getSnapshot().patrons+1):0));
 if(selected?.kind!=='environment')return;
 $('environment-time').textContent=environment.clock;$('environment-phase').textContent=environment.phaseLabel;
 $('cycle-pause').textContent=environment.running?'Pausar ciclo':'Retomar ciclo';
 $('cycle-progress').style.setProperty('--cycle-progress',`${environment.time*100}%`);
}
function showEnvironment(){
 selected={kind:'environment'};const content=panel('Ambiente','Luz & tempo.','Do amanhecer à noite, toda a sede acompanha o mesmo horário.');
 const display=node('div',undefined,'environment-clock');display.append(node('span','HORÁRIO DO MUNDO','section-label'),node('strong',environment.clock),node('span',environment.phaseLabel));display.querySelector('strong').id='environment-time';display.lastChild.id='environment-phase';content.append(display);
 const progress=node('div',undefined,'cycle-progress');progress.id='cycle-progress';progress.setAttribute('aria-hidden','true');content.append(progress);
 const presets=node('div',undefined,'environment-presets');content.append(presets);
 for(const [label,time] of [['Manhã',.125],['Tarde',10/24],['Pôr do sol',.505],['Noite',.75]]){const button=action(presets,label,()=>{applyEnvironment(dayCycle.setTime(time));refreshEnvironment();});button.dataset.timePreset=label;}
 const actions=node('div',undefined,'actions');content.append(actions);action(actions,'Pausar ciclo',()=>{applyEnvironment(dayCycle.setRunning(!environment.running));refreshEnvironment();},true).id='cycle-pause';
 const label=node('label','Ciclo completo · minutos'),input=node('input');input.type='number';input.id='cycle-duration';input.min='1';input.max='60';input.step='1';input.value=String(environment.durationSeconds/60);label.append(input);content.append(label);
 input.addEventListener('change',()=>{const minutes=Number(input.value);if(!input.value||!Number.isFinite(minutes)||minutes<1||minutes>60){input.value=String(environment.durationSeconds/60);toast('Escolha uma duração entre 1 e 60 minutos.');return;}applyEnvironment(dayCycle.setDuration(minutes*60));refreshEnvironment();});
 const note=node('p','20 minutos por padrão, inspirado no Minecraft. Use 2 minutos para testar as transições.','environment-note');content.append(note);
 row(content,'Pessoas no campus',String((parkPeople?.count||0)+(pub?(pub.getSnapshot().patrons+1):0)));refreshEnvironment();
}
function syncPanels(){const visible=metricsOpen&&$('inspector').hidden&&!kart.active;$('metrics').hidden=!visible;$('metrics-toggle')?.setAttribute('aria-expanded',String(visible));document.body.classList.toggle('metrics-collapsed',!visible);}
function showWalkSettings(){
 if(!walker)return;selected={kind:'walk-settings'};const content=panel('Seu ponto de vista','O passeio, no seu ritmo.','Ajuste a caminhada e a resposta da câmera. Shift acelera o passo.');
 const preferences=walker.getPreferences();
 const addRange=(caption,id,min,max,step,value,handler)=>{const label=node('label',undefined,'walk-range'),top=node('span',undefined,'walk-range-title'),output=node('output',value.toFixed(1)+'×');top.append(node('span',caption),output);const input=node('input');input.id=id;input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;input.setAttribute('aria-label',caption);input.addEventListener('input',()=>{const number=Number(input.value);handler(number);output.textContent=number.toFixed(1)+'×';});label.append(top,input);content.append(label);};
 const speedNote=node('p',undefined,'environment-note');speedNote.id='walk-speed-summary';
 const describeSpeed=value=>{const number=speed=>(speed*value).toFixed(1).replace('.',',');speedNote.textContent=`Caminhada: ${number(WALKER_SPEEDS.walk)} m/s · Shift: ${number(WALKER_SPEEDS.run)} m/s.`;};describeSpeed(preferences.speedMultiplier);
 addRange('Velocidade de caminhada','walk-speed',.5,1.5,.1,preferences.speedMultiplier,value=>{walker.setPreferences({speedMultiplier:value});describeSpeed(value);});content.append(speedNote);
 addRange('Sensibilidade da câmera','look-sensitivity',.4,2,.1,preferences.lookSensitivity,value=>walker.setPreferences({lookSensitivity:value}));
 const addToggle=(caption,id,checked,handler)=>{const label=node('label',undefined,'preference-toggle'),input=node('input');input.type='checkbox';input.id=id;input.checked=checked;input.addEventListener('change',()=>handler(input.checked));label.append(node('span',caption),input);content.append(label);};
 addToggle('Balanço suave ao caminhar','walk-head-bob',preferences.headBob,value=>walker.setPreferences({headBob:value}));
 addToggle('Suavizar horizonte distante','horizon-softness',atmosphere.enabled,value=>atmosphere.setEnabled(value));
 const note=node('p','O balanço acompanha os passos. A preferência de movimento reduzido do sistema é respeitada.','environment-note');content.append(note);
 const actions=node('div',undefined,'actions');content.append(actions);action(actions,'Restaurar ajustes',()=>{walker.setPreferences({speedMultiplier:1,lookSensitivity:1,headBob:true});atmosphere.setEnabled(true);showWalkSettings();});action(actions,walker.active?'Continuar passeio':'Entrar em primeira pessoa',()=>{if(walker.active){closeInspector();viewport.focus({preventScroll:true});}else enter();},true);
}

const CAMPUS_DESTINATIONS={
 pub:{title:'The Wait Pub',description:'Balcão aberto e conversa sem pressa.',camera:[-19,22,37],target:[-44,1,2],spawn:{x:-44,z:16.6},look:{x:-44,y:1.55,z:3}},
 kart:{title:'Circuito Sede',description:'Curvas em S, hairpin, rampa e loop. O Roadster também voa pelo campus.',camera:[83,38,48],target:[53,0,5],spawn:{x:32,z:20},look:{x:45,y:1.55,z:5}},
 rest:{title:'Jardim de pausa',description:'Um café, um banco e tempo para a próxima ideia.',camera:[-2,12,29],target:[-11.5,0,13.7],spawn:{x:-11.6,z:17},look:{x:-11.6,y:1.4,z:13.6}}
};
function viewCampusArea(kind){
 if(!ready||trip||!leaveKart(false))return;selectFloor(0);campus=true;overview();
 const zone=CAMPUS_DESTINATIONS[kind];controls.enableDamping=false;camera.position.set(...zone.camera);controls.target.set(...zone.target);controls.update();controls.enableDamping=true;applyVisibility();
}
function walkCampusArea(kind){
 if(!ready||trip||!leaveKart(false))return;selectFloor(0);campus=true;enter(CAMPUS_DESTINATIONS[kind]);
 viewport.focus({preventScroll:true});
}
function showCampus(){
 selected={kind:'campus'};const content=panel('Do trabalho à pausa','O campus está aberto.','Tudo faz parte do mesmo mundo. Explore a pé ou escolha uma área.');
 for(const [key,zone]of Object.entries(CAMPUS_DESTINATIONS)){
  const card=node('section',undefined,'campus-card');card.append(node('h3',zone.title),node('p',zone.description));const actions=node('div',undefined,'actions');card.append(actions);
  action(actions,'Ver área',()=>{viewCampusArea(key);key==='pub'?showPub():key==='kart'?showKart():showRest();});
  action(actions,key==='pub'?'Entrar no pub':key==='kart'?'Ir aos boxes':'Ir ao jardim',()=>walkCampusArea(key),true);content.append(card);
 }
 const arrivals=node('div',undefined,'actions');content.append(arrivals);action(arrivals,'Chegadas do campus',showArrivals,true);
}
const arrivalLabels={cruising:'Sobrevoando',approaching:'Em aproximação',holding:'Esperando área livre',descending:'Pousando',landed:'Desembarcando',visiting:'Em visita', 'launch-wait':'Preparando decolagem',ascending:'Decolando',departing:'Retomando voo'};
const visitLabels={aboard:'A bordo',exiting:'Desembarcando',outbound:'A caminho',visiting:'Fazendo uma pausa',returning:'Voltando ao carro',boarding:'Embarcando'};
function showArrivals(){
 selected={kind:'arrivals'};const content=panel('PESSOAS EM MOVIMENTO','Chegadas & visitas.','Os visitantes pousam, fazem uma pausa no pub ou passam na recepção e depois seguem viagem.');
 for(const car of airTraffic?.getSnapshot().cars||[]){
  const card=node('section',undefined,'campus-card');card.append(node('h3',car.visitor?.name||'Visitante'));
  card.append(node('p',car.destination==='office'?'Destino · Escritório':'Destino · The Wait Pub'));
  const status=node('p');status.id=`arrival-${car.id}`;card.append(status);const buttons=node('div',undefined,'actions');card.append(buttons);
  action(buttons,'Ver chegada',()=>watchArrival(car.id));content.append(card);
 }
 content.append(node('p','Os voos e as visitas acompanham a pausa em Atividade. A área precisa estar livre para pousar ou decolar.','environment-note'));refreshArrivals();
}
function refreshArrivals(){if(selected?.kind!=='arrivals')return;for(const car of airTraffic?.getSnapshot().cars||[]){const label=$(`arrival-${car.id}`),activity=car.visitor?.state==='visiting'?(car.destination==='office'?'Na recepção':'Tomando café'):visitLabels[car.visitor?.state]||'A bordo',count=car.completedVisits||0;if(label)label.textContent=`${arrivalLabels[car.state]||'Em trânsito'} · ${activity} · ${count} ${count===1?'visita concluída':'visitas concluídas'}`;}}
function watchArrival(id){
 const car=airTraffic?.getSnapshot().cars.find(item=>item.id===id);if(!car?.pad||!leaveKart(false))return;
 selectFloor(0);walker.exit();campus=true;overview();controls.enableDamping=false;
 camera.position.set(car.pad.x+15,22,car.pad.z+23);controls.target.set(car.pad.x,4,car.pad.z-6);controls.update();controls.enableDamping=true;applyVisibility();showArrivals();
}
function showPub(){
 selected={kind:'pub'};const content=panel('THE WAIT PUB','Uma rodada de conversa.','O barman atende no balcão. Os clientes conversam, pedem e fazem sua pausa.');
 row(content,'No salão',`${(pub?.getSnapshot().patrons||0)+1} pessoas`);row(content,'Pedidos no balcão','0','pub-orders');row(content,'Barman','Preparando…','pub-service');row(content,'Na pista de dança','0 pessoas','pub-dancers');
 const reflection=node('section',undefined,'pub-reflection');reflection.id='pub-reflection';reflection.hidden=true;const thought=node('p'),inspiration=node('small');thought.id='pub-reflection-text';inspiration.id='pub-reflection-inspiration';reflection.append(node('span','Última do Ben','section-label'),thought,inspiration);content.append(reflection);
 const actions=node('div',undefined,'actions');content.append(actions);action(actions,'Escolher música',showMusic,true);action(actions,'Pedir uma bebida',orderPlayerPub);action(actions,'Entrar no pub',()=>walkCampusArea('pub'));content.append(reflection);refreshCampusUi();
}
function showKart(){
 selected={kind:'kart'};const content=panel('CIRCUITO SEDE','A pista é só o começo.','Roadster inspirado no Rocket da Tesla, com propulsores de gás frio em uma brincadeira arcade. Dirija ou explore o campus pelo ar.');
 content.append(node('p','WASD / setas: dirigir · Espaço: frear · V: voar / pousar · E / Q: subir / descer · Shift: turbo · B: giro lateral · R: boxes · Esc: sair após pousar.','environment-note'),node('p','Loop automático: acelere pela entrada sinalizada, alinhado à faixa. L também solicita o loop. Para o giro lateral, pressione B em uma área livre; o carro sobe, gira e se estabiliza.','environment-note'));
 row(content,'Na pista','3 pilotos + você');row(content,'Melhor volta','—','kart-best-panel');
 const actions=node('div',undefined,'actions');content.append(actions);action(actions,'Pilotar Roadster',startKart,true);action(actions,'Conhecer os boxes',()=>walkCampusArea('kart'));refreshCampusUi();
}
function showRest(){
 selected={kind:'rest'};const content=panel('PAUSA BOA','Esperar também tem lugar.','Os agentes do térreo saem para este jardim. Nos outros pisos, usam o café e o sofá do próprio andar.');
 const actions=node('div',undefined,'actions');content.append(actions);action(actions,'Ir ao jardim',()=>walkCampusArea('rest'),true);
 const list=node('div',undefined,'rest-agent-list');content.append(list);
 for(const agent of floors[0].actors.agents){const line=node('div',undefined,'rest-agent-row');line.append(portrait(agent,'agent-portrait'),node('strong',agent.name));const choices=node('div',undefined,'actions');line.append(choices);action(choices,'Descansar',()=>{floors[0].life.setWaiting(agent.id,true);toast(`${agent.name} vai esperar a próxima tarefa no jardim.`);});action(choices,'Trabalhar',()=>{floors[0].life.sendTo(agent.id,'work');toast(`${agent.name} voltou à rotina.`);});list.append(line);}
}
function startKart(){
 if(!ready||trip||kart.active)return;selectFloor(0);closeInspector();walker.exit();campus=true;controls.enabled=false;kart.enter();syncPanels();
 document.body.classList.remove('walking');document.body.classList.add('karting');$('kart-hud').hidden=false;$('crosshair').hidden=true;$('mode-button').textContent='Sair do carro';$('mode-label').textContent='Roadster';
 camera.fov=66;camera.near=.06;camera.clearViewOffset();camera.updateProjectionMatrix();applyVisibility();
 $('controls-hint').textContent='WASD: dirigir · V: voo/pouso · E/Q: altura · Shift: turbo · L: loop · B: giro lateral · Espaço: freio · R: boxes · Esc: sair';viewport.focus({preventScroll:true});
}
function leaveKart(walk=false){
 if(!kart.active)return true;const result=kart.exit();if(!result.ok){toast(result.message+' Use V para pousar ou R para voltar aos boxes.');viewport.focus({preventScroll:true});return false;}document.body.classList.remove('karting');$('kart-hud').hidden=true;if(walk){campus=true;enter({spawn:result.exitPosition,look:{x:result.position.x,y:1.55,z:result.position.z}});}syncPanels();return true;
}
function refreshCampusUi(){
 refreshArrivals();
 const race=kart.getSnapshot();if(kart.active){$('kart-speed').textContent=String(Math.round(Math.abs(race.speed)*3.6));$('kart-laps').textContent=String(race.lap);$('kart-best').textContent=race.bestLap?`${race.bestLap.toFixed(1)} s`:'—';$('kart-altitude').textContent=race.altitude.toFixed(1)+' m';$('kart-pressure').textContent=Math.round(race.pressure)+'%';$('kart-state').textContent=race.rolling?'Giro lateral':race.loopReady?'Loop automático':{ground:'No chão',flight:'Em voo',landing:'Pousando',loop:'Loop',roll:'Giro lateral'}[race.mode];viewport.dataset.kartSpeed=race.speed.toFixed(2);viewport.dataset.kartLaps=String(race.lap);viewport.dataset.vehicleMode=race.mode;viewport.dataset.vehicleHeading=race.heading.toFixed(3);viewport.dataset.vehiclePressure=race.pressure.toFixed(1);viewport.dataset.vehicleRoll=Number(race.roll||0).toFixed(3);}
 if(kart.active&&(race.loopBlocked||race.rollBlocked)){$('kart-state').textContent='Aguardando passagem';$('kart-state').title=race.loopMessage||race.rollMessage||'';}else $('kart-state').removeAttribute('title');
 viewport.dataset.kartLoopBlocked=String(!!race.loopBlocked);
 const notice=race.notice||race.rollMessage||race.loopMessage||'';if(kart.active&&notice&&notice!==vehicleNotice)toast(notice);vehicleNotice=kart.active?notice:'';
 if(pub){const info=pub.getSnapshot();viewport.dataset.pubDancers=String(info.dancers);viewport.dataset.pubMusic=String(info.musicPlaying);}
 if(selected?.kind==='kart'&&$('kart-best-panel'))$('kart-best-panel').textContent=race.bestLap?`${race.bestLap.toFixed(1)} s`:'Ainda sem volta completa';
 if(selected?.kind==='pub'&&pub){const info=pub.getSnapshot();$('pub-orders').textContent=String(info.orders);$('pub-service').textContent=info.service||'Balcão aberto';$('pub-dancers').textContent=`${info.dancers} pessoas`;const thought=info.philosophy;$('pub-reflection').hidden=!thought;if(thought){$('pub-reflection-text').textContent=thought.text;$('pub-reflection-inspiration').textContent=`Reflexão do Ben · inspirada em ${thought.inspiration}`;}}
}

function updatePubSpeech(){
 const bubble=$('pub-speech'),thought=pub?.getSnapshot().philosophy;
 const visitor=walker?.active&&currentFloor===0?walker.position:null;
 const inPub=visitor&&visitor.x> -56&&visitor.x< -33&&visitor.z> -8&&visitor.z<14;
 const viewingPub=!walker?.active&&!kart.active&&selected?.kind==='pub';
 if(!thought||thought.remainingSeconds<=0||(!inPub&&!viewingPub)||overlayBlocksMovement()){bubble.hidden=true;return;}
 pubSpeechPoint.set(thought.position.x,thought.position.y,thought.position.z);if(camera.position.distanceTo(pubSpeechPoint)>48){bubble.hidden=true;return;}
 camera.updateMatrixWorld(true);pubSpeechPoint.project(camera);
 if(pubSpeechPoint.z< -1||pubSpeechPoint.z>1||Math.abs(pubSpeechPoint.x)>1.15||Math.abs(pubSpeechPoint.y)>1.2){bubble.hidden=true;return;}
 const width=viewport.clientWidth,height=viewport.clientHeight,inspector=$('inspector');
 // The pub panel retains the last line on narrow screens; avoid covering it.
 if(width<760&&!inspector.hidden){bubble.hidden=true;return;}
 if(bubble.dataset.order!==String(thought.orderId)){bubble.dataset.order=String(thought.orderId);$('pub-speech-text').textContent=thought.text;$('pub-speech-inspiration').textContent=`Inspirada em ${thought.inspiration}`;}
 bubble.hidden=false;
 const bubbleWidth=bubble.offsetWidth,bubbleHeight=bubble.offsetHeight,right=inspector.hidden?width-16:Math.max(bubbleWidth+32,inspector.offsetLeft-16);
 const left=Math.max(16,Math.min((pubSpeechPoint.x+1)*width/2-bubbleWidth/2,right-bubbleWidth));
 const top=Math.max(20,Math.min((1-pubSpeechPoint.y)*height/2-bubbleHeight-20,height-bubbleHeight-92));
 bubble.style.transform=`translate(${left.toFixed(1)}px,${top.toFixed(1)}px)`;
}

function portrait(agent,cls){const img=node('img',undefined,cls);img.src=agent.portrait;img.dataset.portraitId=agent.id;img.alt='';img.width=160;img.height=160;img.draggable=false;return img;}
const CUSTOMIZATION_KEY='sede-customization-v1';
function characterTargets(id){return floors.flatMap(floor=>floor.actors?.records.filter(record=>record.id===id).map(record=>({floor,record}))||[]);}
function customizationPeople(){return floors.flatMap(floor=>floor.actors?.records.filter(record=>!record.person||floor.info.id===0).map(record=>({id:record.id,name:record.name,person:record.person,role:record.role,floor:floor.info.id,floorLabel:floor.info.label,portrait:record.portrait,appearance:floor.actors.getAppearance(record.id)}))||[]);}
function saveCustomization(){try{const people=customizationPeople().map(({id,name,appearance})=>({id,name,appearance}));localStorage.setItem(CUSTOMIZATION_KEY,JSON.stringify({version:1,people}));return true;}catch{return false;}}
function restoreCustomization(){try{const saved=JSON.parse(localStorage.getItem(CUSTOMIZATION_KEY)||'null');if(saved?.version!==1||!Array.isArray(saved.people))return;for(const person of saved.people.slice(0,17)){if(typeof person?.id!=='string'||!person.appearance||typeof person.appearance!=='object')continue;try{for(const {floor,record} of characterTargets(person.id)){floor.actors.setAppearance(record.id,person.appearance);if(typeof person.name==='string')floor.actors.setName(record.id,person.name);}}catch{/* Ignore stale/invalid saved palettes without affecting other people. */}}}catch{/* Storage is optional; the scene remains usable. */}}
function refreshCharacterImages(id){const targets=characterTargets(id),records=targets.map(item=>item.record);createActorPortraits(renderer,records,{size:160});for(const record of records){record.preview=null;for(const image of document.querySelectorAll('[data-portrait-id]'))if(image.dataset.portraitId===id)image.src=record.portrait;}buildAgentList();if(selected?.kind==='agent'&&selected.id===id)showAgent(id);}
function customizeCharacter(id,patch,{reset=false,name}={}){for(const {floor,record} of characterTargets(id)){if(reset)floor.actors.resetAppearance(id);else if(patch)floor.actors.setAppearance(id,patch);if(name!==undefined)floor.actors.setName(id,name);}refreshCharacterImages(id);return {saved:saveCustomization()};}
function characterPreview(id){const record=characterTargets(id)[0]?.record;if(!record)return '';if(!record.preview)createActorPortraits(renderer,[record],{size:320,framing:'full-body'});return record.preview;}
function showCustomization(id='visitor'){if(!ready||trip)return;closeInspector();kart.setInputEnabled(false);customizationPanel.open(id);}
function panel(kicker,title,description){for(const floor of floors)for(const agent of floor.actors?.agents||[])agent.root.userData.selected=false;const content=$('inspector-content'),heading=node('h2',title);heading.id='inspector-title';content.replaceChildren(node('span',kicker,'section-label'),heading,node('p',description));$('inspector').hidden=false;$('inspector').setAttribute('aria-labelledby','inspector-title');$('inspector').scrollTop=0;syncPanels();$('close-inspector').focus({preventScroll:true});return content;}
function closeInspector(){$('inspector').hidden=true;selected=null;for(const floor of floors)for(const agent of floor.actors?.agents||[])agent.root.userData.selected=false;syncPanels();document.querySelectorAll('.room-button').forEach(button=>button.setAttribute('aria-pressed','false'));}
function showAnalytics(){if(!ready||trip)return;musicPlayer?.pause();closeInspector();kart.setInputEnabled?.(false);analyticsPanel.open();}
function showMusic(){if(!ready||trip)return;closeInspector();musicPlayer.open();}
function doorStatus(door){if(!door)return 'Indisponível';if(door.progress>.999)return 'Aberta';return door.targetOpen?'Abrindo…':door.progress>.001?'Fechando…':'Fechada';}
function applyVisibility(){
 const whole=!!walker?.active||campus||!!trip||kart.active;
 pub?.setView({firstPerson:!!walker?.active,camera});
 for(const floor of floors){const show=whole||floor.info.id<=currentFloor;floor.office.group.visible=show;floor.office.setCutaway(!whole&&floor.info.id===currentFloor);floor.actors?.setVisible(show);}
 world.setView({floor:currentFloor,exterior:whole,cutaway:!whole});document.body.classList.toggle('campus',campus&&!walker?.active);
}
function selectFloor(index,{travel=false}={}){
 if(!ready&&!travel)return;if(trip&&!travel)return;
 if(!travel){if(!leaveKart(false))return;walker?.exit();closeInspector();campus=false;}
 currentFloor=index;groundY=index*FLOOR_HEIGHT;world.setLiftHeight(groundY);
 $('floor-number').textContent=FLOORS[index].short;$('floor-header').replaceChildren(node('span',FLOORS[index].name),node('small',`${FLOORS[index].label} · 4 agentes`));$('metrics-title').textContent=FLOORS[index].name;
 document.querySelectorAll('button[data-floor]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.floor)===index)));
 if(!travel)overview();else applyVisibility();buildAgentList();if(ready)updateUi(performance.now());
}
function overview(room=null){
 if(trip||!leaveKart(false))return;walker?.exit();document.body.classList.remove('walking');$('crosshair').hidden=true;$('mode-button').innerHTML='Entrar no andar <span>↗</span>';
 camera.fov=39;camera.near=.1;camera.updateProjectionMatrix();controls.enableDamping=false;controls.update();controls.enabled=true;
 const y=currentFloor*FLOOR_HEIGHT;
 if(campus){camera.position.set(36,82,116);controls.target.set(8,1.5,3);}
 else if(room){camera.position.set(room.x+9,y+13,room.z+11);controls.target.set(room.x,y+.2,room.z);}
 else{camera.position.set(23,y+26,29);controls.target.set(0,y+.2,-.5);}
 controls.update();controls.enableDamping=true;applyVisibility();resize();$('mode-label').textContent=campus?'Mundo completo':'Andar em contexto';
 $('controls-hint').innerHTML='Arraste: girar <span>·</span> Role: aproximar <span>·</span> Selecione um agente para ver sua tarefa';$('interaction-prompt').hidden=true;
}
function enter(destination=null){
 if(!ready||trip||!leaveKart(false))return;closeInspector();controls.enableDamping=false;controls.update();controls.enableDamping=true;controls.enabled=false;
 if(campus){selectFloor(0);campus=true;if(!destination)actors().visitor.position.set(0,0,17);controls.enabled=false;}
 camera.fov=66;camera.near=.04;camera.clearViewOffset();camera.updateProjectionMatrix();groundY=currentFloor*FLOOR_HEIGHT;
 const p=destination?.spawn||actors().visitor.position;const ok=walker.enter({position:{x:p.x,z:p.z},lookAt:destination?.look||{x:p.x,y:groundY+1.5,z:p.z-3}});
 if(!ok){overview();toast('Ponto ocupado. Use Recepção para recomeçar.');return;}
 document.body.classList.add('walking');$('crosshair').hidden=false;$('mode-label').textContent='Primeira pessoa';$('mode-button').textContent='Sair para a maquete';
 $('controls-hint').innerHTML='WASD: andar <span>·</span> Arraste / Q E: olhar <span>·</span> F: interagir <span>·</span> P: habilidade <span>·</span> Shift: acelerar <span>·</span> Esc: maquete';applyVisibility();toast('F abre portas e interage. P ativa “A paz é a única opção”.');
}
function toggleDoor(id){const result=office().toggleDoor(id,occupants(currentFloor));toast(result?.message||'Porta acionada.');if(walker.active)viewport.focus({preventScroll:true});}
function showRoom(id){
 const room=roomById(id);selected={kind:'room',id};document.querySelectorAll('.room-button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.room===id)));
 const content=panel(FLOORS[currentFloor].label.toUpperCase(),room.name,room.subtitle+'. Os agentes circulam entre as estações e os espaços de pausa.');row(content,'Porta',doorStatus(office().getDoor(id)),'selected-door-status');
 const actions=node('div',undefined,'actions');content.append(actions);action(actions,'Abrir / fechar porta',()=>toggleDoor(id),true);action(actions,'Ver esta sala de perto',()=>{campus=false;overview(room);showRoom(id);});
 const station=office().interactables.find(item=>item.roomId===id&&item.kind!=='board');if(station)action(actions,station.name,()=>showStation(station));
}
function showAgent(id){
 const agent=actors().agents.find(agent=>agent.id===id);if(!agent)return;selected={kind:'agent',id};const content=panel('Agente · '+agent.role,agent.name,'Simulação local');content.querySelector('p').className='agent-context';row(content,'Atividade','…','agent-state');const task=node('div',undefined,'agent-task');task.id='agent-task';content.append(task);row(content,'Tokens simulados','0','agent-tokens');row(content,'Custo de teste','US$ 0,0000','agent-cost');
 for(const record of actors().agents)record.root.userData.selected=record===agent;
 const identity=node('div',undefined,'agent-identity'),identityCopy=node('div',undefined,'agent-identity-copy');identityCopy.append(content.querySelector('.section-label'),content.querySelector('h2'));identity.append(portrait(agent,'inspector-portrait'),identityCopy);content.prepend(identity);
 const quick=node('div',undefined,'actions agent-quick-actions');content.insertBefore(quick,task);const pause=action(quick,'Pausar agente',()=>{if(!simulationRunning)return;const paused=snapshot().find(item=>item.id===id)?.status==='paused';life().setPaused(id,!paused);toast(`${agent.name}: ${paused?'rotina retomada':'pausado'}.`);refreshAgent();},true);pause.id='agent-pause';const pauseNote=node('p','Retome a simulação em Atividade para controlar este agente.','pause-note');pauseNote.id='agent-pause-note';quick.append(pauseNote);const actions=node('div',undefined,'actions');content.append(actions);
 const destinations=node('div',undefined,'destination-actions');content.append(destinations);action(destinations,'Trabalhar',()=>{life().sendTo(id,'work');toast(`${agent.name}: ir trabalhar.`);});action(destinations,'Tomar café',()=>{life().sendTo(id,'coffee');toast(`${agent.name}: pausa para café.`);});action(destinations,'Esperar / descansar',()=>{life().setWaiting(id,true);toast(`${agent.name}: aguardando trabalho, com uma pausa para café.`);refreshAgent();}).id='agent-wait';
 action(actions,'Acenar para mim',()=>{const target=walker.active?walker.position:camera.position;agent.root.rotation.y=Math.atan2(target.x-agent.root.position.x,target.z-agent.root.position.z);actors().setAgentState(id,'waving');toast(`${agent.name} está acenando.`);});
 action(actions,'Personalizar aparência',()=>showCustomization(id));
 action(actions,'Preparar pedido no Codex',()=>showTaskComposer(id));
 const label=node('label','Nome na identificação'),input=node('input');input.value=agent.name;input.maxLength=40;input.setAttribute('aria-label','Nome do agente');label.append(input);const settings=node('details',undefined,'agent-settings');settings.append(node('summary','Personalizar identificação'),label);content.append(settings);input.addEventListener('change',()=>{actors().setName(id,input.value);saveCustomization();input.value=agent.name;content.querySelector('h2').textContent=agent.name;buildAgentList();});refreshAgent();
}
function refreshAgent(){
 if(selected?.kind!=='agent')return;const item=snapshot().find(item=>item.id===selected.id);if(!item)return;$('agent-state').textContent=activityLabel(item)+(item.waitingForTask?' · esperando tarefa':'');$('agent-tokens').textContent=count(item.tokens);$('agent-cost').textContent=money(item.cost);$('agent-pause').disabled=!simulationRunning;$('agent-pause').textContent=!simulationRunning?'Simulação pausada':item.status==='paused'?'Retomar rotina':'Pausar rotina';$('agent-pause-note').hidden=simulationRunning;if($('agent-wait')){$('agent-wait').disabled=!simulationRunning||item.waitingForTask;$('agent-wait').textContent=item.waitingForTask?'Esperando trabalho':'Esperar / descansar';}
 const task=item.task||{},target=$('agent-task'),key=JSON.stringify([task,item.destination,item.status]);if(target.dataset.content===key)return;target.dataset.content=key;const expanded=target.querySelector('details')?.open||false;
 target.replaceChildren(node('span','TAREFA ATUAL','section-label'),node('h3',task.title||'Preparando a próxima tarefa'),node('p','Skill · '+(task.skill||'Rotina do escritório')));const tool=task.tool,toolBlock=node('div',undefined,'active-tool');toolBlock.append(node('span',item.status==='working'?'Em uso · simulado':'Última etapa · simulada','tool-caption'),node('strong',tool?`${tool.icon||'◇'} ${tool.label}`:item.destination||'Em deslocamento'));target.append(toolBlock);
 if(task.steps?.length){const history=node('details',undefined,'tool-history');history.open=expanded;const completed=task.steps.filter(step=>step.state==='done').length;history.append(node('summary',`Etapas da tarefa · ${completed}/${task.steps.length}`));const steps=node('ol',undefined,'tool-steps');for(const step of task.steps){const li=node('li',step.label);li.dataset.state=step.state;steps.append(li);}history.append(steps);target.append(history);}
}
function showTaskComposer(id){if(!ready||trip)return;kart.setInputEnabled(false);taskComposer.open(id);}
function showBoard(){selected={kind:'board'};const content=panel('Trabalho do andar','Da ideia à entrega.','Acompanhe a demonstração ou prepare um pedido para executar no Codex.');const entry=node('section',undefined,'task-entry');entry.append(node('strong','Trabalho real, no chat do projeto'),node('p','Nenhum agente real conectado. O pedido fica salvo aqui até você copiar e enviar no Codex.'));action(entry,'Preparar uma tarefa',()=>showTaskComposer(),true);content.append(entry,node('p','Atividade simulada deste andar','section-label'));for(const item of snapshot()){const card=node('button',undefined,'task-card');card.dataset.taskAgent=item.id;const copy=node('span',undefined,'task-card-copy');copy.append(node('small'),node('strong'));const agent=actors().agents.find(agent=>agent.id===item.id);card.append(portrait(agent,'agent-portrait'),copy);card.addEventListener('click',()=>showAgent(item.id));content.append(card);}refreshBoard();}
function refreshBoard(){if(selected?.kind!=='board')return;for(const item of snapshot()){const card=document.querySelector(`[data-task-agent="${item.id}"]`);if(!card)continue;card.querySelector('small').textContent=`${item.name} · ${activityLabel(item)}`;card.querySelector('strong').textContent=item.task?.title||'Rotina do escritório';}}
function showStation(item){
 selected=item;const active=!!office().group.userData.stationStates?.[item.roomId];const content=panel(roomById(item.roomId)?.name.toUpperCase()||'ESTAÇÃO',item.kind==='coffee'?'Uma pausa faz bem.':item.kind==='projector'?'Ideias em conversa.':'Uma estação de apoio.',item.kind==='coffee'?'Os agentes também passam por aqui entre suas tarefas.':'Ferramentas e skills aparecem na identificação e no painel do agente.');row(content,item.kind==='coffee'?'Cafés pedidos por você':'Estado',item.kind==='coffee'?String(state().coffee):active?'Ligado':'Desligado');const actions=node('div',undefined,'actions');content.append(actions);action(actions,item.kind==='coffee'?'Preparar um café':active?'Desligar':'Ligar',()=>{if(item.kind==='coffee'){orderPlayerCoffee();return;}office().setStationActive(item.roomId,!active);showStation(item);},true);
}
function showElevator(){
 selected={kind:'elevator'};const inCabin=walker.active&&insideCabin();const content=panel('ELEVADOR · SEDE','Escolha seu andar.',inCabin?'As portas se fecham antes de iniciar a viagem.':'Abra a porta e entre na cabine para escolher um destino.');
 const display=node('div',undefined,'lift-display');display.append(node('span','VOCÊ ESTÁ NO','lift-display-label'),node('strong',FLOORS[currentFloor].short),node('span',FLOORS[currentFloor].name,'lift-display-name'));content.append(display);
 const destinations=node('div',undefined,'lift-destinations');content.append(destinations);
 for(const floor of [...FLOORS].reverse()){const here=floor.id===currentFloor,button=node('button',undefined,'lift-floor-choice');button.setAttribute('aria-label',`${floor.short} · ${floor.name}`);button.dataset.current=String(here);button.disabled=!inCabin||here||!!trip;button.append(node('b',floor.short));const caption=node('span');caption.append(node('strong',floor.name),node('small',here?'Você está aqui':floor.label));button.append(caption,node('i',here?'●':'↗'));button.addEventListener('click',()=>startTrip(floor.id));destinations.append(button);}
 const actions=node('div',undefined,'actions');content.append(actions);action(actions,world.elevator.targetOpen?'Fechar porta do elevador':'Abrir porta do elevador',()=>{toast(world.toggleElevator(occupants(currentFloor)).message);showElevator();},true);
}
function startTrip(target){
 if(trip||!walker.active||!insideCabin()||target===currentFloor)return;if(world.elevator.targetOpen){const result=world.toggleElevator(occupants(currentFloor));if(!result.ok){toast(result.message);return;}}
 trip={from:currentFloor,to:target,elapsed:0,phase:'closing',duration:1.6+Math.abs(target-currentFloor)*.7};world.setLiftTravel?.({moving:true,direction:Math.sign(target-currentFloor),targetFloor:target});closeInspector();$('lift-journey').hidden=false;$('lift-progress').textContent=`${FLOORS[currentFloor].short} → ${FLOORS[target].short}`;$('lift-caption').textContent='Fechando as portas…';$('mode-button').disabled=true;viewport.focus({preventScroll:true});
}
function updateTrip(dt){
 if(!trip)return;if(trip.phase==='closing'){if(world.elevator.progress>0)return;trip.phase='moving';$('lift-caption').textContent=trip.to>trip.from?'Subindo…':'Descendo…';}trip.elapsed+=dt;const t=Math.min(1,trip.elapsed/trip.duration),eased=t*t*(3-2*t);groundY=(trip.from+(trip.to-trip.from)*eased)*FLOOR_HEIGHT;world.setLiftHeight(groundY);
 if(t<1)return;const target=trip.to;trip=null;selectFloor(target,{travel:true});actors().visitor.position.set(LIFT_SPAWN.x,groundY,LIFT_SPAWN.z);walker.reset(LIFT_SPAWN);walker.enter({position:LIFT_SPAWN,lookAt:{x:0,y:groundY+1.5,z:-5}});world.elevator.targetOpen=true;world.setLiftTravel?.({moving:false,direction:0,targetFloor:target});$('lift-journey').hidden=true;$('mode-button').disabled=false;toast(`Chegamos: ${FLOORS[target].name}.`);applyVisibility();
}
function interact(item=findNearby()){if(!item||trip)return;if(item.kind==='analytics')return showAnalytics();if(item.kind==='pub')return showPub();if(item.kind==='kart')return showKart();if(item.kind==='rest')return showRest();if(item.kind==='door')return toggleDoor(item.id);if(item.kind==='lift-door'){toast(world.toggleElevator(occupants(currentFloor)).message);return;}if(item.kind==='elevator')return showElevator();if(item.kind==='agent')return showAgent(item.id);if(item.kind==='board')return showBoard();showStation(item);}
function findNearby(){
 if(!walker?.active||trip)return null;const p=walker.position;if(insideCabin())return {kind:'elevator',name:'Escolher andar no elevador',position:LIFT_SPAWN};camera.getWorldDirection(direction);direction.y=0;direction.normalize();
 const candidates=[analyticsBoards.boards[currentFloor].interactable,...(currentFloor===0?[pub.interactable,kart.interactable,campusGround.interactable]:[]),...office().doors.filter(door=>door.id!=='entrance'||currentFloor===0).map(door=>({id:door.id,kind:'door',name:door.name,position:door.position})),...actors().agents.map(agent=>({id:agent.id,kind:'agent',name:`Ver tarefa de ${agent.name}`,position:agent.root.position})),...office().interactables,{kind:'lift-door',name:world.elevator.targetOpen?'Fechar elevador':'Abrir elevador',position:world.elevator.doorPosition},{kind:'lift-door',name:world.elevator.targetOpen?'Fechar elevador':'Abrir elevador',position:world.elevator.callPosition}];let best=null,score=Infinity;
 for(const item of candidates){const point=item.position,distance=Math.hypot(p.x-point.x,p.z-point.z);if(distance>(item.kind==='door'||item.kind==='lift-door'?2.25:2.35))continue;candidateDirection.set(point.x-p.x,0,point.z-p.z).normalize();const facing=direction.dot(candidateDirection);if(facing<-.15)continue;
  if((item.kind==='agent'||item.roomId)&&point.z<8.1&&Math.abs(point.x)<11.4){if(Math.abs(p.x)<2.35&&Math.abs(point.x)>2.45)continue;if(Math.abs(p.x)>2.35&&(Math.sign(point.x)!==Math.sign(p.x)||Math.sign(point.z)!==Math.sign(p.z)))continue;}const next=distance+(1-facing)*.65;if(next<score){best=item;score=next;}}
 return best;
}
function location(p){if(trip)return 'Elevador em movimento';if(insideCabin())return 'Elevador';if(outside()){if(p.x< -31)return 'The Wait Pub';if(p.x>29)return 'Circuito Sede';if(p.x< -5&&p.z>10&&p.z<17)return 'Jardim de pausa';return 'Parque da sede';}if(Math.abs(p.x)<2.32)return p.z>5.3?'Recepção':'Corredor central';return ROOMS.find(room=>Math.sign(room.x)===Math.sign(p.x)&&Math.sign(room.z)===Math.sign(p.z))?.name||'Sede';}
function buildAgentList(){const list=$('agent-list');list.replaceChildren();for(const agent of actors()?.agents||[]){const button=node('button',undefined,'agent-row');button.dataset.agent=agent.id;button.setAttribute('aria-label',`Acompanhar ${agent.name}`);const text=node('span',undefined,'agent-row-text');text.append(node('strong',agent.name),node('small','Preparando…'));const cost=node('span','US$ 0','agent-row-cost');button.append(portrait(agent,'agent-portrait'),text,cost);button.addEventListener('click',()=>showAgent(agent.id));list.append(button);}}
function refreshMetrics(){
 refreshBoard();
 for(const floor of floors){
  const tasks=floor.life?.getSnapshot()||[],done=tasks.reduce((sum,item)=>sum+item.completedTasks,0),total=done+tasks.length;
  const previous=floor.office.group.userData.boardProgress;
  if(previous?.done!==done||previous?.total!==total)floor.office.setBoardProgress(done,total);
 }
 const items=snapshot();$('working-count').textContent=items.filter(item=>item.status==='working').length;$('paused-count').textContent=items.filter(inPause).length;$('active-count').textContent=items.filter(item=>!inPause(item)).length;$('token-total').textContent=count(items.reduce((sum,item)=>sum+item.tokens,0));$('cost-total').textContent=money(items.reduce((sum,item)=>sum+item.cost,0));$('task-total').textContent=count(items.reduce((sum,item)=>sum+item.completedTasks,0));
 for(const item of items){const button=document.querySelector(`[data-agent="${item.id}"]`);if(!button)continue;button.dataset.status=item.status;button.querySelector('strong').textContent=item.name;button.querySelector('small').textContent=item.status==='working'?(item.task?.tool?.label||'Trabalhando'):activityLabel(item);button.querySelector('.agent-row-cost').textContent=money(item.cost);button.title=`${item.task?.title||item.destination||''} · ${count(item.tokens)} tokens simulados`;}
}
function updateUi(now){
 if(peaceBehavior){const reactionState=peaceBehavior.getSnapshot();viewport.dataset.peaceReducedMotion=String(reactionState.reducedMotion);viewport.dataset.peaceBehaviors=JSON.stringify(reactionState.active.map(({label,phase,position,cover,launchLift,launchProgress,launchBlocked,launchedOnce,launchVertical,somersault,completedTurns,launchDistance,launchPitch,landingProgress,getupProgress})=>({label,phase,position,cover,launchLift,launchProgress,launchBlocked,launchedOnce,launchVertical,somersault,completedTurns,launchDistance,launchPitch,landingProgress,getupProgress})));viewport.dataset.peaceCompleted=JSON.stringify(reactionState.completed.slice(-3));}
 refreshEnvironment();
 document.querySelector('.mini-map').hidden=outside();
 const p=pstate();$('map-person').style.left=`${Math.max(0,Math.min(100,(p.x+11)/22*100))}%`;$('map-person').style.top=`${Math.max(0,Math.min(100,(p.z+10.7)/18.7*100))}%`;viewport.dataset.position=`${p.x.toFixed(2)},${p.z.toFixed(2)}`;viewport.dataset.height=(kart.active?kart.getSnapshot().altitude:groundY).toFixed(2);viewport.dataset.floor=String(currentFloor);viewport.dataset.mode=kart.active?'kart':walker?.active?'first-person':campus?'campus':'overview';viewport.dataset.travel=trip?.phase||'idle';
 $('location-label').textContent=kart.active?location(p):walker.active?`${FLOORS[currentFloor].short} · ${location(p)}`:campus?'Parque & edifício':FLOORS[currentFloor].label;for(const room of ROOMS){const label=document.querySelector(`[data-door-label="${room.id}"]`);if(label)label.textContent='Porta '+doorStatus(office().getDoor(room.id)).toLowerCase();}if(selected?.kind==='room'&&$('selected-door-status'))$('selected-door-status').textContent=doorStatus(office().getDoor(selected.id));refreshMetrics();refreshAgent();refreshCampusUi();nearby=findNearby();const prompt=$('interaction-prompt');prompt.hidden=!nearby||!$('inspector').hidden||Boolean(playerDrink?.getSnapshot().holding);
 if(nearby){const text=nearby.kind==='door'?`${office().getDoor(nearby.id).targetOpen?'Fechar':'Abrir'} · ${nearby.name}`:nearby.name;prompt.querySelector('span').textContent=text;prompt.setAttribute('aria-label',`F: ${text}`);}if(toastUntil&&now>toastUntil){$('toast').hidden=true;toastUntil=0;}
}
function resize(){const {width,height}=viewport.getBoundingClientRect();renderer.setSize(width,height);atmosphere.resize();camera.aspect=width/height;if(!walker?.active&&!kart.active&&width>1000)camera.setViewOffset(width,height,80,0,width,height);else camera.clearViewOffset();camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(viewport);
$('mode-button').addEventListener('click',()=>kart.active?leaveKart(true):walker?.active?(closeInspector(),overview()):enter());
$('close-inspector').addEventListener('click',()=>{closeInspector();if(walker?.active||kart.active)viewport.focus({preventScroll:true});});
$('metrics-toggle')?.addEventListener('click',()=>{if(!$('inspector').hidden){closeInspector();metricsOpen=true;}else metricsOpen=!metricsOpen;syncPanels();});
$('board-button').addEventListener('click',()=>{if(ready&&!trip)showBoard();});
$('analytics-button').addEventListener('click',showAnalytics);
$('music-button').addEventListener('click',showMusic);
$('customization-button').addEventListener('click',()=>showCustomization());
$('analytics-summary-button').addEventListener('click',showAnalytics);
$('environment-button').addEventListener('click',()=>{if(ready&&!trip)showEnvironment();});
$('walk-settings-button').addEventListener('click',()=>{if(ready&&!trip)showWalkSettings();});
$('campus-button').addEventListener('click',()=>{if(ready&&!trip)showCampus();});
$('kart-exit').addEventListener('click',()=>leaveKart(true));
$('exterior-button').addEventListener('click',()=>{if(!ready||trip||!leaveKart(false))return;closeInspector();walker.exit();campus=true;overview();});
$('interaction-prompt').addEventListener('click',()=>interact());
$('drink-sip').addEventListener('click',sipPlayerDrink);
$('simulation-button').addEventListener('click',()=>{
 simulationRunning=!simulationRunning;for(const floor of floors)floor.life?.setRunning(simulationRunning);
 // Input can arrive before the next animation frame after resuming.
 const view=peaceContext();peaceBehavior?.update(0,{running:simulationRunning});peaceReactions?.update(0,{running:simulationRunning,visible:view.active&&!view.blocked});
 $('simulation-button').textContent=simulationRunning?'Ⅱ':'▶';$('simulation-button').setAttribute('aria-label',simulationRunning?'Pausar simulação':'Retomar simulação');toast(simulationRunning?'Simulação retomada.':'Simulação pausada. Você pode continuar explorando.');if(kart.active||walker?.active)viewport.focus({preventScroll:true});
});
$('reception-button').addEventListener('click',()=>{if(!ready||trip||!leaveKart(false))return;const active=walker.active;closeInspector();campus=false;actors().visitor.position.set(SPAWN.x,groundY,SPAWN.z);if(active){walker.reset();walker.enter({position:SPAWN,lookAt:{x:0,y:groundY+1.5,z:0}});}else overview();toast(`Recepção · ${FLOORS[currentFloor].label}.`);});
document.addEventListener('keydown',event=>{if(analyticsPanel?.getState().open)return;if(event.key==='Escape'&&musicPlayer?.getState().open&&!musicPlayer.getState().minimized){event.preventDefault();musicPlayer.close();if(walker?.active||kart.active)viewport.focus({preventScroll:true});return;}if(overlayBlocksMovement())return;if(event.key==='Escape'&&kart.active){event.preventDefault();leaveKart(true);return;}if(event.key==='Escape'&&!$('inspector').hidden){closeInspector();if(walker?.active||kart.active)viewport.focus({preventScroll:true});}});
for(const floor of FLOORS){const button=node('button',undefined,'floor-button');button.dataset.floor=floor.id;button.setAttribute('aria-pressed',String(floor.id===0));button.style.setProperty('--floor',floor.color);button.append(node('b',floor.short),node('span',floor.name));button.addEventListener('click',()=>selectFloor(floor.id));$('floor-rail').append(button);}
for(const room of ROOMS){const button=node('button',undefined,'room-button');button.dataset.room=room.id;button.style.setProperty('--room',room.color);button.setAttribute('aria-pressed','false');button.append(node('span',undefined,'color-dot'),node('strong',room.name));const small=node('small','Porta fechada');small.dataset.doorLabel=room.id;button.append(small);button.addEventListener('click',()=>{if(ready&&!trip)showRoom(room.id);});$('room-dock').append(button);}
let pressStart=null;renderer.domElement.addEventListener('pointerdown',event=>{pressStart={x:event.clientX,y:event.clientY};});
renderer.domElement.addEventListener('pointerup',event=>{if(!ready||trip||walker.active||kart.active||!pressStart||Math.hypot(event.clientX-pressStart.x,event.clientY-pressStart.y)>5)return;const rect=renderer.domElement.getBoundingClientRect();pickRay.setFromCamera({x:(event.clientX-rect.left)/rect.width*2-1,y:1-(event.clientY-rect.top)/rect.height*2},camera);const hits=pickRay.intersectObjects(actors().agents.map(agent=>agent.root),true);if(hits.length){let object=hits[0].object;while(object&&!object.userData.actorId)object=object.parent;if(object?.userData.actorId)showAgent(object.userData.actorId);}});
async function init(){
 musicPlayer=createMusicPlayer({onPlaybackChange:value=>{pub?.setMusicState({playing:value.playing&&value.volume!==0});$('music-button').dataset.playing=String(value.playing);}});
 const restoreMusicFocus=event=>{if((event.key==='Escape'||event.target.closest?.('#music-close,#music-minimize'))&&(walker?.active||kart.active)){const music=musicPlayer.getState();if(!music.open||music.minimized)viewport.focus({preventScroll:true});}};musicPlayer.element.addEventListener('click',restoreMusicFocus);musicPlayer.element.addEventListener('keydown',restoreMusicFocus);
 analyticsPanel=createAnalyticsPanel({store:analyticsStore,getAgentName:(id,fallback)=>characterTargets(id)[0]?.record.name||fallback,onChange:value=>analyticsBoards.update(value),onClose:()=>{kart.setInputEnabled?.(true);if(walker?.active||kart.active)viewport.focus({preventScroll:true});}});analyticsBoards.update({state:analyticsPanel.getState(),result:analyticsPanel.getResult()});
 taskComposer=createTaskComposer({getPeople:customizationPeople,onClose:()=>{kart.setInputEnabled(true);if(walker?.active||kart.active)viewport.focus({preventScroll:true});}});
 const response=await fetch('../cube-world-lab/assets/manifest.json');if(!response.ok)throw new Error('Manifesto dos personagens indisponível.');const manifest=await response.json(),loader=new GLTFLoader(),cache=new Map();const loadModel=id=>{if(!cache.has(id)){const entry=manifest.models.find(model=>model.id===id);cache.set(id,loader.loadAsync('../cube-world-lab/'+entry.path));}return cache.get(id);};
 for(const floor of floors){floor.actors=await createActors({scene,viewport,manifest,loadModel,configs:agentsForFloor(floor.info.id),baseY:floor.info.id*FLOOR_HEIGHT});floor.life=createLife({actors:floor.actors,office:floor.office,floorId:floor.info.id,getVisitor:()=>floor.info.id===currentFloor?{x:pstate().x,z:pstate().z,radius:.3}:null,getOutdoorObstacles:outdoorObstacles,getOutdoorActors:outdoorActors,outdoorBounds:world.bounds,restSpots:floor.info.id===0?campusGround.restSpots:undefined});}
 restoreCustomization();const records=floors.flatMap(floor=>floor.actors.records);createActorPortraits(renderer,records,{size:160});
 customizationPanel=createCustomizationPanel({options:CUSTOMIZATION_OPTIONS,getPeople:customizationPeople,onChange:(id,patch)=>customizeCharacter(id,patch),onReset:id=>customizeCharacter(id,null,{reset:true}),onName:(id,name)=>customizeCharacter(id,null,{name}),onPreview:characterPreview,onClose:()=>{if(walker?.active||kart.active)viewport.focus({preventScroll:true});}});
 for(const record of records){record.tag.element.prepend(portrait(record,'tag-portrait'));if(!record.person)record.tag.element.addEventListener('click',()=>showAgent(record.id));}
 pub=await createCampusPub({scene,manifest,loadModel,getVisitor:groundVisitor,getActors:()=>[...(airTraffic?.getColliders()||[]),...(parkPeople?.getColliders()||[]),...(floors[0].actors?.getColliders()||[])]});
 parkPeople=await createParkPeople({scene,manifest,loadModel,getObstacles:outdoorObstacles,getActors:()=>[...(floors[0].actors?.getColliders()||[]),...(kart.getColliders?.()||[]),...(airTraffic?.getColliders()||[])],getVisitor:groundVisitor});
 airTraffic=await createAirTraffic({scene,bounds:world.bounds,manifest,loadModel,
  getObstacles:()=>[...world.getObstacles(),...campusGround.obstacles,...pub.obstacles,...kart.obstacles,...floors[0].office.getObstacles()],
  getFlightObstacles:staticFlightObstacles,
  getActors:()=>[...floors[0].actors.getColliders(),...parkPeople.getColliders(),...pub.getColliders(),...kart.getColliders(),...(groundVisitor()?[groundVisitor()]:[])],
  onDoor:()=>{const door=floors[0].office.getDoor('entrance');if(door&&!door.targetOpen)floors[0].office.toggleDoor('entrance',occupants(0));}
 });
 walker=createWalker({camera,element:viewport,getObstacles:()=>[...office().getObstacles(),...outdoorObstacles()],getActors:()=>[...actors().getColliders(),...(currentFloor===0?outdoorActors():[])],getBounds:()=>currentFloor===0?world.bounds:INTERNAL_BOUNDS,getGroundY:()=>groundY,isMovementLocked:()=>!!trip||overlayBlocksMovement(),onExit:()=>{closeInspector();campus=false;overview();},onInteract:()=>playerDrink?.getSnapshot().holding?sipPlayerDrink():interact(),onMove:(p,yaw)=>{actors().visitor.position.set(p.x,groundY,p.z);actors().visitor.rotation.y=yaw+Math.PI;}});
 peaceBindings=[...floors.flatMap(floor=>floor.life.getPeaceBindings()),...pub.getPeaceBindings(),...parkPeople.getPeaceBindings(),...airTraffic.getPeaceBindings()];
 // The requested NPC impulse is gameplay motion. OS motion reduction still
 // controls weapon flashes/recoil; the player's camera receives no impact shake.
 peaceBehavior=createPeaceBehavior({bindings:peaceBindings,getOrigin:()=>camera.getWorldPosition(new THREE.Vector3())});
 peaceReactions=createPeaceReactions({scene,camera,viewport,getAgents:()=>floors.flatMap(floor=>floor.actors.records.filter(record=>!record.person)),onActorHit:(event,target)=>peaceBehavior.trigger(target.id,{origin:camera.getWorldPosition(new THREE.Vector3()),direction:event.direction,point:event.point,direct:true})});
 peaceAbility=createPeaceAbility({scene,camera,element:viewport,getTargets:peaceTargets,onFeedback:peaceFeedback,onShot:reactToPeaceShot});
 peaceControls=createPeaceControls({ability:peaceAbility,element:viewport,hud:$('peace-hud'),getContext:peaceContext,onEquip:()=>{metricsOpen=false;syncPanels();}});
 playerDrink=createPlayerDrink({camera,onFeedback:toast,onPickup:()=>peaceControls.holster(),reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches});
 ready=true;$('loading').hidden=true;$('mode-button').disabled=false;viewport.dataset.ready='true';selectFloor(0);updateUi(performance.now());
}
function frame(now){
 requestAnimationFrame(frame);if(document.hidden){lastFrame=now;nextFrameAt=now;return;}if(now<nextFrameAt)return;
 // Keep the 30 Hz deadline independent of rAF jitter; dt remains real elapsed time.
 nextFrameAt=now+1000/30-((now-nextFrameAt)%(1000/30));const elapsed=Math.max(0,(now-lastFrame)/1000||.033),dt=Math.min(.07,elapsed);lastFrame=now;
 peaceBehavior?.update(dt,{running:simulationRunning});
 if(ready){kart.setInputEnabled(!overlayBlocksMovement());world.update(dt,occupants(currentFloor));updateTrip(dt);walker.update(dt);for(const floor of floors){floor.life.update(dt);floor.office.update(dt,occupants(floor.info.id),{coffeeRunning:simulationRunning});}if(!walker.active&&!kart.active)controls.update();for(const floor of floors)floor.actors.update({camera,firstPerson:walker.active&&floor.info.id===currentFloor,focusedId:walker.active&&nearby?.kind==='agent'?nearby.id:null,showVisitor:floor.info.id===currentFloor&&!kart.active,showTags:floor.info.id===currentFloor&&!trip&&!kart.active&&(!campus||walker.active),dt,occluders:[...floor.office.occluders,world.elevator.group]});}
 if(ready){parkPeople.update(simulationRunning?dt:0,{camera});pub.update(dt,{running:simulationRunning,camera});kart.update(dt,{running:simulationRunning,camera});airTraffic.update(dt,{running:simulationRunning});applyEnvironment(dayCycle.update(elapsed));}else sky.update(environment,camera);
 updatePlayerDrink(dt);peaceControls?.update(dt);const peaceView=peaceContext();peaceReactions?.update(dt,{running:simulationRunning,visible:peaceView.active&&!peaceView.blocked});
 world.updateDetails?.(camera);updatePubSpeech();atmosphere.render();peaceAbility?.renderOverlay(renderer);playerDrink?.renderOverlay(renderer);frames++;if(now-lastUi>250&&ready){updateUi(now);lastUi=now;}if(now-lastStats>=1000){$('performance').textContent=`${Math.round(frames*1000/(now-lastStats))} fps · ${renderer.info.render.calls} desenhos`;$('performance').title=`${renderer.info.render.triangles.toLocaleString('pt-BR')} triângulos por quadro`;lastStats=now;frames=0;}
}
document.addEventListener('visibilitychange',()=>{lastFrame=performance.now();nextFrameAt=lastFrame;});
overview();resize();init().catch(error=>{console.error(error);$('loading').hidden=false;$('loading').querySelector('h1').textContent='Não foi possível abrir a sede';$('loading').querySelector('p').textContent=error.message;});requestAnimationFrame(frame);




import * as THREE from 'three';
import { SPAWN, FLOOR_BOUNDS } from './layout.js';
import { isWalkable, moveWithCollision } from './navigation.js';

const EYE_HEIGHT = 1.55;
const MAX_PITCH = 85 * Math.PI / 180;
export const WALKER_SPEEDS = Object.freeze({ walk: 4.4, run: 7.6 });
const { walk: WALK_SPEED, run: RUN_SPEED } = WALKER_SPEEDS;
const ACCELERATION = 22, DECELERATION = 44, LOOK_RESPONSE = 30;
const BOB_MAX_CYCLES_PER_SECOND = 1.1; // Two vertical pulses: at most 2.2 Hz.
const DEFAULT_PREFERENCES = { speedMultiplier: 1, lookSensitivity: 1, headBob: true };
const PREFERENCE_LIMITS = { speedMultiplier: [.5, 1.5], lookSensitivity: [.4, 2] };
const CODES = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyQ','KeyE','ShiftLeft','ShiftRight']);
const KEY_CODES = {w:'KeyW',a:'KeyA',s:'KeyS',d:'KeyD',q:'KeyQ',e:'KeyE',f:'KeyF',Shift:'ShiftLeft'};

export function createWalker({camera,element,getObstacles=()=>[],getActors=()=>[],getBounds=()=>FLOOR_BOUNDS,
  getGroundY=()=>0,isMovementLocked=()=>false,onExit=()=>{},onInteract=()=>{},onMove=()=>{}}) {
  const document=element.ownerDocument, window=document.defaultView;
  const keys=new Set(), rotation=new THREE.Euler(0,0,0,'YXZ');
  const position={x:SPAWN.x,z:SPAWN.z};
  let active=false,yaw=0,pitch=0,targetYaw=0,targetPitch=0,drag=null;
  let velocityX=0,velocityZ=0,bobPhase=0;
  let preferences={...DEFAULT_PREFERENCES};
  const motionQuery=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let reducedMotion=Boolean(motionQuery?.matches);
  const hasFocus=()=>document.activeElement===element || (document.activeElement?.tagName==='CANVAS' && element.contains(document.activeElement));
  const isControl=target=>Boolean(target?.closest?.('input,select,textarea,button,a,[contenteditable],[role="button"],[role="slider"],[role="combobox"]'));
  const keyCode=event=>event.code || KEY_CODES[event.key?.toLowerCase()] || KEY_CODES[event.key] || event.key;
  function clearInput(){
    keys.clear();releaseDrag();velocityX=0;velocityZ=0;bobPhase=0;
    targetYaw=yaw;targetPitch=pitch;
    if(active)camera.position.set(position.x,eyeY(),position.z);
  }
  function releaseDrag(){
    if(!drag)return;
    const previous=drag;drag=null;
    try {if(previous.target.hasPointerCapture?.(previous.id)) previous.target.releasePointerCapture(previous.id);}catch{}
  }
  function applyLook(){
    pitch=THREE.MathUtils.clamp(pitch,-MAX_PITCH,MAX_PITCH);
    const turns=Math.trunc(yaw/(Math.PI*2))*Math.PI*2;
    yaw-=turns;targetYaw-=turns;
    rotation.set(pitch,yaw,0,'YXZ');camera.quaternion.setFromEuler(rotation);
  }
  function updateLook(dt){
    const turn=Number(keys.has('KeyQ'))-Number(keys.has('KeyE'));
    const turnRate=turn*1.6*preferences.lookSensitivity;
    const previousTarget=targetYaw,decay=Math.exp(-LOOK_RESPONSE*dt);
    targetYaw+=turnRate*dt;
    // Exact response to a continuously moving keyboard target. A mouse drag is
    // a target step, so both input types remain consistent at different fps.
    yaw=targetYaw-turnRate/LOOK_RESPONSE+(yaw-previousTarget+turnRate/LOOK_RESPONSE)*decay;
    pitch=targetPitch+(pitch-targetPitch)*decay;
    applyLook();
  }
  function valid(p){
    return isWalkable(p.x,p.z,getObstacles(),.25,getBounds()) && getActors().every(a=>Math.hypot(p.x-a.x,p.z-a.z)>=a.radius+.25);
  }
  const eyeY=()=>getGroundY()+EYE_HEIGHT;
  function notify(){onMove({x:position.x,z:position.z},yaw);}
  function enter({position:requested=position,lookAt={x:0,y:getGroundY()+1.4,z:-3}}={}){
    clearInput();
    if(!valid(requested))return false;
    position.x=requested.x;position.z=requested.z;
    camera.position.set(position.x,eyeY(),position.z);
    camera.lookAt(lookAt.x,lookAt.y??getGroundY()+1.4,lookAt.z);
    rotation.setFromQuaternion(camera.quaternion,'YXZ');yaw=rotation.y;pitch=rotation.x;targetYaw=yaw;targetPitch=pitch;applyLook();
    active=true;element.focus({preventScroll:true});notify();return true;
  }
  function exit(){active=false;clearInput();}
  function reset(requested=SPAWN){
    if(!valid(requested))return false;
    clearInput();position.x=requested.x;position.z=requested.z;
    if(active)camera.position.set(position.x,eyeY(),position.z);
    notify();return true;
  }
  function update(dt){
    if(!active || !Number.isFinite(dt) || dt<=0)return;
    camera.position.set(position.x,eyeY(),position.z);
    if(document.hidden || !hasFocus()){clearInput();notify();return;}
    if(isMovementLocked()){clearInput();notify();return;}
    updateLook(dt);
    const forward=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'));
    const right=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
    const magnitude=Math.hypot(forward,right);
    const speed=(keys.has('ShiftLeft')||keys.has('ShiftRight')?RUN_SPEED:WALK_SPEED)*preferences.speedMultiplier;
    const targetX=magnitude?(right*Math.cos(yaw)-forward*Math.sin(yaw))*speed/magnitude:0;
    const targetZ=magnitude?(-right*Math.sin(yaw)-forward*Math.cos(yaw))*speed/magnitude:0;
    const response=magnitude?ACCELERATION:DECELERATION,decay=Math.exp(-response*dt);
    // Integrating velocity analytically avoids a faster/slower walk at 30/60fps.
    const dx=targetX*dt+(velocityX-targetX)*(1-decay)/response;
    const dz=targetZ*dt+(velocityZ-targetZ)*(1-decay)/response;
    velocityX=targetX+(velocityX-targetX)*decay;
    velocityZ=targetZ+(velocityZ-targetZ)*decay;
    const next=moveWithCollision(position,dx,dz,getObstacles(),getActors(),getBounds());
    const movedX=next.x-position.x,movedZ=next.z-position.z;
    if(Math.abs(movedX-dx)>1e-6)velocityX=0;
    if(Math.abs(movedZ-dz)>1e-6)velocityZ=0;
    if(!magnitude&&Math.hypot(velocityX,velocityZ)<.001){velocityX=0;velocityZ=0;}
    position.x=next.x;position.z=next.z;
    const distance=Math.hypot(movedX,movedZ);
    let bobY=0,bobSide=0;
    if(preferences.headBob&&!reducedMotion&&distance>1e-6){
      // Faster traversal lengthens the visual stride instead of vibrating the
      // camera. Only distance actually travelled advances this bounded cadence.
      bobPhase=(bobPhase+Math.min(distance/1.5,BOB_MAX_CYCLES_PER_SECOND*dt)*Math.PI*2)%(Math.PI*2);
      const strength=Math.min(1,distance/dt/WALK_SPEED);
      bobY=Math.sin(bobPhase*2)*.01*strength;
      bobSide=Math.sin(bobPhase)*.0035*strength;
    }
    camera.position.set(position.x+Math.cos(yaw)*bobSide,eyeY()+bobY,position.z-Math.sin(yaw)*bobSide);notify();
  }
  function getPreferences(){return {...preferences};}
  function setPreferences(patch){
    if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new TypeError('Movement preferences must be an object.');
    const next={...preferences};
    for(const [key,value]of Object.entries(patch)){
      if(!Object.hasOwn(DEFAULT_PREFERENCES,key))throw new TypeError(`Unknown movement preference: ${key}`);
      if(key==='headBob'){
        if(typeof value!=='boolean')throw new TypeError('headBob must be a boolean.');
      }else{
        if(typeof value!=='number')throw new TypeError(`${key} must be a number.`);
        const [min,max]=PREFERENCE_LIMITS[key];
        if(!Number.isFinite(value)||value<min||value>max)throw new RangeError(`${key} must be between ${min} and ${max}.`);
      }
      next[key]=value;
    }
    preferences=next;
    if(!preferences.headBob&&active)camera.position.set(position.x,eyeY(),position.z);
    return getPreferences();
  }
  element.addEventListener('keydown',event=>{
    if(!active || !hasFocus() || isControl(event.target) || event.ctrlKey || event.altKey || event.metaKey)return;
    const code=keyCode(event);
    if(isMovementLocked()){if(CODES.has(code)||code==='KeyF'||code==='Escape')event.preventDefault();return;}
    if(code==='Escape'){event.preventDefault();exit();onExit();return;}
    if(code==='KeyF'){event.preventDefault();if(!event.repeat)onInteract();return;}
    if(CODES.has(code)){event.preventDefault();keys.add(code);}
  });
  element.addEventListener('keyup',event=>{const code=keyCode(event);keys.delete(code);if(active&&hasFocus()&&!isControl(event.target)&&CODES.has(code))event.preventDefault();});
  element.addEventListener('pointerdown',event=>{
    if(!active||document.hidden||isMovementLocked()||event.target.tagName!=='CANVAS'||event.button!==0||drag)return;
    element.focus({preventScroll:true});event.preventDefault();
    drag={id:event.pointerId,target:event.target,x:event.clientX,y:event.clientY};
    try{event.target.setPointerCapture(event.pointerId);}catch{}
  });
  element.addEventListener('pointermove',event=>{
    if(!active||!drag||event.pointerId!==drag.id)return;
    if(document.hidden||!hasFocus()||isMovementLocked()){clearInput();return;}
    event.preventDefault();targetYaw-=(event.clientX-drag.x)*.004*preferences.lookSensitivity;
    targetPitch=THREE.MathUtils.clamp(targetPitch-(event.clientY-drag.y)*.0035*preferences.lookSensitivity,-MAX_PITCH,MAX_PITCH);
    drag.x=event.clientX;drag.y=event.clientY;
  });
  const stopDrag=event=>{if(event.pointerId===drag?.id)releaseDrag();};
  element.addEventListener('pointerup',stopDrag);element.addEventListener('pointercancel',stopDrag);element.addEventListener('lostpointercapture',stopDrag);
  element.addEventListener('blur',clearInput);element.addEventListener('focusout',clearInput);window.addEventListener('blur',clearInput);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInput();});
  motionQuery?.addEventListener?.('change',event=>{
    reducedMotion=Boolean(event.matches);bobPhase=0;
    if(reducedMotion&&active)camera.position.set(position.x,eyeY(),position.z);
  });
  return{enter,exit,reset,update,setPreferences,getPreferences,get active(){return active;},get position(){return position;},get eyeHeight(){return EYE_HEIGHT;}};
}

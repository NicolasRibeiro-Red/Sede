import * as THREE from 'three';

// The cup belongs to the player, rather than to one of the four floor avatars.
export function createPlayerDrink({camera,onFeedback=()=>{},onPickup=()=>{},reducedMotion=false}){
 const scene=new THREE.Scene(),group=new THREE.Group(),hand=new THREE.Group();scene.add(group);group.add(hand);group.visible=false;group.name='Uma pausa · mão e bebida';
 scene.add(new THREE.HemisphereLight('#e4f0ec','#746452',2.1));const light=new THREE.DirectionalLight('#fff2d7',1.7);light.position.set(-2,3,2);scene.add(light);
 const geometries=new Set(),materials=new Set();
 const mat=(color,options={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.55,metalness:0,fog:false,...options});materials.add(m);return m;};
 const ceramic=mat('#f2eee2'),accent=mat('#426b62'),skin=mat('#cfa78b'),sleeve=mat('#526a86'),liquidMaterial=mat('#382318');
 const mesh=(geometry,material,parent=hand)=>{geometries.add(geometry);const object=new THREE.Mesh(geometry,material);parent.add(object);return object;};
 const mug=new THREE.Group();hand.add(mug);
 mesh(new THREE.CylinderGeometry(.086,.071,.19,12,1,true),ceramic,mug);
 mesh(new THREE.CylinderGeometry(.078,.065,.182,12,1,true),mat('#e5dfd1',{side:THREE.BackSide}),mug);
 const bottom=mesh(new THREE.CylinderGeometry(.071,.071,.012,12),ceramic,mug);bottom.position.y=-.09;
 const rim=mesh(new THREE.TorusGeometry(.082,.007,5,16),ceramic,mug);rim.rotation.x=Math.PI/2;rim.position.y=.095;
 const band=mesh(new THREE.CylinderGeometry(.084,.079,.035,12,1,true),accent,mug);band.position.y=.012;
 const handle=mesh(new THREE.TorusGeometry(.054,.013,5,12),ceramic,mug);handle.position.set(.1,0,0);
 const liquid=mesh(new THREE.CylinderGeometry(.077,.077,.006,12),liquidMaterial,mug);liquid.position.y=.075;
 const arm=mesh(new THREE.BoxGeometry(.085,.2,.09),sleeve);arm.position.set(.155,-.19,.035);arm.rotation.z=-.27;
 const palm=mesh(new THREE.BoxGeometry(.065,.078,.065),skin);palm.position.set(.13,-.055,.008);
 for(let i=0;i<3;i++){const finger=mesh(new THREE.BoxGeometry(.045,.017,.029),skin);finger.position.set(.1,-.029-i*.02,.055);finger.rotation.y=.2;}
 const thumb=mesh(new THREE.BoxGeometry(.024,.046,.036),skin);thumb.position.set(.094,.012,.017);thumb.rotation.z=-.4;
 const steam=Array.from({length:4},(_,i)=>{const m=mat('#fff6e8',{transparent:true,opacity:.12,depthWrite:false});const p=mesh(new THREE.SphereGeometry(.015,5,4),m,mug);p.userData.offset=i/4;return p;});
 let request=null,phase='empty',age=0,elapsed=0,consumed=0,disposed=false,visible=false,canAct=false;
 const smooth=t=>{t=THREE.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};
 const held=new THREE.Vector3(.24,-.25,-.63),mouth=new THREE.Vector3(.08,-.07,-.38),below=new THREE.Vector3(.39,-.67,-.78);
 function begin(value){if(disposed||request||!['coffee','pub'].includes(value?.kind)||typeof value.ready!=='function'||typeof value.claim!=='function')return false;request=value;phase='waiting';age=0;return true;}
 function sip(){if(disposed||phase!=='held'||!canAct)return false;phase='sipping';age=0;onFeedback('Um gole. Uma pausa.');return true;}
 function update(dt,{active=true,blocked=false,running=true,nearSource=false,appearance}={}){
  if(disposed)return;visible=active&&!blocked;canAct=visible&&running;
  const step=canAct?Math.min(.1,Math.max(0,Number(dt)||0)):0;elapsed+=step;
  if(appearance){skin.color.set(appearance.skin||'#cfa78b');sleeve.color.set(appearance.shirt||'#526a86');}
  if(phase==='waiting'&&canAct&&nearSource&&request.ready()&&request.claim()){
   phase='pickup';age=0;liquid.position.y=.075;liquidMaterial.color.set(request.kind==='coffee'?'#382318':'#bb7d35');onPickup();onFeedback(request.kind==='coffee'?'Café na mão. F para beber.':'Brinde na mão. F para beber.');
  }
  if(phase==='pickup'||phase==='sipping'){age+=step;if(phase==='pickup'&&age>=.75){phase='held';age=0;}else if(phase==='sipping'&&age>=3.2){consumed++;phase='empty';age=0;request=null;onFeedback('Pausa feita. De volta ao passeio.');}}
  group.visible=visible&&['pickup','held','sipping'].includes(phase);
  camera.getWorldPosition(group.position);camera.getWorldQuaternion(group.quaternion);hand.position.copy(held);hand.rotation.set(0,0,-.08);
  if(phase==='pickup'){hand.position.lerpVectors(below,held,smooth(age/.75));hand.rotation.z=-.3+.22*smooth(age/.75);}
  if(phase==='held'&&!reducedMotion)hand.position.y+=Math.sin(elapsed*1.7)*.003;
  if(phase==='sipping'){
   const raise=smooth(age/.85),lower=smooth((age-2.15)/1.05),tilt=smooth((age-.5)/.6)*(1-smooth((age-1.9)/.45));
   hand.position.lerpVectors(held,mouth,raise).lerp(below,lower);hand.rotation.x=.58*tilt;hand.rotation.z=-.08-.1*tilt;
   liquid.position.y=.075-.14*smooth((age-.95)/1.05);
  }
  for(const p of steam){const t=(elapsed*.55+p.userData.offset)%1;p.visible=request?.kind==='coffee'&&phase!=='sipping';p.position.set(Math.sin(t*6+p.userData.offset)*.028,.13+t*.17,0);p.scale.setScalar(.55+t);p.material.opacity=reducedMotion?0:.13*(1-t);}
  group.updateMatrixWorld(true);
 }
 function getSnapshot(){return {phase,kind:request?.kind||null,sourceFloor:request?.floor??null,source:request?.position||null,ready:phase==='waiting'&&Boolean(request?.ready()),holding:['pickup','held','sipping'].includes(phase),busy:phase==='pickup'||phase==='sipping',visible:group.visible,progress:phase==='sipping'?Math.min(1,age/3.2):phase==='pickup'?Math.min(1,age/.75):0,consumed};}
 function renderOverlay(renderer){if(!group.visible||disposed)return;const autoClear=renderer.autoClear;try{renderer.autoClear=false;renderer.clearDepth();renderer.render(scene,camera);}finally{renderer.autoClear=autoClear;}}
 function dispose(){if(disposed)return;disposed=true;group.visible=false;request=null;phase='empty';geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());scene.clear();}
 return {group,begin,sip,update,getSnapshot,renderOverlay,dispose};
}

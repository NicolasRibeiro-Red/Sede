import * as THREE from 'three';

export const REST_SPOTS = [-8,-10.5,-13,-15.5].map((x,index)=>({id:`garden-seat-${index}`,x,z:14,yaw:0}));

/** Shared paths and a shaded ground-floor pause garden. All surfaces stay level. */
export function createCampusGround(scene){
 const group=new THREE.Group();group.name='Campus · caminhos e jardim de pausa';scene.add(group);
 const geometry=new THREE.BoxGeometry(1,1,1),resources=[geometry],obstacles=[],batches=new Map();
 const colours={path:'#dcdacb',wood:'#a77c54',metal:'#314a43',sage:'#718575',paper:'#f5eddb',leaf:'#507848',soil:'#7c6147',light:'#ffe1a6'};
 const materials=Object.fromEntries(Object.entries(colours).map(([key,color])=>{const mat=new THREE.MeshStandardMaterial({color,roughness:.88});resources.push(mat);return[key,mat];}));
 materials.light.emissive.set('#ffcb80');materials.light.emissiveIntensity=.35;
 const add=(mat,x,y,z,w,h,d,yaw=0)=>{if(!batches.has(mat))batches.set(mat,[]);batches.get(mat).push({x,y,z,w,h,d,yaw});};
 const block=(x,z,w,d,id)=>obstacles.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2,id});
 // New destinations branch off the existing promenade, with no crossing through the fountain.
 add('path',-34,-.034,17,23,.068,3.2);add('path',-44,-.034,15,3.8,.068,5.2);
 add('path',28,-.034,17,12,.068,3.2);add('path',33,-.034,18.5,3.2,.068,4);
 add('path',-11.7,-.032,13.5,12,.064,4.2);
 for(const [i,spot]of REST_SPOTS.entries()){
  for(const dz of [-.36,-.12,.12,.36])add('wood',spot.x,.48,13.7+dz,2.05,.12,.21);
  for(const y of [.8,1.02])add('wood',spot.x,y,13.18,2.05,.18,.09);
  for(const dx of [-.78,.78]){add('metal',spot.x+dx,.23,13.5,.09,.46,.62);add('metal',spot.x+dx,.67,13.16,.08,1.1,.08);}
  // Back supports, leaving the front of the reserved sitting point reachable.
  block(spot.x,13.12,2.06,.16,`pause-bench-${i}`);
 }
 for(const x of [-17.3,-6])for(const z of [11.75,15.2]){
  add('wood',x,1.6,z,.18,3.2,.18);block(x,z,.22,.22,'pause-pergola');
 }
 for(let i=0;i<25;i++)add('wood',-17.5+i*.49,3.24,13.5,.11,.14,4.2);
 for(const z of [11.65,15.3])add('wood',-11.6,3.1,z,11.9,.22,.14);
 // A shared coffee shelf is scenery; the mugs themselves belong to each agent's hand.
 add('sage',-18.2,.55,12.9,.65,1.1,1.65);add('paper',-18.2,1.13,12.9,.78,.08,1.8);
 add('metal',-18.2,1.45,12.6,.42,.58,.48);add('light',-17.97,1.48,12.6,.01,.12,.24);
 block(-18.2,12.9,.75,1.8,'pause-coffee-shelf');
 for(const [x,z]of [[-18.5,15.3],[-5.1,12],[-29,18.9],[28,19.4],[-53,18.9]]){
  add('sage',x,.3,z,.9,.6,.9);add('soil',x,.61,z,.8,.03,.8);
  for(const dx of [-.22,.15])add('leaf',x+dx,.95,z+dx,.55,.65,.55);
  block(x,z,.95,.95,'campus-planter');
 }
 for(const [x,z]of [[-28,15],[-37,15],[-49,16],[27,15],[32,16],[-17,15.1],[-6.3,15.1]]){
  add('metal',x,1.35,z,.11,2.7,.11);add('metal',x,.13,z,.32,.26,.32);
  add('light',x,2.73,z,.42,.12,.42);block(x,z,.35,.35,'campus-light');
 }
 for(const x of [-15,-12,-9]){add('metal',x,2.98,13.5,.06,.25,.06);add('light',x,2.82,13.5,.3,.1,.3);}
 const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),s=new THREE.Vector3();
 for(const [key,parts]of batches){const batch=new THREE.InstancedMesh(geometry,materials[key],parts.length);batch.name=`Campus · ${key}`;
  parts.forEach((p,i)=>{q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,p.yaw);matrix.compose(v.set(p.x,p.y,p.z),q,s.set(p.w,p.h,p.d));batch.setMatrixAt(i,matrix);});
  batch.castShadow=key!=='light'&&key!=='path';batch.receiveShadow=true;group.add(batch);
 }
 function label(text,subtitle,x,y,z,width=3.4){const c=document.createElement('canvas');c.width=768;c.height=192;const ctx=c.getContext('2d');ctx.fillStyle='#f5eddb';ctx.fillRect(0,0,768,192);ctx.fillStyle='#314a43';ctx.textAlign='center';ctx.font='600 48px Inter, Arial';ctx.fillText(text,384,81);ctx.font='28px Inter, Arial';ctx.fillText(subtitle,384,137);const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;const material=new THREE.MeshStandardMaterial({map:texture,roughness:.9,emissiveMap:texture,emissive:'#ffffff',emissiveIntensity:.1});const geo=new THREE.PlaneGeometry(width,width/4);resources.push(texture,material,geo);const sign=new THREE.Mesh(geo,material);sign.position.set(x,y,z);group.add(sign);}
 label('PAUSA BOA','Café · conversa · nenhuma pressa',-11.65,2.94,15.4,4.6);
 label('← THE WAIT PUB','Balcão aberto no campus',-28,1.9,17.5,3.1);
 label('CIRCUITO SEDE →','Kart · boxes · uma volta a mais',27,1.9,17.5,3.1);
 const glow=new THREE.PointLight('#ffd5a0',0,16,2);glow.position.set(-11.6,2.6,13.5);group.add(glow);
 return {group,obstacles,restSpots:REST_SPOTS,interactable:{kind:'rest',name:'Jardim de descanso',position:new THREE.Vector3(-11.6,0,16.8)},
  setNight(value){materials.light.emissiveIntensity=.35+value*1.9;glow.intensity=value*22;glow.visible=value>.02;},
  dispose(){group.removeFromParent();resources.forEach(item=>item.dispose());}
 };
}

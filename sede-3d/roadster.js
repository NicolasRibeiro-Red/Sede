import * as THREE from 'three';

// Original low-poly interpretation of the angular silver 2026 Roadster Rocket
// reference on tesla.com/roadster. Cold-gas flight here is an arcade mechanic.
export function createRoadster({name='Roadster · visitante',color='#dce0e0'}={}) {
  const group=new THREE.Group();group.name=name;
  const geometries=new Set(),materials=new Set(),own=g=>(geometries.add(g),g);
  const mat=(color,options={})=>{const value=new THREE.MeshStandardMaterial({color,roughness:.42,...options});materials.add(value);return value;};
  const paint=mat(color,{metalness:.58}),black=mat('#10191c',{roughness:.52}),glass=mat('#2e2a24',{metalness:.68,roughness:.19}),rubber=mat('#171c20',{roughness:.94}),alloy=mat('#b4bdc0',{metalness:.85,roughness:.28});
  const headlight=mat('#e9f7ff',{emissive:'#c8ecff',emissiveIntensity:.75}),taillight=mat('#ff4340',{emissive:'#ff2928',emissiveIntensity:1});
  const cube=own(new THREE.BoxGeometry(1,1,1)),wheel=own(new THREE.CylinderGeometry(.4,.4,.22,12));wheel.rotateZ(Math.PI/2);
  function mesh(geometry,material){const value=new THREE.Mesh(geometry,material);value.castShadow=true;value.receiveShadow=true;group.add(value);return value;}
  function loft(sections,bottom){
    const positions=[],indices=[];
    for(const [z,w,top]of sections)for(const [x,y]of [[-w,bottom+.08],[-w,top-.1],[-w*.76,top],[w*.76,top],[w,top-.1],[w,bottom+.08],[w*.7,bottom],[-w*.7,bottom]])positions.push(x,y,z);
    for(let row=0;row<sections.length-1;row++)for(let edge=0;edge<8;edge++){const a=row*8+edge,b=row*8+(edge+1)%8,c=a+8,d=b+8;indices.push(a,c,b,b,c,d);}
    for(let i=1;i<7;i++){indices.push(0,i,i+1);const n=(sections.length-1)*8;indices.push(n,n+i+1,n+i);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);const flat=g.toNonIndexed();g.dispose();flat.computeVertexNormals();return own(flat);
  }
  mesh(loft([[-1.8,.69,.63],[-1.42,.91,.8],[-.65,.9,.84],[.35,.88,.75],[1.25,.82,.61],[1.82,.6,.43]],.25),paint);
  mesh(loft([[-1.16,.57,.76],[-.66,.64,1.28],[.12,.6,1.24],[.88,.42,.68]],.69),glass);
  const matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion(),vector=new THREE.Vector3(),scale=new THREE.Vector3();
  function instance(geometry,material,parts){const result=new THREE.InstancedMesh(geometry,material,parts.length);parts.forEach(([p,s,rotation=0],i)=>{matrix.compose(vector.set(...p),quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),rotation),scale.set(...s));result.setMatrixAt(i,matrix);});result.instanceMatrix.needsUpdate=true;result.castShadow=true;result.receiveShadow=true;group.add(result);return result;}
  instance(cube,black,[[[0,.23,1.61],[1.48,.12,.36]],[[0,.24,-1.64],[1.63,.14,.3]],[[-.88,.31,0],[.09,.15,2.6]],[[.88,.31,0],[.09,.15,2.6]],[[0,1.255,-.3],[1.21,.055,.77]],[[0,.72,-1.67],[1.43,.055,.21]],[[-.91,.83,.15],[.22,.09,.24]],[[.91,.83,.15],[.22,.09,.24]]]);
  instance(cube,headlight,[[[-.49,.51,1.63],[.4,.045,.06]],[[.49,.51,1.63],[.4,.045,.06]]]);
  instance(cube,taillight,[[[0,.63,-1.815],[1.35,.055,.04]]]);
  const tireParts=[],hubParts=[],spokeParts=[];
  for(const x of [-.88,.88])for(const z of [-1.12,1.16]){tireParts.push([[x,.4,z],[1,1,1]]);hubParts.push([[x*1.12,.4,z],[.36,.8,.8]]);for(let i=0;i<5;i++){const a=i*Math.PI*2/5;spokeParts.push([[x*1.14,.4+Math.sin(a)*.16,z+Math.cos(a)*.16],[.035,.065,.33],-a]);}}
  instance(wheel,rubber,tireParts);instance(wheel,alloy,hubParts);instance(cube,alloy,spokeParts);
  const nozzleGeo=own(new THREE.CylinderGeometry(.095,.15,.17,8)),nozzles=[];
  for(const x of [-.65,.65])for(const z of [-1.05,1.05])nozzles.push([[x,.22,z],[1,1,1]]);
  instance(nozzleGeo,black,nozzles);
  const gasMaterial=new THREE.MeshBasicMaterial({color:'#effaff',transparent:true,opacity:.35,depthWrite:false});materials.add(gasMaterial);
  const gasGeometry=own(new THREE.ConeGeometry(.24,.85,7)),gas=new THREE.InstancedMesh(gasGeometry,gasMaterial,4);gas.name='Ar comprimido · quatro toberas';gas.visible=false;group.add(gas);
  let elapsed=0,disposed=false;
  return {group,
    update(dt,{flight=false,boost=false,pressure=100}={}){if(disposed)return;elapsed+=Math.min(Math.max(dt,0),.1);gas.visible=flight;gasMaterial.opacity=.17+.23*(pressure/100);if(flight)nozzles.forEach(([p],i)=>{const pulse=.8+Math.sin(elapsed*19+i*1.7)*.13+(boost?.35:0);matrix.compose(vector.set(p[0],-.15-.18*pulse,p[2]),quaternion.identity(),scale.set(.7+.2*pulse,pulse,.7+.2*pulse));gas.setMatrixAt(i,matrix);});gas.instanceMatrix.needsUpdate=flight;},
    setNight(amount){headlight.emissiveIntensity=.75+amount*1.8;taillight.emissiveIntensity=.85+amount*.8;},
    dispose(){if(disposed)return;disposed=true;group.removeFromParent();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}
  };
}

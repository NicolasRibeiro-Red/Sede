import * as THREE from 'three';

// One dome and one star batch. No post-processing or per-frame geometry.
export function createSky(scene) {
  const uniforms = {
    horizon: { value: new THREE.Color('#c9dee4') },
    zenith: { value: new THREE.Color('#7eb8d5') },
    sunDirection: { value: new THREE.Vector3() },
    daylight: { value: 1 }, dusk: { value: 0 }, night: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false,
    fog: false, toneMapped: false,
    vertexShader: `varying vec3 direction;
      void main(){ direction=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 direction;
      uniform vec3 horizon,zenith,sunDirection;
      uniform float daylight,dusk,night;
      void main(){
        vec3 d=normalize(direction);
        float h=max(d.y,0.0);
        vec3 color=mix(horizon,zenith,pow(h,0.55));
        float sunDot=dot(d,sunDirection);
        float sunGlow=pow(max(sunDot,0.0),9.0)*(1.0-smoothstep(0.0,0.7,h));
        color+=vec3(0.42,0.14,0.045)*sunGlow*dusk;
        float sunDisk=smoothstep(0.99965,0.99985,sunDot)*daylight;
        color=mix(color,vec3(1.0,0.88,0.61),sunDisk);
        vec3 moonDirection=normalize(vec3(0.45,0.68,-0.57));
        float moonDot=dot(d,moonDirection);
        color+=vec3(0.06,0.09,0.16)*pow(max(moonDot,0.0),90.0)*night;
        float moonDisk=smoothstep(0.9996,0.99983,moonDot)*night;
        color=mix(color,vec3(0.76,0.84,0.95),moonDisk);
        gl_FragColor=vec4(color,1.0);
        #include <colorspace_fragment>
      }`,
  });
  const group = new THREE.Group();group.name='Céu · dia e noite';
  const dome = new THREE.Mesh(new THREE.SphereGeometry(270,32,20),material);
  dome.renderOrder=-100;dome.frustumCulled=false;group.add(dome);
  const coordinates=[];let seed=72419;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<160;i++){
    const y=.14+random()*.85,a=random()*Math.PI*2,r=Math.sqrt(1-y*y);
    coordinates.push(Math.cos(a)*r*260,y*260,Math.sin(a)*r*260);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(coordinates,3));
  const starMaterial=new THREE.PointsMaterial({color:'#cbd9ef',size:1.5,sizeAttenuation:false,transparent:true,opacity:0,depthWrite:false,depthTest:true,fog:false,toneMapped:false});
  const stars=new THREE.Points(geometry,starMaterial);stars.renderOrder=-90;stars.frustumCulled=false;group.add(stars);scene.add(group);
  const dayTop=new THREE.Color('#7eb8d5'),duskTop=new THREE.Color('#746c9a'),nightTop=new THREE.Color('#081324');
  return {
    group,
    update(state,camera){
      group.position.copy(camera.position);
      uniforms.horizon.value.setHex(state.fogColor);
      uniforms.zenith.value.copy(dayTop).lerp(duskTop,state.duskStrength*.8).lerp(nightTop,state.nightFactor);
      const angle=state.time*Math.PI*2;
      uniforms.sunDirection.value.set(-Math.cos(angle),Math.sin(angle),.35).normalize();
      uniforms.daylight.value=state.daylight;uniforms.dusk.value=state.duskStrength;uniforms.night.value=state.nightFactor;
      starMaterial.opacity=THREE.MathUtils.smoothstep(state.nightFactor,.65,1)*.8;
      stars.visible=starMaterial.opacity>.005;
    },
    dispose(){group.removeFromParent();dome.geometry.dispose();material.dispose();geometry.dispose();starMaterial.dispose();},
  };
}

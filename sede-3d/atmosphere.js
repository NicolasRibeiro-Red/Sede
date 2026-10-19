import * as THREE from 'three';

// Only distant architecture is downsampled. The full-resolution local scene
// establishes depth first; the skyline can only fill pixels behind that scene.
export function createAtmosphere({renderer,scene,camera,horizon,sky,terrain,lights=[]}) {
  if(!horizon||!sky)throw new Error('O horizonte e o céu precisam existir antes da atmosfera.');
  const previousLayers=new Map();
  for(const [root,layer] of [[horizon,1],[sky,2]])root.traverse(object=>{previousLayers.set(object,object.layers.mask);object.layers.set(layer);});
  for(const light of lights){previousLayers.set(light,light.layers.mask);light.layers.enable(1);}
  // Provide the ground colour behind partially blurred skyline pixels. The
  // original ground remains in the main pass for sharp local contact/shadows.
  let backgroundGround=null,backgroundGroundMaterial=null;
  if(terrain){
    terrain.updateWorldMatrix(true,false);
    // This is only a colour backing. Copying its half-resolution depth into the
    // main pass fights the identical full-resolution terrain and stripes shadows.
    backgroundGroundMaterial=terrain.material.clone();backgroundGroundMaterial.depthWrite=false;
    backgroundGround=new THREE.Mesh(terrain.geometry,backgroundGroundMaterial);backgroundGround.name='Atmosfera · continuidade do terreno';
    backgroundGround.renderOrder=-100;backgroundGround.matrixAutoUpdate=false;backgroundGround.matrix.copy(terrain.matrixWorld);backgroundGround.layers.set(1);scene.add(backgroundGround);
  }
  const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true,stencilBuffer:false});
  target.texture.name='Horizonte · cor linear';target.texture.colorSpace=THREE.LinearSRGBColorSpace;
  target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  const uniforms={colorMap:{value:target.texture},depthMap:{value:target.depthTexture},texel:{value:new THREE.Vector2(1,1)},near:{value:.1},far:{value:300},strength:{value:1},fogColor:{value:new THREE.Color()},fogNear:{value:55},fogFar:{value:155}};
  const material=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:true,depthTest:true,depthFunc:THREE.LessEqualDepth,toneMapped:true,
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
    fragmentShader:`varying vec2 vUv;uniform sampler2D colorMap,depthMap;uniform vec2 texel;uniform float near,far,strength,fogNear,fogFar;uniform vec3 fogColor;
      void main(){
        float depth=texture2D(depthMap,vUv).x;
        float distanceToCamera=(near*far)/(far-depth*(far-near));
        float radius=1.65*smoothstep(42.0,170.0,distanceToCamera)*strength;
        vec2 d=texel*radius;
        vec4 c=texture2D(colorMap,vUv)*0.20;
        c+=texture2D(colorMap,vUv+vec2(d.x,0.0))*0.12;
        c+=texture2D(colorMap,vUv-vec2(d.x,0.0))*0.12;
        c+=texture2D(colorMap,vUv+vec2(0.0,d.y))*0.12;
        c+=texture2D(colorMap,vUv-vec2(0.0,d.y))*0.12;
        c+=texture2D(colorMap,vUv+d)*0.08;
        c+=texture2D(colorMap,vUv-d)*0.08;
        c+=texture2D(colorMap,vUv+vec2(d.x,-d.y))*0.08;
        c+=texture2D(colorMap,vUv+vec2(-d.x,d.y))*0.08;
        gl_FragColor=vec4(c.rgb/max(c.a,0.00001),c.a);
        gl_FragDepth=depth;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.rgb=mix(gl_FragColor.rgb,fogColor,smoothstep(fogNear,fogFar,distanceToCamera));
      }`,
  });
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);quad.frustumCulled=false;
  const composite=new THREE.Scene();composite.add(quad);
  const compositeCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const size=new THREE.Vector2(),clearColor=new THREE.Color();
  let enabled=true,disposed=false;
  const originalAutoReset=renderer.info.autoReset;renderer.info.autoReset=false;
  function resize(){if(disposed)return;renderer.getDrawingBufferSize(size);const w=Math.max(1,Math.ceil(size.x/2)),h=Math.max(1,Math.ceil(size.y/2));if(target.width!==w||target.height!==h)target.setSize(w,h);uniforms.texel.value.set(1/w,1/h);}
  function render(){
    if(disposed)return;
    const saved={background:scene.background,fog:scene.fog,groundVisible:backgroundGround?.visible,mask:camera.layers.mask,autoClear:renderer.autoClear,target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace(),mip:renderer.getActiveMipmapLevel(),clearAlpha:renderer.getClearAlpha(),shadowAuto:renderer.shadowMap.autoUpdate,shadowNeeds:renderer.shadowMap.needsUpdate};
    renderer.getClearColor(clearColor);renderer.info.reset();
    try{
      if(!enabled){if(backgroundGround)backgroundGround.visible=false;camera.layers.enable(1);camera.layers.enable(2);renderer.render(scene,camera);return;}
      uniforms.near.value=camera.near;uniforms.far.value=camera.far;
      uniforms.fogNear.value=saved.fog?.near??1e6;uniforms.fogFar.value=saved.fog?.far??2e6;
      if(saved.fog)uniforms.fogColor.value.copy(saved.fog.color).convertLinearToSRGB();
      renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
      renderer.autoClear=true;camera.layers.set(2);renderer.render(scene,camera);
      scene.background=null;renderer.autoClear=false;
      camera.layers.mask=saved.mask;renderer.shadowMap.autoUpdate=saved.shadowAuto;renderer.shadowMap.needsUpdate=saved.shadowNeeds;
      renderer.render(scene,camera);
      // Build shadows and the sharp local depth before touching the reduced
      // framebuffer. In particular, never rasterize ground over copied depth.
      renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
      renderer.setRenderTarget(target);renderer.setClearColor(0x000000,0);renderer.autoClear=true;
      scene.fog=null;camera.layers.set(1);renderer.render(scene,camera);
      renderer.setRenderTarget(saved.target,saved.face,saved.mip);renderer.setClearColor(clearColor,saved.clearAlpha);
      scene.fog=saved.fog;renderer.autoClear=false;renderer.render(composite,compositeCamera);
    }finally{
      renderer.setRenderTarget(saved.target,saved.face,saved.mip);renderer.setClearColor(clearColor,saved.clearAlpha);
      renderer.autoClear=saved.autoClear;renderer.shadowMap.autoUpdate=saved.shadowAuto;renderer.shadowMap.needsUpdate=saved.shadowNeeds;
      scene.background=saved.background;scene.fog=saved.fog;camera.layers.mask=saved.mask;
      if(backgroundGround)backgroundGround.visible=saved.groundVisible;
    }
  }
  resize();
  return {render,resize,setEnabled(value){enabled=Boolean(value);return enabled;},get enabled(){return enabled;},
    dispose(){if(disposed)return;disposed=true;for(const [object,mask]of previousLayers)object.layers.mask=mask;backgroundGround?.removeFromParent();backgroundGroundMaterial?.dispose();target.dispose();target.depthTexture.dispose();quad.geometry.dispose();material.dispose();renderer.info.autoReset=originalAutoReset;},
  };
}

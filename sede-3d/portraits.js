import * as THREE from 'three';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';

/**
 * Photograph the actual local avatars once, with their own recolored textures
 * and fitted accessories. No new WebGL context and no per-frame work.
 *
 * `records` accepts actors.records (visitor included), from one or many floors.
 * Repeated IDs share a portrait. Returns Map<actorId, PNG data URL> and assigns
 * record.portrait. Call again after changing an avatar's appearance.
 */
export function createActorPortraits(renderer, records, {size=160,framing='portrait'}={}) {
 if(!renderer?.isWebGLRenderer||!Array.isArray(records))throw new TypeError('Portraits require the scene renderer and actor records.');
 if(!Number.isInteger(size)||size<64||size>512)throw new RangeError('Portrait size must be an integer between 64 and 512.');
 if(!['portrait','full-body'].includes(framing))throw new RangeError('Unknown portrait framing.');
 const imageField=framing==='full-body'?'preview':'portrait';
 const document=renderer.domElement.ownerDocument;
 const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
 const context=canvas.getContext('2d');
 if(!context)throw new Error('Portraits require a 2D canvas.');
 const portraits=new Map();
 const target=new THREE.WebGLRenderTarget(size,size,{depthBuffer:true,stencilBuffer:false,samples:0});
 // The framebuffer performs the sRGB transfer; PNG pixels must not be linear.
 target.texture.colorSpace=THREE.SRGBColorSpace;
 target.texture.generateMipmaps=false;
 const pixels=new Uint8Array(size*size*4),image=context.createImageData(size,size);
 const scene=new THREE.Scene();
 scene.background=new THREE.Color('#edf0ee');
 scene.add(new THREE.HemisphereLight('#eff5ff','#b5b2a7',1.25));
 const key=new THREE.DirectionalLight('#fff5e7',2.25);key.position.set(-3,5,6);scene.add(key);
 const fill=new THREE.DirectionalLight('#e5efff',.4);fill.position.set(4,2,-2);scene.add(fill);
 const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,30);
 const previous={
  target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace(),mipmap:renderer.getActiveMipmapLevel(),
  viewport:renderer.getViewport(new THREE.Vector4()),scissor:renderer.getScissor(new THREE.Vector4()),scissorTest:renderer.getScissorTest(),
  clearColor:renderer.getClearColor(new THREE.Color()),clearAlpha:renderer.getClearAlpha(),
  autoClear:renderer.autoClear,autoClearColor:renderer.autoClearColor,autoClearDepth:renderer.autoClearDepth,autoClearStencil:renderer.autoClearStencil,
  shadowEnabled:renderer.shadowMap.enabled,xrEnabled:renderer.xr.enabled,
 };
 try {
  renderer.xr.enabled=false;renderer.shadowMap.enabled=false;
  renderer.autoClear=true;renderer.autoClearColor=true;renderer.autoClearDepth=true;renderer.autoClearStencil=true;
  renderer.setRenderTarget(target);renderer.setScissorTest(false);
  for(const record of records) {
   if(!record?.id||!record.root?.isObject3D)throw new TypeError('Each portrait needs a character ID and root.');
   if(portraits.has(record.id)){record[imageField]=portraits.get(record.id);continue;}
   // SkeletonUtils remaps bones to the clone; source geometries/materials stay
   // shared and read-only, so every portrait keeps the exact in-world palette.
   const clone=cloneSkeleton(record.root);
   const ownedSkeletons=new Set();
   let accessory=null,mixer=null;
   clone.position.set(0,0,0);clone.quaternion.identity();clone.visible=true;
   clone.traverse(object=>{if(object.skeleton)ownedSkeletons.add(object.skeleton);});
   scene.add(clone);
   try {
    // Independent, stable portrait pose even if this is called mid-simulation.
    const idle=record.actions?.Idle?.getClip();
    const model=clone.getObjectByName(record.model?.name);
    if(model&&record.modelRestPosition)model.position.copy(record.modelRestPosition);
    for(const saved of record.boneRestPose||record.poseRestore||[]){
     const bone=model?.getObjectByName(saved.name||saved.bone?.name);if(!bone)continue;
     bone.position.copy(saved.position);bone.quaternion.copy(saved.quaternion);if(saved.scale)bone.scale.copy(saved.scale);
    }
    if(idle&&model){mixer=new THREE.AnimationMixer(model);mixer.clipAction(idle).play();mixer.update(.08);}
    clone.updateMatrixWorld(true);
    const head=clone.getObjectByName(record.head?.name||'Head');
    const anchor=head?head.getWorldPosition(new THREE.Vector3()):new THREE.Vector3(0,(record.height||1.72)*.6,0);
    if(record.accessory&&head){
     accessory=record.accessory.clone(true);accessory.visible=true;
     accessory.position.copy(anchor);
     accessory.quaternion.copy(head.getWorldQuaternion(new THREE.Quaternion()));
     if(record.headRestInverse)accessory.quaternion.multiply(record.headRestInverse);
     scene.add(accessory);
    }
    const scale=record.appearance?.size||1;
    const span=framing==='full-body'?(record.height||1.72)*1.4:Math.max((record.radius||.5)*2.5,1.5*scale);
    const focus=anchor.clone();focus.y+=(record.headTop||.7*scale)*.36;
    if(framing==='full-body')focus.set(0,(record.height||1.72)*.52,0);
    camera.left=-span/2;camera.right=span/2;camera.top=span/2;camera.bottom=-span/2;camera.updateProjectionMatrix();
    camera.position.copy(focus).add(new THREE.Vector3(3.2,.9,6));camera.lookAt(focus);camera.updateMatrixWorld(true);
    renderer.render(scene,camera);
    renderer.readRenderTargetPixels(target,0,0,size,size,pixels);
    // WebGL readback starts at the bottom; ImageData starts at the top.
    for(let row=0;row<size;row++)image.data.set(pixels.subarray((size-row-1)*size*4,(size-row)*size*4),row*size*4);
    context.putImageData(image,0,0);
    const url=canvas.toDataURL('image/png');
    portraits.set(record.id,url);record[imageField]=url;
   } finally {
    mixer?.stopAllAction();if(mixer)mixer.uncacheRoot(mixer.getRoot());
    scene.remove(clone);if(accessory)scene.remove(accessory);
    // Clones own skeleton/bone textures, never the original materials/geometry.
    for(const skeleton of ownedSkeletons)skeleton.dispose();
   }
  }
  return portraits;
 } finally {
  renderer.xr.enabled=previous.xrEnabled;renderer.shadowMap.enabled=previous.shadowEnabled;
  renderer.autoClear=previous.autoClear;renderer.autoClearColor=previous.autoClearColor;renderer.autoClearDepth=previous.autoClearDepth;renderer.autoClearStencil=previous.autoClearStencil;
  renderer.setViewport(previous.viewport);renderer.setScissor(previous.scissor);renderer.setScissorTest(previous.scissorTest);
  // Restore the framebuffer last: a prior render target has its own physical
  // viewport/scissor, independent of the canvas's logical-pixel settings.
  renderer.setRenderTarget(previous.target,previous.face,previous.mipmap);
  renderer.setClearColor(previous.clearColor,previous.clearAlpha);
  target.dispose();scene.clear();
 }
}

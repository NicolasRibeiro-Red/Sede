/** First-person input boundary. Canvas drags keep their existing look behavior. */
export function createPeaceControls({ability,element,hud,getContext,onEquip=()=>{}}){
 const doc=element.ownerDocument,win=doc.defaultView,toggle=hud.querySelector('#peace-toggle'),fire=hud.querySelector('#peace-fire'),reload=hud.querySelector('#peace-reload'),details=hud.querySelector('#peace-details'),ammo=hud.querySelector('#peace-ammo'),status=hud.querySelector('#peace-status');
 const actionLabel=toggle.querySelector?.('strong'),abilityLabel=toggle.querySelector?.('small');
 if(abilityLabel)abilityLabel.textContent='A paz é a única opção';
 toggle.setAttribute('aria-keyshortcuts','P');
 const banner=doc.createElement?.('div');
 if(banner){banner.className='peace-banner';banner.hidden=true;banner.setAttribute('role','status');banner.setAttribute('aria-live','polite');banner.setAttribute('aria-atomic','true');element.appendChild(banner);}
 let pointer=null,disposed=false,lastStatus='',bannerTime=0,windowFocused=true;const handlers=[];
 const control=target=>Boolean(target?.closest?.('input,textarea,select,button,a,[contenteditable],[role="button"],[role="slider"],[role="combobox"]'));
 const focused=()=>doc.activeElement===element||(doc.activeElement?.tagName==='CANVAS'&&element.contains(doc.activeElement));
 const listen=(target,type,fn)=>{target.addEventListener(type,fn);handlers.push([target,type,fn]);};
 function context(){const value=getContext();return {...value,active:Boolean(value.active&&!value.blocked&&!doc.hidden&&windowFocused)};}
 function hideBanner(){bannerTime=0;if(banner){banner.hidden=true;banner.textContent='';}}
 function announceEquip(){if(!banner)return;bannerTime=2.2;banner.hidden=false;banner.textContent='A paz é a única opção';}
 function update(dt=0){
  if(disposed)return;const value=context();ability.setEnabled(value.active);ability.update(dt,value);const state=ability.getSnapshot();
  hud.hidden=!value.active;hud.dataset.state=state.equipped?'equipped':state.draw>0?'holstering':'holstered';toggle.disabled=!value.running;toggle.setAttribute('aria-pressed',String(state.equipped));details.hidden=!state.equipped;
  const action=state.equipped?'Guardar revólver':'Sacar revólver';if(actionLabel&&actionLabel.textContent!==action)actionLabel.textContent=action;
  toggle.setAttribute('aria-label',`${action} · A paz é a única opção · tecla P`);toggle.setAttribute('title',`${action} (P)`);
  if(!value.active||!state.equipped)hideBanner();
  else if(bannerTime>0){if(value.running&&Number.isFinite(dt))bannerTime=Math.max(0,bannerTime-Math.max(0,dt));if(!bannerTime)hideBanner();}
  doc.body.classList.toggle('peace-equipped',value.active&&state.equipped);element.dataset.peaceEquipped=String(state.equipped);element.dataset.peaceAmmo=String(state.ammo);element.dataset.peaceShots=String(state.shots);element.dataset.peaceReloading=String(state.reloading);
  if(ammo.textContent!==`${state.ammo} / ${state.capacity}`)ammo.textContent=`${state.ammo} / ${state.capacity}`;
  const label=!value.running?'Simulação pausada':!state.equipped?(state.draw>0?'Guardando revólver…':'Guardado · P para sacar'):state.reloading?'Recarregando a paz…':state.ammo===0?'Sem munição · recarregue':state.draw<.99?'Sacando revólver…':'Clique ou Espaço · R recarrega';
  if(lastStatus!==label){status.textContent=label;lastStatus=label;}
  fire.disabled=!state.equipped||!value.running||state.reloading||state.cooldown>0||state.draw<.99||state.ammo===0;reload.disabled=!state.equipped||!value.running||state.reloading||state.ammo===state.capacity||state.draw<.99;
 }
 function command(kind){
  if(disposed)return false;
  update(0);const value=context(),state=ability.getSnapshot();if(!value.active||!value.running)return false;
  let result=false;if(kind==='toggle'){result=ability.toggle();if(result){announceEquip();onEquip();}else hideBanner();}else if(state.equipped){result=kind==='fire'?ability.fire():ability.reload();}
  update(0);element.focus({preventScroll:true});return result;
 }
 listen(toggle,'click',()=>command('toggle'));listen(fire,'click',()=>command('fire'));listen(reload,'click',()=>command('reload'));
 listen(element,'keydown',event=>{
  if(disposed||event.ctrlKey||event.metaKey||event.altKey||control(event.target)||!focused())return;
  const code=event.code||({p:'KeyP',r:'KeyR',' ':'Space'}[event.key?.toLowerCase()]);
  if(!['KeyP','KeyR','Space'].includes(code)||!context().active)return;
  if(code!=='KeyP'&&!ability.getSnapshot().equipped)return;
  event.preventDefault();if(event.repeat)return;command(code==='KeyP'?'toggle':code==='KeyR'?'reload':'fire');
 });
 listen(element,'pointerdown',event=>{
  pointer=null;if(disposed||event.button!==0||event.target?.tagName!=='CANVAS'||!context().active)return;
  pointer={id:event.pointerId,x:event.clientX,y:event.clientY,time:event.timeStamp,moved:false};
 });
 listen(element,'pointermove',event=>{if(pointer&&event.pointerId===pointer.id&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>4)pointer.moved=true;});
 listen(element,'pointerup',event=>{
  const down=pointer;pointer=null;if(!down||event.pointerId!==down.id||event.button!==0||event.target?.tagName!=='CANVAS'||down.moved||Math.hypot(event.clientX-down.x,event.clientY-down.y)>4||event.timeStamp-down.time>350)return;
  if(ability.getSnapshot().equipped)command('fire');
 });
 function holster(options){if(disposed)return false;pointer=null;hideBanner();const changed=ability.holster(options);update(0);return changed;}
 const cancel=()=>{pointer=null;};listen(element,'pointercancel',cancel);listen(element,'blur',cancel);
 listen(win,'blur',()=>{cancel();windowFocused=false;hideBanner();update(0);});listen(win,'focus',()=>{windowFocused=true;update(0);});listen(doc,'visibilitychange',()=>{cancel();update(0);});
 update(0);
 return {update,command,holster,dispose(){if(disposed)return;disposed=true;handlers.forEach(([target,type,fn])=>target.removeEventListener(type,fn));pointer=null;hud.hidden=true;banner?.remove();doc.body.classList.remove('peace-equipped');ability.setEnabled(false);}};
}

/** Local wardrobe UI. Appearance and portraits come from the actual scene actors. */
export function createCustomizationPanel({options,getPeople,onChange,onReset,onName,onPreview,onClose=()=>{}}){
 const doc=document,node=(tag,text,cls)=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 const button=(text,fn,cls='quiet')=>{const e=node('button',text,cls);e.type='button';e.addEventListener('click',fn);return e;};
 let selectedId='visitor',scope='person',filter='all',previousFocus=null;
 const dialog=node('dialog',undefined,'customization-panel');dialog.id='customization-panel';dialog.setAttribute('aria-labelledby','customization-title');
 const header=node('header',undefined,'customization-header'),heading=node('div');
 heading.append(node('span','IDENTIDADE NO CAMPUS','section-label'));const title=node('h2','Do seu jeito.');title.id='customization-title';heading.append(title,node('p','Seu personagem e sua equipe, com a mesma liberdade de criar.'));
 const closeButton=button('×',close,'customization-close');closeButton.id='customization-close';closeButton.setAttribute('aria-label','Fechar personalização');header.append(heading,closeButton);
 const tabs=node('div',undefined,'customization-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Quem personalizar');
 const personTab=button('Meu personagem',()=>{scope='person';selectedId='visitor';render();});personTab.id='customize-person';
 const teamTab=button('Equipe · 16 agentes',()=>{scope='team';selectedId=filteredPeople()[0]?.id;render();});teamTab.id='customize-team';tabs.append(personTab,teamTab);
 const body=node('div',undefined,'customization-body'),roster=node('aside',undefined,'customization-roster');roster.setAttribute('aria-label','Escolher agente');
 const floorLabel=node('label','Andar'),floorSelect=node('select');floorSelect.id='customization-floor';floorSelect.setAttribute('aria-label','Filtrar equipe por andar');floorLabel.append(floorSelect);
 for(const [value,label] of [['all','Toda a equipe'],['0','Térreo · Produto'],['1','1º · Criação'],['2','2º · Engenharia'],['3','3º · Estratégia']]){const e=node('option',label);e.value=value;floorSelect.append(e);}
 const rosterList=node('div',undefined,'customization-roster-list');roster.append(floorLabel,rosterList);
 floorSelect.addEventListener('change',()=>{filter=floorSelect.value;const people=filteredPeople();if(!people.some(p=>p.id===selectedId))selectedId=people[0]?.id;render();});
 const editor=node('section',undefined,'customization-editor'),preview=node('div',undefined,'customization-preview'),previewImage=node('img');previewImage.id='customization-preview';previewImage.width=320;previewImage.height=320;
 const previewName=node('h3'),previewRole=node('p');preview.append(previewImage,previewName,previewRole,node('span','A aparência que você vê no mundo.','customization-preview-caption'));
 const form=node('div',undefined,'customization-form'),nameLabel=node('label','Nome na identificação'),nameInput=node('input');nameInput.id='customization-name';nameInput.maxLength=40;nameInput.setAttribute('aria-label','Nome do personagem');nameLabel.append(nameInput);form.append(nameLabel);
 nameInput.addEventListener('change',()=>apply(()=>onName(selectedId,nameInput.value)));
 const captions={skin:'Tom de pele',hair:'Cabelo',shirt:'Roupa · cor',accessory:'Acessório'},choices=[];
 for(const [channel,caption] of Object.entries(captions)){
  const field=node('fieldset'),legend=node('legend',caption),grid=node('div',undefined,channel==='accessory'?'customization-accessories':'customization-swatches');field.append(legend,grid);
  for(const option of options[channel]){const item=button(channel==='accessory'?option.label:'',()=>apply(()=>onChange(selectedId,{[channel]:option.value})),channel==='accessory'?'quiet':'customization-swatch');item.dataset.channel=channel;item.dataset.value=option.value;item.setAttribute('aria-label',`${caption}: ${option.label}`);item.title=option.label;if(channel!=='accessory')item.style.setProperty('--swatch',option.value);grid.append(item);choices.push(item);}
  form.append(field);
 }
 const actions=node('div',undefined,'customization-actions');actions.append(button('Variar visual',()=>{const patch={};for(const channel of Object.keys(captions)){const values=options[channel];patch[channel]=values[Math.floor(Math.random()*values.length)].value;}apply(()=>onChange(selectedId,patch));}),button('Restaurar aparência',()=>apply(()=>onReset(selectedId))));form.append(actions);
 const status=node('p','Mudanças salvas só neste navegador.','customization-status');status.id='customization-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');form.append(status);
 editor.append(preview,form);body.append(roster,editor);dialog.append(header,tabs,body);doc.body.append(dialog);
 function filteredPeople(){return getPeople().filter(p=>!p.person&&(filter==='all'||String(p.floor)===filter));}
 function renderRoster(){rosterList.replaceChildren();for(const person of filteredPeople()){const item=button('',()=>{selectedId=person.id;render();},'customization-person');item.dataset.person=person.id;item.setAttribute('aria-pressed',String(person.id===selectedId));item.setAttribute('aria-label',`Personalizar ${person.name}`);const image=node('img');image.src=person.portrait;image.alt='';image.width=40;image.height=40;const copy=node('span');copy.append(node('strong',person.name),node('small',person.floorLabel));item.append(image,copy);rosterList.append(item);}}
 function refreshPerson(){const person=getPeople().find(p=>p.id===selectedId);if(!person)return;previewImage.src=onPreview(person.id);previewImage.alt=`Aparência de ${person.name} no modelo 3D`;previewName.textContent=person.name;previewRole.textContent=person.person?'Pessoa · seu personagem':`Agente · ${person.role}`;nameInput.value=person.name;for(const choice of choices)choice.setAttribute('aria-pressed',String(person.appearance[choice.dataset.channel]===choice.dataset.value));dialog.dataset.person=person.id;}
 function render(){personTab.setAttribute('aria-pressed',String(scope==='person'));teamTab.setAttribute('aria-pressed',String(scope==='team'));roster.hidden=scope==='person';dialog.dataset.scope=scope;floorSelect.value=filter;renderRoster();refreshPerson();status.textContent='Mudanças salvas só neste navegador.';}
 function apply(fn){try{const result=fn();refreshPerson();renderRoster();status.textContent=result?.saved===false?'Aplicado nesta sessão. O navegador não permitiu salvar.':'Salvo neste navegador.';}catch(error){status.textContent='Não foi possível aplicar essa aparência. Tente outra opção.';}}
 function open(id='visitor'){const person=getPeople().find(p=>p.id===id)||getPeople().find(p=>p.person);if(!person)return;selectedId=person.id;scope=person.person?'person':'team';if(scope==='team'&&filter!=='all'&&String(person.floor)!==filter)filter='all';previousFocus=doc.activeElement;render();if(!dialog.open)dialog.showModal();closeButton.focus();}
 function close(){if(!dialog.open)return;dialog.close();}
 dialog.addEventListener('close',()=>{previousFocus?.focus?.({preventScroll:true});onClose();});
 dialog.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();close();});
 dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}});
 return {element:dialog,open,close,get isOpen(){return dialog.open;},dispose(){close();dialog.remove();}};
}

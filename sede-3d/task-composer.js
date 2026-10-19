const STORAGE_KEY='sede-task-draft-v1';
const clean=(value,limit)=>typeof value==='string'?value.trim().slice(0,limit):'';

export function normalizeTaskDraft(value={}){
 return {project:clean(value?.project,100),objective:clean(value?.objective,3000),outcome:clean(value?.outcome,1000),context:clean(value?.context,1500),agentId:clean(value?.agentId,60)};
}
export function buildTaskPrompt(value,person){
 const draft=normalizeTaskDraft(value);
 if(draft.objective.length<8)throw new Error('Descreva a tarefa em pelo menos 8 caracteres.');
 return [draft.project&&`Projeto: ${draft.project}`,`Objetivo\n${draft.objective}`,draft.outcome&&`Resultado esperado\n${draft.outcome}`,draft.context&&`Contexto\n${draft.context}`,person?.role&&`Perfil de apoio sugerido: ${person.role}.`,
 'Pedido preparado na Sede. Use o contexto e as permissões deste chat para executar; o personagem 3D não representa uma sessão conectada.'].filter(Boolean).join('\n\n');
}

/** Draft-only handoff: the static campus never claims to send or run a task. */
export function createTaskComposer({getPeople,onClose=()=>{}}){
 const doc=document,node=(tag,text,cls)=>{const el=doc.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
 let previousFocus=null,draft={},saved=true,revision=0;
 try{const record=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(record?.version===1)draft=normalizeTaskDraft(record.draft);}catch{saved=false;}
 draft=normalizeTaskDraft(draft);
 const dialog=node('dialog',undefined,'task-composer');dialog.id='task-composer';dialog.setAttribute('aria-labelledby','task-composer-title');
 const header=node('header'),intro=node('div');intro.append(node('span','DO PEDIDO À ENTREGA','section-label'));
 const title=node('h2','O trabalho começa com clareza.');title.id='task-composer-title';intro.append(title,node('p','Prepare aqui. Execute no Codex, no chat do projeto.'));
 const close=node('button','×','task-close');close.type='button';close.setAttribute('aria-label','Fechar pedido');close.addEventListener('click',()=>dialog.close());header.append(intro,close);
 const body=node('div',undefined,'task-composer-body'),flow=node('ol',undefined,'task-flow');
 for(const [heading,copy] of [['Defina','Objetivo, contexto e entrega.'],['Leve ao Codex','Copie e envie no chat do projeto.'],['Acompanhe','Comandos, aprovações e resultado no mesmo chat.']]){const li=node('li');li.append(node('strong',heading),node('span',copy));flow.append(li);}
 const connection=node('div',undefined,'task-connection');connection.append(node('strong','Nenhum agente real conectado'),node('p','Os personagens e custos deste campus são simulados. Pausar um personagem só altera a cena. Copiar um pedido não inicia uma execução nem consome tokens.'));
 const form=node('form');form.id='task-composer-form';const fields={};
 function field(label,key,multiline,maxLength){const wrapper=node('label',label),input=node(multiline?'textarea':'input');input.id=`task-${key}`;input.name=key;input.maxLength=maxLength;input.value=draft[key]||'';if(multiline)input.rows=key==='objective'?3:2;wrapper.htmlFor=input.id;wrapper.append(input);fields[key]=input;input.addEventListener('input',()=>{input.setCustomValidity('');draft[key]=input.value;persist();renderPreview();});return wrapper;}
 const projectRow=node('div',undefined,'task-form-row');projectRow.append(field('Projeto','project',false,100));
 const agentLabel=node('label','Perfil de apoio'),agent=node('select');agent.id='task-agent';agentLabel.htmlFor=agent.id;agentLabel.append(agent);projectRow.append(agentLabel);
 agent.addEventListener('change',()=>{draft.agentId=agent.value;persist();renderPreview();});
 const objective=field('O que precisa ser feito?','objective',true,3000);fields.objective.required=true;fields.objective.minLength=8;
 fields.objective.placeholder='Ex.: revisar o fluxo de cadastro e corrigir os pontos de atrito.';
 const contextGroup=node('details',undefined,'task-prompt-preview');contextGroup.append(node('summary','Adicionar contexto ou restrições'),field('Contexto · opcional','context',true,1500));
 form.append(projectRow,objective,field('Como será uma boa entrega?','outcome',true,1000),contextGroup);
 const preview=node('details',undefined,'task-prompt-preview'),previewText=node('pre');previewText.id='task-prompt-preview';preview.append(node('summary','Ver o pedido que será copiado'),previewText);
 const actions=node('div',undefined,'task-composer-actions'),copy=node('button','Copiar pedido para o Codex','primary');copy.type='submit';copy.id='task-copy';
 const status=node('p',undefined,'task-draft-status');status.id='task-draft-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');actions.append(copy,status);form.append(preview,actions);
 const fallback=node('textarea');fallback.id='task-copy-fallback';fallback.readOnly=true;fallback.hidden=true;fallback.rows=7;fallback.setAttribute('aria-label','Pedido pronto para copiar manualmente');form.append(fallback);
 form.addEventListener('submit',async event=>{event.preventDefault();if(!form.reportValidity())return;let prompt;
  try{prompt=buildTaskPrompt(draft,people().find(p=>p.id===draft.agentId));}catch(error){status.textContent=error.message;fields.objective.setCustomValidity(error.message);fields.objective.reportValidity();fields.objective.focus();return;}copy.disabled=true;const submittedRevision=++revision;
  try{await navigator.clipboard.writeText(prompt);if(!dialog.open||revision!==submittedRevision)return;fallback.hidden=true;status.textContent='Pedido copiado. Cole no chat do projeto no Codex e envie por lá. Ainda não foi executado.';}
  catch{if(!dialog.open||revision!==submittedRevision)return;fallback.hidden=false;fallback.value=prompt;fallback.focus();fallback.select();status.textContent='O navegador não liberou a cópia. Pressione Ctrl+C no texto selecionado e cole no Codex.';}
  finally{if(revision===submittedRevision)copy.disabled=false;}
 });
 body.append(flow,connection,form);dialog.append(header,body);doc.body.append(dialog);
 function people(){return getPeople().filter(p=>!p.person);}
 function persist(){revision++;copy.disabled=false;draft=normalizeTaskDraft({...draft,...Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value]))});try{localStorage.setItem(STORAGE_KEY,JSON.stringify({version:1,draft}));saved=true;}catch{saved=false;}status.textContent=saved?'Rascunho salvo neste navegador. Nada enviado.':'Rascunho só nesta sessão; o navegador não permitiu salvar.';fallback.hidden=true;}
 function renderPreview(){try{previewText.textContent=buildTaskPrompt(draft,people().find(p=>p.id===draft.agentId));}catch{previewText.textContent='Descreva o objetivo para preparar seu pedido.';}}
 function open(agentId){revision++;copy.disabled=false;previousFocus=doc.activeElement;const list=people();if(agentId!==undefined)draft.agentId=agentId||'';if(!list.some(p=>p.id===draft.agentId))draft.agentId='';
  agent.replaceChildren();for(const person of [{id:'',name:'Automático no Codex'},...list]){const option=node('option',person.role?`${person.name} · ${person.role}`:person.name);option.value=person.id;agent.append(option);}agent.value=draft.agentId;
  for(const [key,input]of Object.entries(fields))input.value=draft[key]||'';contextGroup.open=Boolean(draft.context);fallback.hidden=true;renderPreview();status.textContent=saved?'Rascunho local. Nada enviado.':'Rascunho só nesta sessão.';if(!dialog.open)dialog.showModal();fields.objective.focus();
 }
 dialog.addEventListener('close',()=>{revision++;copy.disabled=false;previousFocus?.focus?.({preventScroll:true});onClose();});
 dialog.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();dialog.close();});
 dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dialog.close();}});
 return {open,close:()=>dialog.close(),get isOpen(){return dialog.open;}};
}

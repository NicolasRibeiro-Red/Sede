import * as THREE from 'three';

const format={cost:value=>'US$ '+value.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}),tokens:value=>value.toLocaleString('pt-BR'),hours:value=>value.toLocaleString('pt-BR',{maximumFractionDigits:1})+' h',tasks:value=>value.toLocaleString('pt-BR')};
const compact=value=>value>=1e6?(value/1e6).toLocaleString('pt-BR',{maximumFractionDigits:1})+'M':value>=1000?(value/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+'k':value.toLocaleString('pt-BR',{maximumFractionDigits:1});
const labels={cost:'Custo de tokens · US$',tokens:'Tokens consumidos',hours:'Horas ativas acumuladas',tasks:'Tarefas concluídas'};

/** All four corridor displays share one texture and the dashboard's exact query. */
export function createAnalyticsBoards(floors){
 const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=800;
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas do quadro indisponível.');
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 texture.minFilter=THREE.LinearFilter;texture.generateMipmaps=false;
 // A luminous display is deliberately unlit; its frame receives real room light.
 const display=new THREE.MeshBasicMaterial({map:texture,toneMapped:false});
 const trim=new THREE.MeshStandardMaterial({color:'#263a35',roughness:.62,metalness:.15});
 const housingGeometry=new THREE.BoxGeometry(.12,2.12,3.25),screenGeometry=new THREE.PlaneGeometry(3.07,1.92);
 const boards=floors.map(floor=>{
  const group=new THREE.Group();group.name='Métricas · dados simulados';
  const housing=new THREE.Mesh(housingGeometry,trim);housing.position.set(2.05,1.86,0);housing.castShadow=true;housing.receiveShadow=true;group.add(housing);
  const screen=new THREE.Mesh(screenGeometry,display);screen.position.set(1.977,1.86,0);screen.rotation.y=-Math.PI/2;group.add(screen);floor.office.group.add(group);
  const interactable={id:'analytics-board',kind:'analytics',name:'Métricas · consumo e entregas',position:{x:1.15,z:0}};
  return {group,screen,interactable};
 });
 let last=null,disposed=false;
 function text(value,x,y,size=26,color='#1e302b',weight=400){ctx.fillStyle=color;ctx.font=`${weight} ${size}px Inter, Arial, sans-serif`;ctx.fillText(String(value),x,y);}
 function update({state={},result}={}){
  if(disposed||!result)return;const metric=labels[state.metric]?state.metric:'cost',series=result.series||[],total=result.totals;
  ctx.fillStyle='#f2f4ee';ctx.fillRect(0,0,1280,800);ctx.textAlign='left';ctx.textBaseline='alphabetic';
  text('SEDE / RESULTADOS',50,64,27,'#40564e',600);text('DADOS SIMULADOS',923,64,24,'#40564e',500);
  const project=result.filters?.projectId&&result.filters.projectId!=='all'?result.projects.find(p=>p.id===result.filters.projectId)?.name:'Todos os projetos';
  const selectedModel=result.filters?.modelId&&result.filters.modelId!=='all'?result.models.find(model=>model.id===result.filters.modelId)?.name||'Modelo selecionado':'Todos os modelos';
  text(`${project||'Projeto selecionado'} · ${selectedModel}`,50,120,36,'#1e302b',500);
  text(result.range.label,50,162,24,'#5a665e');
  const cards=[['Custo de tokens',format.cost(total.cost)],['Tokens',compact(total.tokens)],['Horas ativas',format.hours(total.hours)],['Entregas',format.tasks(total.tasks)]];
  cards.forEach(([label,value],i)=>{const x=50+i*303;ctx.fillStyle='#e5eae2';ctx.fillRect(x,190,282,115);text(label,x+18,224,23,'#526157');text(value,x+18,274,38,'#183e31',600);});
  text(labels[metric],50,355,28,'#243b32',500);
  const left=116,top=395,width=1106,height=250,values=series.map(p=>Number.isFinite(Number(p[metric]))?Math.max(0,Number(p[metric])):0),max=Math.max(...values,1),ceiling=metric==='tasks'?Math.ceil(max/3)*3:max*1.08;
  ctx.lineWidth=1;
  for(let i=0;i<=3;i++){const y=top+height-height*i/3;ctx.strokeStyle='#d2dbd0';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(left+width,y);ctx.stroke();ctx.textAlign='right';text(metric==='tasks'?format.tasks(ceiling*i/3):compact(ceiling*i/3),left-14,y+7,20,'#637267');}
  ctx.textAlign='center';const step=width/Math.max(1,series.length),bar=Math.max(3,step*.64);
  values.forEach((value,i)=>{const h=value/ceiling*height,x=left+i*step+(step-bar)/2;ctx.fillStyle='#347354';ctx.fillRect(x,top+height-h,bar,h);if(series.length<=13||i%5===0||i===series.length-1)text(series[i].label,left+(i+.5)*step,top+height+33,series.length<=13?19:17,'#526157');});
  ctx.textAlign='left';const model=result.leaderModel;
  text(model?`Mais usado por tokens: ${model.name}`:'Nenhum registro para estes filtros',50,728,25,'#2d4639',500);
  text('F · Abrir painel e escolher período, projeto ou modelo',50,773,23,'#5a665e');
  texture.needsUpdate=true;last={metric,totals:{...total},series:series.map(p=>({...p})),range:{...result.range},filters:{...result.filters}};
  for(const {group}of boards)group.userData.analytics=last;
 }
 function dispose(){if(disposed)return;disposed=true;for(const {group}of boards)group.removeFromParent();texture.dispose();display.dispose();trim.dispose();housingGeometry.dispose();screenGeometry.dispose();}
 return {boards,update,getSnapshot:()=>last,dispose};
}

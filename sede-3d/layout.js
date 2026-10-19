export const FLOOR_BOUNDS={minX:-10.72,maxX:10.72,minZ:-7.72,maxZ:7.72};
// Leave the entrance and arriving passengers' reception points unobstructed.
export const SPAWN={x:0,z:2};
export const ROOMS=[
 {id:'studio',name:'Estúdio',subtitle:'Design & criação',color:'#be795c',x:-6.5,z:-4,door:{x:-2.2,z:-3.8},station:{x:-8.3,z:-5.9},agent:{x:-6.8,z:-4.5,yaw:Math.PI}},
 {id:'engineering',name:'Engenharia',subtitle:'Produto & tecnologia',color:'#568492',x:6.5,z:-4,door:{x:2.2,z:-3.8},station:{x:8.3,z:-5.9},agent:{x:6.5,z:-4.5,yaw:Math.PI}},
 {id:'meeting',name:'Reunião',subtitle:'Conversas & decisões',color:'#a28b55',x:-6.5,z:4,door:{x:-2.2,z:3.8},station:{x:-8.8,z:2},agent:{x:-8.4,z:5.6,yaw:Math.PI/2}},
 {id:'lounge',name:'Café & lounge',subtitle:'Pausa & encontros',color:'#73966c',x:6.5,z:4,door:{x:2.2,z:3.8},station:{x:8.8,z:5.7},agent:{x:8.45,z:5.7,yaw:-Math.PI/2}},
];
export const DOOR_WIDTH=2;
export const DOOR_HEIGHT=2.75;
export const BOARD_POINT={x:-1,z:0};
export const AGENT_CONFIGS=[
 {id:'auri',name:'Auri',role:'Design',room:'studio',model:'cube-woman',seed:'auri-design-01'},
 {id:'nico',name:'Nico',role:'Engenharia',room:'engineering',model:'steve',seed:'nico-eng-01'},
 {id:'maia',name:'Maia',role:'Planejamento',room:'meeting',model:'cube-guy',seed:'maia-meeting-01'},
 {id:'lume',name:'Lume',role:'Pesquisa',room:'lounge',model:'cube-woman',seed:'lume-research-01'},
];
export const FLOOR_HEIGHT=4;
export const FLOORS=[
 {id:0,label:'Térreo',short:'T',name:'Recepção & produto',color:'#608065',names:['Auri','Nico','Maia','Lume'],roles:['Design','Produto','Planejamento','Pesquisa']},
 {id:1,label:'1º andar',short:'1',name:'Criação & conteúdo',color:'#b97d61',names:['Íris','Téo','Mila','Noa'],roles:['Direção de arte','Conteúdo','Revisão','Pesquisa visual']},
 {id:2,label:'2º andar',short:'2',name:'Engenharia & dados',color:'#648f9b',names:['Ada','Otto','Cora','Gael'],roles:['Engenharia','Automação','Dados','Qualidade']},
 {id:3,label:'3º andar',short:'3',name:'Estratégia & pesquisa',color:'#a79761',names:['Sofia','Atlas','Lia','Ravi'],roles:['Pesquisa','Estratégia','Operações','Análise']},
];
export const INTERNAL_BOUNDS={minX:-10.72,maxX:10.72,minZ:-10.55,maxZ:7.72};
export const LIFT_SPAWN={x:0,z:-9.3};
export function agentsForFloor(floor){const info=FLOORS[floor];return AGENT_CONFIGS.map((agent,index)=>({...agent,id:`f${floor}-${agent.id}`,name:info.names[index],role:info.roles[index],seed:`floor-${floor}-${agent.seed}`}));}

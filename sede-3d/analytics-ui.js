const PERIODS = [['week', 'Semana', '7 dias'], ['month', 'Mês', '30 dias'], ['year', 'Ano', '365 dias']];
const METRICS = {cost: {name: 'Custo', unit: 'USD'}, tokens: {name: 'Tokens', unit: 'tokens'}, hours: {name: 'Horas ativas', unit: 'h'}, tasks: {name: 'Tarefas concluídas', unit: 'tarefas'}};
const integer = new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 0});
const decimal = new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 1, minimumFractionDigits: 1});
const compact = new Intl.NumberFormat('pt-BR', {notation: 'compact', maximumFractionDigits: 1});
const dateFormat = new Intl.DateTimeFormat('pt-BR', {day: '2-digit', month: 'short', timeZone: 'UTC'});
const fullDateFormat = new Intl.DateTimeFormat('pt-BR', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'});
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const usd = value => new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: value && Math.abs(value) < .01 ? 4 : 2}).format(number(value));
const valueText = (metric, value) => metric === 'cost' ? usd(value) : metric === 'hours' ? `${decimal.format(number(value))} h` : `${integer.format(number(value))}${metric === 'tokens' ? ' tokens' : ' tarefas'}`;
function dateValue(value) {const parsed = new Date(String(value).length === 10 ? `${value}T00:00:00Z` : value); return Number.isFinite(parsed.getTime()) ? parsed : null;}
function dateText(value, full = false) {const date = dateValue(value); return date ? (full ? fullDateFormat : dateFormat).format(date) : String(value || '');}
function niceMaximum(value) {
  if (!(value > 0)) return 1;
  const raw = value / 4, power = 10 ** Math.floor(Math.log10(raw)), fraction = raw / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
  return Math.ceil(value / step) * step;
}

/** A local, accessible report surface. All figures come from the supplied store. */
export function createAnalyticsPanel({store, getAgentName = (id, fallback) => fallback, onChange = () => {}, onClose = () => {}}) {
  if (!store || typeof store.getOptions !== 'function' || typeof store.query !== 'function') throw new TypeError('Analytics requires a queryable store.');
  const doc = document;
  let disposed = false, opened = false, previousFocus = null, result = null, pointIndex = 0;
  let state = {period: 'week', projectId: 'all', modelId: 'all', metric: 'cost'};
  const node = (tag, text, className) => {const item = doc.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item;};
  const svgNode = (tag, attrs = {}, text) => {const item = doc.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) item.setAttribute(key, value); if (text !== undefined) item.textContent = text; return item;};
  const button = (label, handler, className) => {const item = node('button', label, className); item.type = 'button'; item.addEventListener('click', handler); return item;};
  const element = node('dialog', undefined, 'analytics-panel'); element.id = 'analytics-panel';
  element.setAttribute('aria-labelledby', 'analytics-title'); element.setAttribute('aria-describedby', 'analytics-intro');
  const header = node('header', undefined, 'analytics-header'), heading = node('div');
  const eyebrow = node('span', 'Visão da empresa', 'analytics-eyebrow'), title = node('h2', 'Trabalho, em números.'); title.id = 'analytics-title';
  const intro = node('p', 'Acompanhe o que foi entregue, o tempo dedicado e o custo de cada projeto.'); intro.id = 'analytics-intro';
  heading.append(eyebrow, title, intro);
  const headerActions = node('div', undefined, 'analytics-header-actions'), badge = node('span', 'Dados simulados', 'analytics-badge'); badge.id = 'analytics-simulated';
  const closeButton = button('×', close, 'analytics-close'); closeButton.id = 'analytics-close'; closeButton.setAttribute('aria-label', 'Fechar métricas');
  headerActions.append(badge, closeButton); header.append(heading, headerActions);
  const body = node('div', undefined, 'analytics-body'); body.id = 'analytics-body';
  const filters = node('section', undefined, 'analytics-filters'); filters.setAttribute('aria-label', 'Filtrar métricas');
  const periods = node('div', undefined, 'analytics-periods'); periods.setAttribute('role', 'group'); periods.setAttribute('aria-label', 'Período');
  const periodButtons = new Map(PERIODS.map(([id, name, days]) => {
    const item = button('', () => {state.period = id; refresh();}, 'analytics-period'); item.id = `analytics-period-${id}`;
    item.append(node('strong', name), node('span', days)); periods.append(item); return [id, item];
  }));
  function selectField(label, id, change) {
    const field = node('label', undefined, 'analytics-field'), select = node('select'); select.id = id;
    field.htmlFor = id; field.append(node('span', label), select); select.addEventListener('change', () => change(select.value)); return {field, select};
  }
  const project = selectField('Projeto', 'analytics-project', value => {state.projectId = value; refresh();});
  const model = selectField('Modelo', 'analytics-model', value => {state.modelId = value; refresh();});
  filters.append(periods, project.field, model.field);
  const scope = node('p', undefined, 'analytics-scope'); scope.id = 'analytics-scope'; scope.setAttribute('aria-live', 'polite');
  const totals = node('section', undefined, 'analytics-totals'); totals.setAttribute('aria-label', 'Resumo do período');
  const chart = node('section', undefined, 'analytics-chart-card'); chart.setAttribute('aria-labelledby', 'analytics-chart-title');
  const chartTop = node('div', undefined, 'analytics-section-heading'), chartHeading = node('div');
  const chartTitle = node('h3', 'Evolução no período'); chartTitle.id = 'analytics-chart-title';
  const chartDescription = node('p'); chartHeading.append(chartTitle, chartDescription);
  const metricButtons = node('div', undefined, 'analytics-metric-buttons'); metricButtons.setAttribute('role', 'group'); metricButtons.setAttribute('aria-label', 'Métrica do gráfico');
  const metricControls = new Map(Object.entries(METRICS).map(([id, meta]) => {
    const item = button(id === 'hours' ? 'Horas' : id === 'tasks' ? 'Tarefas' : meta.name, () => {state.metric = id; renderChart(); onChange({state: getState(), result});}, 'analytics-metric');
    item.id = `analytics-metric-${id}`; metricButtons.append(item); return [id, item];
  }));
  chartTop.append(chartHeading, metricButtons);
  const chartPlot = node('div', undefined, 'analytics-plot'); chartPlot.id = 'analytics-plot';
  const chartReadout = node('div', undefined, 'analytics-chart-readout'), pointOutput = node('output'); pointOutput.id = 'analytics-point'; pointOutput.setAttribute('aria-live', 'polite');
  const pointControls = node('div', undefined, 'analytics-point-controls');
  const previousPoint = button('←', () => inspectPoint(pointIndex - 1), 'analytics-point-button'), nextPoint = button('→', () => inspectPoint(pointIndex + 1), 'analytics-point-button');
  previousPoint.id = 'analytics-point-previous'; nextPoint.id = 'analytics-point-next';
  previousPoint.setAttribute('aria-label', 'Ver ponto anterior do gráfico'); nextPoint.setAttribute('aria-label', 'Ver próximo ponto do gráfico');
  pointControls.append(previousPoint, nextPoint); chartReadout.append(pointOutput, pointControls);
  const seriesDetails = node('details', undefined, 'analytics-series-details'), seriesSummary = node('summary', 'Consultar valores do gráfico'), seriesTable = node('div', undefined, 'analytics-table-wrap');
  seriesDetails.append(seriesSummary, seriesTable); chart.append(chartTop, chartPlot, chartReadout, seriesDetails);
  const breakdown = node('div', undefined, 'analytics-breakdown'), ranking = node('section', undefined, 'analytics-models'), projects = node('section', undefined, 'analytics-projects');
  breakdown.append(ranking, projects);
  const agents = node('section', undefined, 'analytics-agents'); agents.id = 'analytics-agents';
  const disclaimer = node('footer', undefined, 'analytics-disclaimer'); disclaimer.id = 'analytics-disclaimer';
  body.append(filters, scope, totals, chart, breakdown, agents, disclaimer); element.append(header, body); doc.body.append(element);
  let svg = null, marker = null;

  function getState() {return {...state, open: opened};}
  function fillSelect(select, list, all, current) {
    const desired = [{id: 'all', name: all}, ...list];
    const signature = JSON.stringify(desired.map(item => [item.id, item.name]));
    if (select.dataset.options !== signature) {
      select.replaceChildren(...desired.map(item => {const option = node('option', item.name); option.value = item.id; return option;})); select.dataset.options = signature;
    }
    select.value = current;
  }
  function sectionHeading(title, description) {const heading = node('div', undefined, 'analytics-section-heading'), copy = node('div'); copy.append(node('h3', title), node('p', description)); heading.append(copy); return heading;}
  function table(headers, rows, caption) {
    const table = node('table', undefined, 'analytics-table'), title = node('caption', caption, 'analytics-sr-only'), head = node('thead'), row = node('tr'), body = node('tbody');
    headers.forEach((header, index) => {const th = node('th', header); th.scope = 'col'; if (index) th.className = 'analytics-numeric'; row.append(th);}); head.append(row);
    if (!rows.length) {const tr = node('tr'), td = node('td', 'Nenhuma atividade para estes filtros.', 'analytics-empty'); td.colSpan = headers.length; tr.append(td); body.append(tr);}
    for (const cells of rows) {const tr = node('tr'); cells.forEach((content, index) => {const cell = node(index ? 'td' : 'th'); if (!index) cell.scope = 'row'; else cell.className = 'analytics-numeric'; if (content?.nodeType) cell.append(content); else cell.textContent = String(content); tr.append(cell);}); body.append(tr);}
    table.append(title, head, body); return table;
  }
  function renderTotals() {
    const t = result.totals;
    const cards = [
      ['Custo estimado', usd(t.cost), 'USD · tarifas fictícias'],
      ['Tokens utilizados', integer.format(number(t.tokens)), `${integer.format(number(t.inputTokens))} de entrada · ${integer.format(number(t.outputTokens))} de saída`],
      ['Tarefas concluídas', integer.format(number(t.tasks)), 'Entregas concluídas, não chamadas'],
      ['Horas ativas', `${decimal.format(number(t.hours))} h`, 'Soma do tempo dos agentes']
    ];
    totals.replaceChildren(...cards.map(([label, value, note], index) => {const item = node('div', undefined, 'analytics-stat'); item.append(node('span', label), node('strong', value), node('small', note)); item.querySelector('strong').id = `analytics-total-${['cost','tokens','tasks','hours'][index]}`; return item;}));
  }
  function inspectPoint(index) {
    const list = result?.series || []; pointIndex = Math.min(Math.max(0, index), Math.max(0, list.length - 1));
    const item = list[pointIndex]; previousPoint.disabled = !item || pointIndex === 0; nextPoint.disabled = !item || pointIndex === list.length - 1;
    pointOutput.textContent = item ? `${item.label || dateText(item.date, true)} · ${valueText(state.metric, item[state.metric])}` : 'Nenhuma atividade no período.';
    if (marker && item) {const value = Math.max(0, number(item[state.metric])), max = Number(svg.dataset.maximum); marker.setAttribute('cx', String(82 + pointIndex * 858 / Math.max(1, list.length - 1))); marker.setAttribute('cy', String(218 - value / max * 180)); marker.hidden = false;}
  }
  function renderChart() {
    if (!result) return;
    const metric = METRICS[state.metric], list = result.series || [], max = niceMaximum(Math.max(0, ...list.map(item => number(item[state.metric]))));
    for (const [id, item] of metricControls) item.setAttribute('aria-pressed', String(state.metric === id));
    const granularity = state.period === 'year' ? 'meses do intervalo' : 'dias';
    chartDescription.textContent = `${metric.name} por ${state.period === 'year' ? 'mês' : 'dia'} · ${metric.unit} · escala começa em zero`;
    svg = svgNode('svg', {viewBox: '0 0 968 258', role: 'img', 'aria-labelledby': 'analytics-chart-svg-title analytics-chart-svg-desc', preserveAspectRatio: 'xMidYMid meet'}); svg.dataset.maximum = max;
    const description = `${metric.name} em ${list.length} ${granularity}. Total: ${valueText(state.metric, result.totals[state.metric])}. Valores completos na tabela abaixo. Os meses nas bordas podem ser parciais.`;
    svg.append(svgNode('title', {id: 'analytics-chart-svg-title'}, `${metric.name}: ${result.range.label}`), svgNode('desc', {id: 'analytics-chart-svg-desc'}, description));
    const tickText = value => state.metric === 'cost' ? usd(value) : state.metric === 'hours' ? `${compact.format(value)} h` : compact.format(value);
    for (let i = 0; i <= 4; i++) {const value = max * i / 4, y = 218 - i * 45; svg.append(svgNode('line', {x1: 82, y1: y, x2: 940, y2: y, class: i ? 'analytics-gridline' : 'analytics-baseline'}), svgNode('text', {x: 70, y: y + 4, 'text-anchor': 'end', class: 'analytics-axis'}, tickText(value)));}
    const points = list.map((item, index) => [82 + index * 858 / Math.max(1, list.length - 1), 218 - Math.max(0, number(item[state.metric])) / max * 180]);
    if (points.length) {
      const path = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
      svg.append(svgNode('path', {d: `${path} L${points.at(-1)[0]},218 L${points[0][0]},218 Z`, class: 'analytics-chart-area'}), svgNode('path', {d: path, class: 'analytics-chart-line'}));
      const labelEvery = Math.max(1, Math.ceil(list.length / 6));
      points.forEach(([x, y], index) => {
        const item = list[index];
        if (index % labelEvery === 0 || index === list.length - 1) svg.append(svgNode('text', {x, y: 244, 'text-anchor': index === 0 ? 'start' : index === list.length - 1 ? 'end' : 'middle', class: 'analytics-axis'}, state.period === 'year' ? item.label : dateText(item.date)));
        const area = svgNode('rect', {x: x - Math.min(36, 429 / Math.max(1, list.length - 1)), y: 30, width: Math.min(72, 858 / Math.max(1, list.length - 1)), height: 194, fill: 'transparent', 'aria-hidden': 'true'});
        area.append(svgNode('title', {}, `${item.label || dateText(item.date, true)}: ${valueText(state.metric, item[state.metric])}`)); area.addEventListener('pointerenter', () => inspectPoint(index)); area.addEventListener('pointerdown', () => inspectPoint(index)); svg.append(area);
      });
      marker = svgNode('circle', {r: 4.5, class: 'analytics-chart-marker', 'aria-hidden': 'true'}); svg.append(marker);
    } else marker = null;
    chartPlot.replaceChildren(svg);
    seriesTable.replaceChildren(table(['Período', 'Custo · USD', 'Tokens', 'Horas ativas', 'Tarefas'], list.map(item => [item.label || dateText(item.date, true), usd(item.cost), integer.format(number(item.tokens)), decimal.format(number(item.hours)), integer.format(number(item.tasks))]), 'Valores do gráfico para os filtros selecionados'));
    inspectPoint(Math.min(pointIndex, list.length - 1));
  }
  function renderBreakdowns(options) {
    ranking.replaceChildren(sectionHeading('Modelos em uso', 'Participação no total de tokens deste recorte.'));
    const list = node('ol', undefined, 'analytics-model-list'); list.id = 'analytics-model-ranking';
    for (const item of result.models || []) {
      const row = node('li'), label = node('div', undefined, 'analytics-model-label'), share = Math.max(0, Math.min(1, number(item.share)));
      label.append(node('strong', item.name), node('span', `${decimal.format(share * 100)}%`));
      const track = node('div', undefined, 'analytics-share-track'), bar = node('span'); bar.style.width = `${share * 100}%`; track.setAttribute('aria-hidden', 'true'); track.append(bar);
      row.append(label, track, node('small', `${integer.format(number(item.tokens))} tokens · ${usd(item.cost)}`)); list.append(row);
    }
    if (!list.children.length) list.append(node('li', 'Nenhum modelo utilizado.', 'analytics-empty')); ranking.append(list);
    projects.replaceChildren(sectionHeading('Projetos', 'Entrega e consumo, lado a lado. Selecione um projeto para detalhar.'));
    const projectRows = (result.projects || []).map(item => {
      const link = button(item.name, () => {state.projectId = item.id; refresh(); project.select.focus();}, 'analytics-table-link');
      return [link, usd(item.cost), integer.format(number(item.tasks)), decimal.format(number(item.hours)), integer.format(item.agentIds?.length || 0)];
    });
    const projectsWrap = node('div', undefined, 'analytics-table-wrap'); projectsWrap.id = 'analytics-project-table'; projectsWrap.append(table(['Projeto', 'Custo · USD', 'Tarefas', 'Horas', 'Agentes'], projectRows, 'Resultados por projeto')); projects.append(projectsWrap);
    agents.replaceChildren(sectionHeading('Agentes por projeto', state.projectId === 'all' ? 'Totais por agente. Projetos indicam onde ele participou.' : 'Agentes que participaram do projeto selecionado.'));
    const names = new Map(options.projects.map(item => [item.id, item.name]));
    const agentRows = (result.agents || []).map(item => {
      const identity = node('span', undefined, 'analytics-agent-identity'); identity.append(node('strong', getAgentName(item.id, item.name)), node('small', (item.projectIds || []).map(id => names.get(id) || id).join(' · ') || 'Sem projeto'));
      return [identity, integer.format(number(item.tokens)), usd(item.cost), integer.format(number(item.tasks)), decimal.format(number(item.hours))];
    });
    const wrap = node('div', undefined, 'analytics-table-wrap'); wrap.id = 'analytics-agent-table'; wrap.append(table(['Agente / projetos', 'Tokens', 'Custo · USD', 'Tarefas', 'Horas ativas'], agentRows, 'Resultados por agente nos projetos filtrados')); agents.append(wrap);
  }
  function refresh(notify = true) {
    if (disposed) return null;
    const options = store.getOptions();
    if (!PERIODS.some(([id]) => id === state.period)) state.period = 'week';
    if (state.projectId !== 'all' && !options.projects.some(item => item.id === state.projectId)) state.projectId = 'all';
    if (state.modelId !== 'all' && !options.models.some(item => item.id === state.modelId)) state.modelId = 'all';
    result = store.query({period: state.period, projectId: state.projectId, modelId: state.modelId});
    fillSelect(project.select, options.projects, 'Todos os projetos', state.projectId); fillSelect(model.select, options.models, 'Todos os modelos', state.modelId);
    for (const [id, item] of periodButtons) item.setAttribute('aria-pressed', String(state.period === id));
    const projectName = options.projects.find(item => item.id === state.projectId)?.name || 'Todos os projetos';
    const modelName = options.models.find(item => item.id === state.modelId)?.name || 'Todos os modelos';
    scope.textContent = `${result.range.label} · ${projectName} · ${modelName}`;
    disclaimer.replaceChildren(node('strong', 'Como ler estes números'), node('p', `${options.disclaimer || 'Dados simulados para explorar a sede.'} Os custos são calculados com tarifas fictícias de entrada e saída por modelo; não representam uma cobrança real. Tarefas são entregas concluídas, não o número de chamadas. Horas ativas somam o tempo de todos os agentes e podem acontecer em paralelo.`));
    renderTotals(); renderChart(); renderBreakdowns(options);
    if (notify) onChange({state: getState(), result}); return result;
  }
  function open({projectId, period} = {}) {
    if (disposed) return false;
    if (projectId !== undefined) state.projectId = projectId;
    if (period !== undefined) state.period = period;
    if (!opened) {previousFocus = doc.activeElement; opened = true; element.showModal(); body.scrollTop = 0;}
    refresh(); closeButton.focus({preventScroll: true}); return true;
  }
  function close() {
    if (!opened || disposed) return false;
    opened = false; element.close(); if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus({preventScroll: true}); onClose(); return true;
  }
  function onKey(event) {
    if (!opened) return;
    if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); close();}
    // Native dialog supplies the Tab trap. Movement keys are deliberately not
    // handled here; the application owns suspension of exploration controls.
  }
  function onCancel(event) {event.preventDefault(); close();}
  element.addEventListener('keydown', onKey); element.addEventListener('cancel', onCancel);
  refresh(false);
  return {element, open, close, refresh, getState, getResult: () => result,
    dispose() {if (disposed) return; close(); disposed = true; element.removeEventListener('keydown', onKey); element.removeEventListener('cancel', onCancel); element.remove();}
  };
}

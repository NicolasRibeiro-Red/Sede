import { FLOORS, agentsForFloor } from './layout.js';

// IDS: reuse the live roster from layout.js. This standalone prototype has no
// connection to providers, billing, life.js counters or real project activity.
// Every number below is derived from completed task records generated per UTC
// date. One task owns one agent/project/model; hours sum active agent time, so
// parallel work is additive. Rates are deliberately fictional USD per million.
const DAY = 86400000;
const PERIOD_DAYS = { week: 7, month: 30, year: 365 };
const PROJECTS = [
  { id: 'sede', name: 'Sede 3D' },
  { id: 'marca', name: 'Conteúdo & marca' },
  { id: 'automacoes', name: 'Automações' },
  { id: 'pesquisa', name: 'Pesquisa de produto' },
];
const MODELS = [
  { id: 'gpt-demo', name: 'GPT · demo', inputRatePerMillion: 3, outputRatePerMillion: 12 },
  { id: 'claude-demo', name: 'Claude · demo', inputRatePerMillion: 4, outputRatePerMillion: 16 },
  { id: 'gemini-demo', name: 'Gemini · demo', inputRatePerMillion: 2, outputRatePerMillion: 8 },
].map(model => ({ ...model, pricing: 'fictional', currency: 'USD' }));
const AGENTS = FLOORS.flatMap(floor => agentsForFloor(floor.id).map(agent => ({ id: agent.id, name: agent.name })));
const DISCLAIMER = 'Dados e tarefas simulados. Tarifas fictícias em USD, sem relação com preços oficiais ou consumo real. Horas somam o tempo ativo dos agentes, inclusive em paralelo.';
const isoDay = time => new Date(time).toISOString().slice(0, 10);
const shortDay = date => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const fullDay = date => `${shortDay(date)}/${date.slice(0, 4)}`;
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function dayStart(value) {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(time)) throw new TypeError('Analytics now must be a valid date.');
  return Math.floor(time / DAY) * DAY;
}

function seededRandom(date) {
  let seed = 2166136261;
  for (const character of `sede-analytics-v1:${date}`) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  return () => {
    seed += 0x6D2B79F5;
    let value = Math.imul(seed ^ seed >>> 15, seed | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function taskRecords(end) {
  const records = [];
  for (let time = end - 364 * DAY; time <= end; time += DAY) {
    const date = isoDay(time), random = seededRandom(date), integer = (min, max) => min + Math.floor(random() * (max - min + 1));
    const weekday = new Date(time).getUTCDay(), count = weekday === 0 || weekday === 6 ? integer(5, 8) : integer(11, 17);
    for (let index = 0; index < count; index++) {
      const agentIndex = integer(0, AGENTS.length - 1), agent = AGENTS[agentIndex];
      const project = PROJECTS[random() < .62 ? Math.floor(agentIndex / 4) : integer(0, PROJECTS.length - 1)];
      const modelChoice = random(), model = MODELS[modelChoice < .45 ? 0 : modelChoice < .78 ? 1 : 2];
      const inputTokens = integer(3200, 44000), outputTokens = integer(450, 8500);
      const durationSeconds = integer(240, 2100) + Math.floor(outputTokens * .045);
      records.push({
        id: `task-${date}-${String(index + 1).padStart(2, '0')}`, date, status: 'completed',
        projectId: project.id, modelId: model.id, agentId: agent.id,
        inputTokens, outputTokens, durationSeconds,
        // Integer microdollars prevent repeated floating-point rounding in the
        // aggregation. Divide once at the output boundary, never round money.
        costMicros: inputTokens * model.inputRatePerMillion + outputTokens * model.outputRatePerMillion,
      });
    }
  }
  return records;
}

function accumulator() {
  return { inputTokens: 0, outputTokens: 0, costMicros: 0, durationSeconds: 0, taskIds: new Set() };
}
function add(total, record) {
  if (total.taskIds.has(record.id)) return;
  total.taskIds.add(record.id); total.inputTokens += record.inputTokens; total.outputTokens += record.outputTokens;
  total.costMicros += record.costMicros; total.durationSeconds += record.durationSeconds;
}
function metrics(total) {
  return {
    inputTokens: total.inputTokens, outputTokens: total.outputTokens,
    tokens: total.inputTokens + total.outputTokens, cost: total.costMicros / 1e6,
    hours: total.durationSeconds / 3600, durationSeconds: total.durationSeconds, tasks: total.taskIds.size,
  };
}
function grouped(records, field, options, relation) {
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record[field])) groups.set(record[field], { total: accumulator(), related: new Set() });
    const group = groups.get(record[field]); add(group.total, record);
    if (relation) group.related.add(record[relation]);
  }
  return options.filter(option => groups.has(option.id)).map(option => {
    const group = groups.get(option.id);
    return { id: option.id, name: option.name, ...metrics(group.total), ...(relation ? { [relation === 'agentId' ? 'agentIds' : 'projectIds']: [...group.related].sort() } : {}) };
  }).sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id));
}

/**
 * Create an immutable 365-day demo snapshot anchored to the UTC day of `now`.
 * week/month/year mean inclusive trailing 7/30/365 days, not calendar periods.
 * Queries intersect project/model filters. Unknown IDs produce zero-filled
 * chart buckets and empty rankings. Year buckets are calendar months (the
 * first and last may be partial); their `date` is the first INCLUDED day.
 * share and leaderModel rank token use, not cost. Extra costShare is separate.
 */
export function createAnalyticsStore({ now = new Date() } = {}) {
  const end = dayStart(now), records = taskRecords(end);
  function getOptions() {
    return { projects: PROJECTS.map(item => ({ ...item })), models: MODELS.map(item => ({ ...item })), agents: AGENTS.map(item => ({ ...item })), disclaimer: DISCLAIMER };
  }
  function query({ period = 'week', projectId = 'all', modelId = 'all' } = {}) {
    if (!Object.hasOwn(PERIOD_DAYS, period)) throw new RangeError('Analytics period must be week, month or year.');
    const start = end - (PERIOD_DAYS[period] - 1) * DAY, first = isoDay(start), last = isoDay(end);
    const selected = records.filter(record => record.status === 'completed' && record.date >= first && record.date <= last
      && (projectId === 'all' || record.projectId === projectId) && (modelId === 'all' || record.modelId === modelId));
    const total = accumulator(), buckets = new Map();
    for (let time = start; time <= end; time += DAY) {
      const date = isoDay(time), key = period === 'year' ? date.slice(0, 7) : date;
      if (!buckets.has(key)) buckets.set(key, { date, label: period === 'year' ? `${MONTHS[Number(date.slice(5, 7)) - 1]}/${date.slice(0, 4)}` : shortDay(date), total: accumulator() });
    }
    for (const record of selected) {
      add(total, record); add(buckets.get(period === 'year' ? record.date.slice(0, 7) : record.date).total, record);
    }
    const totals = metrics(total), models = grouped(selected, 'modelId', MODELS).map(model => ({
      ...model, share: totals.tokens ? model.tokens / totals.tokens : 0, costShare: totals.cost ? model.cost / totals.cost : 0,
    }));
    return {
      period, range: { start: first, end: last, label: `${fullDay(first)} – ${fullDay(last)} · UTC` },
      filters: { projectId, modelId }, totals,
      series: [...buckets.values()].map(bucket => ({ date: bucket.date, label: bucket.label, ...metrics(bucket.total) })),
      models, projects: grouped(selected, 'projectId', PROJECTS, 'agentId'), agents: grouped(selected, 'agentId', AGENTS, 'projectId'),
      leaderModel: models[0] ? { ...models[0] } : null,
    };
  }
  return { getOptions, query };
}

// CAPCOM engine: turns a spoken/typed request into TETHER tool calls, runs them, waits for the
// route engine, then answers from get_status() only.
//   - "offline analyst": deterministic keyword/regex intent parser + templated answers (always available)
//   - "WebLLM": an in-browser instruct model (WebGPU) that plans tool calls as constrained JSON and
//     phrases the answer. Its reply passes a number guard: any number not present in the status JSON
//     (or the user's own words) gets the reply replaced by the templated answer.
import type { Dataset } from '../data';
import { compact, findTargetsInText, getStatus, hasAutopilot, resolveTarget, runTool, settle, targetRefs, TOOL_NAMES,
  type CapcomStatus, type ToolCall, type ToolName, type ToolResult } from './capcomTools';

export type Focus = 'feasibility' | 'dose' | 'storm' | 'time' | 'distance' | 'reserve' | 'general' | 'chat';
export interface Plan { calls: ToolCall[]; focus: Focus }
export interface CapcomReply {
  text: string;
  engine: string;          // badge text: which engine produced the words
  planner: string;         // which engine chose the tool calls
  guarded: boolean;        // true when the LLM's wording was replaced by the template
  calls: ToolCall[]; results: ToolResult[]; status: CapcomStatus; ms: number;
}

// ======================================================================= offline analyst
const WORDNUM: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, a: 1, an: 1 };

export function normalizeNumbers(t: string): string {
  let s = ' ' + t.toLowerCase().replace(/[–—]/g, ' ') + ' ';
  s = s.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty)[\s-](one|two|three|four|five|six|seven|eight|nine)\b/g, (_, a, b) => String(WORDNUM[a] + WORDNUM[b]));
  s = s.replace(/\b(\d+|one|two|three|four|five|six|seven|eight)\s+and\s+a\s+half\b/g, (_, a) => String((isNaN(+a) ? WORDNUM[a] : +a) + 0.5));
  s = s.replace(/\b(a|an)\s+half\b/g, '0.5');
  s = s.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty)\b/g, (w) => String(WORDNUM[w]));
  s = s.replace(/\b(\d+)\s*(?:per\s*cent|percent)\b/g, '$1%');
  return s;
}

export function offlinePlan(data: Dataset, text: string): Plan {
  const s = normalizeNumbers(text);
  const calls: ToolCall[] = [];
  const has = (re: RegExp) => re.test(s);

  // EVA hours: "3 hours", "4 hour walk", "3h", "3.5 hrs"
  const hm = s.match(/(\d+(?:\.\d+)?)\s*-?\s*(?:hours?|hrs?|h)\b/);
  if (hm && !has(/(?:dose|radiation)\s+(?:per|in)\s+\d/)) calls.push({ tool: 'set_eva_hours', args: { hours: +hm[1] } });

  // reserve: "25% reserve", "reserve of 25", "keep 30% margin"
  const rm = s.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:safety\s+)?(?:reserve|margin|buffer|left|spare)/)
    ?? s.match(/(?:reserve|margin|buffer)\s*(?:of|to|at|=|is)?\s*(\d+(?:\.\d+)?)\s*%?/)
    ?? (has(/reserve|margin|buffer|safety/) ? s.match(/(\d+(?:\.\d+)?)\s*%/) : null);
  if (rm) calls.push({ tool: 'set_reserve', args: { pct: +rm[1] } });

  // loads: "carry 20 kg out and 35 kg back"
  const kgs = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(?:kg|kilos?|kilograms?)\b([^\d]{0,24})/g)];
  if (kgs.length) {
    const args: Record<string, number> = {};
    kgs.forEach((m, i) => {
      const after = m[2] ?? '', before = s.slice(Math.max(0, (m.index ?? 0) - 24), m.index);
      const back = /back|home|return|sample/.test(after) || /back|home|return|sample/.test(before.split(/kg/).pop() ?? '');
      if (back || (i > 0 && args.out_kg !== undefined)) args.back_kg = +m[1]; else args.out_kg = +m[1];
    });
    calls.push({ tool: 'set_loads', args });
  }

  // storm drill
  const storm = has(/solar|storm|flare|particle|\bsep\b|cme|space weather/);
  if (storm) {
    const off = has(/\b(end|stop|cancel|clear|over|off|abort|finish|disable)\b/);
    const query = has(/\?\s*$/) && !has(/simulate|start|trigger|run|drill|begin|what if|hit/);
    if (!query || off) calls.push({ tool: 'storm_drill', args: { on: !off } });
  }

  // stops
  if (has(/\b(clear|reset|remove|delete|drop)\b.*\b(stops?|route|plan|everything|all)\b|start over/)) calls.push({ tool: 'clear_stops' });
  const names = has(/\bdemo\b/) ? ['Altadena', 'Nevado Sajama', 'Campo Marte'] : findTargetsInText(data, text);
  if (names.length) calls.push({ tool: 'plan_stops', args: { names, append: has(/\b(add|also|extra|another)\b/) } });

  if (has(/autopilot|auto-?plan|optimi[sz]e|best route|plan (it|one|a route) for me|suggest a route/) && hasAutopilot()) calls.push({ tool: 'run_autopilot' });
  if (has(/\b3d\b|three d|walk it|fly ?through|immersive|show me the walk|hud/)) calls.push({ tool: 'open_3d' });
  else if (has(/\b(back to|show) (the )?(map|plan)\b|plan view|map view/)) calls.push({ tool: 'open_map' });

  let focus: Focus = 'general';
  if (storm) focus = 'storm';
  else if (has(/dose|radiation|sievert|cosmic|gcr|shield/)) focus = 'dose';
  else if (has(/how far|distance|kilomet|how long is/)) focus = 'distance';
  else if (has(/how long|time|duration|when/) && !hm) focus = 'time';
  else if (has(/reserve|margin|left over|tightest|bottleneck|weakest/) && !rm) focus = 'reserve';
  else if (calls.length || has(/can (i|we)|feasib|safe|make it|enough|verdict|status|go for|ok to|possible|work\b/)) focus = 'feasibility';
  else if (has(/^\s*(hi|hello|hey|thanks|thank you|who are you|help)\b/)) focus = 'chat';
  return { calls, focus };
}

const STOP_JOIN = (a: string[]) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

export function templateAnswer(st: CapcomStatus, focus: Focus, results: ToolResult[]): string {
  const opened = results.some((r) => r.ok && r.tool === 'open_3d') ? 'Opening the 3D walk. ' : results.some((r) => r.ok && r.tool === 'open_map') ? 'Back to the map. ' : '';
  const body = templateBody(st, opened && (focus === 'feasibility' || focus === 'general') ? 'reserve' : focus, results);
  return opened ? opened + body.replace(/^Yes\. /, '') : body;
}
function templateBody(st: CapcomStatus, focus: Focus, results: ToolResult[]): string {
  const failed = results.filter((r) => !r.ok).map((r) => r.note);
  const fail = failed.length ? ` Note: ${failed.join('; ')}.` : '';
  if (focus === 'chat') return `CAPCOM here. Ask me things like "Can I visit Altadena and Campo Marte in 3 hours with a 25% reserve?", "Simulate a solar storm", or "What's my radiation dose?".${fail}`;
  if (st.state !== 'ok') {
    const ctx = st.state === 'no_stops' ? ' Name a target, for example Altadena, Nevado Sajama or Campo Marte.' : '';
    const storm = focus === 'storm' && st.storm.on ? ` Storm drill is on with ${st.storm.lead_min} minutes of warning.` : '';
    return `${st.message ?? 'No route yet.'}${ctx}${storm}${fail}`;
  }
  const where = st.bottleneck ? ` ${st.bottleneck}` : '';
  const verdict = st.pass
    ? `Yes. Tether holds: lowest walk-home reserve is ${st.min_reserve_pct}%${where}, against your ${st.required_reserve_pct}% rule.`
    : (st.min_reserve_pct ?? 0) < 0
      ? `No. Tether broken:${where} the crew would run out of suit time before reaching the habitat, reserve ${st.min_reserve_pct}% against your ${st.required_reserve_pct}% rule.`
      : `No. Tether broken: reserve drops to ${st.min_reserve_pct}%${where}, below your ${st.required_reserve_pct}% rule.`;
  const core = ` ${STOP_JOIN(st.stops)}: ${st.distance}, ${st.eva_time} of a ${st.eva_budget_h} hour suit budget.`;
  const fix = st.pass ? '' : ' Drop a stop, extend the EVA, or lighten the load.';
  switch (focus) {
    case 'dose':
      return `Route dose is ${st.dose_usv} microsieverts of galactic cosmic rays over ${st.eva_time}. Terrain shielding saves ${st.terrain_saves_pct}% versus open ground.${fail}`;
    case 'storm': {
      if (!st.storm.on) return `Storm drill ended. ${verdict}${fail}`;
      const ss = st.storm.stops ?? [];
      const safe = ss.filter((x) => x.safe), unsafe = ss.filter((x) => !x.safe);
      const worst = unsafe.sort((a, b) => b.fast_walk_home_min - a.fast_walk_home_min)[0];
      const head = `Solar particle alert, ${st.storm.lead_min} minutes of warning. ${st.storm.route_safe_pct}% of the route can reach the habitat in time.`;
      if (!unsafe.length) return `${head} Every stop is inside the safe zone.${fail}`;
      return `${head} ${worst.name} is ${worst.fast_walk_home_min} minutes from shelter, too far: it needs a closer safe haven.${safe.length ? ` ${STOP_JOIN(safe.map((x) => x.name))} ${safe.length > 1 ? 'are' : 'is'} safe.` : ''}${fail}`;
    }
    case 'time': return `EVA time is ${st.eva_time} of a ${st.eva_budget_h} hour budget, including ${st.science_min_per_stop} minutes of science per stop. ${verdict}${fail}`;
    case 'distance': return `The loop is ${st.distance} with ${st.climb_m} metres of climb; steepest grade ${st.steepest_deg} degrees.${fail}`;
    case 'reserve': return `${verdict}${fix}${fail}`;
    default: return `${verdict}${core}${fix}${fail}`;
  }
}

// ======================================================================= number guard
function collectNumbers(v: unknown, out: number[]) {
  if (typeof v === 'number') out.push(Math.abs(v));
  else if (typeof v === 'string') for (const m of v.matchAll(/\d+(?:\.\d+)?/g)) out.push(+m[0]);
  else if (Array.isArray(v)) v.forEach((x) => collectNumbers(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collectNumbers(x, out));
}
export function numberGuard(reply: string, st: CapcomStatus, extra: string[], focus: Focus = 'general'): { ok: boolean; bad: string[] } {
  const allowed: number[] = []; collectNumbers(st, allowed); extra.forEach((e) => collectNumbers(e, allowed));
  allowed.push(st.stops.length);
  if (st.storm.stops) { allowed.push(st.storm.stops.filter((x) => x.safe).length, st.storm.stops.filter((x) => !x.safe).length); }
  const bad: string[] = [];
  for (const m of reply.replace(/Qwen[\d.]+|\b3D\b|\bsol\s+\d+/gi, '').matchAll(/\d+(?:[.,]\d+)?/g)) {
    const n = +m[0].replace(',', '.');
    if (!allowed.some((a) => Math.abs(a - n) < 0.051 || (Math.round(a) === n && Math.abs(a - n) < 1))) bad.push(m[0]);
  }
  // unit check: a percentage must be one of the status percentages (or said by the astronaut)
  const pcts = [st.min_reserve_pct, st.required_reserve_pct, st.terrain_saves_pct, st.storm.route_safe_pct].filter((x): x is number => x !== undefined).map(Math.abs);
  extra.forEach((e) => { for (const m of e.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|percent)/g)) pcts.push(+m[1]); });
  for (const m of reply.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)/gi)) if (!pcts.some((p) => Math.abs(p - +m[1]) < 0.051)) bad.push(m[0]);
  // verdict consistency
  if (st.state === 'ok') {
    if (st.pass === false && /^\s*yes\b|tether holds/i.test(reply)) bad.push('verdict');
    if (st.pass === true && /^\s*no\b|tether broken/i.test(reply)) bad.push('verdict');
    if ((focus === 'feasibility' || focus === 'reserve') && st.min_reserve_pct !== undefined
        && !new RegExp(`(^|[^\\d.])${Math.abs(st.min_reserve_pct)}(?![\\d])`).test(reply)) bad.push('missing min_reserve_pct');
    if (focus === 'dose' && st.dose_usv !== undefined && !new RegExp(`(^|[^\\d.])${st.dose_usv}(?![\\d])`).test(reply)) bad.push('missing dose_usv');
  }
  return { ok: bad.length === 0, bad };
}

// ======================================================================= WebLLM
type WebLLM = typeof import('@mlc-ai/web-llm');
type Engine = import('@mlc-ai/web-llm').MLCEngineInterface;
export interface LlmState { phase: 'idle' | 'loading' | 'ready' | 'error' | 'unsupported'; progress: number; text: string; model: string; loadMs?: number }

export const DEFAULT_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
export const shortModel = (id: string) => id.replace(/-Instruct.*|-q\d.*$/, '').replace(/-MLC$/, '');

let engine: Engine | null = null;
let loading: Promise<Engine> | null = null;
let worker: Worker | null = null;

export async function webgpuSupport(): Promise<{ ok: boolean; f16: boolean; why?: string }> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } }).gpu;
  if (!gpu) return { ok: false, f16: false, why: 'This browser has no WebGPU' };
  try {
    const a = await gpu.requestAdapter();
    if (!a) return { ok: false, f16: false, why: 'No WebGPU adapter' };
    return { ok: true, f16: a.features.has('shader-f16') };
  } catch (e) { return { ok: false, f16: false, why: String(e) }; }
}

export function pickModel(f16: boolean): string {
  const q = new URLSearchParams(location.search).get('capcomModel');
  if (q) return q;
  return f16 ? DEFAULT_MODEL : DEFAULT_MODEL.replace('q4f16_1', 'q4f32_1');
}

export function loadLlm(model: string, onProgress: (p: number, text: string) => void): Promise<Engine> {
  if (engine) return Promise.resolve(engine);
  if (loading) return loading;
  loading = (async () => {
    const webllm: WebLLM = await import('@mlc-ai/web-llm');
    worker = new Worker(new URL('./capcomLlm.worker.ts', import.meta.url), { type: 'module' });
    const e = await webllm.CreateWebWorkerMLCEngine(worker, model, {
      initProgressCallback: (r) => onProgress(r.progress, r.text),
      logLevel: 'WARN',
    });
    engine = e; return e;
  })();
  loading.catch(() => { loading = null; worker?.terminate(); worker = null; });
  return loading;
}
export const llmReady = () => !!engine;

const PLAN_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    calls: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tool: { type: 'string', enum: TOOL_NAMES },
          args: {
            type: 'object',
            properties: {
              hours: { type: 'number' }, pct: { type: 'number' }, out_kg: { type: 'number' }, back_kg: { type: 'number' },
              names: { type: 'array', items: { type: 'string' } }, on: { type: 'boolean' }, append: { type: 'boolean' },
            },
          },
        },
        required: ['tool'],
      },
    },
    focus: { type: 'string', enum: ['feasibility', 'dose', 'storm', 'time', 'distance', 'reserve', 'general', 'chat'] },
  },
  required: ['calls', 'focus'],
});

function planSystem(data: Dataset): string {
  const names = targetRefs(data).map((t) => t.short).join(', ');
  return `You are CAPCOM, mission control for TETHER, a Mars EVA (spacewalk on foot) planner at Gale crater.
Convert the astronaut's request into tool calls. Output ONLY JSON: {"calls":[{"tool":...,"args":{...}}],"focus":...}.
Tools:
- set_eva_hours {hours}: total suit time, 2 to 8 hours.
- set_reserve {pct}: safety reserve percent kept for the walk home, 0 to 50.
- set_loads {out_kg, back_kg}: mass carried out (tools) and back (tools + samples).
- plan_stops {names, append}: science stops in visiting order. append=true only when adding to the existing route.
- clear_stops {}: remove all stops.
- storm_drill {on}: start (true) or end (false) a solar particle storm drill.
- open_3d {}: show the walk in 3D. open_map {}: back to the map.
- get_status {}: read the current plan (use when only asking a question).${hasAutopilot() ? '\n- run_autopilot {}: let the optimiser choose stops.' : ''}
Known targets: ${names}.
focus = what the answer should talk about: feasibility, dose, storm, time, distance, reserve, general, or chat (greetings/help).
Never invent tools or targets. Use [] for calls when nothing should change.
Examples:
"Can I visit Altadena and Campo Marte in 3 hours with a 25% reserve?" -> {"calls":[{"tool":"set_eva_hours","args":{"hours":3}},{"tool":"set_reserve","args":{"pct":25}},{"tool":"plan_stops","args":{"names":["Altadena","Campo Marte"]}}],"focus":"feasibility"}
"Simulate a solar storm." -> {"calls":[{"tool":"storm_drill","args":{"on":true}}],"focus":"storm"}
"Make it a 4 hour walk" -> {"calls":[{"tool":"set_eva_hours","args":{"hours":4}}],"focus":"feasibility"}
"What's my radiation dose?" -> {"calls":[],"focus":"dose"}
"Add Nazca" -> {"calls":[{"tool":"plan_stops","args":{"names":["Nazca"],"append":true}}],"focus":"feasibility"}`;
}

const ANSWER_SYSTEM = `You are CAPCOM, calm mission control speaking by radio to an astronaut walking on Mars.
You receive FACTS computed by the route engine. Rephrase them as a short spoken reply: at most 2 sentences, under 45 words, plain English, no lists, no markdown.
Keep every number exactly as written in FACTS, with its unit and next to the same words it describes there. Do not add any fact, number, cause or advice that is not in FACTS.
If FACTS start with "Yes", "No" or "Opening", start with the same word.`;

function sanitizeCalls(raw: unknown): ToolCall[] {
  const arr = (raw as { calls?: unknown })?.calls;
  if (!Array.isArray(arr)) return [];
  return arr.filter((c): c is ToolCall => !!c && typeof c === 'object' && TOOL_NAMES.includes((c as ToolCall).tool as ToolName))
    .filter((c) => c.tool !== 'get_status').slice(0, 8);
}

async function llmPlan(e: Engine, data: Dataset, text: string, history: string[]): Promise<Plan | null> {
  const r = await e.chat.completions.create({
    messages: [
      { role: 'system', content: planSystem(data) },
      { role: 'user', content: history.length ? `(Previous requests, for context only: ${history.slice(-2).join(' | ')})\nRequest: ${text}` : text },
    ],
    temperature: 0, max_tokens: 220,
    response_format: { type: 'json_object', schema: PLAN_SCHEMA },
  });
  try {
    const j = JSON.parse(r.choices[0]?.message?.content ?? '');
    const focus = (j.focus ?? 'general') as Focus;
    return { calls: sanitizeCalls(j), focus };
  } catch { return null; }
}

async function llmAnswer(e: Engine, text: string, facts: string): Promise<string> {
  const r = await e.chat.completions.create({
    messages: [
      { role: 'system', content: ANSWER_SYSTEM },
      { role: 'user', content: `Astronaut asked: "${text}"\nFACTS: ${facts}` },
    ],
    temperature: 0.2, max_tokens: 100,
  });
  return (r.choices[0]?.message?.content ?? '').trim().replace(/\s+/g, ' ').replace(/^"|"$/g, '');
}

// Only keep LLM tool calls whose arguments are grounded in the astronaut's own words.
function groundCalls(data: Dataset, text: string, calls: ToolCall[], offline: Plan): ToolCall[] {
  const norm = normalizeNumbers(text);
  const nums = [...norm.matchAll(/\d+(?:\.\d+)?/g)].map((m) => +m[0]);
  const said = (v: unknown) => typeof v === 'number' && nums.some((n) => Math.abs(n - v) < 1e-6);
  const offStops = offline.calls.find((c) => c.tool === 'plan_stops')?.args?.names as string[] | undefined;
  const allowedNames = new Set([...(offStops ?? []), ...findTargetsInText(data, text)].map(compact));
  const offTools = new Set(offline.calls.map((c) => c.tool));
  const out: ToolCall[] = [];
  for (const c of calls) {
    const a = { ...(c.args ?? {}) };
    switch (c.tool) {
      case 'set_eva_hours': if (said(a.hours)) out.push({ tool: c.tool, args: { hours: a.hours } }); break;
      case 'set_reserve': if (said(a.pct)) out.push({ tool: c.tool, args: { pct: a.pct } }); break;
      case 'set_loads': {
        const g: Record<string, unknown> = {};
        if (said(a.out_kg)) g.out_kg = a.out_kg; if (said(a.back_kg)) g.back_kg = a.back_kg;
        if (Object.keys(g).length) out.push({ tool: c.tool, args: g }); break;
      }
      case 'plan_stops': {
        const names = (Array.isArray(a.names) ? a.names : []).map(String).filter((n) => { const t = resolveTarget(data, n); return t && allowedNames.has(compact(t.short)); });
        if (names.length) out.push({ tool: c.tool, args: { names, append: !!a.append } }); break;
      }
      case 'clear_stops': if (/\b(clear|reset|remove|delete|drop|start over|wipe)\b/i.test(text)) out.push(c); break;
      case 'storm_drill': if (/solar|storm|flare|particle|\bsep\b|cme|space weather/i.test(text)) out.push({ tool: c.tool, args: { on: a.on !== false } }); break;
      default: if (offTools.has(c.tool) || c.tool === 'open_map' || c.tool === 'open_3d' && /3d|three d|walk|show/i.test(text)) out.push(c);
    }
  }
  return out;
}

// ======================================================================= orchestrator
export async function ask(data: Dataset, text: string, opts: { useLlm: boolean; model: string; history: string[]; onStage?: (s: string) => void }): Promise<CapcomReply> {
  const t0 = performance.now();
  const offline = offlinePlan(data, text);
  let plan = offline, planner = 'offline analyst';
  const llm = opts.useLlm && engine ? engine : null;
  const label = `WebLLM · ${shortModel(opts.model)}`;
  if (llm) {
    opts.onStage?.('thinking');
    try {
      const p = await llmPlan(llm, data, text, opts.history);
      if (p) {
        const grounded = groundCalls(data, text, p.calls, offline);
        const extra = offline.calls.filter((c) => !grounded.some((g) => g.tool === c.tool));
        const focus = offline.focus === 'general' || offline.focus === 'feasibility' ? p.focus : offline.focus;
        plan = { calls: [...grounded, ...extra], focus };
        planner = grounded.length && extra.length ? `${label} + offline analyst` : grounded.length ? label : offline.calls.length ? 'offline analyst' : label;
      }
    } catch (e) { console.warn('[capcom] llm plan failed', e); }
  }
  opts.onStage?.('executing');
  const results: ToolResult[] = [];
  for (const c of plan.calls) results.push(await runTool(data, c));
  let status: CapcomStatus;
  if (plan.calls.length) { opts.onStage?.('routing'); const r = await settle(); status = getStatus(data);
    if (r === 'timeout' && status.state === 'ok') status = { ...status, state: 'computing', message: 'Route engine still computing; ask again in a moment.' }; }
  else status = getStatus(data);
  const template = templateAnswer(status, plan.focus, results);
  if (!llm || plan.focus === 'chat') return { text: template, engine: llm ? `${label} · template` : 'offline analyst', planner, guarded: false, calls: plan.calls, results, status, ms: performance.now() - t0 };
  opts.onStage?.('speaking');
  try {
    const reply = await llmAnswer(llm, text, template);
    const g = numberGuard(reply, status, [text, template], plan.focus);
    // faithfulness: the paraphrase must keep every number of the FACTS and the same Yes/No
    const nums = (t: string) => [...t.matchAll(/\d+(?:\.\d+)?/g)].map((m) => +m[0]);
    const rn = nums(reply);
    for (const n of nums(template)) if (!rn.some((x) => Math.abs(x - n) < 0.051)) g.bad.push('dropped ' + n);
    const yn = template.match(/^(Yes|No|Opening)\b/);
    if (yn && !new RegExp('^\\W*' + yn[1] + '\\b', 'i').test(reply)) g.bad.push('verdict word');
    // key phrases that pin a number to its meaning must survive the paraphrase
    for (const k of ['warning', 'reserve', 'microsieverts', 'rule']) if (template.includes(k) && !reply.toLowerCase().includes(k)) g.bad.push('lost "' + k + '"');
    g.ok = g.bad.length === 0;
    if (reply && g.ok) return { text: reply, engine: label, planner, guarded: false, calls: plan.calls, results, status, ms: performance.now() - t0 };
    console.info('[capcom] number guard replaced reply', reply, g.bad);
  } catch (e) { console.warn('[capcom] llm answer failed', e); }
  return { text: template, engine: `${label} · guarded`, planner, guarded: true, calls: plan.calls, results, status, ms: performance.now() - t0 };
}

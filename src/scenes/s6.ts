// Scene 6, the suit test: how do we know Rocky's walking numbers are real? NASA measured them on people. Test subjects in
// the 121 kg Mark III suit walked on a treadmill at Johnson Space Center while an overhead rig lifted part of their weight
// (Moon 0.17 g, Mars 0.38 g) and their oxygen use was measured. Rocky's own energy function is run on the same conditions.
// Every figure is computed at run time from rocky/public/data/validation_walking.json and Rocky's planner (s6-data.ts).
// URL: #6?c=1..9 picks the condition (default 4: Moon gravity, 0.75 m/s, 10% uphill); &step=2 adds Rocky's optional
// "scale flat-ground effort with gravity" setting. Keys: 1 to 9 pick a condition, G toggles the setting.
import { chrome } from './chrome';
import { BUDGET } from './plan';
import { makeLab } from './s6-lab';
import { analyse, GROUPS, type Check, type Row } from './s6-data';
import './s6.css';

const MAX = 1250;                                       // gauge and chart top, watts (the largest measured value plus its spread is 1240 W)
const SHORT: Record<string, string> = { 'EWT-2007': 'Walkback Test', 'EWT-2008': '10 km walkback', 'IST-REVIEW-2009': 'Integrated Suit Tests', 'IST2-TP': 'Suit Test 2, slopes', 'ANALOGS-2013': 'Reduced-gravity analogs' };
const W = (x: number) => `${Math.round(x)} W`, pct = (x: number, sign = false) => `${sign && x >= 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(100 * x))}%`;
const words = (r: Row, br = ' · ') => `${r.g > .3 ? 'Mars' : 'Moon'} gravity ${r.g.toFixed(2)} g${br}${r.v.toFixed(2)} m/s · ${r.grade ? `${r.grade}% uphill` : 'flat'}`;

export default async function scene6() {
  const { stage, setPill } = chrome('Evidence', { text: 'Loading NASA suit tests' });
  stage.classList.add('withpanel');
  const app = document.getElementById('app')!;
  app.insertAdjacentHTML('beforeend', '<aside class="panel s6-panel" id="panel"></aside>');
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');

  const d = await fetch('data/validation_walking.json').then((r) => r.json()) as Check;
  const A = analyse(d), rows = A.rows, lab = makeLab(stage);
  let cur = Math.min(9, Math.max(1, Number(q.get('c')) || 4)) - 1, step2 = q.get('step') === '2';

  // ---- gauge -----------------------------------------------------------------------------------------------------------
  stage.insertAdjacentHTML('beforeend', `
    <div class="s6-gauge"><div class="s6-gt">Effort, watts</div><div class="s6-track" id="trk">
      ${[0, 250, 500, 750, 1000, 1250].map((t) => `<span class="tk" style="bottom:${t / MAX * 100}%">${t}</span>`).join('')}
      <div class="sd" id="gSd"></div>
      <div class="mk m" id="mM"></div><div class="mk r" id="mR"></div><div class="mk s" id="mS"></div>
      <div class="lb m" id="lM"></div><div class="lb r" id="lR"></div><div class="lb s" id="lS"></div>
    </div><button class="tog" id="tog"><kbd>G</kbd>Gravity-scaled setting</button></div>
    <div class="s6-sel">${GROUPS.map((g) => { const rs = rows.filter((r) => r.group === g.key), thin = rs.some((r) => r.weak);
      return `<div class="grp"><div class="gh"><i style="background:${g.colour}"></i>${g.name}${thin ? `<em>thin data: ${Math.min(...rs.map((r) => r.n))} subjects</em>` : ''}</div><div class="row">${rs.map((r) => { const i = rows.indexOf(r);
        return `<button data-i="${i}"><kbd>${i + 1}</kbd>${r.grade ? `${r.grade}%` : `${r.v.toFixed(2)} m/s`}</button>`; }).join('')}</div></div>`; }).join('')}
    </div>`);
  const lift = document.createElement('div'); lift.className = 's6-lift'; lab.chip(lift, lab.rigAt);
  stage.querySelectorAll<HTMLButtonElement>('.s6-sel [data-i]').forEach((b) => { b.onclick = () => select(+b.dataset.i!); });
  document.getElementById('tog')!.onclick = () => toggle();
  const $ = (id: string) => document.getElementById(id)!;

  // ---- panel -----------------------------------------------------------------------------------------------------------
  const LO = 200, S = 300, L = 58, T = 10, f = (v: number) => (Math.max(LO, Math.min(v, MAX)) - LO) / (MAX - LO), X = (v: number) => L + f(v) * S, Y = (v: number) => T + S - f(v) * S;
  const colour = (r: Row) => GROUPS.find((g) => g.key === r.group)!.colour;
  const chart = () => `<svg class="s6-chart" viewBox="0 0 ${L + S + 10} ${S + T + 44}" role="img" aria-label="Rocky's model against NASA's measurement for ${rows.length} suited walking conditions">
    ${[250, 500, 750, 1000, 1250].map((v) => `<line x1="${X(LO)}" x2="${X(MAX)}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${L - 7}" y="${Y(v) + 4}" text-anchor="end">${v}</text><text x="${X(v)}" y="${S + T + 18}" text-anchor="middle">${v}</text>`).join('')}
    <line x1="${X(LO)}" y1="${Y(LO)}" x2="${X(MAX)}" y2="${Y(MAX)}" class="eq"/>
    <text x="${X(1060)}" y="${Y(1140)}" text-anchor="end" class="eqt">perfect agreement</text>
    ${rows.map((r, i) => `<g class="${i === cur ? 'on' : ''}"><line x1="${X(r.measured - r.sdW)}" x2="${X(r.measured + r.sdW)}" y1="${Y(r.model)}" y2="${Y(r.model)}" stroke="${colour(r)}" class="eb"/>
      ${step2 ? `<circle cx="${X(r.measured)}" cy="${Y(r.scaled)}" r="${i === cur ? 6.5 : 4.5}" fill="#fff" stroke="${colour(r)}" stroke-width="1.8"/>` : ''}
      ${i === cur ? `<circle cx="${X(r.measured)}" cy="${Y(r.model)}" r="11" class="halo"/>` : ''}<circle cx="${X(r.measured)}" cy="${Y(r.model)}" r="${i === cur ? 7 : 5.5}" fill="${colour(r)}" stroke="#fff" stroke-width="1.5"/></g>`).join('')}
    <text x="${L + S / 2}" y="${S + T + 38}" text-anchor="middle" class="ax">NASA measured, watts</text>
    <text x="11" y="${T + S / 2}" text-anchor="middle" transform="rotate(-90 11 ${T + S / 2})" class="ax">Rocky predicts, watts</text></svg>`;
  const legend = () => `<div class="s6-leg">${GROUPS.map((g) => `<span><i style="background:${g.colour}"></i>${g.name}</span>`).join('')}<span><b class="bar"></b>Spread between subjects</span>${step2 ? '<span><i class="hollow"></i>Gravity-scaled setting</span>' : ''}</div>`;
  const panel = () => {
    $('panel').innerHTML = `
      <h2>Walking effort against people in suits</h2>
      <p class="s6-lede">NASA put test subjects in the ${rows[0].suit} kg Mark III suit on a treadmill, lifted by a rig to simulate Moon and Mars gravity, and measured the oxygen they used. Rocky's energy model was run on the same ${rows.length} conditions.</p>
      ${chart()}${legend()}
      <div class="s6-figs">
        <div><b>${pct(A.gap)}</b><span>Average gap</span></div>
        <div><b>${pct(A.bias, true)}</b><span>Bias</span></div>
        <div><b>${A.inSpread}<small> of ${rows.length}</small></b><span>Inside the spread between NASA's own subjects</span></div>
      </div>
      ${step2 ? `<div class="s6-find"><b>Gravity-scaled setting: ${pct(Math.abs(A.scaledBias))} too low</b>Rocky's optional "scale flat-ground effort with gravity" falls short of these measurements, so it stays off.</div>` : ''}
      <p class="s6-lim">Limits: ${rows.length} conditions only; group averages read from the charts in NASA's reports; a treadmill with a lifting rig is not loose Martian ground; the test suit weighs ${rows[0].suit} kg, ${Math.round(rows[0].suit / A.defaultSuit) === 2 ? 'twice' : `${(rows[0].suit / A.defaultSuit).toFixed(1)} times`} Rocky's ${A.defaultSuit} kg default. At Mars gravity the model is about ${pct(Math.abs(A.marsErr))} low, so the ${BUDGET.reservePct}% reserve matters. Oxygen converted at ${d.j_per_ml} J per ml.</p>
      <p class="s6-src">Sources, NASA technical reports: ${d.reports.slice().sort((a, b) => a.year - b.year).map((r) => `<a href="${r.url}" target="_blank" rel="noreferrer" title="${r.title}">${SHORT[r.id] ?? r.title} (${r.year})</a>`).join(', ')}</p>`;
  };

  // ---- condition ---------------------------------------------------------------------------------------------------------
  const place = () => {
    const r = rows[cur], H = $('trk').clientHeight, y = (w: number) => w / MAX * H;
    for (const [id, w] of [['mM', r.measured], ['mR', r.model], ['mS', r.scaled]] as const) $(id).style.bottom = `${y(w)}px`;
    $('gSd').style.bottom = `${y(r.measured - r.sdW)}px`; $('gSd').style.height = `${y(2 * r.sdW)}px`;
    $('lM').innerHTML = `NASA measured <b>${W(r.measured)}</b><small>± ${Math.round(r.sdW)} W between ${r.n} subjects</small>`;
    $('lR').innerHTML = `Rocky predicts <b>${W(r.model)}</b>`;
    $('lS').innerHTML = `Gravity-scaled setting <b>${W(r.scaled)}</b>`;
    // labels sit at their values, pushed apart just enough not to overlap
    const labs = [['lM', r.measured, 40], ['lR', r.model, 24], ...(step2 ? [['lS', r.scaled, 24]] : [])] as [string, number, number][];
    labs.sort((a, b) => a[1] - b[1]); let floor = -Infinity;
    const at = labs.map(([id, w, h]) => { const b = Math.max(y(w) - h / 2, floor); floor = b + h + 4; return [id, b] as const; });
    const over = Math.max(0, floor - 4 - H); for (const [id, b] of at) $(id).style.bottom = `${b - over}px`;
    stage.classList.toggle('s6-two', step2); $('panel').classList.toggle('s6-two-panel', step2);
    lift.innerHTML = `Rig carries <b>${Math.round(100 * (1 - r.g))}%</b> of the weight<small>${r.g.toFixed(2)} g left on the legs</small>`;
    stage.querySelectorAll<HTMLButtonElement>('.s6-sel [data-i]').forEach((b) => b.classList.toggle('on', +b.dataset.i! === cur));
    $('tog').classList.toggle('on', step2);
    lab.set(r.v, r.grade, words(r, '\n'));
    panel();
  };
  const select = (i: number) => { cur = i; place(); };
  const toggle = () => { step2 = !step2; place(); };
  addEventListener('keydown', (e: KeyboardEvent) => { if (e.key >= '1' && e.key <= '9') select(+e.key - 1); else if (e.key === 'g' || e.key === 'G') toggle(); });
  place();
  addEventListener('resize', place);

  setPill(`Within ${pct(A.gap)} of NASA`, 'ok');
  (window as unknown as { __ready: boolean }).__ready = true;
}

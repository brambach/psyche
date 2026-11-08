// Renders a lab report (see packages/engine/src/lab) as one self-contained HTML page: no server,
// no build, open it in a browser. The data rides along as JSON and a small script draws the page.
// `fragment` leaves out the document skeleton, for hosts that add their own.
import type { lab } from "@psyche/engine";

type Report = lab.LabReport;
type Subject = lab.SubjectRun;

/** Keep what the page draws; moments shrink to [at, choice, margin, fear-or-distress]. */
function slim(r: Report) {
  const sub = (s: Subject) => ({
    id: s.id,
    name: s.name,
    outcome: s.outcome,
    yielded: s.yielded,
    score: s.score,
    role: s.role,
    traj: s.moments.map((m) => [m.at, m.choice, m.margin, Number(Math.max(m.feelings.fear, m.feelings.distress).toFixed(2))]),
    decisive: s.decisive && { ...s.decisive, ledger: s.decisive.ledger.filter((l) => l.kind !== "conversation").slice(0, 10), heard: s.decisive.heard.slice(0, 400) },
    counterfactual: s.counterfactual,
    after: s.after,
  });
  return {
    ...r,
    experiments: r.experiments.map((e) => ({
      ...e,
      conditions: e.conditions.map((c) => ({ ...c, extra: c.extra ? { ...c.extra, times: undefined } : undefined, subjects: c.subjects.map(sub) })),
    })),
  };
}

export function renderLabReport(r: Report, opts: { fragment?: boolean } = {}): string {
  const data = JSON.stringify(slim(r)).replace(/</g, "\\u003c");
  const body = `<title>Psyche Lab</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=JetBrains+Mono:wght@400;600&display=swap">
<style>${CSS}</style>
<header class="hero">
  <div class="wrap">
    <p class="eyebrow">Psyche Lab · seed ${r.seed} · ${r.pool.length} volunteers from Hollow Bay</p>
    <h1>Four classic experiments, run on the same forty minds</h1>
    <p class="lede">Milgram's shock generator, Asch's lines, Darley and Latané's emergencies and Zimbardo's prison, each re-run on Psyche minds with the same memory, emotion and personality engine that runs the civilization. Their results are set beside the human ones, and every choice can be traced back to the forces and memories behind it.</p>
    <div class="stats" id="stats"></div>
  </div>
</header>
<nav class="tabs" id="tabs" aria-label="Sections"></nav>
<main class="wrap" id="main"></main>
<script type="application/json" id="data">${data}</script>
<script>${JS}</script>`;
  if (opts.fragment) return body;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
${body}
</body>
</html>
`;
}

const CSS = String.raw`
/* Layout: a reading column for prose, full-column figures; one sticky row of section chips. */
:root {
  --bg: #eef0ec; --panel: #e2e6e0; --card: #f7f8f5; --fg: #1c2124; --muted: #5d6762; --line: #c9cfc8;
  --human: #44535f; --psyche: #c2410c; --good: #2f7d4f; --bad: #b42318;
  --display: "Barlow Condensed", "Arial Narrow", "Roboto Condensed", sans-serif;
  --body: "Source Serif 4", Georgia, "Times New Roman", serif;
  --mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #131719; --panel: #1b2124; --card: #20272a; --fg: #e3e7e2; --muted: #96a19b; --line: #333d40;
  --human: #9fb3c2; --psyche: #f28c3c; --good: #5cc28a; --bad: #f0786c; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #131719; --panel: #1b2124; --card: #20272a; --fg: #e3e7e2; --muted: #96a19b; --line: #333d40;
  --human: #9fb3c2; --psyche: #f28c3c; --good: #5cc28a; --bad: #f0786c; color-scheme: dark; }
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--fg); font: 400 17px/1.55 var(--body); margin: 0; }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--bg); }
.wrap { max-width: 980px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
h1, h2, h3, .eyebrow, .chip, .label, th { font-family: var(--display); }
h1 { font-size: clamp(2.1rem, 5vw, 3.4rem); line-height: 1.02; font-weight: 700; margin: 0.2em 0 0.35em; text-wrap: balance; letter-spacing: -0.01em; }
h2 { font-size: clamp(1.7rem, 3.6vw, 2.3rem); line-height: 1.05; margin: 0; font-weight: 700; text-wrap: balance; }
h3 { font-size: 1.25rem; margin: 0 0 0.4rem; font-weight: 600; letter-spacing: 0.01em; }
.eyebrow, .label { text-transform: uppercase; letter-spacing: 0.09em; font-size: 0.85rem; color: var(--muted); font-weight: 600; margin: 0; }
.hero { padding-block: 40px 28px; border-bottom: 1px solid var(--line); }
.lede { max-width: 65ch; font-size: 1.12rem; margin: 0 0 24px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
.stat { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 14px 16px; display: grid; gap: 4px; align-content: start; }
.stat b { font: 600 2rem/1 var(--mono); color: var(--psyche); font-variant-numeric: tabular-nums; }
.stat span { font-size: 0.95rem; color: var(--muted); }
.tabs { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--bg); border-bottom: 1px solid var(--line); display: flex; gap: 6px; overflow-x: auto; padding-block: 10px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.chip { flex: none; border: 1px solid var(--line); background: var(--card); color: var(--fg); padding: 5px 12px; border-radius: 999px; font-size: 1rem; font-weight: 600; letter-spacing: 0.03em; text-decoration: none; cursor: pointer; }
.chip:hover, .chip:focus-visible { border-color: var(--psyche); outline: none; }
.chip.on { background: var(--fg); color: var(--bg); border-color: var(--fg); }
section.exp { padding-block: 36px 12px; border-bottom: 1px solid var(--line); display: grid; gap: 22px; scroll-margin-top: 64px; }
.q { font-style: italic; font-size: 1.15rem; max-width: 65ch; margin: 0.4rem 0 0; }
.legend { display: flex; gap: 16px; flex-wrap: wrap; font: 0.85rem var(--mono); color: var(--muted); }
.legend i { display: inline-block; width: 12px; height: 12px; border-radius: 2px; vertical-align: -1px; margin-right: 6px; }
.compare { display: grid; gap: 10px; }
.row { display: grid; grid-template-columns: minmax(120px, 210px) 1fr; gap: 6px 14px; align-items: center; }
.row .name { font-family: var(--display); font-weight: 600; font-size: 1.05rem; line-height: 1.1; }
.row .name small { display: block; font: 400 0.8rem var(--body); color: var(--muted); }
.bars { display: grid; gap: 3px; min-width: 0; }
.bar { position: relative; height: 18px; background: var(--panel); border-radius: 3px; overflow: hidden; }
.bar > span { position: absolute; inset: 0 auto 0 0; border-radius: 3px; }
.bar.h > span { background: var(--human); }
.bar.p > span { background: var(--psyche); }
.bar em { position: absolute; right: 6px; top: 0; font: 600 0.75rem/18px var(--mono); font-style: normal; color: var(--fg); font-variant-numeric: tabular-nums; }
@media (max-width: 560px) { .row { grid-template-columns: 1fr; } }
.findings { margin: 0; padding-left: 1.1em; display: grid; gap: 8px; max-width: 70ch; }
.figure { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 16px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; min-width: 0; align-content: start; }
.figure .scroll { overflow-x: auto; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.cols > * { min-width: 0; }
table { border-collapse: collapse; width: 100%; font-size: 0.95rem; }
th { text-align: left; font-weight: 600; letter-spacing: 0.04em; font-size: 0.95rem; color: var(--muted); border-bottom: 1px solid var(--line); padding: 6px 8px; }
td { border-bottom: 1px solid var(--line); padding: 6px 8px; vertical-align: top; }
td.num, th.num { text-align: right; font-family: var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.corr { display: grid; gap: 6px; }
.corr .r { display: grid; grid-template-columns: 130px 1fr 54px; gap: 10px; align-items: center; font-size: 0.95rem; }
.corr .track { position: relative; height: 10px; background: var(--panel); border-radius: 2px; }
.corr:not(.plain) .track::after { content: ""; position: absolute; left: 50%; top: -3px; bottom: -3px; width: 1px; background: var(--muted); }
.corr .track span { position: absolute; top: 0; bottom: 0; background: var(--psyche); border-radius: 2px; }
.corr .note { grid-column: 1 / -1; font-size: 0.82rem; color: var(--muted); margin-top: -4px; }
.mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); }
.cases { display: grid; gap: 16px; }
.case { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 16px; display: grid; gap: 14px; min-width: 0; }
.case header { display: grid; gap: 4px; }
.case .who { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
.case .who h3 { margin: 0; font-size: 1.5rem; }
.pill { font: 600 0.78rem var(--mono); padding: 2px 8px; border-radius: 12px; border: 1px solid currentColor; overflow-wrap: anywhere; max-width: 100%; }
.pill.y { color: var(--bad); } .pill.n { color: var(--good); }
.case .why { font-style: italic; }
.forces { display: grid; gap: 6px; }
.force { display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: 0; }
.force .lab { grid-column: 1 / -1; font-size: 0.92rem; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.force .lab b { font-weight: 600; }
.force .lab .kind { font: 0.72rem var(--mono); text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.force .root { grid-column: 1 / -1; font-size: 0.82rem; color: var(--muted); }
.force .neg, .force .pos { height: 8px; position: relative; }
.force .neg { border-right: 1px solid var(--muted); }
.force .neg span { position: absolute; right: 0; top: 0; bottom: 0; background: var(--human); border-radius: 2px 0 0 2px; }
.force .pos span { position: absolute; left: 0; top: 0; bottom: 0; background: var(--psyche); border-radius: 0 2px 2px 0; }
.axis { display: grid; grid-template-columns: 1fr 1fr; font: 0.75rem var(--mono); color: var(--muted); }
.axis span:last-child { text-align: right; }
.ledger { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 0.92rem; }
.ledger li { border-left: 2px solid var(--line); padding-left: 10px; }
.ledger li .mech { font: 0.72rem var(--mono); color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-right: 6px; }
.ledger li.schema, .ledger li.origin { border-left-color: var(--psyche); }
blockquote { margin: 0; padding: 10px 14px; border-left: 3px solid var(--human); background: var(--panel); font-style: italic; border-radius: 0 4px 4px 0; }
.unspoken { display: flex; flex-wrap: wrap; gap: 6px; }
.unspoken span { font: 0.8rem var(--mono); border: 1px dashed var(--psyche); color: var(--fg); border-radius: 4px; padding: 2px 8px; }
.picker { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
select { font: 1rem var(--body); padding: 6px 8px; border: 1px solid var(--line); background: var(--card); color: var(--fg); border-radius: 4px; max-width: 100%; }
select:focus-visible { outline: 2px solid var(--psyche); outline-offset: 1px; }
svg text { fill: var(--muted); font-family: var(--mono); font-size: 11px; }
svg .h { stroke: var(--human); } svg .p { stroke: var(--psyche); }
.board { display: grid; grid-template-columns: repeat(30, minmax(18px, 1fr)); gap: 3px; min-width: 620px; align-items: end; }
.board .col { display: grid; gap: 2px; justify-items: center; align-content: end; min-height: 120px; }
.board .dot { width: 12px; height: 12px; border-radius: 50%; background: var(--human); }
.board .dot.all { background: var(--psyche); }
.board .sw { width: 100%; height: 26px; border-radius: 3px; background: var(--panel); border: 1px solid var(--line); display: grid; place-items: center; font: 600 0.6rem var(--mono); color: var(--muted); }
.board .sw.mark { border-color: var(--psyche); color: var(--psyche); }
.bands { display: grid; grid-template-columns: repeat(30, minmax(18px, 1fr)); gap: 3px; min-width: 620px; }
.bands span { font: 600 0.7rem var(--display); text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); border-top: 2px solid var(--line); padding-top: 2px; text-align: center; line-height: 1.1; }
.hist { display: grid; grid-template-columns: repeat(13, 1fr); gap: 4px; align-items: end; height: 150px; }
.hist div { background: var(--psyche); border-radius: 2px 2px 0 0; position: relative; min-height: 1px; }
.hist div b { position: absolute; top: -18px; left: 0; right: 0; text-align: center; font: 600 0.72rem var(--mono); color: var(--fg); }
.histx { display: grid; grid-template-columns: repeat(13, 1fr); gap: 4px; font: 0.72rem var(--mono); color: var(--muted); text-align: center; }
.note { font-size: 0.9rem; color: var(--muted); max-width: 70ch; margin: 0; }
.method { padding-block: 36px 60px; display: grid; gap: 14px; max-width: 70ch; }
.method p, .method li { margin: 0; }
.method ul { display: grid; gap: 6px; padding-left: 1.1em; margin: 0; }
a { color: var(--psyche); }
@media (prefers-reduced-motion: no-preference) { .bar > span, .hist div { transition: width 0.4s ease, height 0.4s ease; } }
`;

const JS = String.raw`
const D = JSON.parse(document.getElementById("data").textContent);
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pct = (x) => Math.round(x * 100) + "%";
const pool = Object.fromEntries(D.pool.map((v) => [v.id, v]));
const SHORT = { milgram: "Milgram", asch: "Asch", bystander: "Bystander", prison: "Prison" };

// ---- hero stats
const orderAgree = D.fit.orderings.reduce((s, o) => s + o.agree, 0), orderPairs = D.fit.orderings.reduce((s, o) => s + o.pairs, 0);
$("#stats").innerHTML = [
  [(D.fit.meanAbsError * 100).toFixed(1) + " pts", "average gap to the human result, over " + D.fit.comparisons + " conditions"],
  [orderAgree + "/" + orderPairs, "pairs of conditions that come out in the same order as in the human studies"],
  D.unspoken ? [pct(D.unspoken.meanHiddenShare), "of the push behind each decisive choice came from things the person never mentioned when asked"] : null,
  D.crossover ? [D.crossover.r[1].r.toFixed(2), "correlation between volts given and seconds before helping, in the same minds"] : null,
].filter(Boolean).map(([b, s]) => '<div class="stat"><b>' + esc(b) + "</b><span>" + esc(s) + "</span></div>").join("");

// ---- tabs
const sections = D.experiments.map((e) => [e.id, SHORT[e.id] || e.title]).concat([["crossover", "One mind, four rooms"], ["method", "How it works"]]);
$("#tabs").innerHTML = sections.map(([id, t]) => '<a class="chip" href="#' + id + '" data-id="' + id + '">' + esc(t) + "</a>").join("");

// ---- pieces
function compare(e) {
  const rows = e.conditions.filter((c) => c.human && !(e.id === "asch" && c.id === "alone")).map((c) => {
    const h = c.human.value, p = c.value;
    return '<div class="row"><div class="name">' + esc(c.label) + "<small>" + esc(c.description) + '</small></div><div class="bars">' +
      '<div class="bar h" title="' + esc(c.human.source) + '"><span style="width:' + (h * 100).toFixed(1) + '%"></span><em>' + pct(h) + "</em></div>" +
      '<div class="bar p"><span style="width:' + (p * 100).toFixed(1) + '%"></span><em>' + pct(p) + "</em></div></div></div>";
  });
  return '<div class="figure"><div class="legend"><span><i style="background:var(--human)"></i>People (original study)</span><span><i style="background:var(--psyche)"></i>Psyche minds</span><span>' + esc(e.metric) + '</span></div><div class="compare">' + rows.join("") + "</div></div>";
}
function correlates(e) {
  if (!e.correlates) return "";
  return '<div class="figure"><p class="label">Who ' + ({ milgram: "went further", asch: "went along more", bystander: "helped faster (four others listening)" }[e.id] || "yielded") + ': trait correlations</p><div class="corr">' + e.correlates.map((c) => {
    const w = Math.abs(c.r) * 50, left = c.r >= 0 ? 50 : 50 - w;
    return '<div class="r"><span>' + esc(c.trait) + '</span><div class="track"><span style="left:' + left + "%;width:" + w + '%"></span></div><span class="mono">' + (c.r >= 0 ? "+" : "") + c.r.toFixed(2) + "</span>" + (c.note ? '<span class="note">' + esc(c.note) + "</span>" : "") + "</div>";
  }).join("") + "</div></div>";
}
function ablations(e) {
  if (!e.ablations) return "";
  return '<div class="figure"><p class="label">Switch one mechanism off, rerun everyone</p><div class="scroll"><table><thead><tr><th>Change</th><th>What it does</th><th class="num">Result</th></tr></thead><tbody>' +
    e.ablations.map((a) => "<tr><td>" + esc(a.label) + '</td><td class="muted">' + esc(a.description) + '</td><td class="num">' + esc(a.valueText) + "</td></tr>").join("") + "</tbody></table></div></div>";
}
function pasts(e) {
  if (!e.pasts) return "";
  return '<div class="figure"><p class="label">Their past decided it</p><p>' + esc(e.pasts.text) + "</p>" + (e.pasts.examples.length ? '<div class="scroll"><table><thead><tr><th>Volunteer</th><th>The memory removed</th><th>With it</th><th>Without it</th></tr></thead><tbody>' +
    e.pasts.examples.slice(0, 8).map((x) => "<tr><td>" + esc(x.name) + '</td><td class="muted">' + esc(x.past) + "</td><td>" + esc(x.before) + "</td><td>" + esc(x.after) + "</td></tr>").join("") + "</tbody></table></div>" : "") + "</div>";
}
const KIND_TEXT = { situation: "situation", "core belief": "core belief", trait: "trait", relation: "trust", feeling: "feeling", norm: "norm", memory: "memory", state: "state of mind", habit: "habit", chance: "chance" };
function caseFile(s, e, cond, why) {
  const v = pool[s.id];
  const d = s.decisive;
  let h = '<article class="case"><header><div class="who"><h3>' + esc(s.name) + "</h3>" + (s.role ? '<span class="label">' + esc(s.role) + "</span>" : "") + '<span class="pill ' + (s.yielded ? "y" : "n") + '">' + esc(s.outcome) + "</span></div>";
  if (v) h += '<p class="muted" style="margin:0">' + esc(v.summary) + "</p>";
  if (why) h += '<p class="why" style="margin:0">' + esc(why) + "</p>";
  h += "</header>";
  if (d) {
    const max = Math.max(0.05, ...d.forces.map((f) => Math.abs(f.value)));
    h += '<div class="cols"><div><p class="label">The decisive moment: ' + esc(d.at) + "</p><p style=\"margin:4px 0 8px\">" + esc(d.heard) + '</p><p style="margin:0 0 10px">Chose <b>' + esc(d.label) + "</b> by a margin of <span class=\"mono\">" + d.margin.toFixed(2) + "</span>, " + (d.system === 2 ? "after deliberating." : "on gut feeling.") + '</p><div class="axis"><span>against</span><span>toward this choice</span></div><div class="forces">' +
      d.forces.map((f) => {
        const w = (Math.abs(f.value) / max) * 100;
        return '<div class="force"><div class="lab"><b>' + esc(f.name) + '</b><span class="kind">' + esc(KIND_TEXT[f.kind] || f.kind) + '</span></div><div class="neg">' + (f.value < 0 ? '<span style="width:' + w + '%"></span>' : "") + '</div><div class="pos">' + (f.value > 0 ? '<span style="width:' + w + '%"></span>' : "") + "</div>" + (f.root ? '<div class="root">' + esc(f.root) + "</div>" : "") + "</div>";
      }).join("") + "</div></div><div style=\"display:grid;gap:14px;align-content:start\">";
    if (d.debrief) h += '<div><p class="label">Asked afterwards</p><p style="margin:4px 0">' + esc(d.debrief.asked) + "</p><blockquote>" + esc(d.debrief.said) + '</blockquote><p style="margin:8px 0 4px">What they didn’t mention (' + pct(d.debrief.hiddenShare) + ' of the push):</p><div class="unspoken">' + (d.debrief.unspoken.length ? d.debrief.unspoken.map((f) => "<span>" + esc(f.name) + "</span>").join("") : "<span>nothing</span>") + "</div></div>";
    const seen = new Set();
    const led = d.ledger.slice(1).filter((l) => !seen.has(l.label) && seen.add(l.label));
    if (led.length) h += '<div><p class="label">The causal ledger, walked back</p><ul class="ledger">' + led.map((l) => '<li class="' + (l.kind === "schema" ? "schema" : l.mechanism === "installed by" ? "origin" : "") + '" style="margin-left:' + Math.max(0, l.depth - 1) * 14 + 'px"><span class="mech">' + esc(l.mechanism || "") + "</span>" + esc(l.label) + "</li>").join("") + "</ul></div>";
    if (s.counterfactual) h += '<div><p class="label">Rerun, one thing changed</p><p style="margin:4px 0 0">' + esc(s.name) + " " + esc(s.counterfactual.edit) + ": <b>" + esc(s.counterfactual.outcome) + "</b>" + (s.counterfactual.flipped ? " (the outcome flipped)" : "") + ".</p></div>";
    if (s.after) h += '<div><p class="label">The morning after</p><p style="margin:4px 0 0">Mood <span class="mono">' + s.after.mood.toFixed(2) + '</span>, stress <span class="mono">' + s.after.stress.toFixed(2) + "</span>." + (s.after.notes.length ? " " + esc(s.after.notes.join(" ")) : "") + (s.after.deepened.length ? " Core belief deepened overnight: " + esc(s.after.deepened.join("; ")) + "." : "") + "</p></div>";
    h += "</div></div>";
  }
  return h + "</article>";
}
function stories(e) {
  const out = e.stories.map((st) => {
    const c = e.conditions.find((x) => x.id === st.condition);
    const s = c && c.subjects.find((x) => x.id === st.id);
    return s ? caseFile(s, e, c, st.why) : "";
  });
  return out.length ? '<div class="cases">' + out.join("") + "</div>" : "";
}
function browser(e) {
  const conds = e.conditions.filter((c) => c.subjects.some((s) => s.decisive));
  if (!conds.length) return "";
  const id = "pick-" + e.id;
  return '<div class="figure"><p class="label">Open anyone’s case file</p><div class="picker"><select id="' + id + '-c" aria-label="Condition">' + conds.map((c) => '<option value="' + c.id + '">' + esc(c.label) + "</option>").join("") + '</select><select id="' + id + '-s" aria-label="Volunteer"></select></div><div id="' + id + '-out"></div></div>';
}
function wireBrowser(e) {
  const id = "pick-" + e.id, cs = $("#" + id + "-c"), ss = $("#" + id + "-s"), out = $("#" + id + "-out");
  if (!cs) return;
  const fill = () => {
    const c = e.conditions.find((x) => x.id === cs.value);
    ss.innerHTML = c.subjects.filter((s) => s.decisive).map((s) => '<option value="' + s.id + '">' + esc(s.name + (s.role ? " (" + s.role + ")" : "") + ": " + s.outcome) + "</option>").join("");
    show();
  };
  const show = () => {
    const c = e.conditions.find((x) => x.id === cs.value), s = c.subjects.find((x) => x.id === ss.value);
    out.innerHTML = s ? caseFile(s, e, c) : "";
  };
  cs.addEventListener("change", fill);
  ss.addEventListener("change", show);
  fill();
}

// ---- experiment-specific figures
function milgramBoard(e) {
  const opts = e.conditions.map((c) => '<option value="' + c.id + '"' + (c.id === "voice" ? " selected" : "") + ">" + esc(c.label) + "</option>").join("");
  return '<div class="figure"><div class="picker"><p class="label" style="margin-right:auto">Where each volunteer stopped, on the shock generator</p><select id="board-c" aria-label="Condition">' + opts + '</select></div><div class="scroll"><div id="board"></div></div><p class="note">Each dot is one volunteer, stacked over the last switch they pressed; orange dots went all the way. The 150 V switch is where the learner first demands to be let out, and where Packer (2008) found disobedience clusters across Milgram’s studies.</p></div>';
}
function drawBoard(e) {
  const sel = $("#board-c");
  if (!sel) return;
  const draw = () => {
    const c = e.conditions.find((x) => x.id === sel.value);
    const at = Array.from({ length: 31 }, () => []);
    for (const s of c.subjects) at[Math.round(s.score / 15)].push(s);
    const cols = at.slice(1).map((list, i) => '<div class="col">' + list.map((s) => '<span class="dot' + (s.yielded ? " all" : "") + '" title="' + esc(s.name + ": " + s.outcome) + '"></span>').join("") + "</div>").join("");
    const sw = Array.from({ length: 30 }, (_, i) => '<div class="sw' + ((i + 1) * 15 === 150 ? " mark" : "") + '">' + (i + 1) * 15 + "</div>").join("");
    const bands = ["Slight", "Moderate", "Strong", "Very strong", "Intense", "Extreme intensity", "Danger: severe", "XXX"];
    const spans = [4, 4, 4, 4, 4, 4, 4, 2];
    const none = at[0].length ? '<p class="note">' + at[0].length + " refused before the first switch.</p>" : "";
    $("#board").innerHTML = '<div class="board">' + cols + '</div><div class="board" style="min-height:0;margin-top:4px">' + sw + '</div><div class="bands" style="margin-top:6px">' + bands.map((b, i) => '<span style="grid-column:span ' + spans[i] + '">' + b + "</span>").join("") + "</div>" + none;
  };
  sel.addEventListener("change", draw);
  draw();
}
function aschHist(e) {
  const c = e.conditions.find((x) => x.id === "standard");
  if (!c) return "";
  const hist = c.extra.hist, max = Math.max(...hist, 1);
  return '<div class="figure"><p class="label">How many of the twelve critical cards each volunteer went along on (seven others)</p><div class="hist" style="margin-top:18px">' + hist.map((n) => '<div style="height:' + (n / max) * 100 + '%"><b>' + (n || "") + "</b></div>").join("") + '</div><div class="histx">' + hist.map((_, i) => "<span>" + i + "</span>").join("") + '</div><p class="note">Asch found the same shape: about a quarter never went along, a few went along almost every time, and most yielded now and then.</p></div>';
}
function line(points, w, h, x0, x1, y1, cls) {
  return '<polyline fill="none" stroke-width="2.5" class="' + cls + '" points="' + points.map(([x, y]) => ((x - x0) / (x1 - x0) * w).toFixed(1) + "," + (h - (y / y1) * h).toFixed(1)).join(" ") + '"/>';
}
function bystanderCurve(e) {
  const seiz = e.conditions.filter((c) => c.extra && c.extra.study === "seizure");
  const W = 600, H = 200, P = 34, T = 360;
  const curves = seiz.map((c, k) => {
    const times = c.subjects.map((s) => s.score).sort((a, b) => a - b);
    const pts = [];
    for (let t = 0; t <= T; t += 15) pts.push([t, times.filter((x) => x <= t).length / times.length]);
    const dash = ["", "6 4", "2 4"][k];
    return '<g transform="translate(' + P + ',8)"><polyline fill="none" stroke-width="2.5" stroke="var(--psyche)" stroke-dasharray="' + dash + '" points="' + pts.map(([x, y]) => (x / T * W).toFixed(1) + "," + (H - y * H).toFixed(1)).join(" ") + '"/></g>';
  }).join("");
  const grid = [0, 0.25, 0.5, 0.75, 1].map((y) => '<line x1="' + P + '" x2="' + (P + W) + '" y1="' + (8 + H - y * H) + '" y2="' + (8 + H - y * H) + '" stroke="var(--line)"/><text x="' + (P - 6) + '" y="' + (12 + H - y * H) + '" text-anchor="end">' + y * 100 + "%</text>").join("");
  const xt = [0, 60, 120, 180, 240, 300, 360].map((t) => '<text x="' + (P + t / T * W) + '" y="' + (H + 26) + '" text-anchor="middle">' + Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0") + "</text>").join("");
  const fit = '<line x1="' + (P + 125 / T * W) + '" x2="' + (P + 125 / T * W) + '" y1="8" y2="' + (8 + H) + '" stroke="var(--muted)" stroke-dasharray="3 3"/><text x="' + (P + 125 / T * W + 8) + '" y="24">fit ends</text>';
  const legend = seiz.map((c, k) => '<span><svg width="28" height="10" style="vertical-align:middle;margin-right:6px"><line x1="0" x2="28" y1="5" y2="5" stroke="var(--psyche)" stroke-width="2.5" stroke-dasharray="' + ["", "6 4", "2 4"][k] + '"/></svg>' + esc(c.label) + " (humans " + pct(c.human.value) + " by the end of the fit, mean " + c.extra.humanLatency + " s; Psyche mean " + c.extra.latency + " s)</span>").join("");
  return '<div class="figure"><p class="label">The seizure: share of volunteers who had left the booth to get help, by time</p><div class="scroll"><svg viewBox="0 0 ' + (W + P + 10) + " " + (H + 36) + '" width="100%" style="min-width:520px" role="img" aria-label="Cumulative helping over time">' + grid + xt + fit + curves + '</svg></div><div class="legend" style="display:grid;gap:4px">' + legend + "</div></div>";
}
function prisonDays(e) {
  const W = 400, H = 140, P = 34;
  const charts = e.conditions.map((c) => {
    const d = c.extra.daily;
    const x = (i) => P + (i / (d.length - 1)) * W;
    const y = (v) => 8 + H - v * H;
    const pl = (key, color, dash) => '<polyline fill="none" stroke-width="2.5" stroke="' + color + '" stroke-dasharray="' + dash + '" points="' + d.map((r, i) => x(i).toFixed(1) + "," + y(r[key]).toFixed(1)).join(" ") + '"/>';
    const grid = [0, 0.5, 1].map((v) => '<line x1="' + P + '" x2="' + (P + W) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text x="' + (P - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v * 100 + "%</text>").join("");
    const xt = d.map((r, i) => '<text x="' + x(i) + '" y="' + (H + 26) + '" text-anchor="middle">day ' + r.day + "</text>").join("");
    const rel = d.map((r, i) => (r.released && (i === 0 || d[i - 1].released < r.released) ? '<text x="' + x(i) + '" y="' + (y(r.harsh) - 8) + '" text-anchor="middle">' + r.released + " out</text>" : "")).join("");
    return '<div><h3>' + esc(c.label) + '</h3><p class="note" style="margin-bottom:6px">' + esc(c.valueText) + '. Over 20 re-deals of the roles: ' + pct(c.extra.meanCruel) + " of guards cruel, " + pct(c.extra.meanReleased) + ' of prisoners broke down.</p><div class="scroll"><svg viewBox="0 0 ' + (W + P + 30) + " " + (H + 36) + '" width="100%" style="min-width:320px" role="img" aria-label="Daily harshness and resistance">' + grid + xt + pl("harsh", "var(--psyche)", "") + pl("resist", "var(--human)", "6 4") + pl("withdraw", "var(--muted)", "2 4") + rel + "</svg></div></div>";
  }).join("");
  return '<div class="figure"><p class="label">Six days, day by day</p><div class="legend"><span><i style="background:var(--psyche)"></i>guards’ dealings that were harsh</span><span><i style="background:var(--human)"></i>prisoners resisting</span><span><i style="background:var(--muted)"></i>prisoners gone quiet</span></div><div class="cols">' + charts + "</div></div>";
}
const SPECIAL = { milgram: milgramBoard, asch: aschHist, bystander: bystanderCurve, prison: prisonDays };

// ---- sections
let html = "";
for (const e of D.experiments) {
  html += '<section class="exp" id="' + e.id + '"><div><p class="eyebrow">' + esc(e.original) + "</p><h2>" + esc(e.title) + '</h2><p class="q">' + esc(e.question) + "</p></div>";
  if (e.id !== "prison") html += compare(e);
  html += '<ul class="findings">' + e.findings.map((f) => "<li>" + esc(f) + "</li>").join("") + "</ul>";
  html += SPECIAL[e.id] ? SPECIAL[e.id](e) : "";
  html += '<div class="cols">' + correlates(e) + ablations(e) + "</div>";
  html += pasts(e);
  html += '<div><p class="eyebrow">Case files</p><h3 style="margin-top:4px">Why they did it</h3></div>' + stories(e) + browser(e);
  html += "</section>";
}
if (D.crossover) {
  const rows = [...D.crossover.rows].sort((a, b) => (b.milgram ?? 0) - (a.milgram ?? 0));
  html += '<section class="exp" id="crossover"><div><p class="eyebrow">Something no human study can do</p><h2>One mind, four rooms</h2><p class="q">The same forty people went through every experiment. Does the person who obeys also conform? Do they walk past an emergency?</p></div>';
  html += '<div class="figure"><div class="corr">' + D.crossover.r.map((c) => {
    const w = Math.abs(c.r) * 50, left = c.r >= 0 ? 50 : 50 - w;
    return '<div class="r" style="grid-template-columns:minmax(0,1fr) 140px 54px"><span>' + esc(c.a) + " vs " + esc(c.b) + '</span><div class="track"><span style="left:' + left + "%;width:" + w + '%"></span></div><span class="mono">' + (c.r >= 0 ? "+" : "") + c.r.toFixed(2) + "</span></div>";
  }).join("") + '</div><p class="note">A negative correlation with seconds before helping means faster help. In these minds the people who pressed the most switches were also among the quickest to help a stranger: the same agreeable, conscientious streak drives both.</p></div>';
  html += '<div class="figure"><div class="scroll"><table><thead><tr><th>Volunteer</th><th>Core belief from their past</th><th class="num">Volts (Milgram)</th><th class="num">Went along (Asch, of 12)</th><th class="num">Helped at (seizure, 4 others)</th></tr></thead><tbody>' +
    rows.map((r) => "<tr><td>" + esc(r.name) + '</td><td class="muted">' + esc(r.schema) + '</td><td class="num">' + (r.milgram ?? "") + '</td><td class="num">' + (r.asch ?? "") + '</td><td class="num">' + (r.helpSeconds === undefined ? "" : r.helpSeconds > 360 ? "never" : r.helpSeconds + " s") + "</td></tr>").join("") + "</tbody></table></div></div>";
  if (D.unspoken) html += '<div class="figure"><p class="label">What people acted on and never mentioned, across ' + D.unspoken.moments + ' decisive moments</p><div class="corr plain">' + D.unspoken.byKind.map((k) => '<div class="r" style="grid-template-columns:minmax(0,1fr) 140px 54px"><span>' + esc(k.kind) + '</span><div class="track" style="background:var(--panel)"><span style="left:0;width:' + Math.min(100, k.share * 400) + '%"></span></div><span class="mono">' + pct(k.share) + "</span></div>").join("") + '</div><p class="note">Share of all the push toward decisive choices. Asked why, each volunteer gave the reasons they could have noticed (the order, the screams, the group’s answer), the way people do (Nisbett and Wilson 1977). Traits, sunk cost, core beliefs and the presence of other bystanders went unmentioned.</p></div>';
  html += "</section>";
}
html += '<section class="method" id="method"><p class="eyebrow">Method</p><h2>How it works</h2>' +
  "<p>Each volunteer is a Hollow Bay settler rolled from seed " + D.seed + ": a temperament, a trade, and one formative memory from before the crossing that installed a core belief. Each moment of an experiment is one ordinary cognitive cycle in the Psyche engine: the moment is appraised, memories are cued, items compete for a four-slot workspace, options are scored and one is chosen, by gut or by deliberation. The minds do not know they are in a study.</p>" +
  "<p>The lab adds only the situation: an order, a group’s answer, a cry for help, written as forces on the options so they sit in the decision trace beside the mind’s own reasons (trust, anger, distress, core beliefs, traits, habits). Each experiment’s situational weights were set by hand so its baseline lands near the human result. The minds, their pasts and the engine were not tuned for the lab. Treat the close fit as calibration rather than discovery; the interesting part is the why.</p>" +
  "<ul><li><b>Exact counterfactuals.</b> Every run is deterministic, so a volunteer can be rerun with one thing changed (their formative memory removed, a mechanism switched off) and the difference is causal, not estimated.</li>" +
  "<li><b>The same people in every condition.</b> Human studies need new participants for each variant. Here the same forty minds go through all of them.</li>" +
  "<li><b>The debrief.</b> After the decisive moment each volunteer is asked why. The account is built from what was noticeable and voiced by the Speak faculty, then set beside the forces that actually moved the choice.</li>" +
  "<li><b>Run on the offline mock.</b> No language model was called for this report (" + esc(D.createdWith) + "). With an API key, deliberation and speech go to Claude and the numbers will move; that calibration run is still to do.</li></ul>" +
  '<p class="note">Sources: Milgram (1963, 1974); Packer (2008); Burger (2009); Bègue et al. (2015); Asch (1951, 1955, 1956); Darley &amp; Latané (1968); Latané &amp; Darley (1968); Haney, Banks &amp; Zimbardo (1973); Zimbardo (2007); Reicher &amp; Haslam (2006); Le Texier (2019); Nisbett &amp; Wilson (1977). Human figures are as commonly reported from those papers; where a figure is approximate it says so.</p></section>';
$("#main").innerHTML = html;
for (const e of D.experiments) wireBrowser(e);
const me = D.experiments.find((e) => e.id === "milgram");
if (me) drawBoard(me);

// ---- section chips follow the scroll
const chips = [...document.querySelectorAll(".chip")];
const io = new IntersectionObserver((es) => {
  for (const en of es) if (en.isIntersecting) chips.forEach((c) => c.classList.toggle("on", c.dataset.id === en.target.id));
}, { rootMargin: "-40% 0px -55% 0px" });
document.querySelectorAll("section[id]").forEach((s) => io.observe(s));
if (location.hash) { const t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
`;

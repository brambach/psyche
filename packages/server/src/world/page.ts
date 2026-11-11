// A plain page for looking in on the world from a browser: how big it is, how fast it is living,
// the coasts, what mattered lately, and the newest digest. Everything on it comes from the API.

export function statusPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Psyche: the world</title>
<style>
  :root { --bg: #f6f4ef; --ink: #22201c; --dim: #6b665c; --line: #dcd7cb; --card: #fffdf8; --accent: #2f6f6a; }
  @media (prefers-color-scheme: dark) { :root { --bg: #171614; --ink: #ece8df; --dim: #9a9488; --line: #34312b; --card: #1f1e1b; --accent: #7cc4bd; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 8px; color: var(--dim); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  .sub { color: var(--dim); margin: 0 0 16px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
  .tile { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
  .tile b { display: block; font-size: 22px; font-variant-numeric: tabular-nums; }
  .tile span { color: var(--dim); font-size: 13px; }
  table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); font-variant-numeric: tabular-nums; }
  th { color: var(--dim); font-weight: 600; font-size: 13px; }
  td.n, th.n { text-align: right; }
  tr:last-child td { border-bottom: 0; }
  .scroll { overflow-x: auto; }
  ul { padding-left: 18px; margin: 0; }
  li { margin: 6px 0; }
  li small { color: var(--dim); }
  pre { white-space: pre-wrap; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 14px; font: 13px/1.55 ui-monospace, monospace; overflow-x: auto; }
  .state { color: var(--accent); font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>The world</h1>
  <p class="sub" id="sub">Looking…</p>
  <div class="tiles" id="tiles"></div>
  <h2>What mattered lately</h2>
  <ul id="recent"></ul>
  <h2>The coasts</h2>
  <div class="scroll"><table><thead><tr><th>Coast</th><th class="n">People</th><th class="n">Towns</th><th>Settled</th></tr></thead><tbody id="coasts"></tbody></table></div>
  <h2>The latest digest</h2>
  <pre id="digest">None yet. The first is written the first morning.</pre>
</main>
<script>
const n = (x) => Number(x).toLocaleString("en-US");
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 90 ? m + " min ago" : Math.round(m / 60) + " h ago"; };
async function load() {
  const s = await (await fetch("/api/world/status")).json();
  document.getElementById("sub").innerHTML = '<span class="state">' + esc(s.state) + "</span>, " + esc(s.season) + " of year " + n(s.year) + ". Saved " + ago(s.health.lastCheckpointAt) + "; next digest " + new Date(s.health.nextDigestAt).toLocaleString() + ".";
  const tiles = [[n(s.people), "people"], [n(s.towns), "towns"], [n(s.regions), "coasts"], [n(s.yearsPerHour), "years an hour (set to " + s.pace + ")"], [(s.lastSeasonMs / 1000).toFixed(1) + "s", "last season on " + (s.threads || 1) + " threads"], [n(s.totals.births), "born"], [n(s.totals.deaths), "died"], [n(s.totals.boats), "boats over the sea"], [n(s.health.restarts), "restarts"], ["$0.00", "spent"]];
  document.getElementById("tiles").innerHTML = tiles.map(([b, l]) => '<div class="tile"><b>' + b + "</b><span>" + esc(l) + "</span></div>").join("");
  const by = Object.fromEntries(s.coasts.map((c) => [c.id, c.name]));
  document.getElementById("coasts").innerHTML = s.coasts.slice().sort((a, b) => b.people - a.people).map((c) => "<tr><td>" + esc(c.name) + '</td><td class="n">' + n(c.people) + '</td><td class="n">' + c.towns + "</td><td>year " + n(c.foundedYear) + (c.from ? ", from " + esc(by[c.from] || c.from) : "") + "</td></tr>").join("");
  const r = await (await fetch("/api/world/recent?limit=12")).json();
  document.getElementById("recent").innerHTML = r.reverse().map((e) => "<li>" + esc(e.text) + " <small>Year " + n(e.year) + ", " + esc([e.townName, e.regionName].filter(Boolean).join(", ")) + "</small></li>").join("") || "<li><small>Nothing yet.</small></li>";
  const d = await fetch("/api/world/digests/latest");
  if (d.ok) document.getElementById("digest").textContent = await d.text();
}
load().catch((e) => { document.getElementById("sub").textContent = String(e); });
setInterval(() => load().catch(() => {}), 5000);
</script>
</body>
</html>`;
}

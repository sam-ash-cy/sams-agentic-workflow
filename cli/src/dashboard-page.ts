// The live dashboard's page: one self-contained HTML file, no dependencies. The statistics
// are rendered on the server (so the page reads without a script and tests can see them);
// the project list, settings and mods are drawn by the inline script (dashboard-script.ts).

import { BASE_CSS, esc } from "./dashboard";
import { SCRIPT } from "./dashboard-script";

const CSS = String.raw`
:root{--warn:#b4542b}
@media (prefers-color-scheme:dark){:root{--warn:#e0825b}}
@media (prefers-reduced-motion:reduce){input.sw,input.sw::before{transition:none}}
main.app{max-width:1120px}
.layout{display:grid;grid-template-columns:15rem minmax(0,1fr);gap:24px;align-items:start}
button,input,select,textarea{font:inherit;color:inherit}
button{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:6px 12px;cursor:pointer}
button:hover:not(:disabled){border-color:var(--muted)}
button:disabled,input:disabled,select:disabled,textarea:disabled{opacity:.55;cursor:not-allowed}
button.link{border:0;background:none;padding:4px 0;color:var(--muted);text-decoration:underline}
:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
input[type=text],input[type=number],input[type=search],select,textarea{width:100%;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:6px 8px}
textarea{resize:vertical;min-height:4.5rem}
.projects{list-style:none;margin:0 0 16px;padding:0;border-top:1px solid var(--line)}
.projects button{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--line);border-left:3px solid transparent;border-radius:0;background:none;padding:8px 8px 8px 12px}
.projects button[aria-current=true]{border-left-color:var(--ink);background:var(--card)}
.projects b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.projects span{display:block;color:var(--muted);font-size:13px}
.projects .bad span{color:var(--warn)}
.picker{display:none}
.add label{display:block;font-weight:500;margin-bottom:4px}
.add .line{display:flex;gap:8px}
.add .msg{display:block;margin-top:4px}
.head{display:flex;flex-wrap:wrap;gap:4px 16px;align-items:baseline;justify-content:space-between;margin-bottom:8px}
.head h2{font-size:18px}.path{color:var(--muted);font-size:13px;overflow-wrap:anywhere;margin:0 0 8px}
[role=tablist]{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:16px}
[role=tab]{border:0;border-bottom:2px solid transparent;border-radius:0;background:none;padding:8px 12px;margin-bottom:-1px}
[role=tab][aria-selected=true]{border-bottom-color:var(--ink);font-weight:500}
.note{color:var(--muted);margin:0 0 12px}
.problem{color:var(--warn)}
fieldset{border:0;padding:0;margin:0 0 12px}legend{font-weight:500;padding:0;margin-bottom:4px}
fieldset label{display:block;padding:2px 0}
.filter{margin:0 0 16px;max-width:24rem}.filter label{display:block;font-weight:500;margin-bottom:4px}
h3{font-size:15px;margin:24px 0 4px}
.set{display:grid;grid-template-columns:minmax(0,1fr) 16rem 9rem;gap:4px 16px;align-items:start;padding:8px 0;border-top:1px solid var(--line)}
.set .name{font-weight:500;overflow-wrap:anywhere}.set .desc{color:var(--muted);font-size:13px;margin:0}
.set .from{color:var(--muted);font-size:13px}
.set .msg{grid-column:1/-1;font-size:13px}
[hidden]{display:none!important}
.msg{color:var(--muted)}.msg.err{color:var(--warn)}
.ctl{min-width:0}
input.sw{appearance:none;-webkit-appearance:none;width:40px;height:24px;border:1px solid var(--muted);border-radius:12px;background:var(--bg);position:relative;margin:0;cursor:pointer;transition:background .12s}
input.sw::before{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:var(--muted);transition:transform .12s}
input.sw:checked{background:var(--bar);border-color:var(--bar)}
input.sw:checked::before{background:var(--card);transform:translateX(16px)}
.mod{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 16px;padding:8px 0;border-top:1px solid var(--line)}
.mod .name{font-weight:500}.mod .desc,.mod .state{color:var(--muted);font-size:13px;margin:0}
.mod code{font-family:ui-monospace,monospace;font-size:13px;overflow-wrap:anywhere}
@media (max-width:800px){
.layout{grid-template-columns:minmax(0,1fr);gap:16px}
.projects{display:none}.picker{display:block;margin-bottom:8px}
.picker label{display:block;font-weight:500;margin-bottom:4px}
.set{grid-template-columns:minmax(0,1fr)}
.mod{grid-template-columns:minmax(0,1fr)}
}
`;

export interface PageData {
  token: string;
  writable: boolean;
  current: string;
  stats: string;
}

// `stats` is already escaped HTML from statsHtml; everything else here is fixed text.
export function renderApp(p: PageData): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="saw-token" content="${esc(p.token)}">
<title>saw dashboard</title>
<style>
${BASE_CSS}${CSS}</style></head><body data-writable="${p.writable}" data-current="${esc(p.current)}"><main class="app">
<h1>saw dashboard</h1><p class="sub">Settings, mods and statistics for the projects saw has been used in.</p>
<noscript><p class="problem">The settings and mods need JavaScript. The statistics below work without it.</p></noscript>
<p id="ro" class="note" hidden>Read-only: this dashboard runs in a container, so nothing here can be changed.</p>
<div class="layout">
<div>
<div class="picker"><label for="picker">Project</label><select id="picker"></select></div>
<nav aria-label="Projects"><ul id="projects" class="projects"></ul></nav>
<form id="add-form" class="add nav-add"><label for="add-path">Add a project</label><div class="line"><input type="text" id="add-path" placeholder="Full path to the folder" autocomplete="off"><button type="submit">Add</button></div><span id="add-msg" class="msg" role="status"></span></form>
</div>
<div>
<div class="head"><h2 id="title">Global</h2><div id="actions"></div></div>
<p id="path" class="path"></p><p id="head-msg" class="msg" role="status"></p>
<div role="tablist" aria-label="Project views">
<button type="button" role="tab" id="tab-settings" aria-controls="panel-settings" aria-selected="true">Settings</button>
<button type="button" role="tab" id="tab-mods" aria-controls="panel-mods" aria-selected="false" tabindex="-1">Mods</button>
<button type="button" role="tab" id="tab-stats" aria-controls="panel-stats" aria-selected="false" tabindex="-1">Statistics</button>
</div>
<div role="tabpanel" id="panel-settings" aria-labelledby="tab-settings">
<fieldset id="scope" hidden><legend>Edit</legend>
<label><input type="radio" name="scope" value="project" checked> This project (shared, workflow.toml)</label>
<label><input type="radio" name="scope" value="local"> This project (only me, workflow.local.toml)</label></fieldset>
<p class="note">A value comes from the last layer that sets it: default, global, shared, then only me. The shared file can only make guard settings stricter.</p>
<h3 id="warn-head" hidden>Ignored settings</h3><ul id="warnings" class="problem" hidden></ul>
<div class="filter"><label for="filter">Filter settings</label><input type="search" id="filter" autocomplete="off"></div>
<div id="settings-rows"></div>
</div>
<div role="tabpanel" id="panel-mods" aria-labelledby="tab-mods" hidden>
<p class="note">Mods add panels, buttons and hooks to the terminal Claude. <span id="mods-where"></span></p>
<div id="mods-rows"></div>
</div>
<div role="tabpanel" id="panel-stats" aria-labelledby="tab-stats" hidden>
<h2>Workflow metrics</h2>
<div id="stats">${p.stats}</div>
</div>
</div>
</div>
</main><script>${SCRIPT}</script></body></html>
`;
}

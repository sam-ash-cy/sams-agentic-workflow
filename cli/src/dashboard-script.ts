// The live dashboard's script, inlined into the page (the CSP allows inline script only).
// Plain JS with no template literals, because it sits inside one here. It draws the project
// list, settings and mods from /api/*, and only ever sets text with textContent: nothing from
// a settings file or a project name is turned into markup. The one innerHTML is the statistics
// block, which the server has already escaped.

export const SCRIPT = String.raw`
(function () {
  var S = { writable: document.body.dataset.writable === "true", projects: [], current: document.body.dataset.current, tab: "settings", scope: "project", filter: "" };
  var SOURCE = { "default": "default", global: "global", project: "shared", local: "only me" };
  var TABS = ["settings", "mods", "stats"];
  var $ = function (id) { return document.getElementById(id); };

  function h(tag, props, kids) {
    var el = document.createElement(tag);
    for (var k in props || {}) { if (k === "text") el.textContent = props[k]; else if (k in el) el[k] = props[k]; else el.setAttribute(k, props[k]); }
    (kids || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function request(path, opts) {
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (b) { return { ok: r.ok && !!b && b.ok !== false, status: r.status, body: b }; });
    }).catch(function () { return { ok: false, status: 0, body: { problem: "The dashboard is not reachable. Is saw dashboard --serve still running?" } }; });
  }
  // Writes must carry this launch's key (the page's saw-token meta tag) in the x-saw-csrf
  // header; the server also checks the origin.
  function post(path, body) {
    var headers = new Headers({ "content-type": "application/json" });
    headers.set("x-saw-csrf", document.querySelector("meta[name=saw-token]").content);
    return request(path, { method: "POST", headers: headers, body: JSON.stringify(body) });
  }
  function problem(r) { return (r.body && r.body.problem) || "That did not work (" + r.status + ")."; }

  function say(el, text, bad) {
    el.textContent = text;
    el.className = "msg" + (bad ? " err" : "");
    clearTimeout(el._t);
    if (text && !bad) el._t = setTimeout(function () { el.textContent = ""; }, 4000);
  }

  // Projects
  function current() { return S.projects.filter(function (p) { return p.id === S.current; })[0]; }
  function curPath() { var p = current(); return p ? p.path : ""; }

  function loadProjects(first) {
    return request("/api/projects").then(function (r) {
      if (!r.body || !r.body.projects) return;
      S.projects = r.body.projects; S.writable = r.body.writable;
      if (first) S.current = r.body.current;
      if (!current()) S.current = "global";
    });
  }

  function drawProjects() {
    var list = $("projects"), pick = $("picker");
    clear(list); clear(pick);
    S.projects.forEach(function (p) {
      var bad = p.state !== "ready";
      var b = h("button", { type: "button", onclick: function () { choose(p.id); } }, [h("b", { text: p.name }), h("span", { text: (p.id === "global" ? "" : p.state + ", ") + p.summary })]);
      if (p.id === S.current) b.setAttribute("aria-current", "true");
      list.appendChild(h("li", { className: bad ? "bad" : "" }, [b]));
      pick.appendChild(h("option", { value: p.id, text: p.name + (bad ? " (" + p.state + ")" : ""), selected: p.id === S.current }));
    });
    $("add-form").hidden = !S.writable;
    $("ro").hidden = S.writable;
  }

  function refresh() {
    drawProjects(); drawHead(); loadSettings(); loadMods(); version = null;
    if (S.tab === "stats") drawStats();
    history.replaceState(null, "", "?project=" + encodeURIComponent(S.current) + "#" + S.tab);
  }
  function choose(id) { S.current = id; refresh(); }

  function drawHead() {
    var p = current(); if (!p) return;
    $("title").textContent = p.name;
    $("path").textContent = p.id === "global" ? "Applies to every project. Stored in " + p.path : p.path;
    var act = $("actions"); clear(act);
    if (p.id === "global" || !S.writable) return;
    if (p.state === "not set up") act.appendChild(h("button", { type: "button", text: "Set up (saw init)", onclick: function () { projectAction({ action: "setup", project: p.id, path: p.path }, "Set up"); } }));
    act.appendChild(h("button", { type: "button", className: "link", text: "Remove from list", title: "Only forgets the folder. Nothing is deleted.", onclick: function () { projectAction({ action: "remove", project: p.id, path: p.path }); } }));
  }

  function projectAction(body, done) {
    post("/api/projects", body).then(function (r) {
      if (!r.ok) { say($("head-msg"), problem(r), true); return; }
      if (body.action === "remove") S.current = "global";
      loadProjects(false).then(function () { refresh(); say($("head-msg"), done || ""); });
    });
  }

  // Settings
  function readValue(row, el) {
    if (row.type === "boolean") return el.checked;
    if (row.type === "number") { if (el.value.trim() === "") return undefined; return Number(el.value); }
    if (row.type === "list") {
      var items = el.value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      if (typeof row.default[0] === "number") { items = items.map(Number); if (items.some(isNaN)) return undefined; }
      return items;
    }
    return el.value;
  }
  function showValue(row, el) {
    var v = row.value;
    if (row.type === "boolean") el.checked = v === true;
    else if (row.type === "list") el.value = v.join("\n");
    else el.value = String(v);
  }
  function applyRow(el, row) {
    el._row = row;
    var c = el.querySelector(".ctl > *"), blocked = row.blocked || [];
    var src = row.source.indexOf("enforcement=") === 0 ? "enforcement preset" : (SOURCE[row.source] || row.source);
    el.querySelector(".from").textContent = "from " + src;
    el.querySelector("button.link").hidden = row.layer === undefined || !S.writable;
    var locked = row.type === "boolean" && blocked.indexOf(!c.checked) >= 0;
    if (row.type === "enum") Array.prototype.forEach.call(c.options, function (o) { o.disabled = blocked.indexOf(o.value) >= 0; });
    c.disabled = !S.writable || locked;
    var why = el.querySelector(".why");
    if (row.note) why.textContent = row.note;
    else if (locked || (row.type === "enum" && blocked.length)) why.textContent = "The shared file can only make this stricter. To loosen it, edit under Only me.";
    else why.textContent = "";
    why.hidden = !why.textContent;
  }

  function settingRow(row, i) {
    var id = "k" + i, c;
    if (row.type === "boolean") { c = h("input", { type: "checkbox", id: id, className: "sw" }); c.setAttribute("role", "switch"); }
    else if (row.type === "enum") c = h("select", { id: id }, row.options.map(function (o) { return h("option", { value: o, text: o }); }));
    else if (row.type === "number") c = h("input", { type: "number", id: id, step: "any", min: row.min, max: row.max });
    else if (row.type === "list") c = h("textarea", { id: id, rows: Math.min(6, Math.max(2, row.value.length)) });
    else c = h("input", { type: "text", id: id });
    showValue(row, c);
    var msg = h("span", { className: "msg", role: "status" });
    var reset = h("button", { type: "button", className: "link", text: "Reset", title: "Remove it from this layer" });
    var el = h("div", { className: "set" }, [
      h("div", {}, [h("label", { htmlFor: id, className: "name", text: row.key }), h("p", { className: "desc", text: row.description }), h("p", { className: "desc why" })]),
      h("div", { className: "ctl" }, [c]),
      h("div", {}, [h("span", { className: "from" }), document.createTextNode(" "), reset]),
      msg
    ]);
    el.dataset.text = (row.key + " " + row.description).toLowerCase();
    function save(value) {
      if (value === undefined) { say(msg, "Enter a valid value.", true); showValue(el._row, c); return; }
      say(msg, "Saving");
      post("/api/settings", { project: S.current, path: curPath(), scope: S.scope, key: row.key, value: value }).then(function (r) {
        if (!r.ok) { say(msg, problem(r), true); showValue(el._row, c); applyRow(el, el._row); return; }
        showValue(r.body.row, c); applyRow(el, r.body.row);
        say(msg, r.body.warning ? "Saved. " + r.body.warning : "Saved");
      });
    }
    c.addEventListener("change", function () { save(readValue(row, c)); });
    reset.addEventListener("click", function () {
      say(msg, "Resetting");
      post("/api/settings", { project: S.current, path: curPath(), scope: S.scope, key: row.key, unset: true }).then(function (r) {
        if (!r.ok) { say(msg, problem(r), true); return; }
        showValue(r.body.row, c); applyRow(el, r.body.row); say(msg, "Reset");
      });
    });
    applyRow(el, row);
    return el;
  }

  var drawSeq = 0;
  function loadSettings() {
    var seq = ++drawSeq, p = current(), box = $("settings-rows"), global = S.current === "global";
    $("scope").hidden = global;
    if (global) S.scope = "global"; else if (S.scope === "global") S.scope = "project";
    Array.prototype.forEach.call(document.querySelectorAll("input[name=scope]"), function (r) { r.checked = r.value === S.scope; });
    clear(box);
    $("warnings").hidden = true; $("warn-head").hidden = true;
    if (p && p.state === "not set up") { box.appendChild(h("p", { className: "note", text: "This folder has no workflow.toml yet. Set it up to edit its settings." })); return; }
    if (p && p.state === "missing") { box.appendChild(h("p", { className: "note", text: "This folder is not there any more." })); return; }
    request("/api/settings?project=" + encodeURIComponent(S.current) + "&scope=" + S.scope).then(function (r) {
      if (seq !== drawSeq) return;
      clear(box);
      if (!r.body || !r.body.rows) { box.appendChild(h("p", { className: "problem", text: problem(r) })); return; }
      var warn = $("warnings"); clear(warn);
      r.body.warnings.forEach(function (w) { warn.appendChild(h("li", { text: w })); });
      warn.hidden = !r.body.warnings.length; $("warn-head").hidden = warn.hidden;
      var group = null, sec = null;
      r.body.rows.forEach(function (row, i) {
        if (row.group !== group) { group = row.group; sec = h("section", { className: "group" }, [h("h3", { text: group.charAt(0).toUpperCase() + group.slice(1).replace(/_/g, " ") })]); box.appendChild(sec); }
        sec.appendChild(settingRow(row, i));
      });
      box.appendChild(h("p", { className: "note", id: "none", hidden: true, text: "No settings match." }));
      applyFilter();
    });
  }

  function applyFilter() {
    var q = S.filter.trim().toLowerCase(), any = false;
    Array.prototype.forEach.call(document.querySelectorAll("#settings-rows section.group"), function (sec) {
      var shown = 0;
      Array.prototype.forEach.call(sec.querySelectorAll(".set"), function (row) {
        var ok = !q || row.dataset.text.indexOf(q) >= 0; row.hidden = !ok; if (ok) shown++;
      });
      sec.hidden = shown === 0; if (shown) any = true;
    });
    var none = $("none"); if (none) none.hidden = any || !q;
  }

  // Mods
  function modState(m) {
    if (m.state === "not installed") return "Not installed";
    var on = m.state === "enabled" ? "On" : "Off";
    return on + (S.current === "global" ? "" : m.own ? ", set for this project" : ", from your user settings");
  }
  var modSeq = 0;
  function loadMods() {
    var mine = ++modSeq;
    var box = $("mods-rows");
    request("/api/mods?project=" + encodeURIComponent(S.current)).then(function (r) {
      if (mine !== modSeq) return;
      clear(box);
      if (!r.body || !r.body.mods) { box.appendChild(h("p", { className: "problem", text: problem(r) })); return; }
      $("mods-where").textContent = "Saved to " + r.body.scope + ". " + r.body.restart;
      r.body.mods.forEach(function (m, i) {
        var id = "m" + i, msg = h("span", { className: "msg", role: "status" }), stateEl = h("p", { className: "state", text: modState(m) }), right;
        if (m.state === "not installed") right = null;
        else {
          right = h("input", { type: "checkbox", id: id, className: "sw", checked: m.state === "enabled", disabled: !S.writable });
          right.setAttribute("role", "switch");
          right.addEventListener("change", function () {
            say(msg, "Saving");
            post("/api/mods", { project: S.current, path: curPath(), name: m.name, enabled: right.checked }).then(function (x) {
              if (!x.ok) { right.checked = !right.checked; say(msg, problem(x), true); return; }
              var now = x.body.mods.filter(function (y) { return y.name === m.name; })[0];
              stateEl.textContent = modState(now);
              say(msg, "Saved. Takes effect in a new session.");
            });
          });
        }
        box.appendChild(h("div", { className: "mod" }, [
          h("div", {}, [h(m.state === "not installed" ? "span" : "label", { className: "name", htmlFor: id, text: m.name }), h("p", { className: "desc", text: m.description }), stateEl, m.state === "not installed" ? h("code", { text: m.install }) : null, msg]),
          right
        ]));
      });
    });
  }

  // Statistics: refreshed in place when the project's data changes, never by reloading the page.
  var version = null;
  function drawStats() {
    return fetch("/api/stats?project=" + encodeURIComponent(S.current), { cache: "no-store" }).then(function (r) { return r.text(); }).then(function (t) { $("stats").innerHTML = t; }).catch(function () {});
  }
  setInterval(function () {
    if (document.hidden) return;
    fetch("/version?project=" + encodeURIComponent(S.current), { cache: "no-store" }).then(function (r) { return r.text(); }).then(function (t) {
      if (version !== null && t !== version) drawStats();
      version = t;
    }).catch(function () {});
  }, 2000);

  // Tabs
  function showTab(name, focus) {
    S.tab = name;
    TABS.forEach(function (n) {
      var t = $("tab-" + n), on = n === name;
      t.setAttribute("aria-selected", on ? "true" : "false"); t.tabIndex = on ? 0 : -1;
      $("panel-" + n).hidden = !on;
      if (on && focus) t.focus();
    });
    history.replaceState(null, "", "?project=" + encodeURIComponent(S.current) + "#" + name);
    if (name === "stats") drawStats();
  }
  TABS.forEach(function (n, i) {
    var t = $("tab-" + n);
    t.addEventListener("click", function () { showTab(n); });
    t.addEventListener("keydown", function (e) {
      var j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
      if (j < 0) return;
      e.preventDefault(); showTab(TABS[(j + TABS.length) % TABS.length], true);
    });
  });

  // Wiring
  Array.prototype.forEach.call(document.querySelectorAll("input[name=scope]"), function (r) {
    r.addEventListener("change", function () { if (r.checked) { S.scope = r.value; loadSettings(); } });
  });
  $("filter").addEventListener("input", function () { S.filter = this.value; applyFilter(); });
  $("picker").addEventListener("change", function () { choose(this.value); });
  $("add-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var input = $("add-path"), msg = $("add-msg");
    post("/api/projects", { action: "add", path: input.value }).then(function (r) {
      if (!r.ok) { say(msg, problem(r), true); return; }
      input.value = "";
      loadProjects(false).then(function () { S.current = r.body.id; refresh(); say(msg, r.body.state === "ready" ? "Added" : "Added, " + r.body.state); });
    });
  });

  var wanted = new URLSearchParams(location.search).get("project");
  var tab = location.hash.replace("#", "");
  loadProjects(true).then(function () {
    if (wanted && S.projects.some(function (p) { return p.id === wanted; })) S.current = wanted;
    showTab(TABS.indexOf(tab) >= 0 ? tab : "settings");
    refresh();
  });
})();
`;

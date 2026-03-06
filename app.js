// ===============================
// Breakout Tracker (Bootstrap SPA)
// - Pie chart: ALL signals (all categories)
// - Dashboard table: ONLY Breakout, GROUPED by symbol
// - Dashboard dropdown: filter table by category
// - Category page: Category -> Group dropdown, paginated table
// - Cache: in-memory only (works with 25MB JSON)
// ===============================

// -------- CONFIG --------
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzUQ_OUADAM-tV5I4HmFRlsHyxPv54Kt5NB9fmIc2cyuIEZd0amIE2EEiH1NsND0bBF/exec"; // must end with /exec

const PAGE_SIZE = 100;
const DASHBOARD_MAX_ROWS = 500;

// For grouped UI: how many group badges to show before "+N more"
const DASH_GROUP_BADGE_LIMIT = 3;
const DASH_CATEGORY_BADGE_LIMIT = 3;

// Signal values expected from your Python
const KNOWN_SIGNALS = ["Breakout", "Big Sell Wick", "no breakout", "Red candle", "No Entry"];

// -------- IN-MEMORY CACHE --------
let MEMORY_CACHE = null;

// -------- JSONP FETCH --------
function jsonp(url) {
    return new Promise((resolve, reject) => {
        const cb = "__bt_cb_" + Math.random().toString(36).slice(2);
        const script = document.createElement("script");
        const sep = url.includes("?") ? "&" : "?";
        script.src = `${url}${sep}callback=${cb}`;

        window[cb] = (data) => { resolve(data); cleanup(); };
        script.onerror = () => { reject(new Error("JSONP load failed (check Apps Script /exec URL + deployment access)")); cleanup(); };

        function cleanup() {
            try { delete window[cb]; } catch { }
            script.remove();
        }
        document.head.appendChild(script);
    });
}

async function getPayload({ forceFresh = false } = {}) {
    if (!forceFresh && MEMORY_CACHE) return MEMORY_CACHE;
    const payload = await jsonp(WEB_APP_URL);
    MEMORY_CACHE = payload;
    return payload;
}

// -------- DOM HELPERS --------
const $ = (id) => document.getElementById(id);

function setView(name) {
    ["dashboard", "category", "error"].forEach(v => {
        $("view-" + v).classList.toggle("active", v === name);
    });
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    }[c]));
}

function parseRoute() {
    const h = location.hash || "#/dashboard";
    const parts = h.replace(/^#\//, "").split("/");
    const page = parts[0] || "dashboard";
    const arg = decodeURIComponent(parts.slice(1).join("/") || "");
    return { page, arg };
}

function toNum(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
}

// -------- YOUR JSON SHAPE --------
// payload.data = { "<Category>": { "<Group>": { timestamp, advance, data:[...] }, ... }, ... }

function getCategoryNames(data) {
    if (!data || typeof data !== "object") return [];
    return Object.keys(data);
}

function getGroupNames(data, categoryName) {
    const cat = data?.[categoryName];
    if (!cat || typeof cat !== "object") return [];
    return Object.keys(cat);
}

function getGroupMeta(data, categoryName, groupName) {
    const groupObj = data?.[categoryName]?.[groupName];
    if (!groupObj || typeof groupObj !== "object") return { timestamp: "", advance: null, name: "" };
    return {
        timestamp: groupObj.timestamp || "",
        advance: groupObj.advance || null,
        name: groupObj.name || ""
    };
}

function getRowsForGroup(data, categoryName, groupName) {
    const groupObj = data?.[categoryName]?.[groupName];
    const arr = groupObj?.data;

    const { timestamp, advance } = getGroupMeta(data, categoryName, groupName);

    const out = [];
    if (!Array.isArray(arr)) return out;

    for (const row of arr) {
        out.push({
            __category: categoryName,
            __group: groupName,
            __timestamp: timestamp,
            __advance: advance,
            ...row
        });
    }
    return out;
}

function flattenAllRows(data) {
    const out = [];
    for (const cat of getCategoryNames(data)) {
        for (const grp of getGroupNames(data, cat)) {
            out.push(...getRowsForGroup(data, cat, grp));
        }
    }
    return out;
}

// -------- EXACT BREAKOUT RULE (matches your Python) --------
function isBreakoutRow(row) {
    return String(row?.Signal || "") === "Breakout";
}

function signalLabel(row) {
    const s = String(row?.Signal || "");
    if (!s) return "Unknown";
    if (KNOWN_SIGNALS.includes(s)) return s;
    return "Unknown";
}

// -------- NAV: CATEGORIES DROPDOWN --------
function renderCategoriesDropdown(categoryNames) {
    const menu = $("categories-menu");
    menu.innerHTML = "";

    if (!categoryNames.length) {
        menu.innerHTML = `<li><span class="dropdown-item-text text-muted">No categories found</span></li>`;
        return;
    }

    for (const name of categoryNames) {
        const li = document.createElement("li");
        li.innerHTML = `<a class="dropdown-item" href="#/category/${encodeURIComponent(name)}">${escapeHtml(name)}</a>`;
        menu.appendChild(li);
    }
}

// -------- DASHBOARD: CATEGORY FILTER DROPDOWN --------
function renderDashboardCategoryDropdown(categoryNames) {
    const sel = $("dash-category");
    if (!sel) return;

    const current = sel.value || "__ALL__";

    sel.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "__ALL__";
    optAll.textContent = "All categories";
    sel.appendChild(optAll);

    for (const name of categoryNames) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
    }

    if (current === "__ALL__" || categoryNames.includes(current)) {
        sel.value = current;
    } else {
        sel.value = "__ALL__";
    }
}

// -------- CATEGORY: GROUP DROPDOWN --------
function renderGroupDropdown(groupNames, selected) {
    const sel = $("group-select");
    sel.innerHTML = "";

    if (!groupNames.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No groups";
        sel.appendChild(opt);
        return;
    }

    for (const g of groupNames) {
        const opt = document.createElement("option");
        opt.value = g;
        opt.textContent = g;
        if (g === selected) opt.selected = true;
        sel.appendChild(opt);
    }
}

// -------- PIE CHART (ALL SIGNALS) --------
let pieChart = null;

function groupRowsBySymbolForPie(rows) {
    const map = new Map();

    for (const r of rows) {
        const symbol = String(r.symbol ?? r.identifier ?? "").trim();
        if (!symbol) continue;

        const sig = signalLabel(r);

        if (!map.has(symbol)) {
            map.set(symbol, {
                symbol,
                signals: new Set(),
                hasBreakout: false
            });
        }

        const entry = map.get(symbol);
        entry.signals.add(sig);

        if (sig === "Breakout") {
            entry.hasBreakout = true;
        }
    }

    return Array.from(map.values());
}

function buildSignalCounts(rows) {
    const counts = {};
    for (const k of KNOWN_SIGNALS) counts[k] = 0;
    counts["Unknown"] = 0;

    const grouped = groupRowsBySymbolForPie(rows);

    for (const g of grouped) {
        let finalSignal = "Unknown";

        if (g.signals.has("Breakout")) finalSignal = "Breakout";
        else if (g.signals.has("Big Sell Wick")) finalSignal = "Big Sell Wick";
        else if (g.signals.has("no breakout")) finalSignal = "no breakout";
        else if (g.signals.has("Red candle")) finalSignal = "Red candle";
        else if (g.signals.has("No Entry")) finalSignal = "No Entry";

        counts[finalSignal] = (counts[finalSignal] ?? 0) + 1;
    }

    return counts;
}

function pieColorsForLabels(labels) {
    const map = {
        "Breakout": "rgba(57,217,138,.92)",
        "Big Sell Wick": "rgba(255,193,7,.90)",
        "no breakout": "rgba(108,117,125,.90)",
        "Red candle": "rgba(255,107,107,.88)",
        "No Entry": "rgba(79,140,255,.88)",
        "Unknown": "rgba(200,200,200,.70)"
    };
    return labels.map(l => map[l] || "rgba(200,200,200,.70)");
}

function renderSignalsPie(rows) {
    const counts = buildSignalCounts(rows);

    let labels = Object.keys(counts).filter(k => counts[k] > 0);

    labels.sort((a, b) => {
        if (a === "Breakout") return -1;
        if (b === "Breakout") return 1;
        return a.localeCompare(b);
    });

    const values = labels.map(l => counts[l]);
    const colors = pieColorsForLabels(labels);

    const ctx = $("pie").getContext("2d");
    if (pieChart) pieChart.destroy();

    pieChart = new Chart(ctx, {
        type: "pie",
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: "#fff" } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const label = ctx.label || "";
                            const value = ctx.parsed ?? 0;
                            const total = values.reduce((a, b) => a + b, 0) || 1;
                            const pct = (value * 100 / total).toFixed(1);
                            return `${label}: ${value} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });

    const uniqueStocks = groupRowsBySymbolForPie(rows).length;
    const breakout = counts["Breakout"] || 0;
    $("pie-hint").textContent = `Unique stocks: ${uniqueStocks} • Breakout: ${breakout}`;
}

// -------- DASHBOARD GROUPING HELPERS --------
function makeBadge(text, variant = "secondary") {
    return `<span class="badge bg-${variant} me-1 mb-1">${escapeHtml(text)}</span>`;
}

function makeOutlinedBadge(text) {
    // matches your existing "bg-dark border" look for groups
    return `<span class="badge bg-dark border me-1 mb-1">${escapeHtml(text)}</span>`;
}

function summarizeBadges(items, makeFn, limit) {
    const list = Array.from(items);
    const shown = list.slice(0, limit);
    const hiddenCount = Math.max(0, list.length - shown.length);

    const html = shown.map(makeFn).join("");

    if (hiddenCount > 0) {
        const title = list.join(", ");
        return html + `<span class="badge bg-secondary me-1 mb-1" title="${escapeHtml(title)}">+${hiddenCount} more</span>`;
    }
    return html;
}

// Group breakout rows by symbol
function groupBreakoutsBySymbol(rows) {
    const map = new Map();

    for (const r of rows) {
        const symbol = String(r.symbol ?? r.identifier ?? "").trim();
        if (!symbol) continue;

        if (!map.has(symbol)) {
            map.set(symbol, {
                symbol,
                categories: new Set(),
                groups: new Set(),
                links: 0,
                // optional numeric to sort:
                maxPChange: null
            });
        }

        const entry = map.get(symbol);
        entry.categories.add(String(r.__category ?? "").trim());
        entry.groups.add(String(r.__group ?? "").trim());
        entry.links += 1;

        const p = toNum(r.pChange);
        if (p !== null) {
            entry.maxPChange = (entry.maxPChange === null) ? p : Math.max(entry.maxPChange, p);
        }
    }

    return Array.from(map.values());
}

// -------- DASHBOARD (TABLE = BREAKOUT ONLY, GROUPED BY SYMBOL) --------
function renderDashboard(allRows) {
    // const textFilter = $("dash-filter").value.trim().toLowerCase();
    const selectedCategory = ($("dash-category")?.value || "__ALL__");
    const rowsEl = $("dash-rows");
    const statusEl = $("dash-status");

    // Pie stays GLOBAL (all rows)
    renderSignalsPie(allRows);

    // Breakout rows only
    let breakoutRows = allRows.filter(isBreakoutRow);

    // Apply category filter to table only (before grouping)
    if (selectedCategory !== "__ALL__") {
        breakoutRows = breakoutRows.filter(r => String(r.__category || "") === selectedCategory);
    }

    // Group by symbol
    let grouped = groupBreakoutsBySymbol(breakoutRows);

    // Sort: by maxPChange desc (if available), else by links desc, else symbol
    grouped.sort((a, b) => {
        const ap = a.maxPChange;
        const bp = b.maxPChange;
        if (ap !== null && bp !== null && bp !== ap) return bp - ap;
        if (b.links !== a.links) return b.links - a.links;
        return a.symbol.localeCompare(b.symbol);
    });

    // Apply text filter across symbol/categories/groups
    // if (textFilter) {
    //     grouped = grouped.filter(g => {
    //         const hay =
    //             `${g.symbol} ${Array.from(g.categories).join(" ")} ${Array.from(g.groups).join(" ")}`.toLowerCase();
    //         return hay.includes(textFilter);
    //     });
    // }

    const totalGrouped = grouped.length;
    const visible = grouped.slice(0, DASHBOARD_MAX_ROWS);

    rowsEl.innerHTML = visible.map(g => {
        const catsHtml = summarizeBadges(
            g.categories,
            (c) => makeBadge(c, "secondary"),
            DASH_CATEGORY_BADGE_LIMIT
        );

        const groupsHtml = summarizeBadges(
            g.groups,
            (gr) => makeOutlinedBadge(gr),
            DASH_GROUP_BADGE_LIMIT
        );

        return `
      <tr>
        <td class="fw-semibold">${escapeHtml(g.symbol)}</td>
        <td>${catsHtml}</td>
        <td>${groupsHtml}</td>
        <td class="text-end">${escapeHtml(String(g.links))}</td>
      </tr>
    `;
    }).join("");

    const catLabel = (selectedCategory === "__ALL__") ? "All categories" : selectedCategory;
    statusEl.textContent =
        `Table category: ${catLabel}. Breakout links: ${breakoutRows.length}. Unique breakout stocks: ${totalGrouped}. Showing: ${visible.length} (max ${DASHBOARD_MAX_ROWS}).`;
}

// -------- CATEGORY PAGE (Group-scoped + Pagination) --------
let CATEGORY_STATE = { category: "", group: "", rows: [], page: 1 };

function getCategoryColumns() {
    return [
        "symbol",
        "series",
        "open",
        "dayHigh",
        "dayLow",
        "lastPrice",
        "previousClose",
        "pChange",
        "totalTradedVolume",
        "Candle",
        "Pivot",
        "R1",
        "R2",
        "S1",
        "S2",
        "CPR_Narrow",
        "Signal"
    ];
}

function formatCell(key, value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") {
        if (key === "pChange") return value.toFixed(2);
        if (["open", "dayHigh", "dayLow", "lastPrice", "previousClose", "Pivot", "R1", "R2", "S1", "S2"].includes(key)) {
            return value.toFixed(2);
        }
        return String(value);
    }
    return String(value);
}

function renderCategoryTable() {
    const category = CATEGORY_STATE.category;
    const group = CATEGORY_STATE.group;
    const all = CATEGORY_STATE.rows;

    const metaData = MEMORY_CACHE?.data;
    const { timestamp, advance } = getGroupMeta(metaData, category, group);

    $("cat-title").textContent = `Category: ${category}`;
    $("cat-subtitle").textContent =
        `Group: ${group}` +
        (timestamp ? ` • Timestamp: ${timestamp}` : "") +
        (advance ? ` • Adv: ${advance.advances ?? ""} / Dec: ${advance.declines ?? ""}` : "");

    const filter = $("cat-filter").value.trim().toLowerCase();
    const filtered = !filter ? all : all.filter(r => {
        const sym = String(r.symbol ?? "").toLowerCase();
        const sig = String(r.Signal ?? "").toLowerCase();
        const candle = String(r.Candle ?? "").toLowerCase();
        if (sym.includes(filter) || sig.includes(filter) || candle.includes(filter)) return true;
        try { return JSON.stringify(r).toLowerCase().includes(filter); }
        catch { return true; }
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    CATEGORY_STATE.page = Math.min(CATEGORY_STATE.page, totalPages);

    const start = (CATEGORY_STATE.page - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);

    const cols = getCategoryColumns();
    $("cat-thead").innerHTML = `<tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;

    $("cat-rows").innerHTML = pageRows.map(r => {
        const isBO = isBreakoutRow(r);
        return `<tr class="${isBO ? "table-success" : ""}">${cols.map(c => `<td>${escapeHtml(formatCell(c, r?.[c]))}</td>`).join("")
            }</tr>`;
    }).join("");

    $("cat-status").innerHTML = `
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
      <div>Showing ${pageRows.length} rows (from ${filtered.length ? start + 1 : 0} to ${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length}).</div>
      <div class="btn-group btn-group-sm" role="group">
        <button class="btn btn-outline-light" ${CATEGORY_STATE.page <= 1 ? "disabled" : ""} id="btn-prev">Prev</button>
        <button class="btn btn-outline-light" ${CATEGORY_STATE.page >= totalPages ? "disabled" : ""} id="btn-next">Next</button>
      </div>
    </div>
  `;

    const prev = document.getElementById("btn-prev");
    const next = document.getElementById("btn-next");
    if (prev) prev.onclick = () => { CATEGORY_STATE.page--; renderCategoryTable(); };
    if (next) next.onclick = () => { CATEGORY_STATE.page++; renderCategoryTable(); };
}

// -------- APP RENDER --------
async function renderApp({ forceFresh = false } = {}) {
    try {
        const payload = await getPayload({ forceFresh });
        if (!payload?.ok) throw new Error("Apps Script returned bad payload.");

        $("meta").textContent =
            `File: ${payload.fileName || "(unknown)"} • Date: ${payload.fileDate || "(n/a)"} • Updated: ${payload.lastUpdated ? new Date(payload.lastUpdated).toLocaleString() : "(n/a)"
            }`;

        const categoryNames = getCategoryNames(payload.data).sort((a, b) => a.localeCompare(b));
        renderCategoriesDropdown(categoryNames);
        renderDashboardCategoryDropdown(categoryNames);

        const { page, arg } = parseRoute();
        $("nav-dashboard").classList.toggle("active", page === "dashboard");

        if (page === "dashboard") {
            setView("dashboard");
            const allRows = flattenAllRows(payload.data);
            renderDashboard(allRows);
            return;
        }

        if (page === "category") {
            setView("category");

            const categoryName = arg;
            const groupNames = getGroupNames(payload.data, categoryName).sort((a, b) => a.localeCompare(b));

            if (!groupNames.length) {
                CATEGORY_STATE = { category: categoryName, group: "", rows: [], page: 1 };
                renderGroupDropdown([], "");
                renderCategoryTable();
                return;
            }

            if (CATEGORY_STATE.category !== categoryName) {
                CATEGORY_STATE.category = categoryName;
                CATEGORY_STATE.group = groupNames[0];
                CATEGORY_STATE.page = 1;
                $("cat-filter").value = "";
            }

            if (!groupNames.includes(CATEGORY_STATE.group)) {
                CATEGORY_STATE.group = groupNames[0];
                CATEGORY_STATE.page = 1;
            }

            renderGroupDropdown(groupNames, CATEGORY_STATE.group);

            CATEGORY_STATE.rows = getRowsForGroup(payload.data, CATEGORY_STATE.category, CATEGORY_STATE.group);
            renderCategoryTable();
            return;
        }

        location.hash = "#/dashboard";
    } catch (err) {
        setView("error");
        $("error-text").textContent = String(err?.stack || err);
    }
}

// -------- EVENTS --------
$("btn-refresh").addEventListener("click", () => {
    MEMORY_CACHE = null;
    renderApp({ forceFresh: true });
});

// $("dash-filter").addEventListener("input", () => renderApp());
$("dash-category").addEventListener("change", () => renderApp());

$("cat-filter").addEventListener("input", () => {
    CATEGORY_STATE.page = 1;
    renderCategoryTable();
});

$("group-select").addEventListener("change", (e) => {
    CATEGORY_STATE.group = e.target.value;
    CATEGORY_STATE.page = 1;
    $("cat-filter").value = "";
    renderApp(); // uses cached payload; no refetch
});

window.addEventListener("hashchange", () => renderApp());

// Initial render
renderApp();
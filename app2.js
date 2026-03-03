// ---------------- CONFIG ----------------
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxVdD5ilKZvD3F7PRSApVlEXewiKAMg6WbMDvbqLeN0kuFMdYC8rXhK-6BPpdG7KhyQ/exec"; // ends with /exec

// Breakout logic: tweak these keywords to match your signals
const BREAKOUT_SIGNAL_KEYWORDS = [
    "breakout",
    "buy",
    "bull",
    "uptrend",
    "green candle",
    "reversal",
    "support"
];

const NON_BREAKOUT_SIGNAL_KEYWORDS = [
    "sell",
    "big sell",
    "red candle",
    "downtrend"
];

// Pagination
const PAGE_SIZE = 100;

// Dashboard: show only top N breakout rows to keep it fast
const DASHBOARD_MAX_ROWS = 300;

// ---------------- IN-MEMORY CACHE ----------------
let MEMORY_CACHE = null;

// ---------------- JSONP FETCH ----------------
function jsonp(url) {
    return new Promise((resolve, reject) => {
        const cb = "__bt_cb_" + Math.random().toString(36).slice(2);
        const script = document.createElement("script");
        const sep = url.includes("?") ? "&" : "?";
        script.src = `${url}${sep}callback=${cb}`;

        window[cb] = (data) => { resolve(data); cleanup(); };
        script.onerror = () => { reject(new Error("JSONP load failed")); cleanup(); };

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

// ---------------- DOM HELPERS ----------------
const $ = (id) => document.getElementById(id);

function setView(name) {
    ["dashboard", "category", "error"].forEach(v => {
        $("view-" + v).classList.toggle("active", v === name);
    });
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
}

function parseRoute() {
    const h = location.hash || "#/dashboard";
    const parts = h.replace(/^#\//, "").split("/");
    const page = parts[0] || "dashboard";
    const arg = decodeURIComponent(parts.slice(1).join("/") || "");
    return { page, arg };
}

// ---------------- YOUR JSON SHAPE ----------------
//
// payload.data = {
//   "<CategoryName>": {
//      "<GroupName>": { timestamp, advance, data: [ rows... ] },
//      ...
//   },
//   ...
// }

function getCategoryNames(data) {
    if (!data || typeof data !== "object") return [];
    return Object.keys(data);
}

function getGroupMapForCategory(data, categoryName) {
    const cat = data?.[categoryName];
    if (!cat || typeof cat !== "object") return {};
    return cat;
}

// Flatten category into rows, attaching category + group + timestamp
function flattenCategoryRows(data, categoryName) {
    const groupMap = getGroupMapForCategory(data, categoryName);
    const out = [];

    for (const [groupName, groupObj] of Object.entries(groupMap)) {
        const arr = groupObj?.data;
        const timestamp = groupObj?.timestamp || "";
        const advance = groupObj?.advance || null;

        if (!Array.isArray(arr)) continue;

        for (const row of arr) {
            out.push({
                __category: categoryName,
                __group: groupName,
                __timestamp: timestamp,
                __advance: advance,
                ...row
            });
        }
    }
    return out;
}

// Flatten all categories for dashboard
function flattenAllRows(data) {
    const out = [];
    for (const categoryName of getCategoryNames(data)) {
        out.push(...flattenCategoryRows(data, categoryName));
    }
    return out;
}

// ---------------- BREAKOUT CLASSIFIER ----------------
function isBreakoutRow(row) {
    const sig = `${row?.Signal ?? ""}`.toLowerCase();
    const candle = `${row?.Candle ?? ""}`.toLowerCase();

    // Strong negatives first
    if (NON_BREAKOUT_SIGNAL_KEYWORDS.some(k => sig.includes(k))) return false;

    // Strong positives
    if (BREAKOUT_SIGNAL_KEYWORDS.some(k => sig.includes(k))) return true;

    // fallback heuristic:
    // if candle is green & pChange is positive -> likely breakout-ish
    const p = Number(row?.pChange);
    if (!Number.isNaN(p) && p > 0 && candle.includes("green")) return true;

    return false;
}

// ---------------- UI: CATEGORIES DROPDOWN ----------------
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

// ---------------- CHART ----------------
let pieChart = null;

function renderPie(breakoutCount, nonCount) {
    const ctx = $("pie").getContext("2d");
    const data = {
        labels: ["Breakout chance", "No breakout"],
        datasets: [{
            data: [breakoutCount, nonCount],
            backgroundColor: ["rgba(57,217,138,.9)", "rgba(255,107,107,.85)"],
            borderWidth: 0
        }]
    };

    if (pieChart) pieChart.destroy();
    pieChart = new Chart(ctx, {
        type: "pie",
        data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: "#fff" } } }
        }
    });

    $("pie-hint").textContent = `Breakout: ${breakoutCount} • No breakout: ${nonCount}`;
}

// ---------------- DASHBOARD RENDER ----------------
function renderDashboard(allRows) {
    const filter = $("dash-filter").value.trim().toLowerCase();
    const rowsEl = $("dash-rows");
    const statusEl = $("dash-status");

    const breakout = allRows.filter(isBreakoutRow);
    const nonBreakout = Math.max(allRows.length - breakout.length, 0);
    renderPie(breakout.length, nonBreakout);

    // Sort breakout by score/priority if present (best first)
    breakout.sort((a, b) => {
        const sa = Number(a.score ?? a.Score);
        const sb = Number(b.score ?? b.Score);
        const pa = Number(a.priority ?? 0);
        const pb = Number(b.priority ?? 0);

        // prefer numeric score desc, else priority asc
        if (!Number.isNaN(sa) && !Number.isNaN(sb) && sb !== sa) return sb - sa;
        return pa - pb;
    });

    const limited = breakout.slice(0, DASHBOARD_MAX_ROWS);

    const visible = limited.filter(r => {
        const symbol = r.symbol ?? r.identifier ?? "";
        const reason = r.Signal ?? r.Candle ?? "";
        const category = r.__category ?? "";
        const group = r.__group ?? "";
        const score = r.score ?? r.Score ?? r.priority ?? "";

        const hay = `${symbol} ${reason} ${category} ${group} ${score}`.toLowerCase();
        return !filter || hay.includes(filter);
    });

    rowsEl.innerHTML = visible.map(r => {
        const symbol = r.symbol ?? r.identifier ?? "";
        const category = r.__category ?? "";
        const reason = r.Signal ?? r.Candle ?? "";
        const score = r.score ?? r.Score ?? r.priority ?? "";

        return `
      <tr>
        <td class="fw-semibold">${escapeHtml(symbol)}</td>
        <td><span class="badge bg-secondary">${escapeHtml(category)}</span></td>
        <td>${escapeHtml(reason)}</td>
        <td class="text-end">${escapeHtml(String(score))}</td>
      </tr>
    `;
    }).join("");

    statusEl.textContent =
        `Total rows: ${allRows.length}. Breakout rows: ${breakout.length}. Showing ${visible.length} (max ${DASHBOARD_MAX_ROWS}).`;
}

// ---------------- CATEGORY VIEW (PAGINATED TABLE) ----------------
let CATEGORY_STATE = { name: "", rows: [], page: 1 };

function getCategoryColumns() {
    // Keep columns stable + useful. (Add/remove as you like.)
    return [
        "__group",
        "symbol",
        "lastPrice",
        "pChange",
        "totalTradedVolume",
        "Candle",
        "CPR_Narrow",
        "Signal",
        "Pivot",
        "R1",
        "R2",
        "S1",
        "S2"
    ];
}

function formatCell(key, value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") {
        // prettier numbers
        if (["pChange"].includes(key)) return value.toFixed(2);
        if (["lastPrice", "Pivot", "R1", "R2", "S1", "S2", "dayHigh", "dayLow", "open", "previousClose"].includes(key)) return value.toFixed(2);
        return String(value);
    }
    return String(value);
}

function renderCategoryPage() {
    const name = CATEGORY_STATE.name;
    const all = CATEGORY_STATE.rows;

    const filter = $("cat-filter").value.trim().toLowerCase();
    const filtered = !filter
        ? all
        : all.filter(r => {
            try { return JSON.stringify(r).toLowerCase().includes(filter); }
            catch { return true; }
        });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    CATEGORY_STATE.page = Math.min(CATEGORY_STATE.page, totalPages);

    const start = (CATEGORY_STATE.page - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);

    $("cat-title").textContent = `Category: ${name}`;
    $("cat-subtitle").textContent = `${filtered.length} rows (page ${CATEGORY_STATE.page} / ${totalPages})`;

    // table head
    const cols = getCategoryColumns();
    $("cat-thead").innerHTML = `<tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;

    // table body
    $("cat-rows").innerHTML = pageRows.map(r => {
        return `<tr>${cols.map(c => `<td>${escapeHtml(formatCell(c, r?.[c]))}</td>`).join("")}</tr>`;
    }).join("");

    // status + pager
    $("cat-status").innerHTML = `
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
      <div>Showing ${pageRows.length} rows (from ${start + 1} to ${Math.min(start + PAGE_SIZE, filtered.length)}).</div>
      <div class="btn-group btn-group-sm" role="group">
        <button class="btn btn-outline-light" ${CATEGORY_STATE.page <= 1 ? "disabled" : ""} id="btn-prev">Prev</button>
        <button class="btn btn-outline-light" ${CATEGORY_STATE.page >= totalPages ? "disabled" : ""} id="btn-next">Next</button>
      </div>
    </div>
  `;

    const prev = document.getElementById("btn-prev");
    const next = document.getElementById("btn-next");
    if (prev) prev.onclick = () => { CATEGORY_STATE.page--; renderCategoryPage(); };
    if (next) next.onclick = () => { CATEGORY_STATE.page++; renderCategoryPage(); };
}

// ---------------- APP RENDER ----------------
async function renderApp({ forceFresh = false } = {}) {
    try {
        const payload = await getPayload({ forceFresh });
        if (!payload?.ok) throw new Error("Apps Script returned bad payload.");

        $("meta").textContent =
            `File: ${payload.fileName || "(unknown)"} • Date: ${payload.fileDate || "(n/a)"} • Updated: ${payload.lastUpdated ? new Date(payload.lastUpdated).toLocaleString() : "(n/a)"
            }`;

        const categoryNames = getCategoryNames(payload.data).sort((a, b) => a.localeCompare(b));
        renderCategoriesDropdown(categoryNames);

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
            const rows = flattenCategoryRows(payload.data, arg);

            // reset state when switching categories
            if (CATEGORY_STATE.name !== arg) {
                CATEGORY_STATE = { name: arg, rows, page: 1 };
            } else {
                CATEGORY_STATE.rows = rows; // keep page
            }

            renderCategoryPage();
            return;
        }

        location.hash = "#/dashboard";
    } catch (err) {
        setView("error");
        $("error-text").textContent = String(err?.stack || err);
    }
}

// ---------------- EVENTS ----------------
$("btn-refresh").addEventListener("click", () => {
    MEMORY_CACHE = null;
    renderApp({ forceFresh: true });
});

$("dash-filter").addEventListener("input", () => renderApp());
$("cat-filter").addEventListener("input", () => renderCategoryPage());

window.addEventListener("hashchange", () => renderApp());

// Initial render
renderApp();
// ---------------- CONFIG ----------------
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxVdD5ilKZvD3F7PRSApVlEXewiKAMg6WbMDvbqLeN0kuFMdYC8rXhK-6BPpdG7KhyQ/exec"; // ends with /exec

// Breakout logic (dashboard)
const BREAKOUT_SIGNAL_KEYWORDS = ["breakout", "buy", "bull", "green candle", "reversal"];
const NON_BREAKOUT_SIGNAL_KEYWORDS = ["sell", "big sell", "red candle", "downtrend"];

// Pagination
const PAGE_SIZE = 100;
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

function getRowsForGroup(data, categoryName, groupName) {
    const groupObj = data?.[categoryName]?.[groupName];
    const arr = groupObj?.data;
    const timestamp = groupObj?.timestamp || "";
    const advance = groupObj?.advance || null;

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

// ---------------- BREAKOUT CLASSIFIER ----------------
function isBreakoutRow(row) {
    const sig = `${row?.Signal ?? ""}`.toLowerCase();
    const candle = `${row?.Candle ?? ""}`.toLowerCase();

    if (NON_BREAKOUT_SIGNAL_KEYWORDS.some(k => sig.includes(k))) return false;
    if (BREAKOUT_SIGNAL_KEYWORDS.some(k => sig.includes(k))) return true;

    const p = Number(row?.pChange);
    if (!Number.isNaN(p) && p > 0 && candle.includes("green")) return true;

    return false;
}

// ---------------- NAV CATEGORIES ----------------
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

// ---------------- DASHBOARD ----------------
function renderDashboard(allRows) {
    const filter = $("dash-filter").value.trim().toLowerCase();
    const rowsEl = $("dash-rows");
    const statusEl = $("dash-status");

    const breakout = allRows.filter(isBreakoutRow);
    const nonBreakout = Math.max(allRows.length - breakout.length, 0);
    renderPie(breakout.length, nonBreakout);

    breakout.sort((a, b) => {
        const sa = Number(a.score ?? a.Score);
        const sb = Number(b.score ?? b.Score);
        const pa = Number(a.priority ?? 0);
        const pb = Number(b.priority ?? 0);
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

// ---------------- CATEGORY VIEW (GROUP + PAGINATION) ----------------
let CATEGORY_STATE = {
    category: "",
    group: "",
    rows: [],
    page: 1
};

function getCategoryColumns() {
    return [
        "symbol",
        "identifier",
        "series",
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
        if (key === "pChange") return value.toFixed(2);
        if (["lastPrice", "Pivot", "R1", "R2", "S1", "S2", "dayHigh", "dayLow", "open", "previousClose"].includes(key)) {
            return value.toFixed(2);
        }
        return String(value);
    }
    return String(value);
}

function renderGroupDropdown(groupNames, selected) {
    const sel = $("group-select");
    sel.innerHTML = "";

    for (const g of groupNames) {
        const opt = document.createElement("option");
        opt.value = g;
        opt.textContent = g;
        if (g === selected) opt.selected = true;
        sel.appendChild(opt);
    }
}

function renderCategoryTable() {
    const category = CATEGORY_STATE.category;
    const group = CATEGORY_STATE.group;
    const all = CATEGORY_STATE.rows;

    $("cat-title").textContent = `Category: ${category}`;
    $("cat-subtitle").textContent = `Group: ${group} • ${all.length} rows`;

    const filter = $("cat-filter").value.trim().toLowerCase();
    const filtered = !filter ? all : all.filter(r => {
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
        return `<tr>${cols.map(c => `<td>${escapeHtml(formatCell(c, r?.[c]))}</td>`).join("")}</tr>`;
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

            const categoryName = arg;
            const groupNames = getGroupNames(payload.data, categoryName).sort((a, b) => a.localeCompare(b));

            if (!groupNames.length) {
                CATEGORY_STATE = { category: categoryName, group: "", rows: [], page: 1 };
                renderGroupDropdown([], "");
                renderCategoryTable();
                return;
            }

            // If switching category, default to first group
            if (CATEGORY_STATE.category !== categoryName) {
                CATEGORY_STATE.category = categoryName;
                CATEGORY_STATE.group = groupNames[0];
                CATEGORY_STATE.page = 1;
                $("cat-filter").value = "";
            }

            // Ensure selected group exists (if data changed)
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

// ---------------- EVENTS ----------------
$("btn-refresh").addEventListener("click", () => {
    MEMORY_CACHE = null;
    renderApp({ forceFresh: true });
});

$("dash-filter").addEventListener("input", () => renderApp());

$("cat-filter").addEventListener("input", () => {
    CATEGORY_STATE.page = 1;
    renderCategoryTable();
});

$("group-select").addEventListener("change", (e) => {
    CATEGORY_STATE.group = e.target.value;
    CATEGORY_STATE.page = 1;
    $("cat-filter").value = "";
    renderApp(); // uses cached payload, no refetch
});

window.addEventListener("hashchange", () => renderApp());

// Initial render
renderApp();
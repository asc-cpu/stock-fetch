// ---------------- CONFIG ----------------
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxVdD5ilKZvD3F7PRSApVlEXewiKAMg6WbMDvbqLeN0kuFMdYC8rXhK-6BPpdG7KhyQ/exec"; // must end with /exec
//const CACHE_KEY = "bt_payload_cache_v1"; // cached per tab session

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

let MEMORY_CACHE = null;

async function getPayload({ forceFresh = false } = {}) {
    if (!forceFresh && MEMORY_CACHE) return MEMORY_CACHE;

    const payload = await jsonp(WEB_APP_URL);
    MEMORY_CACHE = payload; // stays until tab refresh/close
    return payload;
}

// ---------------- SCHEMA ADAPTERS ----------------
// Update these 3 functions once you confirm your JSON structure.

function getCategoryMap(data) {
    // Common layouts:
    // 1) { categories: { "CAT": [..], ... } }
    if (data?.categories && typeof data.categories === "object" && !Array.isArray(data.categories)) return data.categories;

    // 2) { category_map: { ... } }
    if (data?.category_map && typeof data.category_map === "object" && !Array.isArray(data.category_map)) return data.category_map;

    // 3) data itself looks like { "CAT": [..], "CAT2": [..] }
    if (data && typeof data === "object" && !Array.isArray(data)) {
        const keys = Object.keys(data);
        const looksLikeMap = keys.length && keys.every(k => Array.isArray(data[k]));
        if (looksLikeMap) return data;
    }
    return {};
}

function isBreakoutRow(row) {
    // Try flags first
    if (row?.breakout === true) return true;
    if (row?.has_breakout === true) return true;
    if (String(row?.breakout_chance || "").toLowerCase() === "yes") return true;
    if (String(row?.signal || "").toLowerCase().includes("breakout")) return true;

    // fallback: score threshold
    const score = Number(row?.score);
    if (!Number.isNaN(score) && score >= 7) return true;

    return false;
}

function pickRowFieldsForDashboard(row) {
    return {
        symbol: row.symbol ?? row.ticker ?? row.Symbol ?? "",
        reason: row.reason ?? row.pattern ?? row.signal ?? "",
        score: row.score ?? row.Score ?? ""
    };
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

// ---------------- ROUTER ----------------
function parseRoute() {
    const h = location.hash || "#/dashboard";
    const parts = h.replace(/^#\//, "").split("/");
    const page = parts[0] || "dashboard";
    const arg = decodeURIComponent(parts.slice(1).join("/") || "");
    return { page, arg };
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
            plugins: {
                legend: { labels: { color: "#fff" } }
            }
        }
    });

    $("pie-hint").textContent = `Breakout: ${breakoutCount} • No breakout: ${nonCount}`;
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

// ---------------- DASHBOARD ----------------
function renderDashboard(categoryMap) {
    const filter = $("dash-filter").value.trim().toLowerCase();
    const rowsEl = $("dash-rows");
    const statusEl = $("dash-status");

    // Flatten all rows across categories
    const all = [];
    for (const [cat, arr] of Object.entries(categoryMap)) {
        if (!Array.isArray(arr)) continue;
        for (const r of arr) all.push({ category: cat, row: r });
    }

    const breakout = all.filter(x => isBreakoutRow(x.row));
    const nonBreakout = Math.max(all.length - breakout.length, 0);
    renderPie(breakout.length, nonBreakout);

    const visible = breakout.filter(x => {
        const f = pickRowFieldsForDashboard(x.row);
        const hay = `${f.symbol} ${x.category} ${f.reason} ${f.score}`.toLowerCase();
        return !filter || hay.includes(filter);
    });

    rowsEl.innerHTML = visible.map(x => {
        const f = pickRowFieldsForDashboard(x.row);
        return `
      <tr>
        <td class="fw-semibold">${escapeHtml(f.symbol)}</td>
        <td><span class="badge bg-secondary">${escapeHtml(x.category)}</span></td>
        <td>${escapeHtml(f.reason)}</td>
        <td class="text-end">${escapeHtml(String(f.score))}</td>
      </tr>
    `;
    }).join("");

    statusEl.textContent = `Showing ${visible.length} breakout stocks (out of ${all.length} total rows).`;
}

// ---------------- CATEGORY TABLE ----------------
function renderCategoryTable(categoryName, rows) {
    const filter = $("cat-filter").value.trim().toLowerCase();
    $("cat-title").textContent = `Category: ${categoryName}`;

    const arr = Array.isArray(rows) ? rows : [];
    $("cat-subtitle").textContent = `${arr.length} rows`;

    const thead = $("cat-thead");
    const tbody = $("cat-rows");
    const status = $("cat-status");

    if (!arr.length) {
        thead.innerHTML = "";
        tbody.innerHTML = "";
        status.textContent = "No rows found for this category.";
        return;
    }

    // Determine columns from union of keys (first N rows)
    const keys = new Set();
    for (const r of arr.slice(0, 60)) {
        if (r && typeof r === "object" && !Array.isArray(r)) {
            Object.keys(r).forEach(k => keys.add(k));
        }
    }
    const cols = Array.from(keys);

    thead.innerHTML = `<tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;

    const filtered = arr.filter(r => {
        if (!filter) return true;
        try { return JSON.stringify(r).toLowerCase().includes(filter); }
        catch { return true; }
    });

    tbody.innerHTML = filtered.map(r => {
        return `<tr>${cols.map(c => `<td>${escapeHtml(String(r?.[c] ?? ""))}</td>`).join("")}</tr>`;
    }).join("");

    status.textContent = `Showing ${filtered.length} rows (out of ${arr.length}).`;
}

// ---------------- APP RENDER ----------------
async function renderApp({ forceFresh = false } = {}) {
    try {
        const payload = await getPayload({ forceFresh });
        if (!payload?.ok) throw new Error("Apps Script returned bad payload.");

        $("meta").textContent =
            `File: ${payload.fileName || "(unknown)"} • Date: ${payload.fileDate || "(n/a)"} • Updated: ${payload.lastUpdated ? new Date(payload.lastUpdated).toLocaleString() : "(n/a)"
            }`;

        const categoryMap = getCategoryMap(payload.data);
        const categoryNames = Object.keys(categoryMap).sort((a, b) => a.localeCompare(b));
        renderCategoriesDropdown(categoryNames);

        const { page, arg } = parseRoute();

        // nav active state
        $("nav-dashboard").classList.toggle("active", page === "dashboard");

        if (page === "dashboard") {
            setView("dashboard");
            renderDashboard(categoryMap);
            return;
        }

        if (page === "category") {
            setView("category");
            renderCategoryTable(arg, categoryMap[arg]);
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
$("cat-filter").addEventListener("input", () => renderApp());

window.addEventListener("hashchange", () => renderApp());

// Initial render
renderApp();
# Breakout Tracker

A **free web-based stock breakout tracker** that visualizes enriched market data using **Bootstrap + Chart.js**, hosted on **GitHub Pages**, and powered by **Google Apps Script** to fetch the latest JSON data from Google Drive.

The dashboard helps quickly identify **unique breakout opportunities** across multiple market indices and groups.

---

# Architecture Overview

```
Python Data Pipeline
        │
        ▼
Google Drive (JSON files)
        │
        ▼
Google Apps Script (API endpoint)
        │
        ▼
GitHub Pages Website
        │
        ▼
User Browser (Bootstrap + Chart.js UI)
```

---

# Features

## Dashboard

Displays an overview of the market signals.

### Pie Chart
Shows **unique stock distribution by signal**:

- Breakout
- Big Sell Wick
- No Breakout
- Red Candle
- No Entry

Each company is counted **only once**, even if it appears in multiple indices.

---

### Signals Table

Shows **unique stocks grouped by symbol** with:

- Signal
- Linked Categories
- Linked Groups
- Number of links (how many groups the stock appears in)

---

### Dashboard Filters

You can filter the table by:

- **Category**
- **Signal**
- **Search text**

This allows quick exploration of breakout opportunities.

---

# Category Pages

The **Categories section** allows deeper exploration.

Structure:

```
Category
   └── Group
           └── Stock list
```

Example:

```
Broad Market Indices
   └── NIFTY TOTAL MARKET
           └── HAL
           └── INFY
```

Each page displays a **paginated table** with:

- Price data
- Pivot levels
- CPR Narrow
- Signal
- Volume

---

# Data Pipeline

## Python Enrichment

Market data is enriched using Python before being stored.

Calculated indicators include:

- Candle type
- Pivot
- R1 / R2
- S1 / S2
- CPR Narrow
- Breakout signal

Signal logic example:

```python
if close <= open:
    signal = "Red candle"
elif close <= previous_high:
    signal = "no breakout"
elif breakout_condition:
    signal = "Breakout"
elif sell_wick_condition:
    signal = "Big Sell Wick"
else:
    signal = "No Entry"
```

---

# Data Storage

The enriched data is saved daily to **Google Drive**.

File naming format:

```
latest_trade_data_ddmmyyyy.json
```

Example:

```
latest_trade_data_03032026.json
```

---

# Google Apps Script API

Apps Script retrieves the **latest file** and converts it to a format usable by the website.

Responsibilities:

- Find the latest JSON file
- Transform symbol-based JSON into array format
- Normalize field names
- Compute `pChange`
- Return JSONP for browser access

Example response:

```json
{
  "ok": true,
  "fileName": "latest_trade_data_03032026.json",
  "fileDate": "2026-03-03",
  "lastUpdated": "...",
  "data": {
    "Category": {
      "Group": {
        "timestamp": "",
        "advance": null,
        "data": []
      }
    }
  }
}
```

---

# Web Application

The frontend is a **single-page application (SPA)**.

Technologies used:

- Bootstrap 5
- Chart.js
- Vanilla JavaScript
- GitHub Pages hosting

---

# Dashboard Logic

## Unique Stock Grouping

Stocks may appear in multiple indices.  
The dashboard groups them by **symbol**.

Example:

```
HAL
  Categories: Defence Index, Nifty Midcap
  Groups: NIFTY MIDCAP 100, NIFTY DEFENCE
  Links: 2
```

---

# Signal Priority

When a stock appears with multiple signals across groups, the final signal is determined by priority:

```
Breakout
Big Sell Wick
no breakout
Red candle
No Entry
Unknown
```

This ensures the most important signal is displayed.

---

# Hosting

The website is hosted for **free** using:

```
GitHub Pages
```

Example repository structure:

```
repo/
 ├── index.html
 ├── app.js
 ├── style.css
 └── README.md
```

---

# Performance Design

Large datasets (~25MB) are supported by:

- In-memory caching
- Symbol grouping
- Pagination
- Lazy rendering

This prevents browser storage limits and keeps the UI responsive.

---

# How Data Updates

1. Python generates a new enriched JSON file
2. File is uploaded to Google Drive
3. Apps Script automatically serves the **latest file**
4. Website fetches it when:
   - page loads
   - refresh button is pressed

---

# Running the Website Locally

Open the project in **VS Code**.

Use the **Live Server** extension.

Example:

```
Right click index.html → Open with Live Server
```

---

# Refreshing Data

Click the **Refresh button** on the dashboard.

This forces the website to fetch the latest file from Apps Script.

---

# Future Improvements

Possible enhancements:

- Sector filters
- Breakout strength score
- Historical breakout tracking
- Mobile-optimized UI
- TradingView links
- Export breakout list

---

# License

Personal project. Free for educational and research use.

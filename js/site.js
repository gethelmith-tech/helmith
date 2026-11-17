(function () {
  "use strict";
  const cfg = window.HELMITH || {};
  const api = window.HelmithApi;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function when(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      timeZone: "Asia/Jakarta",
      timeZoneName: "short"
    });
  }

  /* Footer socials stay hidden while the URLs in config.js are empty. */
  function socials() {
    const box = $("#socials");
    if (!box) return;
    const links = [];
    if (cfg.x) links.push({ href: cfg.x, label: "X" });
    if (cfg.github) links.push({ href: cfg.github, label: "GitHub" });
    if (!links.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = links.map((l) =>
      `<a href="${l.href}" target="_blank" rel="noopener">${l.label}</a>`
    ).join("");
  }

  function menu() {
    const btn = $(".menu-btn");
    const menu = $("#menu");
    if (!btn || !menu) return;
    btn.addEventListener("click", () => {
      const open = menu.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute("aria-label", open ? "Close menu" : "Menu");
      document.body.classList.toggle("menu-open", open);
    });
  }

  let tickerData = null;

  function renderTicker(rows) {
    const el = $("#ticker");
    if (!el) return;
    if (!rows || !rows.length) {
      el.innerHTML = `<div class="ticker-err">Live prices could not be loaded from Lighter.</div>`;
      return;
    }
    const bits = rows.slice(0, 18).map((r) => {
      const cls = api.changeClass(r.change24h);
      return `<span class="tick"><b>${r.symbol}</b> ${api.fmtPrice(r.mark, r.priceDecimals)} <span class="${cls}">${api.fmtPct(r.change24h)}</span></span>`;
    }).join("");
    /* Duplicate the strip so the marquee can loop without a gap. */
    el.innerHTML = `<div class="track">${bits}${bits}<span class="tick"><span class="src">${api.SOURCE}</span></span><span class="tick"><span class="src">${api.SOURCE}</span></span></div>`;
  }

  async function loadTicker() {
    const el = $("#ticker");
    if (!el) return;
    try {
      tickerData = await api.markets();
      renderTicker(tickerData.rows);
    } catch (err) {
      el.innerHTML = `<div class="ticker-err">Lighter could not be reached. No prices will be invented to stand in.</div>`;
      console.warn(err);
    }
  }

  function renderHomeStrip(rows) {
    const host = $("#home-markets");
    if (!host) return;
    if (!rows || !rows.length) {
      host.innerHTML = `<p class="muted">Live markets could not be loaded from Lighter.</p>`;
      return;
    }
    const top = rows.slice(0, 6);
    host.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Market</th>
              <th class="num">Mark</th>
              <th class="num">24h</th>
              <th class="num">Volume</th>
              <th class="num">Funding</th>
            </tr>
          </thead>
          <tbody>
            ${top.map((r) => `<tr>
              <td class="sym">${r.symbol}<span>PERP</span></td>
              <td class="num">${api.fmtPrice(r.mark, r.priceDecimals)}</td>
              <td class="num ${api.changeClass(r.change24h)}">${api.fmtPct(r.change24h)}</td>
              <td class="num">${api.fmtUsd(r.volume)}</td>
              <td class="num ${api.changeClass(r.funding != null ? r.funding * 100 : null)}">${api.fundingPct(r.funding)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <p class="meta-row"><span class="src-tag">${api.SOURCE}</span><span>USDG notional. Refreshed from the public API.</span><a href="markets.html">All markets</a></p>`;
  }

  function marketsPage() {
    const host = $("#markets-table");
    const meta = $("#markets-meta");
    const search = $("#msearch");
    if (!host) return;
    let all = [];

    function paint(rows) {
      if (!rows.length) {
        host.innerHTML = `<div class="empty"><h2>No markets match.</h2><p>The live book is still on Lighter; this filter simply hid every row.</p></div>`;
        return;
      }
      host.innerHTML = `
        <p class="table-hint">Swipe the table for volume, funding and leverage.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Market</th>
                <th class="num">Mark</th>
                <th class="num">Index</th>
                <th class="num">24h</th>
                <th class="num">Volume</th>
                <th class="num">Open interest</th>
                <th class="num">Funding</th>
                <th class="num">Min size</th>
                <th class="num">Max lev.</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r) => `<tr>
                <td class="sym">${r.symbol}<span>PERP</span></td>
                <td class="num">${api.fmtPrice(r.mark, r.priceDecimals)}</td>
                <td class="num">${api.fmtPrice(r.index, r.priceDecimals)}</td>
                <td class="num ${api.changeClass(r.change24h)}">${api.fmtPct(r.change24h)}</td>
                <td class="num">${api.fmtUsd(r.volume)}</td>
                <td class="num">${api.fmtUsd(r.openInterestUsd)}</td>
                <td class="num ${api.changeClass(r.funding != null ? r.funding * 100 : null)}">${api.fundingPct(r.funding)}</td>
                <td class="num">${r.minQuote != null ? api.fmtUsd(r.minQuote) + " USDG" : "—"}</td>
                <td class="num">${r.maxLev != null ? r.maxLev + "×" : "—"}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>`;
    }

    function apply() {
      const q = (search && search.value || "").trim().toLowerCase();
      const rows = q ? all.filter((r) => r.symbol.toLowerCase().includes(q)) : all;
      paint(rows);
    }

    async function load() {
      try {
        const data = tickerData || await api.markets();
        tickerData = data;
        all = data.rows;
        apply();
        if (meta) {
          meta.innerHTML = `<span class="src-tag">${data.source}</span>
            <span>${all.length} active perpetual markets</span>
            <span>Updated ${when(data.fetchedAt)}</span>
            <span>Volume and open interest in USDG. Funding is Lighter’s own rate, as reported by the public API. Max leverage is derived from Lighter’s minimum initial margin fraction.</span>`;
        }
      } catch (err) {
        host.innerHTML = `<div class="empty err"><h2>The book could not be read.</h2><p>The public Lighter API on Robinhood Chain did not answer from this browser. No stand-in prices will be shown. ${String(err.message || err)}</p></div>`;
        if (meta) meta.innerHTML = "";
      }
    }

    if (search) search.addEventListener("input", apply);
    load();
    setInterval(load, 20000);
  }

  function shortAddr(a) {
    if (!a || a.length < 12) return a || "—";
    return a.slice(0, 6) + "…" + a.slice(-4);
  }

  function positionSide(p) {
    const sign = api.num(p.sign);
    const size = api.num(p.position);
    if (size === 0) return "flat";
    if (sign == 1 || (sign == null && size > 0)) return "long";
    if (sign == -1 || (sign == null && size < 0)) return "short";
    return sign > 0 ? "long" : "short";
  }

  function deskPage() {
    const root = $("#desk");
    if (!root) return;
    const account = cfg.account;

    if (account == null || account === "") {
      root.innerHTML = `
        <div class="empty" id="desk-empty">
          <svg class="mark" viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <circle cx="32" cy="32" r="27" stroke="currentColor" stroke-width="1.6"/>
            <circle cx="32" cy="32" r="22.5" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>
            <circle cx="32" cy="32" r="7.5" stroke="currentColor" stroke-width="1.8"/>
            <circle cx="32" cy="32" r="2.2" fill="currentColor"/>
            <g stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
              <path d="M32 9.5 V24.5"/><path d="M32 39.5 V54.5"/><path d="M9.5 32 H24.5"/><path d="M39.5 32 H54.5"/>
              <path d="M16.1 16.1 L26.6 26.6"/><path d="M37.4 37.4 L47.9 47.9"/>
              <path d="M47.9 16.1 L37.4 26.6"/><path d="M26.6 37.4 L16.1 47.9"/>
            </g>
            <g fill="currentColor">
              <circle cx="32" cy="8.2" r="2.4"/><circle cx="32" cy="55.8" r="2.4"/>
              <circle cx="8.2" cy="32" r="2.4"/><circle cx="55.8" cy="32" r="2.4"/>
              <circle cx="15.15" cy="15.15" r="2.4"/><circle cx="48.85" cy="48.85" r="2.4"/>
              <circle cx="48.85" cy="15.15" r="2.4"/><circle cx="15.15" cy="48.85" r="2.4"/>
            </g>
          </svg>
          <h2>The desk is not funded yet.</h2>
          <p>The first real position will appear here. No row will be invented to dress an empty book. When an account is set in the site config, this page will read positions and fills from Lighter’s public API.</p>
        </div>`;
      return;
    }

    async function load() {
      try {
        const [rec, trades] = await Promise.all([
          api.account(account),
          api.accountTrades(account, 50)
        ]);
        if (!rec) {
          root.innerHTML = `<div class="empty err"><h2>No such account on Lighter.</h2><p>The public API returned no desk for <code>${String(account)}</code>. The book will stay empty rather than show a stand-in.</p></div>`;
          return;
        }
        const positions = (rec.positions || []).filter((p) => api.num(p.position));
        const assets = rec.assets || [];
        const usdg = assets.find((a) => a.symbol === "USDG") || assets[0];
        root.innerHTML = `
          <div class="blotter-head">
            <div>
              <p class="crumb">Account ${rec.index}${rec.l1_address ? " · " + shortAddr(rec.l1_address) : ""}</p>
              <h2 style="font-family:var(--serif);font-size:2rem;margin:0;font-weight:550">The live book</h2>
            </div>
            <p class="meta-row"><span class="src-tag">${api.SOURCE}</span><span>Updated ${when(Date.now())}</span></p>
          </div>
          <div class="stats">
            <div class="card stat"><span>Collateral</span><b>${api.fmtUsd(rec.collateral)} USDG</b></div>
            <div class="card stat"><span>Available</span><b>${api.fmtUsd(rec.available_balance)} USDG</b></div>
            <div class="card stat"><span>Account value</span><b>${api.fmtUsd(rec.total_asset_value)} USDG</b></div>
            <div class="card stat"><span>Open positions</span><b>${positions.length}</b></div>
          </div>
          <h3 class="log-h">Positions</h3>
          ${positions.length ? `<div class="table-wrap"><table>
            <thead><tr><th>Market</th><th>Side</th><th class="num">Size</th><th class="num">Entry</th><th class="num">Unrealized</th><th class="num">Margin</th></tr></thead>
            <tbody>${positions.map((p) => {
              const side = positionSide(p);
              const pnl = api.num(p.unrealized_pnl);
              return `<tr>
                <td class="sym">${p.symbol || p.market_id}</td>
                <td class="${side === "long" ? "up" : side === "short" ? "dn" : ""}">${side}</td>
                <td class="num">${p.position}</td>
                <td class="num">${api.fmtPrice(p.avg_entry_price)}</td>
                <td class="num ${api.changeClass(pnl)}">${pnl == null ? "—" : api.fmtUsd(pnl)}</td>
                <td class="num">${p.margin_used != null ? api.fmtUsd(p.margin_used) : "—"}</td>
              </tr>`;
            }).join("")}</tbody>
          </table></div>` : `<div class="empty"><h2>No open position.</h2><p>The account is on Lighter, and the book is empty of positions at this reading.</p></div>`}
          <h3 class="log-h">Fills</h3>
          ${trades.length ? `<div class="table-wrap"><table>
            <thead><tr><th>Time</th><th>Market</th><th>Type</th><th class="num">Size</th><th class="num">Price</th><th class="num">Notional</th></tr></thead>
            <tbody>${trades.map((t) => `<tr>
              <td class="mono">${t.timestamp ? when(Number(t.timestamp)) : "—"}</td>
              <td class="sym">${t.market_symbol || t.market_id}</td>
              <td>${t.type || "trade"}</td>
              <td class="num">${t.size}</td>
              <td class="num">${api.fmtPrice(t.price)}</td>
              <td class="num">${api.fmtUsd(t.usd_amount)}</td>
            </tr>`).join("")}</tbody>
          </table></div>` : `<div class="empty"><h2>No fills yet.</h2><p>When the desk takes a real trade, the fill will be listed here from Lighter’s public trade history.</p></div>`}
        `;
      } catch (err) {
        root.innerHTML = `<div class="empty err"><h2>The blotter could not be read.</h2><p>Lighter’s public API did not answer from this browser. ${String(err.message || err)}</p></div>`;
      }
    }
    load();
    setInterval(load, 20000);
  }

  async function boot() {
    socials();
    menu();
    const page = document.body.getAttribute("data-page");
    if (page !== "trade") await loadTicker();
    if (page === "home") renderHomeStrip(tickerData && tickerData.rows);
    if (page === "markets") marketsPage();
    if (page === "desk") deskPage();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

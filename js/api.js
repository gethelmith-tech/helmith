/* Live reads from Lighter on Robinhood Chain. Public REST, no key required.
   CORS: Access-Control-Allow-Origin: * (verified). */
(function (w) {
  "use strict";
  const BASE = "https://api.rh.lighter.xyz";
  const SOURCE = "Lighter · Robinhood Chain";

  async function get(path) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 18000);
    try {
      const r = await fetch(BASE + path, {
        signal: ctrl.signal,
        headers: { accept: "application/json" }
      });
      if (!r.ok) throw new Error("Lighter API returned " + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  function num(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function fmtPrice(v, decimals) {
    const n = num(v);
    if (n == null) return "—";
    const d = decimals == null ? (Math.abs(n) >= 1000 ? 1 : Math.abs(n) >= 100 ? 2 : Math.abs(n) >= 1 ? 3 : 5) : decimals;
    return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function fmtUsd(v) {
    const n = num(v);
    if (n == null) return "—";
    const abs = Math.abs(n);
    const sign = n < 0 ? "−" : "";
    if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + "M";
    if (abs >= 1e3) return sign + (abs / 1e3).toFixed(2) + "K";
    return sign + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtPct(v, digits) {
    const n = num(v);
    if (n == null) return "—";
    const d = digits == null ? 2 : digits;
    const sign = n > 0 ? "+" : n < 0 ? "−" : "";
    return sign + Math.abs(n).toFixed(d) + "%";
  }

  /* daily_price_change from orderBookDetails is already in percent points. */
  function changeClass(v) {
    const n = num(v);
    if (n == null || n === 0) return "";
    return n > 0 ? "up" : "dn";
  }

  function maxLeverage(imf) {
    const n = num(imf);
    if (!n) return null;
    return Math.round(10000 / n);
  }

  function fundingPct(rate) {
    const n = num(rate);
    if (n == null) return "—";
    return fmtPct(n * 100, 4);
  }

  async function markets() {
    const [books, funds] = await Promise.all([
      get("/api/v1/orderBookDetails"),
      get("/api/v1/funding-rates").catch(() => null)
    ]);
    const fundMap = {};
    const rates = (funds && funds.funding_rates) || [];
    rates.forEach((r) => {
      if (r && r.exchange === "lighter" && r.symbol) fundMap[r.symbol] = num(r.rate);
    });
    const rows = (books.order_book_details || [])
      .filter((r) => r && r.status === "active" && r.market_type === "perp")
      .map((r) => {
        const mark = num(r.mark_price);
        const oi = num(r.open_interest);
        return {
          symbol: r.symbol,
          marketId: r.market_id,
          mark,
          index: num(r.index_price),
          last: num(r.last_trade_price),
          change24h: num(r.daily_price_change),
          volume: num(r.daily_quote_token_volume),
          trades: num(r.daily_trades_count),
          openInterest: oi,
          openInterestUsd: mark != null && oi != null ? mark * oi : null,
          funding: fundMap[r.symbol] != null ? fundMap[r.symbol] : null,
          minQuote: num(r.min_quote_amount),
          minBase: r.min_base_amount,
          maxLev: maxLeverage(r.min_initial_margin_fraction),
          imf: num(r.min_initial_margin_fraction),
          mmf: num(r.maintenance_margin_fraction),
          priceDecimals: r.supported_price_decimals
        };
      })
      .sort((a, b) => (b.volume || 0) - (a.volume || 0));
    return { rows, source: SOURCE, fetchedAt: Date.now() };
  }

  function accountQuery(account) {
    if (account == null || account === "") return null;
    if (typeof account === "string" && account.trim().toLowerCase().startsWith("0x")) {
      return { by: "l1_address", value: account.trim() };
    }
    const n = Number(account);
    if (Number.isFinite(n)) return { by: "index", value: String(n) };
    return { by: "index", value: String(account).trim() };
  }

  async function account(account) {
    const q = accountQuery(account);
    if (!q) return null;
    const d = await get("/api/v1/account?by=" + encodeURIComponent(q.by) + "&value=" + encodeURIComponent(q.value));
    const rec = ((d && d.accounts) || [])[0] || null;
    return rec;
  }

  async function accountTrades(account, limit) {
    const q = accountQuery(account);
    let index = q && q.by === "index" ? q.value : null;
    if (!index) {
      const rec = await account(account);
      if (!rec || rec.index == null) return [];
      index = String(rec.index);
    }
    const lim = limit || 50;
    const d = await get(
      "/api/v1/trades?sort_by=timestamp&limit=" + lim + "&account_index=" + encodeURIComponent(index)
    );
    return (d && d.trades) || [];
  }

  w.HelmithApi = {
    SOURCE,
    BASE,
    get,
    num,
    fmtPrice,
    fmtUsd,
    fmtPct,
    changeClass,
    fundingPct,
    maxLeverage,
    markets,
    account,
    accountTrades,
    accountQuery
  };
})(window);

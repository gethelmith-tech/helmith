(function () {
  "use strict";
  const nets = window.HELMITH_NETWORKS;
  const wallet = window.HelmithWallet;
  const signer = window.HelmithSigner;
  const Exchange = window.HelmithExchange;
  const KEY_INDEX = nets.apiKeyIndex;
  const STORAGE = "helmith.akey.v1";
  const NET_STORE = "helmith.trade.network";
  const UI_LEV_CAP = 10;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = {
    netId: "testnet",
    net: null,
    ex: null,
    markets: [],
    market: null,
    book: { bids: new Map(), asks: new Map() },
    tape: [],
    ws: null,
    wsTimer: null,
    address: null,
    account: null, // snapshot object
    accountIndex: null,
    apiKey: null, // { privateKey, publicKey, apiKeyIndex, accountIndex }
    auth: null,
    authExp: 0,
    side: "long",
    orderType: "market",
    signerReady: false,
    busy: false
  };

  function net() { return state.net; }

  function setMsg(el, text, kind) {
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle("err", kind === "err");
    el.classList.toggle("ok", kind === "ok");
  }

  function shortAddr(a) {
    if (!a) return "";
    return a.slice(0, 6) + "…" + a.slice(-4);
  }

  function toInt(value, decimals) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error("Enter a valid number.");
    const scale = 10 ** decimals;
    return Math.round(n * scale);
  }

  function fromInt(v, decimals) {
    return Number(v) / 10 ** decimals;
  }

  function fmt(n, d) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    const dd = d == null ? (Math.abs(x) >= 1000 ? 1 : Math.abs(x) >= 100 ? 2 : Math.abs(x) >= 1 ? 3 : 5) : d;
    return x.toLocaleString("en-US", { minimumFractionDigits: dd, maximumFractionDigits: dd });
  }

  function fmtUsd(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    return x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function storageKey(addr, netId) {
    return STORAGE + "." + netId + "." + String(addr).toLowerCase();
  }

  async function sha256Bytes(str) {
    const data = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return new Uint8Array(hash);
  }

  async function importAes(bytes) {
    return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  async function encryptKey(record, signature) {
    const raw = await sha256Bytes(signature.toLowerCase());
    const key = await importAes(raw);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const pt = new TextEncoder().encode(JSON.stringify({
      privateKey: record.privateKey,
      publicKey: record.publicKey,
      apiKeyIndex: record.apiKeyIndex,
      accountIndex: record.accountIndex
    }));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
    return {
      v: 1,
      iv: btoa(String.fromCharCode.apply(null, Array.from(iv))),
      ct: btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(ct)))),
      publicKey: record.publicKey,
      apiKeyIndex: record.apiKeyIndex,
      accountIndex: record.accountIndex
    };
  }

  async function decryptKey(stored, signature) {
    const raw = await sha256Bytes(signature.toLowerCase());
    const key = await importAes(raw);
    const iv = Uint8Array.from(atob(stored.iv), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(stored.ct), (c) => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(pt));
  }

  function wrapMessage(addr, netId) {
    return "Helmith locks your Lighter API key for " + netId + " at " + addr.toLowerCase() + " (index " + KEY_INDEX + "). This signature never leaves this browser.";
  }

  function loadStored(addr, netId) {
    try {
      const raw = localStorage.getItem(storageKey(addr, netId));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveStored(addr, netId, stored) {
    localStorage.setItem(storageKey(addr, netId), JSON.stringify(stored));
  }

  function forgetStored(addr, netId) {
    localStorage.removeItem(storageKey(addr, netId));
  }

  /* ---------- network ---------- */
  function applyNetwork(id, confirmed) {
    if (id === "mainnet" && !confirmed) {
      const ok = confirm("You are about to switch to Lighter on Robinhood Chain mainnet. Orders and deposits will use real USDG. Helmith never holds your funds. Continue?");
      if (!ok) return;
    }
    state.netId = id;
    state.net = nets.get(id);
    state.ex = new Exchange(state.net);
    state.market = null;
    state.markets = [];
    state.account = null;
    state.accountIndex = null;
    state.apiKey = null;
    state.auth = null;
    state.book = { bids: new Map(), asks: new Map() };
    state.tape = [];
    try { localStorage.setItem(NET_STORE, id); } catch (e) {}
    document.body.classList.toggle("is-mainnet", id === "mainnet");
    document.body.classList.toggle("is-testnet", id === "testnet");
    $("#btn-testnet").classList.toggle("on", id === "testnet");
    $("#btn-mainnet").classList.toggle("on", id === "mainnet");
    const banner = $("#net-banner");
    if (id === "testnet") {
      banner.innerHTML = "<p><strong>Testnet.</strong> You are on Lighter’s Robinhood Chain testnet. Books, accounts and orders are not mainnet, and testnet markets may have no liquidity. A first testnet account is created by a deposit; this interface cannot reach a public RPC for that testnet L1, so a new testnet account cannot be funded from here.</p>";
      banner.className = "trade-banner testnet";
    } else {
      banner.innerHTML = "<p><strong>Mainnet.</strong> You are on Lighter’s Robinhood Chain mainnet. Orders use real USDG perpetual markets. Trades execute on Lighter; Helmith is an interface.</p>";
      banner.className = "trade-banner mainnet";
    }
    closeWs();
    refreshMarkets();
    if (state.address) refreshAccount();
    else renderAccount();
    renderKey();
  }

  /* ---------- markets / book ---------- */
  async function refreshMarkets() {
    const host = $("#market-list");
    host.innerHTML = "<p class=\"muted\">Reading Lighter…</p>";
    try {
      const rows = await state.ex.markets();
      state.markets = rows;
      if (!rows.length) {
        host.innerHTML = "<div class=\"empty\"><h2>No active markets.</h2><p>Lighter returned no active perpetual markets on this environment.</p></div>";
        return;
      }
      if (!state.market || !rows.some((r) => r.marketId === state.market.marketId)) {
        state.market = rows[0];
      } else {
        state.market = rows.find((r) => r.marketId === state.market.marketId) || rows[0];
      }
      renderMarketList();
      updateLevUi();
      subscribeMarket();
    } catch (err) {
      host.innerHTML = "<div class=\"empty err\"><h2>Markets could not be read.</h2><p>" + escapeHtml(String(err.message || err)) + "</p></div>";
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  }

  function renderMarketList() {
    const q = ($("#msearch").value || "").trim().toLowerCase();
    const rows = q ? state.markets.filter((m) => m.symbol.toLowerCase().includes(q)) : state.markets;
    const host = $("#market-list");
    if (!rows.length) {
      host.innerHTML = "<p class=\"muted\">No markets match that filter. The live book was not invented away.</p>";
      return;
    }
    host.innerHTML = rows.map((m) => {
      const on = state.market && m.marketId === state.market.marketId ? " on" : "";
      const chg = m.change24h == null ? "" : (m.change24h > 0 ? " up" : m.change24h < 0 ? " dn" : "");
      return "<button type=\"button\" class=\"mkt" + on + "\" data-id=\"" + m.marketId + "\">" +
        "<span class=\"sym\">" + escapeHtml(m.symbol) + " <span>PERP</span></span>" +
        "<span class=\"mono\">" + fmt(m.last != null ? m.last : m.mark, m.priceDecimals) + "</span>" +
        "<span class=\"mono" + chg + "\">" + (m.change24h == null ? "—" : (m.change24h > 0 ? "+" : m.change24h < 0 ? "−" : "") + Math.abs(m.change24h).toFixed(2) + "%") + "</span>" +
        "</button>";
    }).join("");
  }

  function selectMarket(id) {
    const m = state.markets.find((x) => String(x.marketId) === String(id));
    if (!m) return;
    state.market = m;
    renderMarketList();
    updateLevUi();
    subscribeMarket();
  }

  function updateLevUi() {
    const m = state.market;
    const unlock = $("#ord-unlock-lev").checked;
    const venue = m && m.maxLev ? m.maxLev : UI_LEV_CAP;
    const max = unlock ? venue : Math.min(UI_LEV_CAP, venue);
    const slider = $("#ord-lev");
    slider.max = String(max);
    if (Number(slider.value) > max) slider.value = String(max);
    $("#ord-lev-val").textContent = slider.value + "×";
    $("#lev-note").textContent = m
      ? ("Venue cap for " + m.symbol + " is " + venue + "×, from Lighter’s minimum initial margin. That is not Helmith’s cap.")
      : "";
    $("#lev-warn").hidden = !(unlock && venue > UI_LEV_CAP);
    $("#book-title").textContent = m ? ("Order book · " + m.symbol) : "Order book";
    $("#book-src").textContent = net().source;
  }

  function closeWs() {
    if (state.wsTimer) { clearInterval(state.wsTimer); state.wsTimer = null; }
    if (state.ws) {
      try { state.ws.close(); } catch (e) {}
      state.ws = null;
    }
  }

  function applyBookLevels(map, levels, snapshot) {
    if (snapshot) map.clear();
    (levels || []).forEach((lvl) => {
      const price = String(lvl.price);
      const size = Number(lvl.size);
      if (!price) return;
      if (!Number.isFinite(size) || size === 0) map.delete(price);
      else map.set(price, String(lvl.size));
    });
  }

  function renderBook() {
    const host = $("#order-book");
    const mid = $("#book-mid");
    const asks = Array.from(state.book.asks.entries()).map(([p, s]) => [Number(p), s]).filter((x) => Number.isFinite(x[0])).sort((a, b) => a[0] - b[0]);
    const bids = Array.from(state.book.bids.entries()).map(([p, s]) => [Number(p), s]).filter((x) => Number.isFinite(x[0])).sort((a, b) => b[0] - a[0]);
    const askN = asks.slice(0, 12).reverse();
    const bidN = bids.slice(0, 12);
    const dec = state.market ? state.market.priceDecimals : undefined;
    if (!askN.length && !bidN.length) {
      host.innerHTML = "<p class=\"muted\">The public book is empty at this reading.</p>";
      mid.textContent = state.market ? ("Mark " + fmt(state.market.mark, dec)) : "—";
      return;
    }
    const bestAsk = asks[0] && asks[0][0];
    const bestBid = bids[0] && bids[0][0];
    mid.textContent = (bestBid != null && bestAsk != null)
      ? (fmt(bestBid, dec) + "  /  " + fmt(bestAsk, dec))
      : (state.market ? ("Mark " + fmt(state.market.mark, dec)) : "—");
    const row = (side, p, s) => "<div class=\"book-row " + side + "\"><span class=\"mono\">" + fmt(p, dec) + "</span><span class=\"mono\">" + s + "</span></div>";
    host.innerHTML = "<div class=\"book-side asks\">" +
      "<div class=\"book-h\"><span>Price</span><span>Size</span></div>" +
      askN.map((x) => row("ask", x[0], x[1])).join("") +
      "</div><div class=\"book-side bids\">" +
      "<div class=\"book-h\"><span>Price</span><span>Size</span></div>" +
      bidN.map((x) => row("bid", x[0], x[1])).join("") +
      "</div>";
  }

  function renderTape() {
    const host = $("#tape");
    if (!state.tape.length) {
      host.innerHTML = "<p class=\"muted\">No recent trades at this reading.</p>";
      return;
    }
    const dec = state.market ? state.market.priceDecimals : undefined;
    host.innerHTML = "<div class=\"tape\">" + state.tape.slice(0, 24).map((t) => {
      const cls = t.is_maker_ask ? "up" : "dn"; // if maker was ask, taker bought
      return "<div class=\"tape-row\"><span class=\"mono " + cls + "\">" + fmt(t.price, dec) + "</span><span class=\"mono\">" + t.size + "</span></div>";
    }).join("") + "</div>";
  }

  async function restBookFallback(marketId) {
    try {
      const book = await state.ex.orderBookOrders(marketId, 16);
      const toLevels = (orders) => {
        const acc = {};
        (orders || []).forEach((o) => {
          const price = String(o.price);
          const size = Number(o.size != null ? o.size : o.remaining_base_amount);
          if (!price || !Number.isFinite(size) || size === 0) return;
          acc[price] = (acc[price] || 0) + size;
        });
        return Object.keys(acc).map((price) => ({ price, size: String(Number(acc[price].toPrecision(10))) }));
      };
      state.book.bids = new Map();
      state.book.asks = new Map();
      applyBookLevels(state.book.bids, toLevels(book.bids), true);
      applyBookLevels(state.book.asks, toLevels(book.asks), true);
      renderBook();
    } catch (e) {
      $("#order-book").innerHTML = "<p class=\"muted\">The book could not be read. " + escapeHtml(String(e.message || e)) + "</p>";
    }
    try {
      const t = await state.ex.recentTrades(marketId, 30);
      state.tape = t.trades || [];
      renderTape();
    } catch (e) {
      $("#tape").innerHTML = "<p class=\"muted\">The tape could not be read. " + escapeHtml(String(e.message || e)) + "</p>";
    }
  }

  function subscribeMarket() {
    const m = state.market;
    if (!m) return;
    state.book = { bids: new Map(), asks: new Map() };
    state.tape = [];
    renderBook();
    renderTape();
    closeWs();
    restBookFallback(m.marketId);
    let ws;
    try {
      ws = new WebSocket(net().ws);
    } catch (err) {
      return;
    }
    state.ws = ws;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "subscribe", channel: "order_book/" + m.marketId }));
      ws.send(JSON.stringify({ type: "subscribe", channel: "trade/" + m.marketId }));
      state.wsTimer = setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" }));
      }, 30000);
    });
    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      const type = msg.type || "";
      if (type === "pong" || type === "connected" || type === "ping") return;
      if (type === "subscribed/order_book" || type === "update/order_book") {
        const ob = msg.order_book || {};
        const snap = type === "subscribed/order_book";
        applyBookLevels(state.book.bids, ob.bids, snap);
        applyBookLevels(state.book.asks, ob.asks, snap);
        renderBook();
      }
      if (type === "subscribed/trade" || type === "update/trade") {
        const incoming = (msg.trades || []).slice().reverse();
        if (type === "subscribed/trade") state.tape = incoming;
        else state.tape = incoming.concat(state.tape).slice(0, 40);
        renderTape();
      }
    });
    ws.addEventListener("close", () => {
      if (state.ws === ws) state.ws = null;
    });
  }

  /* ---------- account ---------- */
  async function refreshAccount() {
    renderAccount();
    if (!state.address) return;
    try {
      const by = await state.ex.accountsByL1(state.address);
      if (by.code === 21100) {
        state.account = null;
        state.accountIndex = null;
        renderAccount();
        renderKey();
        return;
      }
      if (by.code && by.code !== 200) throw new Error(by.message || ("Account lookup " + by.code));
      const subs = by.sub_accounts || [];
      const master = subs.find((a) => a.account_type === 0) || subs[0];
      if (!master) {
        state.account = null;
        state.accountIndex = null;
        renderAccount();
        return;
      }
      state.accountIndex = master.index;
      const snap = await state.ex.account(master.index);
      state.account = (snap.accounts && snap.accounts[0]) || null;
      renderAccount();
      await maybeAttachKey();
      await refreshPrivate();
    } catch (err) {
      $("#account-body").innerHTML = "<div class=\"empty err\"><h2>The account could not be read.</h2><p>" + escapeHtml(String(err.message || err)) + "</p></div>";
    }
  }

  function renderAccount() {
    const body = $("#account-body");
    const funds = $("#funds-panel");
    const meta = $("#account-meta");
    if (!state.address) {
      meta.textContent = "";
      body.innerHTML = "<p class=\"muted\">Connect a wallet to read a real Lighter account for that address. Until one exists, this stays empty.</p>";
      funds.hidden = true;
      $("#positions").innerHTML = "<p class=\"muted\">No wallet connected.</p>";
      $("#orders").innerHTML = "<p class=\"muted\">No wallet connected.</p>";
      $("#fills").innerHTML = "<p class=\"muted\">No wallet connected.</p>";
      updateTicketEnabled();
      return;
    }
    if (!state.account) {
      meta.textContent = shortAddr(state.address);
      body.innerHTML = "<div class=\"empty\"><h2>No Lighter account yet.</h2><p>There is no account for this address on " + escapeHtml(net().label) + ". Lighter creates one on the first credited deposit of at least 1 USDG. Nothing will be invented to stand in for an account.</p></div>";
      renderFunds();
      funds.hidden = false;
      $("#positions").innerHTML = "<p class=\"muted\">No account on this environment.</p>";
      $("#orders").innerHTML = "<p class=\"muted\">No account on this environment.</p>";
      $("#fills").innerHTML = "<p class=\"muted\">No account on this environment.</p>";
      updateTicketEnabled();
      return;
    }
    const a = state.account;
    meta.textContent = shortAddr(a.l1_address || state.address) + " · index " + a.index;
    body.innerHTML = "<div class=\"stats\">" +
      "<div class=\"stat\"><span>Collateral</span><b>" + fmtUsd(a.collateral) + " USDG</b></div>" +
      "<div class=\"stat\"><span>Available</span><b>" + fmtUsd(a.available_balance) + " USDG</b></div>" +
      "<div class=\"stat\"><span>Asset value</span><b>" + fmtUsd(a.total_asset_value) + "</b></div>" +
      "<div class=\"stat\"><span>Cross MMR</span><b>" + fmtUsd(a.cross_maintenance_margin_requirement) + "</b></div>" +
      "</div>";
    renderFunds();
    funds.hidden = false;
    renderPositions(a.positions || []);
    updateTicketEnabled();
  }

  function renderFunds() {
    const host = $("#funds-body");
    const n = net();
    if (n.canDeposit) {
      host.innerHTML =
        "<p>Deposits use the official Lighter contract on Robinhood Chain (4663). Helmith never holds the tokens. Minimum 1 USDG, to the perps route, asset index " + n.usdgAssetId + ".</p>" +
        "<label class=\"field\">Amount (USDG)<input id=\"dep-amt\" inputmode=\"decimal\" placeholder=\"10\" autocomplete=\"off\"></label>" +
        "<div class=\"ctas\">" +
        "<button type=\"button\" class=\"btn primary\" id=\"btn-deposit\">Approve and deposit</button>" +
        "<button type=\"button\" class=\"btn\" id=\"btn-intent\">Get a deposit address</button>" +
        "</div>" +
        "<p class=\"muted\" id=\"intent-out\"></p>" +
        "<label class=\"field\">Withdraw (USDG, back to your wallet)<input id=\"wd-amt\" inputmode=\"decimal\" placeholder=\"1\" autocomplete=\"off\"></label>" +
        "<button type=\"button\" class=\"btn\" id=\"btn-withdraw\">Request a secure withdrawal</button>" +
        "<p class=\"ticket-msg\" id=\"funds-msg\" hidden></p>" +
        "<p class=\"field-note\">Contract " + n.contract + " · USDG " + n.usdg + "</p>";
    } else {
      host.innerHTML =
        "<p>Direct deposits are not offered on testnet from this interface. Lighter’s testnet <code>layer1BasicInfo</code> lists contract " + n.contract + " and USDG " + n.usdg + " on L1 chain 123456, and no public RPC for that chain is documented. Official Robinhood Chain Testnet (46630) does not carry that bytecode. Intent addresses are also not available on the testnet API. If you already have a testnet account, you can still register a key and trade.</p>" +
        "<label class=\"field\">Withdraw (USDG, if this account already has collateral)<input id=\"wd-amt\" inputmode=\"decimal\" placeholder=\"1\" autocomplete=\"off\"></label>" +
        "<button type=\"button\" class=\"btn\" id=\"btn-withdraw\">Request a secure withdrawal</button>" +
        "<p class=\"ticket-msg\" id=\"funds-msg\" hidden></p>";
    }
  }

  function positionRows(positions) {
    const open = (positions || []).filter((p) => Number(p.position) !== 0);
    if (!open.length) return "<div class=\"empty\"><h2>No open position.</h2><p>The book is empty of positions at this reading.</p></div>";
    return "<div class=\"table-wrap\"><table><thead><tr>" +
      "<th>Market</th><th>Side</th><th class=\"num\">Size</th><th class=\"num\">Entry</th><th class=\"num\">Value</th>" +
      "<th class=\"num\">Unrealized</th><th class=\"num\">Liq. price</th><th></th></tr></thead><tbody>" +
      open.map((p) => {
        const long = Number(p.sign) >= 0;
        const liq = p.liquidation_price && Number(p.liquidation_price) !== 0 ? p.liquidation_price : "—";
        return "<tr>" +
          "<td class=\"sym\">" + escapeHtml(p.symbol) + "</td>" +
          "<td class=\"" + (long ? "up" : "dn") + "\">" + (long ? "Long" : "Short") + "</td>" +
          "<td class=\"num\">" + p.position + "</td>" +
          "<td class=\"num\">" + p.avg_entry_price + "</td>" +
          "<td class=\"num\">" + fmtUsd(p.position_value) + "</td>" +
          "<td class=\"num " + (Number(p.unrealized_pnl) >= 0 ? "up" : "dn") + "\">" + fmtUsd(p.unrealized_pnl) + "</td>" +
          "<td class=\"num\">" + liq + "</td>" +
          "<td><button type=\"button\" class=\"btn\" data-close=\"" + p.market_id + "\">Close</button></td>" +
          "</tr>";
      }).join("") + "</tbody></table></div>";
  }

  function renderPositions(positions) {
    $("#positions").innerHTML = positionRows(positions);
  }

  function renderOrders(orders) {
    const host = $("#orders");
    const btn = $("#btn-cancel-all");
    const list = orders || [];
    btn.hidden = !list.length || !state.apiKey;
    if (!list.length) {
      host.innerHTML = "<div class=\"empty\"><h2>No open orders.</h2><p>When an order rests on Lighter, it will be listed here.</p></div>";
      return;
    }
    host.innerHTML = "<div class=\"table-wrap\"><table><thead><tr><th>Market</th><th>Side</th><th>Type</th><th class=\"num\">Size</th><th class=\"num\">Price</th><th class=\"num\">Trigger</th><th></th></tr></thead><tbody>" +
      list.map((o) => {
        const id = o.order_index != null ? o.order_index : o.order_id;
        const mid = o.market_id;
        const isAsk = o.is_ask === true || o.is_ask === 1 || o.side === "sell" || o.side === "ask";
        return "<tr>" +
          "<td class=\"sym\">" + escapeHtml(o.symbol || o.market_id) + "</td>" +
          "<td class=\"" + (isAsk ? "dn" : "up") + "\">" + (isAsk ? "Sell" : "Buy") + "</td>" +
          "<td>" + escapeHtml(String(o.type != null ? o.type : o.order_type || "—")) + "</td>" +
          "<td class=\"num\">" + (o.remaining_base_amount || o.initial_base_amount || o.size || "—") + "</td>" +
          "<td class=\"num\">" + (o.price || "—") + "</td>" +
          "<td class=\"num\">" + (o.trigger_price || "—") + "</td>" +
          "<td><button type=\"button\" class=\"btn\" data-cancel=\"" + mid + ":" + id + "\">Cancel</button></td>" +
          "</tr>";
      }).join("") + "</tbody></table></div>";
  }

  function renderFills(trades) {
    const host = $("#fills");
    const list = trades || [];
    if (!list.length) {
      host.innerHTML = "<div class=\"empty\"><h2>No fills yet.</h2><p>When this account trades, the fill will be listed from Lighter’s public history.</p></div>";
      return;
    }
    host.innerHTML = "<div class=\"table-wrap\"><table><thead><tr><th>Time</th><th>Market</th><th class=\"num\">Size</th><th class=\"num\">Price</th><th class=\"num\">Notional</th></tr></thead><tbody>" +
      list.map((t) => {
        const ts = t.timestamp ? new Date(Number(t.timestamp)).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", timeZoneName: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
        return "<tr><td class=\"mono\">" + ts + "</td><td class=\"sym\">" + escapeHtml(String(t.market_symbol || t.market_id)) + "</td>" +
          "<td class=\"num\">" + t.size + "</td><td class=\"num\">" + t.price + "</td><td class=\"num\">" + fmtUsd(t.usd_amount) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  async function getAuth() {
    if (!state.apiKey) return null;
    const now = Math.floor(Date.now() / 1000);
    if (state.auth && state.authExp - 60 > now) return state.auth;
    signer.createClient(state.apiKey.privateKey, net().signChainId, KEY_INDEX, state.accountIndex);
    const { authToken } = signer.createAuthToken(now + 6 * 3600, KEY_INDEX, state.accountIndex);
    state.auth = authToken;
    state.authExp = now + 6 * 3600;
    return state.auth;
  }

  async function refreshPrivate() {
    if (!state.accountIndex) return;
    try {
      const t = await state.ex.trades(state.accountIndex, 50);
      renderFills(t.trades || []);
    } catch (e) {
      $("#fills").innerHTML = "<p class=\"muted\">Fills could not be read. " + escapeHtml(String(e.message || e)) + "</p>";
    }
    if (!state.apiKey) {
      renderOrders([]);
      return;
    }
    try {
      const auth = await getAuth();
      const r = await state.ex.activeOrders(state.accountIndex, 255, auth);
      const orders = r.orders || r.account_orders || r.data || [];
      renderOrders(Array.isArray(orders) ? orders : []);
    } catch (e) {
      $("#orders").innerHTML = "<p class=\"muted\">Open orders need a registered API key. " + escapeHtml(String(e.message || e)) + "</p>";
    }
  }

  /* ---------- keys ---------- */
  function renderKey() {
    const st = $("#key-status");
    const unlock = $("#btn-unlock");
    const reg = $("#btn-register");
    const forget = $("#btn-forget");
    const stored = state.address ? loadStored(state.address, state.netId) : null;
    if (!state.address) {
      st.textContent = "Connect a wallet first.";
      unlock.hidden = true; reg.hidden = true; forget.hidden = true;
      return;
    }
    if (!state.accountIndex) {
      st.textContent = "An account is required before a key can be registered. Deposit first, then return here.";
      unlock.hidden = true; reg.hidden = true; forget.hidden = !stored;
      return;
    }
    if (state.apiKey) {
      st.textContent = "A key is unlocked in memory for index " + state.apiKey.apiKeyIndex + " (public " + String(state.apiKey.publicKey).slice(0, 10) + "…). It will be forgotten when you close this tab, unless you leave the encrypted copy in localStorage.";
      unlock.hidden = true; reg.hidden = false; forget.hidden = !stored;
      reg.textContent = "Replace and register a new key";
      return;
    }
    if (stored) {
      st.textContent = "An encrypted key for this address and network is on this device. Unlock it with a wallet signature, or register a new one at index " + KEY_INDEX + " (that replaces the previous key at that index).";
      unlock.hidden = false; reg.hidden = false; forget.hidden = false;
      reg.textContent = "Generate and register a new key";
    } else {
      st.textContent = "No key on this device yet. Generate one here, then sign once with your wallet to register it on Lighter.";
      unlock.hidden = true; reg.hidden = false; forget.hidden = true;
      reg.textContent = "Generate and register a key";
    }
  }

  async function maybeAttachKey() {
    renderKey();
  }

  async function unlockKey() {
    const stored = loadStored(state.address, state.netId);
    if (!stored) throw new Error("No encrypted key on this device.");
    const sig = await wallet.personalSign(state.address, wrapMessage(state.address, state.netId));
    const rec = await decryptKey(stored, sig);
    if (Number(rec.accountIndex) !== Number(state.accountIndex)) {
      rec.accountIndex = state.accountIndex;
    }
    signer.createClient(rec.privateKey, net().signChainId, rec.apiKeyIndex, rec.accountIndex);
    state.apiKey = rec;
    state.auth = null;
    renderKey();
    updateTicketEnabled();
    await refreshPrivate();
  }

  async function waitForApiKey(accountIndex, apiKeyIndex, publicKey, timeoutMs) {
    const want = String(publicKey).replace(/^0x/, "").toLowerCase();
    const deadline = Date.now() + (timeoutMs || 30000);
    while (Date.now() < deadline) {
      const r = await state.ex.apiKeys(accountIndex, apiKeyIndex);
      const got = r.api_keys && r.api_keys[0] && r.api_keys[0].public_key;
      if (got && String(got).replace(/^0x/, "").toLowerCase() === want) return;
      await new Promise((res) => setTimeout(res, 1000));
    }
    throw new Error("The key was submitted, but Lighter has not listed it yet. Check again in a moment.");
  }

  async function registerKey() {
    if (!state.accountIndex) throw new Error("No Lighter account to attach a key to.");
    if (!state.signerReady) throw new Error("The signer is still loading.");
    const { privateKey, publicKey } = signer.generateApiKey();
    signer.createClient(privateKey, net().signChainId, KEY_INDEX, state.accountIndex);
    const nonce = await state.ex.nextNonce(state.accountIndex, KEY_INDEX);
    const tx = signer.signChangePubKey(publicKey, 0, nonce, KEY_INDEX, state.accountIndex);
    if (!tx.messageToSign) throw new Error("The signer did not return a message for the wallet to sign.");
    const l1Sig = await wallet.personalSign(state.address, tx.messageToSign);
    const txInfo = JSON.parse(tx.txInfo);
    txInfo.L1Sig = l1Sig;
    const res = await state.ex.sendTx({ txType: tx.txType, txInfo: JSON.stringify(txInfo) });
    await waitForApiKey(state.accountIndex, KEY_INDEX, publicKey);
    const rec = { privateKey, publicKey, apiKeyIndex: KEY_INDEX, accountIndex: state.accountIndex };
    const wrapSig = await wallet.personalSign(state.address, wrapMessage(state.address, state.netId));
    const stored = await encryptKey(rec, wrapSig);
    saveStored(state.address, state.netId, stored);
    state.apiKey = rec;
    state.auth = null;
    return res;
  }

  /* ---------- orders ---------- */
  function bestPrices() {
    const asks = Array.from(state.book.asks.keys()).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const bids = Array.from(state.book.bids.keys()).map(Number).filter(Number.isFinite).sort((a, b) => b - a);
    return {
      ask: asks[0] != null ? asks[0] : (state.market && state.market.mark),
      bid: bids[0] != null ? bids[0] : (state.market && state.market.mark)
    };
  }

  let clientSeq = 0;
  function nextClientId() {
    clientSeq = (clientSeq + 1) % 1000;
    return (Date.now() % 2 ** 35) * 1000 + clientSeq;
  }

  async function nextNonce() {
    return state.ex.nextNonce(state.accountIndex, KEY_INDEX);
  }

  async function submitOrder() {
    if (!state.apiKey || !state.market || !state.accountIndex) throw new Error("Connect a wallet, open an account and unlock a key first.");
    const m = state.market;
    const usd = Number($("#ord-size").value);
    if (!Number.isFinite(usd) || usd <= 0) throw new Error("Enter a size in USDG.");
    const pxRef = state.orderType === "limit" ? Number($("#ord-price").value) : (state.side === "long" ? bestPrices().ask : bestPrices().bid);
    if (!Number.isFinite(pxRef) || pxRef <= 0) throw new Error("No price is available yet. Wait for the book, or enter a limit price.");
    const base = usd / pxRef;
    if (m.minBase && base < m.minBase) throw new Error("Size is below this market’s minimum of " + m.minBase + " " + m.symbol + ".");
    if (m.minQuote && usd < m.minQuote) throw new Error("Notional is below this market’s minimum of " + m.minQuote + " USDG.");
    const baseAmount = toInt(base, m.sizeDecimals);
    if (baseAmount <= 0) throw new Error("Size rounds to zero at this market’s size decimals.");
    const slip = Number($("#ord-slip").value);
    const slipPct = Number.isFinite(slip) && slip >= 0 ? slip / 100 : 0.01;
    let price;
    if (state.orderType === "limit") {
      price = toInt(pxRef, m.priceDecimals);
    } else if (state.side === "long") {
      price = toInt(pxRef * (1 + slipPct), m.priceDecimals);
    } else {
      price = toInt(pxRef * (1 - slipPct), m.priceDecimals);
      if (price <= 0) throw new Error("Slippage would make the worst price zero.");
    }
    const isAsk = state.side === "short" ? 1 : 0;
    const reduceOnly = $("#ord-reduce").checked ? 1 : 0;
    const typ = state.orderType === "limit" ? 0 : 1;
    const tif = typ === 1 ? 0 : 1;
    const expiry = typ === 1 ? 0 : Date.now() + 28 * 24 * 3600e3;
    const lev = Number($("#ord-lev").value);
    const venue = m.maxLev || UI_LEV_CAP;
    if (lev < 1 || lev > venue) throw new Error("Leverage must be between 1× and the venue cap of " + venue + "×.");
    const fraction = Math.round(10000 / lev);
    const tp = Number($("#ord-tp").value);
    const sl = Number($("#ord-sl").value);
    const hasTp = Number.isFinite(tp) && tp > 0;
    const hasSl = Number.isFinite(sl) && sl > 0;

    signer.createClient(state.apiKey.privateKey, net().signChainId, KEY_INDEX, state.accountIndex);

    // Set leverage first (cross margin).
    const levTx = signer.signUpdateLeverage(m.marketId, fraction, 0, 0, await nextNonce(), KEY_INDEX, state.accountIndex);
    await state.ex.sendTx(levTx);

    const mkOrder = (cid, amount, pr, ask, type, timeInForce, reduce, trigger, exp) => ({
      MarketIndex: m.marketId,
      ClientOrderIndex: cid,
      BaseAmount: amount,
      Price: pr,
      IsAsk: ask,
      Type: type,
      TimeInForce: timeInForce,
      ReduceOnly: reduce,
      TriggerPrice: trigger,
      OrderExpiry: exp
    });

    const entryId = nextClientId();
    const entryPriceForTrig = typ === 1 ? price : toInt(pxRef, m.priceDecimals);
    if (hasTp || hasSl) {
      const orders = [mkOrder(entryId, baseAmount, price, isAsk, typ, tif, reduceOnly, 0, expiry)];
      // TP/SL are the opposite side, reduce-only, market-style once triggered.
      const exitAsk = isAsk ? 0 : 1;
      if (hasTp) {
        const trig = toInt(tp, m.priceDecimals);
        const worst = exitAsk ? toInt(tp * (1 - slipPct), m.priceDecimals) : toInt(tp * (1 + slipPct), m.priceDecimals);
        orders.push(mkOrder(nextClientId(), baseAmount, Math.max(1, worst), exitAsk, 4, 0, 1, trig, Date.now() + 28 * 24 * 3600e3));
      }
      if (hasSl) {
        const trig = toInt(sl, m.priceDecimals);
        const worst = exitAsk ? toInt(sl * (1 - slipPct), m.priceDecimals) : toInt(sl * (1 + slipPct), m.priceDecimals);
        orders.push(mkOrder(nextClientId(), baseAmount, Math.max(1, worst), exitAsk, 2, 0, 1, trig, Date.now() + 28 * 24 * 3600e3));
      }
      const grouping = hasTp && hasSl ? 3 : 1; // OTOCO or OTO
      const tx = signer.signCreateGroupedOrders(grouping, orders, 0, 0, 0, 0, 0, 0, await nextNonce(), KEY_INDEX, state.accountIndex);
      return state.ex.sendTx(tx);
    }

    const tx = signer.signCreateOrder(
      m.marketId, entryId, baseAmount, price, isAsk, typ, tif, reduceOnly, 0, expiry,
      0, 0, 0, 0, 0, 0, await nextNonce(), KEY_INDEX, state.accountIndex
    );
    return state.ex.sendTx(tx);
  }

  async function closePosition(marketId) {
    const p = (state.account && state.account.positions || []).find((x) => String(x.market_id) === String(marketId));
    if (!p || Number(p.position) === 0) throw new Error("No open position on that market.");
    const m = state.markets.find((x) => String(x.marketId) === String(marketId)) || state.market;
    if (!m) throw new Error("Market details are missing.");
    const long = Number(p.sign) >= 0;
    const isAsk = long ? 1 : 0;
    const px = long ? bestPrices().bid : bestPrices().ask;
    if (!px) throw new Error("No price is available to close against.");
    const slip = Number($("#ord-slip").value);
    const slipPct = Number.isFinite(slip) && slip >= 0 ? slip / 100 : 0.01;
    const price = Math.max(1, toInt(px * (long ? (1 - slipPct) : (1 + slipPct)), m.priceDecimals));
    const baseAmount = toInt(Math.abs(Number(p.position)), m.sizeDecimals);
    signer.createClient(state.apiKey.privateKey, net().signChainId, KEY_INDEX, state.accountIndex);
    const tx = signer.signCreateOrder(
      m.marketId, nextClientId(), baseAmount, price, isAsk, 1, 0, 1, 0, 0,
      0, 0, 0, 0, 0, 0, await nextNonce(), KEY_INDEX, state.accountIndex
    );
    return state.ex.sendTx(tx);
  }

  async function cancelOrder(marketId, orderIndex) {
    signer.createClient(state.apiKey.privateKey, net().signChainId, KEY_INDEX, state.accountIndex);
    const tx = signer.signCancelOrder(Number(marketId), Number(orderIndex), 0, await nextNonce(), KEY_INDEX, state.accountIndex);
    return state.ex.sendTx(tx);
  }

  async function cancelAll() {
    signer.createClient(state.apiKey.privateKey, net().signChainId, KEY_INDEX, state.accountIndex);
    const tx = signer.signCancelAllOrders(0, 0, 255, 0, await nextNonce(), KEY_INDEX, state.accountIndex);
    return state.ex.sendTx(tx);
  }

  async function doDeposit() {
    if (!net().canDeposit) throw new Error("On-chain deposits are not offered on this environment.");
    const amt = Number($("#dep-amt").value);
    if (!Number.isFinite(amt) || amt < 1) throw new Error("Deposit at least 1 USDG.");
    const amount = BigInt(Math.round(amt * 10 ** net().usdgDecimals));
    await wallet.ensureChain(net());
    const allow = await wallet.tokenAllowance(net().usdg, state.address, net().contract);
    if (allow < amount) {
      await wallet.approve(state.address, net().usdg, net().contract, amount);
    }
    return wallet.deposit(state.address, net().contract, state.address, net().usdgAssetId, 0, amount);
  }

  async function doIntent() {
    const r = await state.ex.createIntentAddress(state.address);
    if (r.code && r.code !== 200) throw new Error(r.message || ("Intent " + r.code));
    const addr = r.intent_address;
    if (!addr) throw new Error("Lighter did not return an intent address.");
    return addr;
  }

  async function doWithdraw() {
    if (!state.apiKey) throw new Error("Unlock or register a key first. Secure withdrawals are signed with that key.");
    const amt = Number($("#wd-amt").value);
    if (!Number.isFinite(amt) || amt < 1) throw new Error("Withdraw at least 1 USDG.");
    const amount = toInt(amt, net().usdgDecimals);
    signer.createClient(state.apiKey.privateKey, net().signChainId, KEY_INDEX, state.accountIndex);
    const tx = signer.signWithdraw(net().usdgAssetId, 0, amount, 0, await nextNonce(), KEY_INDEX, state.accountIndex);
    return state.ex.sendTx(tx);
  }

  function updateTicketEnabled() {
    const btn = $("#btn-submit");
    const hint = $("#ticket-hint");
    if (!state.address) {
      btn.disabled = true; btn.textContent = "Connect to trade";
      hint.textContent = "Connect a wallet to place a real order on Lighter. No rehearsal fills will be shown.";
      return;
    }
    if (!state.accountIndex) {
      btn.disabled = true; btn.textContent = "Deposit to open an account";
      hint.textContent = "Lighter has no account for this address on this environment yet.";
      return;
    }
    if (!state.apiKey) {
      btn.disabled = true; btn.textContent = "Register a key to trade";
      hint.textContent = "Generate and register an API key (one wallet signature) before orders can be signed.";
      return;
    }
    btn.disabled = false;
    btn.textContent = (state.side === "long" ? "Long " : "Short ") + (state.market ? state.market.symbol : "");
    hint.textContent = "This order will be signed in this browser and sent to Lighter. Helmith does not hold the key.";
  }

  /* ---------- wallet ---------- */
  function setWalletLabel() {
    const el = $("#wallet-label");
    const btn = $("#btn-connect");
    if (state.address) {
      el.textContent = shortAddr(state.address);
      btn.textContent = "Disconnect";
    } else {
      el.textContent = "No wallet connected";
      btn.textContent = "Connect wallet";
    }
  }

  async function onConnect() {
    if (state.address) {
      state.address = null;
      state.account = null;
      state.accountIndex = null;
      state.apiKey = null;
      state.auth = null;
      setWalletLabel();
      renderAccount();
      renderKey();
      return;
    }
    const addr = await wallet.connect();
    state.address = addr;
    setWalletLabel();
    await refreshAccount();
  }

  /* ---------- events ---------- */
  function bind() {
    $("#btn-testnet").addEventListener("click", () => applyNetwork("testnet", true));
    $("#btn-mainnet").addEventListener("click", () => applyNetwork("mainnet", false));
    $("#btn-connect").addEventListener("click", () => run("connect", onConnect, $("#ticket-msg")));
    $("#msearch").addEventListener("input", renderMarketList);
    $("#market-list").addEventListener("click", (e) => {
      const b = e.target.closest("[data-id]");
      if (b) selectMarket(b.getAttribute("data-id"));
    });
    $$(".side-btn").forEach((b) => b.addEventListener("click", () => {
      state.side = b.getAttribute("data-side");
      $$(".side-btn").forEach((x) => x.classList.toggle("on", x === b));
      updateTicketEnabled();
    }));
    $$(".seg-btn").forEach((b) => b.addEventListener("click", () => {
      state.orderType = b.getAttribute("data-type");
      $$(".seg-btn").forEach((x) => x.classList.toggle("on", x === b));
      $("#price-field").hidden = state.orderType !== "limit";
    }));
    $("#ord-lev").addEventListener("input", updateLevUi);
    $("#ord-unlock-lev").addEventListener("change", updateLevUi);
    $("#btn-submit").addEventListener("click", () => run("order", async () => {
      const res = await submitOrder();
      setMsg($("#ticket-msg"), "Accepted by Lighter" + (res.tx_hash ? " (" + res.tx_hash.slice(0, 12) + "…)" : "") + ". Execution is confirmed on the blotter, not by this receipt alone.", "ok");
      await refreshAccount();
    }, $("#ticket-msg")));
    $("#positions").addEventListener("click", (e) => {
      const b = e.target.closest("[data-close]");
      if (!b) return;
      run("close", async () => {
        await closePosition(b.getAttribute("data-close"));
        await refreshAccount();
      }, $("#ticket-msg"));
    });
    $("#orders").addEventListener("click", (e) => {
      const b = e.target.closest("[data-cancel]");
      if (!b) return;
      const [mid, oid] = b.getAttribute("data-cancel").split(":");
      run("cancel", async () => {
        await cancelOrder(mid, oid);
        await refreshPrivate();
      }, $("#ticket-msg"));
    });
    $("#btn-cancel-all").addEventListener("click", () => run("cancel-all", async () => {
      await cancelAll();
      await refreshPrivate();
    }, $("#ticket-msg")));
    $("#btn-unlock").addEventListener("click", () => run("unlock", async () => {
      await unlockKey();
      setMsg($("#key-msg"), "Key unlocked in this session.", "ok");
    }, $("#key-msg")));
    $("#btn-register").addEventListener("click", () => run("register", async () => {
      await registerKey();
      setMsg($("#key-msg"), "Key registered on Lighter and encrypted in this browser.", "ok");
      renderKey();
      updateTicketEnabled();
      await refreshPrivate();
    }, $("#key-msg")));
    $("#btn-forget").addEventListener("click", () => {
      if (!state.address) return;
      if (!confirm("Remove the encrypted key from this browser? The key on Lighter is unchanged; you can register a new one at the same index.")) return;
      forgetStored(state.address, state.netId);
      state.apiKey = null;
      state.auth = null;
      renderKey();
      updateTicketEnabled();
    });
    document.addEventListener("click", (e) => {
      if (e.target.id === "btn-deposit") {
        run("deposit", async () => {
          const hash = await doDeposit();
          setMsg($("#funds-msg"), "Deposit submitted: " + hash + ". Lighter will credit the account after it confirms.", "ok");
        }, $("#funds-msg"));
      }
      if (e.target.id === "btn-intent") {
        run("intent", async () => {
          const addr = await doIntent();
          $("#intent-out").textContent = "Send USDG on Robinhood Chain to " + addr + ". This address is issued by Lighter and is tied to your wallet. Minimum 1 USDG.";
        }, $("#funds-msg"));
      }
      if (e.target.id === "btn-withdraw") {
        run("withdraw", async () => {
          const res = await doWithdraw();
          setMsg($("#funds-msg"), "Withdrawal accepted by Lighter" + (res.tx_hash ? " (" + res.tx_hash + ")" : "") + ". Secure withdrawals return USDG to the same L1 address.", "ok");
        }, $("#funds-msg"));
      }
    });
    wallet.on("accountsChanged", (accs) => {
      state.address = accs && accs[0] ? accs[0] : null;
      state.apiKey = null;
      state.auth = null;
      setWalletLabel();
      refreshAccount();
    });
  }

  async function run(label, fn, msgEl) {
    if (state.busy) return;
    state.busy = true;
    setMsg(msgEl, "Working…");
    try {
      await fn();
    } catch (err) {
      setMsg(msgEl, String(err.message || err), "err");
    } finally {
      state.busy = false;
    }
  }

  async function boot() {
    bind();
    let start = "testnet";
    try {
      const saved = localStorage.getItem(NET_STORE);
      if (saved === "testnet") start = "testnet";
      // Do not auto-restore mainnet; always start on testnet unless the user toggles.
    } catch (e) {}
    applyNetwork(start, true);
    try {
      const accs = await wallet.accounts();
      if (accs && accs[0]) {
        state.address = accs[0];
        setWalletLabel();
        await refreshAccount();
      }
    } catch (e) {}
    try {
      $("#signer-status").textContent = "Loading the Lighter signer…";
      await signer.load();
      state.signerReady = true;
      $("#signer-status").textContent = "Signer ready · API key index " + KEY_INDEX;
    } catch (err) {
      state.signerReady = false;
      $("#signer-status").textContent = "Signer failed to load: " + (err.message || err);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

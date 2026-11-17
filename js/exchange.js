/* REST + WebSocket against one Lighter RH environment. No invented rows. */
(function (w) {
  "use strict";

  function num(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function Exchange(net) {
    this.net = net;
  }

  Exchange.prototype.get = async function (path, headers) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch(this.net.rest + path, {
        signal: ctrl.signal,
        headers: Object.assign({ accept: "application/json" }, headers || {})
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok && body.code == null) throw new Error("Lighter returned " + r.status);
      return body;
    } finally {
      clearTimeout(t);
    }
  };

  Exchange.prototype.sendTx = async function (tx) {
    const r = await fetch(this.net.rest + "/api/v1/sendTx", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ tx_type: String(tx.txType), tx_info: tx.txInfo })
    });
    const body = await r.json().catch(() => ({}));
    if (body.code !== 200) {
      throw new Error("sendTx " + (body.code || r.status) + ": " + (body.message || "rejected"));
    }
    return body;
  };

  Exchange.prototype.form = async function (path, fields) {
    const r = await fetch(this.net.rest + path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields)
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok && body.code == null) throw new Error("Lighter returned " + r.status);
    return body;
  };

  Exchange.prototype.markets = async function () {
    const [books, funds] = await Promise.all([
      this.get("/api/v1/orderBookDetails"),
      this.get("/api/v1/funding-rates").catch(() => null)
    ]);
    const fundMap = {};
    const rates = (funds && funds.funding_rates) || [];
    rates.forEach((row) => {
      if (row.exchange && String(row.exchange).toLowerCase() !== "lighter") return;
      const id = row.market_id;
      if (id != null) fundMap[id] = num(row.rate != null ? row.rate : row.funding_rate);
    });
    const rows = (books.order_book_details || []).filter((m) => m.status === "active" && m.market_type !== "spot");
    return rows.map((m) => {
      const imf = num(m.min_initial_margin_fraction);
      return {
        symbol: m.symbol,
        marketId: m.market_id,
        status: m.status,
        mark: num(m.mark_price),
        index: num(m.index_price),
        last: num(m.last_trade_price),
        change24h: num(m.daily_price_change),
        volume: num(m.daily_quote_token_volume),
        openInterest: m.open_interest,
        minQuote: num(m.min_quote_amount),
        minBase: num(m.min_base_amount),
        priceDecimals: m.price_decimals,
        sizeDecimals: m.size_decimals,
        minImf: imf,
        maxLev: imf ? Math.round(10000 / imf) : null,
        funding: fundMap[m.market_id] != null ? fundMap[m.market_id] : null,
        raw: m
      };
    }).sort((a, b) => (b.volume || 0) - (a.volume || 0));
  };

  Exchange.prototype.accountsByL1 = async function (address) {
    return this.get("/api/v1/accountsByL1Address?l1_address=" + encodeURIComponent(address));
  };

  Exchange.prototype.account = async function (indexOrAddress) {
    const s = String(indexOrAddress);
    if (s.startsWith("0x")) return this.get("/api/v1/account?by=l1_address&value=" + encodeURIComponent(s));
    return this.get("/api/v1/account?by=index&value=" + encodeURIComponent(s));
  };

  Exchange.prototype.nextNonce = async function (accountIndex, apiKeyIndex) {
    const r = await this.get("/api/v1/nextNonce?account_index=" + accountIndex + "&api_key_index=" + apiKeyIndex);
    if (r.nonce == null && r.code && r.code !== 200) {
      throw new Error("nextNonce: " + (r.message || r.code));
    }
    return r.nonce;
  };

  Exchange.prototype.apiKeys = async function (accountIndex, apiKeyIndex) {
    return this.get("/api/v1/apikeys?account_index=" + accountIndex + "&api_key_index=" + apiKeyIndex);
  };

  Exchange.prototype.accountLimits = async function (accountIndex, auth) {
    return this.get("/api/v1/accountLimits?account_index=" + accountIndex, { Authorization: auth });
  };

  Exchange.prototype.activeOrders = async function (accountIndex, marketId, auth) {
    const mid = marketId == null ? 255 : marketId;
    return this.get("/api/v1/accountActiveOrders?account_index=" + accountIndex + "&market_id=" + mid, auth ? { Authorization: auth } : {});
  };

  Exchange.prototype.trades = async function (accountIndex, limit) {
    return this.get("/api/v1/trades?sort_by=timestamp&limit=" + (limit || 50) + "&account_index=" + accountIndex);
  };

  Exchange.prototype.recentTrades = async function (marketId, limit) {
    return this.get("/api/v1/recentTrades?market_id=" + marketId + "&limit=" + (limit || 30));
  };

  Exchange.prototype.orderBookOrders = async function (marketId, limit) {
    return this.get("/api/v1/orderBookOrders?market_id=" + marketId + "&limit=" + (limit || 20));
  };

  Exchange.prototype.createIntentAddress = async function (fromAddr) {
    if (!this.net.canIntent || this.net.intentChainId == null) {
      throw new Error("Intent addresses are not available on this environment.");
    }
    return this.form("/api/v1/createIntentAddress", {
      chain_id: String(this.net.intentChainId),
      from_addr: fromAddr,
      amount: "0",
      is_external_deposit: "true"
    });
  };

  Exchange.prototype.tx = async function (hash) {
    return this.get("/api/v1/tx?by=hash&value=" + encodeURIComponent(hash));
  };

  w.HelmithExchange = Exchange;
})(window);

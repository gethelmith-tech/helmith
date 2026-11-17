/* EIP-1193 wallet (MetaMask, OKX, and others). Helmith never sees the key. */
(function (w) {
  "use strict";

  function hexChain(id) {
    return "0x" + Number(id).toString(16);
  }

  function getProvider() {
    const eth = w.ethereum;
    if (!eth) return null;
    if (Array.isArray(eth.providers) && eth.providers.length) {
      return eth.providers.find((p) => p.isMetaMask) || eth.providers[0];
    }
    return eth;
  }

  async function request(method, params) {
    const p = getProvider();
    if (!p) throw new Error("No EIP-1193 wallet was found. Install MetaMask or OKX, then try again.");
    return p.request({ method, params });
  }

  async function connect() {
    const accounts = await request("eth_requestAccounts");
    if (!accounts || !accounts[0]) throw new Error("The wallet did not return an account.");
    return accounts[0];
  }

  async function accounts() {
    try {
      return await request("eth_accounts");
    } catch {
      return [];
    }
  }

  async function chainId() {
    const raw = await request("eth_chainId");
    return parseInt(raw, 16);
  }

  async function ensureChain(net) {
    if (!net || !net.evmChainId || !net.rpc) {
      throw new Error("This Lighter environment has no public wallet chain that Helmith can add.");
    }
    const want = Number(net.evmChainId);
    const have = await chainId();
    if (have === want) return;
    const hex = hexChain(want);
    try {
      await request("wallet_switchEthereumChain", [{ chainId: hex }]);
    } catch (err) {
      const code = err && (err.code || (err.data && err.data.originalError && err.data.originalError.code));
      if (code === 4902 || /unrecognized|not added/i.test(String(err && err.message))) {
        await request("wallet_addEthereumChain", [{
          chainId: hex,
          chainName: net.evmName || ("Chain " + want),
          nativeCurrency: { name: net.nativeSymbol || "ETH", symbol: net.nativeSymbol || "ETH", decimals: 18 },
          rpcUrls: [net.rpc],
          blockExplorerUrls: net.explorer ? [net.explorer] : undefined
        }]);
        await request("wallet_switchEthereumChain", [{ chainId: hex }]);
      } else {
        throw err;
      }
    }
    const after = await chainId();
    if (after !== want) throw new Error("The wallet is not on " + (net.evmName || want) + " yet.");
  }

  async function personalSign(address, message) {
    // personal_sign params are [message, address]
    return request("personal_sign", [message, address]);
  }

  function pad(hex, bytes) {
    let h = hex.replace(/^0x/, "");
    if (h.length % 2) h = "0" + h;
    return h.padStart(bytes * 2, "0");
  }

  function encodeAddress(addr) {
    return pad(addr.toLowerCase().replace(/^0x/, ""), 32);
  }

  function encodeUint(n, bytes) {
    let v;
    if (typeof n === "bigint") v = n;
    else if (typeof n === "string" && n.startsWith("0x")) v = BigInt(n);
    else v = BigInt(n);
    return pad(v.toString(16), bytes);
  }

  function encodeDeposit(to, assetIndex, routeType, amount) {
    // deposit(address,uint16,uint8,uint256) = 0x8a857083
    return "0x8a857083" + encodeAddress(to) + encodeUint(assetIndex, 32) + encodeUint(routeType, 32) + encodeUint(amount, 32);
  }

  function encodeBalanceOf(addr) {
    return "0x70a08231" + encodeAddress(addr);
  }

  function encodeAllowance(owner, spender) {
    return "0xdd62ed3e" + encodeAddress(owner) + encodeAddress(spender);
  }

  function encodeApprove(spender, amount) {
    return "0x095ea7b3" + encodeAddress(spender) + encodeUint(amount, 32);
  }

  function encodeTransfer(to, amount) {
    return "0xa9059cbb" + encodeAddress(to) + encodeUint(amount, 32);
  }

  function decodeUint(hex) {
    if (!hex || hex === "0x") return 0n;
    return BigInt(hex);
  }

  async function call(to, data) {
    return request("eth_call", [{ to, data }, "latest"]);
  }

  async function send(from, to, data, value) {
    const tx = { from, to, data };
    if (value) tx.value = value;
    return request("eth_sendTransaction", [tx]);
  }

  async function tokenBalance(token, owner) {
    const raw = await call(token, encodeBalanceOf(owner));
    return decodeUint(raw);
  }

  async function tokenAllowance(token, owner, spender) {
    const raw = await call(token, encodeAllowance(owner, spender));
    return decodeUint(raw);
  }

  async function approve(from, token, spender, amount) {
    return send(from, token, encodeApprove(spender, amount));
  }

  async function transfer(from, token, to, amount) {
    return send(from, token, encodeTransfer(to, amount));
  }

  async function deposit(from, contract, to, assetIndex, routeType, amount) {
    return send(from, contract, encodeDeposit(to, assetIndex, routeType, amount));
  }

  function on(event, fn) {
    const p = getProvider();
    if (p && p.on) p.on(event, fn);
    return () => { if (p && p.removeListener) p.removeListener(event, fn); };
  }

  w.HelmithWallet = {
    getProvider, connect, accounts, chainId, ensureChain, personalSign,
    tokenBalance, tokenAllowance, approve, transfer, deposit, on, request
  };
})(window);

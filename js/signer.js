/* Official Lighter WASM signer (elliottech/lighter-go, ./wasm).
   CreateClient is given an empty URL; all HTTP stays in JavaScript. */
(function (w) {
  "use strict";
  const WASM_URL = "/vendor/lighter-signer.wasm";
  let ready = null;
  let goRuntime = null;

  function check(res) {
    if (res && res.error) throw new Error(res.error);
    return res;
  }

  function fn(name) {
    const f = w[name];
    if (typeof f !== "function") throw new Error("Signer export missing: " + name);
    return f;
  }

  async function load() {
    if (ready) return ready;
    ready = (async () => {
      if (typeof w.Go !== "function") throw new Error("wasm_exec.js did not define Go");
      goRuntime = new w.Go();
      const src = await fetch(WASM_URL);
      if (!src.ok) throw new Error("Could not load the Lighter signer (" + src.status + ")");
      const type = src.headers.get("content-type") || "";
      let instance;
      if (WebAssembly.instantiateStreaming && type.includes("application/wasm")) {
        ({ instance } = await WebAssembly.instantiateStreaming(src, goRuntime.importObject));
      } else {
        const buf = await src.arrayBuffer();
        ({ instance } = await WebAssembly.instantiate(buf, goRuntime.importObject));
      }
      // Do not await: the Go runtime stays alive.
      goRuntime.run(instance);
      // Yield so exported functions are attached.
      await new Promise((r) => setTimeout(r, 0));
      if (typeof w.GenerateAPIKey !== "function") {
        throw new Error("The WASM signer loaded, but GenerateAPIKey was not exported");
      }
      return true;
    })();
    try {
      return await ready;
    } catch (err) {
      ready = null;
      throw err;
    }
  }

  function generateApiKey() {
    return check(fn("GenerateAPIKey")());
  }

  function createClient(privateKey, signChainId, apiKeyIndex, accountIndex) {
    return check(fn("CreateClient")("", privateKey, Number(signChainId), Number(apiKeyIndex), Number(accountIndex)));
  }

  function createAuthToken(deadline, apiKeyIndex, accountIndex) {
    return check(fn("CreateAuthToken")(Number(deadline) || 0, Number(apiKeyIndex), Number(accountIndex)));
  }

  function signChangePubKey(publicKey, skipNonce, nonce, apiKeyIndex, accountIndex) {
    return check(fn("SignChangePubKey")(publicKey, Number(skipNonce), Number(nonce), Number(apiKeyIndex), Number(accountIndex)));
  }

  function signCreateOrder() {
    return check(fn("SignCreateOrder").apply(null, arguments));
  }

  function signCancelOrder() {
    return check(fn("SignCancelOrder").apply(null, arguments));
  }

  function signCancelAllOrders() {
    return check(fn("SignCancelAllOrders").apply(null, arguments));
  }

  function signWithdraw() {
    return check(fn("SignWithdraw").apply(null, arguments));
  }

  function signUpdateLeverage() {
    return check(fn("SignUpdateLeverage").apply(null, arguments));
  }

  function signCreateGroupedOrders() {
    return check(fn("SignCreateGroupedOrders").apply(null, arguments));
  }

  w.HelmithSigner = {
    load, check, generateApiKey, createClient, createAuthToken,
    signChangePubKey, signCreateOrder, signCancelOrder, signCancelAllOrders,
    signWithdraw, signUpdateLeverage, signCreateGroupedOrders
  };
})(window);

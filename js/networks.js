/* Lighter on Robinhood Chain — keep base URL and signing chain ID together.
   EVM chain ID (wallet) is not the same as the Lighter signing chain ID. */
(function (w) {
  "use strict";
  const USDG_ASSET_ID = 3; // from assetDetails on both RH environments
  const HELMITH_API_KEY_INDEX = 8; // 4–156 or 158–254; 0–3 and 157 are reserved

  const DEPOSIT_ABI = [
    {
      type: "function",
      name: "deposit",
      stateMutability: "nonpayable",
      inputs: [
        { name: "_to", type: "address" },
        { name: "_assetIndex", type: "uint16" },
        { name: "_routeType", type: "uint8" },
        { name: "_amount", type: "uint256" }
      ],
      outputs: []
    }
  ];
  /* Selector 0x8a857083, matching Lighter's documented Ethereum deposit() and
     the same four-argument signature described for Robinhood Chain. */
  const ERC20_ABI = [
    { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
    { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "t", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] }
  ];

  const networks = {
    testnet: {
      id: "testnet",
      label: "Testnet",
      rest: "https://api.rh-testnet.lighter.xyz",
      ws: "wss://api.rh-testnet.lighter.xyz/stream",
      signChainId: 300,
      /* layer1BasicInfo reports L1 chainId 123456 and these contracts, but no
         public RPC for that chain is documented. Official Robinhood Chain
         Testnet (46630) does not have this ZkLighter bytecode. Direct testnet
         deposits are therefore not offered in the UI. */
      evmChainId: null,
      evmName: null,
      rpc: null,
      explorer: null,
      contract: "0x7AC9d29884Bf1788e73c5e167625a9aD0B30D522",
      usdg: "0xAd355C2d4Cc2f9641b7b338516C4C7E06c060033",
      faucet: "0xa083A806F27bB9B7FD053E88577dB36c46bf7274",
      usdgAssetId: USDG_ASSET_ID,
      usdgDecimals: 6,
      canDeposit: false,
      canIntent: false,
      intentChainId: null,
      source: "Lighter · Robinhood Chain testnet"
    },
    mainnet: {
      id: "mainnet",
      label: "Mainnet",
      rest: "https://api.rh.lighter.xyz",
      ws: "wss://api.rh.lighter.xyz/stream",
      signChainId: 466324,
      evmChainId: 4663,
      evmName: "Robinhood Chain",
      rpc: "https://rpc.mainnet.chain.robinhood.com",
      explorer: "https://robinhoodchain.blockscout.com",
      nativeSymbol: "ETH",
      contract: "0x94bAB9693Ba2f6358507eFfcbd372b0660AFfF9d",
      usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      faucet: null,
      usdgAssetId: USDG_ASSET_ID,
      usdgDecimals: 6,
      canDeposit: true,
      canIntent: true,
      intentChainId: 4663,
      source: "Lighter · Robinhood Chain"
    }
  };

  w.HELMITH_NETWORKS = {
    networks,
    defaultId: "testnet",
    apiKeyIndex: HELMITH_API_KEY_INDEX,
    depositAbi: DEPOSIT_ABI,
    erc20Abi: ERC20_ABI,
    get(id) { return networks[id] || networks.testnet; }
  };
})(window);

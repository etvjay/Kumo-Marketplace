export const VENUS_CORE_BSC = {
  chainId: 56 as const,
  comptroller: "0xfD36E2c2a6789Db23113685031d7F16329158384",
  resilientOracle: "0x6592b5DE802159F3E74B2486b091D11a8256ab8A",
  vBNB: "0xA07c5b74C9B40447a954e1466938b865b6BBea36",
  liquidator: "0x0870793286aaDA55D39CE7f82fb2766e8004cF43",
  swapHelper: "0xD79be25aEe798Aa34A9Ba1230003d7499be29A24",
  swapRouter: "0xde7E4f67Af577F29e5F3B995f9e67FD425F73621",
  deviationSentinel: "0x6599C15cc8407046CD91E5c0F8B7f765fF914870",
  sentinelOracle: "0x58eae0Cf4215590E19860b66b146C5d539cb6f14",
  pancakeSwapOracle: "0x44B72078240A3509979faF450085Fa818401D32E"
} as const;

export const VENUS_CORE_SOURCE_REFS = {
  comptroller: "venus-core-bsc:comptroller:0xfd36e2c2a6789db23113685031d7f16329158384",
  resilientOracle: "venus-docs:resilient-oracle:bsc:0x6592b5de802159f3e74b2486b091d11a8256ab8a",
  vBNB: "venus-core-bsc:vbnb:0xa07c5b74c9b40447a954e1466938b865b6bbea36"
} as const;

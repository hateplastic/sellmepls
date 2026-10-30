# BSC purchase recovery — 2026-10-17

Transaction `0x527f1a641bbae4090ec2d40a26be2bef02344f0764f8eedf4000ff0b03fac2c8`
paid order `1f658514-5ded-41a1-b9e1-341760c5c465` successfully on BSC mainnet.
The wallet used an outer executor at `0xdb9b1e94b5b69df7e401ddbede43491141047db3`;
the genuine `Paid` event came from the order's router
`0x63fca73531c33d492bc8c1cc4b7bcaf59bea0587`.

The verifier previously rejected the outer transaction recipient before checking
the router's event. It now authenticates the event emitter against the immutable
order snapshot and checks the exact order, buyer, seller, token, amount, fee,
affiliate, canonical block, confirmations and quote window. The outer recipient
and submitter may be a wallet executor or relayer. A log from another contract
cannot authorize delivery, even if its event fields are identical.

The original payment was verified against the live chain and settled through
`complete_sale`. Amount: 1 USDT; platform fee: 0.10 USDT; seller: 0.90 USDT.
The actual signed R2 download returned HTTP 206 for a one-byte range, with
attachment disposition. No second transaction or charge was made.

Regression tests cover direct and wrapped calls, relayers, forged emitters,
wrong buyers and orders, duplicate events, wrong amounts and confirmation delay.

Ethereum mainnet and TRON are temporarily excluded from new order creation,
listing price inputs, checkout choices and network setup UI. Asset definitions,
existing router records, historical verification and download recovery remain
available. The visibility rule is `isNetworkOffered` in `lib/network.ts`;
`isAssetEnabled` intentionally remains independent for historical parsing.

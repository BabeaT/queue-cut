// 运营账户给中继账户补 gas
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, formatEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
const keys = JSON.parse(fs.readFileSync(new URL("../../.secrets/keys.json", import.meta.url), "utf8"));
const pub = createPublicClient({ chain: monadTestnet, transport: http() });
const w = createWalletClient({ account: privateKeyToAccount(keys.deployer.privateKey), chain: monadTestnet, transport: http() });
const amt = parseEther(process.env.AMOUNT ?? "0.5");
let nonce = await pub.getTransactionCount({ address: w.account.address });
const hs = [];
for (const r of keys.relayers as { address: Hex }[]) hs.push(await w.sendTransaction({ to: r.address, value: amt, gas: 21000n, nonce: nonce++ }));
for (const h of hs) await pub.waitForTransactionReceipt({ hash: h });
for (const a of [keys.deployer, ...keys.relayers]) console.log(a.address.slice(0, 10), formatEther(await pub.getBalance({ address: a.address })));

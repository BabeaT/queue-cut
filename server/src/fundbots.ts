// 运营账户给 20 个黄牛号各补一点 gas
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, formatEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
const keys = JSON.parse(fs.readFileSync(new URL("../../.secrets/keys.json", import.meta.url), "utf8"));
const pub = createPublicClient({ chain: monadTestnet, transport: http() });
const w = createWalletClient({ account: privateKeyToAccount(keys.deployer.privateKey), chain: monadTestnet, transport: http() });
const target = parseEther(process.env.TARGET ?? "0.5");
let nonce = await pub.getTransactionCount({ address: w.account.address });
const hs = [];
for (const b of keys.bots as { address: Hex }[]) {
  const bal = await pub.getBalance({ address: b.address });
  if (bal >= target) continue;
  hs.push(await w.sendTransaction({ to: b.address, value: target - bal, gas: 21000n, nonce: nonce++ }));
}
for (const h of hs) await pub.waitForTransactionReceipt({ hash: h });
console.log("funded", hs.length, "bots; deployer", formatEther(await pub.getBalance({ address: w.account.address })));

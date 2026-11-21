// 把有 MON 的账户里的钱匀给没 MON 的黄牛号（每个 0.1 MON 当 gas）
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, formatEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
const keys = JSON.parse(fs.readFileSync(new URL("../../.secrets/keys.json", import.meta.url), "utf8"));
const pub = createPublicClient({ chain: monadTestnet, transport: http() });
const bots: { address: Hex; privateKey: Hex }[] = keys.bots;
const bal = await Promise.all(bots.map((b) => pub.getBalance({ address: b.address })));
const rich = bots.filter((_, i) => bal[i] > parseEther("0.5"));
const poor = bots.filter((_, i) => bal[i] < parseEther("0.05"));
console.log("rich", rich.length, "poor", poor.length);
const per = parseEther(process.env.AMOUNT ?? "0.1");
let i = 0;
for (const r of rich) {
  const acc = privateKeyToAccount(r.privateKey);
  const w = createWalletClient({ account: acc, chain: monadTestnet, transport: http() });
  let nonce = await pub.getTransactionCount({ address: acc.address });
  const mine = poor.slice(i, i + Math.ceil(poor.length / rich.length));
  i += mine.length;
  const hashes = [];
  for (const p of mine) hashes.push(await w.sendTransaction({ to: p.address, value: per, gas: 21000n, nonce: nonce++ }));
  for (const h of hashes) await pub.waitForTransactionReceipt({ hash: h });
  console.log(acc.address.slice(0, 10), "->", mine.length);
}
const after = await Promise.all(bots.map((b) => pub.getBalance({ address: b.address })));
console.log(after.map((x) => Number(formatEther(x)).toFixed(2)).join(" "));

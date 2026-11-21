// 把黄牛号里多余的 MON 归集到运营账户（每个号留 KEEP 当 gas）
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, formatEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
const keys = JSON.parse(fs.readFileSync(new URL("../../.secrets/keys.json", import.meta.url), "utf8"));
const pub = createPublicClient({ chain: monadTestnet, transport: http() });
const keep = parseEther(process.env.KEEP ?? "0.15");
const to = keys.deployer.address as Hex;
for (const b of keys.bots as { address: Hex; privateKey: Hex }[]) {
  const bal = await pub.getBalance({ address: b.address });
  const fee = 21000n * 210_000_000_000n;
  if (bal <= keep + fee + parseEther("0.05")) continue;
  const w = createWalletClient({ account: privateKeyToAccount(b.privateKey), chain: monadTestnet, transport: http() });
  const h = await w.sendTransaction({ to, value: bal - keep - fee, gas: 21000n });
  await pub.waitForTransactionReceipt({ hash: h });
  console.log(b.address.slice(0, 10), "->", formatEther(bal - keep - fee));
}
console.log("deployer", formatEther(await pub.getBalance({ address: to })));

// 端到端冒烟：模拟手机用户（浏览器内钱包 + 中继代付 gas）
import { encodeFunctionData, parseEther, stringToHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { queueCutAbi, deployment } from "../../shared/abi.ts";
const API = process.env.API ?? "http://localhost:8787";
const N = Number(process.env.N ?? 5);
const post = async (p: string, b: unknown) => {
  const r = await fetch(API + p, { method: "POST", headers: { "content-type": "application/json", "x-stage-key": "blitz" }, body: JSON.stringify(b) });
  const j = await r.json();
  if (!r.ok) throw new Error(p + " " + JSON.stringify(j));
  return j;
};
async function relay(pk: Hex, fn: string, args: unknown[]) {
  const acc = privateKeyToAccount(pk);
  const data = encodeFunctionData({ abi: queueCutAbi, functionName: fn as any, args: args as any });
  const prep = await post("/api/prepare", { from: acc.address, data });
  const msg = { from: acc.address, to: deployment.queueCut, value: 0n, gas: BigInt(prep.gas), nonce: BigInt(prep.nonce), deadline: prep.deadline, data };
  const signature = await acc.signTypedData({
    domain: { name: "QueueCutForwarder", version: "1", chainId: 10143, verifyingContract: deployment.forwarder },
    types: { ForwardRequest: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "gas", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" }, { name: "data", type: "bytes" } ] },
    primaryType: "ForwardRequest",
    message: msg,
  });
  return post("/api/relay", { request: { ...msg, value: "0", gas: prep.gas, nonce: prep.nonce, signature } });
}
const pks = Array.from({ length: N }, () => generatePrivateKey());
await Promise.all(pks.map((pk) => post("/api/onboard", { address: privateKeyToAccount(pk).address })));
console.log("onboarded", N);
for (let i = 0; i < N; i++) {
  const r = await relay(pks[i], "join", [parseEther("0.5"), false, stringToHex(`测试${i}`, { size: 16 })]);
  console.log("join", i, r.ok, r.syncMs + "ms", "gas", r.gasUsed, "/", r.gasLimit);
}
const r = await relay(pks[N - 1], "cut", [0, parseEther("100")]);
console.log("cut", r.ok, "sync", r.syncMs + "ms", "total", r.totalMs + "ms", "gas", r.gasUsed, "/", r.gasLimit, r.hash);
await new Promise((s) => setTimeout(s, 1500));
const st = await (await fetch(API + "/api/state")).json();
console.log(st.queue.map((q: any) => `${q.rank}.${q.nick}(${q.frozenIn})`).join("  "));
console.log("stats", JSON.stringify(st.stats));

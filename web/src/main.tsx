import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { lazy, Suspense } from "react";
import HomePage from "./home/HomePage.tsx";
import "./home/homepage.css";

const Mobile = lazy(() => import("./pages/Mobile.tsx"));
const Screen = lazy(() => import("./pages/Screen.tsx"));
const Stage = lazy(() => import("./pages/Stage.tsx"));
const DemoQueue = lazy(() => import("./demo/DemoQueue.tsx"));

const p = location.pathname.replace(/\/+$/, "");
const demo = p === "/m" && new URLSearchParams(location.search).get("demo") === "1";
const Page = demo ? DemoQueue : p === "" ? HomePage : p.startsWith("/screen") ? Screen : p.startsWith("/stage") || p.startsWith("/shop") ? Stage : Mobile;
document.body.dataset.page = p === "" ? "home" : p.startsWith("/screen") ? "screen" : p.startsWith("/stage") || p.startsWith("/shop") ? "stage" : "mobile";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<p role="status" style={{ padding: 24 }}>正在打开页面…</p>}><Page /></Suspense>
  </React.StrictMode>,
);

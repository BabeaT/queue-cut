import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import Mobile from "./pages/Mobile.tsx";
import Screen from "./pages/Screen.tsx";
import Stage from "./pages/Stage.tsx";

const p = location.pathname.replace(/\/+$/, "");
const Page = p.startsWith("/screen") ? Screen : p.startsWith("/stage") || p.startsWith("/shop") ? Stage : Mobile;
document.body.dataset.page = p.startsWith("/screen") ? "screen" : p.startsWith("/stage") || p.startsWith("/shop") ? "stage" : "mobile";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>,
);

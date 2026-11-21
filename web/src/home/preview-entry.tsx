import { renderToStaticMarkup } from "react-dom/server";
import HomePage from "./HomePage.tsx";
import { initHomepage } from "./interactions.js";

export const markup = renderToStaticMarkup(<HomePage />);
export const script = `(${initHomepage.toString()})(document, { preview: true });`;

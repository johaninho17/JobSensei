import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "@fontsource-variable/newsreader";
import "./tokens.css";
import "./styles.css";
import "./layout.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

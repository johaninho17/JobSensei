import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { setPdfsMarkApplied } from "../shared/tracker";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "@fontsource-variable/newsreader";
import "./tokens.css";
import "./styles.css";
import "./layout.css";

// The page title is the window title: name the edition so the user always knows which build this is.
document.title = EDITION.productName;
// Drafts count as applied only where the edition says so (a recruiter marks jobs applied).
setPdfsMarkApplied(FEATURES.pdfsMarkApplied);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

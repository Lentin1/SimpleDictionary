import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";
import "./liquid-glass.css";

const rootElement = document.documentElement;
let initialTheme = "system";
try {
  const savedTheme = window.localStorage.getItem("jian-ci-theme");
  if (savedTheme === "light" || savedTheme === "dark") initialTheme = savedTheme;
} catch {
  // The app still follows the system appearance when local preferences are unavailable.
}
rootElement.dataset.theme = initialTheme;
rootElement.dataset.effectiveTheme = initialTheme === "system"
  ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  : initialTheme;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import QuickAddWindow from "./QuickAddWindow";
import "./styles.css";

const isQuickAdd = getCurrentWindow().label === "quickadd";
document.documentElement.classList.toggle("is-quick-add", isQuickAdd);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isQuickAdd ? <QuickAddWindow /> : <App />}</React.StrictMode>,
);

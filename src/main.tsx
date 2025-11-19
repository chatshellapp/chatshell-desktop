import React from "react";
import ReactDOM from "react-dom/client";
import { enableMapSet } from "immer";
import App from "./App";

// Enable Immer MapSet plugin for stores using Map/Set
enableMapSet();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

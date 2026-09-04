import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CosmosWindow from "./components/CosmosWindow";
import "./styles.css";
import "./standalone-v2.css";
import "./settings-v2.css";

const params = new URLSearchParams(window.location.search);
const content = params.get("cosmos") === "1" ? <CosmosWindow /> : <App />;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{content}</React.StrictMode>,
);

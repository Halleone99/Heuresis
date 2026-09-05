import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CaptureWindow from "./components/CaptureWindow";
import CosmosWindow from "./components/CosmosWindow";
import "./styles.css";
import "./standalone-v2.css";
import "./settings-v2.css";
import "./brand.css";
import "./popup-system.css";
import "./components/review-background.css";
import "./library-refinements.css";
import "./capture-window.css";
import "./shell-modern.css";
import "./contextual-actions.css";
import "./new-words-topic.css";
import "./library-shell-elegance.css";
import "./desktop-density-pass.css";
import "./library-card-restoration.css";

const params = new URLSearchParams(window.location.search);
const content = params.get("capture") === "1"
  ? <CaptureWindow />
  : params.get("cosmos") === "1"
    ? <CosmosWindow />
    : <App />;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{content}</React.StrictMode>,
);

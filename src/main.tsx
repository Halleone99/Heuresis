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
import "./intelligent-ui.css";
import "./library-home-modern.css";
import "./library-home-finish.css";
import "./topic-modern.css";
import "./topic-table-v2.css";
import "./topic-filter-popovers.css";
import "./topic-filter-tickers.css";
import "./topic-elegance-pass.css";
import "./browse-modern.css";
import "./browse-compact.css";
import "./study-launch-modern.css";
import "./study-compact.css";
import "./study-direction-simple.css";
import "./sort-workspace-modern.css";
import "./vocabulary-modern.css";
import "./vocabulary-actions-polish.css";
import "./tablet.css";

const params = new URLSearchParams(window.location.search);
const content = params.get("capture") === "1"
  ? <CaptureWindow />
  : params.get("cosmos") === "1"
    ? <CosmosWindow />
    : <App />;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{content}</React.StrictMode>,
);
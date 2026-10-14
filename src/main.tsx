import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "@fontsource/libre-caslon-display/400.css";
import "@fontsource/noto-serif/400.css";
import App from "./App";
import { applyAppearance, watchAppearance } from "./lib/theme";
import CaptureWindow from "./components/CaptureWindow";
import FloatingQuickCapture from "./components/workspace/FloatingQuickCapture";
import CosmosWindow from "./components/CosmosWindow";
import ReviewScratchpad from "./components/ReviewScratchpad";
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
import "./connections-general.css";
import "./catalogue-read-filters.css";
import "./tablet.css";
// Loaded last: the learning workspace and the shared shell around Study.
import "./components/workspace/workspace.css";
// Loaded last to resolve legacy and workspace colours with one shared palette.
import "./theme/palettes.css";
import "./theme/chrome.css";

const params = new URLSearchParams(window.location.search);
// Every window uses the same appearance; updates propagate across windows.
applyAppearance();
watchAppearance();
const content = params.get("quick") === "1"
  ? <FloatingQuickCapture />
  : params.get("capture") === "1"
    ? <CaptureWindow />
  : params.get("cosmos") === "1"
    ? <><CosmosWindow /><ReviewScratchpad /></>
    : <App />;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{content}</React.StrictMode>,
);

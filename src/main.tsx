import { createRoot } from "octane";
import { QueryClientProvider } from "@octanejs/tanstack-query";
import App from "./App";
import { QuickCaptureWindow } from "./components/capture/QuickCaptureWindow";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import "./styles.css";
import { queryClient } from "./lib/queryClient";
import { getWindowKind } from "./lib/desktop";

// Kill macOS autocorrect/autocapitalize/spellcheck in every text field.
document.addEventListener("focusin", (event) => {
  const el = event.target;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.setAttribute("autocorrect", "off");
    el.setAttribute("autocomplete", "off");
    el.autocapitalize = "off";
    el.spellcheck = false;
  }
});

const Root = getWindowKind() === "quick-capture" ? QuickCaptureWindow : App;

const root = document.getElementById("root");
if (!root) throw new Error("Markd requires a #root element");

createRoot(root).render(
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </ErrorBoundary>,
);

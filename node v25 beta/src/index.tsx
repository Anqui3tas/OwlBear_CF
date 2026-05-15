import { createRoot } from "react-dom/client";
import App from "./App";
import Modal from "react-modal";

// Add css for simplebar
import "simplebar/dist/simplebar.min.css";

import "./index.css";

// Pointer events shim
if (!("PointerEvent" in window)) {
  import("pepjs");
}

// Intersection observer polyfill
if (!("IntersectionObserver" in window)) {
  import("intersection-observer");
}

Modal.setAppElement("#root");

const root = document.getElementById("root");
if (!root) {
  throw new Error("Unable to find root element");
}

createRoot(root).render(<App />);

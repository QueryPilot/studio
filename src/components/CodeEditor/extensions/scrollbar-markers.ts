/**
 * Scrollbar Markers Extension
 *
 * Renders colored position markers in the scrollbar track for diagnostics.
 * Error = red, Warning = yellow, Info = blue.
 */

import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { forEachDiagnostic, diagnosticCount } from "@codemirror/lint";

const markerContainerClass = "cm-scrollbar-markers";

const scrollbarMarkersPlugin = ViewPlugin.fromClass(
  class {
    private container: HTMLElement | null = null;
    private lastDiagCount = 0;

    constructor(private view: EditorView) {
      this.lastDiagCount = diagnosticCount(view.state);
      this.createContainer();
      this.updateMarkers();
    }

    update(update: ViewUpdate) {
      const newCount = diagnosticCount(update.state);
      if (
        newCount !== this.lastDiagCount ||
        update.docChanged ||
        update.geometryChanged
      ) {
        this.lastDiagCount = newCount;
        this.updateMarkers();
      }
    }

    private createContainer() {
      const scroller = this.view.scrollDOM;

      // Remove existing container if present
      const existing = scroller.querySelector(`.${markerContainerClass}`);
      if (existing) existing.remove();

      this.container = document.createElement("div");
      this.container.className = markerContainerClass;
      scroller.appendChild(this.container);
    }

    private updateMarkers() {
      if (!this.container) return;
      this.container.innerHTML = "";

      const contentHeight = this.view.contentHeight;
      if (contentHeight === 0) return;

      forEachDiagnostic(this.view.state, (d) => {
        const marker = document.createElement("div");
        marker.className = "cm-scrollbar-marker";

        // Pixel-accurate positioning using visual line blocks
        const block = this.view.lineBlockAt(d.from);
        const ratio = block.top / contentHeight;

        marker.style.top = `${ratio * 100}%`;

        switch (d.severity) {
          case "error":
            marker.classList.add("cm-scrollbar-marker-error");
            break;
          case "warning":
            marker.classList.add("cm-scrollbar-marker-warning");
            break;
          default:
            marker.classList.add("cm-scrollbar-marker-info");
            break;
        }

        this.container?.appendChild(marker);
      });
    }

    destroy() {
      this.container?.remove();
    }
  }
);

const scrollbarMarkersTheme = EditorView.theme({
  [`& .${markerContainerClass}`]: {
    position: "absolute",
    right: "2px",
    top: "0",
    bottom: "0",
    width: "8px",
    pointerEvents: "none",
    zIndex: "10",
  },
  "& .cm-scrollbar-marker": {
    position: "absolute",
    right: "0",
    width: "8px",
    height: "3px",
    borderRadius: "1px",
  },
  "& .cm-scrollbar-marker-error": {
    backgroundColor: "hsl(0, 80%, 55%)",
  },
  "& .cm-scrollbar-marker-warning": {
    backgroundColor: "hsl(45, 90%, 50%)",
  },
  "& .cm-scrollbar-marker-info": {
    backgroundColor: "hsl(210, 80%, 55%)",
  },
});

/**
 * Create the scrollbar markers extension.
 * Shows colored position markers in the scrollbar for diagnostics.
 */
export function createScrollbarMarkersExtension(): Extension {
  return [scrollbarMarkersPlugin, scrollbarMarkersTheme];
}

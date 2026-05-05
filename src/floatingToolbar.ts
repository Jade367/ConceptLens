import { CapturedSelection, ConceptLensAction } from "./types";
import { getUiLabels } from "./i18n";

type ActionHandler = (action: ConceptLensAction, selection: CapturedSelection) => void;

interface FloatingToolbarOptions {
  onAction: ActionHandler;
  getOutputLanguage: () => import("./types").OutputLanguage;
}

const ACTIONS: ConceptLensAction[] = [
  "overview",
  "explain",
  "translate",
  "expand",
  "save"
];

export class FloatingToolbar {
  private containerEl: HTMLDivElement;
  private buttons = new Map<ConceptLensAction, HTMLButtonElement>();
  private selection: CapturedSelection | null = null;

  constructor(private options: FloatingToolbarOptions) {
    this.containerEl = document.body.createDiv({ cls: "conceptlens-toolbar" });
    this.containerEl.setAttr("role", "toolbar");
    this.containerEl.setAttr("aria-label", "ConceptLens actions");

    ACTIONS.forEach((action) => {
      const button = this.containerEl.createEl("button", {
        attr: {
          type: "button"
        }
      });
      this.buttons.set(action, button);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.selection) {
          this.options.onAction(action, this.selection);
        }
      });
    });
    this.refreshLabels();
  }

  show(selection: CapturedSelection): void {
    this.selection = selection;
    this.refreshLabels();
    this.containerEl.style.visibility = "hidden";
    this.containerEl.addClass("is-visible");
    this.position(selection);
    this.containerEl.style.visibility = "";
  }

  hide(source?: CapturedSelection["source"]): void {
    if (source && this.selection?.source !== source) {
      return;
    }

    this.selection = null;
    this.containerEl.removeClass("is-visible");
  }

  destroy(): void {
    this.containerEl.remove();
  }

  isEventInside(event: Event): boolean {
    const target = event.target;
    return target instanceof Node && this.containerEl.contains(target);
  }

  getSource(): CapturedSelection["source"] | null {
    return this.selection?.source ?? null;
  }

  private position(selection: CapturedSelection): void {
    const margin = 8;
    const toolbarRect = this.containerEl.getBoundingClientRect();
    const selectionRect = selection.rect;

    let top = selectionRect.top - toolbarRect.height - margin;
    if (top < margin) {
      top = selectionRect.bottom + margin;
    }

    let left = selectionRect.left + selectionRect.width / 2 - toolbarRect.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - toolbarRect.width - margin));

    this.containerEl.style.top = `${Math.round(top)}px`;
    this.containerEl.style.left = `${Math.round(left)}px`;
  }

  private refreshLabels(): void {
    const language = this.options.getOutputLanguage();
    const labels = getUiLabels(language);
    this.containerEl.toggleClass("is-rtl", language === "ar");
    this.containerEl.setAttr("dir", language === "ar" ? "rtl" : "ltr");

    ACTIONS.forEach((action) => {
      const button = this.buttons.get(action);
      if (!button) {
        return;
      }
      const title = labels.actionTooltips[action];
      button.setText(labels.actions[action]);
      button.setAttr("title", title);
      button.setAttr("aria-label", title);
    });
  }
}

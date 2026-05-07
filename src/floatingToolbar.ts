import { setIcon } from "obsidian";
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
  private closeButtonEl: HTMLButtonElement;
  private selection: CapturedSelection | null = null;

  constructor(private options: FloatingToolbarOptions) {
    this.containerEl = document.body.createDiv({ cls: "conceptlens-toolbar" });
    this.containerEl.setAttr("role", "toolbar");
    this.containerEl.setAttr("aria-label", "Concept lens actions");

    ACTIONS.forEach((action) => {
      const button = this.containerEl.createEl("button", {
        attr: {
          type: "button"
        }
      });
      this.buttons.set(action, button);
      button.addEventListener("pointerdown", (event) => {
        this.triggerAction(action, event);
      });
      button.addEventListener("click", (event) => {
        if (event instanceof MouseEvent && event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        this.triggerAction(action, event);
      });
    });
    this.closeButtonEl = this.containerEl.createEl("button", {
      cls: "conceptlens-toolbar-close",
      attr: {
        type: "button"
      }
    });
    setIcon(this.closeButtonEl, "x");
    this.closeButtonEl.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.hide();
    });
    this.closeButtonEl.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.hide();
    });
    this.refreshLabels();
  }

  show(selection: CapturedSelection): void {
    this.selection = selection;
    this.refreshLabels();
    this.containerEl.addClass("is-measuring");
    this.containerEl.addClass("is-visible");
    this.position(selection);
    this.containerEl.removeClass("is-measuring");
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

  private triggerAction(action: ConceptLensAction, event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const selection = this.selection;
    if (!selection) {
      return;
    }

    this.options.onAction(action, selection);
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

    this.containerEl.setCssProps({
      "--conceptlens-toolbar-top": `${Math.round(top)}px`,
      "--conceptlens-toolbar-left": `${Math.round(left)}px`
    });
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
    this.closeButtonEl.setAttr("title", labels.close);
    this.closeButtonEl.setAttr("aria-label", labels.close);
  }
}

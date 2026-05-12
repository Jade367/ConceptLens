import { App, ButtonComponent, Component, MarkdownRenderer, Notice, setIcon } from "obsidian";
import { AiService } from "./aiService";
import { getUiLabels } from "./i18n";
import { AiAction, CapturedSelection, OutputLanguage } from "./types";

interface ResultModalOptions {
  selection: CapturedSelection;
  action: Exclude<AiAction, "card">;
  aiService: AiService;
  outputLanguage: OutputLanguage;
  onSave: (content: string) => Promise<void>;
  onClose?: () => void;
}

export class ExplanationModal {
  private containerEl: HTMLDivElement | null = null;
  private cardEl: HTMLDivElement | null = null;
  private contentEl: HTMLDivElement | null = null;
  private result = "";
  private resultEl!: HTMLDivElement;
  private saveButton!: ButtonComponent;
  private retryButton!: ButtonComponent;
  private renderer = new Component();
  private isClosed = true;
  private requestId = 0;
  private dragState: {
    pointerId: number;
    startX: number;
    startY: number;
    modalLeft: number;
    modalTop: number;
  } | null = null;

  constructor(private app: App, private options: ResultModalOptions) {}

  open(): void {
    this.close();
    this.isClosed = false;
    this.containerEl = document.body.createDiv({ cls: "modal-container conceptlens-modal-container" });
    this.cardEl = this.containerEl.createDiv({ cls: "modal conceptlens-modal-frame" });

    const closeButtonEl = this.cardEl.createEl("button", {
      cls: "modal-close-button",
      attr: {
        "aria-label": "Close result card",
        type: "button"
      }
    });
    setIcon(closeButtonEl, "x");
    closeButtonEl.addEventListener("click", () => this.close());

    this.contentEl = this.cardEl.createDiv({ cls: "modal-content" });
    this.renderer.load();
    this.renderShell();
    this.enableDrag();
    window.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("pointerdown", this.handleOutsidePointerDown, true);
    window.requestAnimationFrame(() => {
      if (!this.isClosed) {
        this.positionNearSelection();
      }
    });
    void this.loadResult();
  }

  close(): void {
    if (this.isClosed && !this.containerEl) {
      return;
    }

    this.isClosed = true;
    this.requestId += 1;
    this.dragState = null;
    this.disableDrag();
    window.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("pointerdown", this.handleOutsidePointerDown, true);
    this.renderer.unload();
    this.containerEl?.remove();
    this.containerEl = null;
    this.cardEl = null;
    this.contentEl = null;
    this.options.onClose?.();
  }

  private renderShell(): void {
    const contentEl = this.contentEl;
    if (!contentEl) {
      return;
    }

    const labels = getUiLabels(this.options.outputLanguage);
    contentEl.empty();
    contentEl.addClass("conceptlens-modal");
    contentEl.toggleClass("is-rtl", this.options.outputLanguage === "ar");
    contentEl.setAttr("dir", this.options.outputLanguage === "ar" ? "rtl" : "ltr");

    const headerEl = contentEl.createDiv({ cls: "conceptlens-modal-header" });
    headerEl.setAttr("aria-label", "Move result card");
    headerEl.createEl("div", {
      cls: "conceptlens-modal-title",
      text: "Concept lens"
    });
    headerEl.createEl("div", {
      cls: "conceptlens-modal-action",
      text: labels.actionTitles[this.options.action]
    });

    const termEl = contentEl.createDiv({ cls: "conceptlens-term" });
    termEl.createSpan({
      cls: "conceptlens-term-label",
      text: labels.selected
    });
    termEl.createSpan({
      cls: "conceptlens-term-text",
      text: formatSelectedText(this.options.selection.text)
    });

    this.resultEl = contentEl.createDiv({ cls: "conceptlens-result" });
    if (this.options.outputLanguage === "ar") {
      this.resultEl.addClass("is-rtl");
      this.resultEl.setAttr("dir", "rtl");
    } else {
      this.resultEl.setAttr("dir", "auto");
    }

    const disclaimerEl = contentEl.createDiv({ cls: "conceptlens-ai-disclaimer" });
    disclaimerEl.createSpan({ cls: "conceptlens-ai-disclaimer-title", text: labels.aiDisclaimerTitle });
    disclaimerEl.createSpan({ cls: "conceptlens-ai-disclaimer-body", text: labels.aiDisclaimerBody });

    const actionsEl = contentEl.createDiv({ cls: "conceptlens-actions" });

    this.retryButton = new ButtonComponent(actionsEl)
      .setButtonText(labels.retry)
      .onClick(() => {
        void this.loadResult();
      });

    this.saveButton = new ButtonComponent(actionsEl)
      .setButtonText(labels.save)
      .setCta()
      .onClick(async () => {
        if (!this.result) {
          new Notice(labels.stillWaitingNotice);
          return;
        }

        await this.options.onSave(this.result);
        this.close();
      });
  }

  private async loadResult(): Promise<void> {
    const currentRequestId = ++this.requestId;
    let slowTimer: number | null = null;
    const labels = getUiLabels(this.options.outputLanguage);
    this.result = "";
    this.saveButton.setDisabled(true);
    this.retryButton.setDisabled(true);
    this.resultEl.empty();
    this.resultEl.setText(labels.loading);
    slowTimer = window.setTimeout(() => {
      if (!this.shouldIgnoreResult(currentRequestId)) {
        this.resultEl.setText(labels.waiting);
      }
    }, 7000);

    try {
      const result = await this.options.aiService.run(this.options.action, this.options.selection);
      if (this.shouldIgnoreResult(currentRequestId)) {
        return;
      }

      this.result = result;
      this.resultEl.empty();
      await MarkdownRenderer.render(
        this.app,
        this.result,
        this.resultEl,
        this.options.selection.sourcePath ?? "",
        this.renderer
      );
      if (this.shouldIgnoreResult(currentRequestId)) {
        return;
      }
      this.saveButton.setDisabled(false);
      this.keepModalInViewport();
    } catch (error) {
      if (this.shouldIgnoreResult(currentRequestId)) {
        return;
      }

      this.resultEl.empty();
      this.resultEl.createDiv({
        cls: "conceptlens-error",
        text: error instanceof Error ? error.message : String(error)
      });
    } finally {
      if (slowTimer !== null) {
        window.clearTimeout(slowTimer);
      }
      if (!this.shouldIgnoreResult(currentRequestId)) {
        this.retryButton.setDisabled(false);
      }
    }
  }

  private shouldIgnoreResult(requestId: number): boolean {
    return this.isClosed || requestId !== this.requestId;
  }

  private enableDrag(): void {
    this.cardEl?.addEventListener("pointerdown", this.handleDragStart);
    this.cardEl?.addEventListener("pointermove", this.handleDragMove);
    this.cardEl?.addEventListener("pointerup", this.handleDragEnd);
    this.cardEl?.addEventListener("pointercancel", this.handleDragEnd);
  }

  private disableDrag(): void {
    this.cardEl?.removeEventListener("pointerdown", this.handleDragStart);
    this.cardEl?.removeEventListener("pointermove", this.handleDragMove);
    this.cardEl?.removeEventListener("pointerup", this.handleDragEnd);
    this.cardEl?.removeEventListener("pointercancel", this.handleDragEnd);
    this.cardEl?.removeClass("is-dragging");
  }

  private handleDragStart = (event: PointerEvent): void => {
    if (!this.cardEl || event.button !== 0 || !this.canStartDrag(event.target)) {
      return;
    }

    const rect = this.cardEl.getBoundingClientRect();
    this.dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      modalLeft: rect.left,
      modalTop: rect.top
    };
    this.cardEl.addClass("is-dragging");
    this.cardEl.setPointerCapture(event.pointerId);
    this.placeModal(rect.left, rect.top);
    event.preventDefault();
  };

  private handleDragMove = (event: PointerEvent): void => {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) {
      return;
    }

    const left = this.dragState.modalLeft + event.clientX - this.dragState.startX;
    const top = this.dragState.modalTop + event.clientY - this.dragState.startY;
    this.placeModal(left, top);
    event.preventDefault();
  };

  private handleDragEnd = (event: PointerEvent): void => {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) {
      return;
    }

    this.cardEl?.removeClass("is-dragging");
    if (this.cardEl?.hasPointerCapture(event.pointerId)) {
      this.cardEl.releasePointerCapture(event.pointerId);
    }
    this.dragState = null;
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      this.close();
    }
  };

  private handleOutsidePointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (target instanceof Node && this.cardEl?.contains(target)) {
      return;
    }

    this.close();
  };

  private canStartDrag(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const blockedSelector = [
      ".conceptlens-result",
      ".conceptlens-term-text",
      ".conceptlens-actions",
      ".modal-close-button",
      "button",
      "a",
      "input",
      "textarea",
      "select",
      "[contenteditable='true']"
    ].join(",");
    if (target.closest(blockedSelector)) {
      return false;
    }

    return Boolean(target.closest(".conceptlens-modal-header, .conceptlens-term, .conceptlens-ai-disclaimer, .conceptlens-modal"));
  }

  private placeModal(left: number, top: number): void {
    if (!this.cardEl) {
      return;
    }

    const rect = this.cardEl.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const nextLeft = clamp(left, margin, maxLeft);
    const nextTop = clamp(top, margin, maxTop);

    this.cardEl.setCssProps({
      "--conceptlens-modal-left": `${Math.round(nextLeft)}px`,
      "--conceptlens-modal-top": `${Math.round(nextTop)}px`
    });
  }

  private positionNearSelection(): void {
    if (!this.cardEl) {
      return;
    }

    const selectionRect = this.options.selection.rect;
    const modalRect = this.cardEl.getBoundingClientRect();
    const margin = 10;
    const gap = 8;

    if (!isUsableRect(selectionRect) || modalRect.width <= 0 || modalRect.height <= 0) {
      this.placeModal(window.innerWidth - modalRect.width - 18, 72);
      return;
    }

    const selectionCenter = selectionRect.left + selectionRect.width / 2;
    const preferredLeft = selectionCenter - modalRect.width / 2;
    const belowTop = selectionRect.bottom + gap;
    const aboveTop = selectionRect.top - modalRect.height - gap;
    const hasRoomBelow = belowTop + modalRect.height <= window.innerHeight - margin;
    const top = hasRoomBelow || aboveTop < margin ? belowTop : aboveTop;

    this.placeModal(preferredLeft, top);
  }

  private keepModalInViewport(): void {
    if (!this.cardEl) {
      return;
    }

    const rect = this.cardEl.getBoundingClientRect();
    this.placeModal(rect.left, rect.top);
  }
}

function formatSelectedText(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function isUsableRect(rect: CapturedSelection["rect"]): boolean {
  return [rect.top, rect.right, rect.bottom, rect.left, rect.width, rect.height].every(Number.isFinite);
}

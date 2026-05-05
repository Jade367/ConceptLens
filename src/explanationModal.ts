import { App, ButtonComponent, Component, MarkdownRenderer, Modal, Notice } from "obsidian";
import { AiService } from "./aiService";
import { getUiLabels } from "./i18n";
import { AiAction, CapturedSelection, OutputLanguage } from "./types";

interface ResultModalOptions {
  selection: CapturedSelection;
  action: Exclude<AiAction, "card">;
  aiService: AiService;
  outputLanguage: OutputLanguage;
  onSave: (content: string) => Promise<void>;
}

export class ExplanationModal extends Modal {
  private result = "";
  private resultEl!: HTMLDivElement;
  private saveButton!: ButtonComponent;
  private retryButton!: ButtonComponent;
  private renderer = new Component();
  private isClosed = false;
  private requestId = 0;

  constructor(app: App, private options: ResultModalOptions) {
    super(app);
  }

  onOpen(): void {
    this.isClosed = false;
    this.modalEl.addClass("conceptlens-modal-frame");
    this.renderer.load();
    this.renderShell();
    void this.loadResult();
  }

  onClose(): void {
    this.isClosed = true;
    this.requestId += 1;
    this.renderer.unload();
  }

  private renderShell(): void {
    const { contentEl } = this;
    const labels = getUiLabels(this.options.outputLanguage);
    contentEl.empty();
    contentEl.addClass("conceptlens-modal");
    contentEl.toggleClass("is-rtl", this.options.outputLanguage === "ar");
    contentEl.setAttr("dir", this.options.outputLanguage === "ar" ? "rtl" : "ltr");

    const headerEl = contentEl.createDiv({ cls: "conceptlens-modal-header" });
    headerEl.createEl("div", {
      cls: "conceptlens-modal-title",
      text: "ConceptLens"
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
}

function formatSelectedText(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

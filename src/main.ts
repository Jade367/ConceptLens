import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { AiService } from "./aiService";
import { ExplanationModal } from "./explanationModal";
import { FloatingToolbar } from "./floatingToolbar";
import { NoteCreator } from "./noteCreator";
import { captureReadingSelection, createEditorSelectionExtension, SelectionSnapshot } from "./selectionCapture";
import { ConceptLensSettingTab } from "./settings";
import { CapturedSelection, ConceptLensAction, ConceptLensSettings, DEFAULT_SETTINGS } from "./types";

export default class ConceptLensPlugin extends Plugin {
  settings: ConceptLensSettings = { ...DEFAULT_SETTINGS };

  private toolbar!: FloatingToolbar;
  private aiService!: AiService;
  private noteCreator!: NoteCreator;
  private activeResultCard: ExplanationModal | null = null;
  private readingSelectionTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.aiService = new AiService(() => this.settings, async (preset, keyFingerprint) => {
      if (this.settings.providerPreset !== "auto") {
        return;
      }

      this.settings.autoDetectedProvider = preset;
      this.settings.autoDetectedKeyFingerprint = keyFingerprint;
      await this.saveSettings();
    });
    this.noteCreator = new NoteCreator(this.app, () => this.settings);
    this.toolbar = new FloatingToolbar({
      getOutputLanguage: () => this.settings.outputLanguage,
      onAction: (action, selection) => {
        void this.handleToolbarAction(action, selection);
      }
    });

    this.addSettingTab(new ConceptLensSettingTab(this.app, this));
    this.addCommand({
      id: "close-floating-ui",
      name: "Close floating UI",
      callback: () => {
        this.closeFloatingUi();
      }
    });

    this.registerEditorExtension(
      createEditorSelectionExtension((selection) => {
        this.handleEditorSelection(selection);
      })
    );

    this.registerDomEvent(document, "selectionchange", () => {
      this.scheduleReadingSelectionCapture();
    });
    this.registerDomEvent(document, "mouseup", () => {
      this.scheduleReadingSelectionCapture();
    });
    this.registerDomEvent(document, "pointerdown", (event) => {
      if (!this.toolbar.isEventInside(event)) {
        this.toolbar.hide();
      }
    }, true);
    this.registerDomEvent(document, "keydown", (event) => {
      if (event.key === "Escape") {
        this.closeFloatingUi();
      }
    });
    this.registerDomEvent(window, "scroll", () => {
      this.toolbar.hide();
    }, true);
  }

  onunload(): void {
    if (this.readingSelectionTimer !== null) {
      window.clearTimeout(this.readingSelectionTimer);
    }
    this.toolbar?.destroy();
    this.activeResultCard?.close();
  }

  async loadSettings(): Promise<void> {
    const data = ((await this.loadData()) ?? {}) as Partial<ConceptLensSettings> & { provider?: unknown };
    const { provider: _provider, ...settings } = data;

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...settings
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  hideToolbar(): void {
    this.toolbar.hide();
  }

  closeFloatingUi(): void {
    this.toolbar.hide();
    this.activeResultCard?.close();
    this.activeResultCard = null;
  }

  private handleEditorSelection(selection: SelectionSnapshot | null): void {
    if (!this.settings.floatingToolbarEnabled) {
      this.toolbar.hide();
      return;
    }

    if (!selection) {
      this.toolbar.hide("editor");
      return;
    }

    this.toolbar.show(this.withActiveFile(selection));
  }

  private scheduleReadingSelectionCapture(): void {
    if (this.readingSelectionTimer !== null) {
      window.clearTimeout(this.readingSelectionTimer);
    }

    this.readingSelectionTimer = window.setTimeout(() => {
      this.readingSelectionTimer = null;
      this.handleReadingSelection();
    }, 120);
  }

  private handleReadingSelection(): void {
    if (!this.settings.floatingToolbarEnabled) {
      this.toolbar.hide();
      return;
    }

    const selection = captureReadingSelection();
    if (!selection) {
      if (this.toolbar.getSource() !== "editor") {
        this.toolbar.hide("reading");
      }
      return;
    }

    this.toolbar.show(this.withActiveFile(selection));
  }

  private async handleToolbarAction(action: ConceptLensAction, selection: CapturedSelection): Promise<void> {
    this.toolbar.hide();

    if (action === "save") {
      await this.saveSelection(selection);
      return;
    }

    this.activeResultCard?.close();
    const resultCard = new ExplanationModal(this.app, {
      selection,
      action,
      aiService: this.aiService,
      outputLanguage: this.settings.outputLanguage,
      onSave: async (content) => {
        await this.noteCreator.createConceptNote(selection, content);
      },
      onClose: () => {
        if (this.activeResultCard === resultCard) {
          this.activeResultCard = null;
        }
      }
    });
    this.activeResultCard = resultCard;
    resultCard.open();
  }

  private async saveSelection(selection: CapturedSelection): Promise<void> {
    try {
      const existing = await this.noteCreator.openExistingConceptNote(selection);
      if (existing) {
        return;
      }

      new Notice("ConceptLens is generating a concept card...");
      const content = await this.aiService.generateConceptCard(selection);
      await this.noteCreator.createConceptNote(selection, content);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  private withActiveFile(selection: SelectionSnapshot): CapturedSelection {
    const file = this.getFileForSelection(selection) ?? this.app.workspace.getActiveFile();
    return {
      ...selection,
      sourcePath: file instanceof TFile ? file.path : undefined,
      sourceName: file instanceof TFile ? file.basename : undefined
    };
  }

  private getFileForSelection(selection: SelectionSnapshot): TFile | null {
    const sourceElement = selection.sourceElement;
    if (!sourceElement) {
      return null;
    }

    const leaf = this.app.workspace
      .getLeavesOfType("markdown")
      .find((candidate) => candidate.view instanceof MarkdownView && candidate.view.containerEl.contains(sourceElement));

    if (leaf?.view instanceof MarkdownView && leaf.view.file instanceof TFile) {
      return leaf.view.file;
    }

    const path = sourceElement.closest("[data-path]")?.getAttribute("data-path");
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (file instanceof TFile) {
      return file;
    }

    return null;
  }
}

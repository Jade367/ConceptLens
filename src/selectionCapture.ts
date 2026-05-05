import { EditorState, Text } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { CapturedSelection, SelectionRect } from "./types";

export type SelectionSnapshot = Omit<CapturedSelection, "sourcePath" | "sourceName">;
export type SelectionHandler = (selection: SelectionSnapshot | null) => void;

const MAX_CONTEXT_CHARS = 1600;
const READING_CONTEXT_SELECTOR = "p, li, blockquote, pre, table, h1, h2, h3, h4, h5, h6";

interface RectLike {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function createEditorSelectionExtension(onSelection: SelectionHandler) {
  return ViewPlugin.fromClass(
    class {
      private timer: number | null = null;

      update(update: ViewUpdate): void {
        if (update.selectionSet || update.docChanged || update.focusChanged || update.viewportChanged) {
          this.schedule(update.view);
        }
      }

      destroy(): void {
        if (this.timer !== null) {
          window.clearTimeout(this.timer);
        }
      }

      private schedule(view: EditorView): void {
        if (this.timer !== null) {
          window.clearTimeout(this.timer);
        }

        this.timer = window.setTimeout(() => {
          this.timer = null;
          onSelection(captureEditorSelection(view));
        }, 120);
      }
    }
  );
}

export function captureEditorSelection(view: EditorView): SelectionSnapshot | null {
  if (!view.hasFocus) {
    return null;
  }

  const selection = view.state.selection.main;
  if (selection.empty) {
    return null;
  }

  const from = Math.min(selection.from, selection.to);
  const to = Math.max(selection.from, selection.to);
  const text = view.state.sliceDoc(from, to).trim();
  if (!text) {
    return null;
  }

  const startRect = view.coordsAtPos(from, 1) ?? view.coordsAtPos(from, -1);
  const endRect = view.coordsAtPos(to, -1) ?? view.coordsAtPos(to, 1) ?? startRect;
  if (!startRect || !endRect) {
    return null;
  }

  return {
    text,
    context: getEditorParagraphContext(view.state, from, to),
    rect: mergeRects(startRect, endRect),
    source: "editor"
  };
}

export function captureReadingSelection(): SelectionSnapshot | null {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const text = selection.toString().trim();
  if (!text) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const element = getElementFromNode(range.commonAncestorContainer);
  const preview = getReadingPreviewElement(range, element);
  if (!preview) {
    return null;
  }

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return null;
  }

  return {
    text,
    context: getReadingRangeContext(range, preview, text) || getReadingContext(element, text) || text,
    rect: toSelectionRect(rect),
    source: "reading",
    sourceElement: preview
  };
}

function getEditorParagraphContext(state: EditorState, from: number, to: number): string {
  const doc = state.doc;
  const startLine = doc.lineAt(from).number;
  const endLine = doc.lineAt(to).number;

  let firstLine = startLine;
  let lastLine = endLine;

  while (firstLine > 1 && doc.line(firstLine - 1).text.trim() !== "") {
    firstLine -= 1;
  }

  while (lastLine < doc.lines && doc.line(lastLine + 1).text.trim() !== "") {
    lastLine += 1;
  }

  const lines: string[] = [];
  for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
    lines.push(doc.line(lineNumber).text);
  }

  const paragraph = lines.join("\n").trim();
  if (paragraph.length <= MAX_CONTEXT_CHARS) {
    return paragraph;
  }

  return trimAroundSelection(doc, from, to);
}

function trimAroundSelection(doc: Text, from: number, to: number): string {
  const halfWindow = Math.floor(MAX_CONTEXT_CHARS / 2);
  const start = Math.max(0, from - halfWindow);
  const end = Math.min(doc.length, to + halfWindow);
  return doc.sliceString(start, end).trim();
}

function getReadingPreviewElement(range: Range, fallbackElement: Element | null): Element | null {
  const startElement = getElementFromNode(range.startContainer);
  const endElement = getElementFromNode(range.endContainer);
  return (
    startElement?.closest(".markdown-preview-view") ??
    endElement?.closest(".markdown-preview-view") ??
    fallbackElement?.closest(".markdown-preview-view") ??
    null
  );
}

function getReadingRangeContext(range: Range, preview: Element, selectedText: string): string {
  const blocks = Array.from(preview.querySelectorAll(READING_CONTEXT_SELECTOR))
    .filter((block) => rangeIntersectsNode(range, block))
    .filter((block, _index, allBlocks) => !allBlocks.some((other) => other !== block && other.contains(block)));

  const text = blocks
    .map((block) => block.textContent?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return trimReadingContext(text, selectedText);
}

function getReadingContext(element: Element | null, selectedText: string): string {
  const contextEl = element?.closest(READING_CONTEXT_SELECTOR);
  const text = contextEl?.textContent?.trim() ?? "";
  return trimReadingContext(text, selectedText);
}

function rangeIntersectsNode(range: Range, node: Node): boolean {
  try {
    return range.intersectsNode(node);
  } catch {
    return false;
  }
}

function trimReadingContext(text: string, selectedText: string): string {
  if (!text) {
    return "";
  }

  if (text.length <= MAX_CONTEXT_CHARS) {
    return text;
  }

  const selected = selectedText.trim();
  const selectedNeedle = selected.length > 180 ? selected.slice(0, 180) : selected;
  const selectedIndex = selectedNeedle ? text.indexOf(selectedNeedle) : -1;
  if (selectedIndex === -1) {
    return text.slice(0, MAX_CONTEXT_CHARS).trim();
  }

  const halfWindow = Math.floor(MAX_CONTEXT_CHARS / 2);
  const start = Math.max(0, selectedIndex - halfWindow);
  const end = Math.min(text.length, selectedIndex + selected.length + halfWindow);
  return text.slice(start, end).trim();
}

function getElementFromNode(node: Node): Element | null {
  if (node instanceof Element) {
    return node;
  }
  return node.parentElement;
}

function mergeRects(first: RectLike, second: RectLike): SelectionRect {
  const top = Math.min(first.top, second.top);
  const right = Math.max(first.right, second.right);
  const bottom = Math.max(first.bottom, second.bottom);
  const left = Math.min(first.left, second.left);

  return {
    top,
    right,
    bottom,
    left,
    width: right - left,
    height: bottom - top
  };
}

function toSelectionRect(rect: DOMRect): SelectionRect {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height
  };
}

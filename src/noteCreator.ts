import { App, normalizePath, Notice, TFile, TFolder } from "obsidian";
import { getUiLabels } from "./i18n";
import { CapturedSelection, ConceptLensSettings } from "./types";

interface ConceptNoteTarget {
  title: string;
  path: string;
}

const MAX_TITLE_CHARS = 80;
const MAX_TITLE_WORDS = 10;
const HASH_LENGTH = 6;

export class NoteCreator {
  constructor(
    private app: App,
    private getSettings: () => ConceptLensSettings
  ) {}

  async openExistingConceptNote(selection: CapturedSelection, aiContent?: string): Promise<TFile | null> {
    const target = this.getConceptNoteTarget(selection, aiContent);
    const existing = this.app.vault.getAbstractFileByPath(target.path);

    if (existing instanceof TFile) {
      new Notice(`Concept already exists: ${target.title}`);
      await this.app.workspace.getLeaf(false).openFile(existing);
      return existing;
    }

    if (existing) {
      throw new Error(`Cannot create concept note because ${target.path} already exists and is not a file.`);
    }

    return null;
  }

  async createConceptNote(selection: CapturedSelection, aiContent: string): Promise<TFile> {
    const target = this.getConceptNoteTarget(selection, aiContent);
    const folder = target.path.slice(0, target.path.lastIndexOf("/"));
    await this.ensureFolder(folder);

    const existing = this.app.vault.getAbstractFileByPath(target.path);

    if (existing instanceof TFile) {
      new Notice(`Concept already exists: ${target.title}`);
      await this.app.workspace.getLeaf(false).openFile(existing);
      return existing;
    }

    if (existing) {
      throw new Error(`Cannot create concept note because ${target.path} already exists and is not a file.`);
    }

    const file = await this.app.vault.create(target.path, this.buildMarkdown(target.title, selection, aiContent));
    new Notice(`Saved concept: ${target.title}`);
    await this.app.workspace.getLeaf(false).openFile(file);
    return file;
  }

  private getConceptNoteTarget(selection: CapturedSelection, aiContent?: string): ConceptNoteTarget {
    const settings = this.getSettings();
    const folder = normalizeConceptFolder(settings.conceptFolder);
    const title = toConceptTitle(extractConceptTitle(aiContent) ?? selection.text);
    const fileName = sanitizeFileName(title);

    return {
      title,
      path: normalizePath(`${folder}/${fileName}.md`)
    };
  }

  private async ensureFolder(folder: string): Promise<void> {
    const parts = folder.split("/").filter(Boolean);
    let current = "";

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (!existing) {
        await this.app.vault.createFolder(current);
      } else if (!(existing instanceof TFolder)) {
        throw new Error(`Cannot create folder ${current}; a file already exists at that path.`);
      }
    }
  }

  private buildMarkdown(title: string, selection: CapturedSelection, aiContent: string): string {
    const body = normalizeCardBody(aiContent, selection);
    const sourceNote = selection.sourceName ?? selection.sourcePath ?? "Unknown";
    const labels = getUiLabels(this.getSettings().outputLanguage);

    return [
      "---",
      "type: concept",
      `term: ${yamlString(title)}`,
      `created: ${formatDate(new Date())}`,
      `source_note: ${yamlString(sourceNote)}`,
      "status: seed",
      "---",
      "",
      `# ${title}`,
      "",
      `> [!warning] ${labels.aiDisclaimerTitle}`,
      `> ${labels.aiDisclaimerBody}`,
      "",
      body,
      ""
    ].join("\n");
  }
}

function normalizeConceptFolder(folder: string): string {
  const normalized = normalizePath(folder.trim() || "Concepts").replace(/^\/+|\/+$/g, "");
  return normalized || "Concepts";
}

function normalizeCardBody(aiContent: string, selection: CapturedSelection): string {
  const content = stripLeadingTitleHeading(aiContent.trim());
  const intro = extractIntroParagraph(content);
  if (hasAnyHeading(content, SECTION_ALIASES.definition) && hasAnyHeading(content, SECTION_ALIASES.context)) {
    return content;
  }

  const contextualMeaning = extractSection(content, SECTION_ALIASES.contextualMeaning);
  const definition = extractSection(content, SECTION_ALIASES.definition);
  const explanation = extractSection(content, SECTION_ALIASES.explanation);
  const judgment = extractSection(content, SECTION_ALIASES.judgment);
  const example = extractSection(content, SECTION_ALIASES.example);
  const related = extractSection(content, SECTION_ALIASES.related);

  const sections = [
    "## Definition",
    definition || explanation || contextualMeaning || intro || `${selection.text} is a concept captured from the source context.`,
    "",
    "## Explanation",
    explanation || contextualMeaning || intro || "To be expanded.",
    "",
    "## Contextual Judgment",
    judgment || contextualMeaning || "To be expanded.",
    "",
    "## Context",
    "原文语境：",
    "",
    blockquote(selection.context || selection.text),
    "",
    "## Why it matters",
    extractSection(content, SECTION_ALIASES.whyItMatters) || "To be expanded.",
    "",
    "## Example",
    example || "To be expanded.",
    "",
    "## Related Concepts",
    related || "- "
  ];

  return sections.join("\n");
}

function extractConceptTitle(aiContent?: string): string | null {
  const heading = aiContent?.match(/^\s*#\s+(.+?)\s*$/m);
  const title = cleanInlineMarkdown(heading?.[1] ?? "").trim();
  return title || null;
}

function stripLeadingTitleHeading(markdown: string): string {
  return markdown.replace(/^\s*#\s+.+?(?:\r?\n)+/, "").trim();
}

function extractIntroParagraph(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const collected: string[] = [];

  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      break;
    }
    collected.push(line);
  }

  return collected.join("\n").trim();
}

const SECTION_ALIASES = {
  definition: ["Definition", "定义", "정의", "定義", "التعريف"],
  explanation: [
    "Explanation",
    "Plain Explanation",
    "中文解释",
    "한국어 설명",
    "日本語での説明",
    "شرح بالعربية",
    "解释",
    "簡短解释",
    "번역",
    "翻訳",
    "الترجمة",
    "Translation",
    "翻译"
  ],
  contextualMeaning: [
    "当前语境中的意思",
    "语境判断",
    "Contextual Reading",
    "Contextual Judgment",
    "문맥상 의미",
    "문맥 판단",
    "文脈上の意味",
    "文脈判断",
    "المعنى في السياق",
    "الحكم السياقي",
    "取义",
    "取義"
  ],
  judgment: [
    "语境判断",
    "Contextual Judgment",
    "判断依据",
    "Evidence",
    "依据",
    "근거",
    "根拠",
    "الدليل",
    "문맥 판단",
    "文脈判断",
    "الحكم السياقي"
  ],
  context: ["Context", "语境", "문맥", "文脈", "السياق"],
  whyItMatters: ["Why it matters", "Why It Matters", "为什么重要", "重要性", "중요성", "لماذا يهم", "背景知识"],
  example: ["Example", "例子", "예시", "例", "مثال"],
  related: ["Related Concepts", "相关概念", "関連概念", "관련 개념", "مفاهيم مرتبطة"]
};

function extractSection(markdown: string, names: string[]): string {
  const lines = markdown.split(/\r?\n/);
  let active = false;
  const collected: string[] = [];

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (heading) {
      if (active) {
        break;
      }
      active = names.some((name) => heading[1].trim().toLowerCase() === name.toLowerCase());
      continue;
    }

    if (active) {
      collected.push(line);
    }
  }

  return collected.join("\n").trim();
}

function hasAnyHeading(markdown: string, names: string[]): boolean {
  return names.some((name) => new RegExp(`^#{1,3}\\s+${escapeRegExp(name)}\\s*$`, "im").test(markdown));
}

function blockquote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function toConceptTitle(text: string): string {
  const cleaned = cleanInlineMarkdown(text)
    .replace(/\s+/g, " ")
    .replace(/^["'`*_([{<]+|["'`*_\])}>.,;:!?]+$/g, "")
    .trim();

  if (!cleaned) {
    return "Untitled Concept";
  }

  const shortEnough = cleaned.length <= MAX_TITLE_CHARS && cleaned.split(" ").length <= MAX_TITLE_WORDS;
  const candidate = shortEnough ? cleaned : shortenConceptTitle(cleaned);

  return candidate
    .split(" ")
    .map((word) => {
      if (word.length <= 1 || /[A-Z]/.test(word.slice(1)) || word === word.toUpperCase()) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function cleanInlineMarkdown(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*#>\s]+/g, "")
    .trim();
}

function sanitizeFileName(title: string): string {
  return title
    .replace(/[\\/:*?"<>|#^[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_CHARS + HASH_LENGTH + 3)
    .trim() || "Untitled Concept";
}

function shortenConceptTitle(text: string): string {
  const sentenceStart = text.split(/[.!?。！？；;\n]/)[0]?.trim();
  const base = sentenceStart && sentenceStart.length >= 2 ? sentenceStart : text;
  const words = base.split(" ");
  const shortened = words.length > 1
    ? words.slice(0, MAX_TITLE_WORDS).join(" ")
    : Array.from(base).slice(0, MAX_TITLE_CHARS).join("");
  const clipped = Array.from(shortened).slice(0, MAX_TITLE_CHARS).join("").trim();
  return `${clipped} ${shortHash(text)}`.trim();
}

function shortHash(text: string): string {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36).slice(0, HASH_LENGTH).padStart(HASH_LENGTH, "0");
}

function yamlString(value: string): string {
  return JSON.stringify(value.replace(/\r?\n/g, " "));
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

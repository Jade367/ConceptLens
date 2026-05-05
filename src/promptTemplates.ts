import { AiAction, CapturedSelection, OutputLanguage } from "./types";

const LANGUAGE_INSTRUCTIONS: Record<OutputLanguage, string> = {
  bilingual: "Use Chinese as the main explanation language, keep important English terms, and add concise English glosses when useful.",
  zh: "Use Chinese. Keep the selected term in its original language when it is a technical term.",
  en: "Use English. Do not add Chinese unless the selected source text itself needs a gloss.",
  ko: "Use Korean. Keep technical terms in their original language when useful, and add Korean explanations naturally.",
  ja: "Use Japanese. Keep technical terms in their original language when useful, and write in a concise academic style.",
  ar: "Use Arabic. Keep technical terms in their original language when useful, and write right-to-left friendly Arabic prose."
};

interface SectionLabels {
  translation: string;
  contextualChoice: string;
  expansion: string;
  confusions: string;
  relatedConcepts: string;
  evidence: string;
  definition: string;
  chineseExplanation: string;
  contextualJudgment: string;
  context: string;
  whyItMatters: string;
  example: string;
}

const SECTION_LABELS: Record<OutputLanguage, SectionLabels> = {
  bilingual: {
    translation: "翻译 / Translation",
    contextualChoice: "取义 / Context",
    expansion: "拓展",
    confusions: "容易混淆",
    relatedConcepts: "相关概念",
    evidence: "依据",
    definition: "Definition",
    chineseExplanation: "中文解释",
    contextualJudgment: "语境判断",
    context: "Context",
    whyItMatters: "Why it matters",
    example: "Example"
  },
  zh: {
    translation: "翻译",
    contextualChoice: "取义",
    expansion: "拓展",
    confusions: "容易混淆",
    relatedConcepts: "相关概念",
    evidence: "依据",
    definition: "定义",
    chineseExplanation: "中文解释",
    contextualJudgment: "语境判断",
    context: "语境",
    whyItMatters: "为什么重要",
    example: "例子"
  },
  en: {
    translation: "Translation",
    contextualChoice: "Contextual Reading",
    expansion: "Expansion",
    confusions: "Do Not Confuse With",
    relatedConcepts: "Related Concepts",
    evidence: "Evidence",
    definition: "Definition",
    chineseExplanation: "Plain Explanation",
    contextualJudgment: "Contextual Judgment",
    context: "Context",
    whyItMatters: "Why It Matters",
    example: "Example"
  },
  ko: {
    translation: "번역",
    contextualChoice: "문맥상 의미",
    expansion: "확장",
    confusions: "혼동하기 쉬운 개념",
    relatedConcepts: "관련 개념",
    evidence: "근거",
    definition: "정의",
    chineseExplanation: "한국어 설명",
    contextualJudgment: "문맥 판단",
    context: "문맥",
    whyItMatters: "중요성",
    example: "예시"
  },
  ja: {
    translation: "翻訳",
    contextualChoice: "文脈上の意味",
    expansion: "発展",
    confusions: "混同しやすい概念",
    relatedConcepts: "関連概念",
    evidence: "根拠",
    definition: "定義",
    chineseExplanation: "日本語での説明",
    contextualJudgment: "文脈判断",
    context: "文脈",
    whyItMatters: "重要性",
    example: "例"
  },
  ar: {
    translation: "الترجمة",
    contextualChoice: "المعنى في السياق",
    expansion: "توسيع",
    confusions: "لا تخلط بينه وبين",
    relatedConcepts: "مفاهيم مرتبطة",
    evidence: "الدليل",
    definition: "التعريف",
    chineseExplanation: "شرح بالعربية",
    contextualJudgment: "الحكم السياقي",
    context: "السياق",
    whyItMatters: "لماذا يهم",
    example: "مثال"
  }
};

export function buildSystemInstruction(outputLanguage: OutputLanguage): string {
  return [
    "You are ConceptLens, an Obsidian reading assistant.",
    "Your job is to turn a selected fragment and its local context into a precise, reusable reading aid.",
    "Stay grounded in the provided context. Do not invent citations, sources, or background facts not needed for the task.",
    "Be concise. Prefer the smallest answer that fully satisfies the selected action.",
    LANGUAGE_INSTRUCTIONS[outputLanguage]
  ].join("\n");
}

export function buildPrompt(action: AiAction, selection: CapturedSelection, outputLanguage: OutputLanguage): string {
  const contextBlock = buildContextBlock(selection);
  const labels = SECTION_LABELS[outputLanguage];

  if (action === "overview") {
    return [
      "Action: Overview.",
      "Specialization: Combine explanation, contextual translation, expansion, and save-worthy concept structure into one compact reading card.",
      contextBlock,
      "Rules:",
      "- Do not produce four separate long answers.",
      "- Keep it compact, layered, and useful for deciding whether to save the concept.",
      "- Start with the best concept title or translation as the main title.",
      "- Ground every claim in the supplied context.",
      "- Use Obsidian wikilinks only for genuinely related concepts.",
      "",
      "Return Markdown only, using exactly these sections:",
      "# {best concept title or translation}",
      "2 short sentences: first the contextual meaning, then the general concept explanation.",
      "",
      `### ${labels.translation}`,
      "Best contextual translation or wording, plus one compact clue.",
      "",
      `### ${labels.expansion}`,
      "- 2 concise bullets expanding the idea.",
      "",
      `### ${labels.relatedConcepts}`,
      "- [[Concept One]]",
      "- [[Concept Two]]",
      "- [[Concept Three]]",
      "",
      LANGUAGE_INSTRUCTIONS[outputLanguage]
    ].join("\n");
  }

  if (action === "translate") {
    return [
      "Action: Translate.",
      "Specialization: Translate only. Do not explain the concept unless needed to prevent a wrong translation.",
      contextBlock,
      "Rules:",
      "- Translate the selected text according to its meaning in the supplied context.",
      "- If the selection is a term or short phrase, return one best contextual translation.",
      "- Do not add examples, related concepts, study questions, or background.",
      "- Maximum length after the title: 2 short sentences.",
      "",
      "Return Markdown only, using exactly these sections:",
      "# {the best translation itself}",
      "One short sentence explaining the translation in context.",
      "",
      `### ${labels.contextualChoice}`,
      "One compact phrase naming the context clue.",
      "",
      LANGUAGE_INSTRUCTIONS[outputLanguage]
    ].join("\n");
  }

  if (action === "expand") {
    return [
      "Action: Expand.",
      "Specialization: Build a short learning extension around the selected concept.",
      contextBlock,
      "Rules:",
      "- Start from the contextual meaning, then expand outward.",
      "- Prioritize background, contrasts, and reading connections.",
      "- Do not simply repeat a definition.",
      "- Keep the expansion useful for a student or researcher reading this note.",
      "",
      "Return Markdown only, using exactly these sections:",
      "# {short concept title}",
      "One sentence stating what the concept means in this passage.",
      "",
      `### ${labels.expansion}`,
      "2-4 concise bullets expanding the idea beyond the current passage.",
      "",
      `### ${labels.confusions}`,
      "- 1-3 nearby concepts or meanings that should not be confused with it.",
      "",
      `### ${labels.relatedConcepts}`,
      "- [[Concept One]]",
      "- [[Concept Two]]",
      "- [[Concept Three]]",
      "",
      LANGUAGE_INSTRUCTIONS[outputLanguage]
    ].join("\n");
  }

  if (action === "card") {
    return [
      "Action: Create concept card.",
      "Specialization: Write a durable Obsidian concept note from the selected text and context.",
      contextBlock,
      "Rules:",
      "- Extract or normalize a concept from the selection.",
      "- Make the card reusable outside this source note, but keep the original context visible.",
      "- Use wikilinks only for genuinely related concepts.",
      "- Do not include YAML front matter; the plugin will add it.",
      "",
      "Return Markdown only, using exactly these sections:",
      `## ${labels.definition}`,
      "A clear definition in 1-3 sentences.",
      "",
      `## ${labels.chineseExplanation}`,
      "A precise explanation in the selected output language.",
      "",
      `## ${labels.contextualJudgment}`,
      "The meaning in this source context and the clue that supports it.",
      "",
      `## ${labels.context}`,
      "How this concept is being used in the supplied passage.",
      "",
      `## ${labels.whyItMatters}`,
      "Why this concept is worth remembering.",
      "",
      `## ${labels.example}`,
      "One concrete example.",
      "",
      `## ${labels.relatedConcepts}`,
      "- [[Concept One]]",
      "- [[Concept Two]]",
      "- [[Concept Three]]",
      "",
      LANGUAGE_INSTRUCTIONS[outputLanguage]
    ].join("\n");
  }

  return [
    "Action: Explain.",
    "Specialization: Explain only. Do not expand, teach broadly, list related concepts, or give examples.",
    contextBlock,
    "Rules:",
    "- First state what the selected text means in this exact context.",
    "- Then give the shortest useful general explanation.",
    "- Do not include examples.",
    "- Do not include related concepts.",
    "- Do not include study questions or background reading.",
    "- Maximum length after the title: 2 short sentences.",
    "",
    "Return Markdown only, using exactly these sections:",
    "# {short concept title}",
    "A compact explanation grounded in the local context.",
    "",
    `### ${labels.evidence}`,
    "One compact phrase naming the context clue.",
    "",
    LANGUAGE_INSTRUCTIONS[outputLanguage]
  ].join("\n");
}

function buildContextBlock(selection: CapturedSelection): string {
  return [
    "Input:",
    `Selected text: ${selection.text}`,
    `Source note: ${selection.sourceName ?? "Unknown"}`,
    "Local context:",
    selection.context || selection.text
  ].join("\n");
}

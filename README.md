# ConceptLens

ConceptLens is an Obsidian plugin for capturing unfamiliar terms, concepts, theories, and technical vocabulary while reading.

Select text in a note and ConceptLens shows a floating toolbar for AI-powered overview, explanation, translation, expansion, and concept-card creation.

## Features

- Selection-based floating toolbar in editing and reading views.
- Context-aware AI overview, explanation, translation, and expansion.
- One-click concept note creation in a configurable folder.
- Duplicate concept detection that opens an existing concept note instead of creating copies.
- Multilingual output support: Chinese, English, Korean, Japanese, Arabic, and Chinese + English.
- Right-to-left display support for Arabic output.
- OpenAI-compatible provider presets including OpenAI, Kimi, Qwen, GLM, Doubao, DeepSeek, SiliconFlow, OpenRouter, Anthropic, Gemini, and custom endpoints.

## How it works

1. Select a word, phrase, or sentence in Obsidian.
2. Choose an action from the floating toolbar:
   - Overview
   - Explain
   - Translate
   - Expand
   - Save
3. ConceptLens uses the selected text and nearby context to generate a reading card.
4. Save the result as a reusable concept note.

## Settings

ConceptLens settings include:

- AI API key
- Provider preset or custom endpoint
- Optional model override
- Optional active provider probing
- Request timeout
- Concept folder
- Output language
- Floating toolbar toggle

## Privacy and AI requests

ConceptLens does not include its own AI service or proxy.

When you use an AI action, the plugin sends the selected text and local context from the current note to the AI provider configured in your settings. Your API key is stored in the plugin's local Obsidian settings for the current vault.

By default, Auto-detect only uses safe key-prefix checks. It does not send one API key to multiple providers. If you enable Active provider probing in Advanced settings, ConceptLens may send tiny probe requests with that key to supported providers until one accepts it.

Review your selected AI provider's privacy and data retention policies before using the plugin with sensitive notes.

## Manual installation

1. Download the latest release assets:
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Create a folder in your vault:

```text
VaultFolder/.obsidian/plugins/conceptlens/
```

3. Copy the release assets into that folder.
4. Reload Obsidian.
5. Enable ConceptLens under Settings -> Community plugins.

## Development

Install dependencies:

```bash
npm i
```

Build the plugin:

```bash
npm run build
```

The release assets are:

- `main.js`
- `manifest.json`
- `styles.css`

## License

MIT

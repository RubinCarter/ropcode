export type CollapsibleTextKind = 'plain_text' | 'skill_preamble' | 'structured_reference';

export interface CollapsibleTextClassification {
  kind: CollapsibleTextKind;
  collapsible: boolean;
  defaultExpanded: boolean;
  title: string;
  preview: string;
}

export interface UserMessagePresentation extends CollapsibleTextClassification {
  text: string;
  textKind: CollapsibleTextKind;
}

const STRUCTURED_HEADINGS_REGEX = /^#{1,6}\s+/gm;
const BULLET_REGEX = /^\s*[-*+]\s+/gm;

function buildPreview(text: string, maxLength = 140): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function extractUserMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text' && typeof part.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }

  return '';
}

export function classifyCollapsibleText(text: string): CollapsibleTextClassification {
  const normalized = text.trim();

  if (!normalized) {
    return {
      kind: 'plain_text',
      collapsible: false,
      defaultExpanded: true,
      title: 'Message',
      preview: '',
    };
  }

  const headingCount = (normalized.match(STRUCTURED_HEADINGS_REGEX) || []).length;
  const bulletCount = (normalized.match(BULLET_REGEX) || []).length;
  const lineCount = normalized.split('\n').length;
  const startsWithSkillBaseDir = normalized.startsWith('Base directory for this skill:');

  if (startsWithSkillBaseDir && (headingCount >= 1 || bulletCount >= 1 || lineCount >= 6)) {
    return {
      kind: 'skill_preamble',
      collapsible: true,
      defaultExpanded: false,
      title: 'Skill details',
      preview: buildPreview(normalized),
    };
  }

  if ((headingCount >= 2 && lineCount >= 8) || (headingCount >= 1 && bulletCount >= 2 && normalized.length >= 220)) {
    return {
      kind: 'structured_reference',
      collapsible: true,
      defaultExpanded: false,
      title: 'Reference details',
      preview: buildPreview(normalized),
    };
  }

  return {
    kind: 'plain_text',
    collapsible: false,
    defaultExpanded: true,
    title: 'Message',
    preview: buildPreview(normalized),
  };
}

export function getUserMessagePresentation(message: { type?: string; message?: { content?: unknown } } | null | undefined): UserMessagePresentation {
  const rawContent = message?.message?.content;
  const text = extractUserMessageText(rawContent);
  const classification = classifyCollapsibleText(text);

  return {
    ...classification,
    text,
    textKind: classification.kind,
  };
}

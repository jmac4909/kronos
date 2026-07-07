import { TicketAcceptanceCriterion } from '../state/types';
import { evidenceChecked, evidenceString } from './evidenceData';

export interface ExistingAcceptanceCriterion {
  id?: string;
  text: string;
  checked?: boolean;
  source?: TicketAcceptanceCriterion['source'];
}

export function extractAcceptanceCriteria(description: string | undefined, existing: ExistingAcceptanceCriterion[] = []): TicketAcceptanceCriterion[] {
  const texts = extractCriterionTexts(description || '');
  const existingByText = new Map(existing.map(item => [normalizeText(item.text), item]));
  return texts.map((text, index) => {
    const previous = existingByText.get(normalizeText(text));
    return {
      id: previous?.id || criterionId(text, index),
      text,
      checked: previous?.checked || false,
      source: previous?.source || 'description',
    };
  });
}

export function extractCriterionTexts(description: string): string[] {
  const lines = description.split(/\r?\n/);
  const found: string[] = [];
  let inAcceptanceSection = false;
  let gwtBlock: string[] = [];

  const flushGwt = () => {
    if (gwtBlock.length > 0) {
      found.push(gwtBlock.join(' '));
      gwtBlock = [];
    }
  };

  for (const rawLine of lines) {
    const line = cleanCriteriaLine(rawLine);
    if (!line) {
      flushGwt();
      continue;
    }

    if (isAcceptanceHeading(line)) {
      flushGwt();
      inAcceptanceSection = true;
      continue;
    }

    const acLine = line.match(/^(?:AC|Acceptance Criteria)\s*#?\d*\s*[:.)-]\s*(.+)$/i);
    const acText = matchCapture(acLine);
    if (acText) {
      flushGwt();
      found.push(acText);
      continue;
    }

    const gwtLine = line.match(/^(Given|When|Then|And|But)\b.+/i);
    if (gwtLine) {
      gwtBlock.push(line);
      continue;
    }

    if (inAcceptanceSection) {
      if (isSectionHeading(rawLine, line)) {
        flushGwt();
        inAcceptanceSection = false;
        continue;
      }
      const bullet = line.match(/^(?:[-*]|\d+[.)])\s+(.+)$/);
      const bulletText = matchCapture(bullet);
      if (bulletText) {
        flushGwt();
        found.push(bulletText);
        continue;
      }
      const paragraphText = plainAcceptanceParagraph(line);
      if (paragraphText) {
        flushGwt();
        found.push(paragraphText);
        continue;
      }
    }

    flushGwt();
  }

  flushGwt();
  return dedupe(found.map(cleanCriterionText).filter(Boolean));
}

function cleanCriteriaLine(rawLine: string): string {
  return rawLine
    .trim()
    .replace(/^h[1-6]\.\s*/i, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .trim();
}

function isAcceptanceHeading(line: string): boolean {
  return /^(acceptance criteria|acceptance|criteria)\s*:?\s*$/i.test(line);
}

function isSectionHeading(rawLine: string, line: string): boolean {
  if (isAcceptanceHeading(line)) { return false; }
  const raw = rawLine.trim();
  if (/^h[1-6]\.\s+/i.test(raw) || /^#{1,6}\s+/.test(raw)) { return true; }
  return /^[A-Z][A-Za-z0-9 /&()-]{2,}:$/.test(line);
}

function plainAcceptanceParagraph(line: string): string {
  if (/^(?:Given|When|Then|And|But)\b/i.test(line)) { return ''; }
  if (/^(?:[-*]|\d+[.)])\s+/.test(line)) { return ''; }
  if (isAcceptanceHeading(line) || /^[A-Z][A-Za-z0-9 /&()-]{2,}:$/.test(line)) { return ''; }
  return line;
}

export function setAcceptanceCriteriaChecked(criteria: TicketAcceptanceCriterion[], checkedIds: string[]): TicketAcceptanceCriterion[] {
  const checked = new Set(checkedIds);
  return criteria.map(criterion => ({
    ...criterion,
    checked: checked.has(criterion.id),
  }));
}

export function existingAcceptanceCriterion(record: object): ExistingAcceptanceCriterion | undefined {
  const text = evidenceString(record, 'text');
  if (!text) { return undefined; }
  const source = evidenceString(record, 'source');
  const criterion: ExistingAcceptanceCriterion = {
    text,
    checked: evidenceChecked(record),
  };
  const id = evidenceString(record, 'id');
  if (id) { criterion.id = id; }
  if (source === 'description' || source === 'manual') { criterion.source = source; }
  return criterion;
}

function cleanCriterionText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^["']|["']$/g, '')
    .trim();
}

function dedupe(texts: string[]): string[] {
  const seen = new Set<string>();
  return texts.filter(text => {
    const key = normalizeText(text);
    if (seen.has(key)) { return false; }
    seen.add(key);
    return true;
  });
}

function matchCapture(match: RegExpMatchArray | null): string {
  return match?.[1]?.trim() || '';
}

function normalizeText(text: string): string {
  return cleanCriterionText(text).toLowerCase();
}

function criterionId(text: string, index: number): string {
  const normalized = normalizeText(text).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40);
  return `ac-${index + 1}-${normalized || 'item'}`;
}

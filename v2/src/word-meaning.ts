import type { StudySense, StudyWord } from "./types";

const PART_LABEL_SOURCE = String.raw`(?:vt\.?\/?vi\.?|vi\.?\/?vt\.?|adj\.?|adv\.?|prep\.?|pron\.?|conj\.?|num\.?|det\.?|aux\.?|art\.?|modal\.?|n\.?|v\.?)(?![a-z]|\.[a-z])`;

function normalizePartLabel(part: string) {
  const trimmed = part.trim();
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

function splitPartLabels(value: string) {
  return value.match(new RegExp(PART_LABEL_SOURCE, "gi"))?.map(normalizePartLabel) ?? [];
}

function parseInlineSenses(meaning: string): StudySense[] {
  const matcher = new RegExp(`(?:^|[；;]\\s*)(${PART_LABEL_SOURCE})\\s*`, "gi");
  const matches = [...meaning.matchAll(matcher)];
  if (!matches.length || matches[0].index !== 0) return [];

  return matches.flatMap((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? meaning.length;
    const senseMeaning = meaning.slice(start, end).replace(/^[；;\s]+|[；;\s]+$/g, "").trim();
    return senseMeaning ? [{ part: normalizePartLabel(match[1]), meaning: senseMeaning }] : [];
  });
}

function comparableMeaning(value: string) {
  return value.replace(/[；;]+/g, "；").replace(/\s+/g, "").replace(/^；|；$/g, "");
}

function removeRepeatedPartLabel(meaning: string, expectedPart: string) {
  const match = meaning.match(new RegExp(`^(${PART_LABEL_SOURCE})\\s*`, "i"));
  if (!match || normalizePartLabel(match[1]).toLowerCase() !== expectedPart.toLowerCase()) return meaning;
  return meaning.slice(match[0].length).trim() || meaning;
}

export function studySenses(word: StudyWord): StudySense[] {
  const fullMeaning = word.meaning.trim() || word.definition?.trim() || "";
  const inlineSenses = parseInlineSenses(fullMeaning);
  if (inlineSenses.length) return inlineSenses;

  if (word.senses?.length) {
    const sensesMeaning = word.senses.map((sense) => sense.meaning.trim()).filter(Boolean).join("；");
    if (comparableMeaning(sensesMeaning) === comparableMeaning(fullMeaning)) return word.senses;
  }

  const parts = splitPartLabels(word.part);
  const meanings = fullMeaning.split(/[；;]/).map((meaning) => meaning.trim()).filter(Boolean);
  if (parts.length > 1 && parts.length === meanings.length) {
    return parts.map((part, index) => ({ part, meaning: removeRepeatedPartLabel(meanings[index] ?? "", part) }));
  }

  return [{ part: word.part.trim() || "—", meaning: fullMeaning || "—" }];
}

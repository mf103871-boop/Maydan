import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { ERSOMHA_BANK, ERSOMHA_BANK_VERSION, ERSOMHA_CATEGORIES, normalizeErsomhaGuess } from '../server/ersomha-content.mjs';
import { ERSOMHA_ACCEPTED_OVERLAPS } from '../server/data/ersomha/accepted-answer-overlaps.mjs';
import { ERSOMHA_INDEPENDENT_REVIEW } from '../server/data/ersomha/independent-review.mjs';

export function editorialContentSha256({ id, familyId, category, difficulty, answer, aliases, visualNote }) {
  return createHash('sha256').update(JSON.stringify({ id, familyId, category, difficulty, answer, aliases, visualNote })).digest('hex');
}

export function validateErsomhaBank(bank = ERSOMHA_BANK) {
  const errors = [], warnings = [], ids = new Set(), accepted = new Map();
  const categories = Object.fromEntries(ERSOMHA_CATEGORIES.map(({ id, label }) => [id, { label, total: 0, easy: 0, medium: 0, hard: 0 }]));
  const tiers = { easy: 0, medium: 0, hard: 0 }, families = new Map();
  for (const entry of bank) {
    const context = entry?.id || '(missing-id)';
    if (!entry || typeof entry !== 'object') { errors.push('Malformed entry'); continue; }
    if (!/^ers-[a-z]+-\d{3}$/.test(entry.id) || ids.has(entry.id)) errors.push(`${context}: invalid/duplicate id`);
    ids.add(entry.id);
    if (entry.conceptId !== entry.id) errors.push(`${context}: concept identity must stay stable`);
    if (typeof entry.familyId !== 'string' || !/^[a-z0-9-]{3,80}$/.test(entry.familyId)) errors.push(`${context}: invalid family`);
    families.set(entry.familyId, (families.get(entry.familyId) || 0) + 1);
    if (!categories[entry.category]) errors.push(`${context}: unknown category`);
    else { categories[entry.category].total += 1; if (entry.difficulty in tiers) categories[entry.category][entry.difficulty] += 1; }
    if (!(entry.difficulty in tiers)) errors.push(`${context}: unknown difficulty`); else tiers[entry.difficulty] += 1;
    if (typeof entry.answer !== 'string' || !entry.answer.trim() || entry.answer !== entry.answer.trim() || Array.from(entry.answer).length > 90 || entry.answer.split(/\s+/).length > 12) errors.push(`${context}: invalid answer`);
    if (!Array.isArray(entry.aliases) || entry.aliases.length > 12) { errors.push(`${context}: invalid aliases`); continue; }
    for (const answer of [entry.answer, ...entry.aliases]) {
      if (typeof answer !== 'string' || answer !== answer.trim() || !normalizeErsomhaGuess(answer)) { errors.push(`${context}: invalid accepted answer`); continue; }
      const key = normalizeErsomhaGuess(answer), previous = accepted.get(key) || [];
      previous.push(context); accepted.set(key, previous);
    }
    if (typeof entry.visualNote !== 'string' || entry.visualNote.split(/\s+/).length < 2) errors.push(`${context}: missing specific visual clues`);
    if (entry.review?.language !== 'reviewed' || entry.review?.drawability !== 'reviewed') errors.push(`${context}: incomplete author review`);
    if (!['pending', 'reviewed'].includes(entry.review?.independent)) errors.push(`${context}: invalid independent-review state`);
    if (entry.review?.independent === 'reviewed') {
      const audit = ERSOMHA_INDEPENDENT_REVIEW[entry.id];
      if (audit?.reviewer !== 'agent-editorial/audit_games_fun_content'
        || audit?.mode !== 'agent-editorial-not-human-playtest'
        || typeof audit?.reason !== 'string' || audit.reason.length < 30)
        errors.push(`${context}: missing independent editorial evidence`);
      if (audit?.reviewedContentSha256 !== editorialContentSha256(entry)) errors.push(`${context}: independent review is stale for the current content`);
    }
  }
  const overlapRules = new Map(ERSOMHA_ACCEPTED_OVERLAPS.map(rule => [rule.normalizedText, rule]));
  const reviewedLexicalOverlaps = [];
  for (const [key, conceptIds] of accepted) {
    if (conceptIds.length < 2) continue;
    const rule = overlapRules.get(key);
    const sorted = [...conceptIds].sort();
    if (!rule || JSON.stringify(sorted) !== JSON.stringify([...rule.conceptIds].sort())) {
      errors.push(`${conceptIds.at(-1)}: normalized accepted-answer collision with ${conceptIds.slice(0, -1).join(', ')} (${key})`);
    } else reviewedLexicalOverlaps.push(rule);
  }
  for (const rule of ERSOMHA_ACCEPTED_OVERLAPS) {
    if (!reviewedLexicalOverlaps.includes(rule)) errors.push(`Reviewed lexical-overlap rule is stale or expanded: ${rule.normalizedText}`);
  }
  if (bank.length !== 1200) errors.push(`Expected 1200 concepts, found ${bank.length}`);
  for (const [id, { total }] of Object.entries(categories)) if (total !== 100) errors.push(`${id}: expected 100 concepts, found ${total}`);
  for (const [difficulty, expected] of Object.entries({ easy: 360, medium: 600, hard: 240 })) if (tiers[difficulty] !== expected) errors.push(`${difficulty}: expected ${expected}, found ${tiers[difficulty]}`);
  const independentPending = bank.filter((entry) => entry.review?.independent !== 'reviewed').length;
  if (independentPending) warnings.push(`${independentPending} concepts await independent editorial review; no physical playtest is claimed.`);
  return { ok: !errors.length, errors, warnings, total: bank.length, tiers, categories,
    uniqueFamilies: families.size, relatedFamilies: [...families].filter(([, count]) => count > 1).length,
    normalizedAcceptedAnswers: accepted.size,
    reviewedLexicalOverlaps: reviewedLexicalOverlaps.map(rule => ({ conceptIds: [...rule.conceptIds],
      normalizedTextSha256: createHash('sha256').update(rule.normalizedText).digest('hex'), reasonCode: 'reviewed-distinct-senses' })), independentPending };
}

async function browserImportViolations(root) {
  const failures = [];
  async function walk(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) await walk(path);
      else if (/\.(?:jsx?|mjs|tsx?)$/.test(item.name)) {
        const source = await readFile(path, 'utf8');
        if (/(?:from\s*|import\s*\()["'][^"']*(?:server\/data\/ersomha|ersomha-content)/.test(source)) failures.push(path);
      }
    }
  }
  await walk(join(root, 'src'));
  return failures;
}

export function ersomhaReviewReport() {
  const validation = validateErsomhaBank();
  const bankSha256 = createHash('sha256').update(JSON.stringify(ERSOMHA_BANK)).digest('hex');
  const reviewed = ERSOMHA_BANK.filter(entry => entry.review.independent === 'reviewed');
  const decisions = reviewed.flatMap(entry => ERSOMHA_INDEPENDENT_REVIEW[entry.id]?.decisions || []).reduce((counts, decision) => {
    counts[decision] = (counts[decision] || 0) + 1; return counts;
  }, {});
  return { schemaVersion: 2, bankVersion: ERSOMHA_BANK_VERSION, reviewDate: '2026-10-19', bankSha256,
    status: validation.independentPending ? 'author-reviewed-awaiting-independent-editorial-review' : 'independently-editorially-reviewed-awaiting-player-trial',
    physicalPlaytest: false, validation,
    independentEditorialReview: { reviewer: 'agent-editorial/audit_games_fun_content', mode: 'agent-editorial-not-human-playtest',
      rawRowsRead: 1200, reviewed: reviewed.length, decisions, unchanged: decisions.keep || 0,
      modified: reviewed.length - (decisions.keep || 0), timedDrawingTrial: false, playerDifficultyCalibration: false,
      exceptionsForPlayerTrial: reviewed.filter(entry => ERSOMHA_INDEPENDENT_REVIEW[entry.id]?.playerTrialException)
        .map(entry => ({ id: entry.id, reasonCode: ERSOMHA_INDEPENDENT_REVIEW[entry.id].playerTrialException })),
      privateEvidence: 'server/data/ersomha/independent-review.mjs',
      confidentiality: 'Answers, alternatives, item-specific visual clues and complete rationales remain in the private server evidence; this report contains general rationales and hashes only.' },
    policy: { serverOnly: true, noFuzzyMatching: true, noSubstringMatching: true, noSilentRecycle: true,
      aliasesAreAuthored: true, idsAppendOnlyAfterFreeze: true, finiteBank: true },
    editorialDecisions: [
      'Removed rare-name-dependent animal prompts: iguana, stingray, salamander, lemur and meerkat.',
      'Tiers follow drawing complexity across categories, not 30/50/20 quotas per category; global totals stay 360/600/240.',
      'Added a visual clue note to every concept; no color-swap variants or numerical template expansion.',
      'Removed semantically duplicate hammer/anvil and relief-key expressions.',
      'Removed normalized duplicate aliases already handled by Arabic orthographic normalization.',
      'Related dominant depictions share a family across categories; a finite bank may exhaust before every concept is selected.',
      'A second agent-editorial reviewer read all 1200 raw entries, corrected weak prompts, and recorded a content-bound reason for each; no human or physical playtest is claimed.',
      'Two explicit private homonym rules preserve valid regional and gendered guesses; exact matching is still limited to the selected card and any additional overlap remains an error.',
    ],
    entries: ERSOMHA_BANK.map(({ id, conceptId, familyId, category, difficulty, review, answer, aliases, visualNote }) => {
      const audit = ERSOMHA_INDEPENDENT_REVIEW[id] || {};
      return {
      id, conceptId, familyId, category, difficulty, language: review.language, drawability: review.drawability, independent: review.independent,
      independentReviewer: audit.reviewer, independentMode: audit.mode,
      independentReason: audit.publicReason, independentDecisions: audit.decisions,
      independentReviewedAt: audit.reviewedAt, independentSourceRecord: audit.sourceRecord,
      baselineContentSha256: audit.baselineContentSha256, reviewedContentSha256: audit.reviewedContentSha256,
      contentSha256: createHash('sha256').update(JSON.stringify({ answer, aliases, visualNote })).digest('hex'),
    }; }),
  };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const report = ersomhaReviewReport();
  const violations = await browserImportViolations(root);
  if (violations.length) { report.validation.errors.push('Browser source imports the private bank', ...violations); report.validation.ok = false; }
  const reportIndex = process.argv.indexOf('--report');
  if (reportIndex !== -1) {
    if (!process.argv[reportIndex + 1]) throw new Error('--report requires an output path');
    const path = resolve(root, process.argv[reportIndex + 1]);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify({ bankVersion: report.bankVersion, bankSha256: report.bankSha256, ...report.validation }, null, 2));
  if (!report.validation.ok) process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();

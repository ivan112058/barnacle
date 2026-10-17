#!/usr/bin/env node
/**
 * scripts/lib/css.mjs — the CSS source reader every `verify-*.mjs` script parses with.
 *
 * Fourteen scripts used to carry their own copy of `blankComments`, `matchBrace`, `parseRules`
 * and `declarations`: the same sixty lines, written out a dozen times, drifting apart only in
 * comments and in the wording of one error message. The library under test is one stylesheet, so
 * there is one parser for it — a change to how a selector or an at-rule is read is now a change in
 * one file instead of a change that has to be repeated twelve times correctly.
 *
 * The two deliberate variations that were in the copies are options here, not branches in every
 * caller:
 *
 *   - `parseRules(text)` returns `{selector, body, conditions}` records and treats `@keyframes`
 *     like any other at-rule, so its `0%` / `100%` blocks come back as rules. That is what the
 *     geometry checks want: a keyframe that moves something is still a rule that moves something.
 *   - `parseRulesAndKeyframes(text)` returns `{rules, keyframes}`: the same records, plus the
 *     animation blocks collected by name and *not* walked into. Two scripts (dialog, static) need
 *     the animation itself rather than its steps, and one of them must not see `0%` as a rule.
 *   - `declarations(body)` yields `[property, value]` pairs; `declarationsOf(rule)` yields the same
 *     pairs as records carrying the rule's file, selector and character offsets. Only
 *     scripts/verify-interaction.mjs needs the offsets, to point at the exact byte it complains
 *     about.
 *
 * Everything here is deliberately dependency-free and side-effect-free: a verify script has to be
 * able to run on a machine with nothing but Node and the repository.
 */

/** Throw on an unbalanced brace, naming the selector whose block could not be closed. */
function requireBrace(text, openIndex, label) {
  if (text[openIndex] !== '{') throw new Error(`${label}: expected "{" at index ${openIndex}`);
}

/**
 * Comment bodies become spaces of the same length: braces and words inside prose stop counting
 * as syntax, and every character offset stays where it was, so a rule can still be reported by
 * position in the raw source.
 */
export function blankComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length));
}

/** The index of the `}` matching the `{` at `openIndex`, skipping over quoted strings. */
export function matchBrace(text, openIndex, label) {
  requireBrace(text, openIndex, label);
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`${label}: unbalanced braces — no matching "}" for the "{" at index ${openIndex}`);
}

/**
 * Walk a stylesheet, returning every `selector { body }` rule flattened out of its at-rule
 * wrappers while keeping the wrappers in `conditions` (outermost first).
 *
 * `keyframes`, when given, collects `@keyframes` blocks instead of descending into them.
 */
function walkRules(text, conditions, keyframes) {
  const rules = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (i >= text.length) break;
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const semi = text.indexOf(';', i);
    if (semi !== -1 && semi < open) {
      i = semi + 1; // an at-statement such as `@layer a, b;` — nothing to collect
      continue;
    }
    const prelude = text.slice(i, open).trim();
    const close = matchBrace(text, open, prelude);
    const body = text.slice(open + 1, close);

    if (keyframes && /^@keyframes\b/.test(prelude)) {
      keyframes.push({ name: prelude.replace(/^@keyframes\s+/, '').trim(), body, conditions });
    } else if (prelude.startsWith('@')) {
      rules.push(...walkRules(body, [...conditions, prelude], keyframes));
    } else {
      rules.push({ selector: prelude, body, conditions });
    }
    i = close + 1;
  }
  return rules;
}

/** Every style rule of a stylesheet, flattened out of its at-rule wrappers. */
export function parseRules(text, conditions = []) {
  return walkRules(text, conditions, null);
}

/** Every style rule of a stylesheet, plus its `@keyframes` blocks collected by name. */
export function parseRulesAndKeyframes(text, conditions = []) {
  const keyframes = [];
  const rules = walkRules(text, conditions, keyframes);
  return { rules, keyframes };
}

/** This parser's one declaration shape: `property: value` up to the next `;` or block edge. */
function* declarationMatches(body) {
  yield* body.matchAll(/(--[\w-]+|[\w-]+)\s*:\s*([^;{}]+)/g);
}

/** The declarations of a rule body as `[property, value]` pairs, value whitespace-collapsed. */
export function declarations(body) {
  const pairs = [];
  for (const match of declarationMatches(body)) {
    pairs.push([match[1], match[2].replace(/\s+/g, ' ').trim()]);
  }
  return pairs;
}

/**
 * The declarations of a rule (as returned by `parseRules`) as records carrying the offsets the
 * rule was read from — `at` is the selector's index in the file and `bodyAt` the body's.
 */
export function declarationsOf(rule) {
  const found = [];
  for (const match of declarationMatches(rule.body)) {
    found.push({
      property: match[1],
      value: match[2].replace(/\s+/g, ' ').trim(),
      at: rule.bodyAt + match.index,
      selector: rule.selector,
      conditions: rule.conditions,
      file: rule.file,
    });
  }
  return found;
}

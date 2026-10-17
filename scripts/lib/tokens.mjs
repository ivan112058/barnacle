#!/usr/bin/env node
/**
 * scripts/lib/tokens.mjs — the library's two namespaces, written down once.
 *
 * Every verify script has to know the same three things: which `--bn-*` names a component may
 * read (`PUBLIC_TOKENS`, spec §6.1), which `--_*` slots `00-base.css` declares (`FROZEN_SLOTS`,
 * orchestrator-decisions §4) and what shape a name may have at all (ADR-0005). Eleven scripts
 * held their own copy of the token list and twelve their own copy of the slot list, so a token
 * added to spec §6.1 had to be added eleven times to be usable — and one of the copies silently
 * kept an older list for a while. The vocabulary is a property of the library, not of the check
 * that happens to read it.
 *
 * `FROZEN_SLOT_VALUES` / `DEFAULT_SLOT_VALUES` carry the *values* the decision file froze for
 * those slots, which is what scripts/verify-interaction.mjs asserts; the name-only sets are for
 * the checks that ask "may a component touch this name at all".
 */

/** spec.md §6.1 — the complete public token vocabulary. A component may only read from it. */
export const PUBLIC_TOKENS = new Set([
  '--bn-border-width', '--bn-border-color', '--bn-radius', '--bn-shadow-x', '--bn-shadow-y',
  '--bn-shadow-reverse-x', '--bn-shadow-reverse-y', '--bn-shadow-color', '--bn-shadow-lift',
  '--bn-shadow-sm', '--bn-shadow-md', '--bn-shadow-lg', '--bn-shadow', '--bn-press',
  '--bn-background', '--bn-secondary-background', '--bn-foreground', '--bn-main',
  '--bn-main-foreground', '--bn-ring', '--bn-overlay', '--bn-pink', '--bn-blue', '--bn-green',
  '--bn-orange', '--bn-lavender', '--bn-success', '--bn-warning', '--bn-danger',
  '--bn-font-family', '--bn-font-display', '--bn-font-mono', '--bn-font-weight-base',
  '--bn-font-weight-heading', '--bn-transition',
]);

/** orchestrator-decisions §4 — the internal slots `00-base.css` declares. */
export const FROZEN_SLOTS = new Set([
  '--_lift-x', '--_lift-y', '--_press-x', '--_press-y', '--_shadow-rest', '--_shadow-hover',
  '--_shadow-press', '--_focus-ring', '--_focus-ring-offset', '--_motion', '--_border-rest',
  '--_border-hover', '--_border-press', '--_surface', '--_surface-hover', '--_surface-press',
]);

/**
 * orchestrator-decisions §4 + recipes §2.3 — the ten geometry slots of the frozen block, with
 * the values the single source must declare. These are the *only* names a component may
 * override, and the values below are the ones `00-base.css` has to spell.
 */
export const FROZEN_SLOT_VALUES = new Map([
  ['--_lift-x', 'calc(var(--bn-shadow-lift) * -1)'],
  ['--_lift-y', 'calc(var(--bn-shadow-lift) * -1)'],
  ['--_press-x', 'var(--bn-press)'],
  ['--_press-y', 'var(--bn-press)'],
  ['--_shadow-rest', 'var(--bn-shadow-md)'],
  ['--_shadow-hover', 'var(--bn-shadow-lg)'],
  ['--_shadow-press', 'none'],
  ['--_focus-ring', '3px solid var(--bn-ring)'],
  ['--_focus-ring-offset', '3px'],
  ['--_motion', 'var(--bn-transition)'],
]);

/** recipes §2.3 — the border/surface default slots of the same single source. */
export const DEFAULT_SLOT_VALUES = new Map([
  ['--_border-rest', 'var(--bn-border-color)'],
  ['--_border-hover', 'var(--bn-border-color)'],
  ['--_border-press', 'var(--bn-border-color)'],
  ['--_surface', 'var(--bn-secondary-background)'],
  ['--_surface-hover', 'var(--bn-secondary-background)'],
  ['--_surface-press', 'var(--bn-secondary-background)'],
]);

/** ADR-0005: a public token, and an internal slot. The two namespaces, and nothing else. */
export const PUBLIC_TOKEN = /^--bn-[a-z0-9-]+$/;
export const INTERNAL_SLOT = /^--_[a-z0-9-]+$/;

/** The same two patterns under the name the ADR-hygiene checks use for them. */
export const HYGIENE = {
  publicToken: PUBLIC_TOKEN,
  internalToken: INTERNAL_SLOT,
};

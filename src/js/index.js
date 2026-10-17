/**
 * barnacle JS entry — the IIFE bundle's top level (spec §9).
 *
 * Two jobs, and nothing else:
 *
 *   1. Register the custom elements. Tickets 19–21 add their `bn.register('<bn-…>', X)`
 *      calls here; a component with no internal state and no lifecycle does *not* get an
 *      element and does not get registered (spec §9: "只用自定义元素封装有内部状态与生命周期的
 *      组件；无状态能力用普通模块" — `toast` is that counter-example, and it arrives as a
 *      declared capability rather than as an element).
 *   2. Mount `window.bn` — the only way out of the bundle, so it stays narrow. The surface
 *      grows only by the names named in the `createNamespace` call below (ticket 22 audits it
 *      against spec §9).
 *
 * The entry is DOM-bearing by nature (it defines elements for a live document), so when it is
 * loaded where no DOM exists — `node --test` importing it for the namespace shape — it mounts
 * nothing and stays silent instead of throwing. Registration needs a registry, not a document,
 * so that is the gate.
 */

import { BnDropdown } from './dropdown.js';
import { createNamespace } from './namespace.js';
import { BnTabs } from './tabs.js';
import { BnTagInput } from './taginput.js';
import { toast } from './toast.js';

const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';

/** The mounted `window.bn` surface, or a detached one outside a browser. */
const bn = hasDom ? createNamespace(window, { toast }) : createNamespace({}, { toast });

if (typeof customElements !== 'undefined') {
  bn.register('bn-dropdown', BnDropdown);
  bn.register('bn-tabs', BnTabs);
  bn.register('bn-taginput', BnTagInput);
}

export default bn;

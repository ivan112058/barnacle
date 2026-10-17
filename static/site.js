/*
 * Barnacle documentation-site script.
 *
 * This file belongs to the docs site, not to the library: it is loaded by templates/base.html
 * and knows nothing about the library's class names or custom properties — only the site's own
 * `site-` namespace appears here (orchestrator decision §7).
 *
 * It does two jobs.
 *
 * 1. The fence-to-demo layer (spec §10). Authors write standard Markdown fences and nothing
 *    else; seite 0.20.1 renders a fence as `<pre style="background-color:#2b303b;">` with
 *    inline `<span style>` tokens and no `<code>` and no language class (seite-findings §5.2 D),
 *    which leaves the fence's *text* as the only signal available. So this script reads each
 *    fence inside a `.site-prose` body, and when the text is markup rather than code it turns
 *    the fence into a Preview / Code tab pair:
 *
 *      - the Preview panel receives the parsed fence HTML, injected into the page's own style
 *        scope. No shadow DOM, no iframe: the library's global styles apply to it, which is
 *        the entire point of the panel.
 *      - the Code panel receives the original seite `<pre>`, untouched, so its escaping and
 *        syntax highlighting survive and seite's own Copy button keeps working.
 *      - a fence whose text is not markup (a stylesheet, a shell command) is left exactly as
 *        seite produced it.
 *
 *    With this script absent the page still reads correctly: every fence is a plain code block
 *    and the prose is untouched. Nothing here generates prose.
 *
 * 2. The theme switch in the header. The pre-paint half lives in an inline script in
 *    templates/base.html (the stored theme must land before first paint); this half syncs the
 *    button and flips `data-theme` on `<html>`.
 */
(function () {
  'use strict';

  /*
   * Bilingual site (ticket 23): every visible word this script produces comes from the document,
   * not from this file. templates/base.html puts the words on <html> as data-site-label-* and
   * Tera escapes them, so a static file with no template still speaks the page's language — and
   * nothing here has to know that "zh" exists. The English values are the fallbacks for a page
   * built without the attributes.
   */
  var dataset = document.documentElement.dataset;
  var PREVIEW = 'preview';
  var CODE = 'code';
  var LABELS = {
    preview: dataset.siteLabelPreview || 'Preview',
    code: dataset.siteLabelCode || 'Code',
    copy: dataset.siteLabelCopy || 'Copy',
    copied: dataset.siteLabelCopied || 'Copied!',
    copyAria: dataset.siteLabelCopyAria || 'Copy code to clipboard',
  };
  var THEME_KEY = 'barnacle-site-theme';
  /* seite's own Copy button text, which is hardcoded English in seite 0.20.1 (measured). */
  var SEITE_COPY_TEXT = { Copy: LABELS.copy, 'Copied!': LABELS.copied };

  /**
   * Tags whose mere presence is not something a reader can look at. A fence that contains
   * only these (content/pages/usage.md documents the CDN <link> + <script> pair) is code, not
   * a demo: a Preview tab for it would be an empty panel that fetches a stylesheet.
   */
  var NON_VISUAL = {
    SCRIPT: true,
    LINK: true,
    META: true,
    STYLE: true,
    BASE: true,
    TITLE: true,
    TEMPLATE: true,
    NOSCRIPT: true,
  };

  var root = document.documentElement;

  /* -------------------------------------------------------------------- theme switch --- */

  /**
   * The current theme. Read from `<html>`, never from `<body>`: derived library tokens such as
   * the medium shadow are substituted where they are declared, so `data-theme` on any
   * descendant of `<html>` cannot flip them (orchestrator decision §8).
   */
  function theme() {
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function syncToggle(toggle) {
    toggle.setAttribute('aria-pressed', theme() === 'dark' ? 'true' : 'false');
  }

  function applyTheme(toggle, value) {
    root.setAttribute('data-theme', value);
    syncToggle(toggle);
    try {
      localStorage.setItem(THEME_KEY, value);
    } catch (error) {
      /* storage can be unavailable (private mode): the switch still works for this page */
    }
  }

  function initTheme() {
    var toggle = document.querySelector('[data-site-theme-toggle]');
    if (!toggle) return;
    syncToggle(toggle);
    toggle.addEventListener('click', function () {
      applyTheme(toggle, theme() === 'dark' ? 'light' : 'dark');
    });
  }

  /* ---------------------------------------------------------------------- demo tabs --- */

  var demoCount = 0;

  /**
   * The fence's source text. seite appends its Copy button to every `<pre>` from a
   * DOMContentLoaded handler; this script runs first (deferred), but stripping the button
   * keeps the reading correct in either order and keeps "Copy" out of the detection text.
   */
  function fenceText(pre) {
    var clone = pre.cloneNode(true);
    var buttons = clone.querySelectorAll('.seite-copy-btn');
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].parentNode.removeChild(buttons[i]);
    }
    return clone.textContent;
  }

  function parse(text) {
    var template = document.createElement('template');
    template.innerHTML = text;
    return template.content;
  }

  function rendersSomething(fragment) {
    for (var i = 0; i < fragment.children.length; i += 1) {
      if (!NON_VISUAL[fragment.children[i].tagName]) return true;
    }
    return false;
  }

  function tabButton(demoId, name, selected) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'site-demo__tab';
    button.id = demoId + '-tab-' + name;
    button.setAttribute('data-site-tab', name);
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', demoId + '-panel-' + name);
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    button.setAttribute('tabindex', selected ? '0' : '-1');
    button.textContent = LABELS[name];
    return button;
  }

  function tabPanel(demoId, name) {
    var panel = document.createElement('div');
    panel.className = 'site-demo__panel site-demo__panel--' + name;
    panel.id = demoId + '-panel-' + name;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', demoId + '-tab-' + name);
    panel.setAttribute('tabindex', '0');
    return panel;
  }

  /** WAI-ARIA tabs, automatic activation: arrows, Home and End move focus and selection. */
  function wireTabs(demo, tabs, panels) {
    function select(index, focus) {
      for (var i = 0; i < tabs.length; i += 1) {
        var selected = i === index;
        tabs[i].setAttribute('aria-selected', selected ? 'true' : 'false');
        tabs[i].setAttribute('tabindex', selected ? '0' : '-1');
        panels[i].hidden = !selected;
      }
      if (focus) tabs[index].focus();
    }

    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () {
        select(index, false);
      });
    });

    demo.addEventListener('keydown', function (event) {
      var index = tabs.indexOf(document.activeElement);
      if (index === -1) return;
      var target = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = tabs.length - 1;
      if (target === null) return;
      event.preventDefault();
      select(target, true);
    });
  }

  /** Turn one seite `<pre>` into a Preview / Code pair, or leave it alone. */
  function buildDemo(pre) {
    var text = fenceText(pre);
    if (text.trim().charAt(0) !== '<') return null;
    var content = parse(text);
    if (!rendersSomething(content)) return null;

    // Where the fence lives now: the fence element itself is about to move into the code
    // panel, so its current position has to be captured before that.
    var parent = pre.parentNode;
    var anchor = pre.nextSibling;

    demoCount += 1;
    var demoId = 'site-demo-' + demoCount;

    var demo = document.createElement('div');
    demo.className = 'site-demo';
    demo.setAttribute('data-site-demo', '');

    var tablist = document.createElement('div');
    tablist.className = 'site-demo__tablist';
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', LABELS.preview + ' / ' + LABELS.code);

    var tabs = [tabButton(demoId, PREVIEW, true), tabButton(demoId, CODE, false)];
    var previewPanel = tabPanel(demoId, PREVIEW);
    var codePanel = tabPanel(demoId, CODE);
    codePanel.hidden = true;

    // The demo HTML itself, verbatim: <style> in it applies to the page, which is what makes
    // the preview show what the library would really do. <script> is inert through innerHTML.
    previewPanel.appendChild(content);
    // The original fence element, verbatim: escaping, highlighting and seite's Copy button.
    codePanel.appendChild(pre);

    tablist.appendChild(tabs[0]);
    tablist.appendChild(tabs[1]);
    demo.appendChild(tablist);
    demo.appendChild(previewPanel);
    demo.appendChild(codePanel);
    parent.insertBefore(demo, anchor);

    wireTabs(demo, tabs, [previewPanel, codePanel]);
    return demo;
  }

  function initDemos() {
    var bodies = document.querySelectorAll('.site-prose');
    for (var i = 0; i < bodies.length; i += 1) {
      var fences = bodies[i].querySelectorAll('pre');
      for (var j = 0; j < fences.length; j += 1) {
        if (fences[j].closest('[data-site-demo]')) continue;
        buildDemo(fences[j]);
      }
    }
  }

  /* ------------------------------------------------------------------- seite's Copy --- */

  /**
   * seite 0.20.1 injects a Copy button into every `<pre>` from an inline script whose text is
   * hardcoded English ("Copy", "Copied!", aria-label "Copy code to clipboard"), and there is no
   * setting for it. On a Chinese page that is the one word the site cannot otherwise translate,
   * so it is renamed here.
   *
   * Ordering: seite's inline script sits at the end of <body> and runs while the document is still
   * parsing, so its DOMContentLoaded handler is registered BEFORE this deferred file runs. This
   * handler is registered afterwards and therefore runs after it, when the buttons exist. On an
   * English page the mapping is a no-op (the two labels are already the English ones).
   *
   * The observer is what keeps "Copied!" → back-to-"Copy" (seite's own reset) in the page's
   * language too. It re-reads the button's text and only rewrites the two strings seite uses, so
   * setting our own label cannot re-trigger it.
   */
  function localizeCopyButtons() {
    var buttons = document.querySelectorAll('.seite-copy-btn');
    for (var i = 0; i < buttons.length; i += 1) {
      (function (button) {
        button.setAttribute('aria-label', LABELS.copyAria);
        button.textContent = SEITE_COPY_TEXT[button.textContent] || LABELS.copy;
        if (LABELS.copy === 'Copy') return; // English page: seite's own text is already right
        new MutationObserver(function () {
          var localised = SEITE_COPY_TEXT[button.textContent];
          if (localised) button.textContent = localised;
        }).observe(button, { childList: true, characterData: true, subtree: true });
      }(buttons[i]));
    }
  }

  /* ------------------------------------------------------------------------- start --- */

  // Marks the capability for CSS: the theme switch is hidden until this script runs, so it is
  // never shown as a dead button to a reader without JavaScript.
  root.setAttribute('data-site-js', 'on');

  function init() {
    initTheme();
    initDemos();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // After seite's own handler, which is registered earlier (see localizeCopyButtons).
  document.addEventListener('DOMContentLoaded', localizeCopyButtons);
  if (document.readyState !== 'loading') localizeCopyButtons();
})();

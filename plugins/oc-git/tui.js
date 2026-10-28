import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
// oc-git — TUI half.
//
// The repository's state in the sidebar, vertical because the sidebar has room:
//
//   <git glyph> Git status
//   <branch glyph> main
//   +2  ±1  ?0
//   ↑1 ↓3
//
// Branch, then the files that have something to commit — added (index `A`), everything else that
// changed (`M`, `T`, `D`, `R`, `U`), and untracked — then ahead/behind, which appears only when an
// upstream exists. Zeros are the point: a clean repository reads `+0 ±0 ?0` and no extra word is
// needed to say so.
//
// Colour: the title in bold white, the branch in the theme's accent, and each count on its own — the
// warning yellow when that figure is not zero, grey when it is. A clean repository is therefore three
// grey zeros, which is the point: it should not catch the eye.
//
// Data: `git status --porcelain=v2 --branch`, one read-only call, chosen over the plugin API's
// `ctx.vcs` because that one exposes the branch and the file list but not the counts this block is
// built on, nor ahead/behind. The call runs on a timer, skipped while the previous one is still
// running, so a very large repository cannot stack reads.
//
// The block is hidden whenever git cannot answer — outside a repository, or on a machine without
// git — because an empty block is worse than no block.
import { Plugin } from "@opencode/plugin/tui";
import { createSignal } from "solid-js";
import { read } from "./git.ts";

/** The two glyphs pi's own widget uses, copied from there — verified by reading the codepoints
 *  back out of this file, never from memory. */
const BRANCH_GLYPH = "";
const GIT_GLYPH = "";
const REFRESH_MS = 3000;
const FALLBACK_ACCENT = "#79c0ff";
const FALLBACK_YELLOW = "#d29922";
const FALLBACK_DIM = "#8b949e";
export default Plugin.define({
  id: "oc-git.tui",
  setup(context) {
    const themeColour = (...paths) => {
      for (const path of paths) {
        let node = context.theme;
        for (const key of path) node = node?.[key];
        if (node !== undefined && node !== null) return node;
      }
      return undefined;
    };
    const BASE = themeColour(["text", "base"]);
    const DIM = themeColour(["text", "muted"], ["text", "faint"]) ?? FALLBACK_DIM;
    // One accent for everything that is a *value*, never a state: `syntax.function` is the blue-ish
    // identity colour in most themes. Green and yellow are deliberately not used — in this UI they
    // mean ok and warning, and a count is neither.
    const ACCENT = themeColour(["syntax", "function"], ["syntax", "variable"], ["text", "base"]) ?? FALLBACK_ACCENT;
    /** The warning yellow the other sidebar blocks use — here it means "there is something to
     *  commit", the one state this block exists to announce. */
    const YELLOW = themeColour(["text", "feedback", "warning", "base"], ["syntax", "type"], ["syntax", "number"]) ?? FALLBACK_YELLOW;
    const [state, setState] = createSignal(undefined);
    const location = context.location ?? context.data.location.default();
    let reading = false;
    function refresh() {
      if (reading) return;
      const directory = location?.directory;
      if (!directory) return;
      reading = true;
      void read(directory).then(status => {
        reading = false;
        setState(status);
      });
    }
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const Block = () => (() => {
      var _el$ = _$createElement("box"),
        _el$2 = _$createElement("text"),
        _el$3 = _$createElement("span"),
        _el$4 = _$createTextNode(` `),
        _el$6 = _$createElement("b"),
        _el$8 = _$createElement("text"),
        _el$9 = _$createElement("span"),
        _el$0 = _$createTextNode(` `),
        _el$10 = _$createElement("span"),
        _el$11 = _$createElement("text"),
        _el$12 = _$createElement("span"),
        _el$13 = _$createTextNode(`+`),
        _el$14 = _$createElement("span"),
        _el$16 = _$createElement("span"),
        _el$17 = _$createTextNode(`±`),
        _el$18 = _$createElement("span"),
        _el$20 = _$createElement("span"),
        _el$21 = _$createTextNode(`?`);
      _$insertNode(_el$, _el$2);
      _$insertNode(_el$, _el$8);
      _$insertNode(_el$, _el$11);
      _$insertNode(_el$2, _el$3);
      _$insertNode(_el$2, _el$6);
      _$setProp(_el$2, "fg", BASE);
      _$insertNode(_el$3, _el$4);
      _$setProp(_el$3, "style", {
        fg: DIM
      });
      _$insertNode(_el$6, _$createTextNode(`Git status`));
      _$insertNode(_el$8, _el$9);
      _$insertNode(_el$8, _el$10);
      _$insertNode(_el$9, _el$0);
      _$setProp(_el$9, "style", {
        fg: DIM
      });
      _$setProp(_el$10, "style", {
        fg: ACCENT
      });
      _$insert(_el$10, () => state().branch);
      _$insertNode(_el$11, _el$12);
      _$insertNode(_el$11, _el$14);
      _$insertNode(_el$11, _el$16);
      _$insertNode(_el$11, _el$18);
      _$insertNode(_el$11, _el$20);
      _$insertNode(_el$12, _el$13);
      _$insert(_el$12, () => state().added, null);
      _$insertNode(_el$14, _$createTextNode(` `));
      _$setProp(_el$14, "style", {
        fg: DIM
      });
      _$insertNode(_el$16, _el$17);
      _$insert(_el$16, () => state().modified, null);
      _$insertNode(_el$18, _$createTextNode(` `));
      _$setProp(_el$18, "style", {
        fg: DIM
      });
      _$insertNode(_el$20, _el$21);
      _$insert(_el$20, () => state().untracked, null);
      _$insert(_el$, (() => {
        var _c$ = _$memo(() => state().ahead !== undefined);
        return () => _c$() ? (() => {
          var _el$22 = _$createElement("text"),
            _el$23 = _$createTextNode(`↑`),
            _el$24 = _$createTextNode(` ↓`);
          _$insertNode(_el$22, _el$23);
          _$insertNode(_el$22, _el$24);
          _$setProp(_el$22, "fg", DIM);
          _$insert(_el$22, () => state().ahead, _el$24);
          _$insert(_el$22, () => state().behind, null);
          return _el$22;
        })() : null;
      })(), null);
      _$effect(_p$ => {
        var _v$ = {
            fg: state().added > 0 ? YELLOW : DIM
          },
          _v$2 = {
            fg: state().modified > 0 ? YELLOW : DIM
          },
          _v$3 = {
            fg: state().untracked > 0 ? YELLOW : DIM
          };
        _v$ !== _p$.e && (_p$.e = _$setProp(_el$12, "style", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp(_el$16, "style", _v$2, _p$.t));
        _v$3 !== _p$.a && (_p$.a = _$setProp(_el$20, "style", _v$3, _p$.a));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined
      });
      return _el$;
    })();

    // Footer: the branch is already printed there by the TUI, and the whole block lives in the
    // sidebar, so the glyph and the three figures are the entire message. Shown only when there is
    // something to commit: on a narrow screen that is the point — the sidebar is gone, and this is
    // the one line that still has to reach the eye.
    const dirty = () => {
      const current = state();
      return !!current && (current.added > 0 || current.modified > 0 || current.untracked > 0);
    };
    const Numbers = () => (() => {
      var _el$25 = _$createElement("box"),
        _el$26 = _$createElement("text"),
        _el$27 = _$createTextNode(` `),
        _el$29 = _$createElement("text"),
        _el$30 = _$createTextNode(`+`),
        _el$31 = _$createElement("text"),
        _el$33 = _$createElement("text"),
        _el$34 = _$createTextNode(`±`),
        _el$35 = _$createElement("text"),
        _el$37 = _$createElement("text"),
        _el$38 = _$createTextNode(`?`);
      _$insertNode(_el$25, _el$26);
      _$insertNode(_el$25, _el$29);
      _$insertNode(_el$25, _el$31);
      _$insertNode(_el$25, _el$33);
      _$insertNode(_el$25, _el$35);
      _$insertNode(_el$25, _el$37);
      _$setProp(_el$25, "flexDirection", "row");
      _$setProp(_el$25, "flexShrink", 0);
      _$insertNode(_el$26, _el$27);
      _$setProp(_el$26, "fg", DIM);
      _$setProp(_el$26, "wrapMode", "none");
      _$insertNode(_el$29, _el$30);
      _$setProp(_el$29, "wrapMode", "none");
      _$insert(_el$29, () => state().added, null);
      _$insertNode(_el$31, _$createTextNode(` `));
      _$setProp(_el$31, "fg", DIM);
      _$setProp(_el$31, "wrapMode", "none");
      _$insertNode(_el$33, _el$34);
      _$setProp(_el$33, "wrapMode", "none");
      _$insert(_el$33, () => state().modified, null);
      _$insertNode(_el$35, _$createTextNode(` `));
      _$setProp(_el$35, "fg", DIM);
      _$setProp(_el$35, "wrapMode", "none");
      _$insertNode(_el$37, _el$38);
      _$setProp(_el$37, "wrapMode", "none");
      _$insert(_el$37, () => state().untracked, null);
      _$effect(_p$ => {
        var _v$4 = state().added > 0 ? YELLOW : DIM,
          _v$5 = state().modified > 0 ? YELLOW : DIM,
          _v$6 = state().untracked > 0 ? YELLOW : DIM;
        _v$4 !== _p$.e && (_p$.e = _$setProp(_el$29, "fg", _v$4, _p$.e));
        _v$5 !== _p$.t && (_p$.t = _$setProp(_el$33, "fg", _v$5, _p$.t));
        _v$6 !== _p$.a && (_p$.a = _$setProp(_el$37, "fg", _v$6, _p$.a));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined
      });
      return _el$25;
    })();
    context.ui.slot({
      prepend: "sidebar.content",
      render: () => state() ? _$createComponent(Block, {}) : null
    });
    context.ui.slot({
      append: "prompt.footer.status",
      render: () => dirty() ? _$createComponent(Numbers, {}) : null
    });
    return () => clearInterval(timer);
  }
});

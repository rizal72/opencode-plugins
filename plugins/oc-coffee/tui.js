import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
// oc-coffee — TUI half.
//
// Keeps the Mac awake while the agent works, the port of pi's `pi-coffee`.
//
//   off | idle | display | system      ->  caffeinate (), (-i), (-i -d), (-i -d -s -u)
//
// Four cumulative levels. The assertion is held only while a run is active — engaged on
// `session.execution.started`, released on `.succeeded` / `.failed` / `.interrupted` — so the
// Mac sleeps normally between turns. `-w <pid>` binds the child to this process, so it dies
// with the TUI however the TUI exits, SIGKILL included, and a closed window can never leave
// the machine awake for ever.
//
// The assertion lives here and not in the server because the server cannot see a run: the
// public event stream carries only catalogue events (`model.updated`, `provider.updated`, …)
// and there is no "session is executing" state to read. Measured 2026-10-16, including a
// clean headless run. The TUI is the only half that knows.
//
// The badge shows the level whenever it is not `off` — the setting, not the moment — and only
// the cup lights up (green) while the assertion is up, so the state is one mark and the level
// stays legible. `/coffee` opens the menu, `/coffee <level>` sets one, `/coffee status` reports.
// The level is persisted with the TUI's own durable storage, which replaces pi's
// `pi-coffee.json`; there is no file of ours.
//
// macOS only: elsewhere the plugin stays loaded and simply never engages.
import { Plugin } from "@opencode/plugin/tui";
import { spawn } from "node:child_process";
import { createRoot, createSignal } from "solid-js";

/** md-coffee_outline (U+F06CA), the glyph pi's own badge uses. */
const CUP_GLYPH = "\u{f06ca}";
const LEVELS = ["off", "idle", "display", "system"];
const LEVEL_FLAGS = {
  off: [],
  idle: ["-i"],
  display: ["-i", "-d"],
  system: ["-i", "-d", "-s", "-u"]
};

/** The four menu rows, the wording pi uses. */
const LEVEL_MENU = {
  off: "Off — Do not prevent any sleep",
  idle: "Prevent Idle Sleep — Keep the system awake while the agent works (caffeinate -i)",
  display: "Prevent Display Sleep — Also keep the display from idle-sleeping (caffeinate -i -d)",
  system: "Prevent System Sleep — Also block all system sleep on AC and declare the user active (caffeinate -i -d -s -u)"
};

/** Fallbacks, used only when the theme defines none of the candidates. */
const FALLBACK_GREEN = "#3fb950";
const FALLBACK_DIM = "#8b949e";
function isLevel(value) {
  return typeof value === "string" && LEVELS.includes(value);
}
export default Plugin.define({
  id: "oc-coffee.tui",
  setup(context) {
    const supported = process.platform === "darwin";

    // Durable: survives a restart and is shared by every TUI. A JSON object is what the
    // storage takes, so the level rides in one.
    const [stored, updateStored] = context.storage.store("coffee", {
      initial: {
        level: "display"
      }
    });
    const level = () => isLevel(stored.level) ? stored.level : "display";
    const themeColour = (...paths) => {
      for (const path of paths) {
        let node = context.theme;
        for (const key of path) node = node?.[key];
        if (node !== undefined && node !== null) return node;
      }
      return undefined;
    };
    const GREEN = themeColour(["syntax", "string"], ["diff", "text", "added"], ["text", "feedback", "success", "base"]) ?? FALLBACK_GREEN;
    const DIM = themeColour(["text", "muted"], ["text", "faint"]) ?? FALLBACK_DIM;
    let child = null;
    /** Runs in flight: several sessions can execute at once, so it is a count, not a flag. */
    let running = 0;
    /** Reactive: the badge must repaint the moment the assertion goes up or down. A plain
     *  variable read in the render would be read once and never again. */
    const [active, setActive] = createRoot(() => createSignal(false));
    function engage() {
      if (!supported || level() === "off" || child) return;
      const spawned = spawn("caffeinate", [...LEVEL_FLAGS[level()], "-w", String(process.pid)], {
        stdio: "ignore"
      });
      child = spawned;
      setActive(true);
      spawned.on("error", () => {
        if (child !== spawned) return;
        child = null;
        setActive(false);
      });
      spawned.on("exit", () => {
        if (child !== spawned) return;
        child = null;
        setActive(false);
      });
    }
    function release() {
      const held = child;
      child = null;
      setActive(false);
      held?.kill("SIGTERM");
    }

    /** The level can only change from the command, where a failure is worth a word. */
    async function setLevel(next) {
      const wasUp = child !== null;
      if (wasUp) release();
      await updateStored(draft => {
        draft.level = next;
      });
      if (wasUp || running > 0) engage();
    }
    const describe = () => {
      const flags = LEVEL_FLAGS[level()];
      const labels = flags.length === 0 ? "Sleep prevention: off" : `Sleep prevention: ${level()} (caffeinate ${flags.join(" ")})`;
      return `${labels} — assertion ${child ? "up" : "idle"}`;
    };

    // One listener per boundary. `running` counts sessions executing right now, so the
    // assertion is up while it is positive and the level is not `off`.
    const stopStarted = context.data.on("session.execution.started", () => {
      running += 1;
      if (running === 1) engage();
    });
    const stopSucceeded = context.data.on("session.execution.succeeded", () => {
      running = Math.max(0, running - 1);
      if (running === 0) release();
    });
    const stopFailed = context.data.on("session.execution.failed", () => {
      running = Math.max(0, running - 1);
      if (running === 0) release();
    });
    const stopInterrupted = context.data.on("session.execution.interrupted", () => {
      running = Math.max(0, running - 1);
      if (running === 0) release();
    });

    /** Always visible, `off` included: the badge is the setting, and seeing `off` is how you
     *  know the plugin is loaded and deliberately doing nothing. (pi hides it when off; the
     *  owner asked for the name instead.) */
    const Badge = () => (() => {
      var _el$ = _$createElement("box"),
        _el$2 = _$createElement("text"),
        _el$4 = _$createElement("text"),
        _el$5 = _$createTextNode(` `);
      _$insertNode(_el$, _el$2);
      _$insertNode(_el$, _el$4);
      _$setProp(_el$, "flexDirection", "row");
      _$setProp(_el$, "flexShrink", 0);
      _$insertNode(_el$2, _$createTextNode(`󰛊`));
      _$setProp(_el$2, "wrapMode", "none");
      _$insertNode(_el$4, _el$5);
      _$setProp(_el$4, "fg", DIM);
      _$setProp(_el$4, "wrapMode", "none");
      _$insert(_el$4, level, null);
      _$effect(_$p => _$setProp(_el$2, "fg", active() ? GREEN : DIM, _$p));
      return _el$;
    })();
    context.ui.slot({
      append: "prompt.footer.status",
      render: () => _$createComponent(Badge, {})
    });
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "oc-coffee.menu",
        title: "Coffee: sleep prevention",
        group: "Coffee",
        palette: true,
        slash: {
          name: "coffee",
          arguments: true
        },
        run: async input => {
          const argument = (input ?? "").trim().split(/\s+/).filter(Boolean)[0];
          if (argument === "status") {
            await context.ui.dialog.alert({
              title: `${CUP_GLYPH} Coffee`,
              message: describe()
            });
            return;
          }
          if (isLevel(argument)) {
            await setLevel(argument);
            context.ui.toast.show({
              message: describe()
            });
            return;
          }
          if (argument !== undefined) {
            context.ui.toast.show({
              message: `usage: /coffee [${LEVELS.join(" | ")} | status]`,
              variant: "warning"
            });
            return;
          }
          const picked = await context.ui.dialog.select({
            title: `${CUP_GLYPH} Sleep prevention`,
            current: level(),
            options: LEVELS.map(candidate => ({
              title: candidate === level() ? `${LEVEL_MENU[candidate]}` : LEVEL_MENU[candidate],
              value: candidate
            }))
          });
          if (picked) {
            await setLevel(String(picked));
            context.ui.toast.show({
              message: describe()
            });
          }
        }
      }]
    }));
    return () => {
      stopStarted?.();
      stopSucceeded?.();
      stopFailed?.();
      stopInterrupted?.();
      release();
    };
  }
});

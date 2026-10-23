// oc-git — server half: empty on purpose.
//
// The loader resolves a plugin directory by entry file names (`index`/`server`, `tui`, `rpc`) and a
// missing server entry fails the whole load, so a TUI-only plugin still needs this file.
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
	id: "oc-git",
	setup() {},
})

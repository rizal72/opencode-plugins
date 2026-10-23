// oc-context — server half.
//
// Deliberately empty: this plugin only draws the sidebar's context block, and the TUI half is
// the whole of it. The file exists because the loader resolves a plugin directory by entry
// file names (`index`/`server`, `tui`, `rpc`) and a missing server entry fails the load.
export default {
	id: "oc-context",
	setup() {
		// nothing to do on the server
	},
}

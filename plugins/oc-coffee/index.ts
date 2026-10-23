// oc-coffee — server half.
//
// Deliberately empty: everything happens in the TUI half. It exists because the loader
// resolves a plugin directory by entry file names (`index`/`server`, `tui`, `rpc`) and a
// missing server entry fails the whole load.
export default {
	id: "oc-coffee",
	setup() {
		// nothing to do on the server
	},
}

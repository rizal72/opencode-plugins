// oc-ponytail-widget — server half.
//
// Deliberately empty: this plugin only draws the level badge, and the TUI half is the whole of it.
// The file exists because the loader resolves a plugin directory by entry file names
// (`index`/`server`, `tui`, `rpc`) and a missing server entry fails the load.
export default {
	id: "oc-ponytail-widget",
	setup() {
		// nothing to do on the server
	},
}

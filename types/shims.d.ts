// Types the runtime provides but does not publish.
//
// The TUI's JSX intrinsics (`box`, `text` with `fg`) exist inside OpenCode's TUI at run time only: it
// bundles its own renderer and ships no `.d.ts` for them, so a type check would otherwise fail on every
// TUI half for a reason that has nothing to do with our code. They stay `any` here: the host's, not ours.
//
// `solid-js` is **not** declared here. A `declare module "solid-js"` at the top level of this file would
// not extend the library's typings, it would replace them for the whole program — every type it does not
// name becomes `any` under `skipLibCheck`, and a third-party component library's props degrade to an index
// signature, so a misspelt prop compiles. The real typings are used; this file only fills the holes.

// `bun:sqlite` is inside the binary OpenCode runs as: no external `sqlite3` to install. Only the
// three calls our code makes are typed.
declare module "bun:sqlite" {
	export class Database {
		constructor(path: string, options?: { readonly?: boolean })
		query(sql: string): { all(): unknown[] }
		close(): void
	}
}

declare namespace JSX {
	interface IntrinsicElements {
		[element: string]: any
	}
	// Solid's own element type, taken from the library rather than reinvented: a signature that says
	// `(item: T) => Element` in a library, or in `For`/`Show`, then accepts what our JSX produces.
	type Element = import("solid-js").JSX.Element
	/** Without this, the compiler does not know that a component's JSX children belong to its `children` prop:
	 *  every component of ours would report "children is missing" at the tag, and nothing else would. */
	interface ElementChildrenAttribute {
		children: {}
	}
}

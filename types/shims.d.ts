// Types the runtime provides but does not publish.
//
// `solid-js` and the TUI's JSX intrinsics (`box`, `text` with `fg`) exist inside OpenCode's TUI at run
// time only: it bundles its own renderer and ships no `.d.ts` for them, so a type check would otherwise
// fail on every `.tsx` for a reason that has nothing to do with our code. Everything from them is `any`
// here, which keeps the check honest: what is typed is our code, what is not is the host's.
declare module "solid-js" {
	// Generic where our code passes type arguments, so the call itself is typed even though the
	// implementation is the host's; everything else stays `any`.
	export function createSignal<T>(value: T): [() => T, (next: T) => void]
	export function createMemo<T>(fn: () => T, ...rest: any[]): () => T
	export const createEffect: any
	export const createRoot: any
	export const onCleanup: any
	export const For: any
	// Children stay permissive: a stricter union made the compiler contextualise the callback as an
	// object (every function matches a permissive index signature) and lose its parameter type. The
	// three callbacks in our code therefore annotate their parameter at this boundary.
	export function Show(props: { when: any; keyed?: boolean; fallback?: any; children?: any }): any
}

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
	interface Element {
		[key: string]: any
	}
}

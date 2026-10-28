// One parser and one read, shared by the TUI half and the server half.
//
// The read is a shell call, so only the server and the terminal can make it: a GUI plugin window has
// no Node built-ins, which is why it goes through the RPC in `rpc.ts` instead.
import { execFile } from "node:child_process"

export type Status = {
	branch: string
	ahead?: number
	behind?: number
	added: number
	modified: number
	untracked: number
}

/** `git status --porcelain=v2 --branch` -> the block's six numbers. */
export function parse(text: string): Status | undefined {
	let branch: string | undefined
	let ahead: number | undefined
	let behind: number | undefined
	let added = 0
	let modified = 0
	let untracked = 0

	for (const line of text.split("\n")) {
		if (line.startsWith("# branch.head ")) {
			branch = line.slice("# branch.head ".length).trim()
		} else if (line.startsWith("# branch.ab ")) {
			const match = line.match(/\+(\d+)\s+-(\d+)/)
			if (match) {
				ahead = Number(match[1])
				behind = Number(match[2])
			}
		} else if (line.startsWith("? ")) {
			untracked += 1
		} else if (line.startsWith("1 ") || line.startsWith("2 ") || line.startsWith("u ")) {
			if (line[2] === "A") added += 1
			else modified += 1
		}
	}

	if (branch === undefined) return undefined
	return { branch, ahead, behind, added, modified, untracked }
}

/** One read-only call. `undefined` outside a repository, or on a machine without git. */
export function read(directory: string): Promise<Status | undefined> {
	return new Promise((resolve) => {
		execFile(
			"git",
			["status", "--porcelain=v2", "--branch"],
			{ cwd: directory, maxBuffer: 8 * 1024 * 1024 },
			(error, stdout) => resolve(error ? undefined : parse(stdout)),
		)
	})
}

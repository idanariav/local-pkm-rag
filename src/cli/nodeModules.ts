import { Platform } from "obsidian";

/** Node built-ins, loaded on first use rather than at plugin load: on mobile they don't exist,
 *  so a top-level import (bundled as a module-scope require) would crash the whole plugin. */
function load<T>(id: string): T {
	if (!Platform.isDesktopApp) {
		throw new Error(`"${id}" is unavailable: CLI tools need the desktop app`);
	}
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	return require(id) as T;
}

export const nodeFs = () => load<typeof import("fs")>("fs");
export const nodeOs = () => load<typeof import("os")>("os");
export const nodePath = () => load<typeof import("path")>("path");
export const nodeChildProcess = () => load<typeof import("child_process")>("child_process");

export type ToolId = "qmd" | "qimg" | "qnode" | "qvoid";

export type FlagType = "string" | "number" | "boolean" | "enum" | "path" | "date";

export interface FlagSpec {
	flag: string;
	shortFlag?: string;
	type: FlagType;
	label: string;
	description?: string;
	enumValues?: string[];
	default?: string | number | boolean;
	repeatable?: boolean;
	required?: boolean;
}

export interface PositionalArgSpec {
	name: string;
	type: FlagType;
	label: string;
	required: boolean;
	description?: string;
	enumValues?: string[];
}

export type ExecutionMode = "buffered" | "streaming";

/** "search" = the frequent, day-to-day query/lookup actions. "infra" = setup and
 *  maintenance actions (collections, indexing, models) run rarely by comparison. */
export type CommandCategory = "search" | "infra";

export interface CommandNode {
	id: string;
	argvPath: string[];
	label: string;
	description?: string;
	category: CommandCategory;
	positionals: PositionalArgSpec[];
	flags: FlagSpec[];
	executionMode: ExecutionMode;
	jsonFlag?: string;
	destructive?: boolean;
}

export interface ToolSchema {
	id: ToolId;
	commands: CommandNode[];
}

export interface ToolDefinition {
	id: ToolId;
	displayName: string;
	npmPackage: string;
	binaryName: string;
	configPathHint: string;
	healthCheckCommand: string[];
	schema: ToolSchema;
}

export type DetectStatus = "not-found" | "unhealthy" | "healthy";

export interface DetectResult {
	status: DetectStatus;
	resolvedPath?: string;
	message?: string;
}

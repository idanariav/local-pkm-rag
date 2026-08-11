import { ToolDefinition, ToolId } from "./types";
import { qmdSchema } from "./schemas/qmd";
import { qimgSchema } from "./schemas/qimg";
import { qnodeSchema } from "./schemas/qnode";
import { qvoidSchema } from "./schemas/qvoid";

export const TOOL_IDS: ToolId[] = ["qmd", "qimg", "qnode", "qvoid"];

/** Central registry: adding a 5th tool is one entry here + one schema file, no UI changes. */
export const TOOLS: Record<ToolId, ToolDefinition> = {
	qmd: {
		id: "qmd",
		displayName: "qmd (search)",
		npmPackage: "@idan_ariav/qmd",
		binaryName: "qmd",
		configPathHint: "~/.config/qmd/index.yml",
		healthCheckCommand: ["status"],
		schema: qmdSchema,
	},
	qimg: {
		id: "qimg",
		displayName: "qimg (image search)",
		npmPackage: "@idan_ariav/qimg",
		binaryName: "qimg",
		configPathHint: "~/.config/qimg/index.yml",
		healthCheckCommand: ["status"],
		schema: qimgSchema,
	},
	qnode: {
		id: "qnode",
		displayName: "qnode (link graph)",
		npmPackage: "@idan_ariav/qnode",
		binaryName: "qnode",
		configPathHint: "~/.config/qnode/index.yml",
		healthCheckCommand: ["status"],
		schema: qnodeSchema,
	},
	qvoid: {
		id: "qvoid",
		displayName: "qvoid (unresolved links)",
		npmPackage: "@idan_ariav/qvoid",
		binaryName: "qvoid",
		configPathHint: "~/.config/qvoid/collections.toml",
		healthCheckCommand: ["collections"],
		schema: qvoidSchema,
	},
};

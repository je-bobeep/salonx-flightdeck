// Stdio MCP server exposing flightdeck's tool palette to `claude -p`.
// CRITICAL: stdout is the JSON-RPC channel. Never console.log() — use
// console.error() for any logging (which goes to stderr).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  readBdFeedback,
  readBdFeedbackSchema,
  readFeatureDev,
  readFeatureDevSchema,
  searchFeatureDev,
  searchFeatureDevSchema,
} from "./tools/lark.ts";
import {
  readIndex,
  readIndexSchema,
  searchPrdIndexTool,
  searchPrdIndexSchema,
  readFile,
  readFileSchema,
  gitLogGrepTool,
  gitLogGrepSchema,
  ghPrSearchTool,
  ghPrSearchSchema,
  kbSearchTool,
  kbSearchSchema,
  codeGrepTool,
  codeGrepSchema,
} from "./tools/siblings.ts";
import {
  createDevTicket,
  createDevTicketSchema,
  updateBdStatus,
  updateBdStatusSchema,
  createBdDevLink,
  createBdDevLinkSchema,
  writeStakeholderMd,
  writeStakeholderMdSchema,
} from "./tools/propose.ts";

const server = new McpServer({ name: "flightdeck", version: "0.1.0" });

server.registerTool("lark_read_bd_feedback", readBdFeedbackSchema, readBdFeedback);
server.registerTool("lark_read_feature_dev", readFeatureDevSchema, readFeatureDev);
server.registerTool("lark_search_feature_dev", searchFeatureDevSchema, searchFeatureDev);

server.registerTool("siblings_read_index", readIndexSchema, readIndex);
server.registerTool("siblings_search_prd_index", searchPrdIndexSchema, searchPrdIndexTool);
server.registerTool("siblings_read_file", readFileSchema, readFile);
server.registerTool("siblings_git_log_grep", gitLogGrepSchema, gitLogGrepTool);
server.registerTool("siblings_gh_pr_search", ghPrSearchSchema, ghPrSearchTool);
server.registerTool("siblings_kb_search", kbSearchSchema, kbSearchTool);
server.registerTool("siblings_code_grep", codeGrepSchema, codeGrepTool);

server.registerTool("propose_create_dev_ticket", createDevTicketSchema, createDevTicket);
server.registerTool("propose_update_bd_status", updateBdStatusSchema, updateBdStatus);
server.registerTool("propose_create_bd_dev_link", createBdDevLinkSchema, createBdDevLink);
server.registerTool("propose_write_stakeholder_md", writeStakeholderMdSchema, writeStakeholderMd);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[flightdeck-mcp] server connected over stdio");

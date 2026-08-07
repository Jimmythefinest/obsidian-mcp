import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Get vault path from environment
const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH;
if (!VAULT_PATH) {
  console.error("OBSIDIAN_VAULT_PATH environment variable is required.");
  process.exit(1);
}

const server = new Server(
  {
    name: "obsidian-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list-notes",
        description: "List all markdown notes in the Obsidian vault",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "read-note",
        description: "Read the content of a specific markdown note",
        inputSchema: {
          type: "object",
          properties: {
            notePath: {
              type: "string",
              description: "The path of the note relative to the vault root, including the .md extension",
            },
          },
          required: ["notePath"],
        },
      },
      {
        name: "search-notes",
        description: "Search for a string across all markdown notes in the vault",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The text to search for",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "create-note",
        description: "Create a new markdown note",
        inputSchema: {
          type: "object",
          properties: {
            notePath: {
              type: "string",
              description: "The path of the new note relative to the vault root (including .md extension)",
            },
            content: {
              type: "string",
              description: "The content of the note",
            },
          },
          required: ["notePath", "content"],
        },
      },
      {
        name: "append-to-note",
        description: "Append content to an existing markdown note",
        inputSchema: {
          type: "object",
          properties: {
            notePath: {
              type: "string",
              description: "The path of the existing note",
            },
            content: {
              type: "string",
              description: "The content to append",
            },
          },
          required: ["notePath", "content"],
        },
      },
      {
        name: "delete-note",
        description: "Delete an existing markdown note",
        inputSchema: {
          type: "object",
          properties: {
            notePath: {
              type: "string",
              description: "The path of the note to delete",
            },
          },
          required: ["notePath"],
        },
      },
      {
        name: "git-push",
        description: "Run git push in the Obsidian vault",
        inputSchema: {
          type: "object",
          properties: {
            commitMessage: {
              type: "string",
              description: "Optional commit message. If provided, will run git add . and git commit before pushing.",
            },
          },
        },
      }
    ],
  };
});

// Helper to safely resolve paths inside the vault
function resolveVaultPath(notePath: string): string {
  const absoluteVaultPath = path.resolve(VAULT_PATH!);
  const resolvedPath = path.resolve(absoluteVaultPath, notePath);
  if (!resolvedPath.startsWith(absoluteVaultPath)) {
    throw new McpError(ErrorCode.InvalidParams, "Path traversal is not allowed");
  }
  return resolvedPath;
}

// Recursively find all markdown files
async function findAllMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const res = path.resolve(dir, entry.name);
      return entry.isDirectory() ? findAllMarkdownFiles(res) : res;
    })
  );
  return Array.prototype.concat(...files).filter((file) => file.endsWith(".md"));
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "list-notes": {
      try {
        const files = await findAllMarkdownFiles(VAULT_PATH!);
        // Return paths relative to vault root
        const relativeFiles = files.map((f) => path.relative(VAULT_PATH!, f));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(relativeFiles, null, 2),
            },
          ],
        };
      } catch (error: any) {
        throw new McpError(ErrorCode.InternalError, `Failed to list notes: ${error.message}`);
      }
    }

    case "read-note": {
      const notePath = request.params.arguments?.notePath as string;
      if (!notePath) {
        throw new McpError(ErrorCode.InvalidParams, "notePath is required");
      }
      try {
        const fullPath = resolveVaultPath(notePath);
        const content = await fs.readFile(fullPath, "utf-8");
        return {
          content: [
            {
              type: "text",
              text: content,
            },
          ],
        };
      } catch (error: any) {
        if (error.code === "ENOENT") {
           throw new McpError(ErrorCode.InvalidParams, `Note not found: ${notePath}`);
        }
        throw new McpError(ErrorCode.InternalError, `Failed to read note: ${error.message}`);
      }
    }

    case "search-notes": {
      const query = request.params.arguments?.query as string;
      if (!query) {
        throw new McpError(ErrorCode.InvalidParams, "query is required");
      }
      try {
        const files = await findAllMarkdownFiles(VAULT_PATH!);
        const results: { file: string; match: string }[] = [];
        
        for (const file of files) {
          const content = await fs.readFile(file, "utf-8");
          if (content.toLowerCase().includes(query.toLowerCase())) {
            const index = content.toLowerCase().indexOf(query.toLowerCase());
            const snippetStart = Math.max(0, index - 50);
            const snippetEnd = Math.min(content.length, index + query.length + 50);
            results.push({
              file: path.relative(VAULT_PATH!, file),
              match: content.substring(snippetStart, snippetEnd).replace(/\n/g, " "),
            });
          }
        }
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (error: any) {
        throw new McpError(ErrorCode.InternalError, `Failed to search notes: ${error.message}`);
      }
    }

    case "create-note": {
      const notePath = request.params.arguments?.notePath as string;
      const content = request.params.arguments?.content as string;
      if (!notePath || content === undefined) {
        throw new McpError(ErrorCode.InvalidParams, "notePath and content are required");
      }
      try {
        const fullPath = resolveVaultPath(notePath);
        
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        
        try {
           await fs.access(fullPath);
           throw new McpError(ErrorCode.InvalidParams, `Note already exists: ${notePath}`);
        } catch (e: any) {
           if (e.code !== "ENOENT") throw e;
        }

        await fs.writeFile(fullPath, content, "utf-8");
        return {
          content: [
            {
              type: "text",
              text: `Successfully created note: ${notePath}`,
            },
          ],
        };
      } catch (error: any) {
        if (error instanceof McpError) throw error;
        throw new McpError(ErrorCode.InternalError, `Failed to create note: ${error.message}`);
      }
    }

    case "append-to-note": {
      const notePath = request.params.arguments?.notePath as string;
      const content = request.params.arguments?.content as string;
      if (!notePath || !content) {
        throw new McpError(ErrorCode.InvalidParams, "notePath and content are required");
      }
      try {
        const fullPath = resolveVaultPath(notePath);
        
        await fs.appendFile(fullPath, "\n" + content, "utf-8");
        return {
          content: [
            {
              type: "text",
              text: `Successfully appended to note: ${notePath}`,
            },
          ],
        };
      } catch (error: any) {
        throw new McpError(ErrorCode.InternalError, `Failed to append to note: ${error.message}`);
      }
    }

    case "delete-note": {
      const notePath = request.params.arguments?.notePath as string;
      if (!notePath) {
        throw new McpError(ErrorCode.InvalidParams, "notePath is required");
      }
      try {
        const fullPath = resolveVaultPath(notePath);
        await fs.unlink(fullPath);
        return {
          content: [
            {
              type: "text",
              text: `Successfully deleted note: ${notePath}`,
            },
          ],
        };
      } catch (error: any) {
        if (error.code === "ENOENT") {
           throw new McpError(ErrorCode.InvalidParams, `Note not found: ${notePath}`);
        }
        throw new McpError(ErrorCode.InternalError, `Failed to delete note: ${error.message}`);
      }
    }

    case "git-push": {
      const commitMessage = request.params.arguments?.commitMessage as string | undefined;
      try {
        let stdout = "";
        let stderr = "";
        if (commitMessage) {
          const addResult = await execAsync("git add .", { cwd: VAULT_PATH });
          stdout += addResult.stdout;
          stderr += addResult.stderr ? addResult.stderr + "\n" : "";
          try {
             const commitResult = await execAsync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { cwd: VAULT_PATH });
             stdout += commitResult.stdout;
             stderr += commitResult.stderr ? commitResult.stderr + "\n" : "";
          } catch (e: any) {
             if (e.stdout && e.stdout.includes("nothing to commit")) {
               stdout += e.stdout;
             } else {
               throw e;
             }
          }
        }
        
        const pushResult = await execAsync("git push", { cwd: VAULT_PATH });
        stdout += pushResult.stdout;
        stderr += pushResult.stderr ? pushResult.stderr + "\n" : "";

        return {
          content: [
            {
              type: "text",
              text: `Git push completed.\nStdout:\n${stdout}\nStderr:\n${stderr}`,
            },
          ],
        };
      } catch (error: any) {
        throw new McpError(ErrorCode.InternalError, `Git push failed: ${error.message}\nStdout: ${error.stdout || ""}\nStderr: ${error.stderr || ""}`);
      }
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Obsidian MCP server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { exec, spawn, ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execAsync = promisify(exec);

const server = new Server(
  {
    name: "shell-mcp",
    version: "1.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

interface BackgroundTask {
  process: ChildProcess;
  output: string;
  status: 'running' | 'exited' | 'error';
  exitCode: number | null;
}

const backgroundTasks = new Map<string, BackgroundTask>();
const MAX_OUTPUT_LENGTH = 10000;

function appendOutput(taskId: string, data: string) {
  const task = backgroundTasks.get(taskId);
  if (task) {
    task.output += data;
    if (task.output.length > MAX_OUTPUT_LENGTH) {
      task.output = task.output.slice(-MAX_OUTPUT_LENGTH);
    }
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "run_command",
        description: "Executes a shell command. Use this tool cautiously as it provides full access to the system shell.",
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to execute",
            },
            cwd: {
              type: "string",
              description: "Optional: The working directory in which to execute the command",
            },
          },
          required: ["command"],
        },
      },
      {
        name: "start_background_command",
        description: "Starts a long-running shell command in the background. Returns a taskId to check status.",
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to start in the background",
            },
            cwd: {
              type: "string",
              description: "Optional: The working directory in which to execute the command",
            },
          },
          required: ["command"],
        },
      },
      {
        name: "check_command_status",
        description: "Checks the status and gets recent output of a background command.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "The ID of the task to check",
            }
          },
          required: ["taskId"],
        },
      },
      {
        name: "stop_command",
        description: "Stops a running background command.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "The ID of the task to stop",
            }
          },
          required: ["taskId"],
        },
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "run_command") {
    const { command, cwd } = request.params.arguments as {
      command: string;
      cwd?: string;
    };

    try {
      const { stdout, stderr } = await execAsync(command, { cwd });

      let resultText = "";
      if (stdout) {
        resultText += `STDOUT:\n${stdout}\n`;
      }
      if (stderr) {
        resultText += `STDERR:\n${stderr}\n`;
      }

      if (!resultText) {
         resultText = "Command executed successfully with no output.";
      }

      return {
        content: [{ type: "text", text: resultText }],
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Command failed with error:\n${error.message}\n\nSTDOUT:\n${error.stdout || ""}\n\nSTDERR:\n${error.stderr || ""}` }],
      };
    }
  }

  if (request.params.name === "start_background_command") {
    const { command, cwd } = request.params.arguments as { command: string, cwd?: string };
    const taskId = randomUUID();

    const child = spawn(command, { cwd, shell: true });
    
    backgroundTasks.set(taskId, {
      process: child,
      output: '',
      status: 'running',
      exitCode: null
    });

    child.stdout.on('data', (data) => {
      appendOutput(taskId, data.toString());
    });

    child.stderr.on('data', (data) => {
      appendOutput(taskId, data.toString());
    });

    child.on('close', (code) => {
      const task = backgroundTasks.get(taskId);
      if (task) {
        task.status = 'exited';
        task.exitCode = code;
      }
    });

    child.on('error', (err) => {
      const task = backgroundTasks.get(taskId);
      if (task) {
        task.status = 'error';
        task.output += `\nError: ${err.message}`;
      }
    });

    return {
      content: [{ type: "text", text: `Background command started successfully.\nTask ID: ${taskId}` }]
    };
  }

  if (request.params.name === "check_command_status") {
    const { taskId } = request.params.arguments as { taskId: string };
    const task = backgroundTasks.get(taskId);
    
    if (!task) {
      return { isError: true, content: [{ type: "text", text: `Task with ID ${taskId} not found.` }] };
    }

    const outputString = task.output ? `\n\nRecent Output:\n${task.output}` : '\n\n(No output)';

    return {
      content: [{ type: "text", text: `Task ID: ${taskId}\nStatus: ${task.status}\nExit Code: ${task.exitCode !== null ? task.exitCode : 'N/A'}${outputString}` }]
    };
  }

  if (request.params.name === "stop_command") {
    const { taskId } = request.params.arguments as { taskId: string };
    const task = backgroundTasks.get(taskId);
    
    if (!task) {
      return { isError: true, content: [{ type: "text", text: `Task with ID ${taskId} not found.` }] };
    }

    if (task.status !== 'running') {
      return { content: [{ type: "text", text: `Task is already in status: ${task.status}` }] };
    }

    // Attempt graceful termination
    task.process.kill('SIGTERM');

    return {
      content: [{ type: "text", text: `Sent SIGTERM to task ${taskId}. Check status to confirm termination.` }]
    };
  }

  throw new Error(`Tool not found: ${request.params.name}`);
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Shell MCP server running on stdio");
}

run().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

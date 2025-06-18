import { createFiberplane, createOpenAPISpec } from "@fiberplane/hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { toReqRes, toFetchResponse } from "fetch-to-node";
import { z } from "zod";
import * as schema from "./db/schema";

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

// Helper function to extract input parameters from template
function extractInputs(template: string): string[] {
  const regex = /\{([^}]+)\}/g;
  const inputs = new Set<string>();
  let match;
  
  while ((match = regex.exec(template)) !== null) {
    inputs.add(match[1]);
  }
  
  return Array.from(inputs);
}

// Create MCP server instance
function createMcpServer(db: any) {
  const server = new McpServer({ 
    name: "prompt-template-server", 
    version: "1.0.0",
    description: "MCP server for managing prompt templates with dynamic inputs"
  });

  // Helper function to load and register all prompts dynamically
  async function loadAndRegisterPrompts() {
    try {
      const templates = await db.select().from(schema.promptTemplates);
      
      for (const template of templates) {
        const inputs = await db.select()
          .from(schema.promptInputs)
          .where(eq(schema.promptInputs.templateId, template.id));

        // Create argument schema for this template
        const argumentSchema: any = {};
        for (const input of inputs) {
          argumentSchema[input.name] = z.string().describe(input.description || `Input for ${input.name}`);
          if (!input.required) {
            argumentSchema[input.name] = argumentSchema[input.name].optional();
          }
        }

        // Register the prompt dynamically
        server.prompt(
          template.name,
          argumentSchema,
          async (args: any) => {
            let renderedTemplate = template.template;
            
            // Replace variables in template
            for (const [key, value] of Object.entries(args)) {
              renderedTemplate = renderedTemplate.replace(new RegExp(`\\{${key}\\}`, 'g'), value as string);
            }

            return {
              description: template.description || `Prompt template: ${template.name}`,
              messages: [
                {
                  role: "user" as const,
                  content: {
                    type: "text" as const,
                    text: renderedTemplate,
                  },
                },
              ],
            };
          }
        );
      }
    } catch (error) {
      console.error("Error loading prompts:", error);
    }
  }

  // Load prompts on server initialization
  loadAndRegisterPrompts();

  // Tool: Save prompt template
  server.tool(
    "save_prompt_template",
    {
      name: z.string().min(1).describe("Name of the prompt template"),
      description: z.string().optional().describe("Description of the prompt template"),
      template: z.string().min(1).describe("Template string with {variable} placeholders"),
    },
    async ({ name, description, template }) => {
      try {
        // Extract inputs from template
        const inputNames = extractInputs(template);
        
        // Save template
        const [savedTemplate] = await db.insert(schema.promptTemplates)
          .values({
            name,
            description,
            template,
          })
          .returning();

        // Save inputs
        if (inputNames.length > 0) {
          await db.insert(schema.promptInputs)
            .values(
              inputNames.map(inputName => ({
                templateId: savedTemplate.id,
                name: inputName,
                required: true,
              }))
            );
        }

        // Dynamically register the new prompt
        const inputs = await db.select()
          .from(schema.promptInputs)
          .where(eq(schema.promptInputs.templateId, savedTemplate.id));

        const argumentSchema: any = {};
        for (const input of inputs) {
          argumentSchema[input.name] = z.string().describe(input.description || `Input for ${input.name}`);
          if (!input.required) {
            argumentSchema[input.name] = argumentSchema[input.name].optional();
          }
        }

        // Register the prompt dynamically
        server.prompt(
          savedTemplate.name,
          argumentSchema,
          async (args: any) => {
            let renderedTemplate = savedTemplate.template;
            
            // Replace variables in template
            for (const [key, value] of Object.entries(args)) {
              renderedTemplate = renderedTemplate.replace(new RegExp(`\\{${key}\\}`, 'g'), value as string);
            }

            return {
              description: savedTemplate.description || `Prompt template: ${savedTemplate.name}`,
              messages: [
                {
                  role: "user" as const,
                  content: {
                    type: "text" as const,
                    text: renderedTemplate,
                  },
                },
              ],
            };
          }
        );

        return {
          content: [
            {
              type: "text",
              text: `Successfully saved prompt template "${name}" with ${inputNames.length} input parameters: ${inputNames.join(", ")}. The prompt is now available in the prompts list.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error saving prompt template: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: Update prompt template
  server.tool(
    "update_prompt_template",
    {
      id: z.string().min(1).describe("ID of the prompt template to update"),
      name: z.string().optional().describe("New name for the template"),
      description: z.string().optional().describe("New description for the template"),
      template: z.string().optional().describe("New template string"),
    },
    async ({ id, name, description, template }) => {
      try {
        // Check if template exists
        const [existingTemplate] = await db.select()
          .from(schema.promptTemplates)
          .where(eq(schema.promptTemplates.id, id));

        if (!existingTemplate) {
          return {
            content: [
              {
                type: "text",
                text: `Template with ID "${id}" not found`,
              },
            ],
            isError: true,
          };
        }

        const updateData: any = {};
        if (name !== undefined) {
          updateData.name = name;
        }
        if (description !== undefined) {
          updateData.description = description;
        }
        if (template !== undefined) {
          updateData.template = template;
        }

        // Update template
        const [updatedTemplate] = await db.update(schema.promptTemplates)
          .set(updateData)
          .where(eq(schema.promptTemplates.id, id))
          .returning();

        // If template was updated, re-extract inputs and re-register prompt
        if (template !== undefined) {
          // Delete existing inputs
          await db.delete(schema.promptInputs)
            .where(eq(schema.promptInputs.templateId, id));

          // Extract and save new inputs
          const inputNames = extractInputs(template);
          if (inputNames.length > 0) {
            await db.insert(schema.promptInputs)
              .values(
                inputNames.map(inputName => ({
                  templateId: id,
                  name: inputName,
                  required: true,
                }))
              );
          }
        }

        // Re-register the updated prompt
        const inputs = await db.select()
          .from(schema.promptInputs)
          .where(eq(schema.promptInputs.templateId, id));

        const argumentSchema: any = {};
        for (const input of inputs) {
          argumentSchema[input.name] = z.string().describe(input.description || `Input for ${input.name}`);
          if (!input.required) {
            argumentSchema[input.name] = argumentSchema[input.name].optional();
          }
        }

        // Update the prompt registration
        server.prompt(
          updatedTemplate.name,
          argumentSchema,
          async (args: any) => {
            let renderedTemplate = updatedTemplate.template;
            
            // Replace variables in template
            for (const [key, value] of Object.entries(args)) {
              renderedTemplate = renderedTemplate.replace(new RegExp(`\\{${key}\\}`, 'g'), value as string);
            }

            return {
              description: updatedTemplate.description || `Prompt template: ${updatedTemplate.name}`,
              messages: [
                {
                  role: "user" as const,
                  content: {
                    type: "text" as const,
                    text: renderedTemplate,
                  },
                },
              ],
            };
          }
        );

        return {
          content: [
            {
              type: "text",
              text: `Successfully updated prompt template "${updatedTemplate.name}". The prompt list has been updated.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error updating prompt template: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: Delete prompt template
  server.tool(
    "delete_prompt_template",
    {
      id: z.string().min(1).describe("ID of the prompt template to delete"),
    },
    async ({ id }) => {
      try {
        // Check if template exists
        const [existingTemplate] = await db.select()
          .from(schema.promptTemplates)
          .where(eq(schema.promptTemplates.id, id));

        if (!existingTemplate) {
          return {
            content: [
              {
                type: "text",
                text: `Template with ID "${id}" not found`,
              },
            ],
            isError: true,
          };
        }

        // Remove the prompt from the server first
        server.removePrompt(existingTemplate.name);

        // Delete template (inputs will be deleted via cascade)
        await db.delete(schema.promptTemplates)
          .where(eq(schema.promptTemplates.id, id));

        return {
          content: [
            {
              type: "text",
              text: `Successfully deleted prompt template "${existingTemplate.name}". The prompt has been removed from the prompts list.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting prompt template: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: List prompt templates
  server.tool(
    "list_prompt_templates",
    {},
    async () => {
      try {
        const templates = await db.select()
          .from(schema.promptTemplates);

        const templateList = templates.map((template: any) => ({
          id: template.id,
          name: template.name,
          description: template.description,
          template: template.template,
          createdAt: template.createdAt,
          updatedAt: template.updatedAt,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(templateList, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing prompt templates: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register prompts dynamically - we'll need to handle this differently
  // since MCP doesn't support dynamic prompt registration in this way
  // Instead, we'll provide a tool to get available prompts and render them
  server.tool(
    "get_prompt_by_name",
    {
      name: z.string().min(1).describe("Name of the prompt template to retrieve"),
      inputs: z.record(z.string()).optional().describe("Input values for template variables"),
    },
    async ({ name, inputs = {} }) => {
      try {
        // Find template by name
        const [template] = await db.select()
          .from(schema.promptTemplates)
          .where(eq(schema.promptTemplates.name, name));

        if (!template) {
          return {
            content: [
              {
                type: "text",
                text: `Template "${name}" not found`,
              },
            ],
            isError: true,
          };
        }

        // Get inputs for this template
        const templateInputs = await db.select()
          .from(schema.promptInputs)
          .where(eq(schema.promptInputs.templateId, template.id));

        // Replace variables in template
        let renderedTemplate = template.template;
        for (const [key, value] of Object.entries(inputs)) {
          renderedTemplate = renderedTemplate.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
        }

        // Check for missing required inputs
        const missingInputs = templateInputs
          .filter((input: any) => input.required && !inputs[input.name])
          .map((input: any) => input.name);

        if (missingInputs.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: `Missing required inputs: ${missingInputs.join(", ")}\\n\\nTemplate: ${template.template}\\nAvailable inputs: ${templateInputs.map((i: any) => i.name).join(", ")}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: renderedTemplate,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error loading template: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}

app.get("/", (c) => {
  return c.text("Prompt Template MCP Server");
});

// MCP endpoint
app.post("/mcp", async (c) => {
  const { req, res } = toReqRes(c.req.raw);
  const db = drizzle(c.env.DB);
  const mcpServer = createMcpServer(db);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, await c.req.json());

  return toFetchResponse(res);
});

// Return JSON-RPC error for unsupported HTTP methods
app.on(["GET", "PUT", "DELETE", "PATCH"], "/mcp", async (c) => {
  return c.json(
    {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed. MCP endpoint only supports POST requests.",
      },
      id: null,
    },
    405,
  );
});

// REST API endpoints for template management
app.get("/api/templates", async (c) => {
  const db = drizzle(c.env.DB);
  const templates = await db.select().from(schema.promptTemplates);
  return c.json({ templates });
});

app.get("/api/templates/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  
  const [template] = await db.select()
    .from(schema.promptTemplates)
    .where(eq(schema.promptTemplates.id, id));

  if (!template) {
    return c.json({ error: "Template not found" }, 404);
  }

  const inputs = await db.select()
    .from(schema.promptInputs)
    .where(eq(schema.promptInputs.templateId, id));

  return c.json({ template: { ...template, inputs } });
});

app.post("/api/templates", async (c) => {
  const db = drizzle(c.env.DB);
  const { name, description, template } = await c.req.json();

  try {
    const inputNames = extractInputs(template);
    
    const [savedTemplate] = await db.insert(schema.promptTemplates)
      .values({
        name,
        description,
        template,
      })
      .returning();

    if (inputNames.length > 0) {
      await db.insert(schema.promptInputs)
        .values(
          inputNames.map(inputName => ({
            templateId: savedTemplate.id,
            name: inputName,
            required: true,
          }))
        );
    }

    return c.json({ template: savedTemplate }, 201);
  } catch (error) {
    return c.json({ 
      error: "Failed to create template",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
});

app.put("/api/templates/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const { name, description, template } = await c.req.json();

  try {
    const [existingTemplate] = await db.select()
      .from(schema.promptTemplates)
      .where(eq(schema.promptTemplates.id, id));

    if (!existingTemplate) {
      return c.json({ error: "Template not found" }, 404);
    }

    const updateData: any = {};
    if (name !== undefined) {
      updateData.name = name;
    }
    if (description !== undefined) {
      updateData.description = description;
    }
    if (template !== undefined) {
      updateData.template = template;
    }

    const [updatedTemplate] = await db.update(schema.promptTemplates)
      .set(updateData)
      .where(eq(schema.promptTemplates.id, id))
      .returning();

    if (template !== undefined) {
      await db.delete(schema.promptInputs)
        .where(eq(schema.promptInputs.templateId, id));

      const inputNames = extractInputs(template);
      if (inputNames.length > 0) {
        await db.insert(schema.promptInputs)
          .values(
            inputNames.map(inputName => ({
              templateId: id,
              name: inputName,
              required: true,
            }))
          );
      }
    }

    return c.json({ template: updatedTemplate });
  } catch (error) {
    return c.json({ 
      error: "Failed to update template",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
});

app.delete("/api/templates/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");

  try {
    const [existingTemplate] = await db.select()
      .from(schema.promptTemplates)
      .where(eq(schema.promptTemplates.id, id));

    if (!existingTemplate) {
      return c.json({ error: "Template not found" }, 404);
    }

    await db.delete(schema.promptTemplates)
      .where(eq(schema.promptTemplates.id, id));

    return c.json({ success: true });
  } catch (error) {
    return c.json({ 
      error: "Failed to delete template",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
});

app.get("/openapi.json", c => {
  return c.json(createOpenAPISpec(app, {
    info: {
      title: "Prompt Template MCP Server",
      version: "1.0.0",
    },
  }))
});

app.use("/fp/*", createFiberplane({
  app,
  openapi: { url: "/openapi.json" }
}));

export default app;
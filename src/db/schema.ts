import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

export const promptTemplates = sqliteTable("prompt_templates", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  template: text("template").notNull(),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export const promptInputs = sqliteTable("prompt_inputs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  templateId: text("template_id").notNull().references(() => promptTemplates.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  required: integer("required", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export const promptTemplatesRelations = relations(promptTemplates, ({ many }) => ({
  inputs: many(promptInputs),
}));

export const promptInputsRelations = relations(promptInputs, ({ one }) => ({
  template: one(promptTemplates, {
    fields: [promptInputs.templateId],
    references: [promptTemplates.id],
  }),
}));
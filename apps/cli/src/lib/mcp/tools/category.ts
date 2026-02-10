/**
 * MCP Category Tools
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Category } from '../../pmo/types.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool } from '../helpers.js'

export function registerCategoryTools(server: McpServer, ctx: McpToolContext): void {
  strictTool(server,
    'category_list',
    'List categories',
    { type: z.enum(['ticket', 'status']).optional() },
    async (params) => {
      try {
        const categories = await ctx.storage.listCategories({ type: params.type })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              categories: categories.map((c: Category) => ({
                id: c.id,
                name: c.name,
                type: c.type,
                isBuiltin: c.isBuiltin,
              })),
            }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'category_create',
    'Create a category',
    {
      name: z.string().describe('Category name'),
      type: z.enum(['ticket', 'status']).describe('Category type'),
      description: z.string().optional(),
      color: z.string().optional(),
    },
    async (params) => {
      try {
        const category = await ctx.storage.createCategory({
          name: params.name,
          type: params.type,
          description: params.description,
          color: params.color,
        })
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, category: { id: category.id, name: category.name } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'category_rename',
    'Rename a category',
    {
      id: z.string().describe('Category ID'),
      name: z.string().describe('New name'),
    },
    async (params) => {
      try {
        const category = await ctx.storage.renameCategory(params.id, params.name)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, category: { id: category.id, name: category.name } }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  strictTool(server,
    'category_delete',
    'Delete a category',
    { id: z.string().describe('Category ID') },
    async (params) => {
      try {
        await ctx.storage.deleteCategory(params.id)
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: 'Category deleted' }, null, 2),
          }],
        }
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}

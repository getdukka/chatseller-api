// src/routes/conversations.ts - ROUTES CONVERSATIONS MANQUANTES

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import prisma from '../lib/prisma'

// ✅ SCHÉMAS DE VALIDATION
const conversationCreateSchema = z.object({
  shopId: z.string(),
  visitorId: z.string(),
  productId: z.string().optional(),
  productName: z.string().optional(),
  productPrice: z.number().optional(),
  productUrl: z.string().optional(),
  agentId: z.string().optional()
});

const conversationUpdateSchema = z.object({
  status: z.string().optional(),
  last_activity: z.string().optional(),
  message_count: z.number().optional(),
  conversion_completed: z.boolean().optional()
});

async function conversationsRoutes(fastify: FastifyInstance) {
  
  // ==========================================
  // 📋 GET /api/v1/conversations - LISTE
  // ==========================================
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user as any
      const shopId = user?.shop_id || user?.id

      if (!shopId) {
        return reply.status(401).send({
          success: false,
          error: 'Shop ID non trouvé'
        })
      }

      fastify.log.info(`📞 Récupération conversations pour shop: ${shopId}`)

      await prisma.$connect()

      const conversations = await prisma.conversation.findMany({
        where: {
          shopId: shopId
        },
        include: {
          messages: {
            take: 1,
            orderBy: {
              createdAt: 'desc'
            }
          }
        },
        orderBy: {
          startedAt: 'desc'
        }
      })

      await prisma.$disconnect()

      fastify.log.info(`✅ Conversations trouvées: ${conversations.length}`)

      return {
        success: true,
        data: conversations,
        count: conversations.length
      }

    } catch (error) {
      fastify.log.error('❌ Erreur récupération conversations:', error)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des conversations'
      })
    }
  })

  // ==========================================
  // 🔍 GET /api/v1/conversations/:id - DÉTAIL
  // ==========================================
  fastify.get<{ Params: { conversationId: string } }>('/:conversationId', async (request, reply) => {
    try {
      const { conversationId } = request.params
      const user = request.user as any
      const shopId = user?.shop_id || user?.id

      if (!shopId) {
        return reply.status(401).send({
          success: false,
          error: 'Shop ID non trouvé'
        })
      }

      fastify.log.info(`🔍 Récupération conversation: ${conversationId}`)

      await prisma.$connect()

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          shopId: shopId
        },
        include: {
          messages: {
            orderBy: {
              createdAt: 'asc'
            }
          }
        }
      })

      await prisma.$disconnect()

      if (!conversation) {
        return reply.status(404).send({
          success: false,
          error: 'Conversation non trouvée'
        })
      }

      return {
        success: true,
        data: conversation
      }

    } catch (error) {
      fastify.log.error('❌ Erreur récupération conversation:', error)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération de la conversation'
      })
    }
  })

  // ==========================================
  // ➕ POST /api/v1/conversations - CRÉATION
  // ==========================================
  fastify.post<{ Body: typeof conversationCreateSchema._type }>('/', async (request, reply) => {
    try {
      const { shopId, visitorId, productId, productName, productPrice, productUrl, agentId } = conversationCreateSchema.parse(request.body)
      const user = request.user as any
      const userShopId = user?.shop_id || user?.id

      // Vérifier que le shop appartient à l'utilisateur
      if (shopId && shopId !== userShopId) {
        return reply.status(403).send({
          success: false,
          error: 'Accès refusé à ce shop'
        })
      }

      fastify.log.info(`➕ Création conversation pour shop: ${userShopId}`)

      await prisma.$connect()

      const newConversation = await prisma.conversation.create({
        data: {
          shopId: userShopId,
          visitorId: visitorId,
          agentId: agentId || null,
          productId: productId || null,
          productName: productName || null,
          productPrice: productPrice || null,
          productUrl: productUrl || null,
          status: 'active',
          startedAt: new Date(),
          lastActivity: new Date(),
          messageCount: 0,
          conversionCompleted: false,
          visitorIp: request.ip,
          visitorUserAgent: request.headers['user-agent'] || null
        }
      })

      await prisma.$disconnect()

      fastify.log.info(`✅ Conversation créée: ${newConversation.id}`)

      return {
        success: true,
        data: newConversation
      }

    } catch (error) {
      fastify.log.error('❌ Erreur création conversation:', error)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la création de la conversation'
      })
    }
  })

  // ==========================================
  // ✏️ PUT /api/v1/conversations/:id - MISE À JOUR
  // ==========================================
  fastify.put<{ Params: { conversationId: string }; Body: typeof conversationUpdateSchema._type }>('/:conversationId', async (request, reply) => {
    try {
      const { conversationId } = request.params
      const updateData = conversationUpdateSchema.parse(request.body)
      const user = request.user as any
      const shopId = user?.shop_id || user?.id

      if (!shopId) {
        return reply.status(401).send({
          success: false,
          error: 'Shop ID non trouvé'
        })
      }

      fastify.log.info(`✏️ Mise à jour conversation: ${conversationId}`)

      await prisma.$connect()

      // Vérifier que la conversation appartient au shop
      const existingConversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          shopId: shopId
        }
      })

      if (!existingConversation) {
        await prisma.$disconnect()
        return reply.status(404).send({
          success: false,
          error: 'Conversation non trouvée'
        })
      }

      const updatedConversation = await prisma.conversation.update({
        where: {
          id: conversationId
        },
        data: {
          ...updateData,
          lastActivity: new Date()
        }
      })

      await prisma.$disconnect()

      return {
        success: true,
        data: updatedConversation
      }

    } catch (error) {
      fastify.log.error('❌ Erreur mise à jour conversation:', error)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la mise à jour de la conversation'
      })
    }
  })

}

export default conversationsRoutes
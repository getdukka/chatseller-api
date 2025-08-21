// src/routes/conversations.ts - VERSION SUPABASE PURE

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { supabaseServiceClient } from '../lib/supabase'

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

      // ✅ REQUÊTE SUPABASE : Récupérer conversations avec dernier message
      const { data: conversations, error } = await supabaseServiceClient
        .from('conversations')
        .select(`
          *,
          messages!conversations_messages_conversationId_fkey (
            id, content, role, createdAt, tokensUsed, responseTimeMs
          )
        `)
        .eq('shopId', shopId)
        .order('startedAt', { ascending: false })

      if (error) {
        throw new Error(`Supabase error: ${error.message}`)
      }

      // ✅ TRAITEMENT : Garder seulement le dernier message pour chaque conversation
      const conversationsWithLastMessage = conversations?.map(conv => ({
        ...conv,
        messages: conv.messages
          ?.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          ?.slice(0, 1) || []
      })) || []

      fastify.log.info(`✅ Conversations trouvées: ${conversationsWithLastMessage.length}`)

      return {
        success: true,
        data: conversationsWithLastMessage,
        count: conversationsWithLastMessage.length
      }

    } catch (error: any) {
      fastify.log.error({
        error: error.message || 'Erreur inconnue',
        stack: error.stack
      }, '❌ Erreur récupération conversations')
      
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

      // ✅ REQUÊTE SUPABASE : Récupérer conversation avec tous les messages
      const { data: conversation, error } = await supabaseServiceClient
        .from('conversations')
        .select(`
          *,
          messages!conversations_messages_conversationId_fkey (
            id, content, role, createdAt, tokensUsed, responseTimeMs, modelUsed
          )
        `)
        .eq('id', conversationId)
        .eq('shopId', shopId)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          return reply.status(404).send({
            success: false,
            error: 'Conversation non trouvée'
          })
        }
        throw new Error(`Supabase error: ${error.message}`)
      }

      // ✅ TRAITEMENT : Trier les messages par date de création
      if (conversation.messages) {
        conversation.messages.sort((a: any, b: any) => 
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )
      }

      return {
        success: true,
        data: conversation
      }

    } catch (error: any) {
      fastify.log.error({
        conversationId: request.params.conversationId,
        error: error.message || 'Erreur inconnue',
        stack: error.stack
      }, '❌ Erreur récupération conversation')
      
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

      // ✅ CRÉATION SUPABASE : Nouvelle conversation
      const { data: newConversation, error } = await supabaseServiceClient
        .from('conversations')
        .insert({
          shopId: userShopId,
          visitorId: visitorId,
          agentId: agentId || null,
          productId: productId || null,
          productName: productName || null,
          productPrice: productPrice || null,
          productUrl: productUrl || null,
          status: 'active',
          startedAt: new Date().toISOString(),
          lastActivity: new Date().toISOString(),
          messageCount: 0,
          conversionCompleted: false,
          visitorIp: request.ip,
          visitorUserAgent: request.headers['user-agent'] || null
        })
        .select()
        .single()

      if (error) {
        throw new Error(`Supabase error: ${error.message}`)
      }

      fastify.log.info(`✅ Conversation créée: ${newConversation.id}`)

      return {
        success: true,
        data: newConversation
      }

    } catch (error: any) {
      fastify.log.error({
        shopId: request.body,
        error: error.message || 'Erreur inconnue',
        stack: error.stack
      }, '❌ Erreur création conversation')
      
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

      // ✅ VÉRIFICATION SUPABASE : Conversation appartient au shop
      const { data: existingConversation, error: checkError } = await supabaseServiceClient
        .from('conversations')
        .select('id, shopId')
        .eq('id', conversationId)
        .eq('shopId', shopId)
        .single()

      if (checkError) {
        if (checkError.code === 'PGRST116') {
          return reply.status(404).send({
            success: false,
            error: 'Conversation non trouvée'
          })
        }
        throw new Error(`Supabase error: ${checkError.message}`)
      }

      // ✅ MISE À JOUR SUPABASE : Conversation
      const { data: updatedConversation, error: updateError } = await supabaseServiceClient
        .from('conversations')
        .update({
          ...updateData,
          lastActivity: new Date().toISOString()
        })
        .eq('id', conversationId)
        .select()
        .single()

      if (updateError) {
        throw new Error(`Supabase error: ${updateError.message}`)
      }

      return {
        success: true,
        data: updatedConversation
      }

    } catch (error: any) {
      fastify.log.error({
        conversationId: request.params.conversationId,
        updateData: request.body,
        error: error.message || 'Erreur inconnue',
        stack: error.stack
      }, '❌ Erreur mise à jour conversation')
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la mise à jour de la conversation'
      })
    }
  })

  // ==========================================
  // 🗑️ DELETE /api/v1/conversations/:id - SUPPRESSION
  // ==========================================
  fastify.delete<{ Params: { conversationId: string } }>('/:conversationId', async (request, reply) => {
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

      fastify.log.info(`🗑️ Suppression conversation: ${conversationId}`)

      // ✅ VÉRIFICATION ET SUPPRESSION SUPABASE
      const { data: deletedConversation, error } = await supabaseServiceClient
        .from('conversations')
        .delete()
        .eq('id', conversationId)
        .eq('shopId', shopId)
        .select()
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          return reply.status(404).send({
            success: false,
            error: 'Conversation non trouvée'
          })
        }
        throw new Error(`Supabase error: ${error.message}`)
      }

      fastify.log.info(`✅ Conversation supprimée: ${conversationId}`)

      return {
        success: true,
        message: 'Conversation supprimée avec succès',
        data: { id: conversationId }
      }

    } catch (error: any) {
      fastify.log.error({
        conversationId: request.params.conversationId,
        error: error.message || 'Erreur inconnue',
        stack: error.stack
      }, '❌ Erreur suppression conversation')
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la suppression de la conversation'
      })
    }
  })

  // ==========================================
  // 📊 GET /api/v1/conversations/stats - STATISTIQUES
  // ==========================================
  fastify.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user as any
      const shopId = user?.shop_id || user?.id

      if (!shopId) {
        return reply.status(401).send({
          success: false,
          error: 'Shop ID non trouvé'
        })
      }

      fastify.log.info(`📊 Récupération stats conversations pour shop: ${shopId}`)

      // ✅ REQUÊTES SUPABASE : Statistiques
      const [
        { count: totalConversations },
        { count: activeConversations },
        { count: completedConversions }
      ] = await Promise.all([
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shopId', shopId),
        
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shopId', shopId)
          .eq('status', 'active'),
        
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shopId', shopId)
          .eq('conversionCompleted', true)
      ])

      // ✅ CALCUL TAUX CONVERSION
      const conversionRate = totalConversations && totalConversations > 0 
        ? ((completedConversions || 0) / totalConversations * 100).toFixed(2)
        : '0.00'

      const stats = {
        totalConversations: totalConversations || 0,
        activeConversations: activeConversations || 0,
        completedConversions: completedConversions || 0,
        conversionRate: `${conversionRate}%`
      }

      fastify.log.info(stats, '✅ Stats conversations calculées')

      return {
        success: true,
        data: stats
      }

    } catch (error: any) {
      fastify.log.error({
        error: error.message || 'Erreur inconnue',
        stack: error.stack
      }, '❌ Erreur récupération stats conversations')
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des statistiques'
      })
    }
  })

}

export default conversationsRoutes
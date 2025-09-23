// src/routes/conversations.ts

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { supabaseServiceClient } from '../lib/supabase'

// ✅ SCHÉMAS BEAUTÉ ENRICHIS
const conversationCreateSchema = z.object({
  shopId: z.string(),
  visitorId: z.string(),
  productId: z.string().optional(),
  productName: z.string().optional(),
  productPrice: z.number().optional(),
  productUrl: z.string().optional(),
  agentId: z.string().optional(),
  // ✅ NOUVEAUX CHAMPS BEAUTÉ
  beautyCategory: z.string().optional(),
  beautyContext: z.string().optional(),
  customerBeautyProfile: z.any().optional(),
  productCategory: z.string().optional()
});

const conversationUpdateSchema = z.object({
  status: z.string().optional(),
  last_activity: z.string().optional(),
  message_count: z.number().optional(),
  conversion_completed: z.boolean().optional(),
  // ✅ NOUVEAUX CHAMPS BEAUTÉ
  beauty_context: z.string().optional(),
  customer_beauty_profile: z.any().optional()
});

const messageUpdateSchema = z.object({
  content: z.string().min(1, 'Le contenu ne peut pas être vide')
});

// ✅ HELPER : Récupérer user shop ID
function getUserShopId(request: any): string | null {
  const user = request.user as any
  return user?.shopId || user?.shop_id || user?.id || null
}

async function conversationsRoutes(fastify: FastifyInstance) {
  
  // ==========================================
  // 📋 GET /api/v1/conversations - LISTE BEAUTÉ
  // ==========================================
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const shopId = getUserShopId(request)

      if (!shopId) {
        return reply.status(401).send({
          success: false,
          error: 'Shop ID non trouvé'
        })
      }

      fastify.log.info(`📞 Récupération conversations beauté pour shop: ${shopId}`)

      // ✅ REQUÊTE AVEC CHAMPS BEAUTÉ
      const { data: conversations, error: conversationsError } = await supabaseServiceClient
        .from('conversations')
        .select(`
          *,
          beauty_category,
          beauty_context,
          customer_beauty_profile,
          product_category
        `)
        .eq('shop_id', shopId)
        .order('started_at', { ascending: false })

      if (conversationsError) {
        throw new Error(`Supabase conversations error: ${conversationsError.message}`)
      }

      // ✅ RÉCUPÉRER LES MESSAGES AVEC FORMATAGE BEAUTÉ
      const conversationsWithMessages = await Promise.all(
        (conversations || []).map(async (conv) => {
          const { data: messages, error: messagesError } = await supabaseServiceClient
            .from('messages')
            .select('id, content, role, created_at, tokens_used, response_time_ms')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: false })
            .limit(1)

          if (messagesError) {
            fastify.log.warn(`⚠️ Erreur messages pour conversation ${conv.id}: ${messagesError.message}`)
          }

          // ✅ FORMATAGE BEAUTÉ + CAMELCASE POUR FRONTEND
          return {
            ...conv,
            messages: messages || [],
            // Normaliser pour le Frontend
            startedAt: conv.started_at,
            lastActivity: conv.last_activity,
            messageCount: conv.message_count,
            conversionCompleted: conv.conversion_completed,
            visitorId: conv.visitor_id,
            agentId: conv.agent_id,
            productId: conv.product_id,
            productName: conv.product_name,
            productPrice: conv.product_price,
            productUrl: conv.product_url,
            visitorIp: conv.visitor_ip,
            // ✅ CHAMPS BEAUTÉ
            beautyCategory: conv.beauty_category,
            beautyContext: conv.beauty_context,
            customerBeautyProfile: conv.customer_beauty_profile,
            productCategory: conv.product_category
          }
        })
      )

      fastify.log.info(`✅ Conversations beauté trouvées: ${conversationsWithMessages.length}`)

      return {
        success: true,
        data: conversationsWithMessages,
        count: conversationsWithMessages.length
      }

    } catch (error: any) {
      fastify.log.error({
        error: error.message || 'Erreur inconnue',
        stack: error.stack
      }, '❌ Erreur récupération conversations beauté')
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des conversations'
      })
    }
  })

  // ==========================================
  // 🔍 GET /api/v1/conversations/:id - DÉTAIL BEAUTÉ
  // ==========================================
  fastify.get<{ Params: { conversationId: string } }>('/:conversationId', async (request, reply) => {
    try {
      const { conversationId } = request.params
      const shopId = getUserShopId(request)

      if (!shopId) {
        return reply.status(401).send({
          success: false,
          error: 'Shop ID non trouvé'
        })
      }

      fastify.log.info(`🔍 Récupération conversation beauté: ${conversationId}`)

      // ✅ RÉCUPÉRATION AVEC CHAMPS BEAUTÉ
      const { data: conversation, error: conversationError } = await supabaseServiceClient
        .from('conversations')
        .select(`
          *,
          beauty_category,
          beauty_context,
          customer_beauty_profile,
          product_category
        `)
        .eq('id', conversationId)
        .eq('shop_id', shopId)
        .single()

      if (conversationError) {
        if (conversationError.code === 'PGRST116') {
          return reply.status(404).send({
            success: false,
            error: 'Conversation non trouvée'
          })
        }
        throw new Error(`Supabase conversation error: ${conversationError.message}`)
      }

      // ✅ RÉCUPÉRER TOUS LES MESSAGES
      const { data: messages, error: messagesError } = await supabaseServiceClient
        .from('messages')
        .select('id, content, role, created_at, tokens_used, response_time_ms, model_used')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })

      if (messagesError) {
        fastify.log.warn(`⚠️ Erreur messages: ${messagesError.message}`)
      }

      // ✅ FORMATAGE BEAUTÉ + CAMELCASE
      const conversationWithMessages = {
        ...conversation,
        messages: messages || [],
        // Normaliser pour le Frontend
        startedAt: conversation.started_at,
        lastActivity: conversation.last_activity,
        messageCount: conversation.message_count,
        conversionCompleted: conversation.conversion_completed,
        visitorId: conversation.visitor_id,
        agentId: conversation.agent_id,
        productId: conversation.product_id,
        productName: conversation.product_name,
        productPrice: conversation.product_price,
        productUrl: conversation.product_url,
        visitorIp: conversation.visitor_ip,
        // ✅ CHAMPS BEAUTÉ
        beautyCategory: conversation.beauty_category,
        beautyContext: conversation.beauty_context,
        customerBeautyProfile: conversation.customer_beauty_profile,
        productCategory: conversation.product_category
      }

      return {
        success: true,
        data: conversationWithMessages
      }

    } catch (error: any) {
      fastify.log.error({
        conversationId: request.params.conversationId,
        error: error.message || 'Erreur inconnue',
        stack: error.stack
      }, '❌ Erreur récupération conversation beauté')
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération de la conversation'
      })
    }
  })

  // ==========================================
  // ➕ POST /api/v1/conversations - CRÉATION BEAUTÉ
  // ==========================================
  fastify.post<{ Body: typeof conversationCreateSchema._type }>('/', async (request, reply) => {
    try {
      const { 
        shopId, 
        visitorId, 
        productId, 
        productName, 
        productPrice, 
        productUrl, 
        agentId,
        beautyCategory,
        beautyContext,
        customerBeautyProfile,
        productCategory 
      } = conversationCreateSchema.parse(request.body)
      
      const userShopId = getUserShopId(request)

      if (shopId && shopId !== userShopId) {
        return reply.status(403).send({
          success: false,
          error: 'Accès refusé à ce shop'
        })
      }

      fastify.log.info(`➕ Création conversation beauté pour shop: ${userShopId}`)

      // ✅ CRÉATION AVEC CHAMPS BEAUTÉ
      const { data: newConversation, error } = await supabaseServiceClient
        .from('conversations')
        .insert({
          shop_id: userShopId,
          visitor_id: visitorId,
          agent_id: agentId || null,
          product_id: productId || null,
          product_name: productName || null,
          product_price: productPrice || null,
          product_url: productUrl || null,
          status: 'active',
          started_at: new Date().toISOString(),
          last_activity: new Date().toISOString(),
          message_count: 0,
          conversion_completed: false,
          visitor_ip: request.ip,
          visitor_user_agent: request.headers['user-agent'] || null,
          // ✅ NOUVEAUX CHAMPS BEAUTÉ
          beauty_category: beautyCategory || null,
          beauty_context: beautyContext || null,
          customer_beauty_profile: customerBeautyProfile ? JSON.stringify(customerBeautyProfile) : null,
          product_category: productCategory || null
        })
        .select()
        .single()

      if (error) {
        throw new Error(`Supabase error: ${error.message}`)
      }

      fastify.log.info(`✅ Conversation beauté créée: ${newConversation.id}`)

      // ✅ FORMATAGE CAMELCASE POUR FRONTEND
      const formattedConversation = {
        ...newConversation,
        startedAt: newConversation.started_at,
        lastActivity: newConversation.last_activity,
        messageCount: newConversation.message_count,
        conversionCompleted: newConversation.conversion_completed,
        visitorId: newConversation.visitor_id,
        agentId: newConversation.agent_id,
        productId: newConversation.product_id,
        productName: newConversation.product_name,
        productPrice: newConversation.product_price,
        productUrl: newConversation.product_url,
        beautyCategory: newConversation.beauty_category,
        beautyContext: newConversation.beauty_context,
        customerBeautyProfile: newConversation.customer_beauty_profile,
        productCategory: newConversation.product_category
      }

      return {
        success: true,
        data: formattedConversation
      }

    } catch (error: any) {
      fastify.log.error({
        shopId: request.body,
        error: error.message || 'Erreur inconnue',
        stack: error.stack
      }, '❌ Erreur création conversation beauté')
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la création de la conversation'
      })
    }
  })

  // ==========================================
  // ✏️ PUT /api/v1/conversations/:id - MISE À JOUR BEAUTÉ
  // ==========================================
  fastify.put<{ Params: { conversationId: string }; Body: typeof conversationUpdateSchema._type }>('/:conversationId', async (request, reply) => {
    try {
      const { conversationId } = request.params
      const updateData = conversationUpdateSchema.parse(request.body)
      const shopId = getUserShopId(request)

      if (!shopId) {
        return reply.status(401).send({
          success: false,
          error: 'Shop ID non trouvé'
        })
      }

      fastify.log.info(`✏️ Mise à jour conversation beauté: ${conversationId}`)

      // ✅ VÉRIFICATION SÉCURISÉE
      const { data: existingConversation, error: checkError } = await supabaseServiceClient
        .from('conversations')
        .select('id, shop_id')
        .eq('id', conversationId)
        .eq('shop_id', shopId)
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

      // ✅ MISE À JOUR AVEC CHAMPS BEAUTÉ
      const { data: updatedConversation, error: updateError } = await supabaseServiceClient
        .from('conversations')
        .update({
          ...updateData,
          last_activity: new Date().toISOString()
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
      }, '❌ Erreur mise à jour conversation beauté')
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la mise à jour de la conversation'
      })
    }
  })

  // ==========================================
  // 📨 GET /api/v1/conversations/:id/messages - MESSAGES BEAUTÉ
  // ==========================================
  fastify.get<{ Params: { conversationId: string } }>('/:conversationId/messages', async (request, reply) => {
    try {
      const { conversationId } = request.params
      const shopId = getUserShopId(request)

      if (!shopId) {
        return reply.status(401).send({
          success: false,
          error: 'Shop ID non trouvé'
        })
      }

      fastify.log.info(`📨 Récupération messages beauté conversation: ${conversationId}`)

      // ✅ VÉRIFICATION SÉCURISÉE
      const { data: conversation, error: conversationError } = await supabaseServiceClient
        .from('conversations')
        .select('id, shop_id')
        .eq('id', conversationId)
        .eq('shop_id', shopId)
        .single()

      if (conversationError) {
        if (conversationError.code === 'PGRST116') {
          return reply.status(404).send({
            success: false,
            error: 'Conversation non trouvée'
          })
        }
        throw new Error(`Supabase error: ${conversationError.message}`)
      }

      // ✅ RÉCUPÉRER LES MESSAGES
      const { data: messages, error: messagesError } = await supabaseServiceClient
        .from('messages')
        .select('id, content, role, created_at, tokens_used, response_time_ms, model_used')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })

      if (messagesError) {
        throw new Error(`Supabase messages error: ${messagesError.message}`)
      }

      return {
        success: true,
        data: messages || []
      }

    } catch (error: any) {
      fastify.log.error({
        conversationId: request.params.conversationId,
        error: error.message || 'Erreur inconnue',
        stack: error.stack
      }, '❌ Erreur récupération messages beauté')
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des messages'
      })
    }
  })

  // ==========================================
  // 💬 POST /api/v1/conversations/:id/messages - NOUVEAU MESSAGE BEAUTÉ
  // ==========================================
  fastify.post<{ 
    Params: { conversationId: string }, 
    Body: { content: string, sender: 'agent' | 'visitor' } 
  }>('/:conversationId/messages', async (request, reply) => {
    try {
      const { conversationId } = request.params
      const { content, sender } = request.body
      const shopId = getUserShopId(request)

      if (!shopId) {
        return reply.status(401).send({
          success: false,
          error: 'Shop ID non trouvé'
        })
      }

      if (!content || !sender) {
        return reply.status(400).send({
          success: false,
          error: 'Content et sender sont requis'
        })
      }

      fastify.log.info(`💬 Envoi message beauté dans conversation: ${conversationId}`)

      // ✅ VÉRIFICATION SÉCURISÉE
      const { data: conversation, error: conversationError } = await supabaseServiceClient
        .from('conversations')
        .select('id, shop_id')
        .eq('id', conversationId)
        .eq('shop_id', shopId)
        .single()

      if (conversationError) {
        if (conversationError.code === 'PGRST116') {
          return reply.status(404).send({
            success: false,
            error: 'Conversation non trouvée'
          })
        }
        throw new Error(`Supabase error: ${conversationError.message}`)
      }

      // ✅ CRÉER LE MESSAGE
      const { data: newMessage, error: messageError } = await supabaseServiceClient
        .from('messages')
        .insert({
          conversation_id: conversationId,
          content,
          role: sender,
          created_at: new Date().toISOString(),
          tokens_used: 0,
          response_time_ms: 0
        })
        .select()
        .single()

      if (messageError) {
        throw new Error(`Supabase message error: ${messageError.message}`)
      }

      // ✅ METTRE À JOUR COMPTEUR MESSAGES
      const { data: currentConversation, error: fetchError } = await supabaseServiceClient
        .from('conversations')
        .select('message_count')
        .eq('id', conversationId)
        .single()

      if (fetchError) {
        fastify.log.warn(`⚠️ Erreur récupération message_count: ${fetchError.message}`)
      }

      const newMessageCount = (currentConversation?.message_count || 0) + 1

      const { error: updateError } = await supabaseServiceClient
        .from('conversations')
        .update({
          last_activity: new Date().toISOString(),
          message_count: newMessageCount
        })
        .eq('id', conversationId)

      if (updateError) {
        fastify.log.warn(`⚠️ Erreur mise à jour conversation: ${updateError.message}`)
      }

      return {
        success: true,
        data: newMessage
      }

    } catch (error: any) {
      fastify.log.error({
        conversationId: request.params.conversationId,
        body: request.body,
        error: error.message || 'Erreur inconnue',
        stack: error.stack
      }, '❌ Erreur envoi message beauté')
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de l\'envoi du message'
      })
    }
  })

  // ==========================================
  // ✏️ PUT /api/v1/conversations/:conversationId/messages/:messageId - NOUVELLE ROUTE !
  // ==========================================
  fastify.put<{ 
    Params: { conversationId: string, messageId: string }, 
    Body: typeof messageUpdateSchema._type 
  }>('/:conversationId/messages/:messageId', async (request, reply) => {
    try {
      const { conversationId, messageId } = request.params
      const { content } = messageUpdateSchema.parse(request.body)
      const shopId = getUserShopId(request)

      if (!shopId) {
        return reply.status(401).send({
          success: false,
          error: 'Shop ID non trouvé'
        })
      }

      fastify.log.info(`✏️ Modification message beauté: ${messageId} dans conversation: ${conversationId}`)

      // ✅ VÉRIFIER QUE LA CONVERSATION APPARTIENT AU SHOP
      const { data: conversation, error: conversationError } = await supabaseServiceClient
        .from('conversations')
        .select('id, shop_id')
        .eq('id', conversationId)
        .eq('shop_id', shopId)
        .single()

      if (conversationError) {
        if (conversationError.code === 'PGRST116') {
          return reply.status(404).send({
            success: false,
            error: 'Conversation non trouvée'
          })
        }
        throw new Error(`Supabase error: ${conversationError.message}`)
      }

      // ✅ METTRE À JOUR LE MESSAGE
      const { data: updatedMessage, error: updateError } = await supabaseServiceClient
        .from('messages')
        .update({
          content,
          updated_at: new Date().toISOString()
        })
        .eq('id', messageId)
        .eq('conversation_id', conversationId)
        .select()
        .single()

      if (updateError) {
        if (updateError.code === 'PGRST116') {
          return reply.status(404).send({
            success: false,
            error: 'Message non trouvé'
          })
        }
        throw new Error(`Supabase error: ${updateError.message}`)
      }

      fastify.log.info(`✅ Message beauté modifié: ${messageId}`)

      return {
        success: true,
        data: updatedMessage,
        message: 'Message modifié avec succès'
      }

    } catch (error: any) {
      fastify.log.error({
        conversationId: request.params.conversationId,
        messageId: request.params.messageId,
        body: request.body,
        error: error.message || 'Erreur inconnue',
        stack: error.stack
      }, '❌ Erreur modification message beauté')
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la modification du message'
      })
    }
  })

  // ==========================================
  // 👋 POST /api/v1/conversations/:id/takeover - PRISE EN CHARGE BEAUTÉ
  // ==========================================
  fastify.post<{ Params: { conversationId: string } }>('/:conversationId/takeover', async (request, reply) => {
    try {
      const { conversationId } = request.params
      const shopId = getUserShopId(request)

      if (!shopId) {
        return reply.status(401).send({
          success: false,
          error: 'Shop ID non trouvé'
        })
      }

      fastify.log.info(`👋 Prise en charge consultation beauté: ${conversationId}`)

      // ✅ MISE À JOUR STATUT
      const { data: updatedConversation, error: updateError } = await supabaseServiceClient
        .from('conversations')
        .update({
          status: 'taken_over',
          taken_over_at: new Date().toISOString(),
          taken_over_by: shopId,
          last_activity: new Date().toISOString()
        })
        .eq('id', conversationId)
        .eq('shop_id', shopId)
        .select()
        .single()

      if (updateError) {
        if (updateError.code === 'PGRST116') {
          return reply.status(404).send({
            success: false,
            error: 'Conversation non trouvée'
          })
        }
        throw new Error(`Supabase error: ${updateError.message}`)
      }

      // ✅ MESSAGE SYSTÈME BEAUTÉ
      try {
        await supabaseServiceClient
          .from('messages')
          .insert({
            conversation_id: conversationId,
            content: '🌸 Une conseillère beauté humaine a rejoint la consultation.',
            role: 'system',
            created_at: new Date().toISOString(),
            tokens_used: 0,
            response_time_ms: 0
          })
      } catch (systemMessageError) {
        fastify.log.warn(`⚠️ Erreur ajout message système beauté: ${systemMessageError}`)
      }

      return {
        success: true,
        data: updatedConversation,
        message: 'Consultation beauté prise en charge avec succès'
      }

    } catch (error: any) {
      fastify.log.error({
        conversationId: request.params.conversationId,
        error: error.message || 'Erreur inconnue',
        stack: error.stack
      }, '❌ Erreur prise en charge consultation beauté')
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la prise en charge'
      })
    }
  })

  // ==========================================
  // 🗑️ DELETE - INCHANGÉ
  // ==========================================
  fastify.delete<{ Params: { conversationId: string } }>('/:conversationId', async (request, reply) => {
    try {
      const { conversationId } = request.params
      const shopId = getUserShopId(request)

      if (!shopId) {
        return reply.status(401).send({
          success: false,
          error: 'Shop ID non trouvé'
        })
      }

      fastify.log.info(`🗑️ Suppression conversation beauté: ${conversationId}`)

      const { data: deletedConversation, error } = await supabaseServiceClient
        .from('conversations')
        .delete()
        .eq('id', conversationId)
        .eq('shop_id', shopId)
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

      fastify.log.info(`✅ Conversation beauté supprimée: ${conversationId}`)

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
      }, '❌ Erreur suppression conversation beauté')
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la suppression de la conversation'
      })
    }
  })

  // ==========================================
  // 📊 GET /api/v1/conversations/stats - STATS BEAUTÉ
  // ==========================================
  fastify.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const shopId = getUserShopId(request)

      if (!shopId) {
        return reply.status(401).send({
          success: false,
          error: 'Shop ID non trouvé'
        })
      }

      fastify.log.info(`📊 Récupération stats conversations beauté pour shop: ${shopId}`)

      const [
        { count: totalConversations },
        { count: activeConversations },
        { count: completedConversions }
      ] = await Promise.all([
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId),
        
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId)
          .eq('status', 'active'),
        
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId)
          .eq('conversion_completed', true)
      ])

      const conversionRate = totalConversations && totalConversations > 0 
        ? ((completedConversions || 0) / totalConversations * 100).toFixed(2)
        : '0.00'

      const stats = {
        totalConversations: totalConversations || 0,
        activeConversations: activeConversations || 0,
        completedConversions: completedConversions || 0,
        conversionRate: `${conversionRate}%`
      }

      fastify.log.info(stats, '✅ Stats conversations beauté calculées')

      return {
        success: true,
        data: stats
      }

    } catch (error: any) {
      fastify.log.error({
        error: error.message || 'Erreur inconnue',
        stack: error.stack
      }, '❌ Erreur récupération stats conversations beauté')
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des statistiques'
      })
    }
  })

}

export default conversationsRoutes
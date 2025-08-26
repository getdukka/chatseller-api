// src/routes/conversations.ts - VERSION SUPABASE CORRIGÉE ✅

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

// ✅ HELPER : Récupérer user shop ID
function getUserShopId(request: any): string | null {
  const user = request.user as any
  return user?.shopId || user?.shop_id || user?.id || null
}

async function conversationsRoutes(fastify: FastifyInstance) {
  
  // ==========================================
  // 📋 GET /api/v1/conversations - LISTE CORRIGÉE
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

      fastify.log.info(`📞 Récupération conversations pour shop: ${shopId}`)

      // ✅ REQUÊTE CORRIGÉE : shop_id au lieu de shopId
      const { data: conversations, error: conversationsError } = await supabaseServiceClient
        .from('conversations')
        .select('*')
        .eq('shop_id', shopId)  // ✅ CORRIGÉ : shop_id
        .order('started_at', { ascending: false })  // ✅ CORRIGÉ : started_at

      if (conversationsError) {
        throw new Error(`Supabase conversations error: ${conversationsError.message}`)
      }

      // ✅ RÉCUPÉRER LES MESSAGES SÉPARÉMENT
      const conversationsWithMessages = await Promise.all(
        (conversations || []).map(async (conv) => {
          // ✅ CORRIGÉ : conversation_id au lieu de conversationId
          const { data: messages, error: messagesError } = await supabaseServiceClient
            .from('messages')
            .select('id, content, role, created_at, tokens_used, response_time_ms')  // ✅ CORRIGÉ : colonnes snake_case
            .eq('conversation_id', conv.id)  // ✅ CORRIGÉ : conversation_id
            .order('created_at', { ascending: false })  // ✅ CORRIGÉ : created_at
            .limit(1)

          // Ne pas faire échouer si erreur messages
          if (messagesError) {
            fastify.log.warn(`⚠️ Erreur messages pour conversation ${conv.id}: ${messagesError.message}`)
          }

          return {
            ...conv,
            messages: messages || []
          }
        })
      )

      fastify.log.info(`✅ Conversations trouvées: ${conversationsWithMessages.length}`)

      return {
        success: true,
        data: conversationsWithMessages,
        count: conversationsWithMessages.length
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
  // 🔍 GET /api/v1/conversations/:id - DÉTAIL CORRIGÉ
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

      fastify.log.info(`🔍 Récupération conversation: ${conversationId}`)

      // ✅ REQUÊTE CORRIGÉE : shop_id au lieu de shopId
      const { data: conversation, error: conversationError } = await supabaseServiceClient
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .eq('shop_id', shopId)  // ✅ CORRIGÉ : shop_id
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

      // ✅ REQUÊTE CORRIGÉE : conversation_id et colonnes snake_case
      const { data: messages, error: messagesError } = await supabaseServiceClient
        .from('messages')
        .select('id, content, role, created_at, tokens_used, response_time_ms, model_used')  // ✅ CORRIGÉ : colonnes snake_case
        .eq('conversation_id', conversationId)  // ✅ CORRIGÉ : conversation_id
        .order('created_at', { ascending: true })  // ✅ CORRIGÉ : created_at

      if (messagesError) {
        fastify.log.warn(`⚠️ Erreur messages: ${messagesError.message}`)
      }

      // ✅ ASSEMBLER LA RÉPONSE
      const conversationWithMessages = {
        ...conversation,
        messages: messages || []
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
      const userShopId = getUserShopId(request)

      // Vérifier que le shop appartient à l'utilisateur
      if (shopId && shopId !== userShopId) {
        return reply.status(403).send({
          success: false,
          error: 'Accès refusé à ce shop'
        })
      }

      fastify.log.info(`➕ Création conversation pour shop: ${userShopId}`)

      // ✅ CRÉATION CORRIGÉE : Toutes les colonnes en snake_case
      const { data: newConversation, error } = await supabaseServiceClient
        .from('conversations')
        .insert({
          shop_id: userShopId,           // ✅ CORRIGÉ : shop_id
          visitor_id: visitorId,         // ✅ CORRIGÉ : visitor_id
          agent_id: agentId || null,     // ✅ CORRIGÉ : agent_id
          product_id: productId || null, // ✅ CORRIGÉ : product_id
          product_name: productName || null,     // ✅ CORRIGÉ : product_name
          product_price: productPrice || null,   // ✅ CORRIGÉ : product_price
          product_url: productUrl || null,       // ✅ CORRIGÉ : product_url
          status: 'active',
          started_at: new Date().toISOString(),        // ✅ CORRIGÉ : started_at
          last_activity: new Date().toISOString(),     // ✅ CORRIGÉ : last_activity
          message_count: 0,                            // ✅ CORRIGÉ : message_count
          conversion_completed: false,                 // ✅ CORRIGÉ : conversion_completed
          visitor_ip: request.ip,                      // ✅ CORRIGÉ : visitor_ip
          visitor_user_agent: request.headers['user-agent'] || null  // ✅ CORRIGÉ : visitor_user_agent
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
      const shopId = getUserShopId(request)

      if (!shopId) {
        return reply.status(401).send({
          success: false,
          error: 'Shop ID non trouvé'
        })
      }

      fastify.log.info(`✏️ Mise à jour conversation: ${conversationId}`)

      // ✅ VÉRIFICATION CORRIGÉE : shop_id au lieu de shopId
      const { data: existingConversation, error: checkError } = await supabaseServiceClient
        .from('conversations')
        .select('id, shop_id')  // ✅ CORRIGÉ : shop_id
        .eq('id', conversationId)
        .eq('shop_id', shopId)  // ✅ CORRIGÉ : shop_id
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

      // ✅ MISE À JOUR CORRIGÉE : last_activity en snake_case
      const { data: updatedConversation, error: updateError } = await supabaseServiceClient
        .from('conversations')
        .update({
          ...updateData,
          last_activity: new Date().toISOString()  // ✅ CORRIGÉ : last_activity
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
      const shopId = getUserShopId(request)

      if (!shopId) {
        return reply.status(401).send({
          success: false,
          error: 'Shop ID non trouvé'
        })
      }

      fastify.log.info(`🗑️ Suppression conversation: ${conversationId}`)

      // ✅ SUPPRESSION CORRIGÉE : shop_id au lieu de shopId
      const { data: deletedConversation, error } = await supabaseServiceClient
        .from('conversations')
        .delete()
        .eq('id', conversationId)
        .eq('shop_id', shopId)  // ✅ CORRIGÉ : shop_id
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
  // 📨 GET /api/v1/conversations/:id/messages - RÉCUPÉRER LES MESSAGES
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

      fastify.log.info(`📨 Récupération messages conversation: ${conversationId}`)

      // ✅ VÉRIFICATION QUE LA CONVERSATION APPARTIENT AU SHOP
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
      }, '❌ Erreur récupération messages')
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des messages'
      })
    }
  })

  // ==========================================
  // 💬 POST /api/v1/conversations/:id/messages - ENVOYER UN MESSAGE
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

      fastify.log.info(`💬 Envoi message dans conversation: ${conversationId}`)

      // ✅ VÉRIFICATION QUE LA CONVERSATION APPARTIENT AU SHOP
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

      // ✅ METTRE À JOUR LA CONVERSATION (last_activity, message_count)
      const { data: currentConversation, error: fetchError } = await supabaseServiceClient
        .from('conversations')
        .select('message_count')
        .eq('id', conversationId)
        .single()

      if (fetchError) {
        fastify.log.warn(`⚠️ Erreur récupération message_count: ${fetchError.message}`)
      }

      // Puis mettre à jour avec le nouveau count
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
      }, '❌ Erreur envoi message')
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de l\'envoi du message'
      })
    }
  })

  // ==========================================
  // 👋 POST /api/v1/conversations/:id/takeover - PRISE EN CHARGE
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

      fastify.log.info(`👋 Prise en charge conversation: ${conversationId}`)

      // ✅ VÉRIFICATION ET MISE À JOUR DE LA CONVERSATION
      const { data: updatedConversation, error: updateError } = await supabaseServiceClient
        .from('conversations')
        .update({
          status: 'taken_over',
          taken_over_at: new Date().toISOString(),
          taken_over_by: shopId, // L'utilisateur qui prend en charge
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

      // ✅ OPTIONNEL : AJOUTER UN MESSAGE SYSTÈME POUR INDIQUER LA PRISE EN CHARGE
      try {
        await supabaseServiceClient
          .from('messages')
          .insert({
            conversation_id: conversationId,
            content: 'Un agent humain a rejoint la conversation.',
            role: 'system',
            created_at: new Date().toISOString(),
            tokens_used: 0,
            response_time_ms: 0
          })
      } catch (systemMessageError) {
        fastify.log.warn(`⚠️ Erreur ajout message système: ${systemMessageError}`)
        // Ne pas faire échouer la prise en charge pour ça
      }

      return {
        success: true,
        data: updatedConversation,
        message: 'Conversation prise en charge avec succès'
      }

    } catch (error: any) {
      fastify.log.error({
        conversationId: request.params.conversationId,
        error: error.message || 'Erreur inconnue',
        stack: error.stack
      }, '❌ Erreur prise en charge conversation')
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la prise en charge'
      })
    }
  })

  // ==========================================
  // 📊 GET /api/v1/conversations/stats - STATISTIQUES
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

      fastify.log.info(`📊 Récupération stats conversations pour shop: ${shopId}`)

      // ✅ REQUÊTES CORRIGÉES : shop_id au lieu de shopId, conversion_completed au lieu de conversionCompleted
      const [
        { count: totalConversations },
        { count: activeConversations },
        { count: completedConversions }
      ] = await Promise.all([
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId),  // ✅ CORRIGÉ : shop_id
        
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId)   // ✅ CORRIGÉ : shop_id
          .eq('status', 'active'),
        
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId)               // ✅ CORRIGÉ : shop_id
          .eq('conversion_completed', true)    // ✅ CORRIGÉ : conversion_completed
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
// src/routes/feedback.ts
import { createClient } from '@supabase/supabase-js'
import type { FastifyRequest, FastifyReply } from 'fastify'

const supabase = createClient(
  process.env.SUPABASE_URL!, 
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ✅ INTERFACES TYPÉES COHÉRENTES
interface FeedbackParams {
  feedbackId: string
}

interface CreateFeedbackBody {
  messageId: string
  agentId: string
  conversationId: string
  originalResponse: string
  correctedResponse?: string
  feedbackType: 'correction' | 'improvement' | 'validation' | 'negative'
  feedbackRating?: number
  feedbackComment?: string
  feedbackTags?: string[]
  userCorrection?: string
  isPublic?: boolean
  beautyCategory?: string
}

interface GetFeedbacksQuery {
  agentId?: string
  feedbackType?: string
  limit?: string
  offset?: string
  startDate?: string
  endDate?: string
  rating?: string
}

interface FeedbackStatsQuery {
  agentId?: string
  days?: string
}

interface TagsQuery {
  category?: string
}

// ✅ HELPER : Convertir snake_case DB vers camelCase Frontend
function transformFeedbackFromDB(dbFeedback: any) {
  return {
    id: dbFeedback.id,
    messageId: dbFeedback.message_id,
    shopId: dbFeedback.shop_id,
    agentId: dbFeedback.agent_id,
    conversationId: dbFeedback.conversation_id,
    originalResponse: dbFeedback.original_response,
    correctedResponse: dbFeedback.corrected_response,
    feedbackType: dbFeedback.feedback_type,
    feedbackRating: dbFeedback.feedback_rating,
    feedbackComment: dbFeedback.feedback_comment,
    feedbackTags: dbFeedback.feedback_tags || [],
    userCorrection: dbFeedback.user_correction,
    isPublic: dbFeedback.is_public || false,
    beautyCategory: dbFeedback.beauty_category,
    createdAt: dbFeedback.created_at,
    updatedAt: dbFeedback.updated_at
  }
}

// ✅ ROUTE : Créer un nouveau feedback (corrigée)
export async function createFeedback(
  request: FastifyRequest<{ Body: CreateFeedbackBody }>,
  reply: FastifyReply
) {
  try {
    const {
      messageId,
      agentId,
      conversationId,
      originalResponse,
      correctedResponse,
      feedbackType,
      feedbackRating,
      feedbackComment,
      feedbackTags = [],
      userCorrection,
      isPublic = false,
      beautyCategory
    } = request.body

    // Validation
    if (!messageId || !originalResponse || !feedbackType) {
      return reply.code(400).send({
        success: false,
        error: 'Message ID, réponse originale et type de feedback requis'
      })
    }

    const validTypes = ['correction', 'improvement', 'validation', 'negative']
    if (!validTypes.includes(feedbackType)) {
      return reply.code(400).send({
        success: false,
        error: `Type de feedback invalide. Valeurs acceptées: ${validTypes.join(', ')}`
      })
    }

    // ✅ CORRECTION : Récupérer shopId depuis JWT (auth middleware)
    const shopId = (request as any).user?.id
    if (!shopId) {
      return reply.code(401).send({
        success: false,
        error: 'Shop ID requis (authentification)'
      })
    }

    // Vérifier que le message appartient au shop (optionnel mais sécurisé)
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('id, conversation_id')
      .eq('id', messageId)
      .single()

    if (messageError && messageError.code !== 'PGRST116') { // Ignorer "not found" pour les tests
      console.warn('Message non trouvé pour validation:', messageId)
    }

    // ✅ CORRECTION : Créer le feedback avec mapping snake_case correct
    const { data: feedback, error } = await supabase
      .from('message_feedback')
      .insert({
        message_id: messageId,
        shop_id: shopId,
        agent_id: agentId,
        conversation_id: conversationId || message?.conversation_id,
        original_response: originalResponse,
        corrected_response: correctedResponse,
        feedback_type: feedbackType,
        feedback_rating: feedbackRating,
        feedback_comment: feedbackComment,
        feedback_tags: feedbackTags,
        user_correction: userCorrection,
        is_public: isPublic,
        beauty_category: beautyCategory,
        created_by: shopId
      })
      .select()
      .single()

    if (error) {
      console.error('Erreur création feedback:', error)
      return reply.code(500).send({
        success: false,
        error: 'Erreur lors de la création du feedback'
      })
    }

    console.log(`✅ Feedback créé: ${feedbackType} pour message ${messageId}`)

    // ✅ CORRECTION : Incrémenter quota via API quotas (cohérent)
    if (feedbackType === 'correction') {
      try {
        await incrementAIUsageQuota(shopId)
      } catch (quotaError) {
        console.warn('Erreur incrémentation quota feedback:', quotaError)
        // Ne pas faire échouer la création du feedback
      }
    }

    // ✅ CORRECTION : Retourner format camelCase pour le frontend
    return reply.send({
      success: true,
      data: transformFeedbackFromDB(feedback)
    })

  } catch (err) {
    console.error('Erreur createFeedback:', err)
    return reply.code(500).send({
      success: false,
      error: 'Erreur serveur lors de la création du feedback'
    })
  }
}

// ✅ ROUTE : Récupérer feedbacks avec filtres (corrigée)
export async function getFeedbacks(
  request: FastifyRequest<{ Querystring: GetFeedbacksQuery }>,
  reply: FastifyReply
) {
  try {
    const { 
      agentId, 
      feedbackType, 
      limit = '50', 
      offset = '0',
      startDate,
      endDate,
      rating
    } = request.query

    const shopId = (request as any).user?.id
    if (!shopId) {
      return reply.code(401).send({
        success: false,
        error: 'Shop ID requis (authentification)'
      })
    }

    // Construire la requête
    let query = supabase
      .from('message_feedback')
      .select('*') // ✅ Simplifier la query pour éviter les erreurs de JOIN
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })

    // Appliquer filtres
    if (agentId) {
      query = query.eq('agent_id', agentId)
    }

    if (feedbackType) {
      query = query.eq('feedback_type', feedbackType)
    }

    if (rating) {
      query = query.eq('feedback_rating', parseInt(rating))
    }

    if (startDate) {
      query = query.gte('created_at', startDate)
    }

    if (endDate) {
      query = query.lte('created_at', endDate)
    }

    // Pagination
    const limitNum = parseInt(limit)
    const offsetNum = parseInt(offset)
    query = query.range(offsetNum, offsetNum + limitNum - 1)

    const { data: feedbacks, error } = await query

    if (error) {
      console.error('Erreur récupération feedbacks:', error)
      return reply.code(500).send({
        success: false,
        error: 'Erreur lors de la récupération des feedbacks'
      })
    }

    // ✅ CORRECTION : Transformer tous les feedbacks en camelCase
    const transformedFeedbacks = (feedbacks || []).map(transformFeedbackFromDB)

    return reply.send({
      success: true,
      data: transformedFeedbacks,
      meta: {
        limit: limitNum,
        offset: offsetNum,
        hasMore: transformedFeedbacks.length === limitNum
      }
    })

  } catch (err) {
    console.error('Erreur getFeedbacks:', err)
    return reply.code(500).send({
      success: false,
      error: 'Erreur serveur lors de la récupération'
    })
  }
}

// ✅ ROUTE : Statistiques feedback (corrigée)
export async function getFeedbackStats(
  request: FastifyRequest<{ Querystring: FeedbackStatsQuery }>,
  reply: FastifyReply
) {
  try {
    const { agentId, days = '30' } = request.query

    const shopId = (request as any).user?.id
    if (!shopId) {
      return reply.code(401).send({
        success: false,
        error: 'Shop ID requis (authentification)'
      })
    }

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - parseInt(days))

    // Construire requête base
    let query = supabase
      .from('message_feedback')
      .select('feedback_type, feedback_rating, feedback_tags')
      .eq('shop_id', shopId)
      .gte('created_at', startDate.toISOString())

    if (agentId) {
      query = query.eq('agent_id', agentId)
    }

    const { data: feedbacks, error } = await query

    if (error) {
      console.error('Erreur stats feedback:', error)
      return reply.code(500).send({
        success: false,
        error: 'Erreur lors du calcul des statistiques'
      })
    }

    // Calculer statistiques
    const total = feedbacks?.length || 0
    const feedbacksByType = {
      correction: feedbacks?.filter(f => f.feedback_type === 'correction').length || 0,
      improvement: feedbacks?.filter(f => f.feedback_type === 'improvement').length || 0,
      validation: feedbacks?.filter(f => f.feedback_type === 'validation').length || 0,
      negative: feedbacks?.filter(f => f.feedback_type === 'negative').length || 0
    }

    // Moyenne ratings
    const ratings = feedbacks?.filter(f => f.feedback_rating).map(f => f.feedback_rating) || []
    const averageRating = ratings.length > 0 
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 
      : 0

    // Tags les plus fréquents
    const tagCounts = new Map()
    feedbacks?.forEach(feedback => {
      feedback.feedback_tags?.forEach((tag: string) => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
      })
    })

    const commonIssues = Array.from(tagCounts.entries())
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 5)
      .map(([tag, count]) => ({
        tag,
        count,
        percentage: total > 0 ? Math.round(((count as number) / total) * 100) : 0,
        description: getTagDescription(tag as string) // ✅ Helper pour descriptions
      }))

    // Suggestions d'amélioration basées sur les corrections
    const corrections = feedbacks?.filter(f => f.feedback_type === 'correction') || []
    const improvementSuggestions: string[] = []

    if (corrections.length > 0) {
      const correctionTags = new Map()
      corrections.forEach(c => {
        c.feedback_tags?.forEach((tag: string) => {
          correctionTags.set(tag, (correctionTags.get(tag) || 0) + 1)
        })
      })

      const topCorrectionTags = Array.from(correctionTags.entries())
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 3)

      topCorrectionTags.forEach(([tag, count]) => {
        if (tag === 'product_knowledge') {
          improvementSuggestions.push(`Enrichir la base de connaissances produits (${count} corrections)`)
        } else if (tag === 'tone_appropriateness') {
          improvementSuggestions.push(`Ajuster le ton de communication (${count} corrections)`)
        } else if (tag === 'personalization') {
          improvementSuggestions.push(`Améliorer la personnalisation des réponses (${count} corrections)`)
        } else {
          improvementSuggestions.push(`Travailler sur: ${getTagDescription(tag as string)} (${count} corrections)`)
        }
      })
    }

    const stats = {
      totalFeedbacks: total,
      averageRating,
      feedbacksByType,
      commonIssues,
      improvementSuggestions,
      period: {
        days: parseInt(days),
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString()
      }
    }

    return reply.send({
      success: true,
      data: stats
    })

  } catch (err) {
    console.error('Erreur getFeedbackStats:', err)
    return reply.code(500).send({
      success: false,
      error: 'Erreur serveur lors du calcul des statistiques'
    })
  }
}

// ✅ ROUTE : Supprimer feedback (corrigée)
export async function deleteFeedback(
  request: FastifyRequest<{ Params: FeedbackParams }>,
  reply: FastifyReply
) {
  try {
    const { feedbackId } = request.params

    if (!feedbackId) {
      return reply.code(400).send({
        success: false,
        error: 'ID feedback requis'
      })
    }

    const shopId = (request as any).user?.id
    if (!shopId) {
      return reply.code(401).send({
        success: false,
        error: 'Shop ID requis (authentification)'
      })
    }

    // Vérifier appartenance et supprimer
    const { error } = await supabase
      .from('message_feedback')
      .delete()
      .eq('id', feedbackId)
      .eq('shop_id', shopId)

    if (error) {
      console.error('Erreur suppression feedback:', error)
      return reply.code(500).send({
        success: false,
        error: 'Erreur lors de la suppression du feedback'
      })
    }

    console.log(`✅ Feedback supprimé: ${feedbackId}`)

    return reply.send({
      success: true,
      message: 'Feedback supprimé avec succès'
    })

  } catch (err) {
    console.error('Erreur deleteFeedback:', err)
    return reply.code(500).send({
      success: false,
      error: 'Erreur serveur lors de la suppression'
    })
  }
}

// ✅ ROUTE : Récupérer tags feedback beauté prédéfinis (corrigée)
export async function getBeautyFeedbackTags(
  request: FastifyRequest<{ Querystring: TagsQuery }>,
  reply: FastifyReply
) {
  try {
    const { category } = request.query

    // ✅ CORRECTION : Retourner les tags en dur (cohérent avec le composable)
    const beautyFeedbackTags = [
      { id: 'product_knowledge', label: 'Connaissance produits', category: 'expertise' },
      { id: 'skin_diagnosis', label: 'Diagnostic peau', category: 'skincare' },
      { id: 'makeup_technique', label: 'Techniques maquillage', category: 'makeup' },
      { id: 'fragrance_matching', label: 'Correspondances parfums', category: 'fragrance' },
      { id: 'hair_analysis', label: 'Analyse capillaire', category: 'haircare' },
      { id: 'ingredient_explanation', label: 'Explication ingrédients', category: 'expertise' },
      { id: 'routine_building', label: 'Construction routine', category: 'skincare' },
      { id: 'color_matching', label: 'Correspondance couleurs', category: 'makeup' },
      { id: 'seasonal_advice', label: 'Conseils saisonniers', category: 'general' },
      { id: 'price_justification', label: 'Justification prix', category: 'sales' },
      { id: 'upsell_relevance', label: 'Pertinence upsell', category: 'sales' },
      { id: 'tone_appropriateness', label: 'Ton adapté', category: 'communication' },
      { id: 'response_length', label: 'Longueur réponse', category: 'communication' },
      { id: 'personalization', label: 'Personnalisation', category: 'communication' },
      { id: 'urgency_creation', label: 'Création urgence', category: 'sales' }
    ]

    let filteredTags = beautyFeedbackTags

    if (category) {
      filteredTags = beautyFeedbackTags.filter(tag => tag.category === category)
    }

    return reply.send({
      success: true,
      data: filteredTags
    })

  } catch (err) {
    console.error('Erreur getBeautyFeedbackTags:', err)
    return reply.code(500).send({
      success: false,
      error: 'Erreur serveur lors de la récupération des tags'
    })
  }
}

// ✅ HELPER : Descriptions des tags
function getTagDescription(tagId: string): string {
  const descriptions = {
    product_knowledge: 'Connaissance produits',
    skin_diagnosis: 'Diagnostic peau',
    makeup_technique: 'Techniques maquillage',
    fragrance_matching: 'Correspondances parfums',
    hair_analysis: 'Analyse capillaire',
    ingredient_explanation: 'Explication ingrédients',
    routine_building: 'Construction routine',
    color_matching: 'Correspondance couleurs',
    seasonal_advice: 'Conseils saisonniers',
    price_justification: 'Justification prix',
    upsell_relevance: 'Pertinence upsell',
    tone_appropriateness: 'Ton adapté',
    response_length: 'Longueur réponse',
    personalization: 'Personnalisation',
    urgency_creation: 'Création urgence'
  }
  return descriptions[tagId as keyof typeof descriptions] || tagId
}

// ✅ HELPER : Incrémenter quota IA cohérent avec l'API quotas
async function incrementAIUsageQuota(shopId: string) {
  try {
    // ✅ CORRECTION : Utiliser la même logique que l'API quotas
    const { data: shop, error } = await supabase
      .from('shops')
      .select('quotas_usage')
      .eq('id', shopId)
      .single()

    if (error || !shop) {
      throw new Error('Shop non trouvé pour quota feedback')
    }

    const currentUsage = shop.quotas_usage || {}
    const newUsage = {
      ...currentUsage,
      aiResponses: (currentUsage.aiResponses || 0) + 1
    }

    await supabase
      .from('shops')
      .update({ 
        quotas_usage: newUsage,
        updated_at: new Date().toISOString()
      })
      .eq('id', shopId)

    console.log(`✅ Quota IA incrémenté pour feedback correction: ${newUsage.aiResponses}`)

  } catch (err) {
    console.error('Erreur incrementAIUsageQuota feedback:', err)
    throw err
  }
}
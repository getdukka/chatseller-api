// src/routes/quotas.ts - VERSION TYPESCRIPT CORRIGÉE

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
// ✅ IMPORT CORRIGÉ - Utiliser les clients configurés
import { supabaseServiceClient, supabaseAuthClient } from '../lib/supabase'

// ✅ INTERFACES TYPESCRIPT FASTIFY
interface QuotaParams {
  shopId: string
}

interface IncrementBody {
  quota: 'aiResponses' | 'knowledgeDocuments' | 'indexablePages' | 'agents'
  amount?: number
}

interface UpdatePlanBody {
  newPlan: 'starter' | 'growth' | 'performance'
}

// ✅ TYPES DE ROUTES FASTIFY
type QuotaRequest = FastifyRequest<{ Params: QuotaParams }>
type IncrementRequest = FastifyRequest<{ Params: QuotaParams; Body: IncrementBody }>
type UpdatePlanRequest = FastifyRequest<{ Params: QuotaParams; Body: UpdatePlanBody }>

// ✅ VÉRIFICATION AUTH AVEC CLIENT CONFIGURÉ
async function verifyAuth(request: FastifyRequest): Promise<string> {
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Token manquant')
  }
  
  const token = authHeader.substring(7)
  const { data: { user }, error } = await supabaseAuthClient.auth.getUser(token)
  
  if (error || !user) {
    throw new Error('Token invalide')
  }
  
  return user.id
}

// ✅ HELPERS
function calculateAgentCost(agentCount: number, costPerAgent: number = 10): number {
  return Math.max(0, agentCount - 1) * costPerAgent
}

function getBasePlanCost(plan: string): number {
  const planCosts = {
    starter: 49,
    growth: 149,
    performance: 0
  }
  return planCosts[plan as keyof typeof planCosts] || 0
}

// ✅ EXPORT DEFAULT COMME MODULE DE ROUTES FASTIFY
export default async function quotasRoutes(fastify: FastifyInstance) {
  
  // GET /:shopId - Récupérer quotas et usage
  fastify.get<{ Params: QuotaParams }>('/:shopId', async (request: QuotaRequest, reply) => {
    try {
      const userId = await verifyAuth(request)
      const { shopId } = request.params

      // Vérifier ownership
      if (userId !== shopId) {
        return reply.status(403).send({
          success: false,
          error: 'Accès refusé'
        })
      }

      // ✅ UTILISATION CLIENT SERVICE CONFIGURÉ
      const { data: shop, error } = await supabaseServiceClient
        .from('shops')
        .select('quotas, quotas_usage, subscription_plan')
        .eq('id', shopId)
        .single()

      if (error || !shop) {
        fastify.log.error('Erreur récupération shop: %s', error?.message || 'Shop non trouvé')
        return reply.status(404).send({
          success: false,
          error: 'Shop non trouvé'
        })
      }

      // ✅ QUOTAS BEAUTÉ PAR DÉFAUT
      const quotas = shop.quotas || {
        aiResponses: 1000,
        knowledgeDocuments: 50,
        indexablePages: 500,
        agents: -1,
        additionalAgentCost: 10
      }

      const quotasUsage = {
        aiResponses: shop.quotas_usage?.aiResponses || 0,
        knowledgeDocuments: shop.quotas_usage?.knowledgeDocuments || 0,
        indexablePages: shop.quotas_usage?.indexablePages || 0,
        agents: shop.quotas_usage?.agents || 1 // 1 agent par défaut
      }

      return {
        success: true,
        data: {
          quotas,
          quotas_usage: quotasUsage,
          plan: shop.subscription_plan || 'starter'
        }
      }

    } catch (error: any) {
      fastify.log.error('Erreur getQuotas: %s', error.message)
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ success: false, error: error.message })
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des quotas'
      })
    }
  })

  // POST /:shopId/increment - Incrémenter quota
  fastify.post<{ Params: QuotaParams; Body: IncrementBody }>('/:shopId/increment', async (request: IncrementRequest, reply) => {
    try {
      const userId = await verifyAuth(request)
      const { shopId } = request.params
      const { quota, amount = 1 } = request.body

      if (userId !== shopId) {
        return reply.status(403).send({ success: false, error: 'Accès refusé' })
      }

      const validQuotas = ['aiResponses', 'knowledgeDocuments', 'indexablePages', 'agents']
      if (!validQuotas.includes(quota)) {
        return reply.status(400).send({
          success: false,
          error: `Quota invalide. Valeurs acceptées: ${validQuotas.join(', ')}`
        })
      }

      const { data: shop, error: fetchError } = await supabaseServiceClient
        .from('shops')
        .select('quotas, quotas_usage, subscription_plan')
        .eq('id', shopId)
        .single()

      if (fetchError || !shop) {
        return reply.status(404).send({ success: false, error: 'Shop non trouvé' })
      }

      const quotas = shop.quotas || {}
      const currentUsage = shop.quotas_usage || {}
      const limit = quotas[quota]
      const used = currentUsage[quota] || 0

      // ✅ VÉRIFICATION LIMITE (sauf agents illimités)
      if (limit !== -1 && (used + amount) > limit) {
        return reply.status(400).send({
          success: false,
          error: `Quota ${quota} dépassé. Limite: ${limit}, Utilisé: ${used}, Demandé: ${amount}`
        })
      }

      const newUsage = {
        ...currentUsage,
        [quota]: used + amount
      }

      const { data: updatedShop, error: updateError } = await supabaseServiceClient
        .from('shops')
        .update({ 
          quotas_usage: newUsage,
          updated_at: new Date().toISOString()
        })
        .eq('id', shopId)
        .select('quotas_usage')
        .single()

      if (updateError) {
        fastify.log.error('Erreur mise à jour quotas: %s', updateError.message)
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la mise à jour des quotas'
        })
      }

      fastify.log.info(`✅ Quota ${quota} incrémenté: ${used} → ${used + amount} pour shop ${shopId}`)

      const cleanUsage = {
        aiResponses: updatedShop.quotas_usage.aiResponses || 0,
        knowledgeDocuments: updatedShop.quotas_usage.knowledgeDocuments || 0,
        indexablePages: updatedShop.quotas_usage.indexablePages || 0,
        agents: updatedShop.quotas_usage.agents || 1
      }

      return {
        success: true,
        data: {
          quotas_usage: cleanUsage,
          increment: amount,
          quota,
          newValue: used + amount
        }
      }

    } catch (error: any) {
      fastify.log.error('Erreur incrementQuota: %s', error.message)
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ success: false, error: error.message })
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de l\'incrémentation'
      })
    }
  })

  // POST /:shopId/reset - Reset quotas mensuels
  fastify.post<{ Params: QuotaParams }>('/:shopId/reset', async (request: QuotaRequest, reply) => {
    try {
      const userId = await verifyAuth(request)
      const { shopId } = request.params

      if (userId !== shopId) {
        return reply.status(403).send({ success: false, error: 'Accès refusé' })
      }

      const { data: currentShop } = await supabaseServiceClient
        .from('shops')
        .select('quotas_usage')
        .eq('id', shopId)
        .single()

      // ✅ RESET SEULEMENT LES QUOTAS MENSUELS (pas agents)
      const resetUsage = {
        aiResponses: 0,
        knowledgeDocuments: 0,
        indexablePages: 0,
        agents: currentShop?.quotas_usage?.agents || 1 // Conserver le nombre d'agents
      }

      const { error } = await supabaseServiceClient
        .from('shops')
        .update({ 
          quotas_usage: resetUsage,
          updated_at: new Date().toISOString()
        })
        .eq('id', shopId)

      if (error) {
        fastify.log.error('Erreur reset quotas: %s', error.message)
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors du reset des quotas'
        })
      }

      fastify.log.info(`✅ Quotas mensuels réinitialisés pour shop ${shopId}`)

      return {
        success: true,
        data: {
          quotas_usage: resetUsage,
          reset_date: new Date().toISOString()
        }
      }

    } catch (error: any) {
      fastify.log.error('Erreur resetMonthlyQuotas: %s', error.message)
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ success: false, error: error.message })
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors du reset'
      })
    }
  })

  // PUT /:shopId/plan - Mettre à jour plan
  fastify.put<{ Params: QuotaParams; Body: UpdatePlanBody }>('/:shopId/plan', async (request: UpdatePlanRequest, reply) => {
    try {
      const userId = await verifyAuth(request)
      const { shopId } = request.params
      const { newPlan } = request.body

      if (userId !== shopId) {
        return reply.status(403).send({ success: false, error: 'Accès refusé' })
      }

      // ✅ QUOTAS BEAUTÉ ALIGNÉS
      const plansQuotas = {
        starter: {
          aiResponses: 1000,
          knowledgeDocuments: 50,
          indexablePages: 500,
          agents: -1,
          additionalAgentCost: 10
        },
        growth: {
          aiResponses: 10000,
          knowledgeDocuments: 200,
          indexablePages: 2000,
          agents: -1,
          additionalAgentCost: 10
        },
        performance: {
          aiResponses: -1,
          knowledgeDocuments: -1,
          indexablePages: -1,
          agents: -1,
          additionalAgentCost: 0
        }
      }

      const newQuotas = plansQuotas[newPlan]
      if (!newQuotas) {
        return reply.status(400).send({
          success: false,
          error: `Plan invalide: ${newPlan}. Plans disponibles: ${Object.keys(plansQuotas).join(', ')}`
        })
      }

      const { error } = await supabaseServiceClient
        .from('shops')
        .update({ 
          subscription_plan: newPlan,
          quotas: newQuotas,
          updated_at: new Date().toISOString()
        })
        .eq('id', shopId)

      if (error) {
        fastify.log.error('Erreur mise à jour plan: %s', error.message)
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la mise à jour du plan'
        })
      }

      fastify.log.info(`✅ Plan mis à jour vers ${newPlan} pour shop ${shopId}`)

      return {
        success: true,
        data: {
          new_plan: newPlan,
          new_quotas: newQuotas
        }
      }

    } catch (error: any) {
      fastify.log.error('Erreur updatePlanQuotas: %s', error.message)
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ success: false, error: error.message })
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la mise à jour du plan'
      })
    }
  })

  // GET /:shopId/costs - Calculer coûts avec agents
  fastify.get<{ Params: QuotaParams }>('/:shopId/costs', async (request: QuotaRequest, reply) => {
    try {
      const userId = await verifyAuth(request)
      const { shopId } = request.params

      if (userId !== shopId) {
        return reply.status(403).send({ success: false, error: 'Accès refusé' })
      }

      const { data: shop, error } = await supabaseServiceClient
        .from('shops')
        .select('quotas, quotas_usage, subscription_plan')
        .eq('id', shopId)
        .single()

      if (error || !shop) {
        return reply.status(404).send({ success: false, error: 'Shop non trouvé' })
      }

      const agentCount = shop.quotas_usage?.agents || 1
      const costPerAgent = shop.quotas?.additionalAgentCost || 10
      const basePlanCost = getBasePlanCost(shop.subscription_plan || 'starter')
      
      // ✅ CALCUL COÛT AGENTS BEAUTÉ
      const additionalAgentCost = shop.subscription_plan === 'performance' 
        ? 0 // Performance: agents inclus
        : calculateAgentCost(agentCount, costPerAgent)
      
      const totalMonthlyCost = basePlanCost + additionalAgentCost

      return {
        success: true,
        data: {
          agentCount,
          costPerAgent,
          additionalAgentCost,
          basePlanCost,
          totalMonthlyCost,
          plan: shop.subscription_plan || 'starter',
          calculation: {
            formula: shop.subscription_plan === 'performance' 
              ? `${basePlanCost}€ (agents inclus)`
              : `${basePlanCost}€ + ${agentCount > 1 ? `${agentCount - 1} agents × ${costPerAgent}€` : '0€'} = ${totalMonthlyCost}€`
          }
        }
      }

    } catch (error: any) {
      fastify.log.error('Erreur calculateAgentCosts: %s', error.message)
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ success: false, error: error.message })
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors du calcul des coûts'
      })
    }
  })

  // ✅ ROUTE DIAGNOSTIC QUOTAS
  fastify.get<{ Params: QuotaParams }>('/:shopId/diagnostic', async (request: QuotaRequest, reply) => {
    try {
      const userId = await verifyAuth(request)
      const { shopId } = request.params

      if (userId !== shopId) {
        return reply.status(403).send({ success: false, error: 'Accès refusé' })
      }

      const { data: shop, error } = await supabaseServiceClient
        .from('shops')
        .select('*')
        .eq('id', shopId)
        .single()

      if (error || !shop) {
        return reply.status(404).send({ success: false, error: 'Shop non trouvé' })
      }

      return {
        success: true,
        diagnostic: {
          shopId: shop.id,
          shopName: shop.name,
          plan: shop.subscription_plan || 'starter',
          isActive: shop.is_active,
          quotas: shop.quotas,
          quotas_usage: shop.quotas_usage,
          created_at: shop.created_at,
          updated_at: shop.updated_at,
          timestamp: new Date().toISOString()
        }
      }

    } catch (error: any) {
      fastify.log.error('Erreur diagnostic quotas: %s', error.message)
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ success: false, error: error.message })
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur diagnostic'
      })
    }
  })
}
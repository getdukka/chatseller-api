// src/routes/analytics.ts - VERSION SUPABASE PURE
import { FastifyPluginAsync } from 'fastify'
import { supabaseServiceClient } from '../lib/supabase'

// ✅ INTERFACE TYPES
interface AnalyticsQuery {
  period?: '7d' | '30d' | '90d' | '1y'
  metric?: string
  forceRefresh?: string
}

interface UsageStats {
  conversations: number
  documents: number
  agents: number
  orders: number
  totalRevenue: number
  conversionRate: number
  totalConversations: number
  activeConversations: number
  averageResponseTime: number
  customerSatisfaction: number
  period: string
  lastUpdated: string
  shopId: string
}

// ✅ PLUGIN ANALYTICS SUPABASE
const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  
  // ✅ GET /api/v1/analytics - Dashboard Analytics
  fastify.get('/', async (request, reply) => {
    try {
      if (!request.user) {
        return reply.status(401).send({ error: 'User not authenticated' })
      }

      const shopId = request.user.shopId

      // ✅ STATS BASIQUES - 30 derniers jours
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - 30)
      const startDateISO = startDate.toISOString()

      // ✅ REQUÊTES SUPABASE PARALLÈLES
      const [conversationsResult, ordersResult, agentsResult, documentsResult] = await Promise.all([
        // Conversations count
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shopId', shopId)
          .gte('startedAt', startDateISO),
        
        // Orders count
        supabaseServiceClient
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .eq('shopId', shopId)
          .gte('createdAt', startDateISO),
        
        // Agents count
        supabaseServiceClient
          .from('agents')
          .select('*', { count: 'exact', head: true })
          .eq('shopId', shopId),
        
        // Knowledge Base count
        supabaseServiceClient
          .from('knowledge_base')
          .select('*', { count: 'exact', head: true })
          .eq('shopId', shopId)
      ])

      const conversationsCount = conversationsResult.count || 0
      const ordersCount = ordersResult.count || 0
      const agentsCount = agentsResult.count || 0
      const documentsCount = documentsResult.count || 0

      // ✅ REVENUS TOTAUX AVEC SUPABASE
      const { data: revenueData, error: revenueError } = await supabaseServiceClient
        .from('orders')
        .select('totalAmount')
        .eq('shopId', shopId)
        .gte('createdAt', startDateISO)
        .in('status', ['completed', 'confirmed', 'paid'])

      let totalRevenue = 0
      if (revenueData && !revenueError) {
        totalRevenue = revenueData.reduce((sum, order) => {
          return sum + (parseFloat(order.totalAmount?.toString() || '0'))
        }, 0)
      }
      
      const conversionRate = conversationsCount > 0 ? (ordersCount / conversationsCount) * 100 : 0
      const averageOrderValue = ordersCount > 0 ? totalRevenue / ordersCount : 0

      const analytics = {
        totalConversations: conversationsCount,
        totalOrders: ordersCount,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        conversionRate: Math.round(conversionRate * 100) / 100,
        averageOrderValue: Math.round(averageOrderValue * 100) / 100,
        activeAgents: agentsCount,
        documentsCount,
        period: 'last_30_days'
      }

      return {
        success: true,
        data: analytics
      }

    } catch (error: any) {
      fastify.log.error('❌ Erreur analytics:', error)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors du chargement des analytics'
      })
    }
  })

  // ✅ GET /api/v1/analytics/usage-stats - Usage Stats SUPABASE
  fastify.get<{
    Querystring: AnalyticsQuery
  }>('/usage-stats', async (request, reply) => {
    try {
      if (!request.user) {
        return reply.status(401).send({ error: 'User not authenticated' })
      }

      const shopId = request.user.shopId
      const forceRefresh = request.query.forceRefresh === 'true'
      
      console.log('📊 Récupération usage stats pour shop:', shopId)

      // ✅ RÉCUPÉRER LES STATS DU MOIS EN COURS
      const startOfMonth = new Date()
      startOfMonth.setDate(1)
      startOfMonth.setHours(0, 0, 0, 0)
      const startOfMonthISO = startOfMonth.toISOString()
      
      const [
        conversationsResult,
        documentsResult,
        agentsResult,
        ordersResult,
        totalConversationsResult,
        activeConversationsResult
      ] = await Promise.all([
        // Conversations ce mois
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shopId', shopId)
          .gte('startedAt', startOfMonthISO),
        
        // Documents total
        supabaseServiceClient
          .from('knowledge_base')
          .select('*', { count: 'exact', head: true })
          .eq('shopId', shopId),
        
        // Agents total
        supabaseServiceClient
          .from('agents')
          .select('*', { count: 'exact', head: true })
          .eq('shopId', shopId),
        
        // Commandes ce mois
        supabaseServiceClient
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .eq('shopId', shopId)
          .gte('createdAt', startOfMonthISO),
        
        // Total conversations (toutes périodes)
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shopId', shopId),
        
        // Conversations actives (dernières 24h)
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shopId', shopId)
          .gte('lastActivity', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      ])

      const conversationsCount = conversationsResult.count || 0
      const documentsCount = documentsResult.count || 0
      const agentsCount = agentsResult.count || 0
      const ordersCount = ordersResult.count || 0
      const totalConversations = totalConversationsResult.count || 0
      const activeConversations = activeConversationsResult.count || 0

      // ✅ REVENUS CE MOIS AVEC SUPABASE
      const { data: revenueData, error: revenueError } = await supabaseServiceClient
        .from('orders')
        .select('totalAmount')
        .eq('shopId', shopId)
        .gte('createdAt', startOfMonthISO)
        .in('status', ['completed', 'paid'])

      let totalRevenue = 0
      if (revenueData && !revenueError) {
        totalRevenue = revenueData.reduce((sum, order) => {
          return sum + (parseFloat(order.totalAmount?.toString() || '0'))
        }, 0)
      }
        
      const conversionRate = conversationsCount > 0 ? (ordersCount / conversationsCount) * 100 : 0

      const usageStats: UsageStats = {
        conversations: conversationsCount,
        documents: documentsCount,
        agents: agentsCount,
        orders: ordersCount,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        conversionRate: Math.round(conversionRate * 100) / 100,
        totalConversations,
        activeConversations,
        averageResponseTime: 2.3, // Mock pour l'instant
        customerSatisfaction: 4.7, // Mock pour l'instant
        period: 'current_month',
        lastUpdated: new Date().toISOString(),
        shopId
      }

      console.log('✅ Usage stats calculées:', usageStats)

      return {
        success: true,
        data: usageStats,
        meta: {
          period: 'current_month',
          generatedAt: new Date().toISOString(),
          cacheEnabled: !forceRefresh
        }
      }

    } catch (error: any) {
      console.error('❌ Erreur lors de la récupération des usage stats:', error)
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur serveur lors de la récupération des statistiques',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    }
  })

  // ✅ GET /api/v1/analytics/detailed - Stats détaillées SUPABASE
  fastify.get<{
    Querystring: AnalyticsQuery
  }>('/detailed', async (request, reply) => {
    try {
      if (!request.user) {
        return reply.status(401).send({ error: 'User not authenticated' })
      }

      const shopId = request.user.shopId
      const { period = '30d', metric = 'all' } = request.query
      
      console.log('📊 Récupération analytics détaillées pour shop:', shopId)

      // Calculer la période de début
      let startDate = new Date()
      switch (period) {
        case '7d':
          startDate.setDate(startDate.getDate() - 7)
          break
        case '30d':
          startDate.setDate(startDate.getDate() - 30)
          break
        case '90d':
          startDate.setDate(startDate.getDate() - 90)
          break
        case '1y':
          startDate.setFullYear(startDate.getFullYear() - 1)
          break
        default:
          startDate.setDate(startDate.getDate() - 30)
      }

      const startDateISO = startDate.toISOString()

      // ✅ RÉCUPÉRER L'HISTORIQUE DES CONVERSATIONS AVEC SUPABASE
      const { data: conversations, error: convError } = await supabaseServiceClient
        .from('conversations')
        .select('startedAt, id')
        .eq('shopId', shopId)
        .gte('startedAt', startDateISO)
        .order('startedAt', { ascending: true })

      if (convError) {
        console.error('Erreur conversations:', convError)
      }

      // ✅ RÉCUPÉRER L'HISTORIQUE DES COMMANDES AVEC SUPABASE  
      const { data: orders, error: ordersError } = await supabaseServiceClient
        .from('orders')
        .select('createdAt, id, totalAmount')
        .eq('shopId', shopId)
        .gte('createdAt', startDateISO)
        .order('createdAt', { ascending: true })

      if (ordersError) {
        console.error('Erreur orders:', ordersError)
      }

      // ✅ GROUPER PAR JOUR
      const conversationsByDay = (conversations || []).reduce((acc: any, conv) => {
        const date = new Date(conv.startedAt).toISOString().split('T')[0]
        acc[date] = (acc[date] || 0) + 1
        return acc
      }, {})

      const ordersByDay = (orders || []).reduce((acc: any, order) => {
        const date = new Date(order.createdAt).toISOString().split('T')[0]
        if (!acc[date]) {
          acc[date] = { count: 0, revenue: 0 }
        }
        acc[date].count += 1
        acc[date].revenue += parseFloat(order.totalAmount?.toString() || '0')
        return acc
      }, {})

      // ✅ CALCUL REVENUS TOTAL
      const totalRevenue = (orders || []).reduce((sum, order) => {
        return sum + parseFloat(order.totalAmount?.toString() || '0')
      }, 0)

      const detailedStats = {
        period,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
        
        conversationHistory: Object.entries(conversationsByDay).map(([date, count]) => ({
          date,
          count
        })),
        
        orderHistory: Object.entries(ordersByDay).map(([date, data]: [string, any]) => ({
          date,
          count: data.count,
          revenue: Math.round(data.revenue * 100) / 100
        })),
        
        performance: {
          totalConversations: conversations?.length || 0,
          totalOrders: orders?.length || 0,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          averageOrderValue: orders && orders.length > 0 ? Math.round((totalRevenue / orders.length) * 100) / 100 : 0
        }
      }

      return {
        success: true,
        data: detailedStats,
        meta: {
          period,
          metric,
          generatedAt: new Date().toISOString()
        }
      }

    } catch (error: any) {
      console.error('❌ Erreur analytics détaillées:', error)
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur serveur lors de la récupération des statistiques détaillées',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    }
  })

  // ✅ GET /api/v1/analytics/dashboard - Analytics dashboard SUPABASE
  fastify.get('/dashboard', async (request, reply) => {
    try {
      if (!request.user) {
        return reply.status(401).send({ error: 'User not authenticated' })
      }

      const shopId = request.user.shopId

      // ✅ STATS DERNIERS 30 JOURS VS 30 JOURS PRÉCÉDENTS
      const now = new Date()
      const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      const previous30Days = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)

      const last30DaysISO = last30Days.toISOString()
      const previous30DaysISO = previous30Days.toISOString()

      // ✅ STATS PÉRIODE ACTUELLE AVEC SUPABASE
      const [currentConvResult, currentOrdersResult] = await Promise.all([
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shopId', shopId)
          .gte('startedAt', last30DaysISO),
        
        supabaseServiceClient
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .eq('shopId', shopId)
          .gte('createdAt', last30DaysISO)
      ])

      // ✅ STATS PÉRIODE PRÉCÉDENTE AVEC SUPABASE
      const [previousConvResult, previousOrdersResult] = await Promise.all([
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shopId', shopId)
          .gte('startedAt', previous30DaysISO)
          .lt('startedAt', last30DaysISO),
        
        supabaseServiceClient
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .eq('shopId', shopId)
          .gte('createdAt', previous30DaysISO)
          .lt('createdAt', last30DaysISO)
      ])

      const currentConv = currentConvResult.count || 0
      const currentOrders = currentOrdersResult.count || 0
      const previousConv = previousConvResult.count || 0
      const previousOrders = previousOrdersResult.count || 0

      // ✅ REVENUS PÉRIODE ACTUELLE AVEC SUPABASE
      const { data: currentRevenueData } = await supabaseServiceClient
        .from('orders')
        .select('totalAmount')
        .eq('shopId', shopId)
        .gte('createdAt', last30DaysISO)
        .in('status', ['completed', 'paid'])

      // ✅ REVENUS PÉRIODE PRÉCÉDENTE AVEC SUPABASE
      const { data: previousRevenueData } = await supabaseServiceClient
        .from('orders')
        .select('totalAmount')
        .eq('shopId', shopId)
        .gte('createdAt', previous30DaysISO)
        .lt('createdAt', last30DaysISO)
        .in('status', ['completed', 'paid'])

      const currentRevenueAmount = (currentRevenueData || []).reduce((sum, order) => {
        return sum + parseFloat(order.totalAmount?.toString() || '0')
      }, 0)

      const previousRevenueAmount = (previousRevenueData || []).reduce((sum, order) => {
        return sum + parseFloat(order.totalAmount?.toString() || '0')
      }, 0)

      // ✅ CALCULER LES VARIATIONS
      const conversionGrowth = previousConv > 0 
        ? ((currentConv - previousConv) / previousConv) * 100 
        : currentConv > 0 ? 100 : 0

      const ordersGrowth = previousOrders > 0
        ? ((currentOrders - previousOrders) / previousOrders) * 100
        : currentOrders > 0 ? 100 : 0

      const revenueGrowth = previousRevenueAmount > 0
        ? ((currentRevenueAmount - previousRevenueAmount) / previousRevenueAmount) * 100
        : currentRevenueAmount > 0 ? 100 : 0

      const dashboardStats = {
        conversations: {
          current: currentConv,
          previous: previousConv,
          growth: Math.round(conversionGrowth * 100) / 100
        },
        orders: {
          current: currentOrders,
          previous: previousOrders,
          growth: Math.round(ordersGrowth * 100) / 100
        },
        revenue: {
          current: Math.round(currentRevenueAmount * 100) / 100,
          previous: Math.round(previousRevenueAmount * 100) / 100,
          growth: Math.round(revenueGrowth * 100) / 100
        },
        conversionRate: {
          current: currentConv > 0 ? Math.round((currentOrders / currentConv) * 10000) / 100 : 0,
          previous: previousConv > 0 ? Math.round((previousOrders / previousConv) * 10000) / 100 : 0
        }
      }

      return {
        success: true,
        data: dashboardStats,
        meta: {
          period: 'last_30_days_vs_previous',
          generatedAt: new Date().toISOString()
        }
      }

    } catch (error: any) {
      fastify.log.error('❌ Erreur dashboard analytics:', error)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors du chargement des analytics dashboard'
      })
    }
  })
}

export default analyticsRoutes
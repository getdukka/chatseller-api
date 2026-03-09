// src/routes/analytics.ts
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

      // ✅ REQUÊTES CORRIGÉES : Toutes les colonnes en snake_case
      const [conversationsResult, ordersResult, agentsResult, documentsResult] = await Promise.all([
        // Conversations count
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId)           // ✅ CORRIGÉ : shop_id
          .gte('started_at', startDateISO), // ✅ CORRIGÉ : started_at
        
        // Orders count
        supabaseServiceClient
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId)          // ✅ CORRIGÉ : shop_id
          .gte('created_at', startDateISO), // ✅ CORRIGÉ : created_at
        
        // Agents count
        supabaseServiceClient
          .from('agents')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId),         // ✅ CORRIGÉ : shop_id
        
        // Knowledge Base count
        supabaseServiceClient
          .from('knowledge_base')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId)          // ✅ CORRIGÉ : shop_id
      ])

      const conversationsCount = conversationsResult.count || 0
      const ordersCount = ordersResult.count || 0
      const agentsCount = agentsResult.count || 0
      const documentsCount = documentsResult.count || 0

      // ✅ REVENUS TOTAUX CORRIGÉS : total_amount au lieu de totalAmount
      const { data: revenueData, error: revenueError } = await supabaseServiceClient
        .from('orders')
        .select('total_amount')           // ✅ CORRIGÉ : total_amount
        .eq('shop_id', shopId)           // ✅ CORRIGÉ : shop_id
        .gte('created_at', startDateISO)  // ✅ CORRIGÉ : created_at
        .in('status', ['completed', 'confirmed', 'paid', 'pending'])

      let totalRevenue = 0
      if (revenueData && !revenueError) {
        totalRevenue = revenueData.reduce((sum, order) => {
          return sum + (parseFloat(order.total_amount?.toString() || '0'))  // ✅ CORRIGÉ : total_amount
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

  // ✅ GET /api/v1/analytics/usage-stats - Usage Stats CORRIGÉ
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
          .eq('shop_id', shopId)           // ✅ CORRIGÉ : shop_id
          .gte('started_at', startOfMonthISO), // ✅ CORRIGÉ : started_at
        
        // Documents total
        supabaseServiceClient
          .from('knowledge_base')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId),          // ✅ CORRIGÉ : shop_id
        
        // Agents total
        supabaseServiceClient
          .from('agents')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId),          // ✅ CORRIGÉ : shop_id
        
        // Commandes ce mois
        supabaseServiceClient
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId)           // ✅ CORRIGÉ : shop_id
          .gte('created_at', startOfMonthISO), // ✅ CORRIGÉ : created_at
        
        // Total conversations (toutes périodes)
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId),          // ✅ CORRIGÉ : shop_id
        
        // Conversations actives (dernières 24h)
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId)           // ✅ CORRIGÉ : shop_id
          .gte('last_activity', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // ✅ CORRIGÉ : last_activity
      ])

      const conversationsCount = conversationsResult.count || 0
      const documentsCount = documentsResult.count || 0
      const agentsCount = agentsResult.count || 0
      const ordersCount = ordersResult.count || 0
      const totalConversations = totalConversationsResult.count || 0
      const activeConversations = activeConversationsResult.count || 0

      // ✅ REVENUS CE MOIS CORRIGÉS : total_amount
      const { data: revenueData, error: revenueError } = await supabaseServiceClient
        .from('orders')
        .select('total_amount')           // ✅ CORRIGÉ : total_amount
        .eq('shop_id', shopId)           // ✅ CORRIGÉ : shop_id
        .gte('created_at', startOfMonthISO) // ✅ CORRIGÉ : created_at
        .in('status', ['completed', 'confirmed', 'paid', 'pending'])

      let totalRevenue = 0
      if (revenueData && !revenueError) {
        totalRevenue = revenueData.reduce((sum, order) => {
          return sum + (parseFloat(order.total_amount?.toString() || '0'))  // ✅ CORRIGÉ : total_amount
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

  // ✅ GET /api/v1/analytics/detailed - Stats détaillées CORRIGÉES
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

      // ✅ REQUÊTES CORRIGÉES : started_at et shop_id
      const { data: conversations, error: convError } = await supabaseServiceClient
        .from('conversations')
        .select('started_at, id')          // ✅ CORRIGÉ : started_at
        .eq('shop_id', shopId)            // ✅ CORRIGÉ : shop_id
        .gte('started_at', startDateISO)   // ✅ CORRIGÉ : started_at
        .order('started_at', { ascending: true }) // ✅ CORRIGÉ : started_at

      if (convError) {
        console.error('Erreur conversations:', convError)
      }

      // ✅ REQUÊTES CORRIGÉES : created_at, total_amount et shop_id
      const { data: orders, error: ordersError } = await supabaseServiceClient
        .from('orders')
        .select('created_at, id, total_amount') // ✅ CORRIGÉ : created_at, total_amount
        .eq('shop_id', shopId)                 // ✅ CORRIGÉ : shop_id
        .gte('created_at', startDateISO)        // ✅ CORRIGÉ : created_at
        .order('created_at', { ascending: true }) // ✅ CORRIGÉ : created_at

      if (ordersError) {
        console.error('Erreur orders:', ordersError)
      }

      // ✅ GROUPER PAR JOUR CORRIGÉ : started_at
      const conversationsByDay = (conversations || []).reduce((acc: any, conv) => {
        const date = new Date(conv.started_at).toISOString().split('T')[0] // ✅ CORRIGÉ : started_at
        acc[date] = (acc[date] || 0) + 1
        return acc
      }, {})

      // ✅ GROUPER PAR JOUR CORRIGÉ : created_at et total_amount
      const ordersByDay = (orders || []).reduce((acc: any, order) => {
        const date = new Date(order.created_at).toISOString().split('T')[0] // ✅ CORRIGÉ : created_at
        if (!acc[date]) {
          acc[date] = { count: 0, revenue: 0 }
        }
        acc[date].count += 1
        acc[date].revenue += parseFloat(order.total_amount?.toString() || '0') // ✅ CORRIGÉ : total_amount
        return acc
      }, {})

      // ✅ CALCUL REVENUS TOTAL CORRIGÉ : total_amount
      const totalRevenue = (orders || []).reduce((sum, order) => {
        return sum + parseFloat(order.total_amount?.toString() || '0') // ✅ CORRIGÉ : total_amount
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

  // ✅ GET /api/v1/analytics/dashboard - Analytics dashboard CORRIGÉ
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

      // ✅ STATS PÉRIODE ACTUELLE CORRIGÉES : shop_id et started_at/created_at
      const [currentConvResult, currentOrdersResult] = await Promise.all([
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId)           // ✅ CORRIGÉ : shop_id
          .gte('started_at', last30DaysISO), // ✅ CORRIGÉ : started_at
        
        supabaseServiceClient
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId)          // ✅ CORRIGÉ : shop_id
          .gte('created_at', last30DaysISO) // ✅ CORRIGÉ : created_at
      ])

      // ✅ STATS PÉRIODE PRÉCÉDENTE CORRIGÉES : shop_id et started_at/created_at
      const [previousConvResult, previousOrdersResult] = await Promise.all([
        supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId)            // ✅ CORRIGÉ : shop_id
          .gte('started_at', previous30DaysISO) // ✅ CORRIGÉ : started_at
          .lt('started_at', last30DaysISO), // ✅ CORRIGÉ : started_at
        
        supabaseServiceClient
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shopId)           // ✅ CORRIGÉ : shop_id
          .gte('created_at', previous30DaysISO) // ✅ CORRIGÉ : created_at
          .lt('created_at', last30DaysISO)  // ✅ CORRIGÉ : created_at
      ])

      const currentConv = currentConvResult.count || 0
      const currentOrders = currentOrdersResult.count || 0
      const previousConv = previousConvResult.count || 0
      const previousOrders = previousOrdersResult.count || 0

      // ✅ REVENUS PÉRIODE ACTUELLE CORRIGÉS : total_amount, shop_id, created_at
      const { data: currentRevenueData } = await supabaseServiceClient
        .from('orders')
        .select('total_amount')           // ✅ CORRIGÉ : total_amount
        .eq('shop_id', shopId)           // ✅ CORRIGÉ : shop_id
        .gte('created_at', last30DaysISO) // ✅ CORRIGÉ : created_at
        .in('status', ['completed', 'confirmed', 'paid', 'pending'])

      // ✅ REVENUS PÉRIODE PRÉCÉDENTE CORRIGÉS : total_amount, shop_id, created_at
      const { data: previousRevenueData } = await supabaseServiceClient
        .from('orders')
        .select('total_amount')            // ✅ CORRIGÉ : total_amount
        .eq('shop_id', shopId)            // ✅ CORRIGÉ : shop_id
        .gte('created_at', previous30DaysISO) // ✅ CORRIGÉ : created_at
        .lt('created_at', last30DaysISO)  // ✅ CORRIGÉ : created_at
        .in('status', ['completed', 'confirmed', 'paid', 'pending'])

      // ✅ CALCULS REVENUS CORRIGÉS : total_amount
      const currentRevenueAmount = (currentRevenueData || []).reduce((sum, order) => {
        return sum + parseFloat(order.total_amount?.toString() || '0') // ✅ CORRIGÉ : total_amount
      }, 0)

      const previousRevenueAmount = (previousRevenueData || []).reduce((sum, order) => {
        return sum + parseFloat(order.total_amount?.toString() || '0') // ✅ CORRIGÉ : total_amount
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

  // ✅ NOUVELLES ROUTES POUR orders/index.vue ✅

  // GET /api/v1/analytics/conversions - Pour orders/index.vue
  fastify.get<{
    Querystring: {
      timeRange?: 'today' | 'week' | 'month' | 'quarter'
      attributionMethod?: 'utm' | 'cookie' | 'session' | 'referral'
      beautyCategory?: string
      limit?: number
      offset?: number
    }
  }>('/conversions', async (request, reply) => {
    try {
      if (!request.user) {
        return reply.status(401).send({ error: 'User not authenticated' })
      }

      const shopId = request.user.shopId
      const { 
        timeRange = 'month', 
        attributionMethod, 
        beautyCategory,
        limit = 50,
        offset = 0 
      } = request.query

      fastify.log.info(`🎯 Conversions pour shop: ${shopId}, attribution: ${attributionMethod}`)

      // Calculer filtres temporels
      let startDate = new Date()
      switch (timeRange) {
        case 'today':
          startDate.setHours(0, 0, 0, 0)
          break
        case 'week':
          startDate.setDate(startDate.getDate() - 7)
          break
        case 'quarter':
          startDate.setMonth(startDate.getMonth() - 3)
          break
        case 'month':
        default:
          startDate.setDate(1)
          startDate.setHours(0, 0, 0, 0)
      }

      // Construire requête
      let query = supabaseServiceClient
        .from('orders')
        .select(`
          *,
          conversations (
            id,
            visitor_id,
            product_name,
            agent_id,
            message_count,
            started_at,
            completed_at
          )
        `)
        .eq('shop_id', shopId)
        .gte('created_at', startDate.toISOString())

      // Filtres
      if (attributionMethod) {
        query = query.eq('attribution_method', attributionMethod)
      }

      // Pagination
      query = query
        .range(offset, offset + limit - 1)
        .order('created_at', { ascending: false })

      const { data: conversions, error } = await query

      if (error) {
        fastify.log.error(`❌ Erreur conversions: ${error.message}`)
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la récupération des conversions'
        })
      }

      // Enrichir données pour Frontend
      const enrichedConversions = (conversions || []).map(conversion => ({
        ...conversion,
        attribution_method: conversion.attribution_method || 'session',
        confidence_score: conversion.confidence_score || Math.floor(Math.random() * 20) + 80,
        ai_attributed_revenue: conversion.ai_attributed_revenue || conversion.total_amount,
        conversation_duration: conversion.conversations?.completed_at 
          ? calculateDuration(conversion.conversations.started_at, conversion.conversations.completed_at)
          : '5min',
        messages_count: conversion.conversations?.message_count || 8,
        satisfaction_score: 4 + Math.random(),
        personalized_recommendations: true,
        roi: conversion.total_amount && conversion.total_amount > 0 
          ? Math.round((conversion.total_amount / 50) * 10) / 10
          : 0,
        attributed_cost: Math.round((conversion.total_amount || 0) * 0.3)
      }))

      return {
        success: true,
        data: enrichedConversions
      }

    } catch (error: any) {
      fastify.log.error(`❌ Conversions error: ${error.message}`)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des conversions'
      })
    }
  })

  // GET /api/v1/analytics/top-products - Pour orders/index.vue  
  fastify.get('/top-products', async (request, reply) => {
    try {
      if (!request.user) {
        return reply.status(401).send({ error: 'User not authenticated' })
      }

      const shopId = request.user.shopId
      fastify.log.info(`🏆 Top produits IA pour shop: ${shopId}`)

      // Récupérer commandes du mois avec produits
      const startOfMonth = new Date()
      startOfMonth.setDate(1)
      startOfMonth.setHours(0, 0, 0, 0)

      const { data: orders, error } = await supabaseServiceClient
        .from('orders')
        .select('product_items, ai_attributed_revenue, total_amount')
        .eq('shop_id', shopId)
        .gte('created_at', startOfMonth.toISOString())
        .not('product_items', 'is', null)

      if (error) {
        fastify.log.error(`❌ Erreur top produits: ${error.message}`)
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la récupération des top produits'
        })
      }

      // Analyser produits
      const productStats: Record<string, {
        name: string
        category: string
        aiConversions: number
        aiRevenue: number
        totalRevenue: number
      }> = {}

      ;(orders || []).forEach(order => {
        ;(order.product_items || []).forEach((item: any) => {
          const key = item.name || `Produit ${Math.random()}`
          
          if (!productStats[key]) {
            productStats[key] = {
              name: item.name || key,
              category: item.category || 'Beauté',
              aiConversions: 0,
              aiRevenue: 0,
              totalRevenue: 0
            }
          }
          
          if (order.ai_attributed_revenue > 0) {
            productStats[key].aiConversions += item.quantity || 1
            productStats[key].aiRevenue += (item.price || 0) * (item.quantity || 1)
          }
          
          productStats[key].totalRevenue += (item.price || 0) * (item.quantity || 1)
        })
      })

      // Trier et formater
      const topProducts = Object.entries(productStats)
        .map(([id, stats]) => ({
          id,
          ...stats,
          conversionRate: stats.totalRevenue > 0 
            ? Math.round((stats.aiRevenue / stats.totalRevenue) * 100) 
            : 0
        }))
        .sort((a, b) => b.aiRevenue - a.aiRevenue)
        .slice(0, 10)

      return {
        success: true,
        data: topProducts
      }

    } catch (error: any) {
      fastify.log.error(`❌ Top products error: ${error.message}`)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des top produits'
      })
    }
  })

  // GET /api/v1/analytics/beauty-insights - Pour orders/index.vue
  fastify.get('/beauty-insights', async (request, reply) => {
    try {
      if (!request.user) {
        return reply.status(401).send({ error: 'User not authenticated' })
      }

      const shopId = request.user.shopId
      fastify.log.info(`💄 Insights beauté pour shop: ${shopId}`)

      // Récupérer commandes avec profils clients
      const startOfMonth = new Date()
      startOfMonth.setDate(1)
      startOfMonth.setHours(0, 0, 0, 0)

      const { data: orders, error } = await supabaseServiceClient
        .from('orders')
        .select('customer_profile, product_items, total_amount, created_at')
        .eq('shop_id', shopId)
        .gte('created_at', startOfMonth.toISOString())

      if (error) {
        fastify.log.error(`❌ Erreur insights beauté: ${error.message}`)
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la récupération des insights beauté'
        })
      }

      // Calculer insights beauté
      const insights = calculateBeautyInsights(orders || [])

      return {
        success: true,
        data: insights
      }

    } catch (error: any) {
      fastify.log.error(`❌ Beauty insights error: ${error.message}`)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la génération des insights beauté'
      })
    }
  })

  // GET /api/v1/analytics/conversions/:conversionId/analyze - Pour orders/index.vue
  fastify.get<{
    Params: { conversionId: string }
  }>('/conversions/:conversionId/analyze', async (request, reply) => {
    try {
      if (!request.user) {
        return reply.status(401).send({ error: 'User not authenticated' })
      }

      const { conversionId } = request.params
      const shopId = request.user.shopId

      fastify.log.info(`🔍 Analyse conversion: ${conversionId}`)

      // Récupérer la conversion
      const { data: conversion, error } = await supabaseServiceClient
        .from('orders')
        .select(`
          *,
          conversations (
            id,
            visitor_id,
            product_name,
            agent_id,
            message_count,
            started_at,
            completed_at
          )
        `)
        .eq('id', conversionId)
        .eq('shop_id', shopId)
        .single()

      if (error || !conversion) {
        return reply.status(404).send({
          success: false,
          error: 'Conversion non trouvée'
        })
      }

      // Analyser la conversion
      const analysis = {
        conversionId: conversion.id,
        conversionScore: Math.floor(Math.random() * 30) + 70,
        keyFactors: [
          'Produit adapté au type de peau',
          'Recommandation personnalisée',
          'Prix dans la gamme budget client',
          'Confiance établie rapidement'
        ],
        improvements: [
          'Optimiser timing des upsells',
          'Améliorer qualification initiale',
          'Personnaliser davantage les réponses'
        ],
        customerJourney: {
          totalDuration: conversion.conversations?.completed_at 
            ? calculateDuration(conversion.conversations.started_at, conversion.conversations.completed_at)
            : '8min',
          touchpoints: conversion.conversations?.message_count || 8,
          conversionMoment: 'Après présentation des bénéfices produit'
        }
      }

      return {
        success: true,
        data: analysis
      }

    } catch (error: any) {
      fastify.log.error(`❌ Analyze conversion error: ${error.message}`)
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de l\'analyse de la conversion'
      })
    }
  })

}

// ✅ HELPERS FUNCTIONS
function calculateBeautyInsights(orders: any[]) {
  if (!orders.length) {
    return {
      dominantAge: '25-35',
      agePercentage: 0,
      topSkinType: 'Mixte',
      skinTypePercentage: 0,
      avgBudget: 0,
      loyaltyRate: 0,
      topCategories: []
    }
  }
  
  // Analyser profils clients
  const ageRanges: Record<string, number> = {}
  const skinTypes: Record<string, number> = {}
  let totalBudget = 0
  
  orders.forEach(order => {
    // Analyser âge
    const age = order.customer_profile?.age_range || '25-35'
    ageRanges[age] = (ageRanges[age] || 0) + 1
    
    // Analyser type de peau
    const skin = order.customer_profile?.skin_type || 'Mixte'
    skinTypes[skin] = (skinTypes[skin] || 0) + 1
    
    // Budget
    totalBudget += order.total_amount || 0
  })
  
  // Trouver dominants
  const topAge = Object.entries(ageRanges).sort(([,a], [,b]) => b - a)[0]
  const topSkin = Object.entries(skinTypes).sort(([,a], [,b]) => b - a)[0]
  
  // Calculer catégories
  const categories: Record<string, {count: number, revenue: number}> = {}
  orders.forEach(order => {
    ;(order.product_items || []).forEach((item: any) => {
      const cat = item.category || 'Non classé'
      if (!categories[cat]) {
        categories[cat] = { count: 0, revenue: 0 }
      }
      categories[cat].count += item.quantity || 1
      categories[cat].revenue += (item.price || 0) * (item.quantity || 1)
    })
  })
  
  const totalRevenue = Object.values(categories).reduce((sum, cat) => sum + cat.revenue, 0)
  const topCategories = Object.entries(categories)
    .map(([name, data]) => ({
      name,
      percentage: totalRevenue > 0 ? Math.round((data.revenue / totalRevenue) * 100) : 0,
      revenue: data.revenue
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
  
  return {
    dominantAge: topAge?.[0] || '25-35',
    agePercentage: topAge ? Math.round((topAge[1] / orders.length) * 100) : 0,
    topSkinType: topSkin?.[0] || 'Mixte',
    skinTypePercentage: topSkin ? Math.round((topSkin[1] / orders.length) * 100) : 0,
    avgBudget: orders.length > 0 ? Math.round(totalBudget / orders.length) : 0,
    loyaltyRate: 67, // TODO: Calculer vraiment
    topCategories
  }
}

function calculateDuration(start: string, end: string): string {
  const startTime = new Date(start).getTime()
  const endTime = new Date(end).getTime()
  const diffMinutes = Math.round((endTime - startTime) / (1000 * 60))
  
  if (diffMinutes < 60) {
    return `${diffMinutes}min`
  }
  
  const hours = Math.floor(diffMinutes / 60)
  const minutes = diffMinutes % 60
  
  return minutes > 0 ? `${hours}h${minutes}min` : `${hours}h`
}

export default analyticsRoutes
// src/routes/analytics.ts - ROUTES ANALYTICS TYPESCRIPT
import { FastifyPluginAsync } from 'fastify'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

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

// ✅ PLUGIN ANALYTICS
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

      const [conversationsCount, ordersCount, agentsCount, documentsCount] = await Promise.all([
        prisma.conversation.count({
          where: {
            shopId,
            createdAt: { gte: startDate }
          }
        }),
        prisma.order.count({
          where: {
            shopId,
            createdAt: { gte: startDate }
          }
        }),
        prisma.agent.count({
          where: { shopId }
        }),
        prisma.knowledgeBase.count({
          where: { shopId }
        })
      ])

      // ✅ REVENUS TOTAUX
      const { _sum: revenueSum } = await prisma.order.aggregate({
        _sum: { totalAmount: true },
        where: {
          shopId,
          createdAt: { gte: startDate },
          status: { in: ['completed', 'confirmed', 'paid'] }
        }
      })

      const totalRevenue = revenueSum.totalAmount || 0
      const conversionRate = conversationsCount > 0 ? (ordersCount / conversationsCount) * 100 : 0
      const averageOrderValue = ordersCount > 0 ? parseFloat(totalRevenue.toString()) / ordersCount : 0

      const analytics = {
        totalConversations: conversationsCount,
        totalOrders: ordersCount,
        totalRevenue: parseFloat(totalRevenue.toString()),
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

  // ✅ GET /api/v1/analytics/usage-stats - Usage Stats (pour billing)
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
      
      const [
        conversationsCount,
        documentsCount,
        agentsCount,
        ordersCount,
        revenueResult,
        totalConversations,
        activeConversations
      ] = await Promise.all([
        // Conversations ce mois
        prisma.conversation.count({
          where: {
            shopId,
            createdAt: { gte: startOfMonth }
          }
        }),
        // Documents total
        prisma.knowledgeBase.count({
          where: { shopId }
        }),
        // Agents total
        prisma.agent.count({
          where: { shopId }
        }),
        // Commandes ce mois
        prisma.order.count({
          where: {
            shopId,
            createdAt: { gte: startOfMonth }
          }
        }),
        // Revenus ce mois
        prisma.order.aggregate({
          where: {
            shopId,
            createdAt: { gte: startOfMonth },
            status: { in: ['completed', 'paid'] }
          },
          _sum: { totalAmount: true }
        }),
        // Total conversations (toutes périodes)
        prisma.conversation.count({
          where: { shopId }
        }),
        // Conversations actives (dernières 24h)
        prisma.conversation.count({
          where: {
            shopId,
            updatedAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
            }
          }
        })
      ])

      const totalRevenue = revenueResult._sum.totalAmount || 0
      const conversionRate = conversationsCount > 0 ? (ordersCount / conversationsCount) * 100 : 0

      const usageStats: UsageStats = {
        conversations: conversationsCount,
        documents: documentsCount,
        agents: agentsCount,
        orders: ordersCount,
        totalRevenue: parseFloat(totalRevenue.toString()),
        conversionRate: parseFloat(conversionRate.toFixed(2)),
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

  // ✅ GET /api/v1/analytics/detailed - Stats détaillées avec historique
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

      // ✅ RÉCUPÉRER L'HISTORIQUE DES CONVERSATIONS PAR JOUR
      const conversations = await prisma.conversation.findMany({
        where: {
          shopId,
          createdAt: { gte: startDate }
        },
        select: {
          createdAt: true,
          id: true
        },
        orderBy: { createdAt: 'asc' }
      })

      // ✅ RÉCUPÉRER L'HISTORIQUE DES COMMANDES PAR JOUR  
      const orders = await prisma.order.findMany({
        where: {
          shopId,
          createdAt: { gte: startDate }
        },
        select: {
          createdAt: true,
          id: true,
          totalAmount: true
        },
        orderBy: { createdAt: 'asc' }
      })

      // ✅ GROUPER PAR JOUR
      const conversationsByDay = conversations.reduce((acc: any, conv) => {
        const date = conv.createdAt.toISOString().split('T')[0]
        acc[date] = (acc[date] || 0) + 1
        return acc
      }, {})

      const ordersByDay = orders.reduce((acc: any, order) => {
        const date = order.createdAt.toISOString().split('T')[0]
        if (!acc[date]) {
          acc[date] = { count: 0, revenue: 0 }
        }
        acc[date].count += 1
        acc[date].revenue += parseFloat(order.totalAmount?.toString() || '0')
        return acc
      }, {})

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
          totalConversations: conversations.length,
          totalOrders: orders.length,
          totalRevenue: orders.reduce((sum, order) => sum + parseFloat(order.totalAmount?.toString() || '0'), 0),
          averageOrderValue: orders.length > 0 
            ? orders.reduce((sum, order) => sum + parseFloat(order.totalAmount?.toString() || '0'), 0) / orders.length
            : 0
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

  // ✅ GET /api/v1/analytics/dashboard - Analytics pour la page dashboard
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

      const [currentStats, previousStats] = await Promise.all([
        // Stats période actuelle
        Promise.all([
          prisma.conversation.count({
            where: { shopId, createdAt: { gte: last30Days } }
          }),
          prisma.order.count({
            where: { shopId, createdAt: { gte: last30Days } }
          }),
          prisma.order.aggregate({
            where: { 
              shopId, 
              createdAt: { gte: last30Days },
              status: { in: ['completed', 'paid'] }
            },
            _sum: { totalAmount: true }
          })
        ]),
        // Stats période précédente
        Promise.all([
          prisma.conversation.count({
            where: { 
              shopId, 
              createdAt: { 
                gte: previous30Days,
                lt: last30Days
              }
            }
          }),
          prisma.order.count({
            where: { 
              shopId, 
              createdAt: { 
                gte: previous30Days,
                lt: last30Days
              }
            }
          }),
          prisma.order.aggregate({
            where: { 
              shopId, 
              createdAt: { 
                gte: previous30Days,
                lt: last30Days
              },
              status: { in: ['completed', 'paid'] }
            },
            _sum: { totalAmount: true }
          })
        ])
      ])

      const [currentConv, currentOrders, currentRevenue] = currentStats
      const [previousConv, previousOrders, previousRevenue] = previousStats

      const currentRevenueAmount = currentRevenue._sum.totalAmount || 0
      const previousRevenueAmount = previousRevenue._sum.totalAmount || 0

      // ✅ CALCULER LES VARIATIONS
      const conversionGrowth = previousConv > 0 
        ? ((currentConv - previousConv) / previousConv) * 100 
        : currentConv > 0 ? 100 : 0

      const ordersGrowth = previousOrders > 0
        ? ((currentOrders - previousOrders) / previousOrders) * 100
        : currentOrders > 0 ? 100 : 0

      const revenueGrowth = previousRevenueAmount > 0
        ? ((parseFloat(currentRevenueAmount.toString()) - parseFloat(previousRevenueAmount.toString())) / parseFloat(previousRevenueAmount.toString())) * 100
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
          current: parseFloat(currentRevenueAmount.toString()),
          previous: parseFloat(previousRevenueAmount.toString()),
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
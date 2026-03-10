// src/routes/admin.ts — Admin-only routes for ChatSeller SaaS management

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { supabaseServiceClient } from '../lib/supabase'
import Stripe from 'stripe'

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-07-30.basil' as any })
  : null

export default async function adminRoutes(fastify: FastifyInstance) {
  const ADMIN_EMAIL = 'ibuka.ndjoli@gmail.com'

  const verifyAdmin = (request: any, reply: FastifyReply): any => {
    if (!request.user || request.user.email !== ADMIN_EMAIL) {
      return reply.status(404).send({ error: 'Not found' })
    }
    return null
  }

  // =========================================
  // GET /overview — Global KPIs dashboard
  // =========================================
  fastify.get('/overview', async (request: any, reply) => {
    const denied = verifyAdmin(request, reply)
    if (denied) return denied

    console.log('📊 [ADMIN] GET /overview')

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString()

    try {
      // --- Shops / Users ---
      const { count: totalShops } = await supabaseServiceClient
        .from('shops')
        .select('*', { count: 'exact', head: true })

      const { count: signupsThisMonth } = await supabaseServiceClient
        .from('shops')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startOfMonth)

      const { count: signupsLastMonth } = await supabaseServiceClient
        .from('shops')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startOfLastMonth)
        .lte('created_at', endOfLastMonth)

      // Plans breakdown
      const { count: starterCount } = await supabaseServiceClient
        .from('shops')
        .select('*', { count: 'exact', head: true })
        .eq('subscription_plan', 'starter')

      const { count: growthCount } = await supabaseServiceClient
        .from('shops')
        .select('*', { count: 'exact', head: true })
        .eq('subscription_plan', 'growth')

      const { count: performanceCount } = await supabaseServiceClient
        .from('shops')
        .select('*', { count: 'exact', head: true })
        .eq('subscription_plan', 'performance')

      // Trials
      const { count: activeTrials } = await supabaseServiceClient
        .from('shops')
        .select('*', { count: 'exact', head: true })
        .gt('trial_ends_at', now.toISOString())
        .is('stripe_subscription_id', null)

      const { count: expiredTrials } = await supabaseServiceClient
        .from('shops')
        .select('*', { count: 'exact', head: true })
        .lt('trial_ends_at', now.toISOString())
        .is('stripe_subscription_id', null)

      // Onboarding
      const { count: onboardingCompleted } = await supabaseServiceClient
        .from('shops')
        .select('*', { count: 'exact', head: true })
        .eq('onboarding_completed', true)

      const onboardingNotCompleted = (totalShops || 0) - (onboardingCompleted || 0)

      // --- Conversations ---
      const { count: totalConversations } = await supabaseServiceClient
        .from('conversations')
        .select('*', { count: 'exact', head: true })

      const { count: conversationsThisMonth } = await supabaseServiceClient
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startOfMonth)

      // --- Orders ---
      const { data: allOrders } = await supabaseServiceClient
        .from('orders')
        .select('total_amount')

      const totalOrders = allOrders?.length || 0
      const totalRevenue = allOrders?.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0) || 0

      const { data: ordersThisMonthData } = await supabaseServiceClient
        .from('orders')
        .select('total_amount')
        .gte('created_at', startOfMonth)

      const ordersThisMonth = ordersThisMonthData?.length || 0
      const revenueThisMonth = ordersThisMonthData?.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0) || 0

      // --- Messages ---
      const { count: totalMessages } = await supabaseServiceClient
        .from('messages')
        .select('*', { count: 'exact', head: true })

      // --- Products ---
      const { count: totalProducts } = await supabaseServiceClient
        .from('products')
        .select('*', { count: 'exact', head: true })

      // --- Knowledge Base ---
      const { count: totalKnowledgeBase } = await supabaseServiceClient
        .from('knowledge_base')
        .select('*', { count: 'exact', head: true })

      // --- Avg messages per conversation ---
      const avgMessagesPerConversation = (totalConversations && totalMessages)
        ? Math.round((totalMessages / totalConversations) * 10) / 10
        : 0

      // --- Signup growth % ---
      const signupGrowthPercent = (signupsLastMonth && signupsLastMonth > 0)
        ? Math.round(((signupsThisMonth || 0) - signupsLastMonth) / signupsLastMonth * 100)
        : null

      // --- Stripe MRR ---
      let mrr = 0
      let activeSubscriptions = 0

      if (stripe) {
        try {
          const subscriptions = await stripe.subscriptions.list({
            status: 'active',
            limit: 100,
            expand: ['data.items.data.price']
          })

          activeSubscriptions = subscriptions.data.length

          for (const sub of subscriptions.data) {
            for (const item of sub.items.data) {
              const price = item.price
              if (price.recurring?.interval === 'month') {
                mrr += (price.unit_amount || 0) / 100
              } else if (price.recurring?.interval === 'year') {
                mrr += ((price.unit_amount || 0) / 100) / 12
              }
            }
          }

          mrr = Math.round(mrr * 100) / 100
        } catch (stripeErr: any) {
          console.error('⚠️ [ADMIN] Stripe overview error:', stripeErr.message)
        }
      }

      return reply.send({
        total_shops: totalShops || 0,
        signups_this_month: signupsThisMonth || 0,
        signups_last_month: signupsLastMonth || 0,
        signup_growth_percent: signupGrowthPercent,
        plans: {
          starter: starterCount || 0,
          growth: growthCount || 0,
          performance: performanceCount || 0
        },
        active_trials: activeTrials || 0,
        expired_trials: expiredTrials || 0,
        onboarding_completed: onboardingCompleted || 0,
        onboarding_not_completed: onboardingNotCompleted,
        total_conversations: totalConversations || 0,
        conversations_this_month: conversationsThisMonth || 0,
        total_orders: totalOrders,
        total_revenue: totalRevenue,
        orders_this_month: ordersThisMonth,
        revenue_this_month: revenueThisMonth,
        total_messages: totalMessages || 0,
        total_products: totalProducts || 0,
        total_knowledge_base: totalKnowledgeBase || 0,
        avg_messages_per_conversation: avgMessagesPerConversation,
        mrr,
        active_subscriptions: activeSubscriptions
      })
    } catch (error: any) {
      console.error('❌ [ADMIN] Error in /overview:', error.message)
      return reply.status(500).send({ error: 'Failed to fetch overview', details: error.message })
    }
  })

  // =========================================
  // GET /users — List all users with enriched data
  // =========================================
  fastify.get('/users', async (request: any, reply) => {
    const denied = verifyAdmin(request, reply)
    if (denied) return denied

    const {
      plan,
      search,
      sort = 'created_at',
      order = 'desc',
      limit = '50',
      offset = '0'
    } = request.query as Record<string, string | undefined>

    const limitNum = Math.min(parseInt(limit || '50', 10) || 50, 200)
    const offsetNum = parseInt(offset || '0', 10) || 0
    const ascending = order === 'asc'

    console.log(`📊 [ADMIN] GET /users plan=${plan} search=${search} sort=${sort} order=${order} limit=${limitNum} offset=${offsetNum}`)

    try {
      // Build shops query
      let query = supabaseServiceClient
        .from('shops')
        .select('*', { count: 'exact' })

      if (plan) {
        query = query.eq('subscription_plan', plan)
      }

      if (search) {
        query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`)
      }

      // Sort — revenue sorting is done post-query
      if (sort === 'name') {
        query = query.order('name', { ascending })
      } else {
        query = query.order('created_at', { ascending })
      }

      query = query.range(offsetNum, offsetNum + limitNum - 1)

      const { data: shops, error: shopsError, count: totalCount } = await query

      if (shopsError) {
        console.error('❌ [ADMIN] Shops query error:', shopsError)
        return reply.status(500).send({ error: 'Failed to fetch shops', details: shopsError.message })
      }

      if (!shops || shops.length === 0) {
        return reply.send({ users: [], total: 0 })
      }

      const shopIds = shops.map(s => s.id)

      // Fetch aggregated data for all shops in batch
      const [conversationsRes, ordersRes, productsRes] = await Promise.all([
        supabaseServiceClient
          .from('conversations')
          .select('shop_id, started_at')
          .in('shop_id', shopIds),
        supabaseServiceClient
          .from('orders')
          .select('shop_id, total_amount')
          .in('shop_id', shopIds),
        supabaseServiceClient
          .from('products')
          .select('shop_id')
          .in('shop_id', shopIds)
      ])

      // Build lookup maps
      const convByShop: Record<string, { count: number; lastDate: string | null }> = {}
      for (const c of (conversationsRes.data || [])) {
        if (!convByShop[c.shop_id]) convByShop[c.shop_id] = { count: 0, lastDate: null }
        convByShop[c.shop_id].count++
        const convDate = c.started_at || (c as any).created_at
        if (convDate && (!convByShop[c.shop_id].lastDate || convDate > convByShop[c.shop_id].lastDate!)) {
          convByShop[c.shop_id].lastDate = convDate
        }
      }

      const ordersByShop: Record<string, { count: number; revenue: number }> = {}
      for (const o of (ordersRes.data || [])) {
        if (!ordersByShop[o.shop_id]) ordersByShop[o.shop_id] = { count: 0, revenue: 0 }
        ordersByShop[o.shop_id].count++
        ordersByShop[o.shop_id].revenue += Number(o.total_amount) || 0
      }

      const productsByShop: Record<string, number> = {}
      for (const p of (productsRes.data || [])) {
        productsByShop[p.shop_id] = (productsByShop[p.shop_id] || 0) + 1
      }

      // Enrich shops
      let users = shops.map(shop => ({
        ...shop,
        conversations_count: convByShop[shop.id]?.count || 0,
        orders_count: ordersByShop[shop.id]?.count || 0,
        products_count: productsByShop[shop.id] || 0,
        total_revenue: ordersByShop[shop.id]?.revenue || 0,
        last_conversation_date: convByShop[shop.id]?.lastDate || null
      }))

      // Sort by revenue if requested (post-query)
      if (sort === 'revenue') {
        users.sort((a, b) => ascending
          ? a.total_revenue - b.total_revenue
          : b.total_revenue - a.total_revenue
        )
      }

      return reply.send({
        users,
        total: totalCount || 0,
        limit: limitNum,
        offset: offsetNum
      })
    } catch (error: any) {
      console.error('❌ [ADMIN] Error in /users:', error.message)
      return reply.status(500).send({ error: 'Failed to fetch users', details: error.message })
    }
  })

  // =========================================
  // GET /users/:id — Detailed user view
  // =========================================
  fastify.get('/users/:id', async (request: any, reply) => {
    const denied = verifyAdmin(request, reply)
    if (denied) return denied

    const { id } = request.params as { id: string }
    console.log(`📊 [ADMIN] GET /users/${id}`)

    try {
      // Shop data
      const { data: shop, error: shopError } = await supabaseServiceClient
        .from('shops')
        .select('*')
        .eq('id', id)
        .single()

      if (shopError || !shop) {
        return reply.status(404).send({ error: 'User not found' })
      }

      // Agent(s)
      const { data: agents } = await supabaseServiceClient
        .from('agents')
        .select('*')
        .eq('shop_id', id)

      // Recent conversations with message count
      const { data: conversations } = await supabaseServiceClient
        .from('conversations')
        .select('id, status, created_at, updated_at')
        .eq('shop_id', id)
        .order('created_at', { ascending: false })
        .limit(10)

      // Enrich conversations with message count
      let enrichedConversations: any[] = []
      if (conversations && conversations.length > 0) {
        const convIds = conversations.map(c => c.id)
        const { data: messages } = await supabaseServiceClient
          .from('messages')
          .select('conversation_id')
          .in('conversation_id', convIds)

        const msgCountByConv: Record<string, number> = {}
        for (const m of (messages || [])) {
          msgCountByConv[m.conversation_id] = (msgCountByConv[m.conversation_id] || 0) + 1
        }

        enrichedConversations = conversations.map(c => ({
          ...c,
          message_count: msgCountByConv[c.id] || 0
        }))
      }

      // Recent orders
      const { data: orders } = await supabaseServiceClient
        .from('orders')
        .select('*')
        .eq('shop_id', id)
        .order('created_at', { ascending: false })
        .limit(5)

      // Products count
      const { count: productsCount } = await supabaseServiceClient
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', id)

      // Knowledge base count
      const { count: kbCount } = await supabaseServiceClient
        .from('knowledge_base')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', id)

      // Stripe subscription details
      let stripeDetails = null
      if (stripe && shop.stripe_customer_id) {
        try {
          const subscriptions = await stripe.subscriptions.list({
            customer: shop.stripe_customer_id,
            limit: 1,
            expand: ['data.items.data.price']
          })

          if (subscriptions.data.length > 0) {
            const sub = subscriptions.data[0]
            stripeDetails = {
              subscription_id: sub.id,
              status: sub.status,
              current_period_end: new Date(((sub as any).current_period_end || 0) * 1000).toISOString(),
              cancel_at_period_end: (sub as any).cancel_at_period_end || false,
              created: new Date(sub.created * 1000).toISOString(),
              plan_name: sub.items.data[0]?.price?.nickname || null,
              plan_amount: sub.items.data[0]?.price?.unit_amount
                ? sub.items.data[0].price.unit_amount / 100
                : null,
              plan_currency: sub.items.data[0]?.price?.currency || null,
              plan_interval: sub.items.data[0]?.price?.recurring?.interval || null
            }
          }
        } catch (stripeErr: any) {
          console.error('⚠️ [ADMIN] Stripe user detail error:', stripeErr.message)
        }
      }

      return reply.send({
        shop,
        agents: agents || [],
        conversations: enrichedConversations,
        orders: orders || [],
        products_count: productsCount || 0,
        knowledge_base_count: kbCount || 0,
        stripe: stripeDetails
      })
    } catch (error: any) {
      console.error('❌ [ADMIN] Error in /users/:id:', error.message)
      return reply.status(500).send({ error: 'Failed to fetch user details', details: error.message })
    }
  })

  // =========================================
  // PUT /users/:id — Admin actions on a user
  // =========================================
  fastify.put('/users/:id', async (request: any, reply) => {
    const denied = verifyAdmin(request, reply)
    if (denied) return denied

    const { id } = request.params as { id: string }
    const body = request.body as {
      subscription_plan?: string
      is_active?: boolean
      trial_ends_at?: string
      onboarding_completed?: boolean
    }

    console.log(`📊 [ADMIN] PUT /users/${id}`, body)

    try {
      // Build update object with only provided fields
      const updateData: Record<string, any> = {}

      if (body.subscription_plan !== undefined) {
        if (!['starter', 'growth', 'performance'].includes(body.subscription_plan)) {
          return reply.status(400).send({ error: 'Invalid subscription_plan. Must be starter, growth, or performance.' })
        }
        updateData.subscription_plan = body.subscription_plan
      }

      if (body.is_active !== undefined) {
        updateData.is_active = body.is_active
      }

      if (body.trial_ends_at !== undefined) {
        const parsed = new Date(body.trial_ends_at)
        if (isNaN(parsed.getTime())) {
          return reply.status(400).send({ error: 'Invalid trial_ends_at date format.' })
        }
        updateData.trial_ends_at = parsed.toISOString()
      }

      if (body.onboarding_completed !== undefined) {
        updateData.onboarding_completed = body.onboarding_completed
      }

      if (Object.keys(updateData).length === 0) {
        return reply.status(400).send({ error: 'No valid fields to update.' })
      }

      updateData.updated_at = new Date().toISOString()

      const { data, error } = await supabaseServiceClient
        .from('shops')
        .update(updateData)
        .eq('id', id)
        .select()
        .single()

      if (error) {
        console.error('❌ [ADMIN] Update shop error:', error)
        return reply.status(500).send({ error: 'Failed to update user', details: error.message })
      }

      if (!data) {
        return reply.status(404).send({ error: 'User not found' })
      }

      console.log(`✅ [ADMIN] User ${id} updated:`, updateData)

      return reply.send({ success: true, shop: data })
    } catch (error: any) {
      console.error('❌ [ADMIN] Error in PUT /users/:id:', error.message)
      return reply.status(500).send({ error: 'Failed to update user', details: error.message })
    }
  })

  // =========================================
  // GET /revenue — Revenue analytics
  // =========================================
  fastify.get('/revenue', async (request: any, reply) => {
    const denied = verifyAdmin(request, reply)
    if (denied) return denied

    console.log('📊 [ADMIN] GET /revenue')

    try {
      const now = new Date()
      const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)

      // --- Stripe data ---
      let stripeMonthlyRevenue: Record<string, number> = {}
      let stripeSubscriptions: any[] = []
      let churnByMonth: Record<string, number> = {}
      let currentMrr = 0

      if (stripe) {
        try {
          // Invoices paid in last 12 months
          const invoices = await stripe.invoices.list({
            status: 'paid',
            created: { gte: Math.floor(twelveMonthsAgo.getTime() / 1000) },
            limit: 100
          })

          for (const inv of invoices.data) {
            const date = new Date(inv.created * 1000)
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
            stripeMonthlyRevenue[monthKey] = (stripeMonthlyRevenue[monthKey] || 0) + (inv.amount_paid / 100)
          }

          // Active subscriptions
          const activeSubs = await stripe.subscriptions.list({
            status: 'active',
            limit: 100,
            expand: ['data.items.data.price', 'data.customer']
          })

          for (const sub of activeSubs.data) {
            const customer = sub.customer as Stripe.Customer
            const price = sub.items.data[0]?.price

            let monthlyAmount = 0
            if (price?.recurring?.interval === 'month') {
              monthlyAmount = (price.unit_amount || 0) / 100
            } else if (price?.recurring?.interval === 'year') {
              monthlyAmount = ((price.unit_amount || 0) / 100) / 12
            }
            currentMrr += monthlyAmount

            stripeSubscriptions.push({
              subscription_id: sub.id,
              status: sub.status,
              customer_email: customer?.email || null,
              plan_name: price?.nickname || null,
              plan_amount: (price?.unit_amount || 0) / 100,
              plan_currency: price?.currency || null,
              plan_interval: price?.recurring?.interval || null,
              created: new Date(sub.created * 1000).toISOString(),
              current_period_end: new Date(((sub as any).current_period_end || 0) * 1000).toISOString()
            })
          }

          currentMrr = Math.round(currentMrr * 100) / 100

          // Churn — cancelled subscriptions in last 6 months
          const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
          const cancelledSubs = await stripe.subscriptions.list({
            status: 'canceled',
            created: { gte: Math.floor(sixMonthsAgo.getTime() / 1000) },
            limit: 100
          })

          for (const sub of cancelledSubs.data) {
            const cancelDate = sub.canceled_at ? new Date(sub.canceled_at * 1000) : new Date(sub.created * 1000)
            const monthKey = `${cancelDate.getFullYear()}-${String(cancelDate.getMonth() + 1).padStart(2, '0')}`
            churnByMonth[monthKey] = (churnByMonth[monthKey] || 0) + 1
          }
        } catch (stripeErr: any) {
          console.error('⚠️ [ADMIN] Stripe revenue error:', stripeErr.message)
        }
      }

      // --- Supabase orders by month ---
      const { data: allOrders } = await supabaseServiceClient
        .from('orders')
        .select('total_amount, currency, created_at')
        .gte('created_at', twelveMonthsAgo.toISOString())

      const ordersByMonth: Record<string, Record<string, { count: number; total: number }>> = {}
      for (const order of (allOrders || [])) {
        const date = new Date(order.created_at)
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        const currency = order.currency || 'FCFA'

        if (!ordersByMonth[monthKey]) ordersByMonth[monthKey] = {}
        if (!ordersByMonth[monthKey][currency]) ordersByMonth[monthKey][currency] = { count: 0, total: 0 }

        ordersByMonth[monthKey][currency].count++
        ordersByMonth[monthKey][currency].total += Number(order.total_amount) || 0
      }

      return reply.send({
        mrr: currentMrr,
        stripe_monthly_revenue: stripeMonthlyRevenue,
        stripe_subscriptions: stripeSubscriptions,
        churn_by_month: churnByMonth,
        orders_by_month: ordersByMonth
      })
    } catch (error: any) {
      console.error('❌ [ADMIN] Error in /revenue:', error.message)
      return reply.status(500).send({ error: 'Failed to fetch revenue data', details: error.message })
    }
  })

  // =========================================
  // GET /activity — Recent activity feed
  // =========================================
  fastify.get('/activity', async (request: any, reply) => {
    const denied = verifyAdmin(request, reply)
    if (denied) return denied

    console.log('📊 [ADMIN] GET /activity')

    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

      // Fetch all three event types in parallel
      const [signupsRes, conversationsRes, ordersRes] = await Promise.all([
        supabaseServiceClient
          .from('shops')
          .select('id, name, email, created_at')
          .gte('created_at', sevenDaysAgo)
          .order('created_at', { ascending: false }),

        supabaseServiceClient
          .from('conversations')
          .select('id, shop_id, created_at')
          .gte('created_at', sevenDaysAgo)
          .order('created_at', { ascending: false })
          .limit(100),

        supabaseServiceClient
          .from('orders')
          .select('id, shop_id, total_amount, currency, customer_name, created_at')
          .gte('created_at', sevenDaysAgo)
          .order('created_at', { ascending: false })
          .limit(100)
      ])

      // Build shop name lookup for conversations and orders
      const shopIdsNeeded = new Set<string>()
      for (const c of (conversationsRes.data || [])) shopIdsNeeded.add(c.shop_id)
      for (const o of (ordersRes.data || [])) shopIdsNeeded.add(o.shop_id)

      let shopNames: Record<string, string> = {}
      // Also add signups shop names
      for (const s of (signupsRes.data || [])) {
        shopNames[s.id] = s.name || s.email
      }

      const missingIds = [...shopIdsNeeded].filter(id => !shopNames[id])
      if (missingIds.length > 0) {
        const { data: shopData } = await supabaseServiceClient
          .from('shops')
          .select('id, name, email')
          .in('id', missingIds)

        for (const s of (shopData || [])) {
          shopNames[s.id] = s.name || s.email
        }
      }

      // Combine into unified activity feed
      const activities: Array<{
        type: string
        timestamp: string
        description: string
        metadata: Record<string, any>
      }> = []

      for (const s of (signupsRes.data || [])) {
        activities.push({
          type: 'signup',
          timestamp: s.created_at,
          description: `Nouvelle inscription : ${s.name || s.email}`,
          metadata: { shop_id: s.id, email: s.email, name: s.name }
        })
      }

      for (const c of (conversationsRes.data || [])) {
        const shopName = shopNames[c.shop_id] || c.shop_id
        activities.push({
          type: 'conversation',
          timestamp: c.created_at,
          description: `Nouvelle conversation pour ${shopName}`,
          metadata: { conversation_id: c.id, shop_id: c.shop_id, shop_name: shopName }
        })
      }

      for (const o of (ordersRes.data || [])) {
        const shopName = shopNames[o.shop_id] || o.shop_id
        const amount = Number(o.total_amount) || 0
        const currency = o.currency || 'FCFA'
        activities.push({
          type: 'order',
          timestamp: o.created_at,
          description: `Commande de ${o.customer_name || 'Client'} pour ${shopName} — ${amount.toLocaleString('fr-FR')} ${currency}`,
          metadata: {
            order_id: o.id,
            shop_id: o.shop_id,
            shop_name: shopName,
            amount,
            currency,
            customer_name: o.customer_name
          }
        })
      }

      // Sort by timestamp desc, take first 50
      activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

      return reply.send({
        activities: activities.slice(0, 50),
        total: activities.length
      })
    } catch (error: any) {
      console.error('❌ [ADMIN] Error in /activity:', error.message)
      return reply.status(500).send({ error: 'Failed to fetch activity', details: error.message })
    }
  })
}

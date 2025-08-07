// =====================================
// SERVER.TS COMPLET - IMPORT DES ROUTES EXISTANTES
// =====================================

import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { PrismaClient } from '@prisma/client'
import dotenv from 'dotenv'

// ✅ IMPORT DES NOUVEAUX MODULES SUPABASE
import { supabaseServiceClient, supabaseAuthClient, testSupabaseConnection } from './lib/supabase'
import { authenticate, optionalAuthenticate } from './middleware/auth'

// ✅ IMPORT DE TOUTES LES ROUTES EXISTANTES
import billingRoutes from './routes/billing'
import agentsRoutes from './routes/agents' 
import productsRoutes from './routes/products'
import publicRoutes from './routes/public' 
import ordersRoutes from './routes/orders'
import shopsRoutes from './routes/shops'
import knowledgeBaseRoutes from './routes/knowledge-base'
import chatRoutes from './routes/chat'

// Load environment variables
dotenv.config()

// ✅ VALIDATION VARIABLES D'ENVIRONNEMENT
const requiredEnvVars = {
  DATABASE_URL: process.env.DATABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY 
}

for (const [key, value] of Object.entries(requiredEnvVars)) {
  if (!value) {
    console.error(`❌ Variable d'environnement manquante: ${key}`)
    process.exit(1)
  }
}

console.log('✅ Variables d\'environnement validées')

// Initialize Prisma client
const prisma = new PrismaClient({
  log: ['error', 'warn'],
})

// Create Fastify instance
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development' ? {
      target: 'pino-pretty',
      options: {
        colorize: true
      }
    } : undefined
  }
})

// Register plugins
async function registerPlugins() {
  // Security
  await fastify.register(helmet, {
    contentSecurityPolicy: false
  })

  // ✅ CORS OPTIMISÉ POUR LE WIDGET
  await fastify.register(cors, {
    origin: (origin, callback) => {
      // ✅ IMPORTANT: Autoriser tous les domaines pour le widget embeddable
      callback(null, true)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  })

  // ✅ RATE LIMITING ADAPTÉ AU WIDGET
  await fastify.register(rateLimit, {
    max: parseInt(process.env.RATE_LIMIT_MAX || '200'),
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60000'),
    keyGenerator: (request) => {
      return `${request.ip}-${request.headers['user-agent']?.slice(0, 50) || 'unknown'}`
    }
  })
}

// Routes
async function registerRoutes() {
  
  // ✅ HEALTH CHECK AVEC TEST SUPABASE CORRIGÉ
  fastify.get('/health', async (request, reply) => {
    const healthData = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services: {
        database: 'checking...',
        openai: 'checking...',
        supabase: 'checking...'
      }
    }

    // Test base de données Prisma
    try {
      await prisma.$queryRaw`SELECT 1`
      healthData.services.database = 'ok'
    } catch (error) {
      console.error('❌ Database health check failed:', error)
      healthData.services.database = 'error'
      healthData.status = 'degraded'
    }

    // Test OpenAI
    healthData.services.openai = process.env.OPENAI_API_KEY ? 'configured' : 'not_configured'

    // ✅ TEST SUPABASE AVEC NOUVELLE FONCTION
    const supabaseTest = await testSupabaseConnection()
    healthData.services.supabase = supabaseTest.success ? 'ok' : 'error'
    
    if (!supabaseTest.success) {
      console.error('❌ Supabase health check failed:', supabaseTest.error)
      healthData.status = 'degraded'
    }

    return healthData
  })

  // ✅ ROUTE RACINE
  fastify.get('/', async (request, reply) => {
    return {
      success: true,
      message: 'ChatSeller API is running',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      endpoints: {
        health: '/health',
        billing: '/api/v1/billing/*',
        agents: '/api/v1/agents/*',
        products: '/api/v1/products/*',
        orders: '/api/v1/orders/*',
        conversations: '/api/v1/conversations/*',
        analytics: '/api/v1/analytics/*',
        knowledgeBase: '/api/v1/knowledge-base/*',
        shops: '/api/v1/shops/*',
        public: '/api/v1/public/*',
        chat: '/api/v1/chat/*'
      }
    }
  })

  // ✅ ROUTES PUBLIQUES (SANS AUTHENTIFICATION)
  fastify.register(async function (fastify) {
    await fastify.register(rateLimit, {
      max: 300,
      timeWindow: '1 minute'
    })

    // Routes publiques pour le widget
    fastify.register(publicRoutes)
    
    fastify.log.info('✅ Routes publiques enregistrées: /api/v1/public/*')
    
  }, { prefix: '/api/v1/public' })

  // ✅ ROUTES BILLING (SANS AUTHENTIFICATION - Stripe webhooks)
  fastify.register(billingRoutes, { prefix: '/api/v1/billing' })
  fastify.log.info('✅ Routes billing enregistrées: /api/v1/billing/*')

  // ✅ ROUTES D'AUTHENTIFICATION PUBLIQUES
  fastify.register(async function (fastify) {
    // Route de login
    fastify.post('/login', async (request, reply) => {
      const { email, password } = request.body as any
      
      try {
        const { data, error } = await supabaseAuthClient.auth.signInWithPassword({
          email,
          password,
        })

        if (error) throw error

        return {
          success: true,
          user: data.user,
          session: data.session
        }
      } catch (error: any) {
        return reply.status(401).send({
          success: false,
          error: error.message || 'Erreur de connexion'
        })
      }
    })

    // Route de signup
    fastify.post('/signup', async (request, reply) => {
      const { email, password, metadata } = request.body as any
      
      try {
        const { data, error } = await supabaseAuthClient.auth.signUp({
          email,
          password,
          options: {
            data: metadata
          }
        })

        if (error) throw error

        return {
          success: true,
          user: data.user,
          session: data.session
        }
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: error.message || 'Erreur lors de l\'inscription'
        })
      }
    })
  }, { prefix: '/api/v1/auth' })

  // ✅ ROUTES API AVEC AUTHENTIFICATION
  fastify.register(async function (fastify) {
    
    // ✅ MIDDLEWARE D'AUTH POUR TOUTES LES ROUTES API PROTÉGÉES
    fastify.addHook('preHandler', authenticate)
    
    // ✅ ROUTES AGENTS
    fastify.register(agentsRoutes, { prefix: '/agents' })
    fastify.log.info('✅ Routes agents enregistrées: /api/v1/agents/*')

    // ✅ ROUTES PRODUITS 
    fastify.register(productsRoutes, { prefix: '/products' })
    fastify.log.info('✅ Routes produits enregistrées: /api/v1/products/*')
    
    // ✅ ROUTES COMMANDES
    fastify.register(ordersRoutes, { prefix: '/orders' })
    fastify.log.info('✅ Routes commandes enregistrées: /api/v1/orders/*')

    // ✅ ROUTES SHOPS
    fastify.register(shopsRoutes, { prefix: '/shops' })
    fastify.log.info('✅ Routes shops enregistrées: /api/v1/shops/*')

    // ✅ ROUTES KNOWLEDGE BASE
    fastify.register(knowledgeBaseRoutes, { prefix: '/knowledge-base' })
    fastify.log.info('✅ Routes knowledge-base enregistrées: /api/v1/knowledge-base/*')

    // ✅ ROUTES CHAT
    fastify.register(chatRoutes, { prefix: '/chat' })
    fastify.log.info('✅ Routes chat enregistrées: /api/v1/chat/*')
    
    // ✅ ROUTES CONVERSATIONS INTÉGRÉES
    fastify.register(async function (fastify) {
      // Create conversation
      fastify.post('/', async (request, reply) => {
        const { 
          shopId, 
          visitorId, 
          productId, 
          productName, 
          productPrice,
          productUrl 
        } = request.body as any

        try {
          const conversation = await prisma.conversation.create({
            data: {
              shopId,
              visitorId,
              productId,
              productName,
              productPrice,
              productUrl,
              visitorIp: request.ip,
              visitorUserAgent: request.headers['user-agent']
            }
          })

          return {
            success: true,
            data: conversation
          }
        } catch (error) {
          fastify.log.error(error)
          return reply.status(500).send({ 
            success: false,
            error: 'Failed to create conversation' 
          })
        }
      })

      // Get conversation
      fastify.get('/:conversationId', async (request, reply) => {
        const { conversationId } = request.params as { conversationId: string }

        try {
          const conversation = await prisma.conversation.findFirst({
            where: { 
              id: conversationId,
              shopId: request.user!.shopId 
            }
          })

          if (!conversation) {
            return reply.status(404).send({ 
              success: false,
              error: 'Conversation not found' 
            })
          }

          const messages = await prisma.message.findMany({
            where: { conversationId },
            orderBy: { createdAt: 'asc' }
          })

          const shop = await prisma.shop.findUnique({
            where: { id: conversation.shopId },
            select: {
              name: true,
              agent_config: true
            }
          })

          return {
            success: true,
            data: {
              ...conversation,
              messages,
              shop
            }
          }
        } catch (error) {
          fastify.log.error(error)
          return reply.status(500).send({ 
            success: false,
            error: 'Internal server error' 
          })
        }
      })

      // Liste des conversations
      fastify.get('/', async (request, reply) => {
        const { page = 1, limit = 20 } = request.query as any
        
        try {
          if (!request.user) {
            return reply.status(401).send({ 
              success: false,
              error: 'User not authenticated' 
            })
          }

          const conversations = await prisma.conversation.findMany({
            where: {
              shopId: request.user.shopId
            },
            include: {
              messages: {
                orderBy: { createdAt: 'desc' },
                take: 1
              }
            },
            orderBy: { startedAt: 'desc' },
            skip: (page - 1) * limit,
            take: parseInt(limit)
          })

          const total = await prisma.conversation.count({
            where: {
              shopId: request.user.shopId
            }
          })

          return {
            success: true,
            data: conversations,
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total,
              pages: Math.ceil(total / limit)
            }
          }

        } catch (error) {
          fastify.log.error(error)
          return reply.status(500).send({ 
            success: false,
            error: 'Internal server error' 
          })
        }
      })
    }, { prefix: '/conversations' })
    
    fastify.log.info('✅ Routes conversations enregistrées: /api/v1/conversations/*')

  }, { prefix: '/api/v1' })

  // ✅ ROUTE DE FALLBACK POUR DEBUG
  fastify.setNotFoundHandler(async (request, reply) => {
    fastify.log.warn(`🔍 Route non trouvée: ${request.method} ${request.url}`)
    return reply.status(404).send({
      success: false,
      error: 'Route not found',
      method: request.method,
      url: request.url,
      message: `Route ${request.method} ${request.url} not found`,
      availableRoutes: [
        'GET /health',
        'GET /',
        'GET /api/v1/billing/*',
        'POST /api/v1/billing/*',
        'GET /api/v1/agents/*',
        'POST /api/v1/agents/*',
        'GET /api/v1/products/*',
        'POST /api/v1/products/*',
        'GET /api/v1/orders/*',
        'POST /api/v1/orders/*',
        'GET /api/v1/conversations/*',
        'POST /api/v1/conversations/*',
        'GET /api/v1/analytics/*',
        'GET /api/v1/knowledge-base/*',
        'POST /api/v1/knowledge-base/*',
        'GET /api/v1/shops/*',
        'POST /api/v1/auth/login',
        'POST /api/v1/auth/signup',
        'GET /api/v1/public/*',
        'POST /api/v1/public/*'
      ]
    })
  })
}

// Graceful shutdown
async function gracefulShutdown() {
  try {
    await prisma.$disconnect()
    await fastify.close()
    process.exit(0)
  } catch (error) {
    fastify.log.error(error)
    process.exit(1)
  }
}

// Start server
async function start() {
  try {
    // ✅ TEST CONNEXION SUPABASE AU DÉMARRAGE
    console.log('🔧 Test de connexion Supabase...')
    const supabaseTest = await testSupabaseConnection()
    
    if (!supabaseTest.success) {
      console.error('❌ ERREUR CRITIQUE: Impossible de se connecter à Supabase')
      console.error('🔍 Vérifiez vos variables SUPABASE_URL et SUPABASE_SERVICE_KEY')
      process.exit(1)
    }
    
    console.log('✅ Connexion Supabase: OK')

    await registerPlugins()
    await registerRoutes()

    const port = parseInt(process.env.PORT || '3001')
    const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost'

    await fastify.listen({ port, host })
    
    console.log(`🚀 ChatSeller API running on http://${host}:${port}`)
    console.log(`📖 Health check: http://${host}:${port}/health`)
    console.log(`🏠 Root: http://${host}:${port}/`)
    console.log(`💳 Billing routes: http://${host}:${port}/api/v1/billing/*`)
    console.log(`🤖 Agents routes: http://${host}:${port}/api/v1/agents/*`)
    console.log(`📦 Products routes: http://${host}:${port}/api/v1/products/*`)
    console.log(`🛒 Orders routes: http://${host}:${port}/api/v1/orders/*`)
    console.log(`💬 Conversations routes: http://${host}:${port}/api/v1/conversations/*`)
    console.log(`📊 Analytics routes: http://${host}:${port}/api/v1/analytics/*`)
    console.log(`📚 Knowledge Base: http://${host}:${port}/api/v1/knowledge-base/*`)
    console.log(`🏪 Shops routes: http://${host}:${port}/api/v1/shops/*`)
    console.log(`🌐 Public routes: http://${host}:${port}/api/v1/public/*`)
    console.log(`💭 Chat routes: http://${host}:${port}/api/v1/chat/*`)
    console.log(`🔐 Auth routes: http://${host}:${port}/api/v1/auth/*`)
    
  } catch (error) {
    fastify.log.error(error)
    process.exit(1)
  }
}

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown)

// Start the server
start()
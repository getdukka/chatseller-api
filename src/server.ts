// =====================================
// SERVER.TS CORRIGÉ - SINGLETON PRISMA
// =====================================

import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import dotenv from 'dotenv'

// ✅ IMPORT DU SINGLETON PRISMA - PLUS D'INSTANCE MULTIPLE
import prisma, { testDatabaseConnection, getConnectionStatus } from './lib/prisma'

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
import conversationsRoutes from './routes/conversations'
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

  // ✅ CORS OPTIMISÉ POUR LE WIDGET EMBEDDABLE - CRITIQUE
  await fastify.register(cors, {
    origin: (origin, callback) => {
      // ✅ IMPORTANT: Autoriser tous les domaines pour le widget embeddable
      callback(null, true)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
  })

  // ✅ RATE LIMITING ADAPTÉ AU WIDGET
  await fastify.register(rateLimit, {
    max: parseInt(process.env.RATE_LIMIT_MAX || '300'),
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60000'),
    keyGenerator: (request) => {
      return `${request.ip}-${request.headers['user-agent']?.slice(0, 50) || 'unknown'}`
    }
  })
}

// Routes
async function registerRoutes() {
  
  // ✅ HEALTH CHECK CORRIGÉ SANS PREPARED STATEMENTS
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

    // ✅ TEST DATABASE AVEC NOUVELLE MÉTHODE SANS CONFLITS
    try {
      const dbStatus = await testDatabaseConnection()
      healthData.services.database = dbStatus.success ? 'ok' : 'error'
      
      if (!dbStatus.success) {
        console.error('❌ Database health check failed:', dbStatus.error)
        healthData.status = 'degraded'
      }
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
      version: '1.3.0',
      timestamp: new Date().toISOString(),
      endpoints: {
        health: '/health',
        public: '/api/v1/public/* (NO AUTH)',
        billing: '/api/v1/billing/* (NO AUTH - webhooks)',
        auth: '/api/v1/auth/* (NO AUTH - auth endpoints)',
        agents: '/api/v1/agents/* (PROTECTED)',
        products: '/api/v1/products/* (PROTECTED)',
        orders: '/api/v1/orders/* (PROTECTED)',
        conversations: '/api/v1/conversations/* (PROTECTED)',
        knowledgeBase: '/api/v1/knowledge-base/* (PROTECTED)',
        shops: '/api/v1/shops/* (PROTECTED)',
        chat: '/api/v1/chat/* (PROTECTED)'
      }
    }
  })

  // ✅ CRITIQUE : ROUTES PUBLIQUES EN PREMIER (SANS AUTHENTIFICATION)
  fastify.register(async function (fastify) {
    // ✅ RATE LIMITING SPÉCIFIQUE POUR LE WIDGET PUBLIC
    await fastify.register(rateLimit, {
      max: 500, // Plus permissif pour le widget public
      timeWindow: '1 minute',
      keyGenerator: (request) => {
        // Identifier par IP + shopId pour éviter les abus
        const shopId = (request.params as any)?.shopId || (request.body as any)?.shopId || 'unknown'
        return `public-${request.ip}-${shopId}`
      }
    })

    // ✅ ENREGISTRER LES ROUTES PUBLIQUES SANS AUTH
    fastify.register(publicRoutes)
    
    fastify.log.info('✅ Routes publiques enregistrées SANS AUTH: /api/v1/public/*')
    
  }, { prefix: '/api/v1/public' })

  // ✅ ROUTES BILLING (SANS AUTHENTIFICATION - Stripe webhooks)
  fastify.register(async function (fastify) {
    await fastify.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute'
    })
    
    fastify.register(billingRoutes)
    fastify.log.info('✅ Routes billing enregistrées SANS AUTH: /api/v1/billing/*')
    
  }, { prefix: '/api/v1/billing' })

  // ✅ ROUTES D'AUTHENTIFICATION PUBLIQUES (SANS AUTH)
  fastify.register(async function (fastify) {
    
    await fastify.register(rateLimit, {
      max: 50,
      timeWindow: '1 minute'
    })
    
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
    
    fastify.log.info('✅ Routes auth enregistrées SANS AUTH: /api/v1/auth/*')
    
  }, { prefix: '/api/v1/auth' })

  // ✅ ROUTES API AVEC AUTHENTIFICATION OBLIGATOIRE
  fastify.register(async function (fastify) {
    
    // ✅ MIDDLEWARE D'AUTH POUR TOUTES LES ROUTES API PROTÉGÉES
    fastify.addHook('preHandler', authenticate)
    
    // ✅ ROUTES AGENTS
    fastify.register(agentsRoutes, { prefix: '/agents' })
    fastify.log.info('✅ Routes agents enregistrées AVEC AUTH: /api/v1/agents/*')

    // ✅ ROUTES PRODUITS 
    fastify.register(productsRoutes, { prefix: '/products' })
    fastify.log.info('✅ Routes produits enregistrées AVEC AUTH: /api/v1/products/*')
    
    // ✅ ROUTES COMMANDES
    fastify.register(ordersRoutes, { prefix: '/orders' })
    fastify.log.info('✅ Routes commandes enregistrées AVEC AUTH: /api/v1/orders/*')

    // ✅ ROUTES SHOPS
    fastify.register(shopsRoutes, { prefix: '/shops' })
    fastify.log.info('✅ Routes shops enregistrées AVEC AUTH: /api/v1/shops/*')

    // ✅ ROUTES KNOWLEDGE BASE
    fastify.register(knowledgeBaseRoutes, { prefix: '/knowledge-base' })
    fastify.log.info('✅ Routes knowledge-base enregistrées AVEC AUTH: /api/v1/knowledge-base/*')

    // ✅ ROUTES CONVERSATIONS
    fastify.register(conversationsRoutes, { prefix: '/conversations' })
    fastify.log.info('✅ Routes conversations enregistrées AVEC AUTH: /api/v1/conversations/*')

    // ✅ ROUTES CHAT INTERNE (pour le dashboard)
    fastify.register(chatRoutes, { prefix: '/chat' })
    fastify.log.info('✅ Routes chat enregistrées AVEC AUTH: /api/v1/chat/*')

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
        'POST /api/v1/auth/login (NO AUTH)',
        'POST /api/v1/auth/signup (NO AUTH)',
        'GET /api/v1/public/shops/public/:shopId/config (NO AUTH)',
        'POST /api/v1/public/chat (NO AUTH)',
        'POST /api/v1/billing/* (NO AUTH - webhooks)',
        'GET /api/v1/agents/* (PROTECTED)',
        'POST /api/v1/agents/* (PROTECTED)',
        'GET /api/v1/products/* (PROTECTED)',
        'POST /api/v1/products/* (PROTECTED)',
        'GET /api/v1/orders/* (PROTECTED)',
        'POST /api/v1/orders/* (PROTECTED)',
        'GET /api/v1/conversations/* (PROTECTED)',
        'POST /api/v1/conversations/* (PROTECTED)',
        'GET /api/v1/knowledge-base/* (PROTECTED)',
        'POST /api/v1/knowledge-base/* (PROTECTED)',
        'GET /api/v1/shops/* (PROTECTED)',
        'POST /api/v1/chat/* (PROTECTED)'
      ]
    })
  })
}

// ✅ GRACEFUL SHUTDOWN AMÉLIORÉ
async function gracefulShutdown() {
  try {
    console.log('🛑 Arrêt du serveur en cours...')
    
    // Fermer les connexions Prisma proprement
    await prisma.$disconnect()
    console.log('✅ Connexions Prisma fermées')
    
    // Fermer Fastify
    await fastify.close()
    console.log('✅ Serveur Fastify fermé')
    
    process.exit(0)
  } catch (error) {
    console.error('❌ Erreur lors de l\'arrêt:', error)
    process.exit(1)
  }
}

// Start server
async function start() {
  try {
    // ✅ TEST CONNEXION DATABASE AVANT DÉMARRAGE
    console.log('🔧 Test de connexion base de données...')
    const dbStatus = await testDatabaseConnection()
    
    if (!dbStatus.success) {
      console.error('❌ ERREUR CRITIQUE: Impossible de se connecter à la base de données')
      console.error('🔍 Vérifiez votre DATABASE_URL')
      console.error('📋 Erreur:', dbStatus.error)
      process.exit(1)
    }
    
    console.log('✅ Connexion base de données: OK')

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
    const host = '0.0.0.0'

    console.log('🚀 === DÉMARRAGE RAILWAY DEBUG ===')
    console.log('📊 Environment:', process.env.NODE_ENV)
    console.log('🌐 Host forcé à:', host)
    console.log('🔌 Port:', port)
    console.log('💾 Database URL présent:', !!process.env.DATABASE_URL)
    console.log('🔗 Database URL preview:', process.env.DATABASE_URL?.substring(0, 80) + '...')
    console.log('================================')

    await fastify.listen({ port, host })
    
    console.log(`🚀 ChatSeller API running on http://${host}:${port}`)
    console.log(`📖 Health check: http://${host}:${port}/health`)
    console.log(`🏠 Root: http://${host}:${port}/`)
    console.log('')
    console.log('📌 ROUTES PUBLIQUES (sans authentification):')
    console.log(`   🌐 Config shop: GET /api/v1/public/shops/public/:shopId/config`)
    console.log(`   💬 Chat widget: POST /api/v1/public/chat`)
    console.log(`   💳 Billing webhooks: POST /api/v1/billing/*`)
    console.log(`   🔐 Auth: POST /api/v1/auth/login | /api/v1/auth/signup`)
    console.log('')
    console.log('🔒 ROUTES PROTÉGÉES (avec authentification):')
    console.log(`   🤖 Agents: /api/v1/agents/*`)
    console.log(`   📦 Products: /api/v1/products/*`)
    console.log(`   🛒 Orders: /api/v1/orders/*`)
    console.log(`   💬 Conversations: /api/v1/conversations/*`)
    console.log(`   📚 Knowledge Base: /api/v1/knowledge-base/*`)
    console.log(`   🏪 Shops: /api/v1/shops/*`)
    console.log(`   💭 Chat interne: /api/v1/chat/*`)
    
  } catch (error) {
    fastify.log.error(error)
    process.exit(1)
  }
}

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown)

// ✅ GESTION D'ERREURS NON CAPTURÉES
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error)
  gracefulShutdown()
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason)
  gracefulShutdown()
})

// Start the server
start()
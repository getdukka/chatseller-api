// =====================================
// SERVER.TS - VERSION SUPABASE PURE
// =====================================

import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import dotenv from 'dotenv'

// ✅ IMPORT UNIQUEMENT SUPABASE
import { supabaseServiceClient, supabaseAuthClient, testSupabaseConnection } from './lib/supabase'
import { authenticate, optionalAuthenticate } from './middleware/auth'

// ✅ IMPORT DES ROUTES
import billingRoutes from './routes/billing'
import agentsRoutes from './routes/agents' 
import productsRoutes from './routes/products'
import publicRoutes from './routes/public' 
import ordersRoutes from './routes/orders'
import shopsRoutes from './routes/shops'
import supportRoutes from './routes/support'
import knowledgeBaseRoutes from './routes/knowledge-base'
import conversationsRoutes from './routes/conversations'
import chatRoutes from './routes/chat'

// Load environment variables
dotenv.config()

// ✅ VALIDATION VARIABLES D'ENVIRONNEMENT (SANS PRISMA)
const requiredEnvVars = {
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

console.log('✅ Variables d\'environnement validées (Supabase)')

// ✅ CREATE FASTIFY INSTANCE SIMPLIFIÉ
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info'
  },
  trustProxy: true,
  requestTimeout: 30000,
  keepAliveTimeout: 65000,
  bodyLimit: 10 * 1024 * 1024
})

// ✅ GESTION GLOBALE DES ERREURS
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error)
  fastify.log.fatal(error, 'Uncaught Exception')
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason)
  fastify.log.fatal({ reason, promise }, 'Unhandled Rejection')
  process.exit(1)
})

// ✅ GESTION ERREURS FASTIFY
fastify.setErrorHandler(async (error, request, reply) => {
  fastify.log.error(error, `Error handling request ${request.method} ${request.url}`)
  
  const statusCode = error.statusCode || 500
  
  return reply.status(statusCode).send({
    success: false,
    error: statusCode >= 500 ? 'Erreur interne du serveur' : error.message,
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  })
})

// Register plugins
async function registerPlugins() {
  try {
    await fastify.register(helmet, {
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    })

    // ✅ CORS OPTIMISÉ POUR WIDGET EMBEDDABLE
    await fastify.register(cors, {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: [
        'Content-Type', 
        'Authorization', 
        'X-Requested-With', 
        'Accept',
        'Origin',
        'X-Auth-Token'
      ]
    })

    await fastify.register(rateLimit, {
      max: 500,
      timeWindow: '1 minute',
      keyGenerator: (request) => `${request.ip}-${request.headers['user-agent']?.slice(0, 50) || 'unknown'}`,
      errorResponseBuilder: (request, context) => ({
        success: false,
        error: 'Trop de requêtes',
        retryAfter: context.after
      })
    })

    console.log('✅ Plugins Fastify enregistrés')

  } catch (error) {
    console.error('❌ Erreur enregistrement plugins:', error)
    throw error
  }
}

// ✅ GESTION OPTIONS GLOBALE
fastify.addHook('onRequest', async (request, reply) => {
  if (request.method === 'OPTIONS') {
    reply.header('Access-Control-Allow-Origin', '*')
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH')
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin')
    reply.header('Access-Control-Max-Age', '86400')
    return reply.status(200).send()
  }
})

// ✅ HEALTH CHECK SIMPLE POUR SUPABASE
async function simpleSupabaseCheck(): Promise<boolean> {
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
      headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY! },
      signal: AbortSignal.timeout(5000)
    })
    return response.ok
  } catch {
    return false
  }
}

// Routes
async function registerRoutes() {
  try {
    
    // ✅ HEALTH CHECK ULTRA-SIMPLE
    fastify.get('/health', async (request, reply) => {
      return reply.status(200).send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.4.0',
        environment: process.env.NODE_ENV || 'development',
        uptime: Math.round(process.uptime()),
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
      })
    })

    // ✅ HEALTH CHECK AVEC SUPABASE (ROUTE SÉPARÉE)
    fastify.get('/health/supabase', async (request, reply) => {
      const healthData = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          supabase: 'checking...'
        }
      }

      try {
        const supabaseOk = await simpleSupabaseCheck()
        healthData.services.supabase = supabaseOk ? 'ok' : 'error'
      } catch {
        healthData.services.supabase = 'error'
      }

      return reply.status(200).send(healthData)
    })

    // ✅ ROUTE RACINE
    fastify.get('/', async (request, reply) => {
      return {
        success: true,
        message: 'ChatSeller API is running (Supabase)',
        version: '1.4.0',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        database: 'Supabase',
        endpoints: {
          health: '/health',
          healthSupabase: '/health/supabase',
          public: '/api/v1/public/*',
          billing: '/api/v1/billing/*',
          auth: '/api/v1/auth/*'
        }
      }
    })

    // ✅ ROUTES PUBLIQUES (CRITICAL POUR LE WIDGET)
    await fastify.register(async function (fastify) {
      await fastify.register(rateLimit, {
        max: 1000,
        timeWindow: '1 minute',
        keyGenerator: (request) => {
          const shopId = (request.params as any)?.shopId || (request.body as any)?.shopId || 'unknown'
          return `public-${request.ip}-${shopId}`
        }
      })
      await fastify.register(publicRoutes)
      
      // ✅ AJOUTER CETTE LIGNE POUR LE SUPPORT
      await fastify.register(supportRoutes, { prefix: '/support' })
      
      fastify.log.info('✅ Routes publiques enregistrées: /api/v1/public/*')
    }, { prefix: '/api/v1/public' })

    // ✅ ROUTES PUBLIQUES (CRITICAL POUR LE WIDGET)
    await fastify.register(async function (fastify) {
      await fastify.register(rateLimit, {
        max: 1000,
        timeWindow: '1 minute',
        keyGenerator: (request) => {
          const shopId = (request.params as any)?.shopId || (request.body as any)?.shopId || 'unknown'
          return `public-${request.ip}-${shopId}`
        }
      })
      await fastify.register(publicRoutes)
      fastify.log.info('✅ Routes publiques enregistrées: /api/v1/public/*')
    }, { prefix: '/api/v1/public' })

    // ✅ ROUTES BILLING
    await fastify.register(async function (fastify) {
      await fastify.register(rateLimit, { max: 200, timeWindow: '1 minute' })
      await fastify.register(billingRoutes)
      fastify.log.info('✅ Routes billing enregistrées: /api/v1/billing/*')
    }, { prefix: '/api/v1/billing' })

    // ✅ ROUTES D'AUTHENTIFICATION
    await fastify.register(async function (fastify) {
      await fastify.register(rateLimit, { max: 100, timeWindow: '1 minute' })
      
      fastify.post('/login', async (request, reply) => {
        try {
          const { email, password } = request.body as any
          
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

      fastify.post('/signup', async (request, reply) => {
        try {
          const { email, password, metadata } = request.body as any
          
          const { data, error } = await supabaseAuthClient.auth.signUp({
            email,
            password,
            options: { data: metadata }
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
      
      fastify.log.info('✅ Routes auth enregistrées: /api/v1/auth/*')
    }, { prefix: '/api/v1/auth' })

    // ✅ ROUTES API AVEC AUTHENTIFICATION
    await fastify.register(async function (fastify) {
      fastify.addHook('preHandler', authenticate)
      
      await fastify.register(agentsRoutes, { prefix: '/agents' })
      await fastify.register(productsRoutes, { prefix: '/products' })
      await fastify.register(ordersRoutes, { prefix: '/orders' })
      await fastify.register(shopsRoutes, { prefix: '/shops' })
      await fastify.register(knowledgeBaseRoutes, { prefix: '/knowledge-base' })
      await fastify.register(conversationsRoutes, { prefix: '/conversations' })
      await fastify.register(chatRoutes, { prefix: '/chat' })

      fastify.log.info('✅ Routes protégées enregistrées avec succès')
    }, { prefix: '/api/v1' })

    // ✅ FALLBACK 404
    fastify.setNotFoundHandler(async (request, reply) => {
      return reply.status(404).send({
        success: false,
        error: 'Route not found',
        method: request.method,
        url: request.url,
        availableEndpoints: [
          'GET /health',
          'GET /health/supabase',
          'GET /',
          'GET /api/v1/public/shops/public/:shopId/config',
          'POST /api/v1/public/chat'
        ]
      })
    })

    console.log('✅ Routes enregistrées avec succès')

  } catch (error) {
    console.error('❌ Erreur enregistrement routes:', error)
    throw error
  }
}

// ✅ GRACEFUL SHUTDOWN SIMPLIFIÉ
async function gracefulShutdown(signal: string) {
  try {
    console.log(`🛑 Arrêt du serveur (${signal}) en cours...`)
    
    await fastify.close()
    console.log('✅ Serveur Fastify fermé')
    
    process.exit(0)
  } catch (error) {
    console.error('❌ Erreur lors de l\'arrêt:', error)
    process.exit(1)
  }
}

// ✅ START SERVER FUNCTION SIMPLIFIÉE
async function start() {
  try {
    console.log('🚀 === DÉMARRAGE CHATSELLER API v1.4.0 (SUPABASE) ===')
    console.log('📊 Environment:', process.env.NODE_ENV)
    console.log('🗄️ Database: Supabase')

    const port = parseInt(process.env.PORT || '3001', 10)
    const host = '0.0.0.0'

    console.log('🔌 Port Railway:', port)

    // ✅ ENREGISTRER PLUGINS ET ROUTES
    await registerPlugins()
    await registerRoutes()

    // ✅ DÉMARRER LE SERVEUR
    const address = await fastify.listen({ port, host })
    
    console.log(`🚀 Serveur démarré avec succès!`)
    console.log(`📍 Adresse: ${address}`)
    console.log(`🌐 URL Railway: https://chatseller-api-production.up.railway.app`)
    console.log(`✅ Application prête à recevoir le trafic`)
    
    // ✅ TEST SUPABASE EN ARRIÈRE-PLAN (non bloquant)
    setTimeout(async () => {
      try {
        const supabaseTest = await testSupabaseConnection()
        console.log(`🗄️ Supabase: ${supabaseTest.success ? '✅ OK' : '❌ ERROR'}`)
      } catch (e) {
        console.log('🗄️ Supabase: ❌ ERROR (non bloquant)')
      }
    }, 2000)
    
  } catch (error) {
    console.error('💥 Erreur fatale au démarrage:', error)
    process.exit(1)
  }
}

// ✅ SIGNAL HANDLERS
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// ✅ START
start().catch((error) => {
  console.error('💥 Impossible de démarrer le serveur:', error)
  process.exit(1)
})
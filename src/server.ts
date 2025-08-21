// =====================================
// SERVER.TS - VERSION PRODUCTION COMPLÈTE AVEC TOUTES LES ROUTES
// =====================================

import dotenv from 'dotenv'
dotenv.config()

import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'

// ✅ IMPORT DES ROUTES EXISTANTES
import agentsRoutes from './routes/agents'
import analyticsRoutes from './routes/analytics'
import billingRoutes from './routes/billing'
import chatRoutes from './routes/chat'
import conversationsRoutes from './routes/conversations'
import knowledgeBaseRoutes from './routes/knowledge-base'
import ordersRoutes from './routes/orders'
import productsRoutes from './routes/products'
import publicRoutes from './routes/public'
import shopsRoutes from './routes/shops'
import supportRoutes from './routes/support'

// ✅ SUPABASE CLIENT INTÉGRÉ
import { createClient } from '@supabase/supabase-js'

console.log('🚀 === DÉMARRAGE CHATSELLER API v1.5.0 (PRODUCTION ROUTES COMPLÈTES) ===')

// ✅ VALIDATION VARIABLES D'ENVIRONNEMENT
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

console.log('✅ Variables d\'environnement validées')

// ✅ SUPABASE CLIENTS INTÉGRÉS
const supabaseServiceClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

const supabaseAuthClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)

console.log('✅ Clients Supabase configurés')

// ✅ CREATE FASTIFY INSTANCE
const fastify = Fastify({
  logger: process.env.NODE_ENV === 'production' ? { level: 'info' } : true,
  trustProxy: true,
  requestTimeout: 30000,
  keepAliveTimeout: 65000,
  bodyLimit: 10 * 1024 * 1024
})

// ✅ HANDLERS PROCESS NON AGRESSIFS EN PRODUCTION
const shouldExitOnCrash = process.env.NODE_ENV !== 'production'

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error)
  fastify.log?.fatal?.(error, 'Uncaught Exception')
  if (shouldExitOnCrash) process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason)
  fastify.log?.fatal?.({ reason, promise }, 'Unhandled Rejection')
  if (shouldExitOnCrash) process.exit(1)
})

console.log(`✅ Handlers process configurés (exit en crash: ${shouldExitOnCrash})`)

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

// ✅ MIDDLEWARE AUTH INTÉGRÉ
async function authenticate(request: any, reply: any) {
  try {
    const authHeader = request.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ 
        success: false, 
        error: 'Token manquant' 
      })
    }

    const token = authHeader.substring(7)
    const { data: { user }, error } = await supabaseAuthClient.auth.getUser(token)
    
    if (error || !user) {
      return reply.status(401).send({ 
        success: false, 
        error: 'Token invalide' 
      })
    }
    
    request.user = user
  } catch (error: any) {
    return reply.status(401).send({ 
      success: false, 
      error: 'Erreur authentification' 
    })
  }
}

// ✅ HEALTH CHECK SUPABASE SIMPLE
async function simpleSupabaseCheck(): Promise<boolean> {
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
      headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY! },
      signal: AbortSignal.timeout(3000)
    })
    return response.ok
  } catch {
    return false
  }
}

// ✅ REGISTER PLUGINS
async function registerPlugins() {
  try {
    await fastify.register(helmet, {
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    })

    // ✅ CORS AMÉLIORÉ
    await fastify.register(cors, {
      origin: (origin, callback) => {
        const allowedOrigins = [
          'https://dashboard.chatseller.app',
          'https://chatseller.app', 
          'https://docs.chatseller.app',
          'https://widget.chatseller.app',
          'http://localhost:3000',
          'http://localhost:3002',
          'http://localhost:8080',
          'https://chatseller-dashboard.vercel.app',
          'https://chatseller-widget.vercel.app'
        ]
        
        if (!origin) return callback(null, true)
        
        if (origin.includes('.chatseller.app') || origin.includes('vercel.app')) {
          return callback(null, true)
        }
        
        if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) {
          return callback(null, true)
        }
        
        if (allowedOrigins.includes(origin)) {
          return callback(null, true)
        }
        
        console.log(`❌ Origin refusée: ${origin}`)
        callback(new Error('Non autorisé par CORS'), false)
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: [
        'Content-Type', 
        'Authorization', 
        'X-Requested-With', 
        'Accept',
        'Origin',
        'X-Auth-Token',
        'X-Shop-Id',
        'User-Agent'
      ],
      optionsSuccessStatus: 200
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

// ✅ REGISTER TOUTES LES ROUTES
async function registerRoutes() {
  try {
    
    // ✅ HEALTH CHECK SIMPLE
    fastify.get('/health', async (request, reply) => {
      return reply.status(200).send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.5.0',
        environment: process.env.NODE_ENV || 'production',
        uptime: Math.round(process.uptime()),
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
      })
    })

    // ✅ HEALTH CHECK AVEC SUPABASE
    fastify.get('/health/full', async (request, reply) => {
      const healthData = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          api: 'ok',
          supabase: 'checking...'
        },
        uptime: Math.round(process.uptime()),
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
      }

      try {
        const supabaseOk = await simpleSupabaseCheck()
        healthData.services.supabase = supabaseOk ? 'ok' : 'degraded'
      } catch {
        healthData.services.supabase = 'error'
      }

      return reply.status(200).send(healthData)
    })

    // ✅ ROUTE RACINE
    fastify.get('/', async (request, reply) => {
      return {
        success: true,
        message: 'ChatSeller API is running (Production avec Routes Complètes)',
        version: '1.5.0',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'production',
        database: 'Supabase',
        routes: {
          health: '/health',
          healthFull: '/health/full',
          public: '/api/v1/public/*',
          auth: '/api/v1/auth/*',
          business: '/api/v1/*'
        }
      }
    })

    // =====================================
    // ✅ ROUTES PUBLIQUES (POUR WIDGET)
    // =====================================
    await fastify.register(async function (fastify) {
      await fastify.register(rateLimit, {
        max: 1000,
        timeWindow: '1 minute',
        keyGenerator: (request) => {
          const shopId = (request.params as any)?.shopId || (request.body as any)?.shopId || 'unknown'
          return `public-${request.ip}-${shopId}`
        }
      })
      
      // ✅ ENREGISTRER ROUTES PUBLIQUES EXISTANTES
      await fastify.register(publicRoutes)
      
    }, { prefix: '/api/v1/public' })

    // =====================================
    // ✅ ROUTES AUTH
    // =====================================
    await fastify.register(async function (fastify) {
      
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
      
    }, { prefix: '/api/v1/auth' })

    // =====================================
    // ✅ ROUTES PROTÉGÉES BUSINESS (DASHBOARD)
    // =====================================
    await fastify.register(async function (fastify) {
      // ✅ MIDDLEWARE AUTH POUR TOUTES LES ROUTES BUSINESS
      fastify.addHook('preHandler', authenticate)
      
      // ✅ ENREGISTRER TOUTES LES ROUTES BUSINESS EXISTANTES
      console.log('📝 Enregistrement routes business...')
      
      await fastify.register(shopsRoutes, { prefix: '/shops' })
      console.log('✅ Routes shops enregistrées')
      
      await fastify.register(agentsRoutes, { prefix: '/agents' })
      console.log('✅ Routes agents enregistrées')
      
      await fastify.register(conversationsRoutes, { prefix: '/conversations' })
      console.log('✅ Routes conversations enregistrées')
      
      await fastify.register(ordersRoutes, { prefix: '/orders' })
      console.log('✅ Routes orders enregistrées')
      
      await fastify.register(productsRoutes, { prefix: '/products' })
      console.log('✅ Routes products enregistrées')
      
      await fastify.register(knowledgeBaseRoutes, { prefix: '/knowledge-base' })
      console.log('✅ Routes knowledge-base enregistrées')
      
      await fastify.register(analyticsRoutes, { prefix: '/analytics' })
      console.log('✅ Routes analytics enregistrées')
      
      await fastify.register(billingRoutes, { prefix: '/billing' })
      console.log('✅ Routes billing enregistrées')
      
      await fastify.register(chatRoutes, { prefix: '/chat' })
      console.log('✅ Routes chat enregistrées')
      
      await fastify.register(supportRoutes, { prefix: '/support' })
      console.log('✅ Routes support enregistrées')
      
    }, { prefix: '/api/v1' })

    // ✅ FALLBACK 404 AMÉLIORÉ
    fastify.setNotFoundHandler(async (request, reply) => {
      console.log(`❌ Route non trouvée: ${request.method} ${request.url}`)
      
      return reply.status(404).send({
        success: false,
        error: 'Route not found',
        method: request.method,
        url: request.url,
        timestamp: new Date().toISOString(),
        availableRoutes: {
          health: ['GET /health', 'GET /health/full'],
          public: [
            'GET /api/v1/public/shops/public/:shopId/config',
            'POST /api/v1/public/chat'
          ],
          auth: [
            'POST /api/v1/auth/login',
            'POST /api/v1/auth/signup'
          ],
          business: [
            'GET /api/v1/shops',
            'GET /api/v1/shops/:id',
            'POST /api/v1/shops',
            'PUT /api/v1/shops/:id',
            'GET /api/v1/agents',
            'POST /api/v1/agents',
            'GET /api/v1/conversations',
            'GET /api/v1/analytics/dashboard',
            'GET /api/v1/knowledge-base',
            'POST /api/v1/knowledge-base/upload',
            '... et toutes les autres routes business'
          ]
        }
      })
    })

    console.log('✅ Toutes les routes enregistrées avec succès!')

  } catch (error) {
    console.error('❌ Erreur enregistrement routes:', error)
    throw error
  }
}

// ✅ GRACEFUL SHUTDOWN
async function gracefulShutdown(signal: string) {
  try {
    console.log(`🛑 Arrêt du serveur (${signal}) en cours...`)
    await fastify.close()
    console.log('✅ Serveur fermé')
    process.exit(0)
  } catch (error) {
    console.error('❌ Erreur lors de l\'arrêt:', error)
    process.exit(1)
  }
}

// ✅ START SERVER
async function start() {
  try {
    console.log('📊 Environment:', process.env.NODE_ENV || 'production')
    console.log('🗄️ Database: Supabase')

    const port = parseInt(process.env.PORT || '3001', 10)
    const host = '0.0.0.0'

    console.log('🔌 Port:', port)

    await registerPlugins()
    await registerRoutes()

    const address = await fastify.listen({ port, host })
    
    console.log(`🚀 Serveur démarré avec succès!`)
    console.log(`📍 Adresse: ${address}`)
    console.log(`🌐 URL Railway: https://chatseller-api-production.up.railway.app`)
    console.log(`✅ Application prête à recevoir le trafic`)
    console.log(`📝 Routes business complètes enregistrées`)
    
    // Test Supabase en arrière-plan
    setTimeout(async () => {
      try {
        const supabaseOk = await simpleSupabaseCheck()
        console.log(`🗄️ Supabase: ${supabaseOk ? '✅ OK' : '⚠️ DÉGRADÉ'}`)
      } catch (e) {
        console.log('🗄️ Supabase: ⚠️ ERROR (non bloquant)')
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

// ✅ DÉMARRAGE
start().catch((error) => {
  console.error('💥 Impossible de démarrer le serveur:', error)
  process.exit(1)
})
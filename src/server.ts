// =====================================
// SERVER.TS CORRIGÉ POUR RAILWAY
// =====================================

import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import dotenv from 'dotenv'

// ✅ IMPORT DU SINGLETON PRISMA
import prisma, { testDatabaseConnection } from './lib/prisma'

// ✅ IMPORT DES MODULES SUPABASE
import { supabaseServiceClient, supabaseAuthClient, testSupabaseConnection } from './lib/supabase'
import { authenticate, optionalAuthenticate } from './middleware/auth'

// ✅ IMPORT DES ROUTES
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

// ✅ CREATE FASTIFY INSTANCE AVEC CONFIGURATION RAILWAY
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development' ? {
      target: 'pino-pretty',
      options: {
        colorize: true
      }
    } : undefined
  },
  // ✅ CONFIGURATION SPÉCIALE POUR RAILWAY
  trustProxy: true,
  requestTimeout: 30000, // 30 secondes
  keepAliveTimeout: 65000,
  bodyLimit: 10 * 1024 * 1024 // 10MB
})

// ✅ GESTION GLOBALE DES ERREURS NON CAPTURÉES
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
  
  // ✅ GESTION SPÉCIFIQUE DES ERREURS COMMUNES
  if (error.statusCode === 400) {
    return reply.status(400).send({
      success: false,
      error: 'Requête invalide',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
  
  if (error.statusCode === 404) {
    return reply.status(404).send({
      success: false,
      error: 'Route non trouvée'
    })
  }
  
  // ✅ ERREUR GÉNÉRIQUE
  return reply.status(500).send({
    success: false,
    error: 'Erreur interne du serveur',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  })
})

// Register plugins
async function registerPlugins() {
  try {
    // ✅ SECURITY AVEC CONFIGURATION ADAPTÉE
    await fastify.register(helmet, {
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    })

    // ✅ CORS OPTIMISÉ POUR WIDGET EMBEDDABLE - CRITIQUE
    await fastify.register(cors, {
      origin: (origin, callback) => {
        // ✅ AUTORISER TOUS LES DOMAINES POUR LE WIDGET EMBEDDABLE
        callback(null, true)
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: [
        'Content-Type', 
        'Authorization', 
        'X-Requested-With', 
        'Accept',
        'Origin',
        'X-Auth-Token'
      ],
      // ✅ CONFIGURATION SPÉCIALE POUR OPTIONS
      preflightContinue: false,
      optionsSuccessStatus: 200
    })

    // ✅ RATE LIMITING ADAPTÉ AU WIDGET
    await fastify.register(rateLimit, {
      max: parseInt(process.env.RATE_LIMIT_MAX || '500'),
      timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60000'),
      keyGenerator: (request) => {
        return `${request.ip}-${request.headers['user-agent']?.slice(0, 50) || 'unknown'}`
      },
      // ✅ GESTION D'ERREUR RATE LIMIT
      errorResponseBuilder: function (request, context) {
        return {
          success: false,
          error: 'Trop de requêtes',
          retryAfter: context.after
        }
      }
    })

    console.log('✅ Plugins Fastify enregistrés avec succès')

  } catch (error) {
    console.error('❌ Erreur enregistrement plugins:', error)
    throw error
  }
}

// ✅ FONCTION POUR GÉRER LES REQUÊTES OPTIONS
fastify.addHook('onRequest', async (request, reply) => {
  if (request.method === 'OPTIONS') {
    reply.header('Access-Control-Allow-Origin', '*')
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH')
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin')
    reply.header('Access-Control-Max-Age', '86400')
    return reply.status(200).send()
  }
})

// Routes
async function registerRoutes() {
  try {
    
    // ✅ HEALTH CHECK SIMPLE ET ROBUSTE POUR RAILWAY
    fastify.get('/health', async (request, reply) => {
      const healthData = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        uptime: process.uptime()
      }

      // ✅ POUR RAILWAY : TOUJOURS RETOURNER 200 SI LE SERVEUR RÉPOND
      // Les vérifications détaillées peuvent être faites ailleurs
      return reply.status(200).send(healthData)
    })

    // ✅ ROUTE RACINE AMÉLIORÉE
    fastify.get('/', async (request, reply) => {
      return {
        success: true,
        message: 'ChatSeller API is running',
        version: '1.3.0',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
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

    // ✅ ROUTES PUBLIQUES (CRITICAL POUR LE WIDGET)
    await fastify.register(async function (fastify) {
      await fastify.register(rateLimit, {
        max: 1000, // Plus permissif pour le widget public
        timeWindow: '1 minute',
        keyGenerator: (request) => {
          const shopId = (request.params as any)?.shopId || (request.body as any)?.shopId || 'unknown'
          return `public-${request.ip}-${shopId}`
        }
      })

      await fastify.register(publicRoutes)
      fastify.log.info('✅ Routes publiques enregistrées SANS AUTH: /api/v1/public/*')
      
    }, { prefix: '/api/v1/public' })

    // ✅ ROUTES BILLING
    await fastify.register(async function (fastify) {
      await fastify.register(rateLimit, {
        max: 200,
        timeWindow: '1 minute'
      })
      
      await fastify.register(billingRoutes)
      fastify.log.info('✅ Routes billing enregistrées SANS AUTH: /api/v1/billing/*')
      
    }, { prefix: '/api/v1/billing' })

    // ✅ ROUTES D'AUTHENTIFICATION
    await fastify.register(async function (fastify) {
      
      await fastify.register(rateLimit, {
        max: 100,
        timeWindow: '1 minute'
      })
      
      // Route de login
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

      // Route de signup
      fastify.post('/signup', async (request, reply) => {
        try {
          const { email, password, metadata } = request.body as any
          
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

    // ✅ ROUTES API AVEC AUTHENTIFICATION
    await fastify.register(async function (fastify) {
      
      // ✅ MIDDLEWARE D'AUTH POUR TOUTES LES ROUTES PROTÉGÉES
      fastify.addHook('preHandler', authenticate)
      
      // ✅ ENREGISTREMENT DES ROUTES PROTÉGÉES
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
      fastify.log.warn(`🔍 Route non trouvée: ${request.method} ${request.url}`)
      return reply.status(404).send({
        success: false,
        error: 'Route not found',
        method: request.method,
        url: request.url,
        availableEndpoints: [
          'GET /health',
          'GET /',
          'GET /api/v1/public/shops/public/:shopId/config',
          'POST /api/v1/public/chat',
          'POST /api/v1/auth/login',
          'POST /api/v1/auth/signup'
        ]
      })
    })

    console.log('✅ Routes enregistrées avec succès')

  } catch (error) {
    console.error('❌ Erreur enregistrement routes:', error)
    throw error
  }
}

// ✅ GRACEFUL SHUTDOWN
async function gracefulShutdown(signal: string) {
  try {
    console.log(`🛑 Arrêt du serveur (${signal}) en cours...`)
    
    // Fermer les connexions Prisma
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

// ✅ START SERVER FUNCTION
async function start() {
  try {
    console.log('🚀 === DÉMARRAGE CHATSELLER API ===')
    console.log('📊 Environment:', process.env.NODE_ENV)
    console.log('💾 Database URL présent:', !!process.env.DATABASE_URL)
    console.log('🔑 Supabase URL présent:', !!process.env.SUPABASE_URL)
    console.log('🔐 Service Key présent:', !!process.env.SUPABASE_SERVICE_KEY)
    console.log('🤖 OpenAI Key présent:', !!process.env.OPENAI_API_KEY)

    // ✅ DÉTECTION PORT RAILWAY
    const getPort = () => {
      const portEnv = process.env.PORT
      if (!portEnv) {
        console.log('🔌 PORT non défini, utilisation du port 3001 par défaut')
        return 3001
      }
      
      const port = parseInt(portEnv, 10)
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error('❌ PORT invalide:', portEnv)
        console.log('🔌 Utilisation du port 3001 par défaut')
        return 3001
      }
      
      console.log('🔌 Port Railway détecté:', port)
      return port
    }

    const port = getPort()
    const host = '0.0.0.0'

    // ✅ TEST CONNEXIONS AVANT DÉMARRAGE
    console.log('🔧 Test de connexion base de données...')
    const dbStatus = await testDatabaseConnection()
    
    if (!dbStatus.success) {
      console.error('❌ ERREUR CRITIQUE: Impossible de se connecter à la base de données')
      console.error('📋 Erreur:', dbStatus.error)
      throw new Error(`Database connection failed: ${dbStatus.error}`)
    }
    
    console.log('✅ Connexion base de données: OK')

    console.log('🔧 Test de connexion Supabase...')
    const supabaseTest = await testSupabaseConnection()
    
    if (!supabaseTest.success) {
      console.error('❌ ERREUR: Connexion Supabase échouée:', supabaseTest.error)
      // Ne pas faire planter en production, mais logger l'erreur
      if (process.env.NODE_ENV === 'production') {
        console.warn('⚠️ Continuant sans Supabase en mode dégradé...')
      } else {
        throw new Error(`Supabase connection failed: ${supabaseTest.error}`)
      }
    } else {
      console.log('✅ Connexion Supabase: OK')
    }

    // ✅ ENREGISTRER PLUGINS ET ROUTES
    await registerPlugins()
    await registerRoutes()

    // ✅ DÉMARRER LE SERVEUR - VERSION SIMPLIFIÉE POUR RAILWAY
    try {
      const address = await fastify.listen({ 
        port, 
        host: '0.0.0.0'
      })
      
      console.log(`🚀 Serveur démarré avec succès!`)
      console.log(`📍 Adresse locale: ${address}`)
      console.log(`🌐 URL publique Railway: https://chatseller-api-production.up.railway.app`)
      console.log(`📋 Mode: ${process.env.NODE_ENV}`)
      console.log(`🔌 Port: ${port}`)
      console.log(`🏠 Host: 0.0.0.0`)
      console.log(`✅ Application prête à recevoir le trafic Railway`)
      
    } catch (listenError) {
      console.error('❌ Erreur lors du démarrage du serveur:', listenError)
      throw listenError
    }

    console.log('✅ Application prête à recevoir le trafic Railway')
    console.log(`🚀 ChatSeller API running on http://${host}:${port}`)
    console.log(`📖 Health check: http://${host}:${port}/health`)
    
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
// =====================================
// SERVER.TS - VERSION PRODUCTION SANS DÉPENDANCES EXTERNES
// =====================================

import dotenv from 'dotenv'
dotenv.config()

import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'

// ✅ SUPABASE CLIENT INTÉGRÉ (sans fichier externe)
import { createClient } from '@supabase/supabase-js'

console.log('🚀 === DÉMARRAGE CHATSELLER API v1.4.0 (PRODUCTION) ===')

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
  logger: {
    level: process.env.LOG_LEVEL || 'info'
  },
  trustProxy: true,
  requestTimeout: 30000,
  keepAliveTimeout: 65000,
  bodyLimit: 10 * 1024 * 1024
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

// ✅ ROUTES INTÉGRÉES
async function registerRoutes() {
  try {
    
    // ✅ HEALTH CHECK ULTRA-RAPIDE
    fastify.get('/health', async (request, reply) => {
      return reply.status(200).send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.4.0',
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
        message: 'ChatSeller API is running (Production)',
        version: '1.4.0',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'production',
        database: 'Supabase',
        endpoints: {
          health: '/health',
          healthFull: '/health/full',
          public: '/api/v1/public/*',
          auth: '/api/v1/auth/*'
        }
      }
    })

    // ✅ TEST ENVIRONNEMENT
    fastify.get('/test-env', async (request, reply) => {
      return {
        success: true,
        environment: {
          NODE_ENV: process.env.NODE_ENV || 'undefined',
          PORT: process.env.PORT || 'undefined',
          SUPABASE_URL: process.env.SUPABASE_URL ? 'défini' : 'manquant',
          SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? 'défini' : 'manquant',
          SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ? 'défini' : 'manquant',
          OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'défini' : 'manquant'
        }
      }
    })

    // ✅ ROUTES PUBLIQUES ESSENTIELLES
    await fastify.register(async function (fastify) {
      
      // Config publique pour le widget
      fastify.get('/shops/public/:shopId/config', async (request, reply) => {
        try {
          const { shopId } = request.params as any
          
          // Configuration par défaut pour tous les shops
          const defaultConfig = {
            success: true,
            data: {
              shop: {
                id: shopId,
                name: 'Boutique ChatSeller',
                widgetConfig: {
                  theme: "modern",
                  language: "fr", 
                  position: "above-cta",
                  buttonText: "Parler à un conseiller",
                  primaryColor: "#3B82F6",
                  borderRadius: "md"
                },
                agentConfig: {
                  name: "Assistant",
                  title: "Conseiller commercial",
                  avatar: "https://ui-avatars.com/api/?name=Assistant&background=3B82F6&color=fff",
                  welcomeMessage: "Salut ! Comment puis-je vous aider ?",
                  fallbackMessage: "Je transmets votre question à notre équipe."
                }
              },
              agent: {
                id: `agent-${shopId}`,
                name: "Assistant",
                title: "Conseiller commercial",
                type: "product_specialist",
                personality: "friendly",
                welcomeMessage: "Salut ! Comment puis-je vous aider ?",
                fallbackMessage: "Je transmets votre question à notre équipe.",
                avatar: "https://ui-avatars.com/api/?name=Assistant&background=3B82F6&color=fff"
              }
            }
          }
          
          return defaultConfig
          
        } catch (error: any) {
          return reply.status(500).send({
            success: false,
            error: 'Erreur configuration'
          })
        }
      })
      
      // Chat public simple
      fastify.post('/chat', async (request, reply) => {
        try {
          const { message, shopId } = request.body as any
          
          // Réponse simulée intelligente
          let response = "Merci pour votre message ! Comment puis-je vous aider davantage ?"
          
          if (message.toLowerCase().includes('bonjour') || message.toLowerCase().includes('salut')) {
            response = "Salut ! Je suis votre conseiller commercial. Comment puis-je vous aider ?"
          } else if (message.toLowerCase().includes('prix')) {
            response = "Je vais vérifier les prix pour vous. Un conseiller va vous recontacter rapidement."
          } else if (message.toLowerCase().includes('acheter')) {
            response = "Parfait ! Je vais vous aider à finaliser votre commande. Un conseiller va vous contacter."
          }
          
          return {
            success: true,
            data: {
              conversationId: `conv-${Date.now()}`,
              message: response,
              agent: {
                name: "Assistant",
                avatar: "https://ui-avatars.com/api/?name=Assistant&background=3B82F6&color=fff"
              },
              responseTime: 250
            }
          }
          
        } catch (error: any) {
          return reply.status(500).send({
            success: false,
            error: 'Erreur chat'
          })
        }
      })
      
    }, { prefix: '/api/v1/public' })

    // ✅ ROUTES AUTH SIMPLES
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

    // ✅ ROUTE SIMPLE AVEC AUTH
    await fastify.register(async function (fastify) {
      fastify.addHook('preHandler', authenticate)
      
      fastify.get('/shops', async (request, reply) => {
        try {
          return {
            success: true,
            data: [],
            message: 'API protégée fonctionnelle'
          }
        } catch (error: any) {
          return reply.status(500).send({
            success: false,
            error: 'Erreur shops'
          })
        }
      })
      
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
          'GET /health/full',
          'GET /',
          'GET /test-env',
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
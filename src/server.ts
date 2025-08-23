// =====================================
// SERVER.TS - VERSION FINALE CORRIGÉE AVEC TOUTES LES ROUTES
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

console.log('🚀 === DÉMARRAGE CHATSELLER API v1.6.1 (PRODUCTION FINALE CORRIGÉE) ===')

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

// =====================================
// 🔍 VALIDATION IMPORTS SUPABASE
// =====================================
console.log('🔍 === VALIDATION IMPORTS SUPABASE ===')

try {
  // ✅ VÉRIFIER QUE LES CLIENTS SONT BIEN IMPORTÉS
  console.log('supabaseServiceClient:', typeof supabaseServiceClient)
  console.log('supabaseAuthClient:', typeof supabaseAuthClient)
  
  if (!supabaseServiceClient) {
    console.error('❌ supabaseServiceClient est undefined')
    process.exit(1)
  }
  
  if (!supabaseAuthClient) {
    console.error('❌ supabaseAuthClient est undefined') 
    process.exit(1)
  }
  
  // ✅ TEST RAPIDE DE CONNEXION
  console.log('🧪 Test rapide de connexion Supabase...')
  
  // Test avec timeout
  const testConnection = async () => {
    try {
      const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_KEY!,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        },
        signal: AbortSignal.timeout(5000) // 5 secondes timeout
      })
      
      if (response.ok) {
        console.log('✅ Connexion Supabase REST API: OK')
      } else {
        console.log(`⚠️ Connexion Supabase REST API: ${response.status} ${response.statusText}`)
      }
    } catch (error: any) {
      console.log('⚠️ Test connexion Supabase échoué (non bloquant):', error.message)
    }
  }
  
  // Exécuter le test en arrière-plan
  testConnection()
  
  console.log('✅ Validation imports Supabase: OK')
  
} catch (error: any) {
  console.error('❌ Erreur validation imports Supabase:', error.message)
  console.error('🔧 Vérifiez que src/lib/supabase.ts exporte bien supabaseServiceClient et supabaseAuthClient')
  process.exit(1)
}

console.log('✅ === FIN VALIDATION IMPORTS ===')

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

// =====================================
// ✅ MIDDLEWARE AUTH CORRIGÉ POUR SUPABASE
// =====================================
async function authenticate(request: any, reply: any) {
  try {
    const authHeader = request.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ [AUTH] Token manquant dans headers:', { 
        hasAuth: !!authHeader,
        authType: authHeader?.substring(0, 10) 
      })
      return reply.status(401).send({ 
        success: false, 
        error: 'Token d\'authentification manquant'
      })
    }

    const token = authHeader.substring(7)
    console.log('🔍 [AUTH] Vérification token:', token.substring(0, 20) + '...')
    
    // ✅ UTILISER LE CLIENT AUTH AVEC GESTION D'ERREUR AMÉLIORÉE
    const { data: { user }, error } = await supabaseAuthClient.auth.getUser(token)
    
    if (error) {
      console.log('❌ [AUTH] Erreur Supabase auth:', error.message)
      return reply.status(401).send({ 
        success: false, 
        error: 'Token invalide ou expiré'
      })
    }
    
    if (!user) {
      console.log('❌ [AUTH] Utilisateur non trouvé')
      return reply.status(401).send({ 
        success: false, 
        error: 'Utilisateur non authentifié'
      })
    }
    
    // ✅ AJOUTER L'UTILISATEUR ET SON SHOP_ID À LA REQUÊTE
    request.user = {
      ...user,
      shop_id: user.id, // Le shop_id correspond à l'user id
      shopId: user.id   // Alias pour compatibilité
    }
    
    console.log('✅ [AUTH] Utilisateur authentifié:', {
      id: user.id,
      email: user.email,
      shop_id: user.id
    })
    
  } catch (error: any) {
    console.error('❌ [AUTH] Exception:', error.message)
    return reply.status(401).send({ 
      success: false, 
      error: 'Erreur lors de l\'authentification'
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
        console.log('🌐 [CORS] Origin demandée:', origin)
        
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
        
        // ✅ PAS D'ORIGIN (REQUÊTES DIRECTES) - AUTORISER
        if (!origin) {
          console.log('✅ [CORS] Pas d\'origin - AUTORISÉ')
          return callback(null, true)
        }
        
        // ✅ DOMAINES CHATSELLER - AUTORISER
        if (origin.includes('.chatseller.app') || 
            origin.includes('chatseller') ||
            origin.includes('vercel.app')) {
          console.log('✅ [CORS] Domaine ChatSeller - AUTORISÉ:', origin)
          return callback(null, true)
        }
        
        // ✅ DÉVELOPPEMENT LOCAL - AUTORISER
        if (process.env.NODE_ENV !== 'production' && 
            (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
          console.log('✅ [CORS] Développement local - AUTORISÉ:', origin)
          return callback(null, true)
        }
        
        // ✅ SHOPIFY ET AUTRES PLATEFORMES E-COMMERCE - AUTORISER
        if (origin.includes('myshopify.com') || 
            origin.includes('shopify') ||
            origin.includes('woocommerce') ||
            origin.includes('magento') ||
            origin.includes('prestashop') ||
            origin.includes('bigcommerce') ||
            origin.includes('wix.com') ||
            origin.includes('squarespace.com') ||
            origin.includes('youcan.shop')) {
          console.log('✅ [CORS] Plateforme e-commerce - AUTORISÉ:', origin)
          return callback(null, true)
        }
        
        // ✅ DOMAINES PERSONNALISÉS E-COMMERCE (HEURISTIQUES)
        if (origin.includes('shop') || 
            origin.includes('store') || 
            origin.includes('boutique') ||
            origin.includes('market') ||
            origin.includes('commerce') ||
            origin.match(/\.(com|fr|net|org|shop|store)$/)) {
          console.log('✅ [CORS] Domaine e-commerce probable - AUTORISÉ:', origin)
          return callback(null, true)
        }
        
        // ✅ LISTE EXPLICITE - AUTORISER
        if (allowedOrigins.includes(origin)) {
          console.log('✅ [CORS] Liste explicite - AUTORISÉ:', origin)
          return callback(null, true)
        }
        
        // ✅ REFUSER AVEC LOG
        console.log(`❌ [CORS] Origin refusée: ${origin}`)
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
        'User-Agent',
        'Referer'
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
        version: '1.6.1',
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
        message: 'ChatSeller API is running (Production avec Routes Complètes CORRIGÉE)',
        version: '1.6.1',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'production',
        database: 'Supabase',
        routes: {
          health: '/health',
          healthFull: '/health/full',
          diagnostic: '/api/v1/diagnostic',
          testSupabase: '/api/v1/test-supabase',
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
      
      // =====================================
      // 🩺 ROUTE DIAGNOSTIC PROTÉGÉE BUSINESS
      // =====================================
      fastify.get('/diagnostic', async (request, reply) => {
        try {
          console.log('🩺 === DIAGNOSTIC API PROTÉGÉ ===')
          
          const user = (request as any).user
          if (!user) {
            return reply.status(401).send({
              success: false,
              error: 'Utilisateur non authentifié'
            })
          }

          const diagnosticResults = {
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV,
            user: {
              id: user.id,
              email: user.email,
              shop_id: user.shop_id
            },
            supabase: {
              url: process.env.SUPABASE_URL?.substring(0, 30) + '...',
              serviceKeyExists: !!process.env.SUPABASE_SERVICE_KEY,
              anonKeyExists: !!process.env.SUPABASE_ANON_KEY
            },
            tests: {} as any
          }

          try {
            // ✅ TEST 1 : Connexion Supabase Service
            console.log('🧪 Test 1: Connexion Supabase Service')
            const { data: healthCheck, error: healthError } = await supabaseServiceClient
              .from('shops')
              .select('id')
              .limit(1)

            diagnosticResults.tests.supabaseServiceTest = {
              success: !healthError,
              error: healthError?.message || null,
              rowsReturned: healthCheck?.length || 0
            }
            console.log('Service Client:', !healthError ? '✅ OK' : '❌ ' + healthError?.message)
          } catch (error: any) {
            diagnosticResults.tests.supabaseServiceTest = {
              success: false,
              error: error.message
            }
          }

          try {
            // ✅ TEST 2 : Accès aux tables principales
            console.log('🧪 Test 2: Accès tables principales')
            const tables = ['shops', 'agents', 'conversations', 'messages', 'orders', 'knowledge_base']
            const tableTests: any = {}

            for (const table of tables) {
              try {
                const { data, error } = await supabaseServiceClient
                  .from(table)
                  .select('*')
                  .limit(1)

                tableTests[table] = {
                  accessible: !error,
                  error: error?.message || null,
                  sample_count: data?.length || 0
                }
                console.log(`  ${table}: ${!error ? '✅ OK' : '❌ ' + error?.message}`)
              } catch (tableError: any) {
                tableTests[table] = {
                  accessible: false,
                  error: tableError.message
                }
              }
            }

            diagnosticResults.tests.tablesTest = tableTests
          } catch (error: any) {
            diagnosticResults.tests.tablesTest = {
              error: error.message
            }
          }

          try {
            // ✅ TEST 3 : Test accès shop utilisateur
            console.log('🧪 Test 3: Accès shop utilisateur')
            const { data: userShop, error: shopError } = await supabaseServiceClient
              .from('shops')
              .select('*')
              .eq('id', user.shop_id)
              .single()

            diagnosticResults.tests.userShopTest = {
              success: !shopError,
              error: shopError?.message || null,
              shopFound: !!userShop,
              shopData: userShop ? {
                id: userShop.id,
                name: userShop.name,
                is_active: userShop.is_active
              } : null
            }
            console.log('User Shop:', !shopError ? '✅ OK' : '❌ ' + shopError?.message)
          } catch (error: any) {
            diagnosticResults.tests.userShopTest = {
              success: false,
              error: error.message
            }
          }

          // ✅ GÉNÉRER RECOMMANDATIONS
          const recommendations = []
          const failedTables: string[] = []
          
          if (!diagnosticResults.tests.supabaseServiceTest?.success) {
            recommendations.push('🔧 Problème connexion Supabase - Vérifier les variables d\'environnement')
          }

          if (diagnosticResults.tests.tablesTest) {
            const failed = Object.entries(diagnosticResults.tests.tablesTest)
              .filter(([_, test]: [string, any]) => !test.accessible)
              .map(([table, _]) => table)

            failedTables.push(...failed)

            if (failed.length > 0) {
              recommendations.push(`📊 Tables inaccessibles: ${failed.join(', ')} - DÉSACTIVER RLS`)
            }
          }

          if (!diagnosticResults.tests.userShopTest?.success) {
            recommendations.push('🏪 Problème accès shop utilisateur - Vérifier RLS sur table shops')
          }

          if (recommendations.length === 0) {
            recommendations.push('✅ Toutes les vérifications sont passées avec succès')
          }

          console.log('🩺 === FIN DIAGNOSTIC ===')

          return {
            success: true,
            diagnostic: diagnosticResults,
            recommendations: recommendations,
            sqlFix: failedTables.length > 0 ? 
              `-- Solution rapide: Copier dans Supabase SQL Editor\n${failedTables.map(table => `ALTER TABLE public.${table} DISABLE ROW LEVEL SECURITY;`).join('\n')}` 
              : null
          }

        } catch (error: any) {
          console.error('❌ Erreur diagnostic:', error)
          return reply.status(500).send({
            success: false,
            error: 'Erreur lors du diagnostic',
            details: error.message
          })
        }
      })

      // =====================================
      // 🧪 ROUTE TEST SUPABASE
      // =====================================
      fastify.get('/test-supabase', async (request, reply) => {
        try {
          const testResults = {
            timestamp: new Date().toISOString(),
            imports: {
              serviceClient: !!supabaseServiceClient,
              authClient: !!supabaseAuthClient
            },
            environment: {
              supabaseUrl: !!process.env.SUPABASE_URL,
              serviceKey: !!process.env.SUPABASE_SERVICE_KEY,
              anonKey: !!process.env.SUPABASE_ANON_KEY
            },
            tests: {} as any
          }

          // Test simple avec Service Client
          try {
            const { data, error } = await supabaseServiceClient
              .from('shops')
              .select('count')
              .limit(1)
            
            testResults.tests.serviceClientTest = {
              success: !error,
              error: error?.message || null
            }
          } catch (e: any) {
            testResults.tests.serviceClientTest = {
              success: false,
              error: e.message
            }
          }

          // Test simple avec Auth Client
          try {
            const { data, error } = await supabaseAuthClient.auth.getSession()
            
            testResults.tests.authClientTest = {
              success: !error,
              error: error?.message || null,
              hasSession: !!data?.session
            }
          } catch (e: any) {
            testResults.tests.authClientTest = {
              success: false,
              error: e.message
            }
          }

          return {
            success: true,
            data: testResults
          }

        } catch (error: any) {
          return reply.status(500).send({
            success: false,
            error: 'Erreur test Supabase',
            details: error.message
          })
        }
      })
      
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
          diagnostic: ['GET /api/v1/diagnostic'],
          testSupabase: ['GET /api/v1/test-supabase'],
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
    console.log(`🩺 Route diagnostic: /api/v1/diagnostic`)
    console.log(`🧪 Route test: /api/v1/test-supabase`)
    
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
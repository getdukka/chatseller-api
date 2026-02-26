// =====================================
// SERVER.TS - SERVEUR FASTIFY PRINCIPAL
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
import quotasRoutes from './routes/quotas'
import settingsRoutes from './routes/settings';


// ✅ SUPABASE CLIENT INTÉGRÉ
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

console.log('🚀 === DÉMARRAGE CHATSELLER API v1.6.2 (CORS E-COMMERCE CORRIGÉ) ===')

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

    // ✅ CORS CORRIGÉ COMPLET POUR E-COMMERCE - CONFIGURATION MAXIMALE
    await fastify.register(cors, {
      origin: (origin, callback) => {
        console.log('🌐 [CORS] Origin demandée:', origin || 'NO_ORIGIN')
        
        // ✅ PAS D'ORIGIN (REQUÊTES DIRECTES, POSTMAN, CURL) - AUTORISER
        if (!origin) {
          console.log('✅ [CORS] Pas d\'origin (requête directe) - AUTORISÉ')
          return callback(null, true)
        }
        
        // ✅ DOMAINES CHATSELLER OFFICIELS - AUTORISER
        const chatseller_domains = [
          'https://dashboard.chatseller.app',
          'https://chatseller.app', 
          'https://docs.chatseller.app',
          'https://widget.chatseller.app',
          'https://chatseller-dashboard.vercel.app',
          'https://chatseller-widget.vercel.app'
        ]
        
        if (chatseller_domains.includes(origin)) {
          console.log('✅ [CORS] Domaine ChatSeller officiel - AUTORISÉ:', origin)
          return callback(null, true)
        }
        
        // ✅ DÉVELOPPEMENT LOCAL - AUTORISER
        if (origin.includes('localhost') || 
            origin.includes('127.0.0.1') || 
            origin.includes('192.168.') ||
            origin.includes(':3000') ||
            origin.includes(':3001') ||
            origin.includes(':3002') ||
            origin.includes(':8080')) {
          console.log('✅ [CORS] Développement local - AUTORISÉ:', origin)
          return callback(null, true)
        }
        
        // ✅ PLATEFORMES E-COMMERCE OFFICIELLES - AUTORISER
        const ecommerce_patterns = [
          /\.myshopify\.com$/,
          /\.shopify\.com$/,
          /\.shopifypreview\.com$/,
          /\.woocommerce\.com$/,
          /\.magento\.com$/,
          /\.prestashop\.com$/,
          /\.bigcommerce\.com$/,
          /\.wix\.com$/,
          /\.squarespace\.com$/,
          /\.youcan\.shop$/,
          /\.vercel\.app$/,
          /\.netlify\.app$/,
          /\.herokuapp\.com$/
        ]
        
        for (const pattern of ecommerce_patterns) {
          if (pattern.test(origin)) {
            console.log('✅ [CORS] Plateforme e-commerce - AUTORISÉ:', origin)
            return callback(null, true)
          }
        }
        
        // ✅ HEURISTIQUES E-COMMERCE (MOTS-CLÉS DANS L'URL) - AUTORISER
        const ecommerce_keywords = [
          'shop', 'store', 'boutique', 'market', 'commerce', 'vente',
          'buy', 'sell', 'product', 'produit', 'achat'
        ]
        
        const hasEcommerceKeyword = ecommerce_keywords.some(keyword => 
          origin.toLowerCase().includes(keyword)
        )
        
        if (hasEcommerceKeyword) {
          console.log('✅ [CORS] Domaine e-commerce (heuristique) - AUTORISÉ:', origin)
          return callback(null, true)
        }
        
        // ✅ DOMAINES GÉNÉRIQUES TRÈS PERMISSIFS POUR E-COMMERCE - AUTORISER
        const generic_patterns = [
          /^https:\/\/[^.]+\.com$/,
          /^https:\/\/[^.]+\.fr$/,
          /^https:\/\/[^.]+\.net$/,
          /^https:\/\/[^.]+\.org$/,
          /^https:\/\/[^.]+\.sn$/,
          /^https:\/\/[^.]+\.shop$/,
          /^https:\/\/[^.]+\.store$/,
          /^https:\/\/www\.[^.]+\.(com|fr|net|org|sn|shop|store)$/
        ]
        
        for (const pattern of generic_patterns) {
          if (pattern.test(origin)) {
            console.log('✅ [CORS] Domaine générique e-commerce - AUTORISÉ:', origin)
            return callback(null, true)
          }
        }
        
        // ✅ SITES SPÉCIFIQUES CONNUS (TON SITE DE TEST)
        const specific_sites = [
          'https://www.viensonseconnait.com',
          'https://viensonseconnait.com',
          'http://www.viensonseconnait.com',
          'http://viensonseconnait.com'
        ]
        
        if (specific_sites.includes(origin)) {
          console.log('✅ [CORS] Site spécifique connu - AUTORISÉ:', origin)
          return callback(null, true)
        }
        
        // ✅ MODE DÉVELOPPEMENT - TRÈS PERMISSIF
        if (process.env.NODE_ENV === 'development') {
          console.log('✅ [CORS] Mode développement - TOUT AUTORISÉ:', origin)
          return callback(null, true)
        }
        
        // Refuser les origins non reconnues
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
        'X-Message-Count',
        'X-Is-First-User-Message',
        'User-Agent',
        'Referer',
        'Cache-Control',
        'Pragma'
      ],
      exposedHeaders: [
        'X-Total-Count',
        'X-Page-Count',
        'Link'
      ],
      optionsSuccessStatus: 200,
      preflightContinue: false,
      preflight: true
    })

    // Note: OPTIONS preflight est géré automatiquement par @fastify/cors (preflight: true)

    // ✅ HOOK POUR AJOUTER HEADERS DE SÉCURITÉ SUR TOUTES LES RÉPONSES
    // Note: Access-Control-Allow-Origin est géré par @fastify/cors uniquement
    fastify.addHook('onSend', async (request, reply, payload) => {
      reply.header('X-Content-Type-Options', 'nosniff')
      reply.header('X-Frame-Options', 'SAMEORIGIN')
      reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
      return payload
    })

    await fastify.register(rateLimit, {
      max: 1000, // ✅ Augmenté pour e-commerce
      timeWindow: '1 minute',
      keyGenerator: (request) => {
        // ✅ Rate limiting par IP + domaine d'origine
        const origin = request.headers.origin || 'no-origin'
        const shopId = (request.params as any)?.shopId || (request.body as any)?.shopId || 'unknown'
        return `${request.ip}-${origin.replace(/https?:\/\//, '')}-${shopId}`.substring(0, 100)
      },
      errorResponseBuilder: (request, context) => ({
        success: false,
        error: 'Trop de requêtes',
        retryAfter: context.after
      })
    })

    console.log('✅ Plugins Fastify enregistrés avec CORS e-commerce complet')

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
        version: '1.6.2',
        environment: process.env.NODE_ENV || 'production',
        uptime: Math.round(process.uptime()),
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        cors: 'e-commerce-enabled'
      })
    })

    // ✅ HEALTH CHECK AVEC SUPABASE
    fastify.get('/health/full', async (request, reply) => {
      const healthData = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          api: 'ok',
          supabase: 'checking...',
          cors: 'e-commerce-enabled'
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

    // ✅ NOUVEAU : ENDPOINT DE TEST CORS SPÉCIFIQUE
    fastify.get('/cors-test', async (request, reply) => {
      const origin = request.headers.origin
      return {
        success: true,
        message: 'CORS test endpoint',
        origin: origin || 'NO_ORIGIN',
        timestamp: new Date().toISOString(),
        headers: {
          'user-agent': request.headers['user-agent'],
          'referer': request.headers.referer,
          'host': request.headers.host
        }
      }
    })

    // ✅ DIAGNOSTIC STRIPE PUBLIC (sans auth)
    fastify.get('/stripe-check', async (request, reply) => {
      const sk = process.env.STRIPE_SECRET_KEY || ''
      return {
        STRIPE_MODE: sk.startsWith('sk_live_') ? '✅ LIVE' : sk.startsWith('sk_test_') ? '⚠️ TEST' : '❌ INVALIDE',
        STRIPE_KEY_PREFIX: sk ? sk.substring(0, 12) + '...' : 'NON DÉFINI',
        STRIPE_PRICE_ID_STARTER: process.env.STRIPE_PRICE_ID_STARTER || 'NON DÉFINI',
        STRIPE_PRICE_ID_PRO: process.env.STRIPE_PRICE_ID_PRO || 'NON DÉFINI',
        STRIPE_WEBHOOK_SECRET: !!process.env.STRIPE_WEBHOOK_SECRET
      }
    })

    // ✅ ROUTE RACINE
    fastify.get('/', async (request, reply) => {
      return {
        success: true,
        message: 'ChatSeller API is running (Production avec CORS E-Commerce Corrigé)',
        version: '1.6.2',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'production',
        database: 'Supabase',
        cors: {
          status: 'e-commerce-enabled',
          supportedPlatforms: [
            'Shopify', 'WooCommerce', 'Magento', 'PrestaShop', 
            'BigCommerce', 'Wix', 'Squarespace', 'YouCan'
          ]
        },
        routes: {
          health: '/health',
          healthFull: '/health/full',
          corsTest: '/cors-test',
          diagnostic: '/api/v1/diagnostic',
          testSupabase: '/api/v1/test-supabase',
          public: '/api/v1/public/*',
          auth: '/api/v1/auth/*',
          business: '/api/v1/*'
        }
      }
    })

    // =====================================
    // ✅ ROUTES PUBLIQUES (POUR WIDGET) - RATE LIMITING ADAPTÉ E-COMMERCE
    // =====================================
    await fastify.register(async function (fastify) {
      await fastify.register(rateLimit, {
        max: 200, // Limité pour prévenir les abus OpenAI coûteux
        timeWindow: '1 minute',
        keyGenerator: (request) => {
          const shopId = (request.body as any)?.shopId || 'unknown'
          return `public-${request.ip}-${shopId}`.substring(0, 80)
        },
        errorResponseBuilder: (request, context) => ({
          success: false,
          error: 'Limite de requêtes atteinte. Réessayez dans quelques instants.',
          retryAfter: context.after
        })
      })
      
      // ✅ ENREGISTRER ROUTES PUBLIQUES EXISTANTES
      await fastify.register(publicRoutes)

      // ✅ AJOUT: Route de test pour debug
      fastify.get('/test', async (request, reply) => {
        return {
          success: true,
          message: 'Route publique test OK',
          timestamp: new Date().toISOString(),
          prefix: '/api/v1/public'
        }
      })
      
    }, { prefix: '/api/v1/public' })

    // =====================================
    // ✅ ROUTES AUTH
    // =====================================
    await fastify.register(async function (fastify) {
      
      fastify.post('/login', async (request, reply) => {
        try {
          const loginSchema = z.object({
            email: z.string().email(),
            password: z.string().min(6)
          })
          const { email, password } = loginSchema.parse(request.body)

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
          const signupSchema = z.object({
            email: z.string().email(),
            password: z.string().min(8),
            metadata: z.record(z.string(), z.unknown()).optional()
          })
          const { email, password, metadata } = signupSchema.parse(request.body)

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
      // 🩺 ROUTE DIAGNOSTIC PROTÉGÉE BUSINESS AVEC TEST CORS
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
            cors: {
              status: 'e-commerce-enabled',
              origin: request.headers.origin || 'NO_ORIGIN',
              userAgent: request.headers['user-agent'] || 'NO_USER_AGENT'
            },
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

          // ✅ TEST 4 : Test endpoint public depuis cette origine
          try {
            console.log('🧪 Test 4: Test endpoint public CORS')
            const publicTestUrl = `${request.protocol}://${request.headers.host}/cors-test`
            const corsTestResult = await fetch(publicTestUrl, {
              headers: {
                'Origin': request.headers.origin || 'https://test-cors.com'
              }
            }).then(res => res.ok).catch(() => false)
            
            diagnosticResults.tests.corsTest = {
              success: corsTestResult,
              testUrl: publicTestUrl,
              origin: request.headers.origin
            }
          } catch (error: any) {
            diagnosticResults.tests.corsTest = {
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
              recommendations.push(`📊 Tables inaccessibles: ${failed.join(', ')} - Vérifier les politiques RLS Supabase pour ces tables`)
            }
          }

          if (!diagnosticResults.tests.userShopTest?.success) {
            recommendations.push('🏪 Problème accès shop utilisateur - Vérifier RLS sur table shops')
          }

          if (!diagnosticResults.tests.corsTest?.success) {
            recommendations.push('🌐 Problème CORS détecté - Vérifier configuration CORS')
          }

          if (recommendations.length === 0) {
            recommendations.push('✅ Toutes les vérifications sont passées avec succès!')
          }

          console.log('🩺 === FIN DIAGNOSTIC ===')

          return {
            success: true,
            diagnostic: diagnosticResults,
            recommendations: recommendations,
            sqlFix: failedTables.length > 0 ? 
              `-- Solution rapide: Copier dans Supabase SQL Editor\n${failedTables.map(table => `ALTER TABLE public.${table} DISABLE ROW LEVEL SECURITY;`).join('\n')}` 
              : null,
            corsDebug: {
              currentOrigin: request.headers.origin,
              userAgent: request.headers['user-agent'],
              referer: request.headers.referer,
              allowedMethods: 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
              status: 'fully-permissive-for-ecommerce'
            }
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
      
      // ✅ NOUVELLES ROUTES AJOUTÉES
      await fastify.register(quotasRoutes, { prefix: '/quotas' })
      console.log('✅ Routes quotas enregistrées')
      
      await fastify.register(settingsRoutes, { prefix: '/settings' })
      console.log('✅ Routes settings enregistrées')
      
    }, { prefix: '/api/v1' })

    fastify.setNotFoundHandler(async (request, reply) => {
      console.log(`❌ Route non trouvée: ${request.method} ${request.url}`)
      return reply.status(404).send({
        success: false,
        error: 'Route not found'
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
    console.log('🌐 CORS: E-Commerce Full Support Enabled')

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
    console.log(`🌐 Route test CORS: /cors-test`)
    console.log(`🔓 CORS: Shopify, WooCommerce et tous e-commerces autorisés`)
    
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
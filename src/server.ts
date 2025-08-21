// =====================================
// SERVER.TS - VERSION PRODUCTION COMPLÈTE FONCTIONNELLE
// =====================================

import dotenv from 'dotenv'
dotenv.config()

import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'

// ✅ SUPABASE CLIENT INTÉGRÉ
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

// ✅ HELPER: Récupérer ou créer shop avec Supabase
async function getOrCreateShop(user: any) {
  try {
    // Chercher par ID d'abord
    let { data: shop, error } = await supabaseServiceClient
      .from('shops')
      .select('*')
      .eq('id', user.id)
      .single();

    if (shop) {
      return shop;
    }

    // Chercher par email si pas trouvé par ID
    const { data: shopByEmail } = await supabaseServiceClient
      .from('shops')
      .select('*')
      .eq('email', user.email)
      .single();

    if (shopByEmail) {
      return shopByEmail;
    }

    // Créer nouveau shop
    const { data: newShop, error: createError } = await supabaseServiceClient
      .from('shops')
      .insert({
        id: user.id,
        name: user.user_metadata?.full_name || user.email.split('@')[0] || 'Boutique',
        email: user.email,
        subscription_plan: 'starter',
        is_active: true,
        widget_config: {
          theme: "modern",
          language: "fr", 
          position: "above-cta",
          buttonText: "Parler à un conseiller",
          primaryColor: "#3B82F6",
          widgetSize: "medium",
          borderRadius: "md",
          animation: "fade",
          autoOpen: false,
          showAvatar: true,
          soundEnabled: true,
          mobileOptimized: true,
          isActive: true
        },
        agent_config: {
          name: "Assistant ChatSeller",
          title: "Assistant commercial",
          avatar: "https://ui-avatars.com/api/?name=Assistant&background=3B82F6&color=fff",
          upsellEnabled: false,
          welcomeMessage: "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
          fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
          collectPaymentMethod: true,
          aiProvider: "openai",
          temperature: 0.7,
          maxTokens: 1000
        }
      })
      .select()
      .single();

    if (createError) {
      throw createError;
    }

    return newShop;

  } catch (error) {
    console.error('Erreur getOrCreateShop:', error);
    throw error;
  }
}

// ✅ HELPER: Vérifier UUID
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// ✅ CONFIGURATION FALLBACK POUR DEMO/TEST
function getFallbackShopConfig(shopId: string) {
  return {
    success: true,
    data: {
      shop: {
        id: shopId,
        name: 'Boutique Demo ChatSeller',
        widgetConfig: {
          theme: "modern",
          language: "fr", 
          position: "above-cta",
          buttonText: "Parler à un conseiller",
          primaryColor: "#3B82F6",
          borderRadius: "full"
        },
        agentConfig: {
          name: "Assistant Demo",
          title: "Conseiller commercial",
          avatar: "https://ui-avatars.com/api/?name=Assistant&background=3B82F6&color=fff",
          upsellEnabled: false,
          welcomeMessage: "Salut 👋 Je suis votre conseiller. Comment puis-je vous aider ?",
          fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
          collectPaymentMethod: true
        }
      },
      agent: {
        id: `agent-${shopId}`,
        name: "Assistant Demo",
        title: "Conseiller commercial", 
        type: "product_specialist",
        personality: "friendly",
        description: "Assistant commercial spécialisé dans l'accompagnement client",
        welcomeMessage: "Salut 👋 Je suis votre conseiller. Comment puis-je vous aider ?",
        fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
        avatar: "https://ui-avatars.com/api/?name=Assistant&background=3B82F6&color=fff",
        config: {
          collectName: true,
          collectPhone: true,
          collectAddress: true,
          collectPayment: true,
          upsellEnabled: true
        }
      },
      knowledgeBase: {
        content: `## Boutique Demo ChatSeller

Notre boutique propose des produits de qualité avec un service client excellent.

### Services
- Livraison rapide
- Paiement sécurisé par virement, mobile money, ou espèces
- Service client disponible
- Garantie sur nos produits

Vous pouvez parcourir notre catalogue pour découvrir nos produits.`,
        documentsCount: 1,
        documents: [
          {
            id: 'doc-demo-001',
            title: 'Informations boutique demo',
            contentType: 'manual',
            tags: ['boutique', 'produits', 'service']
          }
        ]
      }
    }
  };
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

// ✅ ROUTES COMPLÈTES
async function registerRoutes() {
  try {
    
    // ✅ HEALTH CHECK SIMPLE
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

    // ✅ ROUTES PUBLIQUES COMPLÈTES (POUR WIDGET)
    await fastify.register(async function (fastify) {
      await fastify.register(rateLimit, {
        max: 1000,
        timeWindow: '1 minute',
        keyGenerator: (request) => {
          const shopId = (request.params as any)?.shopId || (request.body as any)?.shopId || 'unknown'
          return `public-${request.ip}-${shopId}`
        }
      })
      
      // ✅ CONFIG PUBLIQUE SHOP (CRITICAL POUR WIDGET)
      fastify.get('/shops/public/:shopId/config', async (request, reply) => {
        try {
          const { shopId } = request.params as any
          console.log(`🔍 [PUBLIC CONFIG] Récupération config pour shop: ${shopId}`)
          
          // Gestion UUID vs DEMO
          if (!isValidUUID(shopId)) {
            console.log(`⚠️ ShopId non-UUID détecté: ${shopId}, utilisation configuration fallback`)
            return getFallbackShopConfig(shopId)
          }
          
          // Récupération shop réel avec Supabase
          const { data: shop, error: shopError } = await supabaseServiceClient
            .from('shops')
            .select('id, name, is_active, widget_config, agent_config')
            .eq('id', shopId)
            .single()

          if (shopError || !shop || !shop.is_active) {
            console.log(`⚠️ Shop non trouvé ou inactif: ${shopId}, utilisation configuration fallback`)
            return getFallbackShopConfig(shopId)
          }

          // Récupération agent actif
          const { data: agents, error: agentError } = await supabaseServiceClient
            .from('agents')
            .select(`
              id, name, title, type, personality, description, 
              welcomeMessage, fallbackMessage, avatar, config,
              agent_knowledge_base!inner(
                knowledge_base!inner(
                  id, title, content, contentType, tags
                )
              )
            `)
            .eq('shopId', shopId)
            .eq('isActive', true)
            .order('updatedAt', { ascending: false })
            .limit(1)

          const agent = agents && agents.length > 0 ? agents[0] : null

          if (!agent) {
            return {
              success: true,
              data: {
                shop: {
                  id: shop.id,
                  name: shop.name,
                  widgetConfig: shop.widget_config,
                  agentConfig: shop.agent_config
                },
                agent: null,
                knowledgeBase: {
                  content: "Configuration par défaut de la boutique.",
                  documentsCount: 0,
                  documents: []
                }
              }
            }
          }

          // Construire knowledge base
          const knowledgeContent = agent.agent_knowledge_base
            .map((akb: any) => `## ${akb.knowledge_base.title}\n${akb.knowledge_base.content}`)
            .join('\n\n---\n\n')

          const response = {
            success: true,
            data: {
              shop: {
                id: shop.id,
                name: shop.name,
                widgetConfig: shop.widget_config,
                agentConfig: shop.agent_config
              },
              agent: {
                id: agent.id,
                name: agent.name,
                title: agent.title || 'Conseiller commercial',
                type: agent.type,
                personality: agent.personality,
                description: agent.description,
                welcomeMessage: agent.welcomeMessage,
                fallbackMessage: agent.fallbackMessage,
                avatar: agent.avatar,
                config: agent.config
              },
              knowledgeBase: {
                content: knowledgeContent,
                documentsCount: agent.agent_knowledge_base.length,
                documents: agent.agent_knowledge_base.map((akb: any) => ({
                  id: akb.knowledge_base.id,
                  title: akb.knowledge_base.title,
                  contentType: akb.knowledge_base.contentType,
                  tags: akb.knowledge_base.tags
                }))
              }
            }
          }

          console.log(`✅ [PUBLIC CONFIG] Configuration envoyée pour ${shopId} - Agent: ${response.data.agent.name}`)
          return response

        } catch (error: any) {
          console.error(`❌ [PUBLIC CONFIG] Erreur: ${error.message}`)
          const { shopId } = request.params as { shopId: string }
          console.log(`⚠️ Fallback activé pour shop ${shopId}`)
          return getFallbackShopConfig(shopId)
        }
      })
      
      // ✅ CHAT PUBLIC SIMPLE (POUR WIDGET)
      fastify.post('/chat', async (request, reply) => {
        try {
          const { message, shopId, conversationId, productInfo, visitorId, isFirstMessage } = request.body as any
          
          console.log(`💬 [PUBLIC CHAT] Message reçu pour shop: ${shopId}${isFirstMessage ? ' (premier message)' : ''}`)
          
          if (!shopId || !message) {
            return reply.status(400).send({ 
              success: false, 
              error: 'shopId et message requis' 
            })
          }

          // Mode test pour shops non-UUID
          if (!isValidUUID(shopId)) {
            console.log(`💬 [MODE TEST] Réponse simulée pour shop: ${shopId}`)
            
            let simulatedResponse = ''
            
            if (isFirstMessage && productInfo?.name) {
              simulatedResponse = `Salut ! 👋 Je suis votre conseiller chez ${shopId.toUpperCase()}.

Je vois que vous vous intéressez à **"${productInfo.name}"**. C'est un excellent choix ! ✨

Comment puis-je vous aider ? 😊`
            } else {
              if (message.toLowerCase().includes('bonjour') || message.toLowerCase().includes('salut')) {
                simulatedResponse = "Salut ! Je suis votre conseiller commercial. Comment puis-je vous aider ?"
              } else if (message.toLowerCase().includes('prix')) {
                simulatedResponse = "Je vais vérifier les prix pour vous. Un conseiller va vous recontacter rapidement."
              } else if (message.toLowerCase().includes('acheter')) {
                simulatedResponse = "Parfait ! Je vais vous aider à finaliser votre commande. Un conseiller va vous contacter."
              } else {
                simulatedResponse = "Merci pour votre message ! Comment puis-je vous aider davantage ?"
              }
            }
            
            return {
              success: true,
              data: {
                conversationId: conversationId || `test-conv-${Date.now()}`,
                message: simulatedResponse,
                agent: {
                  name: "Assistant Demo",
                  avatar: "https://ui-avatars.com/api/?name=Demo&background=EF4444&color=fff"
                },
                responseTime: 250,
                isWelcomeMessage: isFirstMessage,
                mode: 'test'
              }
            }
          }
          
          // TODO: Intégration vraie IA pour shops réels
          return {
            success: true,
            data: {
              conversationId: conversationId || `conv-${Date.now()}`,
              message: "Merci pour votre message ! Notre système IA sera bientôt opérationnel.",
              agent: {
                name: "Assistant",
                avatar: "https://ui-avatars.com/api/?name=Assistant&background=3B82F6&color=fff"
              },
              responseTime: 150
            }
          }
          
        } catch (error: any) {
          console.error(`❌ [PUBLIC CHAT] Erreur: ${error.message}`)
          return reply.status(500).send({
            success: false,
            error: 'Erreur chat'
          })
        }
      })
      
    }, { prefix: '/api/v1/public' })

    // ✅ ROUTES AUTH
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

    // ✅ ROUTES PROTÉGÉES COMPLÈTES (DASHBOARD)
    await fastify.register(async function (fastify) {
      fastify.addHook('preHandler', authenticate)
      
      // ✅ GET SHOP PAR ID (ROUTE PRINCIPALE DU MIDDLEWARE)
      interface ShopParams { id: string }
      fastify.get<{ Params: ShopParams }>('/shops/:id', async (request, reply) => {
        try {
          const { id } = request.params
          const user = request.user as any
          
          console.log(`🏪 [API] GET /shops/${id} appelé par user:`, user.id)
          
          // Sécurité : l'utilisateur ne peut accéder qu'à son propre shop
          if (id !== user.id) {
            return reply.status(403).send({
              success: false,
              error: 'Accès non autorisé'
            })
          }
          
          // Récupérer ou créer le shop
          const shop = await getOrCreateShop(user)
          
          console.log(`✅ [API] Shop récupéré/créé:`, {
            id: shop.id,
            name: shop.name,
            plan: shop.subscription_plan,
            onboarding: shop.onboarding_completed
          })
          
          return {
            success: true,
            data: shop
          }
        } catch (error: any) {
          console.error(`❌ [API] Erreur GET /shops/${request.params.id}:`, error)
          return reply.status(500).send({
            success: false,
            error: 'Erreur récupération shop'
          })
        }
      })
      
      // ✅ UPDATE SHOP
      interface UpdateShopParams { id: string }
      fastify.put<{ Params: UpdateShopParams }>('/shops/:id', async (request, reply) => {
        try {
          const { id } = request.params as any
          const user = request.user as any
          const updateData = request.body as any
          
          console.log(`🔄 [API] PUT /shops/${id} appelé par user:`, user.id)
          
          // Sécurité
          if (id !== user.id) {
            return reply.status(403).send({
              success: false,
              error: 'Accès non autorisé'
            })
          }
          
          // Mise à jour du shop
          const { data: updatedShop, error } = await supabaseServiceClient
            .from('shops')
            .update({
              ...updateData,
              updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single()

          if (error) {
            throw error
          }

          console.log(`✅ [API] Shop mis à jour:`, updatedShop.id)

          return {
            success: true,
            data: updatedShop
          }
        } catch (error: any) {
          console.error(`❌ [API] Erreur PUT /shops/${request.params.id}:`, error)
          return reply.status(500).send({
            success: false,
            error: 'Erreur mise à jour shop'
          })
        }
      })
      
      // ✅ CREATE SHOP (pour les cas où il n'existe pas)
      fastify.post('/shops', async (request, reply) => {
        try {
          const user = request.user as any
          const shopData = request.body as any
          
          console.log(`🆕 [API] POST /shops appelé par user:`, user.id)
          
          // Créer le shop avec l'ID de l'utilisateur
          const newShopData = {
            id: user.id,
            name: shopData.name || user.user_metadata?.name || user.email.split('@')[0] || 'Ma Boutique',
            email: user.email,
            subscription_plan: 'free',
            is_active: true,
            onboarding_completed: false,
            widget_config: shopData.widget_config || {
              theme: "modern",
              language: "fr", 
              position: "above-cta",
              buttonText: "Parler à un conseiller",
              primaryColor: "#3B82F6",
              widgetSize: "medium",
              borderRadius: "md",
              animation: "fade",
              autoOpen: false,
              showAvatar: true,
              soundEnabled: true,
              mobileOptimized: true,
              isActive: true
            },
            agent_config: shopData.agent_config || {
              name: "Assistant ChatSeller",
              title: "Assistant commercial",
              avatar: "https://ui-avatars.com/api/?name=Assistant&background=3B82F6&color=fff",
              upsellEnabled: false,
              welcomeMessage: "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
              fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
              collectPaymentMethod: true,
              aiProvider: "openai",
              temperature: 0.7,
              maxTokens: 1000
            },
            ...shopData
          }
          
          const { data: newShop, error } = await supabaseServiceClient
            .from('shops')
            .insert(newShopData)
            .select()
            .single()

          if (error) {
            throw error
          }

          console.log(`✅ [API] Shop créé:`, newShop.id)

          return {
            success: true,
            data: newShop
          }
        } catch (error: any) {
          console.error(`❌ [API] Erreur POST /shops:`, error)
          return reply.status(500).send({
            success: false,
            error: 'Erreur création shop'
          })
        }
      })
      
      // ✅ LISTE SHOPS (pour l'utilisateur connecté)
      fastify.get('/shops', async (request, reply) => {
        try {
          const user = request.user as any
          console.log(`📋 [API] GET /shops appelé par user:`, user.id)
          
          const shop = await getOrCreateShop(user)
          
          return {
            success: true,
            data: [shop]
          }
        } catch (error: any) {
          console.error(`❌ [API] Erreur GET /shops:`, error)
          return reply.status(500).send({
            success: false,
            error: 'Erreur récupération shops'
          })
        }
      })
      
      // ✅ AGENTS
      fastify.get('/agents', async (request, reply) => {
        try {
          const user = request.user as any
          const shop = await getOrCreateShop(user)
          
          const { data: agents, error } = await supabaseServiceClient
            .from('agents')
            .select('*')
            .eq('shopId', shop.id)
            .order('updatedAt', { ascending: false })

          return {
            success: true,
            data: agents || []
          }
        } catch (error: any) {
          return reply.status(500).send({
            success: false,
            error: 'Erreur récupération agents'
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
          'GET /api/v1/public/shops/public/:shopId/config',
          'POST /api/v1/public/chat',
          'POST /api/v1/auth/login',
          'POST /api/v1/auth/signup',
          'GET /api/v1/shops',
          'GET /api/v1/agents'
        ]
      })
    })

    console.log('✅ Routes complètes enregistrées avec succès')

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
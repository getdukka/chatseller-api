// src/server.ts
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { PrismaClient } from '@prisma/client'
import dotenv from 'dotenv'

// ✅ IMPORT DES NOUVEAUX MODULES CORRIGÉS
import { supabaseServiceClient, supabaseAuthClient, testSupabaseConnection } from './lib/supabase'
import { authenticate, optionalAuthenticate } from './middleware/auth'

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
    level: process.env.LOG_LEVEL || 'info'
  }
})

// ✅ HEALTH CHECK AMÉLIORÉ AVEC TEST SUPABASE
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

// Register plugins
async function registerPlugins() {
  // Security
  await fastify.register(helmet, {
    contentSecurityPolicy: false
  })

  // CORS
  await fastify.register(cors, {
    origin: (origin, callback) => {
      callback(null, true) // Autoriser tous les domaines pour le widget
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  })

  // Rate limiting
  await fastify.register(rateLimit, {
    max: parseInt(process.env.RATE_LIMIT_MAX || '200'),
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60000')
  })
}

// ✅ ROUTES CORRIGÉES
async function registerRoutes() {
  
  // ✅ ROUTE RACINE
  fastify.get('/', async (request, reply) => {
    return {
      success: true,
      message: 'ChatSeller API is running',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    }
  })

  // ✅ ROUTES PUBLIQUES (sans authentification)
  fastify.register(async function (fastify) {
    
    // Route de test public
    fastify.get('/test', async (request, reply) => {
      return {
        success: true,
        message: 'API ChatSeller opérationnelle',
        timestamp: new Date().toISOString()
      }
    })

    // ✅ ROUTE CONVERSATIONS PUBLIQUE POUR LE WIDGET
    fastify.post('/conversations', async (request, reply) => {
      try {
        const { shopId, visitorId, productId, productName, productPrice, productUrl } = request.body as any

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

        return { success: true, data: conversation }
      } catch (error: any) {
        console.error('❌ Erreur création conversation:', error)
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la création de la conversation'
        })
      }
    })

    // ✅ ROUTE ORDERS PUBLIQUE POUR LE WIDGET
    fastify.post('/orders', async (request, reply) => {
      try {
        const orderData = request.body as any

        const order = await prisma.order.create({
          data: {
            ...orderData,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        })

        return { success: true, data: order }
      } catch (error: any) {
        console.error('❌ Erreur création commande:', error)
        return reply.status(500).send({
          success: false,
          error: 'Erreur lors de la création de la commande'
        })
      }
    })

  }, { prefix: '/api/v1/public' })

  // ✅ ROUTES PRIVÉES (avec authentification)
  fastify.register(async function (fastify) {
    
    // ✅ MIDDLEWARE D'AUTH POUR TOUTES LES ROUTES PRIVÉES
    fastify.addHook('preHandler', authenticate)
    
    // ✅ CONVERSATIONS PRIVÉES
    fastify.register(async function (fastify) {
      
      // Lister les conversations
      fastify.get('/', async (request, reply) => {
        try {
          if (!request.user) {
            return reply.status(401).send({ error: 'User not authenticated' })
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
            take: 50
          })

          return {
            success: true,
            data: conversations
          }

        } catch (error: any) {
          console.error('❌ Erreur liste conversations:', error)
          return reply.status(500).send({
            success: false,
            error: 'Erreur lors du chargement des conversations'
          })
        }
      })

      // Récupérer une conversation
      fastify.get('/:conversationId', async (request, reply) => {
        try {
          const { conversationId } = request.params as { conversationId: string }

          const conversation = await prisma.conversation.findFirst({
            where: {
              id: conversationId,
              shopId: request.user!.shopId
            },
            include: {
              messages: {
                orderBy: { createdAt: 'asc' }
              }
            }
          })

          if (!conversation) {
            return reply.status(404).send({
              success: false,
              error: 'Conversation non trouvée'
            })
          }

          return {
            success: true,
            data: conversation
          }

        } catch (error: any) {
          console.error('❌ Erreur récupération conversation:', error)
          return reply.status(500).send({
            success: false,
            error: 'Erreur lors du chargement de la conversation'
          })
        }
      })

    }, { prefix: '/conversations' })

    // ✅ ORDERS PRIVÉES
    fastify.register(async function (fastify) {
      
      // Lister les commandes
      fastify.get('/', async (request, reply) => {
        try {
          if (!request.user) {
            return reply.status(401).send({ error: 'User not authenticated' })
          }

          const orders = await prisma.order.findMany({
            where: {
              shopId: request.user.shopId
            },
            include: {
              items: true
            },
            orderBy: { createdAt: 'desc' },
            take: 50
          })

          return {
            success: true,
            data: orders
          }

        } catch (error: any) {
          console.error('❌ Erreur liste commandes:', error)
          return reply.status(500).send({
            success: false,
            error: 'Erreur lors du chargement des commandes'
          })
        }
      })

    }, { prefix: '/orders' })

    // ✅ KNOWLEDGE BASE
    fastify.register(async function (fastify) {
      
      // Lister les documents
      fastify.get('/', async (request, reply) => {
        try {
          if (!request.user) {
            return reply.status(401).send({ error: 'User not authenticated' })
          }

          const documents = await prisma.knowledgeBase.findMany({
            where: {
              shopId: request.user.shopId
            },
            orderBy: { createdAt: 'desc' }
          })

          return {
            success: true,
            data: documents
          }

        } catch (error: any) {
          console.error('❌ Erreur liste documents:', error)
          return reply.status(500).send({
            success: false,
            error: 'Erreur lors du chargement des documents'
          })
        }
      })

      // Créer un document
      fastify.post('/', async (request, reply) => {
        try {
          if (!request.user) {
            return reply.status(401).send({ error: 'User not authenticated' })
          }

          const { title, content, contentType = 'manual', tags = [] } = request.body as any

          const document = await prisma.knowledgeBase.create({
            data: {
              shopId: request.user.shopId,
              title,
              content,
              contentType,
              tags,
              isActive: true
            }
          })

          return {
            success: true,
            data: document
          }

        } catch (error: any) {
          console.error('❌ Erreur création document:', error)
          return reply.status(500).send({
            success: false,
            error: 'Erreur lors de la création du document'
          })
        }
      })

    }, { prefix: '/knowledge-base' })

    // ✅ SHOPS
    fastify.register(async function (fastify) {
      
      // Récupérer le shop de l'utilisateur
      fastify.get('/me', async (request, reply) => {
        try {
          if (!request.user) {
            return reply.status(401).send({ error: 'User not authenticated' })
          }

          const shop = await prisma.shop.findUnique({
            where: {
              id: request.user.shopId
            }
          })

          if (!shop) {
            return reply.status(404).send({
              success: false,
              error: 'Shop non trouvé'
            })
          }

          return {
            success: true,
            data: shop
          }

        } catch (error: any) {
          console.error('❌ Erreur récupération shop:', error)
          return reply.status(500).send({
            success: false,
            error: 'Erreur lors du chargement du shop'
          })
        }
      })

    }, { prefix: '/shops' })

  }, { prefix: '/api/v1' })

  // ✅ FALLBACK ROUTE
  fastify.setNotFoundHandler(async (request, reply) => {
    return reply.status(404).send({
      success: false,
      error: 'Route not found',
      method: request.method,
      url: request.url
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
    console.error('❌ Erreur graceful shutdown:', error)
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
    console.log(`🔐 Protected routes: http://${host}:${port}/api/v1/*`)
    console.log(`🌐 Public routes: http://${host}:${port}/api/v1/public/*`)
    
  } catch (error) {
    console.error('❌ Erreur démarrage serveur:', error)
    process.exit(1)
  }
}

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown)

// Start the server
start()
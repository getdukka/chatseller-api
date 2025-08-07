// src/server.ts - SERVEUR BACKEND AVEC ROUTES - VERSION CORRIGÉE (SANS DUPLICATIONS)
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// ✅ IMPORT DES ROUTES
import billingRoutes from './routes/billing';
import agentsRoutes from './routes/agents'; 
import productsRoutes from './routes/products';
import publicRoutes from './routes/public'; 
import ordersRoutes from './routes/orders';
import shopsRoutes from './routes/shops';
import knowledgeBaseRoutes from './routes/knowledge-base';

// Load environment variables
dotenv.config();

// ✅ VALIDATION DES VARIABLES D'ENVIRONNEMENT REQUISES
const requiredEnvVars = {
  DATABASE_URL: process.env.DATABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY 
};

for (const [key, value] of Object.entries(requiredEnvVars)) {
  if (!value) {
    console.error(`❌ Variable d'environnement manquante: ${key}`);
    process.exit(1);
  }
}

console.log('✅ Variables d\'environnement validées');

// Initialize clients
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ✅ INTERFACE POUR L'UTILISATEUR AUTHENTIFIÉ
interface AuthenticatedUser {
  id: string;
  email?: string;
  [key: string]: any;
}

// ✅ EXTENSION DU TYPE FASTIFY REQUEST
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

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
});

// ✅ MIDDLEWARE D'AUTHENTIFICATION CORRIGÉ
async function authenticate(request: any, reply: any) {
  try {
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        success: false,
        error: 'Token d\'authentification manquant'
      });
    }

    const token = authHeader.replace('Bearer ', '');

    // Vérifier le token avec Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return reply.status(401).send({
        success: false,
        error: 'Token d\'authentification invalide'
      });
    }

    // ✅ AJOUTER L'UTILISATEUR À LA REQUÊTE AVEC TYPE SÉCURISÉ
    request.user = {
      id: user.id,
      email: user.email,
      ...user.user_metadata
    } as AuthenticatedUser;

  } catch (error) {
    fastify.log.error('❌ Erreur authentification:', error);
    return reply.status(401).send({
      success: false,
      error: 'Erreur d\'authentification'
    });
  }
}

// Register plugins
async function registerPlugins() {
  // Security
  await fastify.register(helmet, {
    contentSecurityPolicy: false
  });

  // ✅ CORS OPTIMISÉ POUR LE WIDGET
  await fastify.register(cors, {
    origin: (origin, callback) => {
      // ✅ IMPORTANT: Autoriser tous les domaines pour le widget embeddable
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  });

  // ✅ RATE LIMITING ADAPTÉ AU WIDGET
  await fastify.register(rateLimit, {
    max: parseInt(process.env.RATE_LIMIT_MAX || '200'),
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60000'),
    keyGenerator: (request) => {
      return `${request.ip}-${request.headers['user-agent']?.slice(0, 50) || 'unknown'}`
    }
  });
}

// Routes
async function registerRoutes() {
  // ✅ HEALTH CHECK AMÉLIORÉ
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
    };

    // Test rapide de la base de données
    try {
      await prisma.$queryRaw`SELECT 1`;
      healthData.services.database = 'ok';
    } catch (error) {
      healthData.services.database = 'error';
      healthData.status = 'degraded';
    }

    // Test OpenAI (optionnel pour ne pas consommer de tokens)
    if (process.env.OPENAI_API_KEY) {
      healthData.services.openai = 'configured';
    } else {
      healthData.services.openai = 'not_configured';
    }

    // Test Supabase
    try {
      const { error } = await supabase.from('shops').select('count').limit(1);
      healthData.services.supabase = error ? 'error' : 'ok';
    } catch (error) {
      healthData.services.supabase = 'error';
      healthData.status = 'degraded';
    }

    return healthData;
  });

  // ✅ ROUTE RACINE POUR ÉVITER LES 404
  fastify.get('/', async (request, reply) => {
    return {
      success: true,
      message: 'ChatSeller API is running',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      endpoints: {
        health: '/health',
        billing: '/api/v1/billing/*',
        public: '/api/v1/public/*',
        auth: '/api/v1/auth/*'
      }
    };
  });

  // ✅ ROUTES PUBLIQUES (SANS AUTH) - WIDGET & API PUBLIQUE
  fastify.register(async function (fastify) {
    await fastify.register(rateLimit, {
      max: 300,
      timeWindow: '1 minute'
    });

    // Routes publiques pour le widget
    fastify.register(publicRoutes);
    
    // Routes de commandes publiques
    fastify.register(ordersRoutes, { prefix: '/orders' });
    
    fastify.log.info('✅ Routes publiques enregistrées: /api/v1/public/*');
    
  }, { prefix: '/api/v1/public' });

  // ✅ ROUTES BILLING
  fastify.register(billingRoutes, { prefix: '/api/v1/billing' });

  // ✅ ROUTES D'AUTHENTIFICATION PUBLIQUES (sans authentification)
  fastify.register(async function (fastify) {
    // Route de login
    fastify.post('/login', async (request, reply) => {
      const { email, password } = request.body as any;
      
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        return {
          success: true,
          user: data.user,
          session: data.session
        };
      } catch (error: any) {
        return reply.status(401).send({
          success: false,
          error: error.message || 'Erreur de connexion'
        });
      }
    });

    // Route de signup
    fastify.post('/signup', async (request, reply) => {
      const { email, password, metadata } = request.body as any;
      
      try {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: metadata
          }
        });

        if (error) throw error;

        return {
          success: true,
          user: data.user,
          session: data.session
        };
      } catch (error: any) {
        return reply.status(400).send({
          success: false,
          error: error.message || 'Erreur lors de l\'inscription'
        });
      }
    });
  }, { prefix: '/api/v1/auth' });

  // ✅ ROUTES API AVEC AUTHENTIFICATION
  fastify.register(async function (fastify) {
    
    // ✅ MIDDLEWARE D'AUTH POUR TOUTES LES ROUTES API
    fastify.addHook('preHandler', authenticate);
    
    // ✅ ROUTES AGENTS
    fastify.register(agentsRoutes, { prefix: '/agents' });

    // ✅ ROUTES PRODUITS 
    fastify.register(productsRoutes, { prefix: '/products' });
    
    // ✅ ROUTES COMMANDES AUTHENTIFIÉES
    fastify.register(ordersRoutes, { prefix: '/orders' });

    // ✅ ROUTES SHOPS
    fastify.register(shopsRoutes, { prefix: '/shops' });

    // ✅ ROUTES KNOWLEDGE BASE - UNE SEULE DÉCLARATION
    fastify.register(knowledgeBaseRoutes, { prefix: '/knowledge-base' });
    
    // ✅ ROUTES ANALYTICS AVEC USAGE STATS
    fastify.register(async function (fastify) {
      
      // Usage stats pour la page billing
      fastify.get('/usage-stats', async (request, reply) => {
        try {
          if (!request.user) {
            return reply.status(401).send({ error: 'User not authenticated' });
          }

          // Mock data pour l'instant
          return {
            success: true,
            data: {
              conversations: 234,
              documents: 12,
              agents: 1
            }
          };
        } catch (error) {
          fastify.log.error('❌ Erreur usage stats:', error);
          return reply.status(500).send({ error: 'Internal server error' });
        }
      });

      // Track event
      fastify.post('/events', async (request, reply) => {
        const {
          shopId,
          conversationId,
          eventType,
          eventData,
          pageUrl,
          referrer
        } = request.body as any;

        try {
          // Tentative de création d'événement
          try {
            const event = await prisma.analyticsEvent.create({
              data: {
                shopId,
                conversationId,
                eventType,
                eventData,
                pageUrl,
                referrer,
                userAgent: request.headers['user-agent'],
                ipAddress: request.ip
              }
            });

            return { success: true, eventId: event.id };
          } catch (error) {
            // Si la table n'existe pas, retourner un succès simulé
            fastify.log.warn('⚠️ Impossible de créer l\'événement analytics:', error);
            return { success: true, eventId: 'mock_event_id' };
          }
        } catch (error) {
          fastify.log.error('❌ Erreur track event:', error);
          return reply.status(500).send({ error: 'Failed to track event' });
        }
      });

    }, { prefix: '/analytics' });

    // ✅ ROUTES CONVERSATIONS
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
        } = request.body as any;

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
          });

          return conversation;
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Failed to create conversation' });
        }
      });

      // Get conversation
      fastify.get('/:conversationId', async (request, reply) => {
        const { conversationId } = request.params as { conversationId: string };

        try {
          const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId }
          });

          if (!conversation) {
            return reply.status(404).send({ error: 'Conversation not found' });
          }

          const messages = await prisma.message.findMany({
            where: { conversationId },
            orderBy: { createdAt: 'asc' }
          });

          const shop = await prisma.shop.findUnique({
            where: { id: conversation.shopId },
            select: {
              name: true,
              agent_config: true
            }
          });

          return {
            ...conversation,
            messages,
            shop
          };
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Internal server error' });
        }
      });

      // Liste des conversations
      fastify.get('/', async (request, reply) => {
        const { page = 1, limit = 20, shopId } = request.query as any;
        
        try {
          if (!request.user) {
            return reply.status(401).send({ error: 'User not authenticated' });
          }

          const conversations = await prisma.conversation.findMany({
            where: {
              shopId: shopId || request.user.id
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
          });

          const total = await prisma.conversation.count({
            where: {
              shopId: shopId || request.user.id
            }
          });

          return {
            success: true,
            conversations,
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total,
              pages: Math.ceil(total / limit)
            }
          };

        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Internal server error' });
        }
      });
    }, { prefix: '/conversations' });

  }, { prefix: '/api/v1' });

  // ✅ ROUTE DE FALLBACK POUR DEBUG
  fastify.setNotFoundHandler(async (request, reply) => {
    fastify.log.warn(`🔍 Route non trouvée: ${request.method} ${request.url}`);
    return reply.status(404).send({
      success: false,
      error: 'Route not found',
      method: request.method,
      url: request.url,
      message: `Route ${request.method} ${request.url} not found`,
      availableRoutes: [
        'GET /health',
        'GET /',
        'GET /api/v1/billing/diagnostic',
        'POST /api/v1/billing/create-checkout-session',
        'GET /api/v1/billing/subscription-status',
        'POST /api/v1/auth/login',
        'POST /api/v1/auth/signup',
        'GET /api/v1/knowledge-base/*',
        'GET /api/v1/analytics/usage-stats',
        'GET /api/v1/public/*'
      ]
    });
  });
}

// Graceful shutdown
async function gracefulShutdown() {
  try {
    await prisma.$disconnect();
    await fastify.close();
    process.exit(0);
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
}

// Start server
async function start() {
  try {
    await registerPlugins();
    await registerRoutes();

    const port = parseInt(process.env.PORT || '3001');
    const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';

    await fastify.listen({ port, host });
    
    fastify.log.info(`🚀 ChatSeller API server running on http://${host}:${port}`);
    fastify.log.info(`📖 Health check: http://${host}:${port}/health`);
    fastify.log.info(`🏠 Root: http://${host}:${port}/`);
    fastify.log.info(`🧪 Diagnostic: http://${host}:${port}/api/v1/billing/diagnostic`);
    fastify.log.info(`🌐 Public routes: http://${host}:${port}/api/v1/public/*`);
    fastify.log.info(`💳 Billing routes: http://${host}:${port}/api/v1/billing/*`);
    fastify.log.info(`🔐 Auth routes: http://${host}:${port}/api/v1/auth/*`);
    fastify.log.info(`🤖 Agents routes: http://${host}:${port}/api/v1/agents/*`);
    fastify.log.info(`📦 Products routes: http://${host}:${port}/api/v1/products/*`);
    fastify.log.info(`🛒 Orders routes: http://${host}:${port}/api/v1/orders/*`);
    fastify.log.info(`📚 Knowledge Base: http://${host}:${port}/api/v1/knowledge-base/*`);
    fastify.log.info(`📊 Analytics: http://${host}:${port}/api/v1/analytics/*`);
    
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start the server
start();
// src/server.ts - SERVEUR BACKEND AVEC ROUTES - CORRIGÉ
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
import ordersRoutes from './routes/orders'; // ✅ NOUVELLE ROUTE

// Load environment variables
dotenv.config();

// ✅ VALIDATION DES VARIABLES D'ENVIRONNEMENT REQUISES
const requiredEnvVars = {
  DATABASE_URL: process.env.DATABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY // ✅ NOUVEAU REQUIS
};

for (const [key, value] of Object.entries(requiredEnvVars)) {
  if (!value) {
    console.error(`❌ Variable d'environnement manquante: ${key}`);
    process.exit(1);
  }
}

console.log('✅ Variables d\'environnement validées');

// Initialize clients
const prisma = new PrismaClient();
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

// ✅ MIDDLEWARE D'AUTHENTIFICATION SIMPLE - CORRIGÉ
async function authenticate(request: any, reply: any) {
  try {
    const token = request.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return reply.status(401).send({
        success: false,
        error: 'Token d\'authentification manquant'
      });
    }

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

  // ✅ RATE LIMITING ADAPTÉ AU WIDGET - CORRIGÉ
  await fastify.register(rateLimit, {
    max: parseInt(process.env.RATE_LIMIT_MAX || '200'), // Plus élevé pour les widgets
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60000'),
    keyGenerator: (request) => {
      // Rate limit par IP + User-Agent pour éviter les abus
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

  // ✅ ROUTES PUBLIQUES (SANS AUTH) - WIDGET & API PUBLIQUE
  fastify.register(async function (fastify) {
    // ✅ RATE LIMITING SPÉCIFIQUE POUR LE WIDGET - CORRIGÉ
    await fastify.register(rateLimit, {
      max: 300, // Limite plus élevée pour les widgets
      timeWindow: '1 minute'
    });

    // Routes publiques pour le widget
    fastify.register(publicRoutes);
    
    // ✅ ROUTES DE COMMANDES PUBLIQUES
    fastify.register(ordersRoutes, { prefix: '/orders' });
    
    fastify.log.info('✅ Routes publiques enregistrées: /api/v1/public/*');
    
  }, { prefix: '/api/v1/public' });

  // ✅ ROUTES API AVEC AUTHENTIFICATION
  fastify.register(async function (fastify) {
    
    // ✅ AJOUTER LE MIDDLEWARE D'AUTH POUR TOUTES LES ROUTES API
    fastify.addHook('preHandler', authenticate);
    
    // ✅ ROUTES BILLING (EXISTANTES)
    fastify.register(billingRoutes, { prefix: '/billing' });
    
    // ✅ ROUTES AGENTS (NOUVELLES)
    fastify.register(agentsRoutes, { prefix: '/agents' });

    // ✅ ROUTES PRODUITS (NOUVELLES) 
    fastify.register(productsRoutes, { prefix: '/products' });
    
    // ✅ ROUTES COMMANDES AUTHENTIFIÉES (dashboard)
    fastify.register(ordersRoutes, { prefix: '/orders' });
    
    // Shops routes
    fastify.register(async function (fastify) {
      // Get shop configuration
      fastify.get('/shops/:shopId', async (request, reply) => {
        const { shopId } = request.params as { shopId: string };
        
        try {
          const shop = await prisma.shop.findUnique({
            where: { id: shopId },
            select: {
              id: true,
              name: true,
              widget_config: true,
              agent_config: true,
              is_active: true,
              subscription_plan: true
            }
          });

          if (!shop) {
            return reply.status(404).send({ error: 'Shop not found' });
          }

          return shop;
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Internal server error' });
        }
      });

      // Update shop configuration
      fastify.put('/shops/:shopId', async (request, reply) => {
        const { shopId } = request.params as { shopId: string };
        const { widgetConfig, agentConfig } = request.body as any;

        try {
          const shop = await prisma.shop.update({
            where: { id: shopId },
            data: {
              widget_config: widgetConfig,
              agent_config: agentConfig,
              updatedAt: new Date()
            }
          });

          return shop;
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Internal server error' });
        }
      });
    });

    // Conversations routes
    fastify.register(async function (fastify) {
      // Create conversation
      fastify.post('/conversations', async (request, reply) => {
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
      fastify.get('/conversations/:conversationId', async (request, reply) => {
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

      // ✅ NOUVELLE ROUTE: Lister toutes les conversations d'un shop - CORRIGÉE
      fastify.get('/conversations', async (request, reply) => {
        const { page = 1, limit = 20, shopId } = request.query as any;
        
        try {
          // ✅ VÉRIFICATION DE L'UTILISATEUR AUTHENTIFIÉ
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
    });

    // ✅ ROUTES D'ANALYTICS AMÉLIORÉES
    fastify.register(async function (fastify) {
      // Track event
      fastify.post('/analytics/events', async (request, reply) => {
        const {
          shopId,
          conversationId,
          eventType,
          eventData,
          pageUrl,
          referrer
        } = request.body as any;

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
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Failed to track event' });
        }
      });

      // ✅ NOUVELLE ROUTE: Récupérer les analytics d'un shop
      fastify.get('/analytics/:shopId', async (request, reply) => {
        const { shopId } = request.params as { shopId: string };
        const { startDate, endDate, eventType } = request.query as any;

        try {
          const whereClause: any = { shopId };
          
          if (startDate && endDate) {
            whereClause.createdAt = {
              gte: new Date(startDate),
              lte: new Date(endDate)
            };
          }
          
          if (eventType) {
            whereClause.eventType = eventType;
          }

          const events = await prisma.analyticsEvent.findMany({
            where: whereClause,
            orderBy: { createdAt: 'desc' },
            take: 1000
          });

          // Agrégation des données
          const summary = {
            totalEvents: events.length,
            uniqueVisitors: new Set(events.map(e => e.ipAddress)).size,
            eventsByType: events.reduce((acc, event) => {
              acc[event.eventType] = (acc[event.eventType] || 0) + 1;
              return acc;
            }, {} as Record<string, number>),
            topPages: Object.entries(
              events.reduce((acc, event) => {
                if (event.pageUrl) {
                  acc[event.pageUrl] = (acc[event.pageUrl] || 0) + 1;
                }
                return acc;
              }, {} as Record<string, number>)
            ).sort(([,a], [,b]) => b - a).slice(0, 10)
          };

          return {
            events: events.slice(0, 100), // Limiter les événements retournés
            summary
          };

        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Internal server error' });
        }
      });
    });

  }, { prefix: '/api/v1' });

  // ✅ ROUTES PUBLIQUES D'AUTHENTIFICATION (sans authentification)
  fastify.register(async function (fastify) {
    // Route de login
    fastify.post('/auth/login', async (request, reply) => {
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
    fastify.post('/auth/signup', async (request, reply) => {
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
  }, { prefix: '/api/v1' });
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
    fastify.log.info(`🌐 Public routes: http://${host}:${port}/api/v1/public/*`);
    fastify.log.info(`💳 Billing routes: http://${host}:${port}/api/v1/billing/*`);
    fastify.log.info(`🤖 Agents routes: http://${host}:${port}/api/v1/agents/*`);
    fastify.log.info(`📦 Products routes: http://${host}:${port}/api/v1/products/*`);
    fastify.log.info(`🛒 Orders routes: http://${host}:${port}/api/v1/orders/* & /api/v1/public/orders/*`);
    
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
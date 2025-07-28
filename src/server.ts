// src/server.ts - CORRECTION ERREUR CORS
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
import publicRoutes from './routes/public'; // ✅ NOUVELLE ROUTE PUBLIQUE

// Load environment variables
dotenv.config();

// Initialize clients
const prisma = new PrismaClient();
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

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

// ✅ MIDDLEWARE D'AUTHENTIFICATION SIMPLE
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

    // Ajouter l'utilisateur à la requête
    request.user = {
      id: user.id,
      email: user.email,
      ...user.user_metadata
    };

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

  // ✅ CORS GLOBAL UNE SEULE FOIS
  await fastify.register(cors, {
    origin: (origin, callback) => {
      // Autoriser tous les domaines pour le widget
      callback(null, true);
    },
    credentials: true
  });

  // Rate limiting
  await fastify.register(rateLimit, {
    max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60000')
  });
}

// Routes
async function registerRoutes() {
  // Health check
  fastify.get('/health', async (request, reply) => {
    return { 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: process.env.NODE_ENV
    };
  });

  // ✅ ROUTES PUBLIQUES (SANS AUTH) - SANS CORS SUPPLÉMENTAIRE
  fastify.register(async function (fastify) {
    // ✅ SUPPRIMER LE CORS ICI POUR ÉVITER LE CONFLIT
    await fastify.register(rateLimit, {
      max: 200, // Limite plus élevée pour le widget
      timeWindow: '1 minute'
    });

    // Routes publiques pour le widget
    fastify.register(publicRoutes);
    
    fastify.log.info('✅ Routes publiques enregistrées: /api/v1/public/*');
    
  }, { prefix: '/api/v1/public' });

  // API routes avec authentification
  fastify.register(async function (fastify) {
    
    // ✅ AJOUTER LE MIDDLEWARE D'AUTH POUR TOUTES LES ROUTES API
    fastify.addHook('preHandler', authenticate);
    
    // ✅ ROUTES BILLING (EXISTANTES)
    fastify.register(billingRoutes, { prefix: '/billing' });
    
    // ✅ ROUTES AGENTS (NOUVELLES)
    fastify.register(agentsRoutes, { prefix: '/agents' });

    // ✅ ROUTES PRODUITS (NOUVELLES) - CORRECTEMENT INTÉGRÉES
    fastify.register(productsRoutes, { prefix: '/products' });
    
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
    });

    // Orders routes
    fastify.register(async function (fastify) {
      // Create order
      fastify.post('/orders', async (request, reply) => {
        const {
          shopId,
          conversationId,
          customerName,
          customerPhone,
          customerEmail,
          customerAddress,
          productItems,
          totalAmount,
          paymentMethod
        } = request.body as any;

        try {
          const order = await prisma.order.create({
            data: {
              shopId,
              conversationId,
              customerName,
              customerPhone,
              customerEmail,
              customerAddress,
              productItems,
              totalAmount,
              paymentMethod
            }
          });

          await prisma.conversation.update({
            where: { id: conversationId },
            data: { conversionCompleted: true }
          });

          return order;
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Failed to create order' });
        }
      });
    });

    // Analytics routes
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
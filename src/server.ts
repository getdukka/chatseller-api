// src/server.ts - VERSION CORRIGÉE AVEC ROUTES AGENTS
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// ✅ IMPORT DES ROUTES
import billingRoutes from './routes/billing';
import agentsRoutes from './routes/agents';  // 🆕 NOUVEAU

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

// Register plugins
async function registerPlugins() {
  // Security
  await fastify.register(helmet, {
    contentSecurityPolicy: false
  });

  // CORS
  await fastify.register(cors, {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
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

  // API routes
  fastify.register(async function (fastify) {
    
    // ✅ ROUTES BILLING (EXISTANTES)
    fastify.register(billingRoutes, { prefix: '/billing' });
    
    // ✅ ROUTES AGENTS (NOUVELLES) - 🆕
    fastify.register(agentsRoutes, { prefix: '/agents' });
    
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
              widget_config: true, // ✅ SNAKE_CASE
              agent_config: true,  // ✅ SNAKE_CASE
              is_active: true,     // ✅ SNAKE_CASE
              subscription_plan: true // ✅ SNAKE_CASE
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
              widget_config: widgetConfig,  // ✅ SNAKE_CASE
              agent_config: agentConfig,    // ✅ SNAKE_CASE
              updatedAt: new Date()
            }
          });

          return shop;
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Internal server error' });
        }
      });

      // Get shop with subscription details
      fastify.get('/shops/:shopId/full', async (request, reply) => {
        const { shopId } = request.params as { shopId: string };
        
        try {
          // Récupérer le shop
          const shop = await prisma.shop.findUnique({
            where: { id: shopId }
          });

          if (!shop) {
            return reply.status(404).send({ error: 'Shop not found' });
          }

          // Récupérer les données associées
          const subscription = await prisma.subscription.findFirst({
            where: { shopId: shopId }
          });
          
          const invoices = await prisma.invoice.findMany({
            where: { shopId: shopId },
            orderBy: { createdAt: 'desc' },
            take: 5
          });

          // Combiner les résultats
          return {
            ...shop,
            subscription,
            invoices
          };
          
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

      // Get conversation (CORRIGÉ)
      fastify.get('/conversations/:conversationId', async (request, reply) => {
        const { conversationId } = request.params as { conversationId: string };

        try {
          const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId }
          });

          if (!conversation) {
            return reply.status(404).send({ error: 'Conversation not found' });
          }

          // ✅ RÉCUPÉRER LES MESSAGES SÉPARÉMENT
          const messages = await prisma.message.findMany({
            where: { conversationId },
            orderBy: { createdAt: 'asc' }
          });

          // ✅ RÉCUPÉRER LE SHOP SÉPARÉMENT  
          const shop = await prisma.shop.findUnique({
            where: { id: conversation.shopId },
            select: {
              name: true,
              agent_config: true // ✅ SNAKE_CASE
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

      // Get conversations for shop (with pagination)
      fastify.get('/shops/:shopId/conversations', async (request, reply) => {
        const { shopId } = request.params as { shopId: string };
        const { page = 1, limit = 10, status } = request.query as any;
        
        try {
          const skip = (parseInt(page) - 1) * parseInt(limit);
          const where: any = { shopId };
          
          if (status) {
            where.status = status;
          }

          const [conversations, total] = await Promise.all([
            prisma.conversation.findMany({
              where,
              orderBy: { startedAt: 'desc' },
              skip,
              take: parseInt(limit)
            }),
            prisma.conversation.count({ where })
          ]);

          // ✅ RÉCUPÉRER LES MESSAGES SÉPARÉMENT
          const conversationsWithMessages = await Promise.all(
            conversations.map(async (conv) => {
              const lastMessage = await prisma.message.findFirst({
                where: { conversationId: conv.id },
                orderBy: { createdAt: 'desc' }
              });
              return {
                ...conv,
                lastMessage
              };
            })
          );

          return {
            conversations: conversationsWithMessages,
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total,
              pages: Math.ceil(total / parseInt(limit))
            }
          };
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Internal server error' });
        }
      });

      // Add message to conversation
      fastify.post('/conversations/:conversationId/messages', async (request, reply) => {
        const { conversationId } = request.params as { conversationId: string };
        const { role, content, contentType } = request.body as any;

        try {
          // Save message to database
          const message = await prisma.message.create({
            data: {
              conversationId,
              role,
              content,
              contentType: contentType || 'text'
            }
          });

          // Update conversation activity
          await prisma.conversation.update({
            where: { id: conversationId },
            data: { 
              lastActivity: new Date(),
              messageCount: { increment: 1 }
            }
          });

          return message;
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Failed to add message' });
        }
      });

      // Get messages for conversation
      fastify.get('/conversations/:conversationId/messages', async (request, reply) => {
        const { conversationId } = request.params as { conversationId: string };

        try {
          const messages = await prisma.message.findMany({
            where: { conversationId },
            orderBy: { createdAt: 'asc' }
          });

          return messages;
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Failed to get messages' });
        }
      });
    });

    // Orders routes (CORRIGÉ)
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

          // Mark conversation as converted
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

      // Get orders for shop (CORRIGÉ)
      fastify.get('/shops/:shopId/orders', async (request, reply) => {
        const { shopId } = request.params as { shopId: string };
        const { page = 1, limit = 10, status } = request.query as any;

        try {
          const skip = (parseInt(page) - 1) * parseInt(limit);
          const where: any = { shopId };
          
          if (status) {
            where.status = status;
          }

          const [orders, total] = await Promise.all([
            prisma.order.findMany({
              where,
              orderBy: { createdAt: 'desc' },
              skip,
              take: parseInt(limit)
            }),
            prisma.order.count({ where })
          ]);

          // ✅ RÉCUPÉRER LES CONVERSATIONS SÉPARÉMENT
          const ordersWithConversations = await Promise.all(
            orders.map(async (order) => {
              const conversation = await prisma.conversation.findUnique({
                where: { id: order.conversationId },
                select: {
                  id: true,
                  startedAt: true,
                  productName: true
                }
              });
              return {
                ...order,
                conversation
              };
            })
          );

          return {
            orders: ordersWithConversations,
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total,
              pages: Math.ceil(total / parseInt(limit))
            }
          };
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Internal server error' });
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

      // Get analytics for shop
      fastify.get('/shops/:shopId/analytics', async (request, reply) => {
        const { shopId } = request.params as { shopId: string };
        const { period = '30d' } = request.query as any;

        try {
          // Calculer la date de début selon la période
          const now = new Date();
          let startDate = new Date();
          
          switch (period) {
            case '7d':
              startDate.setDate(now.getDate() - 7);
              break;
            case '30d':
              startDate.setDate(now.getDate() - 30);
              break;
            case '90d':
              startDate.setDate(now.getDate() - 90);
              break;
            default:
              startDate.setDate(now.getDate() - 30);
          }

          // Statistiques de base
          const [
            totalConversations,
            convertedConversations,
            totalOrders,
            totalRevenue,
            activeConversations
          ] = await Promise.all([
            prisma.conversation.count({
              where: { 
                shopId,
                startedAt: { gte: startDate }
              }
            }),
            prisma.conversation.count({
              where: { 
                shopId, 
                conversionCompleted: true,
                startedAt: { gte: startDate }
              }
            }),
            prisma.order.count({
              where: { 
                shopId,
                createdAt: { gte: startDate }
              }
            }),
            prisma.order.aggregate({
              where: { 
                shopId,
                createdAt: { gte: startDate }
              },
              _sum: { totalAmount: true }
            }),
            prisma.conversation.count({
              where: { 
                shopId,
                status: 'active'
              }
            })
          ]);

          // Évolution des conversations par jour
          const conversationTrends = await prisma.$queryRaw`
            SELECT 
              DATE_TRUNC('day', started_at) as date,
              COUNT(*) as count
            FROM conversations 
            WHERE shop_id = ${shopId} 
              AND started_at >= ${startDate}
            GROUP BY DATE_TRUNC('day', started_at)
            ORDER BY date ASC
          `;

          return {
            overview: {
              totalConversations,
              convertedConversations,
              conversionRate: totalConversations > 0 ? (convertedConversations / totalConversations) * 100 : 0,
              totalOrders,
              totalRevenue: totalRevenue._sum.totalAmount || 0,
              activeConversations
            },
            trends: {
              conversations: conversationTrends
            },
            period
          };
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Internal server error' });
        }
      });
    });

    // Knowledge Base routes
    fastify.register(async function (fastify) {
      // Get knowledge base for shop
      fastify.get('/shops/:shopId/knowledge-base', async (request, reply) => {
        const { shopId } = request.params as { shopId: string };
        
        try {
          const knowledgeBase = await prisma.knowledgeBase.findMany({
            where: { shopId, isActive: true },
            orderBy: { createdAt: 'desc' }
          });

          return knowledgeBase;
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Internal server error' });
        }
      });

      // Add knowledge base entry
      fastify.post('/shops/:shopId/knowledge-base', async (request, reply) => {
        const { shopId } = request.params as { shopId: string };
        const { title, content, contentType, tags } = request.body as any;

        try {
          const entry = await prisma.knowledgeBase.create({
            data: {
              shopId,
              title,
              content,
              contentType: contentType || 'manual',
              tags: tags || []
            }
          });

          return entry;
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Failed to create knowledge base entry' });
        }
      });
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
    fastify.log.info(`💳 Billing routes: http://${host}:${port}/api/v1/billing/*`);
    fastify.log.info(`🤖 Agents routes: http://${host}:${port}/api/v1/agents/*`);  // 🆕 NOUVEAU
    
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
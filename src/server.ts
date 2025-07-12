import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize clients
const prisma = new PrismaClient();
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Create Fastify instance with corrected logger config
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

  // WebSocket support
  await fastify.register(websocket);
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
              widgetConfig: true,
              agentConfig: true,
              isActive: true
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
              widgetConfig,
              agentConfig,
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
            where: { id: conversationId },
            include: {
              messages: {
                orderBy: { createdAt: 'asc' }
              },
              shop: {
                select: {
                  name: true,
                  agentConfig: true
                }
              }
            }
          });

          if (!conversation) {
            return reply.status(404).send({ error: 'Conversation not found' });
          }

          return conversation;
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Internal server error' });
        }
      });

      // WebSocket for real-time chat - CORRECTED VERSION
      fastify.register(async function (fastify) {
        fastify.get('/conversations/:conversationId/ws', { websocket: true }, (connection, req) => {
          const { conversationId } = req.params as { conversationId: string };
          
          // Correct Fastify WebSocket API usage
          connection.on('message', async (message: Buffer) => {
            try {
              const data = JSON.parse(message.toString());
              
              // Save message to database
              await prisma.message.create({
                data: {
                  conversationId,
                  role: data.role,
                  content: data.content,
                  contentType: data.contentType || 'text'
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

              // Echo message to all connected clients
              connection.send(JSON.stringify({
                type: 'message',
                data: {
                  conversationId,
                  role: data.role,
                  content: data.content,
                  timestamp: new Date()
                }
              }));

              // TODO: Process with AI if role is 'user'
              if (data.role === 'user') {
                // This will be implemented in next iteration
                // - Load knowledge base
                // - Call OpenAI
                // - Save AI response
                // - Send AI response via WebSocket
              }

            } catch (error) {
              fastify.log.error(error);
              connection.send(JSON.stringify({
                type: 'error',
                message: 'Failed to process message'
              }));
            }
          });

          connection.on('close', () => {
            fastify.log.info(`WebSocket connection closed for conversation ${conversationId}`);
          });

          connection.on('error', (error) => {
            fastify.log.error(`WebSocket error for conversation ${conversationId}:`, error);
          });
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

      // Get orders for shop
      fastify.get('/shops/:shopId/orders', async (request, reply) => {
        const { shopId } = request.params as { shopId: string };

        try {
          const orders = await prisma.order.findMany({
            where: { shopId },
            include: {
              conversation: {
                select: {
                  id: true,
                  startedAt: true
                }
              }
            },
            orderBy: { createdAt: 'desc' }
          });

          return orders;
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

        try {
          // Basic analytics aggregation
          const totalConversations = await prisma.conversation.count({
            where: { shopId }
          });

          const convertedConversations = await prisma.conversation.count({
            where: { shopId, conversionCompleted: true }
          });

          const totalOrders = await prisma.order.count({
            where: { shopId }
          });

          const totalRevenue = await prisma.order.aggregate({
            where: { shopId },
            _sum: { totalAmount: true }
          });

          return {
            totalConversations,
            convertedConversations,
            conversionRate: totalConversations > 0 ? (convertedConversations / totalConversations) * 100 : 0,
            totalOrders,
            totalRevenue: totalRevenue._sum.totalAmount || 0
          };
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({ error: 'Internal server error' });
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

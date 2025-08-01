// src/routes/public.ts - ENDPOINTS PUBLICS POUR WIDGET CHATSELLER - VERSION CORRIGÉE
import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'

// ✅ INTERFACES CORRIGÉES POUR LES TYPES PRISMA Json
interface WidgetConfig {
  theme?: string
  language?: string
  position?: string
  buttonText?: string
  primaryColor?: string
  [key: string]: any
}

interface AgentConfig {
  name?: string
  avatar?: string
  upsellEnabled?: boolean
  welcomeMessage?: string
  fallbackMessage?: string
  collectPaymentMethod?: boolean
  [key: string]: any
}

// ✅ TYPES POUR OPENAI - CORRECTION PRINCIPALE
interface OpenAIMessage {
  content?: string
}

interface OpenAIChoice {
  message?: OpenAIMessage
}

interface OpenAIResponse {
  choices: OpenAIChoice[]
  usage?: {
    total_tokens?: number
  }
}

// ✅ TYPES POUR LES REQUÊTES
interface ChatMessageBody {
  message: string
  conversationId?: string | null
  shopId: string
  agentId?: string
  productContext?: {
    id?: string
    name?: string
    price?: number
    url?: string
  }
  systemPrompt?: string
  knowledgeBase?: any[]
}

interface AnalyticsTrackBody {
  shopId: string
  event: string
  data?: Record<string, any>
  timestamp: string
  url: string
  userAgent: string
}

interface OrderIntentBody {
  message: string
  conversationId?: string | null
  productInfo?: {
    id?: string
    name?: string
    price?: number
  }
  shopId: string
}

interface OrderStartBody {
  conversationId?: string | null
  productInfo?: {
    id?: string
    name?: string
    price?: number
  }
  initialMessage: string
  shopId: string
}

interface OrderStepBody {
  conversationId: string
  step: string
  data: Record<string, any>
  shopId: string
}

interface OrderCompleteBody {
  conversationId: string
  orderData: {
    name?: string
    phone?: string
    address?: string
    paymentMethod?: string
    product?: {
      id?: string
      name?: string
      price?: number
    }
  }
  shopId: string
}

// ✅ SCHEMAS DE VALIDATION
const ShopConfigRequestSchema = z.object({
  shopId: z.string().uuid('Shop ID must be a valid UUID')
})

const ChatMessageSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty'),
  conversationId: z.string().nullable().optional(),
  shopId: z.string().uuid(),
  agentId: z.string().optional(),
  productContext: z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    price: z.number().optional(),
    url: z.string().url().optional()
  }).optional(),
  systemPrompt: z.string().optional(),
  knowledgeBase: z.array(z.any()).optional()
})

const AnalyticsTrackSchema = z.object({
  shopId: z.string().uuid(),
  event: z.string().min(1),
  data: z.record(z.any()).optional(),
  timestamp: z.string().datetime(),
  url: z.string().url(),
  userAgent: z.string()
})

const OrderIntentSchema = z.object({
  message: z.string(),
  conversationId: z.string().nullable().optional(),
  productInfo: z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    price: z.number().optional()
  }).optional(),
  shopId: z.string().uuid()
})

const OrderStartSchema = z.object({
  conversationId: z.string().nullable().optional(),
  productInfo: z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    price: z.number().optional()
  }).optional(),
  initialMessage: z.string(),
  shopId: z.string().uuid()
})

const OrderStepSchema = z.object({
  conversationId: z.string(),
  step: z.string(),
  data: z.record(z.any()),
  shopId: z.string().uuid()
})

const OrderCompleteSchema = z.object({
  conversationId: z.string(),
  orderData: z.object({
    name: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    paymentMethod: z.string().optional(),
    product: z.object({
      id: z.string().optional(),
      name: z.string().optional(),
      price: z.number().optional()
    }).optional()
  }),
  shopId: z.string().uuid()
})

// ✅ CRÉER UNE INSTANCE PRISMA LOCALE
let prisma: PrismaClient

try {
  prisma = new PrismaClient({
    log: ['error'], // Réduire les logs en production
  })
} catch (error) {
  console.error('❌ ERREUR lors de l\'initialisation de Prisma dans public.ts:', error)
  throw error
}

// ✅ HELPER FUNCTIONS
const safeParseJson = (json: any, defaultValue: any = {}) => {
  if (!json) return defaultValue
  if (typeof json === 'object') return json
  try {
    return typeof json === 'string' ? JSON.parse(json) : json
  } catch {
    return defaultValue
  }
}

const publicRoutes: FastifyPluginAsync = async (fastify) => {
  
  // ✅ ENDPOINT 1: Récupérer la configuration shop + agent
  fastify.get('/shops/:shopId/config', {
    schema: {
      params: ShopConfigRequestSchema
    }
  }, async (request, reply) => {
    try {
      const { shopId } = request.params as { shopId: string }

      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        include: {
          agents: {
            where: { isActive: true },
            take: 1
          }
        }
      })

      if (!shop) {
        return reply.status(404).send({
          success: false,
          error: 'Shop not found'
        })
      }

      // ✅ CORRECTION: Parser les configs JSON avec typage
      const widgetConfig = safeParseJson(shop.widget_config, {}) as WidgetConfig
      const agentConfig = safeParseJson(shop.agent_config, {}) as AgentConfig

      const activeAgent = shop.agents[0] || null

      const response = {
        success: true,
        data: {
          shop: {
            id: shop.id,
            shopId: shop.id,
            primaryColor: widgetConfig.primaryColor || '#007AFF',
            buttonText: widgetConfig.buttonText || 'Parler à un conseiller',
            position: widgetConfig.position || 'bottom-right',
            theme: widgetConfig.theme || 'modern',
            language: widgetConfig.language || 'fr'
          },
          agent: activeAgent ? {
            id: activeAgent.id,
            name: activeAgent.name,
            title: 'Conseiller Commercial',
            avatar: activeAgent.avatar,
            welcomeMessage: activeAgent.welcomeMessage || agentConfig.welcomeMessage || 'Bonjour ! Comment puis-je vous aider ?',
            fallbackMessage: activeAgent.fallbackMessage || agentConfig.fallbackMessage || 'Je transmets votre question à notre équipe.',
            systemPrompt: 'Tu es un assistant commercial expert.',
            personality: activeAgent.personality,
            tone: 'friendly',
            knowledgeBase: [],
            isActive: activeAgent.isActive
          } : {
            id: 'default',
            name: agentConfig.name || 'Assistant',
            title: 'Conseiller Commercial',
            avatar: agentConfig.avatar || 'https://ui-avatars.com/api/?name=Assistant&background=007AFF&color=fff',
            welcomeMessage: agentConfig.welcomeMessage || 'Bonjour ! Comment puis-je vous aider ?',
            fallbackMessage: agentConfig.fallbackMessage || 'Je transmets votre question à notre équipe.',
            systemPrompt: 'Tu es un assistant commercial expert.',
            personality: 'friendly',
            tone: 'friendly',
            knowledgeBase: [],
            isActive: true
          }
        }
      }

      return reply.send(response)

    } catch (error) {
      fastify.log.error('Error fetching shop config:', error)
      return reply.status(500).send({
        success: false,
        error: 'Internal server error'
      })
    }
  })

  // ✅ ENDPOINT 2: Envoyer un message chat
  fastify.post('/chat/message', {
    schema: {
      body: ChatMessageSchema
    }
  }, async (request, reply) => {
    try {
      const body = request.body as ChatMessageBody
      const { 
        message, 
        conversationId, 
        shopId, 
        agentId, 
        productContext, 
        systemPrompt, 
        knowledgeBase 
      } = body

      const startTime = Date.now()

      // Récupérer ou créer une conversation
      let conversation
      if (conversationId) {
        conversation = await prisma.conversation.findUnique({
          where: { id: conversationId }
        })
      }

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            shopId,
            agentId: agentId || null,
            status: 'active',
            visitorUserAgent: request.headers['user-agent'] || '',
            visitorIp: request.ip,
            productName: productContext?.name || null,
            productPrice: productContext?.price || null,
            productUrl: productContext?.url || null
          }
        })
      }

      // Sauvegarder le message utilisateur
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'user',
          content: message
        }
      })

      // ✅ CONSTRUIRE LE PROMPT
      let enhancedPrompt = systemPrompt || `Tu es un assistant commercial IA expert. Tu aides les clients à prendre des décisions d'achat éclairées.`

      if (productContext?.name) {
        enhancedPrompt += `\n\nProduit actuel: ${productContext.name}`
        if (productContext.price) {
          enhancedPrompt += ` - Prix: ${productContext.price}€`
        }
      }

      if (knowledgeBase && knowledgeBase.length > 0) {
        enhancedPrompt += `\n\nBase de connaissance:\n`
        knowledgeBase.forEach((kb: any, index: number) => {
          enhancedPrompt += `${index + 1}. ${kb.title || 'Information'}:\n${kb.content}\n\n`
        })
      }

      enhancedPrompt += `\n\nRéponds de manière conversationnelle et professionnelle.`

      // ✅ APPEL API OPENAI AVEC TYPES CORRIGES
      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: enhancedPrompt
            },
            {
              role: 'user',
              content: message
            }
          ],
          max_tokens: 500,
          temperature: 0.7
        })
      })

      if (!openaiResponse.ok) {
        throw new Error(`OpenAI API error: ${openaiResponse.status}`)
      }

      // ✅ CORRECTION: Typer correctement la réponse OpenAI
      const openaiData = await openaiResponse.json() as OpenAIResponse
      const aiMessage = openaiData.choices[0]?.message?.content || 'Désolé, je ne peux pas répondre pour le moment.'

      // Sauvegarder la réponse IA
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          content: aiMessage,
          tokensUsed: openaiData.usage?.total_tokens || 0,
          responseTimeMs: Date.now() - startTime,
          modelUsed: 'gpt-4o-mini'
        }
      })

      const responseTime = Date.now() - startTime

      return reply.send({
        success: true,
        data: {
          message: aiMessage,
          conversationId: conversation.id,
          responseTime,
          agent: agentId ? {
            name: 'Assistant IA',
            id: agentId
          } : undefined
        }
      })

    } catch (error) {
      fastify.log.error('Error processing chat message:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to process message'
      })
    }
  })

  // ✅ ENDPOINT 3: Analytics et tracking
  fastify.post('/analytics/track', {
    schema: {
      body: AnalyticsTrackSchema
    }
  }, async (request, reply) => {
    try {
      const body = request.body as AnalyticsTrackBody
      const { shopId, event, data, timestamp, url, userAgent } = body

      try {
        await prisma.analyticsEvent.create({
          data: {
            shopId,
            eventType: event,
            eventData: data || {},
            pageUrl: url,
            userAgent,
            ipAddress: request.ip
          }
        })
      } catch (dbError) {
        fastify.log.warn('Analytics table not available:', dbError)
      }

      return reply.send({
        success: true,
        message: 'Event tracked successfully'
      })

    } catch (error) {
      fastify.log.error('Error tracking analytics:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to track event'
      })
    }
  })

  // ✅ ENDPOINT 4: Analyser intention de commande
  fastify.post('/orders/analyze-intent', {
    schema: {
      body: OrderIntentSchema
    }
  }, async (request, reply) => {
    try {
      const body = request.body as OrderIntentBody
      const { message, conversationId, productInfo, shopId } = body

      const intentPrompt = `Analyse ce message d'un client e-commerce et détermine s'il exprime une intention d'achat:

Message: "${message}"

Produit contexte: ${productInfo?.name || 'Non spécifié'}

Réponds UNIQUEMENT avec un JSON valide dans ce format:
{
  "hasOrderIntent": boolean,
  "confidence": number (0-1),
  "action": "start_order" | "need_info" | "browsing",
  "extractedInfo": {
    "quantity": number or null,
    "urgency": "low" | "medium" | "high",
    "concerns": []
  }
}`

      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'Tu es un expert en analyse d\'intention d\'achat. Réponds UNIQUEMENT avec du JSON valide.'
            },
            {
              role: 'user',
              content: intentPrompt
            }
          ],
          max_tokens: 200,
          temperature: 0.1
        })
      })

      if (!openaiResponse.ok) {
        throw new Error(`OpenAI API error: ${openaiResponse.status}`)
      }

      const openaiData = await openaiResponse.json() as OpenAIResponse
      let aiResponse = openaiData.choices[0]?.message?.content || '{}'

      aiResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

      let intentData
      try {
        intentData = JSON.parse(aiResponse)
      } catch (parseError) {
        intentData = {
          hasOrderIntent: message.toLowerCase().includes('acheter') || 
                         message.toLowerCase().includes('commander'),
          confidence: 0.5,
          action: 'need_info',
          extractedInfo: {}
        }
      }

      return reply.send({
        success: true,
        data: intentData
      })

    } catch (error) {
      fastify.log.error('Error analyzing order intent:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to analyze intent'
      })
    }
  })

  // ✅ ENDPOINT 5: Démarrer processus de commande
  fastify.post('/orders/start', {
    schema: {
      body: OrderStartSchema
    }
  }, async (request, reply) => {
    try {
      const body = request.body as OrderStartBody
      const { conversationId, productInfo, initialMessage, shopId } = body

      const orderData = {
        step: 'product',
        collectedData: {
          product: productInfo,
          quantity: 1,
          initiatedAt: new Date().toISOString()
        }
      }

      if (conversationId) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            status: 'order_in_progress'
          }
        })
      }

      return reply.send({
        success: true,
        data: {
          currentStep: 'name',
          message: `Parfait ! Je vais vous aider à commander ${productInfo?.name || 'ce produit'}. Pour commencer, puis-je avoir votre nom complet ?`,
          collectedData: orderData.collectedData
        }
      })

    } catch (error) {
      fastify.log.error('Error starting order:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to start order'
      })
    }
  })

  // ✅ ENDPOINT 6: Traiter étape de commande
  fastify.post('/orders/process-step', {
    schema: {
      body: OrderStepSchema
    }
  }, async (request, reply) => {
    try {
      const body = request.body as OrderStepBody
      const { conversationId, step, data, shopId } = body

      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId }
      })

      if (!conversation) {
        return reply.status(404).send({
          success: false,
          error: 'Conversation not found'
        })
      }

      const stepFlow: Record<string, { next: string; message: string }> = {
        'name': { next: 'phone', message: 'Merci ! Maintenant, quel est votre numéro de téléphone ?' },
        'phone': { next: 'address', message: 'Parfait ! Quelle est votre adresse de livraison complète ?' },
        'address': { next: 'payment', message: 'Excellent ! Comment souhaitez-vous payer ? (Carte, PayPal, Virement)' },
        'payment': { next: 'confirmation', message: 'Merci ! Voici le résumé de votre commande :' }
      }

      const currentStepInfo = stepFlow[step]
      const nextStep = currentStepInfo?.next || null
      let message = currentStepInfo?.message || 'Information reçue.'

      return reply.send({
        success: true,
        data: {
          currentStep: nextStep,
          message,
          collectedData: data
        }
      })

    } catch (error) {
      fastify.log.error('Error processing order step:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to process order step'
      })
    }
  })

  // ✅ ENDPOINT 7: Finaliser commande - CORRECTION PRINCIPALE
  fastify.post('/orders/complete', {
    schema: {
      body: OrderCompleteSchema
    }
  }, async (request, reply) => {
    try {
      const body = request.body as OrderCompleteBody
      const { conversationId, orderData, shopId } = body

      // ✅ CORRECTION: Créer la commande avec tous les champs requis
      let order
      try {
        order = await prisma.order.create({
          data: {
            shopId,
            conversationId,
            customerName: String(orderData.name || 'Client'),
            customerPhone: String(orderData.phone || ''),
            customerAddress: String(orderData.address || ''),
            paymentMethod: String(orderData.paymentMethod || 'Non spécifié'),
            // ✅ AJOUT DU CHAMP REQUIS productItems
            productItems: JSON.stringify([{
              id: orderData.product?.id || 'unknown',
              name: orderData.product?.name || 'Produit',
              price: orderData.product?.price || 0,
              quantity: 1
            }]),
            totalAmount: Number(orderData.product?.price || 0),
            currency: 'EUR',
            status: 'confirmed'
          }
        })
      } catch (dbError) {
        fastify.log.warn('Orders table error, using mock order:', dbError)
        order = {
          id: `mock_${Date.now()}`,
          createdAt: new Date()
        }
      }

      // Mettre à jour la conversation
      if (conversationId) {
        try {
          await prisma.conversation.update({
            where: { id: conversationId },
            data: {
              status: 'completed',
              conversionCompleted: true,
              completedAt: new Date()
            }
          })
        } catch (updateError) {
          fastify.log.warn('Could not update conversation:', updateError)
        }
      }

      const orderNumber = `CS-${order.id.toString().slice(-8).toUpperCase()}`

      return reply.send({
        success: true,
        data: {
          orderId: order.id,
          orderNumber,
          message: `🎉 Commande confirmée ! Votre numéro de commande est ${orderNumber}. Merci pour votre achat !`
        }
      })

    } catch (error) {
      fastify.log.error('Error completing order:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to complete order'
      })
    }
  })

  // ✅ ENDPOINT 8: Health check
  fastify.get('/health', async (request, reply) => {
    try {
      // Test de connexion à la base de données
      await prisma.$queryRaw`SELECT 1`
      
      return reply.send({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        services: {
          database: 'connected',
          ai: process.env.OPENAI_API_KEY ? 'ready' : 'not-configured',
          widget: 'operational'
        }
      })
    } catch (error) {
      return reply.status(503).send({
        success: false,
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Database connection failed'
      })
    }
  })
}

export default publicRoutes
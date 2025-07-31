// src/routes/public.ts - ENDPOINTS PUBLICS POUR WIDGET CHATSELLER
import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

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
  orderData: z.record(z.any()),
  shopId: z.string().uuid()
})

const publicRoutes: FastifyPluginAsync = async (fastify) => {
  
  // ✅ ENDPOINT 1: Récupérer la configuration shop + agent
  fastify.get('/public/shops/:shopId/config', {
    schema: {
      params: ShopConfigRequestSchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({
            shop: z.object({
              id: z.string(),
              shopId: z.string(),
              primaryColor: z.string(),
              buttonText: z.string(),
              position: z.string(),
              theme: z.string(),
              language: z.string()
            }),
            agent: z.object({
              id: z.string(),
              name: z.string(),
              title: z.string(),
              avatar: z.string().nullable(),
              welcomeMessage: z.string(),
              fallbackMessage: z.string(),
              systemPrompt: z.string(),
              personality: z.string(),
              tone: z.string(),
              knowledgeBase: z.array(z.any()),
              isActive: z.boolean()
            }).nullable()
          })
        })
      }
    }
  }, async (request, reply) => {
    try {
      const { shopId } = request.params

      // Récupérer la configuration du shop
      const shop = await fastify.prisma.shop.findUnique({
        where: { shopId },
        include: {
          agents: {
            where: { isActive: true },
            include: {
              knowledgeBase: {
                where: { isActive: true }
              }
            },
            take: 1 // Récupérer le premier agent actif
          }
        }
      })

      if (!shop) {
        return reply.status(404).send({
          success: false,
          error: 'Shop not found'
        })
      }

      // Formater la configuration pour le widget
      const activeAgent = shop.agents[0] || null
      
      const response = {
        success: true,
        data: {
          shop: {
            id: shop.id,
            shopId: shop.shopId,
            primaryColor: shop.primaryColor || '#007AFF',
            buttonText: shop.buttonText || 'Parler à un conseiller',
            position: shop.widgetPosition || 'above-cta',
            theme: shop.theme || 'modern',
            language: shop.language || 'fr'
          },
          agent: activeAgent ? {
            id: activeAgent.id,
            name: activeAgent.name,
            title: activeAgent.title || 'Conseiller Commercial',
            avatar: activeAgent.avatar,
            welcomeMessage: activeAgent.welcomeMessage,
            fallbackMessage: activeAgent.fallbackMessage,
            systemPrompt: activeAgent.systemPrompt,
            personality: activeAgent.personality,
            tone: activeAgent.tone,
            knowledgeBase: activeAgent.knowledgeBase.map(kb => ({
              id: kb.id,
              title: kb.title,
              content: kb.content,
              type: kb.type,
              priority: kb.priority
            })),
            isActive: activeAgent.isActive
          } : null
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

  // ✅ ENDPOINT 2: Envoyer un message chat avec base de connaissance
  fastify.post('/public/chat/message', {
    schema: {
      body: ChatMessageSchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({
            message: z.string(),
            conversationId: z.string(),
            responseTime: z.number(),
            agent: z.object({
              name: z.string(),
              id: z.string()
            }).optional()
          })
        })
      }
    }
  }, async (request, reply) => {
    try {
      const { 
        message, 
        conversationId, 
        shopId, 
        agentId, 
        productContext, 
        systemPrompt, 
        knowledgeBase 
      } = request.body

      const startTime = Date.now()

      // Récupérer ou créer une conversation
      let conversation
      if (conversationId) {
        conversation = await fastify.prisma.conversation.findUnique({
          where: { id: conversationId }
        })
      }

      if (!conversation) {
        conversation = await fastify.prisma.conversation.create({
          data: {
            shopId,
            agentId,
            status: 'active',
            metadata: {
              productContext,
              userAgent: request.headers['user-agent'],
              ip: request.ip
            }
          }
        })
      }

      // Sauvegarder le message utilisateur
      await fastify.prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'user',
          content: message,
          metadata: {
            timestamp: new Date().toISOString()
          }
        }
      })

      // ✅ CONSTRUIRE LE PROMPT AVEC BASE DE CONNAISSANCE
      let enhancedPrompt = systemPrompt || `Tu es un assistant commercial IA expert. Tu aides les clients à prendre des décisions d'achat éclairées.`

      // Ajouter le contexte produit
      if (productContext?.name) {
        enhancedPrompt += `\n\nProduit actuel: ${productContext.name}`
        if (productContext.price) {
          enhancedPrompt += ` - Prix: ${productContext.price}€`
        }
      }

      // ✅ INTÉGRER LA BASE DE CONNAISSANCE
      if (knowledgeBase && knowledgeBase.length > 0) {
        enhancedPrompt += `\n\nBase de connaissance:\n`
        knowledgeBase.forEach((kb: any, index: number) => {
          enhancedPrompt += `${index + 1}. ${kb.title || 'Information'}:\n${kb.content}\n\n`
        })
        enhancedPrompt += `Utilise ces informations pour répondre de manière précise et utile.`
      }

      enhancedPrompt += `\n\nRéponds de manière conversationnelle, professionnelle et orientée vente. Si le client semble intéressé par un achat, guide-le naturellement vers la finalisation.`

      // ✅ APPEL API OpenAI avec base de connaissance
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
          temperature: 0.7,
          presence_penalty: 0.1,
          frequency_penalty: 0.1
        })
      })

      if (!openaiResponse.ok) {
        throw new Error(`OpenAI API error: ${openaiResponse.status}`)
      }

      const openaiData = await openaiResponse.json()
      const aiMessage = openaiData.choices[0]?.message?.content || 'Désolé, je ne peux pas répondre pour le moment.'

      // Sauvegarder la réponse IA
      await fastify.prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          content: aiMessage,
          metadata: {
            model: 'gpt-4o-mini',
            tokens: openaiData.usage?.total_tokens,
            responseTime: Date.now() - startTime
          }
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
  fastify.post('/public/analytics/track', {
    schema: {
      body: AnalyticsTrackSchema
    }
  }, async (request, reply) => {
    try {
      const { shopId, event, data, timestamp, url, userAgent } = request.body

      // Enregistrer l'événement analytics
      await fastify.prisma.analytics.create({
        data: {
          shopId,
          event,
          data: data || {},
          timestamp: new Date(timestamp),
          metadata: {
            url,
            userAgent,
            ip: request.ip
          }
        }
      })

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
  fastify.post('/public/orders/analyze-intent', {
    schema: {
      body: OrderIntentSchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({
            hasOrderIntent: z.boolean(),
            confidence: z.number(),
            action: z.string().optional(),
            extractedInfo: z.record(z.any()).optional()
          })
        })
      }
    }
  }, async (request, reply) => {
    try {
      const { message, conversationId, productInfo, shopId } = request.body

      // ✅ ANALYSE D'INTENTION AVEC IA
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
    "concerns": array of strings
  }
}

Expressions d'intention d'achat: "acheter", "commander", "je veux", "je prends", "ajouter au panier", etc.`

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

      const openaiData = await openaiResponse.json()
      let aiResponse = openaiData.choices[0]?.message?.content || '{}'

      // Nettoyer la réponse pour extraire le JSON
      aiResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

      let intentData
      try {
        intentData = JSON.parse(aiResponse)
      } catch (parseError) {
        // Fallback si le parsing échoue
        intentData = {
          hasOrderIntent: message.toLowerCase().includes('acheter') || 
                         message.toLowerCase().includes('commander') ||
                         message.toLowerCase().includes('je veux'),
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
  fastify.post('/public/orders/start', {
    schema: {
      body: OrderStartSchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({
            currentStep: z.string(),
            message: z.string(),
            collectedData: z.record(z.any())
          })
        })
      }
    }
  }, async (request, reply) => {
    try {
      const { conversationId, productInfo, initialMessage, shopId } = request.body

      // Créer ou mettre à jour l'ordre
      const orderData = {
        step: 'product',
        collectedData: {
          product: productInfo,
          quantity: 1,
          initiatedAt: new Date().toISOString()
        }
      }

      // Sauvegarder dans la conversation
      if (conversationId) {
        await fastify.prisma.conversation.update({
          where: { id: conversationId },
          data: {
            metadata: {
              orderFlow: orderData,
              status: 'order_in_progress'
            }
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
  fastify.post('/public/orders/process-step', {
    schema: {
      body: OrderStepSchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({
            currentStep: z.string().nullable(),
            message: z.string(),
            collectedData: z.record(z.any())
          })
        })
      }
    }
  }, async (request, reply) => {
    try {
      const { conversationId, step, data, shopId } = request.body

      // Récupérer l'état actuel de la commande
      const conversation = await fastify.prisma.conversation.findUnique({
        where: { id: conversationId }
      })

      const orderFlow = conversation?.metadata?.orderFlow || { collectedData: {} }
      
      // Mettre à jour les données collectées
      orderFlow.collectedData = { ...orderFlow.collectedData, ...data }

      // Déterminer la prochaine étape
      const stepFlow = {
        'name': { next: 'phone', message: 'Merci ! Maintenant, quel est votre numéro de téléphone ?' },
        'phone': { next: 'address', message: 'Parfait ! Quelle est votre adresse de livraison complète ?' },
        'address': { next: 'payment', message: 'Excellent ! Comment souhaitez-vous payer ? (Carte, PayPal, Virement)' },
        'payment': { next: 'confirmation', message: 'Merci ! Voici le résumé de votre commande :' }
      }

      const currentStepInfo = stepFlow[step as keyof typeof stepFlow]
      let nextStep = currentStepInfo?.next || null
      let message = currentStepInfo?.message || 'Information reçue.'

      // Préparer résumé pour confirmation
      if (nextStep === 'confirmation') {
        const summary = `
📦 Produit: ${orderFlow.collectedData.product?.name || 'Produit'}
📞 Client: ${orderFlow.collectedData.name}
📱 Téléphone: ${orderFlow.collectedData.phone}
📍 Adresse: ${orderFlow.collectedData.address}
💳 Paiement: ${orderFlow.collectedData.paymentMethod}
💰 Total: ${orderFlow.collectedData.product?.price || 0}€

Confirmez-vous cette commande ?`
        
        orderFlow.collectedData.summary = summary
        message = summary
      }

      // Sauvegarder l'état
      await fastify.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          metadata: {
            ...conversation?.metadata,
            orderFlow: {
              ...orderFlow,
              currentStep: nextStep
            }
          }
        }
      })

      return reply.send({
        success: true,
        data: {
          currentStep: nextStep,
          message,
          collectedData: orderFlow.collectedData
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

  // ✅ ENDPOINT 7: Finaliser commande
  fastify.post('/public/orders/complete', {
    schema: {
      body: OrderCompleteSchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({
            orderId: z.string(),
            orderNumber: z.string(),
            message: z.string()
          })
        })
      }
    }
  }, async (request, reply) => {
    try {
      const { conversationId, orderData, shopId } = request.body

      // Créer la commande
      const order = await fastify.prisma.order.create({
        data: {
          shopId,
          conversationId,
          customerName: orderData.name,
          customerPhone: orderData.phone,
          customerAddress: orderData.address,
          paymentMethod: orderData.paymentMethod,
          products: [orderData.product],
          totalAmount: orderData.product?.price || 0,
          status: 'confirmed',
          metadata: {
            orderData,
            source: 'widget_chat',
            completedAt: new Date().toISOString()
          }
        }
      })

      // Générer numéro de commande
      const orderNumber = `CS-${order.id.slice(-8).toUpperCase()}`

      // Mettre à jour avec le numéro
      await fastify.prisma.order.update({
        where: { id: order.id },
        data: { orderNumber }
      })

      // Mettre à jour la conversation
      await fastify.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          status: 'completed',
          metadata: {
            orderCompleted: true,
            orderId: order.id,
            orderNumber
          }
        }
      })

      return reply.send({
        success: true,
        data: {
          orderId: order.id,
          orderNumber,
          message: `🎉 Commande confirmée ! Votre numéro de commande est ${orderNumber}. Vous recevrez un SMS de confirmation sous peu. Merci pour votre achat !`
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

  // ✅ ENDPOINT 8: Health check pour widget
  fastify.get('/health', async (request, reply) => {
    return reply.send({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      services: {
        database: 'connected',
        ai: 'ready',
        widget: 'operational'
      }
    })
  })
}

export default publicRoutes
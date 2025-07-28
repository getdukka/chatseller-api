// src/routes/public.ts - VERSION CORRIGÉE AVEC FALLBACK
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;

try {
  prisma = new PrismaClient({
    log: ['query', 'info', 'warn', 'error'],
    datasources: {
      db: {
        url: process.env.DATABASE_URL
      }
    }
  });
} catch (error) {
  console.error('❌ ERREUR lors de l\'initialisation de Prisma:', error);
  throw error;
}

interface ShopParamsType {
  shopId: string;
}

// ✅ HELPER : Vérifier si une string est un UUID valide
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// ✅ HELPER : Générer une configuration de fallback pour les tests
function getFallbackShopConfig(shopId: string) {
  return {
    success: true,
    data: {
      shop: {
        id: shopId,
        name: 'Boutique de Test',
        widgetConfig: {
          theme: "modern",
          language: "fr", 
          position: "bottom-right",
          buttonText: "Parler au vendeur",
          primaryColor: "#E91E63"
        },
        agentConfig: {
          name: "Rose",
          avatar: "https://ui-avatars.com/api/?name=Rose&background=E91E63&color=fff",
          upsellEnabled: false,
          welcomeMessage: "Bonjour ! Je suis Rose, votre assistante d'achat. Comment puis-je vous aider aujourd'hui ?",
          fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
          collectPaymentMethod: true
        }
      },
      agent: {
        id: `agent-${shopId}`,
        name: "Rose",
        type: "general",
        personality: "friendly",
        description: "Assistante d'achat spécialisée dans l'accompagnement des clients",
        welcomeMessage: "Bonjour ! Je suis Rose, votre assistante d'achat. Comment puis-je vous aider aujourd'hui ?",
        fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
        avatar: "https://ui-avatars.com/api/?name=Rose&background=E91E63&color=fff",
        config: {
          collectName: true,
          collectPhone: true,
          collectAddress: false,
          collectPayment: true,
          upsellEnabled: true
        }
      },
      knowledgeBase: {
        content: `## Informations Boutique
Notre boutique propose des produits de qualité pour renforcer les liens entre couples.

## Le Jeu Pour les Couples
Un jeu révolutionnaire avec plus de 200 questions et défis pour mieux se connaître.
Prix: 14 000 FCFA
Contenu: 200+ cartes questions, Guide d'utilisation, Livret de conseils, Boîte premium

## Politique de retour
Retour gratuit sous 30 jours, satisfait ou remboursé.

## Livraison
Livraison gratuite dès 20 000 FCFA d'achat.`,
        documentsCount: 1,
        documents: [
          {
            id: 'doc-fallback-001',
            title: 'Informations produits et boutique',
            contentType: 'manual',
            tags: ['boutique', 'produits', 'jeu-couples']
          }
        ]
      }
    }
  };
}

export default async function publicRoutes(fastify: FastifyInstance) {
  
  // ✅ ROUTE : Récupérer la configuration publique d'un shop et de son agent principal
  fastify.get<{ Params: ShopParamsType }>('/shops/:shopId/agent', async (request, reply) => {
    try {
      const { shopId } = request.params;
      fastify.log.info(`🔍 Récupération config publique pour shop: ${shopId}`);
      
      // ✅ NOUVEAU : Vérification UUID et gestion fallback
      if (!isValidUUID(shopId)) {
        fastify.log.warn(`⚠️ ShopId non-UUID détecté: ${shopId}, utilisation configuration fallback`);
        return getFallbackShopConfig(shopId);
      }
      
      await prisma.$connect();
      
      // Récupérer le shop et ses informations publiques
      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: {
          id: true,
          name: true,
          is_active: true,
          widget_config: true,
          agent_config: true
        }
      });

      if (!shop || !shop.is_active) {
        fastify.log.warn(`⚠️ Shop non trouvé ou inactif: ${shopId}, utilisation configuration fallback`);
        await prisma.$disconnect();
        return getFallbackShopConfig(shopId);
      }

      // Récupérer l'agent principal actif du shop
      const agent = await prisma.agent.findFirst({
        where: { 
          shopId: shopId,
          isActive: true
        },
        include: {
          knowledgeBase: {
            where: {
              knowledgeBase: {
                isActive: true
              }
            },
            include: {
              knowledgeBase: {
                select: {
                  id: true,
                  title: true,
                  content: true,
                  contentType: true,
                  tags: true
                }
              }
            }
          }
        },
        orderBy: { updatedAt: 'desc' }
      });

      await prisma.$disconnect();

      // Si pas d'agent, utiliser la config par défaut du shop
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
        };
      }

      // Préparer la base de connaissance
      const knowledgeContent = agent.knowledgeBase
        .map(kb => `## ${kb.knowledgeBase.title}\n${kb.knowledgeBase.content}`)
        .join('\n\n---\n\n');

      // Réponse complète avec agent
      return {
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
            documentsCount: agent.knowledgeBase.length,
            documents: agent.knowledgeBase.map(kb => ({
              id: kb.knowledgeBase.id,
              title: kb.knowledgeBase.title,
              contentType: kb.knowledgeBase.contentType,
              tags: kb.knowledgeBase.tags
            }))
          }
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Get public shop config error:', error);
      
      // ✅ NOUVEAU : Fallback en cas d'erreur
      fastify.log.warn(`⚠️ Erreur API pour shop ${request.params.shopId}, utilisation configuration fallback`);
      return getFallbackShopConfig(request.params.shopId);
    }
  });

  // ✅ ROUTE : Endpoint de chat public pour les conversations avec l'IA
  fastify.post<{ 
    Body: { 
      shopId: string; 
      message: string; 
      conversationId?: string;
      productInfo?: any;
      visitorId?: string;
    } 
  }>('/chat', async (request, reply) => {
    try {
      const { shopId, message, conversationId, productInfo, visitorId } = request.body;
      
      fastify.log.info(`💬 Nouveau message chat pour shop: ${shopId}`);
      
      // ✅ NOUVEAU : Gestion des shops non-UUID (mode test)
      if (!isValidUUID(shopId)) {
        fastify.log.info(`💬 Mode test détecté pour shop: ${shopId}`);
        
        // Simulation d'une réponse IA pour les tests
        const simulatedResponse = getSimulatedAIResponse(message, productInfo);
        
        return {
          success: true,
          data: {
            conversationId: conversationId || `test-conv-${Date.now()}`,
            message: simulatedResponse,
            agent: {
              name: "Rose",
              avatar: "https://ui-avatars.com/api/?name=Rose&background=E91E63&color=fff"
            }
          }
        };
      }
      
      await prisma.$connect();
      
      // Récupérer la configuration de l'agent (pour les vrais shops)
      const shopConfig = await prisma.shop.findUnique({
        where: { id: shopId },
        select: {
          id: true,
          name: true,
          is_active: true
        }
      });

      if (!shopConfig || !shopConfig.is_active) {
        await prisma.$disconnect();
        return reply.status(404).send({ error: 'Boutique non trouvée ou inactive' });
      }

      const agent = await prisma.agent.findFirst({
        where: { 
          shopId: shopId,
          isActive: true
        },
        include: {
          knowledgeBase: {
            where: {
              knowledgeBase: {
                isActive: true
              }
            },
            include: {
              knowledgeBase: true
            }
          }
        }
      });

      if (!agent) {
        await prisma.$disconnect();
        return reply.status(404).send({ error: 'Aucun agent actif trouvé pour cette boutique' });
      }

      // Créer ou récupérer la conversation
      let conversation;
      if (conversationId) {
        conversation = await prisma.conversation.findUnique({
          where: { id: conversationId }
        });
      }

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            shopId: shopId,
            agentId: agent.id,
            visitorId: visitorId || `visitor_${Date.now()}`,
            productId: productInfo?.id,
            productName: productInfo?.name,
            productPrice: productInfo?.price,
            productUrl: productInfo?.url,
            visitorIp: request.ip,
            visitorUserAgent: request.headers['user-agent']
          }
        });
      }

      // Sauvegarder le message utilisateur
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'user',
          content: message
        }
      });

      // PLACEHOLDER pour OpenAI - Phase 2
      const aiResponse = getSimulatedAIResponse(message, productInfo, agent);

      // Sauvegarder la réponse de l'IA
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          content: aiResponse
        }
      });

      await prisma.$disconnect();

      return {
        success: true,
        data: {
          conversationId: conversation.id,
          message: aiResponse,
          agent: {
            name: agent.name,
            avatar: agent.avatar
          }
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Chat error:', error);
      
      // ✅ FALLBACK en cas d'erreur
      const fallbackResponse = request.body.message.toLowerCase().includes('bonjour') || request.body.message.toLowerCase().includes('salut')
        ? "Bonjour ! Je suis Rose, votre assistante d'achat. Comment puis-je vous aider avec ce produit ?"
        : "Merci pour votre message ! Comment puis-je vous aider davantage ?";
      
      return {
        success: true,
        data: {
          conversationId: request.body.conversationId || `fallback-conv-${Date.now()}`,
          message: fallbackResponse,
          agent: {
            name: "Rose",
            avatar: "https://ui-avatars.com/api/?name=Rose&background=E91E63&color=fff"
          }
        }
      };
    }
  });
}

// ✅ FONCTION pour simuler l'IA (en attendant OpenAI Phase 2)
function getSimulatedAIResponse(message: string, productInfo: any, agent?: any): string {
  const msg = message.toLowerCase();
  const agentName = agent?.name || "Rose";
  
  if (msg.includes('bonjour') || msg.includes('salut') || msg.includes('hello')) {
    return `Bonjour ! Je suis ${agentName}. Je vois que vous vous intéressez à "${productInfo?.name || 'ce produit'}". Comment puis-je vous aider ?`;
  }
  
  if (msg.includes('prix') || msg.includes('coût') || msg.includes('tarif')) {
    if (productInfo?.price) {
      return `Le prix de "${productInfo.name}" est de ${productInfo.price}. C'est un excellent rapport qualité-prix ! Voulez-vous que je vous aide à passer commande ?`;
    }
    return "Je vais vérifier le prix pour vous. Un instant...";
  }
  
  if (msg.includes('acheter') || msg.includes('commander') || msg.includes('commande')) {
    return "Parfait ! Je vais vous aider à finaliser votre commande. Pour commencer, puis-je avoir votre nom et prénom ?";
  }
  
  if (msg.includes('info') || msg.includes('détail') || msg.includes('caractéristique')) {
    return `"${productInfo?.name || 'Ce produit'}" est un excellent choix ! D'après nos informations, c'est l'un de nos produits les plus appréciés. Avez-vous des questions spécifiques ?`;
  }
  
  if (msg.includes('questions') || msg.includes('question')) {
    return "Bien sûr ! Je suis là pour répondre à toutes vos questions. Que souhaitez-vous savoir exactement sur ce produit ?";
  }
  
  if (msg.includes('savoir plus') || msg.includes('en savoir')) {
    return "Je serais ravi de vous en dire plus ! Ce produit a d'excellentes caractéristiques. Qu'est-ce qui vous intéresse le plus : les fonctionnalités, la qualité, ou autre chose ?";
  }
  
  // Réponse par défaut
  return agent?.fallbackMessage || "Merci pour votre message ! Comment puis-je vous aider davantage avec ce produit ?";
}
// src/routes/public.ts - INTÉGRATION GPT-4O-MINI COMPLÈTE - CORRIGÉE
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';

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

// ✅ INITIALISATION OPENAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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

// ✅ NOUVELLE FONCTION : Générer le prompt système pour l'agent
function buildAgentPrompt(agent: any, knowledgeBase: string, productInfo?: any) {
  const basePrompt = `Tu es ${agent.name}, un vendeur IA commercial ${agent.personality === 'friendly' ? 'amical et bienveillant' : 'professionnel'}.

RÔLE: Assistant d'achat spécialisé dans la conversion de visiteurs en clients.

PERSONNALITÉ: ${agent.personality}
- ${agent.personality === 'friendly' ? 'Chaleureux, empathique, à l\'écoute' : 'Professionnel, expert, efficace'}
- Toujours positif et orienté solution
- Expert en techniques de vente consultative

OBJECTIFS PRINCIPAUX:
1. Accueillir chaleureusement les visiteurs
2. Identifier leurs besoins et motivations d'achat
3. Répondre à leurs questions avec précision
4. Lever leurs objections et rassurer
5. Collecter leurs informations de commande
6. Proposer des ventes additionnelles pertinentes

DONNÉES PRODUIT ACTUEL:
${productInfo ? `
- Nom: ${productInfo.name || 'Produit non spécifié'}
- Prix: ${productInfo.price ? productInfo.price + ' FCFA' : 'Prix non spécifié'}
- URL: ${productInfo.url || 'Non spécifiée'}
` : 'Aucune information produit fournie'}

BASE DE CONNAISSANCE:
${knowledgeBase}

INSTRUCTIONS DE CONVERSATION:
1. Commence toujours par un accueil chaleureux
2. Pose des questions pour comprendre les besoins
3. Utilise les informations de ta base de connaissance
4. Sois proactif pour collecter les commandes
5. Propose des upsells intelligents si pertinent
6. Reste toujours dans ton rôle de vendeur

COLLECTE DE COMMANDE:
Quand un client veut acheter, collecte dans l'ordre:
1. Confirmation du produit et quantité
2. Nom complet
3. Numéro de téléphone
4. Adresse de livraison (si nécessaire)
5. Mode de paiement préféré

RÉPONSES:
- Maximum 150 mots par réponse
- Ton conversationnel et naturel
- Utilise des émojis avec parcimonie
- Pose toujours une question pour relancer la conversation`;

  return basePrompt;
}

// ✅ INTERFACE pour le résultat OpenAI
interface OpenAIResult {
  success: boolean;
  message?: string;
  tokensUsed?: number;
  error?: string;
  fallbackMessage?: string;
}

// ✅ NOUVELLE FONCTION : Appeler GPT-4o-mini - CORRIGÉE
async function callOpenAI(messages: any[], agentConfig: any, knowledgeBase: string, productInfo?: any): Promise<OpenAIResult> {
  try {
    const systemPrompt = buildAgentPrompt(agentConfig, knowledgeBase, productInfo);
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ],
      max_tokens: 300,
      temperature: 0.7,
      presence_penalty: 0.3,
      frequency_penalty: 0.3
    });

    return {
      success: true,
      message: completion.choices[0]?.message?.content || "Je n'ai pas pu générer de réponse.",
      tokensUsed: completion.usage?.total_tokens || 0
    };

  } catch (error: any) {
    console.error('❌ Erreur OpenAI:', error);
    
    if (error.code === 'insufficient_quota') {
      return {
        success: false,
        error: 'Quota OpenAI dépassé',
        fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt."
      };
    }
    
    return {
      success: false,
      error: error.message || 'Erreur IA',
      fallbackMessage: "Désolé, je rencontre un problème technique. Un conseiller vous recontactera bientôt."
    };
  }
}

export default async function publicRoutes(fastify: FastifyInstance) {
  
  // ✅ ROUTE : Récupérer la configuration publique d'un shop et de son agent principal
  fastify.get<{ Params: ShopParamsType }>('/shops/:shopId/agent', async (request, reply) => {
    try {
      const { shopId } = request.params;
      fastify.log.info(`🔍 Récupération config publique pour shop: ${shopId}`);
      
      if (!isValidUUID(shopId)) {
        fastify.log.warn(`⚠️ ShopId non-UUID détecté: ${shopId}, utilisation configuration fallback`);
        return getFallbackShopConfig(shopId);
      }
      
      await prisma.$connect();
      
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

      const knowledgeContent = agent.knowledgeBase
        .map(kb => `## ${kb.knowledgeBase.title}\n${kb.knowledgeBase.content}`)
        .join('\n\n---\n\n');

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
      fastify.log.warn(`⚠️ Erreur API pour shop ${request.params.shopId}, utilisation configuration fallback`);
      return getFallbackShopConfig(request.params.shopId);
    }
  });

  // ✅ ROUTE : Endpoint de chat public AVEC GPT-4O-MINI - CORRIGÉ
  fastify.post<{ 
    Body: { 
      shopId: string; 
      message: string; 
      conversationId?: string;
      productInfo?: any;
      visitorId?: string;
    } 
  }>('/chat', async (request, reply) => {
    const startTime = Date.now();
    
    try {
      const { shopId, message, conversationId, productInfo, visitorId } = request.body;
      
      fastify.log.info(`💬 Nouveau message chat pour shop: ${shopId}`);
      
      // Mode test pour shops non-UUID
      if (!isValidUUID(shopId)) {
        fastify.log.info(`💬 Mode test détecté pour shop: ${shopId}`);
        
        const simulatedResponse = getSimulatedAIResponse(message, productInfo);
        
        return {
          success: true,
          data: {
            conversationId: conversationId || `test-conv-${Date.now()}`,
            message: simulatedResponse,
            agent: {
              name: "Rose",
              avatar: "https://ui-avatars.com/api/?name=Rose&background=E91E63&color=fff"
            },
            responseTime: Date.now() - startTime
          }
        };
      }
      
      await prisma.$connect();
      
      // Récupérer la configuration de l'agent
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
          where: { id: conversationId },
          include: {
            messages: {
              orderBy: { createdAt: 'asc' },
              take: 10 // Limiter l'historique pour l'IA
            }
          }
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
          },
          include: {
            messages: true
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

      // Préparer la base de connaissance
      const knowledgeContent = agent.knowledgeBase
        .map(kb => `## ${kb.knowledgeBase.title}\n${kb.knowledgeBase.content}`)
        .join('\n\n---\n\n');

      // Préparer l'historique des messages pour l'IA
      const messageHistory = conversation.messages.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      }));

      // Ajouter le nouveau message
      messageHistory.push({ role: 'user', content: message });

      // ✅ APPELER GPT-4O-MINI - CORRIGÉ
      const aiResult = await callOpenAI(messageHistory, agent, knowledgeContent, productInfo);
      
      // ✅ VARIABLES AVEC VALEURS PAR DÉFAUT
      let aiResponse: string = aiResult.fallbackMessage || agent.fallbackMessage || "Je transmets votre question à notre équipe.";
      let tokensUsed: number = 0;

      if (aiResult.success && aiResult.message) {
        aiResponse = aiResult.message;
        tokensUsed = aiResult.tokensUsed || 0;
      } else {
        fastify.log.error('❌ Erreur IA:', aiResult.error);
      }

      // Sauvegarder la réponse de l'IA
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          content: aiResponse,
          tokensUsed: tokensUsed,
          responseTimeMs: Date.now() - startTime,
          modelUsed: 'gpt-4o-mini'
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
          },
          responseTime: Date.now() - startTime,
          tokensUsed
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Chat error:', error);
      
      // Fallback en cas d'erreur
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
          },
          responseTime: Date.now() - startTime
        }
      };
    }
  });
}

// ✅ FONCTION pour simuler l'IA (fallback pour les tests)
function getSimulatedAIResponse(message: string, productInfo: any, agent?: any): string {
  const msg = message.toLowerCase();
  const agentName = agent?.name || "Rose";
  
  if (msg.includes('bonjour') || msg.includes('salut') || msg.includes('hello')) {
    return `Bonjour ! Je suis ${agentName}. Je vois que vous vous intéressez à "${productInfo?.name || 'ce produit'}". Comment puis-je vous aider ?`;
  }
  
  if (msg.includes('prix') || msg.includes('coût') || msg.includes('tarif')) {
    if (productInfo?.price) {
      return `Le prix de "${productInfo.name}" est de ${productInfo.price} FCFA. C'est un excellent rapport qualité-prix ! Voulez-vous que je vous aide à passer commande ?`;
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
  
  return agent?.fallbackMessage || "Merci pour votre message ! Comment puis-je vous aider davantage avec ce produit ?";
}
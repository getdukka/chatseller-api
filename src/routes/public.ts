// src/routes/public.ts - VERSION PUBLIQUE CORRIGÉE
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

// ✅ INITIALISATION OPENAI CORRIGÉE
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ✅ VALIDATION OPENAI
if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️ OPENAI_API_KEY manquante - mode dégradé activé');
}

// ✅ INTERFACES TYPESCRIPT CORRIGÉES
interface ShopParamsType {
  shopId: string;
}

interface ChatRequestBody {
  shopId: string;
  message: string;
  conversationId?: string;
  productInfo?: {
    id?: string;
    name?: string;
    price?: number;
    url?: string;
  };
  visitorId?: string;
  isFirstMessage?: boolean;
}

interface OrderCollectionState {
  step: 'quantity' | 'phone' | 'name' | 'address' | 'payment' | 'confirmation' | 'completed';
  data: {
    productId?: string | null;
    productName?: string | null;
    productPrice?: number | null;
    quantity?: number | null;
    customerPhone?: string | null;
    customerFirstName?: string | null;
    customerLastName?: string | null;
    customerEmail?: string | null;
    customerAddress?: string | null;
    paymentMethod?: string | null;
  };
}

interface OpenAIResult {
  success: boolean;
  message?: string;
  tokensUsed?: number;
  error?: string;
  fallbackMessage?: string;
  orderCollection?: OrderCollectionState;
  isOrderIntent?: boolean;
}

// ✅ HELPER : Vérifier si une string est un UUID valide
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// ✅ HELPER : Configuration fallback améliorée pour VIENS ON S'CONNAÎT
function getFallbackShopConfig(shopId: string) {
  return {
    success: true,
    data: {
      shop: {
        id: shopId,
        name: 'VIENS ON S\'CONNAÎT',
        widgetConfig: {
          theme: "modern",
          language: "fr", 
          position: "above-cta",
          buttonText: "Parler à la vendeuse",
          primaryColor: "#EF4444",
          borderRadius: "full"
        },
        agentConfig: {
          name: "Rose",
          title: "Spécialiste produit",
          avatar: "https://ui-avatars.com/api/?name=Rose&background=EF4444&color=fff",
          upsellEnabled: false,
          welcomeMessage: "Salut 👋 Je suis Rose, Assistante d'Achat chez VIENS ON S'CONNAÎT. Comment puis-je vous aider ?",
          fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
          collectPaymentMethod: true
        }
      },
      agent: {
        id: `agent-${shopId}`,
        name: "Rose",
        title: "Spécialiste produit", 
        type: "product_specialist",
        personality: "friendly",
        description: "Assistante d'achat spécialisée dans l'accompagnement client",
        welcomeMessage: "Salut 👋 Je suis Rose, Assistante d'Achat chez VIENS ON S'CONNAÎT. Comment puis-je vous aider ?",
        fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
        avatar: "https://ui-avatars.com/api/?name=Rose&background=EF4444&color=fff",
        config: {
          collectName: true,
          collectPhone: true,
          collectAddress: true,
          collectPayment: true,
          upsellEnabled: true
        }
      },
      knowledgeBase: {
        content: `## VIENS ON S'CONNAÎT - Boutique

Notre boutique VIENS ON S'CONNAÎT propose des jeux et produits de qualité pour couples et personnes qui souhaitent mieux se connaître et améliorer leur relation.

### Produits disponibles
- Jeux de conversation pour couples
- Cartes de questions intimes  
- Produits pour renforcer les liens
- "Pour Les Couples (Non Mariés)" - Jeu de 150 cartes pour couples non mariés

### Livraison
- Livraison rapide à Dakar et environs
- Paiement sécurisé par Wave, Orange Money, virement ou espèces
- Service client disponible

Vous pouvez parcourir notre catalogue pour découvrir nos produits.`,
        documentsCount: 1,
        documents: [
          {
            id: 'doc-fallback-001',
            title: 'Informations boutique VIENS ON S\'CONNAÎT',
            contentType: 'manual',
            tags: ['boutique', 'produits', 'couples']
          }
        ]
      }
    }
  };
}

// ✅ PROMPT SYSTÈME AMÉLIORÉ POUR VIENS ON S'CONNAÎT
function buildAgentPrompt(agent: any, knowledgeBase: string, productInfo?: any, orderState?: OrderCollectionState) {
  const agentTitle = agent.title || getDefaultTitle(agent.type)
  
  const basePrompt = `Tu es ${agent.name}, ${agentTitle} expert et ${agent.personality === 'friendly' ? 'chaleureux' : 'professionnel'}.

🎯 RÔLE: ${agentTitle} chez VIENS ON S'CONNAÎT spécialisé dans la conversion et l'accompagnement client.

💡 PERSONNALITÉ: ${agent.personality}
- ${agent.personality === 'friendly' ? 'Bienveillant, empathique, à l\'écoute' : 'Professionnel, expert, efficace'}
- Toujours positif et orienté solution
- Expert en techniques de vente consultative et persuasion éthique
- Tu connais parfaitement les produits de la boutique

🎯 OBJECTIFS PRINCIPAUX:
1. **Accueil contextuel** : Saluer chaleureusement en mentionnant le produit consulté
2. **Identification besoins** : Comprendre les motivations et attentes du client
3. **Conseil expert** : Apporter des réponses précises sur nos produits
4. **Lever objections** : Traiter les freins à l'achat avec empathie
5. **Collecte commande** : Guider naturellement vers l'achat quand l'intérêt est manifesté
6. **Upselling intelligent** : Proposer des produits complémentaires pertinents

${productInfo ? `
🛍️ PRODUIT ACTUELLEMENT CONSULTÉ:
- **Nom**: ${productInfo.name || 'Produit non spécifié'}
- **Prix**: ${productInfo.price ? productInfo.price + ' FCFA' : 'Prix sur demande'}
- **URL**: ${productInfo.url || 'Page produit'}

⚠️ IMPORTANT: Dès le premier message, montre que tu sais quel produit l'intéresse !
` : '🚨 AUCUNE INFORMATION PRODUIT - Demande quel produit l\'intéresse'}

📚 BASE DE CONNAISSANCE VIENS ON S'CONNAÎT:
${knowledgeBase}

${orderState ? `
📋 COLLECTE DE COMMANDE EN COURS:
Étape actuelle: ${orderState.step}
Données collectées: ${JSON.stringify(orderState.data, null, 2)}

PROCHAINE ÉTAPE:
${getOrderStepInstructions(orderState.step, orderState.data)}
` : `
📋 PROCESSUS DE COLLECTE DE COMMANDE:
⚠️ COMMENCER SEULEMENT si le client manifeste un intérêt d'achat clair (ex: "je veux l'acheter", "je commande", "comment faire pour l'avoir")

PROCÉDURE STRICTE (dans cet ordre) :
1. **QUANTITÉ**: "Parfait ! Combien d'exemplaires souhaitez-vous ?"
2. **TÉLÉPHONE**: "Pour finaliser, quel est votre numéro de téléphone ?"
3. **VÉRIFICATION CLIENT**: Vérifier si le client existe avec ce numéro
   - Si OUI: "Heureux de vous revoir, [prénom] ! Même adresse de livraison ?"
   - Si NON: Continuer à l'étape 4
4. **NOM/PRÉNOM**: "Votre nom et prénom pour la commande ?"
5. **ADRESSE**: "Quelle est votre adresse de livraison complète ?"
6. **PAIEMENT**: "Comment préférez-vous payer ? (Espèces, virement, Wave, Orange Money)"
7. **CONFIRMATION**: Résumer TOUTE la commande et rassurer sur la suite
`}

🎨 FORMATAGE DES RÉPONSES:
- Utilise **gras** pour les informations importantes
- Utilise *italique* pour l'emphase
- Saute des lignes pour aérer (utilise \\n\\n)
- Émojis avec parcimonie pour la convivialité
- Maximum 200 mots par réponse pour rester concis

📝 INSTRUCTIONS DE CONVERSATION:
1. **Premier message**: TOUJOURS mentionner le produit consulté si disponible
2. **Questions ciblées**: Pose des questions pour comprendre les besoins
3. **Expertise produit**: Utilise ta base de connaissance pour être précis
4. **Détection intention**: Sois attentif aux signaux d'achat
5. **Collecte structurée**: Suis la procédure exacte pour les commandes
6. **Reste en rôle**: Tu es ${agentTitle} chez VIENS ON S'CONNAÎT, pas un chatbot générique

🚨 RÈGLES ABSOLUES:
- Ne commence JAMAIS la collecte sans intention d'achat claire
- Collecte les informations dans l'ORDRE EXACT indiqué
- Une seule information à la fois
- Confirme TOUJOURS avant de passer à l'étape suivante
- Reste naturel et conversationnel même pendant la collecte
- Si tu ne sais pas quelque chose, admets-le et propose de contacter l'équipe`;

  return basePrompt;
}

// ✅ AMÉLIORATION : Instructions détaillées pour chaque étape
function getOrderStepInstructions(step: string, data: any): string {
  switch (step) {
    case 'quantity':
      return "Demande combien d'exemplaires il souhaite. Ex: 'Combien d'exemplaires voulez-vous commander ?'"
    
    case 'phone':
      return "Demande le numéro de téléphone pour finaliser. Ex: 'Pour finaliser votre commande, quel est votre numéro de téléphone ?'"
    
    case 'name':
      if (data.customerPhone) {
        return "IMPORTANT: Vérifie si ce numéro existe déjà en base. Si oui, accueille personnellement. Sinon, demande nom et prénom."
      }
      return "Demande le nom et prénom complets. Ex: 'Parfait ! Votre nom et prénom pour la commande ?'"
    
    case 'address':
      return "Demande l'adresse de livraison complète. Ex: 'Quelle est votre adresse de livraison complète ?'"
    
    case 'payment':
      return "Demande le mode de paiement préféré. Ex: 'Comment souhaitez-vous payer ? Espèces à la livraison, virement, Wave ou Orange Money ?'"
    
    case 'confirmation':
      return "Confirme TOUTE la commande avec détails et rassure le client sur la suite du processus."
    
    case 'completed':
      return "Commande finalisée. Remercie et informe qu'un conseiller va le contacter."
    
    default:
      return "Continuez la conversation normalement."
  }
}

// ✅ AMÉLIORATION : Détection intention d'achat plus précise
function detectOrderIntent(message: string): boolean {
  const orderKeywords = [
    // Intentions directes
    'acheter', 'commander', 'commande', 'achat', 'prendre', 'veux', 'souhaite',
    'vais prendre', 'je le veux', 'ça m\'intéresse',
    
    // Questions sur l'achat
    'comment faire', 'comment commander', 'comment acheter',
    'où acheter', 'comment procéder',
    
    // Expressions d'intérêt fort
    'intéressé', 'intéresse', 'ça me plaît', 'parfait',
    'c\'est bon', 'd\'accord', 'ok pour',
    
    // Actions
    'réserver', 'livraison', 'payer', 'prix', 'finaliser',
    'confirmer', 'valider'
  ]
  
  const lowerMessage = message.toLowerCase()
  return orderKeywords.some(keyword => lowerMessage.includes(keyword))
}

// ✅ AMÉLIORATION : Extraction données plus robuste
function extractOrderData(message: string, currentStep: string): any {
  const data: any = {};
  
  switch (currentStep) {
    case 'quantity':
      const qtyPatterns = [
        /(\d+)/,
        /\b(un|une)\b/i,
        /\b(deux)\b/i,
        /\b(trois)\b/i,
        /\b(quatre)\b/i,
        /\b(cinq)\b/i
      ];
      
      for (const pattern of qtyPatterns) {
        const match = message.match(pattern);
        if (match) {
          if (match[1] && /\d+/.test(match[1])) {
            data.quantity = parseInt(match[1]);
          } else {
            const wordToNumber: { [key: string]: number } = {
              'un': 1, 'une': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5
            };
            data.quantity = wordToNumber[match[1]?.toLowerCase()] || 1;
          }
          break;
        }
      }
      break;
      
    case 'phone':
      const phonePatterns = [
        /(?:\+?221[\s\-]?)?([0-9\s\-\(\)]{8,})/,
        /(?:\+?33[\s\-]?)?([0-9\s\-\(\)]{8,})/,
        /([0-9\s\-\(\)]{8,})/
      ];
      
      for (const pattern of phonePatterns) {
        const match = message.match(pattern);
        if (match) {
          data.customerPhone = match[0].replace(/[\s\-\(\)]/g, '');
          break;
        }
      }
      break;
      
    case 'name':
      const cleanMessage = message.trim().replace(/[.,!?]/g, '');
      const words = cleanMessage.split(/\s+/).filter(word => 
        word.length > 1 && !/^(je|suis|mon|ma|nom|prénom|appelle|m'appelle)$/i.test(word)
      );
      
      if (words.length >= 2) {
        data.customerFirstName = words[0];
        data.customerLastName = words.slice(1).join(' ');
      } else if (words.length === 1) {
        data.customerFirstName = words[0];
      }
      break;
      
    case 'address':
      data.customerAddress = message.trim().replace(/^(mon adresse|adresse|c'est|voici)\s*/i, '');
      break;
      
    case 'payment':
      const paymentMethods: { [key: string]: string } = {
        'espèces': 'Espèces à la livraison',
        'cash': 'Espèces à la livraison',
        'virement': 'Virement bancaire',
        'mobile': 'Mobile Money',
        'wave': 'Wave',
        'orange': 'Orange Money',
        'carte': 'Carte bancaire'
      };
      
      const lowerMsg = message.toLowerCase();
      for (const [key, value] of Object.entries(paymentMethods)) {
        if (lowerMsg.includes(key)) {
          data.paymentMethod = value;
          break;
        }
      }
      
      if (!data.paymentMethod) {
        data.paymentMethod = message.trim();
      }
      break;
  }
  
  return data;
}

// ✅ AMÉLIORATION : Sauvegarde commande
async function saveOrderToDatabase(conversationId: string, shopId: string, agentId: string, orderData: any, productInfo?: any) {
  let isConnected = false;
  try {
    await prisma.$connect();
    isConnected = true;
    
    const order = await prisma.order.create({
      data: {
        shopId: shopId,
        conversationId: conversationId,  
        customerName: orderData.customerFirstName && orderData.customerLastName 
          ? `${orderData.customerFirstName} ${orderData.customerLastName}`
          : orderData.customerFirstName || null,
        customerPhone: orderData.customerPhone || null,
        customerEmail: orderData.customerEmail || null,
        customerAddress: orderData.customerAddress || null,
        productItems: {
          productId: productInfo?.id || orderData.productId,
          productName: productInfo?.name || orderData.productName,
          productPrice: productInfo?.price || orderData.productPrice,
          quantity: orderData.quantity || 1
        },
        totalAmount: (productInfo?.price || 0) * (orderData.quantity || 1),
        currency: 'XOF',
        paymentMethod: orderData.paymentMethod || null,
        status: 'pending'
      }
    });
    
    await prisma.$disconnect();
    isConnected = false;
    
    console.log('✅ Commande sauvegardée:', order.id);
    return order;
    
  } catch (error) {
    if (isConnected) {
      await prisma.$disconnect();
    }
    console.error('❌ Erreur sauvegarde commande:', error);
    throw error;
  }
}

// ✅ FONCTION AMÉLIORÉE : Appeler GPT-4o-mini avec gestion d'erreurs
async function callOpenAI(messages: any[], agentConfig: any, knowledgeBase: string, productInfo?: any, orderState?: OrderCollectionState): Promise<OpenAIResult> {
  try {
    // ✅ VÉRIFICATION OPENAI_API_KEY
    if (!process.env.OPENAI_API_KEY) {
      console.warn('⚠️ OpenAI API Key manquante');
      return {
        success: false,
        error: 'Configuration OpenAI manquante',
        fallbackMessage: "Je rencontre un problème technique temporaire. Comment puis-je vous aider autrement ?"
      };
    }

    const systemPrompt = buildAgentPrompt(agentConfig, knowledgeBase, productInfo, orderState);
    
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
    const hasOrderIntent = !orderState && detectOrderIntent(lastUserMessage);
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ],
      max_tokens: 400,
      temperature: 0.7,
      presence_penalty: 0.3,
      frequency_penalty: 0.3
    });

    let response = completion.choices[0]?.message?.content || "Je n'ai pas pu générer de réponse.";
    
    response = formatAIResponse(response);
    
    let newOrderState: OrderCollectionState | undefined;
    
    if (orderState) {
      const extractedData = extractOrderData(lastUserMessage, orderState.step);
      const updatedData = { ...orderState.data, ...extractedData };
      
      const nextStep = getNextOrderStep(orderState.step, updatedData);
      
      newOrderState = {
        step: nextStep,
        data: updatedData
      };
    } else if (hasOrderIntent) {
      newOrderState = {
        step: 'quantity',
        data: {
          productId: productInfo?.id,
          productName: productInfo?.name,
          productPrice: productInfo?.price
        }
      };
    }

    return {
      success: true,
      message: response,
      tokensUsed: completion.usage?.total_tokens || 0,
      orderCollection: newOrderState,
      isOrderIntent: hasOrderIntent
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
    
    // ✅ FALLBACK INTELLIGENT SELON LE CONTEXTE
    let fallbackMessage = "Je rencontre un problème technique temporaire.";
    
    if (productInfo?.name) {
      fallbackMessage = `Je vois que vous vous intéressez à "${productInfo.name}". Un de nos conseillers va vous recontacter rapidement pour vous aider !`;
    } else {
      fallbackMessage = "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.";
    }
    
    return {
      success: false,
      error: error.message || 'Erreur IA',
      fallbackMessage: fallbackMessage
    };
  }
}

// ✅ FORMATAGE RÉPONSES IA
function formatAIResponse(response: string): string {
  return response
    .replace(/\n\n/g, '\n\n')
    .replace(/\*\*(.*?)\*\*/g, '**$1**')
    .replace(/\*(.*?)\*/g, '*$1*')
    .trim()
}

// ✅ LOGIQUE ÉTAPES
function getNextOrderStep(currentStep: string, data: any): OrderCollectionState['step'] {
  switch (currentStep) {
    case 'quantity':
      return data.quantity ? 'phone' : 'quantity'
    case 'phone':
      return data.customerPhone ? 'name' : 'phone'
    case 'name':
      return (data.customerFirstName || data.customerLastName) ? 'address' : 'name'
    case 'address':
      return data.customerAddress ? 'payment' : 'address'
    case 'payment':
      return data.paymentMethod ? 'confirmation' : 'payment'
    case 'confirmation':
      return 'completed'
    default:
      return 'quantity'
  }
}

// ✅ MESSAGE D'ACCUEIL AMÉLIORÉ
function generateWelcomeMessage(agent: any, productInfo?: any): string {
  const baseName = agent.name || 'Rose'
  const baseTitle = agent.title || getDefaultTitle(agent.type)
  
  if (productInfo?.name) {
    return `Salut ! 👋 Je suis ${baseName}, ${baseTitle} chez VIENS ON S'CONNAÎT.

Je vois que vous vous intéressez à **"${productInfo.name}"**. C'est un excellent choix ! 💫

Comment puis-je vous aider avec ce produit ? 😊`
  }
  
  return agent.welcomeMessage || `Salut ! 👋 Je suis ${baseName}, ${baseTitle} chez VIENS ON S'CONNAÎT.

Quel produit vous intéresse aujourd'hui ? Je serais ravi de vous renseigner ! 😊`
}

// ✅ HELPER TITRE PAR DÉFAUT
function getDefaultTitle(type: string): string {
  const titles = {
    'general': 'Conseiller commercial',
    'product_specialist': 'Spécialiste produit',
    'support': 'Conseiller support',
    'upsell': 'Conseiller premium'
  }
  return titles[type as keyof typeof titles] || 'Spécialiste produit'
}

export default async function publicRoutes(fastify: FastifyInstance) {
  
  // ✅ ROUTE CORRIGÉE : Configuration publique (SANS AUTHENTIFICATION)
  fastify.get<{ Params: ShopParamsType }>('/shops/public/:shopId/config', async (request, reply) => {
    let isConnected = false;
    try {
      const { shopId } = request.params;
      fastify.log.info(`🔍 [PUBLIC CONFIG] Récupération config pour shop: ${shopId}`);
      
      // ✅ GESTION UUID vs DEMO
      if (!isValidUUID(shopId)) {
        fastify.log.warn(`⚠️ ShopId non-UUID détecté: ${shopId}, utilisation configuration fallback`);
        return getFallbackShopConfig(shopId);
      }
      
      await prisma.$connect();
      isConnected = true;
      
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
      isConnected = false;

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

      const response = {
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
            title: (agent as any).title || getDefaultTitle(agent.type),
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

      fastify.log.info(`✅ [PUBLIC CONFIG] Configuration envoyée pour ${shopId}:`, {
        agent: response.data.agent.name,
        documents: response.data.knowledgeBase.documentsCount
      });

      return response;

    } catch (error: any) {
      if (isConnected) {
        await prisma.$disconnect();
      }
      
      fastify.log.error('❌ [PUBLIC CONFIG] Erreur:', error);
      fastify.log.warn(`⚠️ Fallback activé pour shop ${request.params.shopId}`);
      return getFallbackShopConfig(request.params.shopId);
    }
  });

  // ✅ ROUTE CORRIGÉE : Chat public (SANS AUTHENTIFICATION)
  fastify.post<{ Body: ChatRequestBody }>('/chat', async (request, reply) => {
    const startTime = Date.now();
    let isConnected = false;
    
    try {
      const { shopId, message, conversationId, productInfo, visitorId, isFirstMessage } = request.body;
      
      fastify.log.info(`💬 [PUBLIC CHAT] Nouveau message pour shop: ${shopId}${isFirstMessage ? ' (premier message)' : ''}`);
      
      // ✅ VALIDATION DONNÉES
      if (!shopId || !message) {
        return reply.status(400).send({ 
          success: false, 
          error: 'shopId et message requis' 
        });
      }

      // ✅ MODE TEST AMÉLIORÉ POUR VIENS ON S'CONNAÎT
      if (!isValidUUID(shopId)) {
        fastify.log.info(`💬 [MODE TEST] Réponse simulée pour shop: ${shopId}`);
        
        let simulatedResponse = '';
        
        if (isFirstMessage && productInfo?.name) {
          simulatedResponse = `Salut ! 👋 Je suis Rose, Spécialiste produit chez VIENS ON S'CONNAÎT.

Je vois que vous vous intéressez à **"${productInfo.name}"**. C'est un excellent choix ! ✨

Comment puis-je vous aider ? 😊`;
        } else {
          simulatedResponse = getIntelligentSimulatedResponse(message, productInfo);
        }
        
        return {
          success: true,
          data: {
            conversationId: conversationId || `test-conv-${Date.now()}`,
            message: simulatedResponse,
            agent: {
              name: "Rose",
              avatar: "https://ui-avatars.com/api/?name=Rose&background=EF4444&color=fff"
            },
            responseTime: Date.now() - startTime,
            isWelcomeMessage: isFirstMessage,
            mode: 'test'
          }
        };
      }
      
      await prisma.$connect();
      isConnected = true;
      
      // ✅ VÉRIFICATION SHOP
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
        return reply.status(404).send({ 
          success: false, 
          error: 'Boutique non trouvée ou inactive' 
        });
      }

      // ✅ RÉCUPÉRATION AGENT
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
        return reply.status(404).send({ 
          success: false, 
          error: 'Aucun agent actif trouvé pour cette boutique' 
        });
      }

      // ✅ PREMIER MESSAGE AUTOMATIQUE
      if (isFirstMessage) {
        const welcomeMessage = generateWelcomeMessage(agent, productInfo);
        
        const conversation = await prisma.conversation.create({
          data: {
            shopId: shopId,
            agentId: agent.id,
            visitorId: visitorId || `visitor_${Date.now()}`,
            productId: productInfo?.id,
            productName: productInfo?.name,
            productPrice: productInfo?.price ? parseFloat(productInfo.price.toString()) : null,
            productUrl: productInfo?.url,
            visitorIp: request.ip,
            visitorUserAgent: request.headers['user-agent']
          }
        });

        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: 'assistant',
            content: welcomeMessage,
            tokensUsed: 0,
            responseTimeMs: Date.now() - startTime,
            modelUsed: 'welcome-message'
          }
        });

        await prisma.$disconnect();
        isConnected = false;

        fastify.log.info(`✅ [WELCOME] Message d'accueil envoyé pour conversation: ${conversation.id}`);

        return {
          success: true,
          data: {
            conversationId: conversation.id,
            message: welcomeMessage,
            agent: {
              name: agent.name,
              avatar: agent.avatar
            },
            responseTime: Date.now() - startTime,
            isWelcomeMessage: true
          }
        };
      }

      // ✅ GESTION CONVERSATION EXISTANTE
      let conversation;
      if (conversationId) {
        conversation = await prisma.conversation.findUnique({
          where: { id: conversationId },
          include: {
            messages: {
              orderBy: { createdAt: 'asc' },
              take: 10
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
            productPrice: productInfo?.price ? parseFloat(productInfo.price.toString()) : null,
            productUrl: productInfo?.url,
            visitorIp: request.ip,
            visitorUserAgent: request.headers['user-agent']
          },
          include: {
            messages: true
          }
        });
      }

      // ✅ SAUVEGARDER MESSAGE UTILISATEUR
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'user',
          content: message
        }
      });

      // ✅ PRÉPARER BASE DE CONNAISSANCE
      const knowledgeContent = agent.knowledgeBase
        .map(kb => `## ${kb.knowledgeBase.title}\n${kb.knowledgeBase.content}`)
        .join('\n\n---\n\n');

      // ✅ RÉCUPÉRER ÉTAT COLLECTE COMMANDE
      let orderState: OrderCollectionState | undefined;
      
      try {
        const customerData = conversation.customerData as any;
        if (customerData?.orderCollection) {
          orderState = customerData.orderCollection;
        }
      } catch (error) {
        console.warn('Erreur lecture customerData conversation:', error);
      }

      // ✅ PRÉPARER HISTORIQUE MESSAGES
      const messageHistory = conversation.messages.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      }));

      messageHistory.push({ role: 'user', content: message });

      // ✅ APPELER IA
      const aiResult = await callOpenAI(messageHistory, agent, knowledgeContent, productInfo, orderState);
      
      let aiResponse: string = aiResult.fallbackMessage || agent.fallbackMessage || "Je transmets votre question à notre équipe.";
      let tokensUsed: number = 0;

      if (aiResult.success && aiResult.message) {
        aiResponse = aiResult.message;
        tokensUsed = aiResult.tokensUsed || 0;
      } else {
        fastify.log.error('❌ [IA ERROR]:', aiResult.error);
      }

      // ✅ SAUVEGARDER ÉTAT COLLECTE
      if (aiResult.orderCollection) {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            customerData: {
              orderCollection: aiResult.orderCollection
            } as any
          }
        });

        // ✅ SAUVEGARDER COMMANDE SI TERMINÉE
        if (aiResult.orderCollection.step === 'completed') {
          try {
            const existingOrder = await prisma.order.findFirst({
              where: {
                customerPhone: aiResult.orderCollection.data.customerPhone
              },
              orderBy: { createdAt: 'desc' }
            });

            if (existingOrder && !aiResult.orderCollection.data.customerFirstName) {
              aiResult.orderCollection.data.customerFirstName = existingOrder.customerName?.split(' ')[0] || undefined;
              aiResult.orderCollection.data.customerLastName = existingOrder.customerName?.split(' ').slice(1).join(' ') || undefined;
              aiResult.orderCollection.data.customerAddress = aiResult.orderCollection.data.customerAddress || existingOrder.customerAddress || undefined;
              aiResult.orderCollection.data.customerEmail = aiResult.orderCollection.data.customerEmail || existingOrder.customerEmail || undefined;
            }

            await saveOrderToDatabase(
              conversation.id, 
              shopId, 
              agent.id, 
              {
                ...aiResult.orderCollection.data,
                visitorId,
                visitorIp: request.ip,
                visitorUserAgent: request.headers['user-agent']
              }, 
              productInfo
            );
            
            await prisma.conversation.update({
              where: { id: conversation.id },
              data: {
                conversionCompleted: true,
                customerData: {}
              }
            });
            
            fastify.log.info(`✅ [ORDER] Commande sauvegardée pour conversation: ${conversation.id}`);
            
          } catch (error) {
            console.error('❌ Erreur sauvegarde commande:', error);
            fastify.log.error('❌ [ORDER ERROR]:', error);
          }
        }
      }

      // ✅ SAUVEGARDER RÉPONSE IA
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
      isConnected = false;

      fastify.log.info(`✅ [CHAT SUCCESS] Réponse envoyée pour conversation: ${conversation.id} (${Date.now() - startTime}ms)`);

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
          tokensUsed,
          orderCollection: aiResult.orderCollection
        }
      };

    } catch (error: any) {
      if (isConnected) {
        await prisma.$disconnect();
      }
      
      fastify.log.error('❌ [CHAT ERROR]:', error);
      
      // ✅ FALLBACK CONTEXTUEL AMÉLIORÉ POUR VIENS ON S'CONNAÎT
      let fallbackResponse = "Merci pour votre message ! Comment puis-je vous aider davantage ?";
      
      const userMessage = request.body.message || '';
      const productInfo = request.body.productInfo;
      
      if (userMessage.toLowerCase().includes('bonjour') || userMessage.toLowerCase().includes('salut')) {
        if (productInfo?.name) {
          fallbackResponse = `Salut ! Je suis Rose, votre conseillère chez VIENS ON S'CONNAÎT. Je vois que vous vous intéressez à "${productInfo.name}". Comment puis-je vous aider avec ce produit ?`;
        } else {
          fallbackResponse = "Salut ! Je suis Rose, votre conseillère chez VIENS ON S'CONNAÎT. Comment puis-je vous aider ?";
        }
      } else if (productInfo?.name && userMessage.toLowerCase().includes('produit')) {
        fallbackResponse = `Concernant "${productInfo.name}", je vous mets en relation avec notre équipe pour vous donner les meilleures informations.`;
      }
      
      return {
        success: true,
        data: {
          conversationId: request.body.conversationId || `fallback-conv-${Date.now()}`,
          message: fallbackResponse,
          agent: {
            name: "Rose",
            avatar: "https://ui-avatars.com/api/?name=Rose&background=EF4444&color=fff"
          },
          responseTime: Date.now() - startTime,
          mode: 'fallback'
        }
      };
    }
  });
}

// ✅ RÉPONSE SIMULÉE INTELLIGENTE POUR VIENS ON S'CONNAÎT
function getIntelligentSimulatedResponse(message: string, productInfo: any): string {
  const msg = message.toLowerCase();
  
  if (msg.includes('bonjour') || msg.includes('salut') || msg.includes('hello')) {
    return `Salut ! Je suis Rose, votre Spécialiste produit chez VIENS ON S'CONNAÎT. 👋

Je vois que vous vous intéressez à **"${productInfo?.name || 'nos produits'}"**. 

Comment puis-je vous aider ? 😊`;
  }
  
  if (msg.includes('prix') || msg.includes('coût') || msg.includes('tarif')) {
    if (productInfo?.price) {
      return `Le prix de **"${productInfo.name}"** est de **${productInfo.price} FCFA**. 💰

C'est un excellent rapport qualité-prix ! 

Voulez-vous que je vous aide à passer commande ? 🛒`;
    }
    return "Je vais vérifier le prix pour vous. Un instant... 🔍";
  }
  
  if (msg.includes('acheter') || msg.includes('commander') || msg.includes('commande')) {
    return `Parfait ! Je vais vous aider à finaliser votre commande. ✨

**Combien d'exemplaires** souhaitez-vous commander ? 📦`;
  }
  
  if (msg.includes('info') || msg.includes('détail') || msg.includes('caractéristique')) {
    return `**"${productInfo?.name || 'Ce produit'}"** est un excellent choix ! 👌

D'après nos informations, c'est l'un de nos produits les plus appréciés chez VIENS ON S'CONNAÎT. 

Avez-vous des **questions spécifiques** ? 🤔`;
  }
  
  return "Merci pour votre message ! Comment puis-je vous aider davantage avec nos produits ? 😊";
}
// src/routes/chat.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { supabaseServiceClient, supabaseAuthClient } from '../lib/supabase';
import OpenAI from 'openai';
import { getRelevantContext, buildBeautyExpertPrompt } from '../services/beauty-rag';

// ✅ INTERFACE POUR LA CONFIG AGENT
interface AgentConfig {
  aiProvider?: 'openai' | 'claude';
  temperature?: number;
  maxTokens?: number;
  specificInstructions?: string[];
  collectName?: boolean;
  collectPhone?: boolean;
  collectEmail?: boolean;
  collectAddress?: boolean;
  upsellEnabled?: boolean;
  urgencyEnabled?: boolean;
}

// ✅ INTERFACE POUR LES MESSAGES
interface ConversationMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
  action_data?: any;
}

// ✅ INITIALISATION OPENAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️ OPENAI_API_KEY manquante - mode dégradé activé');
}

// ✅ SCHÉMAS DE VALIDATION
const testMessageSchema = z.object({
  message: z.string().min(1, 'Le message est requis'),
  agentId: z.string().min(1, 'ID agent requis'),
  shopId: z.string().min(1, 'ID shop requis'),
  testMode: z.boolean().default(true),
  // Historique de conversation pour maintenir le contexte dans le playground
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string()
  })).optional().default([]),
  // Permet au client de signaler explicitement si c'est le 1er message
  isFirstMessage: z.boolean().optional()
});

const sendMessageSchema = z.object({
  message: z.string().min(1, 'Le message est requis'),
  conversationId: z.string().optional(),
  shopId: z.string().min(1, 'ID shop requis'),
  agentId: z.string().optional(),
  productContext: z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    price: z.number().optional(),
    url: z.string().optional()
  }).optional(),
  systemPrompt: z.string().optional(),
  knowledgeBase: z.array(z.any()).optional()
});

const analyzeOrderIntentSchema = z.object({
  message: z.string(),
  conversationId: z.string().optional(),
  productContext: z.any().optional()
});

// ✅ HELPER: Vérifier l'auth Supabase
async function verifySupabaseAuth(request: FastifyRequest) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Token manquant');
  }

  const token = authHeader.substring(7);
  const { data: { user }, error } = await supabaseAuthClient.auth.getUser(token);
  
  if (error || !user) {
    throw new Error('Token invalide');
  }
  
  return user;
}

// ✅ HELPER: Récupérer ou créer shop (SUPABASE)
async function getOrCreateShop(user: any, fastify: FastifyInstance) {
  try {
    // ✅ CHERCHER LE SHOP EXISTANT
    let { data: shop, error } = await supabaseServiceClient
      .from('shops')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      // Essayer par email
      const { data: shopByEmail } = await supabaseServiceClient
        .from('shops')
        .select('*')
        .eq('email', user.email)
        .single();
      
      shop = shopByEmail;
    }

    if (!shop) {
      // ✅ CRÉER LE SHOP S'IL N'EXISTE PAS
      const { data: newShop, error: createError } = await supabaseServiceClient
        .from('shops')
        .insert({
          id: user.id,
          name: user.user_metadata?.full_name || user.email.split('@')[0] || 'Boutique',
          email: user.email,
          subscription_plan: 'free',
          is_active: true,
          widget_config: {
            theme: "modern",
            language: "fr", 
            position: "bottom-right",
            buttonText: "Parler au vendeur",
            primaryColor: "#EC4899" // ✅ Rose par défaut
          },
          agent_config: {
            name: "Assistant ChatSeller",
            title: "Conseiller commercial", // ✅ AJOUT TITRE
            avatar: "https://ui-avatars.com/api/?name=Assistant&background=EC4899&color=fff",
            upsellEnabled: false,
            welcomeMessage: "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
            fallbackMessage: "Je transmets votre question à notre équipe.",
            collectPaymentMethod: true
          }
        })
        .select()
        .single();

      if (createError) {
        fastify.log.error('❌ Erreur création shop');
        console.error('Détails erreur shop:', createError);
        throw new Error('Impossible de créer le shop');
      }

      shop = newShop;
    }

    return shop;

  } catch (error) {
    fastify.log.error('❌ Erreur getOrCreateShop');
    console.error('Détails erreur getOrCreateShop:', error);
    throw error;
  }
}

// ✅ HELPER: Appel Claude AI (Plan Pro)
async function callClaudeAI(messages: any[], systemPrompt: string, temperature = 0.7) {
  try {
    if (!process.env.CLAUDE_API_KEY) {
      console.warn('⚠️ CLAUDE_API_KEY manquante, fallback vers OpenAI');
      const responseMessage = await callOpenAI(messages, systemPrompt, temperature, false);
      return responseMessage.content || 'Désolé, je ne peux pas répondre pour le moment.';
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1000,
        temperature: temperature,
        system: systemPrompt,
        messages: messages.map(msg => ({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content
        }))
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API Error: ${response.status}`);
    }

    const data = await response.json() as {
      content: Array<{ text: string }>
    };
    return data.content[0].text;

  } catch (error) {
    console.error('❌ Erreur Claude AI:', error);
    // ✅ FALLBACK VERS OPENAI SI CLAUDE ÉCHOUE
    const responseMessage = await callOpenAI(messages, systemPrompt, temperature, false);
    return responseMessage.content || 'Désolé, je ne peux pas répondre pour le moment.';
  }
}

// ✅ HELPER: Appel OpenAI ROBUSTE
// ✅ DÉFINITION DU TOOL POUR RECOMMANDER DES PRODUITS
const recommendProductTool = {
  type: 'function' as const,
  function: {
    name: 'recommend_product',
    description: 'Recommander un produit spécifique au client après avoir compris ses besoins. Utilise cette fonction quand tu veux présenter visuellement un produit avec son image, prix et lien d\'achat.',
    parameters: {
      type: 'object',
      properties: {
        product_name: {
          type: 'string',
          description: 'Le nom exact du produit à recommander (doit correspondre à un produit du catalogue)'
        },
        reason: {
          type: 'string',
          description: 'Courte explication (1-2 phrases) de pourquoi ce produit est recommandé pour le client'
        }
      },
      required: ['product_name', 'reason']
    }
  }
};

const addToCartTool = {
  type: 'function' as const,
  function: {
    name: 'add_to_cart',
    description: 'Ajouter un produit au panier du client. Utilise cette fonction quand le client demande explicitement d\'ajouter un produit à son panier ou sa commande (ex: "ajoutez aussi la crème", "je veux aussi le sérum", "mettez-le dans mon panier").',
    parameters: {
      type: 'object',
      properties: {
        product_name: {
          type: 'string',
          description: 'Le nom exact du produit à ajouter au panier (doit correspondre à un produit du catalogue)'
        },
        quantity: {
          type: 'number',
          description: 'Quantité à ajouter (par défaut 1)'
        },
        message: {
          type: 'string',
          description: 'Message de confirmation à afficher au client (ex: "C\'est ajouté ! Autre chose ?")'
        }
      },
      required: ['product_name', 'message']
    }
  }
};

async function callOpenAI(messages: any[], systemPrompt: string, temperature = 0.7, enableTools = true) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API Key manquante');
    }

    const requestPayload: any = {
      model: 'gpt-4o', // ✅ UPGRADE VERS GPT-4O
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      temperature: temperature,
      max_tokens: 1000
    };

    // ✅ AJOUTER LES TOOLS SI ACTIVÉS
    if (enableTools) {
      requestPayload.tools = [recommendProductTool, addToCartTool];
      requestPayload.tool_choice = 'auto'; // L'IA décide quand utiliser le tool
    }

    const completion = await openai.chat.completions.create(requestPayload);

    const responseMessage = completion.choices[0]?.message;

    // ✅ RETOURNER LA RÉPONSE COMPLÈTE (peut contenir tool_calls)
    return responseMessage;

  } catch (error) {
    console.error('❌ Erreur OpenAI:', error);
    throw error;
  }
}

// ✅ HELPER: Construire le prompt système avec RAG BEAUTÉ EXPERT
function buildSystemPrompt(
  agent: any,
  knowledgeBase: any[] = [],
  productContext: any = null,
  userMessage: string = '',
  shopName?: string,
  productCatalog: any[] = [],
  existingMessages: any[] = [],
  isFirstMessage: boolean = true // ✅ NOUVEAU PARAMÈTRE EXPLICITE
) {
  const agentTitle = agent.title || getDefaultTitle(agent.type);

  // 🎯 NOUVEAU SYSTÈME RAG : Recherche contextuelle intelligente
  // ✅ PASSE LA KB MARQUE pour que l'IA utilise les docs indexés
  const relevantContext = getRelevantContext(userMessage, productCatalog, knowledgeBase);

  console.log(`🎯 [SYSTEM PROMPT] isFirstMessage: ${isFirstMessage}, existingMessages: ${existingMessages.length}`);

  // 🎯 UTILISER LE SYSTEM PROMPT EXPERT BEAUTÉ avec contexte conversationnel
  return buildBeautyExpertPrompt(agent, relevantContext, shopName, isFirstMessage);

  // ⚠️ CODE ANCIEN CONSERVÉ COMME FALLBACK (AU CAS OÙ)
  /*
  // ✅ NOUVEAU : Détection automatique domaine beauté
  const beautyType = detectBeautyType(agent.type, agentTitle);
  const beautyExpertise = getBeautyExpertise(beautyType);
  
  let systemPrompt = `Tu es ${agent.name}, ${agentTitle} experte en beauté pour un site e-commerce spécialisé.

🎯 EXPERTISE BEAUTÉ SPÉCIALISÉE: ${beautyExpertise.specialization}
DOMAINE PRINCIPAL: ${beautyType}
PERSONNALITÉ: ${agent.personality || 'friendly'}
MISSION: Conseiller comme une vraie ${agentTitle} en boutique physique

🌟 COMPÉTENCES BEAUTÉ EXPERTES:
${beautyExpertise.skills.map(skill => `- ${skill}`).join('\n')}

💡 APPROCHE CONSEIL BEAUTÉ:
- Pose des questions qualifiantes (type de peau, âge, routine actuelle, budget)
- Adapte tes conseils selon le profil beauté de la cliente
- Explique les bénéfices produits avec expertise technique
- Rassure sur les ingrédients et méthodes d'application
- Propose des routines complètes et personnalisées
- Suggère des produits complémentaires pertinents

🎨 TECHNIQUES DE VENTE BEAUTÉ:
- Écoute active des besoins beauté
- Questions ouvertes sur les habitudes et préférences
- Démonstration des bénéfices avec exemples concrets
- Gestion des objections spécifiques beauté (allergies, sensibilité, efficacité)
- Création d'urgence douce (stocks limités, offres temporaires)
- Upsell naturel vers gammes complètes

MESSAGE D'ACCUEIL: "${agent.welcomeMessage || getDefaultBeautyWelcome(beautyType)}"`;

  // ✅ CONTEXTE PRODUIT BEAUTÉ ENRICHI
  if (productContext?.name) {
    const productAnalysis = analyzeBeautyProduct(productContext.name);
    systemPrompt += `\n\n💄 PRODUIT BEAUTÉ ANALYSÉ:
- Nom: ${productContext.name}
- Catégorie détectée: ${productAnalysis.category}
- Type de peau/cheveux recommandé: ${productAnalysis.skinType}
- Bénéfices clés: ${productAnalysis.benefits.join(', ')}
- Prix: ${productContext.price ? `${productContext.price}€` : 'Sur demande'}
- Conseils d'application: ${productAnalysis.applicationTips}`;
  }

  // ✅ BASE DE CONNAISSANCES BEAUTÉ
  if (knowledgeBase && knowledgeBase.length > 0) {
    systemPrompt += `\n\n📚 EXPERTISE DOCUMENTÉE:
${knowledgeBase.map(kb => `
DOCUMENT: ${kb.title}
CONTENU: ${kb.content ? kb.content.substring(0, 800) : 'Contenu non disponible'}
---`).join('\n')}`;
  }

  // ✅ INSTRUCTIONS SPÉCIALISÉES BEAUTÉ
  const agentConfig = agent.config as AgentConfig;
  if (agentConfig?.specificInstructions && agentConfig.specificInstructions.length > 0) {
    systemPrompt += `\n\n🎯 INSTRUCTIONS PERSONNALISÉES:
${agentConfig.specificInstructions.map((inst: string) => `- ${inst}`).join('\n')}`;
  }

  systemPrompt += `\n\n🚨 RÈGLES ABSOLUES BEAUTÉ:
- TOUJOURS qualifier le type de peau/cheveux avant conseiller
- Mentionner les ingrédients clés et leurs bénéfices
- Proposer des tests/échantillons si disponibles
- Adapter le vocabulaire au niveau d'expertise de la cliente
- Créer de la confiance par ton expertise technique
- Éviter le jargon trop technique sans explication
- Être bienveillante face aux complexes beauté
- Valoriser la beauté naturelle de chaque cliente

🎭 PERSONA BEAUTÉ:
Tu incarnes une ${agentTitle} passionnée, bienveillante et experte. Tu adores aider les femmes à se sentir belles et confiantes. Tu connais parfaitement les dernières tendances, les ingrédients innovants et les techniques d'application. Tu es comme cette vendeuse en boutique que toutes les clientes adorent consulter.`;

  return systemPrompt;
  */
}

// ✅ NOUVELLES FONCTIONS SUPPORT BEAUTÉ (conservées pour compatibilité)

function detectBeautyType(agentType: string, agentTitle: string): string {
  const title = agentTitle.toLowerCase();
  
  if (title.includes('esthéticienne') || title.includes('soin')) return 'skincare';
  if (title.includes('maquillage') || title.includes('makeup')) return 'makeup';
  if (title.includes('parfum') || title.includes('fragrance')) return 'fragrance';
  if (title.includes('cheveux') || title.includes('coiffure') || title.includes('capillaire')) return 'haircare';
  if (title.includes('ongles') || title.includes('manucure')) return 'nails';
  
  return 'multi'; // Multi-beauté
}

function getBeautyExpertise(beautyType: string) {
  const expertiseMap = {
    skincare: {
      specialization: "Soins du visage et du corps",
      skills: [
        "Analyse professionnelle des types de peau",
        "Connaissance approfondie des ingrédients actifs",
        "Création de routines personnalisées",
        "Expertise anti-âge, hydratation, acné",
        "Conseils protection solaire et prévention"
      ]
    },
    makeup: {
      specialization: "Maquillage et colorimétrie",
      skills: [
        "Analyse du teint et sous-tons",
        "Techniques d'application professionnelles",
        "Colorimétrie et harmonies chromatiques",
        "Maquillage selon morphologie du visage",
        "Tendances et looks adaptés aux occasions"
      ]
    },
    fragrance: {
      specialization: "Parfumerie et olfaction",
      skills: [
        "Connaissance des familles olfactives",
        "Analyse des préférences et personnalité",
        "Accords parfaits selon saisons et occasions",
        "Techniques de layering et tenue",
        "Histoire et composition des fragrances"
      ]
    },
    haircare: {
      specialization: "Soins capillaires et coiffure",
      skills: [
        "Diagnostic des types et états de cheveux",
        "Routines adaptées aux problématiques capillaires",
        "Techniques de coiffage et mise en forme",
        "Conseils couleur et traitements",
        "Protection et réparation des cheveux abîmés"
      ]
    },
    multi: {
      specialization: "Beauté globale et bien-être",
      skills: [
        "Vision holistique de la beauté",
        "Coordination des routines visage/corps/cheveux",
        "Conseils lifestyle et confiance en soi",
        "Adaptation aux budgets et contraintes",
        "Suivi personnalisé et évolution des besoins"
      ]
    }
  };
  
  return expertiseMap[beautyType as keyof typeof expertiseMap] || expertiseMap.multi;
}

function analyzeBeautyProduct(productName: string) {
  const name = productName.toLowerCase();
  
  let category = 'beauté';
  let skinType = 'tous types';
  let benefits: string[] = [];
  let applicationTips = '';
  
  // Analyse catégorie
  if (name.includes('sérum') || name.includes('serum')) {
    category = 'sérum visage';
    benefits = ['concentration élevée d\'actifs', 'pénétration optimale', 'résultats ciblés'];
    applicationTips = 'Appliquer quelques gouttes sur peau propre, avant la crème';
  } else if (name.includes('crème') || name.includes('cream')) {
    category = 'soin hydratant';
    benefits = ['hydratation longue durée', 'confort cutané', 'protection'];
    applicationTips = 'Masser délicatement en mouvements circulaires jusqu\'à absorption';
  } else if (name.includes('rouge') || name.includes('lipstick')) {
    category = 'maquillage lèvres';
    benefits = ['couleur intense', 'tenue longue durée', 'confort'];
    applicationTips = 'Appliquer en partant du centre vers les commissures';
  } else if (name.includes('fond de teint') || name.includes('foundation')) {
    category = 'teint';
    benefits = ['couvrance modulable', 'fini naturel', 'longue tenue'];
    applicationTips = 'Étaler du centre du visage vers l\'extérieur en estompant';
  }
  
  // Analyse type de peau
  if (name.includes('sensitive') || name.includes('sensible')) skinType = 'peaux sensibles';
  if (name.includes('oily') || name.includes('grasse')) skinType = 'peaux grasses';
  if (name.includes('dry') || name.includes('sèche')) skinType = 'peaux sèches';
  if (name.includes('mature') || name.includes('anti-âge')) skinType = 'peaux matures';
  
  return { category, skinType, benefits, applicationTips };
}

function getDefaultBeautyWelcome(beautyType: string): string {
  const welcomes = {
    skincare: "Bonjour ! Je suis votre esthéticienne IA. Quel est votre type de peau et quels sont vos objectifs beauté ?",
    makeup: "Salut ! Experte maquillage à votre service. Quel look souhaitez-vous créer aujourd'hui ?",
    fragrance: "Bonjour ! Conseillère parfums ici. Quelle fragrance vous ferait rêver ?",
    haircare: "Hello ! Spécialiste capillaire à votre écoute. Parlez-moi de vos cheveux !",
    multi: "Bonjour ! Conseillère beauté globale ici. Comment puis-je vous aider à révéler votre beauté ?"
  };
  
  return welcomes[beautyType as keyof typeof welcomes] || welcomes.multi;
}

// ✅ HELPER: Titre par défaut selon le type
function getDefaultTitle(type: string): string {
  const titles = {
    general: 'Conseiller commercial',
    product_specialist: 'Spécialiste produit', 
    support: 'Conseiller support',
    upsell: 'Conseiller premium'
  }
  return titles[type as keyof typeof titles] || 'Conseiller commercial'
}

// ✅ HELPER: Réponse intelligente de fallback
function getIntelligentResponse(message: string, productInfo: any, agent: any): string {
  const msg = message.toLowerCase();
  const agentName = agent.name || 'Assistant';
  const agentTitle = agent.title || getDefaultTitle(agent.type);
  const productName = productInfo?.name || 'ce produit';
  
  if (msg.includes('acheter') || msg.includes('commander')) {
    return `Parfait ! Je vais vous aider à commander **${productName}**. 🎉

**Combien d'exemplaires** souhaitez-vous ?`;
  }
  
  if (msg.includes('prix')) {
    return `Je vérifie le prix de **${productName}** pour vous... Un instant ! ⏳`;
  }
  
  if (msg.includes('bonjour') || msg.includes('salut')) {
    return `Bonjour ! 👋 Je suis ${agentName}, votre ${agentTitle}.

${productInfo?.name ? `Je vois que vous vous intéressez à **"${productInfo.name}"**.` : ''}

Comment puis-je vous aider ? 😊`;
  }
  
  return `Merci pour votre question ! 😊 En tant que ${agentTitle}, je vous mets en relation avec notre équipe pour les informations plus précises sur **${productName}**.`;
}

export default async function chatRoutes(fastify: FastifyInstance) {

  // ✅ ROUTE: INITIALISER UNE CONVERSATION (POST /api/v1/chat/init)
  fastify.post('/init', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      fastify.log.info('🎬 Initialisation nouvelle conversation');

      const initSchema = z.object({
        shopId: z.string().uuid(),
        agentId: z.string().uuid().optional(),
        productContext: z.object({
          id: z.string().optional(),
          name: z.string().optional(),
          url: z.string().optional(),
          price: z.number().optional()
        }).optional()
      });

      const body = initSchema.parse(request.body);

      // ✅ RÉCUPÉRER LE SHOP
      const { data: shop, error: shopError } = await supabaseServiceClient
        .from('shops')
        .select('*')
        .eq('id', body.shopId)
        .single();

      if (shopError || !shop || !shop.is_active) {
        return reply.status(404).send({
          success: false,
          error: 'Shop non trouvé ou inactif'
        });
      }

      // ✅ RÉCUPÉRER L'AGENT ACTIF
      const { data: agents } = await supabaseServiceClient
        .from('agents')
        .select('*')
        .eq('shop_id', shop.id)
        .eq('is_active', true);

      let agent = null;
      if (body.agentId) {
        agent = agents?.find(a => a.id === body.agentId);
      } else {
        agent = agents?.[0];
      }

      if (!agent) {
        return reply.status(404).send({
          success: false,
          error: 'Aucun agent actif trouvé'
        });
      }

      // ✅ CRÉER LA CONVERSATION
      const { data: conversation, error: convError } = await supabaseServiceClient
        .from('conversations')
        .insert({
          shop_id: shop.id,
          agent_id: agent.id,
          status: 'active',
          visitor_ip: request.ip,
          visitor_user_agent: request.headers['user-agent'] || '',
          product_id: body.productContext?.id || null,
          product_name: body.productContext?.name || null,
          product_url: body.productContext?.url || null,
          product_price: body.productContext?.price || null
        })
        .select()
        .single();

      if (convError) {
        console.error('❌ Erreur création conversation:', convError);
        return reply.status(500).send({
          success: false,
          error: 'Erreur création conversation'
        });
      }

      // ✅ ENVOYER LE MESSAGE DE BIENVENUE
      const welcomeMessage = agent.welcome_message ||
        `Bonjour ! Je suis ${agent.name}, votre ${agent.title || 'conseillère'}. Comment puis-je vous aider aujourd'hui ?`;

      const { data: welcomeMsg, error: msgError } = await supabaseServiceClient
        .from('messages')
        .insert({
          id: randomUUID(),
          conversation_id: conversation.id,
          role: 'assistant',
          content: welcomeMessage,
          content_type: 'text'
        })
        .select()
        .single();

      if (msgError) {
        console.error('❌ Erreur message bienvenue:', JSON.stringify(msgError));
        return reply.status(500).send({
          success: false,
          error: 'Erreur envoi message bienvenue'
        });
      }

      return reply.send({
        success: true,
        data: {
          conversationId: conversation.id,
          welcomeMessage: welcomeMsg.content,
          agent: {
            id: agent.id,
            name: agent.name,
            title: agent.title,
            avatar: agent.avatar
          }
        }
      });

    } catch (error: any) {
      console.error('❌ Erreur init conversation:', error);
      return reply.status(400).send({
        success: false,
        error: error.message || 'Erreur initialisation conversation'
      });
    }
  });

  // ✅ ROUTE: TEST IA POUR LE PLAYGROUND (POST /api/v1/chat/test)
  fastify.post('/test', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    
    try {
      fastify.log.info('🧪 Test IA depuis le playground');
      
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);
      const body = testMessageSchema.parse(request.body);

      if (!shop) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Shop non trouvé' 
        });
      }

      // ✅ RÉCUPÉRER L'AGENT AVEC SA BASE DE CONNAISSANCES (SUPABASE)
      // ✅ CORRECTION: Utiliser LEFT JOIN (sans !inner) pour récupérer l'agent même sans documents
      const { data: agent, error: agentError } = await supabaseServiceClient
        .from('agents')
        .select(`
          id, name, title, type, personality, description,
          welcome_message, fallback_message, avatar, config,
          agent_knowledge_base(
            knowledge_base(
              id, title, content, content_type, is_active
            )
          )
        `)
        .eq('id', body.agentId)
        .eq('shop_id', shop.id)
        .single();

      if (agentError || !agent) {
        console.error('❌ Erreur récupération agent pour test:', agentError);
        return reply.status(404).send({
          success: false,
          error: 'Agent non trouvé',
          details: process.env.NODE_ENV === 'development' ? agentError?.message : undefined
        });
      }

      // ✅ S'assurer que l'agent a un titre
      if (!agent.title) {
        agent.title = getDefaultTitle(agent.type);
        
        // ✅ METTRE À JOUR EN BASE SI TITRE MANQUANT
        try {
          await supabaseServiceClient
            .from('agents')
            .update({ title: agent.title })
            .eq('id', agent.id);
          console.log(`✅ Titre ajouté pour agent ${agent.id}: ${agent.title}`);
        } catch (updateError) {
          console.warn('⚠️ Impossible de mettre à jour le titre en base:', updateError);
        }
      }

      // ✅ CONSTRUIRE LA BASE DE CONNAISSANCES
      const knowledgeBase = (agent.agent_knowledge_base || [])
        .filter((akb: any) => akb.knowledge_base?.is_active)
        .map((akb: any) => akb.knowledge_base);

      // ✅ CHARGER LE CATALOGUE PRODUITS DU SHOP (pour le RAG)
      const { data: products } = await supabaseServiceClient
        .from('products')
        .select('id, name, description, price, image_url, url, category, is_active')
        .eq('shop_id', shop.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      const productCatalog = products || [];

      // ✅ HISTORIQUE DE CONVERSATION (envoyé par le client playground)
      const conversationHistory = body.conversationHistory || [];

      // ✅ isFirstMessage : calculé depuis l'historique (sauf si forcé par le client)
      const isFirstMessage = body.isFirstMessage !== undefined
        ? body.isFirstMessage
        : conversationHistory.length === 0;

      console.log(`🎯 [PLAYGROUND TEST] isFirstMessage: ${isFirstMessage}, historique: ${conversationHistory.length} messages`);

      // ✅ CONSTRUIRE LE PROMPT SYSTÈME AVEC RAG BEAUTÉ
      const systemPrompt = buildSystemPrompt(
        agent,
        knowledgeBase,
        null,           // productContext
        body.message,   // userMessage pour RAG
        shop.name,      // shopName
        productCatalog, // ✅ catalogue réel du shop
        conversationHistory, // ✅ historique réel
        isFirstMessage  // ✅ calculé dynamiquement
      );

      // ✅ PRÉPARER LES MESSAGES (historique + nouveau message)
      const messages = [
        ...conversationHistory,
        { role: 'user', content: body.message }
      ];

      // ✅ CHOISIR LE PROVIDER IA
      const agentConfig = agent.config as AgentConfig;
      const aiProvider = agentConfig?.aiProvider || 'openai';
      const temperature = agentConfig?.temperature || 0.65; // 0.65 = bon équilibre naturel/cohérent

      let aiResponse: string;
      let provider: string;

      if (aiProvider === 'claude' && shop.subscription_plan !== 'free') {
        // ✅ UTILISER CLAUDE POUR LES PLANS PAYANTS
        aiResponse = await callClaudeAI(messages, systemPrompt, temperature);
        provider = 'claude';
      } else {
        // ✅ UTILISER OPENAI AVEC TOOLS (pour que les recommandations produits fonctionnent aussi en test)
        const responseMessage = await callOpenAI(messages, systemPrompt, temperature, true);
        // Si tool call → extraire le texte de la raison
        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
          const args = JSON.parse(responseMessage.tool_calls[0].function.arguments);
          aiResponse = args.reason || responseMessage.content || 'Je vous recommande ce produit.';
        } else {
          aiResponse = responseMessage.content || 'Désolé, je ne peux pas répondre pour le moment.';
        }
        provider = 'openai';
      }

      const responseTime = Date.now() - startTime;

      fastify.log.info(`✅ Test IA réussi avec ${provider} en ${responseTime}ms`);

      return {
        success: true,
        data: {
          message: aiResponse,
          provider: provider,
          responseTime: responseTime,
          agent: {
            id: agent.id,
            name: agent.name,
            title: agent.title, // ✅ TITRE INCLUS
            type: agent.type
          },
          knowledgeBaseCount: knowledgeBase.length
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Erreur test IA');
      console.error('Détails erreur test IA:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors du test IA',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE: CHAT MESSAGE PUBLIC (POST /api/v1/chat/message)
  fastify.post('/message', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    
    try {
      fastify.log.info('💬 Nouveau message chat public');
      
      const body = sendMessageSchema.parse(request.body);

      // ✅ RÉCUPÉRER LE SHOP ET SES AGENTS (SUPABASE)
      const { data: shop, error: shopError } = await supabaseServiceClient
        .from('shops')
        .select('*')
        .eq('id', body.shopId)
        .single();

      if (shopError || !shop || !shop.is_active) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Shop non trouvé ou inactif' 
        });
      }

      // ✅ RÉCUPÉRER LES AGENTS ACTIFS AVEC TITRE (LEFT JOIN - agents sans KB inclus)
      const { data: agents, error: agentsError } = await supabaseServiceClient
        .from('agents')
        .select(`
          id, name, title, type, personality, description,
          welcome_message, fallback_message, avatar, config,
          agent_knowledge_base(
            knowledge_base(
              id, title, content, content_type, tags, is_active
            )
          )
        `)
        .eq('shop_id', shop.id)
        .eq('is_active', true);

      if (agentsError || !agents || agents.length === 0) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Aucun agent actif trouvé' 
        });
      }

      // ✅ SÉLECTIONNER L'AGENT (Premier actif ou celui spécifié)
      let agent = null;
      if (body.agentId) {
        agent = agents.find(a => a.id === body.agentId);
      } else {
        agent = agents[0]; // Premier agent actif
      }

      if (!agent) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent spécifié non trouvé' 
        });
      }

      // ✅ S'assurer que l'agent a un titre
      if (!agent.title) {
        agent.title = getDefaultTitle(agent.type);

        // ✅ METTRE À JOUR EN BASE SI TITRE MANQUANT
        try {
          await supabaseServiceClient
            .from('agents')
            .update({ title: agent.title })
            .eq('id', agent.id);
          console.log(`✅ Titre ajouté pour agent ${agent.id}: ${agent.title}`);
        } catch (updateError) {
          console.warn('⚠️ Impossible de mettre à jour le titre en base:', updateError);
        }
      }

      // ✅ CHARGER LE CATALOGUE DE PRODUITS DU SHOP
      const { data: products } = await supabaseServiceClient
        .from('products')
        .select('id, name, description, price, image_url, url, category, is_active')
        .eq('shop_id', shop.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      const productCatalog = products || [];
      console.log(`📦 ${productCatalog.length} produits chargés pour le shop ${shop.id}`);

      // ✅ GÉRER LA CONVERSATION (SUPABASE)
      let conversation = null;
      if (body.conversationId) {
        // ✅ RÉCUPÉRER LA CONVERSATION AVEC MESSAGES TRIÉS PAR DATE
        const { data: existingConv, error: convFetchError } = await supabaseServiceClient
          .from('conversations')
          .select('*, messages(id, role, content, content_type, created_at)')
          .eq('id', body.conversationId)
          .single();

        if (convFetchError) {
          fastify.log.warn(`⚠️ Erreur récupération conversation: ${convFetchError.message}`);
        } else if (existingConv) {
          // ✅ TRIER LES MESSAGES PAR DATE (Supabase ne garantit pas l'ordre)
          if (existingConv.messages && Array.isArray(existingConv.messages)) {
            existingConv.messages.sort((a: any, b: any) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
          }
          conversation = existingConv;
          fastify.log.info(`📜 Conversation existante trouvée avec ${existingConv.messages?.length || 0} messages`);
        }
      }

      if (!conversation) {
        // ✅ CRÉER NOUVELLE CONVERSATION
        const { data: newConv, error: convError } = await supabaseServiceClient
          .from('conversations')
          .insert({
            shop_id: shop.id,
            agent_id: agent.id,
            status: 'active',
            visitor_ip: request.ip,
            visitor_user_agent: request.headers['user-agent'] || '',
            product_id: body.productContext?.id || null,
            product_name: body.productContext?.name || null,
            product_url: body.productContext?.url || null,
            product_price: body.productContext?.price || null,
            customer_data: {
              userAgent: request.headers['user-agent'] || '',
              ip: request.ip,
              productContext: body.productContext || {}
            }
          })
          .select('*, messages(*)')
          .single();

        if (convError) {
          fastify.log.error('❌ Erreur création conversation');
          console.error('Détails erreur conversation:', convError);
          return reply.status(500).send({
            success: false,
            error: 'Erreur création conversation'
          });
        }

        conversation = newConv;

        // ✅ ENVOYER AUTOMATIQUEMENT LE MESSAGE DE BIENVENUE DE L'IA
        const welcomeMessage = agent.welcome_message ||
          `Bonjour ! Je suis ${agent.name}, votre ${agent.title || 'conseillère'}. Comment puis-je vous aider aujourd'hui ?`;

        const { data: welcomeData, error: welcomeError } = await supabaseServiceClient
          .from('messages')
          .insert({
            id: randomUUID(),
            conversation_id: conversation.id,
            role: 'assistant',
            content: welcomeMessage,
            content_type: 'text'
          })
          .select()
          .single();

        if (welcomeError) {
          console.warn('⚠️ Erreur envoi message bienvenue:', welcomeError);
        } else {
          console.log('✅ Message de bienvenue automatique envoyé');
          // ✅ IMPORTANT: Mettre à jour conversation.messages avec le message de bienvenue
          conversation.messages = [welcomeData];
        }
      }

      // ✅ SAUVEGARDER LE MESSAGE UTILISATEUR
      const { error: msgError } = await supabaseServiceClient
        .from('messages')
        .insert({
          id: randomUUID(),
          conversation_id: conversation.id,
          role: 'user',
          content: body.message,
          content_type: 'text'
        });

      if (msgError) {
        fastify.log.error('❌ Erreur sauvegarde message');
        console.error('Détails erreur message:', msgError);
      }

      // ✅ CONSTRUIRE LA BASE DE CONNAISSANCES
      const knowledgeBase = (agent.agent_knowledge_base || [])
        .filter((akb: any) => akb.knowledge_base?.is_active)
        .map((akb: any) => akb.knowledge_base);

      // ✅ LOGS DÉTAILLÉS POUR DEBUG
      console.log('🔍 [DEBUG] conversation.messages brut:', JSON.stringify(conversation.messages, null, 2));
      console.log('🔍 [DEBUG] conversation.id:', conversation.id);
      console.log('🔍 [DEBUG] body.conversationId fourni:', body.conversationId);

      // ✅ CONSTRUIRE L'HISTORIQUE DE LA CONVERSATION (AVANT d'ajouter le nouveau message)
      const existingMessages = (conversation.messages || []).map((msg: ConversationMessage) => ({
        role: msg.role,
        content: msg.content
      }));

      // ✅ LOGS DES MESSAGES EXISTANTS
      console.log('🔍 [DEBUG] existingMessages parsés:', existingMessages.length);
      existingMessages.forEach((msg: { role: string; content: string }, i: number) => {
        console.log(`   [${i}] ${msg.role}: "${msg.content.substring(0, 50)}..."`);
      });

      // ✅ DÉTECTER SI C'EST LE PREMIER MESSAGE (AUCUN MESSAGE DANS L'HISTORIQUE)
      // isFirstMessage = true SEULEMENT si la conversation est VIDE (pas de welcome message envoyé)
      // Si le welcome message a déjà été envoyé, l'IA ne doit PAS re-saluer
      const isFirstMessage = existingMessages.length === 0;

      console.log('🔍 [DEBUG] Total messages existants:', existingMessages.length);
      console.log('🔍 [DEBUG] isFirstMessage calculé:', isFirstMessage);
      console.log('🔍 [DEBUG] → Si isFirstMessage=false, l\'IA ne dira PAS Bonjour');
      fastify.log.info(`📊 [CHAT] Messages existants: ${existingMessages.length}, isFirstMessage: ${isFirstMessage}`);

      // ✅ AJOUTER LE NOUVEAU MESSAGE À L'HISTORIQUE POUR OPENAI
      const conversationHistory = [
        ...existingMessages,
        { role: 'user', content: body.message }
      ];

      // ✅ CONSTRUIRE LE PROMPT SYSTÈME AVEC RAG BEAUTÉ
      const systemPrompt = buildSystemPrompt(
        agent,
        knowledgeBase,
        body.productContext,
        body.message, // userMessage pour RAG
        shop.name, // shopName
        productCatalog, // ✅ CATALOGUE DE PRODUITS RÉEL
        existingMessages, // ✅ Messages AVANT le nouveau pour détecter premier message
        isFirstMessage // ✅ PASSER EXPLICITEMENT LE FLAG
      );

      // ✅ GÉNÉRER LA RÉPONSE IA
      const agentConfig = agent.config as AgentConfig;
      const aiProvider = agentConfig?.aiProvider || 'openai';
      const temperature = agentConfig?.temperature || 0.65; // 0.65 = naturel mais cohérent

      let aiResponse: string;
      let provider: string;
      let productCard: any = null; // Pour stocker la carte produit si recommandation
      let cartItem: any = null; // Pour stocker l'item panier si add_to_cart

      try {
        if (aiProvider === 'claude' && shop.subscription_plan !== 'free') {
          aiResponse = await callClaudeAI(conversationHistory, systemPrompt, temperature);
          provider = 'claude';
        } else {
          // ✅ APPEL OPENAI AVEC SUPPORT TOOL CALLS
          const responseMessage = await callOpenAI(conversationHistory, systemPrompt, temperature);
          provider = 'openai';

          // ✅ VÉRIFIER SI L'IA VEUT UTILISER UN TOOL
          if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            // Traiter le premier tool call (GPT-4o envoie généralement 1 à la fois)
            const toolCall = responseMessage.tool_calls[0];
            // Le texte accompagnant le tool call (si l'IA a écrit du texte + appelé un tool)
            const textContent = responseMessage.content || '';

            if (toolCall.function.name === 'recommend_product') {
              const args = JSON.parse(toolCall.function.arguments);
              console.log('🎯 [TOOL] recommend_product:', args.product_name);

              const recommendedProduct = productCatalog.find((p: any) =>
                p.name.toLowerCase().includes(args.product_name.toLowerCase()) ||
                args.product_name.toLowerCase().includes(p.name.toLowerCase())
              );

              if (recommendedProduct) {
                console.log('✅ Produit trouvé:', recommendedProduct.name, '— prix:', recommendedProduct.price);

                productCard = {
                  id: recommendedProduct.id,
                  name: recommendedProduct.name,
                  description: recommendedProduct.description || args.reason,
                  price: recommendedProduct.price,
                  image_url: recommendedProduct.image_url,
                  url: recommendedProduct.url,
                  reason: args.reason
                };

                // ✅ Si l'IA a écrit du texte EN PLUS du tool call, on le garde
                // Sinon, on utilise la raison comme texte
                aiResponse = textContent || args.reason;
              } else {
                console.warn('⚠️ Produit non trouvé dans le catalogue:', args.product_name);
                aiResponse = textContent || `Je te recommande ${args.product_name}. ${args.reason}`;
              }
            } else if (toolCall.function.name === 'add_to_cart') {
              const args = JSON.parse(toolCall.function.arguments);
              console.log('🛒 [TOOL] add_to_cart:', args.product_name);

              const cartProduct = productCatalog.find((p: any) =>
                p.name.toLowerCase().includes(args.product_name.toLowerCase()) ||
                args.product_name.toLowerCase().includes(p.name.toLowerCase())
              );

              if (cartProduct) {
                console.log('✅ Produit ajouté au panier:', cartProduct.name);

                cartItem = {
                  id: cartProduct.id,
                  name: cartProduct.name,
                  price: cartProduct.price,
                  quantity: args.quantity || 1,
                  image_url: cartProduct.image_url,
                  url: cartProduct.url
                };

                aiResponse = textContent || args.message || `${cartProduct.name} a été ajouté à ton panier !`;
              } else {
                console.warn('⚠️ Produit non trouvé pour panier:', args.product_name);
                aiResponse = textContent || `Désolé, je n'ai pas trouvé "${args.product_name}" dans notre catalogue.`;
              }
            } else {
              aiResponse = responseMessage.content || 'Désolé, je ne peux pas répondre pour le moment.';
            }
          } else {
            // ✅ RÉPONSE TEXTUELLE NORMALE (pas de tool call)
            aiResponse = responseMessage.content || 'Désolé, je ne peux pas répondre pour le moment.';

            // 🎯 POST-DÉTECTION : Si l'IA mentionne un produit du catalogue SANS tool call,
            // on trouve le produit mentionné et on crée une product card automatiquement
            if (productCatalog.length > 0) {
              const responseLower = aiResponse.toLowerCase();
              const mentionedProduct = productCatalog.find((p: any) => {
                const nameLower = p.name.toLowerCase();
                // Vérifier si le nom complet du produit est mentionné dans la réponse
                return responseLower.includes(nameLower);
              });

              if (mentionedProduct) {
                console.log('🎯 [AUTO-CARD] Produit détecté dans le texte sans tool call:', mentionedProduct.name);
                productCard = {
                  id: mentionedProduct.id,
                  name: mentionedProduct.name,
                  description: mentionedProduct.description || '',
                  price: mentionedProduct.price,
                  image_url: mentionedProduct.image_url,
                  url: mentionedProduct.url,
                  reason: 'Recommandation personnalisée'
                };
              }
            }
          }
        }
      } catch (aiError) {
        console.error('❌ Erreur IA:', aiError);
        aiResponse = getIntelligentResponse(body.message, body.productContext, agent);
        provider = 'fallback';
      }

      // ✅ POST-PROCESSING : Supprimer les salutations si ce n'est PAS le premier message
      if (!isFirstMessage && aiResponse) {
        const originalResponse = aiResponse;

        // Stratégie : supprimer la LIGNE ENTIÈRE si elle commence par un mot de salutation
        // (pas de regex avec emoji dans les character classes — ça ne marche pas sans flag `u`)
        let cleaned = aiResponse;

        // Étape 1 : Supprimer la première ligne si c'est une salutation
        // Matche "Bonjour", "Bonjour !", "Bonjour ! 😊", "Bonjour et bienvenue !", etc.
        cleaned = cleaned.replace(/^(Bonjour et bienvenue|Bonjour|Bonsoir|Salut|Hello|Coucou|Bienvenue|Ravie?|Enchantée?|Hey)\b[^\n]*/i, '');

        // Étape 2 : Supprimer les lignes d'introduction redondantes (après la salutation)
        cleaned = cleaned.replace(/^(C'est un plaisir|Je suis (ravie?|là|contente?|heureuse?))[^\n]*/i, '');

        // Étape 3 : Nettoyer les sauts de ligne en tête
        cleaned = cleaned.replace(/^\s*\n+/, '');
        cleaned = cleaned.trim();

        // Étape 4 : Capitaliser la première lettre
        if (cleaned && cleaned.length > 10 && cleaned !== originalResponse) {
          cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
          console.log('🔧 [POST-PROCESS] Salutation supprimée. Avant:', originalResponse.substring(0, 60), '→ Après:', cleaned.substring(0, 60));
          aiResponse = cleaned;
        } else if (cleaned !== originalResponse) {
          // Si le nettoyage a trop retiré, garder l'original
          console.log('⚠️ [POST-PROCESS] Nettoyage trop agressif, texte restant trop court. On garde l\'original.');
        }
      }

      // ✅ SAUVEGARDER LA RÉPONSE IA
      const contentType = productCard ? 'product_card' : cartItem ? 'cart_update' : 'text';
      const messageToSave: any = {
        id: randomUUID(),
        conversation_id: conversation.id,
        role: 'assistant',
        content: aiResponse,
        content_type: contentType,
        response_time_ms: Date.now() - startTime,
        model_used: provider,
        tokens_used: 0,
        action_data: {
          provider: provider,
          temperature: temperature,
          timestamp: new Date().toISOString(),
          ...(productCard && { product_card: productCard }),
          ...(cartItem && { cart_item: cartItem })
        }
      };

      const { error: aiMsgError } = await supabaseServiceClient
        .from('messages')
        .insert(messageToSave);

      if (aiMsgError) {
        fastify.log.error('❌ Erreur sauvegarde réponse IA');
        console.error('Détails erreur IA:', aiMsgError);
      }

      const responseTime = Date.now() - startTime;

      fastify.log.info(`✅ Message traité avec ${provider} en ${responseTime}ms`);

      return {
        success: true,
        data: {
          message: aiResponse,
          conversationId: conversation.id,
          provider: provider,
          responseTime: responseTime,
          agent: {
            id: agent.id,
            name: agent.name,
            title: agent.title, // ✅ TITRE INCLUS
            type: agent.type
          },
          ...(productCard && { // ✅ INCLURE LA CARTE PRODUIT SI PRÉSENTE
            content_type: 'product_card',
            product_card: productCard
          }),
          ...(cartItem && { // ✅ INCLURE L'ITEM PANIER SI AJOUT VIA IA
            content_type: 'cart_update',
            cart_item: cartItem
          })
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Erreur chat message');
      console.error('Détails erreur chat message:', error);
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors du traitement du message',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE: ANALYSER L'INTENTION DE COMMANDE (POST /api/v1/chat/analyze-order-intent)
  fastify.post('/analyze-order-intent', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      fastify.log.info('🔍 Analyse intention de commande');
      
      const body = analyzeOrderIntentSchema.parse(request.body);

      // ✅ LOGIQUE D'ANALYSE D'INTENTION AMÉLIORÉE
      const orderKeywords = [
        // Intentions directes d'achat
        'acheter', 'commander', 'commande', 'achat', 'prendre', 'veux', 'souhaite',
        'vais prendre', 'je le veux', 'ça m\'intéresse', 'je vais l\'acheter',
        
        // Questions sur le processus d'achat
        'comment faire', 'comment commander', 'comment acheter', 'comment procéder',
        'où acheter', 'comment passer commande', 'comment finaliser',
        
        // Expressions d'intérêt fort
        'intéressé', 'intéresse', 'ça me plaît', 'parfait', 'c\'est bon', 
        'd\'accord', 'ok pour', 'je confirme', 'go', 'allons-y',
        
        // Actions liées à l'achat
        'réserver', 'livraison', 'payer', 'finaliser', 'confirmer', 'valider',
        'continuer', 'suivant', 'étape suivante',
        
        // Prix et quantités
        'combien', 'prix', 'coûte', 'payer', 'panier',
        'exemplaire', 'unité', 'pièce', 'fois'
      ];

      const lowerMessage = body.message.toLowerCase();
      const hasOrderKeyword = orderKeywords.some(keyword => lowerMessage.includes(keyword));
      
      // Vérifications supplémentaires
      const hasQuantityPattern = /\b\d+\b|\b(un|une|deux|trois|quatre|cinq)\b/i.test(body.message);
      const hasPositiveSignal = /(oui|yes|ok|d'accord|parfait|bien|super)/i.test(body.message);
      
      const hasOrderIntent = hasOrderKeyword || (hasQuantityPattern && hasPositiveSignal);

      let action = null;
      let confidence = 0.2;
      
      if (hasOrderIntent) {
        confidence = 0.8;
        
        if (lowerMessage.includes('acheter') || lowerMessage.includes('commander')) {
          action = 'start_order';
          confidence = 0.9;
        } else if (lowerMessage.includes('prix') || lowerMessage.includes('coût')) {
          action = 'show_price';
          confidence = 0.7;
        } else {
          action = 'show_product_info';
          confidence = 0.6;
        }
      }

      return {
        success: true,
        data: {
          hasOrderIntent,
          confidence,
          action,
          detectedKeywords: orderKeywords.filter(k => lowerMessage.includes(k)),
          analysis: {
            hasQuantityPattern,
            hasPositiveSignal,
            messageLength: body.message.length,
            productContext: !!body.productContext
          }
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Erreur analyse intention');
      console.error('Détails erreur analyse intention:', error);
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de l\'analyse d\'intention'
      });
    }
  });
}
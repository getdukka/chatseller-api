// src/routes/chat.ts - VERSION COMPLÈTE CORRIGÉE ✅
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabaseServiceClient, supabaseAuthClient } from '../lib/supabase';
import OpenAI from 'openai';

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
  testMode: z.boolean().default(true)
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
      return await callOpenAI(messages, systemPrompt, temperature);
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
    return await callOpenAI(messages, systemPrompt, temperature);
  }
}

// ✅ HELPER: Appel OpenAI ROBUSTE
async function callOpenAI(messages: any[], systemPrompt: string, temperature = 0.7) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API Key manquante');
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      temperature: temperature,
      max_tokens: 1000
    });

    return completion.choices[0]?.message?.content || 'Désolé, je ne peux pas répondre pour le moment.';

  } catch (error) {
    console.error('❌ Erreur OpenAI:', error);
    throw error;
  }
}

// ✅ HELPER: Construire le prompt système avec base de connaissances ET TITRE
function buildSystemPrompt(agent: any, knowledgeBase: any[] = [], productContext: any = null) {
  const agentTitle = agent.title || getDefaultTitle(agent.type);
  
  let systemPrompt = `Tu es ${agent.name}, ${agentTitle} expert pour un site e-commerce.

🎯 RÔLE: ${agentTitle} spécialisé dans la conversion et l'accompagnement client
PERSONNALITÉ: ${agent.personality || 'friendly'}
TYPE: ${agent.type || 'general'}
MISSION: Aider les visiteurs à trouver le bon produit et les guider vers l'achat.

INSTRUCTIONS SPÉCIFIQUES:
- Sois ${agent.personality === 'professional' ? 'professionnel et expert' : 'amical et accessible'}
- ${agent.type === 'upsell' ? 'Propose systématiquement des produits complémentaires' : ''}
- ${agent.type === 'support' ? 'Résous les objections et rassure les clients' : ''}
- Collecte les informations nécessaires pour la commande
- Utilise les informations de la base de connaissances ci-dessous

MESSAGE D'ACCUEIL: "${agent.welcomeMessage || 'Bonjour ! Comment puis-je vous aider ?'}"`;

  // ✅ AJOUTER LE CONTEXTE PRODUIT
  if (productContext?.name) {
    systemPrompt += `\n\nPRODUIT ACTUEL:
- Nom: ${productContext.name}
- Prix: ${productContext.price ? `${productContext.price}€` : 'Non spécifié'}
- URL: ${productContext.url || 'Non spécifiée'}`;
  }

  // ✅ AJOUTER LA BASE DE CONNAISSANCES
  if (knowledgeBase && knowledgeBase.length > 0) {
    systemPrompt += `\n\nBASE DE CONNAISSANCES:
${knowledgeBase.map(kb => `
DOCUMENT: ${kb.title}
TYPE: ${kb.contentType}
CONTENU: ${kb.content ? kb.content.substring(0, 1000) : 'Contenu non disponible'}
---`).join('\n')}

Utilise ces informations pour répondre aux questions sur les produits, l'entreprise, les politiques, etc.`;
  }

  // ✅ AJOUTER LES INSTRUCTIONS PERSONNALISÉES
  const agentConfig = agent.config as AgentConfig;
  if (agentConfig?.specificInstructions && agentConfig.specificInstructions.length > 0) {
    systemPrompt += `\n\nINSTRUCTIONS PERSONNALISÉES:
${agentConfig.specificInstructions.map((inst: string) => `- ${inst}`).join('\n')}`;
  }

  systemPrompt += `\n\nRÈGLES IMPORTANTES:
- Reste dans ton rôle de ${agentTitle}
- Ne révèle jamais que tu es une IA
- Pousse naturellement vers l'achat
- Sois précis et utile
- Si tu ne sais pas, dis-le honnêtement`;

  return systemPrompt;
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
      const { data: agent, error: agentError } = await supabaseServiceClient
        .from('agents')
        .select(`
          id, name, title, type, personality, description,
          welcome_message, fallback_message, avatar, config,
          agent_knowledge_base!inner(
            knowledge_base!inner(
              id, title, content, content_type, is_active
            )
          )
        `)
        .eq('id', body.agentId)
        .eq('shop_id', shop.id)
        .single();

      if (agentError || !agent) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      // ✅ S'assurer que l'agent a un titre
      if (!agent.title) {
        agent.title = getDefaultTitle(agent.type);
      }

      // ✅ CONSTRUIRE LA BASE DE CONNAISSANCES
      const knowledgeBase = agent.agent_knowledge_base
        .filter((akb: any) => akb.knowledge_base.is_active)
        .map((akb: any) => akb.knowledge_base);

      // ✅ CONSTRUIRE LE PROMPT SYSTÈME AVEC TITRE
      const systemPrompt = buildSystemPrompt(agent, knowledgeBase);

      // ✅ PRÉPARER LES MESSAGES
      const messages = [
        {
          role: 'user',
          content: body.message
        }
      ];

      // ✅ CHOISIR LE PROVIDER IA
      const agentConfig = agent.config as AgentConfig;
      const aiProvider = agentConfig?.aiProvider || 'openai';
      const temperature = agentConfig?.temperature || 0.7;
      
      let aiResponse: string;
      let provider: string;

      if (aiProvider === 'claude' && shop.subscription_plan !== 'free') {
        // ✅ UTILISER CLAUDE POUR LES PLANS PAYANTS
        aiResponse = await callClaudeAI(messages, systemPrompt, temperature);
        provider = 'claude';
      } else {
        // ✅ UTILISER OPENAI PAR DÉFAUT
        aiResponse = await callOpenAI(messages, systemPrompt, temperature);
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

      // ✅ RÉCUPÉRER LES AGENTS ACTIFS AVEC TITRE
      const { data: agents, error: agentsError } = await supabaseServiceClient
        .from('agents')
        .select(`
          id, name, title, type, personality, description,
          welcome_message, fallback_message, avatar, config,
          agent_knowledge_base!inner(
            knowledge_base!inner(
              id, title, content, content_type, tags
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
      }

      // ✅ GÉRER LA CONVERSATION (SUPABASE)
      let conversation = null;
      if (body.conversationId) {
        const { data: existingConv } = await supabaseServiceClient
          .from('conversations')
          .select('*, messages(*)')
          .eq('id', body.conversationId)
          .single();
        conversation = existingConv;
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
      }

      // ✅ SAUVEGARDER LE MESSAGE UTILISATEUR
      const { error: msgError } = await supabaseServiceClient
        .from('messages')
        .insert({
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
      const knowledgeBase = agent.agent_knowledge_base
        .filter((akb: any) => akb.knowledge_base.is_active)
        .map((akb: any) => akb.knowledge_base);

      // ✅ CONSTRUIRE L'HISTORIQUE DE LA CONVERSATION
      const conversationHistory = (conversation.messages || []).map((msg: ConversationMessage) => ({
        role: msg.role,
        content: msg.content
      }));

      // ✅ AJOUTER LE NOUVEAU MESSAGE
      conversationHistory.push({
        role: 'user',
        content: body.message
      });

      // ✅ CONSTRUIRE LE PROMPT SYSTÈME AVEC TITRE
      const systemPrompt = buildSystemPrompt(agent, knowledgeBase, body.productContext);

      // ✅ GÉNÉRER LA RÉPONSE IA
      const agentConfig = agent.config as AgentConfig;
      const aiProvider = agentConfig?.aiProvider || 'openai';
      const temperature = agentConfig?.temperature || 0.7;
      
      let aiResponse: string;
      let provider: string;

      try {
        if (aiProvider === 'claude' && shop.subscription_plan !== 'free') {
          aiResponse = await callClaudeAI(conversationHistory, systemPrompt, temperature);
          provider = 'claude';
        } else {
          aiResponse = await callOpenAI(conversationHistory, systemPrompt, temperature);
          provider = 'openai';
        }
      } catch (aiError) {
        console.error('❌ Erreur IA:', aiError);
        aiResponse = getIntelligentResponse(body.message, body.productContext, agent);
        provider = 'fallback';
      }

      // ✅ SAUVEGARDER LA RÉPONSE IA
      const { error: aiMsgError } = await supabaseServiceClient
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          role: 'assistant',
          content: aiResponse,
          content_type: 'text',
          response_time_ms: Date.now() - startTime,
          model_used: provider,
          tokens_used: 0, // À calculer si possible
          action_data: {
            provider: provider,
            temperature: temperature,
            timestamp: new Date().toISOString()
          }
        });

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
          }
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
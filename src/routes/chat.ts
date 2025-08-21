// src/routes/chat.ts - VERSION SUPABASE PURE
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
            primaryColor: "#3B82F6"
          },
          agent_config: {
            name: "Assistant ChatSeller",
            avatar: "https://ui-avatars.com/api/?name=Assistant&background=3B82F6&color=fff",
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
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY || '',
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

// ✅ HELPER: Appel OpenAI
async function callOpenAI(messages: any[], systemPrompt: string, temperature = 0.7) {
  try {
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

// ✅ HELPER: Construire le prompt système avec base de connaissances
function buildSystemPrompt(agent: any, knowledgeBase: any[] = [], productContext: any = null) {
  let systemPrompt = `Tu es ${agent.name}, un agent commercial IA spécialisé pour un site e-commerce.

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
- Reste dans ton rôle de conseiller commercial
- Ne révèle jamais que tu es une IA
- Pousse naturellement vers l'achat
- Sois précis et utile
- Si tu ne sais pas, dis-le honnêtement`;

  return systemPrompt;
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
          id, name, type, personality, description,
          welcomeMessage, fallbackMessage, avatar, config,
          agent_knowledge_base!inner(
            knowledge_base!inner(
              id, title, content, contentType, isActive
            )
          )
        `)
        .eq('id', body.agentId)
        .eq('shopId', shop.id)
        .single();

      if (agentError || !agent) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      // ✅ CONSTRUIRE LA BASE DE CONNAISSANCES
      const knowledgeBase = agent.agent_knowledge_base
        .filter((akb: any) => akb.knowledge_base.isActive)
        .map((akb: any) => akb.knowledge_base);

      // ✅ CONSTRUIRE LE PROMPT SYSTÈME
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

      // ✅ RÉCUPÉRER LES AGENTS ACTIFS
      const { data: agents, error: agentsError } = await supabaseServiceClient
        .from('agents')
        .select(`
          id, name, type, personality, description,
          welcomeMessage, fallbackMessage, avatar, config,
          agent_knowledge_base!inner(
            knowledge_base!inner(
              id, title, content, contentType, isActive
            )
          )
        `)
        .eq('shopId', shop.id)
        .eq('isActive', true);

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
            shopId: shop.id,
            agentId: agent.id,
            status: 'active',
            visitorIp: request.ip,
            visitorUserAgent: request.headers['user-agent'] || '',
            productId: body.productContext?.id || null,
            productName: body.productContext?.name || null,
            productUrl: body.productContext?.url || null,
            productPrice: body.productContext?.price || null,
            customerData: {
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
          conversationId: conversation.id,
          role: 'user',
          content: body.message,
          contentType: 'text'
        });

      if (msgError) {
        fastify.log.error('❌ Erreur sauvegarde message');
        console.error('Détails erreur message:', msgError);
      }

      // ✅ CONSTRUIRE LA BASE DE CONNAISSANCES
      const knowledgeBase = agent.agent_knowledge_base
        .filter((akb: any) => akb.knowledge_base.isActive)
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

      // ✅ CONSTRUIRE LE PROMPT SYSTÈME
      const systemPrompt = buildSystemPrompt(agent, knowledgeBase, body.productContext);

      // ✅ GÉNÉRER LA RÉPONSE IA
      const agentConfig = agent.config as AgentConfig;
      const aiProvider = agentConfig?.aiProvider || 'openai';
      const temperature = agentConfig?.temperature || 0.7;
      
      let aiResponse: string;
      let provider: string;

      if (aiProvider === 'claude' && shop.subscription_plan !== 'free') {
        aiResponse = await callClaudeAI(conversationHistory, systemPrompt, temperature);
        provider = 'claude';
      } else {
        aiResponse = await callOpenAI(conversationHistory, systemPrompt, temperature);
        provider = 'openai';
      }

      // ✅ SAUVEGARDER LA RÉPONSE IA
      const { error: aiMsgError } = await supabaseServiceClient
        .from('messages')
        .insert({
          conversationId: conversation.id,
          role: 'assistant',
          content: aiResponse,
          contentType: 'text',
          responseTimeMs: Date.now() - startTime,
          modelUsed: provider,
          tokensUsed: 0, // À calculer si possible
          actionData: {
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
      
      const body = z.object({
        message: z.string(),
        conversationId: z.string().optional(),
        productContext: z.any().optional()
      }).parse(request.body);

      // ✅ LOGIQUE D'ANALYSE D'INTENTION SIMPLE
      const orderKeywords = [
        'acheter', 'commander', 'achète', 'veux', 'prendre',
        'combien', 'prix', 'coûte', 'payer', 'panier',
        'livraison', 'délai', 'stock'
      ];

      const hasOrderIntent = orderKeywords.some(keyword => 
        body.message.toLowerCase().includes(keyword)
      );

      let action = null;
      if (hasOrderIntent) {
        if (body.message.toLowerCase().includes('acheter') || 
            body.message.toLowerCase().includes('commander')) {
          action = 'start_order';
        } else {
          action = 'show_product_info';
        }
      }

      return {
        success: true,
        data: {
          hasOrderIntent,
          confidence: hasOrderIntent ? 0.8 : 0.2,
          action,
          detectedKeywords: orderKeywords.filter(k => 
            body.message.toLowerCase().includes(k)
          )
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
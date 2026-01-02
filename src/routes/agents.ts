// src/routes/agents.ts 
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabaseServiceClient, supabaseAuthClient } from '../lib/supabase';

// ✅ NOUVEAUX TYPES BEAUTÉ HARMONISÉS
type BeautyAgentType = 'skincare_expert' | 'makeup_expert' | 'fragrance_expert' | 'haircare_expert' | 'bodycare_expert' | 'beauty_expert' | 'natural_expert' | 'multi_expert';
type ClassicAgentType = 'general' | 'product_specialist' | 'support' | 'upsell';
type AgentType = BeautyAgentType | ClassicAgentType;
type AgentPersonality = 'professional' | 'friendly' | 'expert' | 'casual' | 'luxury' | 'trendy';
type ProductRange = 'premium' | 'accessible' | 'organic' | 'vegan' | 'anti_aging' | 'sensitive' | 'custom';

// ✅ NOUVEAU SYSTÈME : Plus de limites fixes, agents illimités avec coût additionnel
const AGENT_COST_SYSTEM = {
  free: {
    includedAgents: 1, // Premier agent inclus dans essai gratuit
    additionalAgentCost: 0 // Pas de coût pendant l'essai
  },
  starter: {
    includedAgents: 1, // Premier agent inclus
    additionalAgentCost: 10 // 10€ par agent supplémentaire
  },
  growth: {
    includedAgents: 1, // Premier agent inclus
    additionalAgentCost: 10 // 10€ par agent supplémentaire
  },
  performance: {
    includedAgents: -1, // Agents illimités inclus
    additionalAgentCost: 0 // Pas de coût additionnel
  }
};

// ✅ SCHÉMAS ZOD BEAUTÉ MODERNISÉS
const createAgentSchema = z.object({
  name: z.string().min(1, 'Le nom est requis').max(255, 'Nom trop long'),
  title: z.string().optional().default(''),
  type: z.enum(['skincare_expert', 'makeup_expert', 'fragrance_expert', 'haircare_expert', 'bodycare_expert', 'beauty_expert', 'natural_expert', 'multi_expert', 'general', 'product_specialist', 'support', 'upsell']),
  personality: z.enum(['professional', 'friendly', 'expert', 'casual', 'luxury', 'trendy']),
  description: z.string().optional().nullable(),
  welcomeMessage: z.string().optional().nullable(),
  fallbackMessage: z.string().optional().nullable(),
  avatar: z.string().url().optional().nullable(),
  isActive: z.boolean().default(true),
  config: z.record(z.any()).optional(),
  // ✅ NOUVEAUX CHAMPS BEAUTÉ
  productType: z.string().optional().default('auto'),
  customProductType: z.string().optional().default(''),
  productRange: z.enum(['premium', 'accessible', 'organic', 'vegan', 'anti_aging', 'sensitive', 'custom']).optional().default('premium'),
  customProductRange: z.string().optional().default(''),
  shopName: z.string().optional(),
  shopId: z.string().uuid().optional()
});

const updateAgentSchema = createAgentSchema.partial();

const toggleAgentSchema = z.object({
  isActive: z.boolean()
});

// ✅ HELPER: Générer titre par défaut beauté
function getDefaultTitle(type: string, customTitle?: string): string {
  if (customTitle && customTitle.trim()) {
    return customTitle.trim();
  }
  
  const beautyTitles = {
    'skincare_expert': 'Esthéticienne spécialisée',
    'makeup_expert': 'Experte makeup et couleurs',
    'fragrance_expert': 'Conseillère parfums',
    'haircare_expert': 'Coiffeuse spécialisée',
    'bodycare_expert': 'Experte soins corps',
    'beauty_expert': 'Conseillère beauté',
    'natural_expert': 'Experte cosmétiques naturels',
    'multi_expert': 'Conseillère beauté multi-spécialités'
  };
  
  const classicTitles = {
    'general': 'Conseiller commercial',
    'product_specialist': 'Spécialiste produit',
    'support': 'Conseiller support',
    'upsell': 'Conseiller premium'
  };
  
  return beautyTitles[type as keyof typeof beautyTitles] || 
         classicTitles[type as keyof typeof classicTitles] || 
         'Assistant commercial';
}

// ✅ HELPER: Vérification auth Supabase
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

// ✅ HELPER: Récupérer ou créer shop avec Supabase
async function getOrCreateShop(user: any, fastify: FastifyInstance) {
  try {
    // Chercher par ID d'abord
    let { data: shop, error } = await supabaseServiceClient
      .from('shops')
      .select('*')
      .eq('id', user.id)
      .single();

    if (shop) {
      return shop;
    }

    // Chercher par email si pas trouvé par ID
    const { data: shopByEmail } = await supabaseServiceClient
      .from('shops')
      .select('*')
      .eq('email', user.email)
      .single();

    if (shopByEmail) {
      return shopByEmail;
    }

    // Créer nouveau shop avec configuration beauté par défaut
    const { data: newShop, error: createError } = await supabaseServiceClient
      .from('shops')
      .insert({
        id: user.id,
        name: user.user_metadata?.full_name || user.email.split('@')[0] || 'Ma Marque Beauté',
        email: user.email,
        subscription_plan: 'starter',
        is_active: true,
        // ✅ NOUVEAU : Champs beauté
        beauty_category: 'multi', // Par défaut multi-spécialités
        specialized_target: {
          target_age_range: 'all',
          price_range: 'accessible',
          communication_tone: 'friendly',
          expertise_level: 'intermediate',
          primary_goal: 'conversion'
        },
        // Configuration widget beauté par défaut
        widget_config: {
          theme: "beauty_modern",
          language: "fr", 
          position: "above-cta",
          buttonText: "Parler à votre conseillère beauté",
          primaryColor: "#E91E63",
          widgetSize: "medium",
          borderRadius: "lg",
          animation: "fade",
          autoOpen: false,
          showAvatar: true,
          soundEnabled: true,
          mobileOptimized: true,
          isActive: true
        },
        // Configuration agent beauté par défaut
        agent_config: {
          name: "Rose",
          title: "Conseillère beauté",
          avatar: "https://ui-avatars.com/api/?name=Rose&background=E91E63&color=fff",
          upsellEnabled: true,
          welcomeMessage: "Bonjour ! Je suis Rose, votre conseillère beauté. Comment puis-je vous aider à trouver le produit parfait ?",
          fallbackMessage: "Je transmets votre question à notre équipe beauté, une experte vous recontactera bientôt.",
          collectPaymentMethod: true,
          collectBeautyProfile: true,
          aiProvider: "openai",
          temperature: 0.7,
          maxTokens: 1000
        },
        // ✅ NOUVEAU : Quotas usage initialisés
        quotas_usage: {
          aiResponses: 0,
          knowledgeDocuments: 0,
          indexablePages: 0,
          agents: 0
        }
      })
      .select()
      .single();

    if (createError) {
      throw createError;
    }

    return newShop;

  } catch (error) {
    console.error('Erreur getOrCreateShop:', error);
    throw error;
  }
}

// ✅ NOUVELLE FONCTION: Vérifier si utilisateur peut créer des agents
async function canCreateAgent(shopId: string, plan: string): Promise<{ 
  allowed: boolean, 
  reason?: string,
  currentCount?: number,
  additionalCost?: number 
}> {
  try {
    // Compter les agents actuels
    const { count: currentAgentsCount, error } = await supabaseServiceClient
      .from('agents')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shopId);

    if (error) {
      throw error;
    }

    const agentCount = currentAgentsCount || 0;
    const costSystem = AGENT_COST_SYSTEM[plan as keyof typeof AGENT_COST_SYSTEM];
    
    if (!costSystem) {
      return { 
        allowed: false, 
        reason: 'Plan non reconnu',
        currentCount: agentCount
      };
    }

    // Plan Performance : agents illimités inclus
    if (costSystem.includedAgents === -1) {
      return { 
        allowed: true, 
        currentCount: agentCount,
        additionalCost: 0
      };
    }

    // Autres plans : premier agent inclus, suivants payants
    const additionalCost = Math.max(0, agentCount) * costSystem.additionalAgentCost;
    
    return { 
      allowed: true, 
      currentCount: agentCount,
      additionalCost: costSystem.additionalAgentCost
    };

  } catch (error) {
    console.error('Erreur vérification création agent:', error);
    return { 
      allowed: false, 
      reason: 'Erreur vérification permissions'
    };
  }
}

// ✅ NOUVELLE FONCTION: Calculer coût total des agents
function calculateAgentsCost(agentCount: number, plan: string): number {
  const costSystem = AGENT_COST_SYSTEM[plan as keyof typeof AGENT_COST_SYSTEM];
  
  if (!costSystem || costSystem.includedAgents === -1) {
    return 0; // Plan Performance ou erreur
  }
  
  // Premier agent inclus, puis coût additionnel pour les suivants
  return Math.max(0, agentCount - costSystem.includedAgents) * costSystem.additionalAgentCost;
}

interface AgentParamsType {
  id: string;
}

interface AgentConfigBody {
  config: any;
}

interface AgentKnowledgeBody {
  knowledgeBaseIds: string[];
}

export default async function agentsRoutes(fastify: FastifyInstance) {
  
  // ✅ ROUTE: LISTE DES AGENTS (NOUVEAU SYSTÈME COÛT)
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      fastify.log.info('🔍 Récupération des agents avec nouveau système de coût');
      
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);

      if (!shop) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Shop non trouvé' 
        });
      }

      // Récupérer agents avec mapping complet beauté
      // ✅ CORRECTION: Utiliser LEFT JOIN (sans !inner) pour récupérer tous les agents
      const { data: agents, error: agentsError } = await supabaseServiceClient
        .from('agents')
        .select(`
          id, name, title, type, personality, description,
          welcome_message, fallback_message, avatar, is_active, config,
          product_range, custom_product_range,
          created_at, updated_at,
          agent_knowledge_base(
            knowledge_base(
              id, title, content_type, is_active
            )
          )
        `)
        .eq('shop_id', shop.id)
        .order('updated_at', { ascending: false });

      if (agentsError) {
        throw agentsError;
      }

      // Calculer statistiques pour chaque agent
      const agentsWithStats = await Promise.all(
        (agents || []).map(async (agent) => {
          // Conversations count
          const { count: conversations } = await supabaseServiceClient
            .from('conversations')
            .select('*', { count: 'exact', head: true })
            .eq('agent_id', agent.id);
          
          // Conversions count
          const { count: conversions } = await supabaseServiceClient
            .from('conversations')
            .select('*', { count: 'exact', head: true })
            .eq('agent_id', agent.id)
            .eq('conversion_completed', true);

          return {
            id: agent.id,
            name: agent.name,
            title: agent.title || getDefaultTitle(agent.type),
            type: agent.type, // L'ENUM supporte directement les types beauté
            personality: agent.personality,
            description: agent.description,
            // ✅ CORRECTION : Mapping camelCase cohérent
            welcomeMessage: agent.welcome_message,
            fallbackMessage: agent.fallback_message,
            avatar: agent.avatar,
            isActive: agent.is_active,
            config: agent.config,
            // ✅ NOUVEAUX CHAMPS BEAUTÉ MAPPÉS
            productRange: agent.product_range || agent.config?.productRange || 'premium',
            customProductRange: agent.custom_product_range || agent.config?.customProductRange || '',
            shopName: agent.config?.shopName || agent.name || '', 
            stats: {
              conversations: conversations || 0,
              conversions: conversions || 0
            },
            knowledgeBase: agent.agent_knowledge_base?.map((akb: any) => akb.knowledge_base) || [],
            createdAt: agent.created_at,
            updatedAt: agent.updated_at
          };
        })
      );

      // ✅ NOUVEAU : Calculer coût total des agents
      const totalAgentsCost = calculateAgentsCost(agents?.length || 0, shop.subscription_plan);

      return {
        success: true,
        data: agentsWithStats,
        meta: {
          total: agents?.length || 0,
          costSystem: AGENT_COST_SYSTEM[shop.subscription_plan as keyof typeof AGENT_COST_SYSTEM],
          totalMonthlyCost: totalAgentsCost,
          plan: shop.subscription_plan
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Get agents error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({ 
        success: false,
        error: 'Erreur lors de la récupération des agents',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE: CRÉER UN AGENT (NOUVEAU SYSTÈME COÛT)
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      fastify.log.info('🏗️ Création d\'un nouvel agent avec nouveau système de coût');
      
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);
      
      if (!shop) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Shop non trouvé' 
        });
      }

      console.log('📥 [agents.ts] Body reçu:', JSON.stringify(request.body, null, 2));
      
      // Validation ZOD
      let body;
      try {
        body = createAgentSchema.parse(request.body);
        console.log('✅ [agents.ts] Body validé:', JSON.stringify(body, null, 2));
      } catch (zodError: any) {
        console.error('❌ [agents.ts] Erreur validation Zod:', zodError.errors);
        return reply.status(400).send({
          success: false,
          error: 'Données invalides',
          details: zodError.errors,
          received: request.body
        });
      }

      // ✅ NOUVEAU : Vérifier permissions avec nouveau système
      const canCreate = await canCreateAgent(shop.id, shop.subscription_plan || 'starter');
      
      if (!canCreate.allowed) {
        return reply.status(403).send({ 
          success: false,
          error: canCreate.reason || 'Impossible de créer un agent',
          currentCount: canCreate.currentCount
        });
      }

      // ✅ Générer titre automatique beauté
      const finalTitle = getDefaultTitle(body.type, body.title);

      console.log(`🔍 [agents.ts] Type demandé: ${body.type}, Personnalité: ${body.personality}`);

      // ✅ Générer un UUID pour l'agent (la table n'a pas de DEFAULT sur la colonne id)
      const { randomUUID } = await import('crypto');
      const agentId = randomUUID();

      // ✅ Créer agent - L'ENUM agent_type supporte tous les types beauté
      const agentData: Record<string, any> = {
        id: agentId, // ✅ IMPORTANT: Générer l'UUID côté serveur
        shop_id: shop.id,
        name: body.name,
        title: finalTitle,
        type: body.type, // L'ENUM agent_type supporte les types beauté
        personality: body.personality as AgentPersonality,
        description: body.description || null,
        welcome_message: body.welcomeMessage || "Bonjour ! Je suis votre conseillère beauté. Comment puis-je vous aider ?",
        fallback_message: body.fallbackMessage || "Je transmets votre question à notre équipe beauté, un expert vous recontactera bientôt.",
        avatar: body.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(body.name)}&background=E91E63&color=fff`,
        is_active: body.isActive !== undefined ? body.isActive : true,
        product_range: body.productRange || 'premium',
        custom_product_range: body.customProductRange || '',
        config: {
          ...body.config,
          // ✅ Stocker aussi dans config pour référence facile
          beautyType: body.type,
          productRange: body.productRange || 'premium',
          customProductRange: body.customProductRange || '',
          shopName: body.shopName || '',
          productType: body.productType || 'multi',
          collectBeautyProfile: true,
          upsellEnabled: true,
          aiProvider: 'openai',
          temperature: 0.7,
          maxTokens: 1000
        }
      };

      console.log('💾 [agents.ts] Données agent beauté à créer:', JSON.stringify(agentData, null, 2));

      // ✅ Insertion de l'agent dans la base de données
      const { data: newAgent, error: createError } = await supabaseServiceClient
        .from('agents')
        .insert(agentData)
        .select()
        .single();

      if (createError) {
        console.error('❌ [agents.ts] Erreur création agent:', createError);

        // Message d'erreur détaillé pour le debugging
        const errorDetails = {
          message: createError.message,
          code: createError.code,
          details: createError.details,
          hint: createError.hint,
          agentData: agentData
        };
        console.error('❌ [agents.ts] Détails erreur:', JSON.stringify(errorDetails, null, 2));

        throw new Error(createError.message || 'Erreur lors de la création de l\'agent');
      }

      if (!newAgent) {
        throw new Error('Agent créé mais données non retournées');
      }

      console.log('✅ [agents.ts] Agent créé avec succès:', newAgent.id);

      // ✅ NOUVEAU : Mettre à jour usage quotas agents
      const { count: currentAgentCount } = await supabaseServiceClient
        .from('agents')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', shop.id);

      await supabaseServiceClient
        .from('shops')
        .update({
          quotas_usage: {
            ...shop.quotas_usage,
            agents: currentAgentCount || 0
          }
        })
        .eq('id', shop.id);

      fastify.log.info(`✅ Agent beauté créé avec succès: ${newAgent.id} - Coût additionnel: ${canCreate.additionalCost || 0}€/mois`);

      return {
        success: true,
        data: {
          id: newAgent.id,
          name: newAgent.name,
          title: finalTitle,
          // ✅ Renvoyer le type original (beauté) depuis config, pas le type DB
          type: newAgent.type, // L'ENUM supporte directement les types beauté
          personality: newAgent.personality,
          description: newAgent.description,
          welcomeMessage: newAgent.welcome_message,
          fallbackMessage: newAgent.fallback_message,
          avatar: newAgent.avatar,
          isActive: newAgent.is_active,
          config: newAgent.config,
          // ✅ Récupérer productRange depuis la colonne OU depuis config (fallback)
          productRange: newAgent.product_range || newAgent.config?.productRange || 'premium',
          customProductRange: newAgent.custom_product_range || newAgent.config?.customProductRange || '',
          stats: { conversations: 0, conversions: 0 },
          knowledgeBase: [],
          createdAt: newAgent.created_at,
          updatedAt: newAgent.updated_at
        },
        meta: {
          additionalCost: canCreate.additionalCost || 0,
          totalMonthlyCost: calculateAgentsCost(currentAgentCount || 0, shop.subscription_plan)
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Create agent error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }

      if (error.code === '23505') { // Unique constraint violation
        return reply.status(409).send({
          success: false,
          error: 'Un agent avec ce nom existe déjà pour votre boutique'
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la création de l\'agent',
        details: process.env.NODE_ENV === 'development' ? {
          message: error.message,
          code: error.code
        } : undefined
      });
    }
  });

  // ✅ ROUTE: GET CONFIG AGENT (BEAUTÉ AMÉLIORÉ)
  fastify.get<{ Params: AgentParamsType }>('/:id/config', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);

      if (!shop) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Shop non trouvé' 
        });
      }

      // Récupérer agent avec tous les champs beauté
      // ✅ CORRECTION: Utiliser LEFT JOIN (sans !inner) pour récupérer l'agent même sans documents
      const { data: agent, error: agentError } = await supabaseServiceClient
        .from('agents')
        .select(`
          id, name, title, type, personality, description,
          welcome_message, fallback_message, avatar, is_active, config,
          product_range, custom_product_range,
          agent_knowledge_base(
            knowledge_base(
              id, title, content_type, is_active, tags
            )
          )
        `)
        .eq('id', id)
        .eq('shop_id', shop.id)
        .single();

      if (agentError || !agent) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      // Calculer statistiques
      let conversations = 0;
      let conversions = 0;

      try {
        const { count: convCount } = await supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('agent_id', agent.id);
        
        const { count: conversionCount } = await supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('agent_id', agent.id)
          .eq('conversion_completed', true);

        conversations = convCount || 0;
        conversions = conversionCount || 0;
      } catch (statsError) {
        console.warn('⚠️ Erreur calcul statistiques:', statsError);
      }

      const response = {
        success: true,
        data: {
          agent: {
            id: agent.id,
            name: agent.name,
            title: agent.title || getDefaultTitle(agent.type),
            type: agent.type, // L'ENUM supporte directement les types beauté
            personality: agent.personality,
            description: agent.description,
            welcomeMessage: agent.welcome_message,
            fallbackMessage: agent.fallback_message,
            avatar: agent.avatar,
            isActive: agent.is_active,
            productRange: agent.product_range || agent.config?.productRange || 'premium',
            customProductRange: agent.custom_product_range || agent.config?.customProductRange || '',
            // ✅ UTILISER shop.name au lieu d'un champ redondant
            shopName: shop.name, // Récupéré depuis la table shops
            config: {
              ...(agent.config || {}),
              linkedKnowledgeBase: agent.agent_knowledge_base?.map((akb: any) => akb.knowledge_base.id) || [],
              collectBeautyProfile: agent.config?.collectBeautyProfile ?? true,
              aiProvider: agent.config?.aiProvider || 'openai',
              temperature: agent.config?.temperature || 0.7,
              maxTokens: agent.config?.maxTokens || 1000,
              systemPrompt: agent.config?.systemPrompt || '',
              tone: agent.config?.tone || 'friendly'
            },
            totalConversations: conversations,
            totalConversions: conversions,
            stats: {
              conversations,
              conversions
            }
          },
          knowledgeBase: agent.agent_knowledge_base?.map((akb: any) => akb.knowledge_base) || []
        }
      };

      fastify.log.info(`✅ Configuration agent beauté récupérée: ${id}`);
      return response;

    } catch (error: any) {
      fastify.log.error('❌ Get agent config error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération de la configuration',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE: UPDATE AGENT (BEAUTÉ AMÉLIORÉ)
  fastify.put<{ Params: AgentParamsType }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);
      
      // Validation
      let body;
      try {
        body = updateAgentSchema.parse(request.body);
      } catch (zodError: any) {
        console.error('❌ [agents.ts] Erreur validation update:', zodError.errors);
        return reply.status(400).send({
          success: false,
          error: 'Données invalides pour la mise à jour',
          details: zodError.errors
        });
      }

      if (!shop) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Shop non trouvé' 
        });
      }

      // Vérifier existence agent
      const { data: existingAgent, error: findError } = await supabaseServiceClient
        .from('agents')
        .select('*')
        .eq('id', id)
        .eq('shop_id', shop.id)
        .single();

      if (findError || !existingAgent) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      // Construire données update avec tous les champs beauté
      const updateData: any = {
        ...(body.name && { name: body.name }),
        ...(body.type && { type: body.type }),
        ...(body.personality && { personality: body.personality }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.welcomeMessage !== undefined && { welcome_message: body.welcomeMessage }),
        ...(body.fallbackMessage !== undefined && { fallback_message: body.fallbackMessage }),
        ...(body.avatar !== undefined && { avatar: body.avatar }),
        ...(body.isActive !== undefined && { is_active: body.isActive }),
        ...(body.config !== undefined && { config: body.config }),
        // ✅ NOUVEAUX CHAMPS BEAUTÉ
        ...(body.productRange !== undefined && { product_range: body.productRange }),
        ...(body.customProductRange !== undefined && { custom_product_range: body.customProductRange }),
        updated_at: new Date().toISOString()
      }

      // Gestion du titre
      if (body.title !== undefined) {
        const finalTitle = getDefaultTitle(body.type || existingAgent.type, body.title);
        updateData.title = finalTitle;
      }

      // Update avec Supabase
      const { data: updatedAgent, error: updateError } = await supabaseServiceClient
        .from('agents')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      // ✅ CORRECTION: Gestion d'erreur TypeScript
      if (updateError) {
        console.error('❌ Erreur mise à jour agent:', updateError);
        throw new Error(updateError.message || 'Erreur lors de la mise à jour de l\'agent');
      }

      fastify.log.info(`✅ Agent beauté modifié avec succès: ${updatedAgent.id}`);

      return {
        success: true,
        data: {
          id: updatedAgent.id,
          name: updatedAgent.name,
          title: updatedAgent.title || getDefaultTitle(updatedAgent.type),
          type: updatedAgent.type,
          personality: updatedAgent.personality,
          description: updatedAgent.description,
          welcomeMessage: updatedAgent.welcome_message,
          fallbackMessage: updatedAgent.fallback_message,
          avatar: updatedAgent.avatar,
          isActive: updatedAgent.is_active,
          config: updatedAgent.config,
          productRange: updatedAgent.product_range,
          customProductRange: updatedAgent.custom_product_range,
          createdAt: updatedAgent.created_at,
          updatedAt: updatedAgent.updated_at
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Update agent error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la modification de l\'agent',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE: DELETE AGENT (AVEC RECALCUL COÛT)
  fastify.delete<{ Params: AgentParamsType }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);

      if (!shop) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Shop non trouvé' 
        });
      }

      // Vérifier agent existe
      const { data: existingAgent, error: findError } = await supabaseServiceClient
        .from('agents')
        .select('id')
        .eq('id', id)
        .eq('shop_id', shop.id)
        .single();

      if (findError || !existingAgent) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      // Calculer économie après suppression
      const { count: currentCount } = await supabaseServiceClient
        .from('agents')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', shop.id);

      const currentCost = calculateAgentsCost(currentCount || 0, shop.subscription_plan);
      const newCost = calculateAgentsCost((currentCount || 1) - 1, shop.subscription_plan);
      const savings = currentCost - newCost;

      // Supprimer agent
      const { error: deleteError } = await supabaseServiceClient
        .from('agents')
        .delete()
        .eq('id', id);

      // ✅ CORRECTION: Gestion d'erreur TypeScript
      if (deleteError) {
        console.error('❌ Erreur suppression agent:', deleteError);
        throw new Error(deleteError.message || 'Erreur lors de la suppression de l\'agent');
      }

      // Mettre à jour quotas
      const newAgentCount = (currentCount || 1) - 1;
      await supabaseServiceClient
        .from('shops')
        .update({
          quotas_usage: {
            ...shop.quotas_usage,
            agents: Math.max(0, newAgentCount)
          }
        })
        .eq('id', shop.id);

      fastify.log.info(`✅ Agent supprimé avec succès: ${id} - Économie: ${savings}€/mois`);

      return { 
        success: true, 
        message: 'Agent supprimé avec succès',
        meta: {
          savings: savings,
          newMonthlyCost: newCost,
          newAgentCount: Math.max(0, newAgentCount)
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Delete agent error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la suppression de l\'agent',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE: TOGGLE AGENT STATUS
  fastify.patch<{ Params: AgentParamsType }>('/:id/toggle', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);
      const body = toggleAgentSchema.parse(request.body);

      if (!shop) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Shop non trouvé' 
        });
      }

      // Vérifier agent existe
      const { data: existingAgent, error: findError } = await supabaseServiceClient
        .from('agents')
        .select('id')
        .eq('id', id)
        .eq('shop_id', shop.id)
        .single();

      if (findError || !existingAgent) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      // Update status
      const { data: updatedAgent, error: updateError } = await supabaseServiceClient
        .from('agents')
        .update({ 
          is_active: body.isActive,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select('id, is_active, updated_at')
        .single();

      // ✅ CORRECTION: Gestion d'erreur TypeScript
      if (updateError) {
        console.error('❌ Erreur toggle agent:', updateError);
        throw new Error(updateError.message || 'Erreur lors de la modification du statut');
      }

      fastify.log.info(`✅ Statut agent modifié: ${id} -> ${body.isActive ? 'actif' : 'inactif'}`);

      return {
        success: true,
        data: {
          id: updatedAgent.id,
          isActive: updatedAgent.is_active,
          updatedAt: updatedAgent.updated_at
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Toggle agent error:', error);
      
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          success: false,
          error: 'Données invalides',
          details: error.errors
        });
      }
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la modification du statut',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE: DUPLICATE AGENT (AVEC NOUVEAU COÛT)
  fastify.post<{ Params: AgentParamsType }>('/:id/duplicate', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);

      if (!shop) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Shop non trouvé' 
        });
      }

      // Vérifier permissions duplication
      const canCreate = await canCreateAgent(shop.id, shop.subscription_plan || 'starter');
      
      if (!canCreate.allowed) {
        return reply.status(403).send({ 
          success: false,
          error: canCreate.reason || 'Impossible de dupliquer l\'agent',
          currentCount: canCreate.currentCount
        });
      }

      // Récupérer agent original avec knowledge base
      const { data: originalAgent, error: findError } = await supabaseServiceClient
        .from('agents')
        .select(`
          *, 
          agent_knowledge_base(knowledge_base_id, is_active, priority)
        `)
        .eq('id', id)
        .eq('shop_id', shop.id)
        .single();

      if (findError || !originalAgent) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      // Créer agent dupliqué
      const { data: duplicatedAgent, error: createError } = await supabaseServiceClient
        .from('agents')
        .insert({
          shop_id: shop.id,
          name: `${originalAgent.name} (Copie)`,
          title: originalAgent.title || getDefaultTitle(originalAgent.type),
          type: originalAgent.type,
          personality: originalAgent.personality,
          description: originalAgent.description,
          welcome_message: originalAgent.welcome_message,
          fallback_message: originalAgent.fallback_message,
          avatar: originalAgent.avatar,
          is_active: false, // Désactivé par défaut
          config: originalAgent.config || {},
          // ✅ NOUVEAUX CHAMPS BEAUTÉ
          product_range: originalAgent.product_range || 'premium',
          custom_product_range: originalAgent.custom_product_range || ''
        })
        .select()
        .single();

      // ✅ CORRECTION: Gestion d'erreur TypeScript
      if (createError) {
        console.error('❌ Erreur duplication agent:', createError);
        throw new Error(createError.message || 'Erreur lors de la duplication de l\'agent');
      }

      // Dupliquer knowledge base links
      if (originalAgent.agent_knowledge_base && originalAgent.agent_knowledge_base.length > 0) {
        const linksData = originalAgent.agent_knowledge_base.map((kb: any) => ({
          agent_id: duplicatedAgent.id,
          knowledge_base_id: kb.knowledge_base_id,
          is_active: kb.is_active,
          priority: kb.priority
        }));

        const { error: linkError } = await supabaseServiceClient
          .from('agent_knowledge_base')
          .insert(linksData);

        // ✅ CORRECTION: Gestion d'erreur TypeScript optionnelle
        if (linkError) {
          console.warn('Erreur duplication knowledge base links:', linkError.message);
        }
      }

      // Mettre à jour quotas
      const { count: newAgentCount } = await supabaseServiceClient
        .from('agents')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', shop.id);

      await supabaseServiceClient
        .from('shops')
        .update({
          quotas_usage: {
            ...shop.quotas_usage,
            agents: newAgentCount || 0
          }
        })
        .eq('id', shop.id);

      const newMonthlyCost = calculateAgentsCost(newAgentCount || 0, shop.subscription_plan);

      fastify.log.info(`✅ Agent dupliqué avec succès: ${duplicatedAgent.id} - Nouveau coût: ${newMonthlyCost}€/mois`);

      return {
        success: true,
        data: {
          id: duplicatedAgent.id,
          name: duplicatedAgent.name,
          title: duplicatedAgent.title || getDefaultTitle(duplicatedAgent.type),
          type: duplicatedAgent.type,
          personality: duplicatedAgent.personality,
          description: duplicatedAgent.description,
          welcomeMessage: duplicatedAgent.welcome_message,
          fallbackMessage: duplicatedAgent.fallback_message,
          avatar: duplicatedAgent.avatar,
          isActive: duplicatedAgent.is_active,
          config: duplicatedAgent.config,
          productRange: duplicatedAgent.product_range,
          customProductRange: duplicatedAgent.custom_product_range,
          stats: { conversations: 0, conversions: 0 },
          createdAt: duplicatedAgent.created_at,
          updatedAt: duplicatedAgent.updated_at
        },
        meta: {
          additionalCost: canCreate.additionalCost || 0,
          newMonthlyCost: newMonthlyCost,
          newAgentCount: newAgentCount || 0
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Duplicate agent error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la duplication de l\'agent',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE: GET AGENT KNOWLEDGE
  fastify.get<{ Params: AgentParamsType }>('/:id/knowledge', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);

      if (!shop) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Shop non trouvé' 
        });
      }

      // Récupérer agent avec knowledge base
      const { data: agent, error: agentError } = await supabaseServiceClient
        .from('agents')
        .select(`
          id,
          agent_knowledge_base!inner(
            priority, created_at,
            knowledge_base!inner(
              id, title, content_type, is_active, tags, content, created_at, updated_at
            )
          )
        `)
        .eq('id', id)
        .eq('shop_id', shop.id)
        .single();

      if (agentError || !agent) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      const knowledgeBaseDocuments = agent.agent_knowledge_base?.map((akb: any) => ({
        id: akb.knowledge_base.id,
        title: akb.knowledge_base.title,
        contentType: akb.knowledge_base.content_type,
        isActive: akb.knowledge_base.is_active,
        tags: akb.knowledge_base.tags || [],
        content: akb.knowledge_base.content,
        createdAt: akb.knowledge_base.created_at,
        updatedAt: akb.knowledge_base.updated_at,
        priority: akb.priority,
        linkedAt: akb.created_at
      })) || [];

      fastify.log.info(`✅ Base de connaissance récupérée pour agent: ${id} (${knowledgeBaseDocuments.length} documents)`);

      return {
        success: true,
        data: knowledgeBaseDocuments
      };

    } catch (error: any) {
      fastify.log.error('❌ Get agent knowledge error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération de la base de connaissance',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE: PUT KNOWLEDGE BASE
  fastify.put<{ Params: AgentParamsType }>('/:id/knowledge-base', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);
      const { documentIds } = request.body as { documentIds: string[] };

      if (!shop) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Shop non trouvé' 
        });
      }

      // Vérifier agent existe
      const { data: existingAgent, error: findError } = await supabaseServiceClient
        .from('agents')
        .select('id')
        .eq('id', id)
        .eq('shop_id', shop.id)
        .single();

      if (findError || !existingAgent) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      // Supprimer anciennes liaisons
      const { error: deleteError } = await supabaseServiceClient
        .from('agent_knowledge_base')
        .delete()
        .eq('agent_id', id);

      // ✅ CORRECTION: Gestion d'erreur TypeScript optionnelle
      if (deleteError) {
        console.warn('Erreur suppression anciennes liaisons:', deleteError.message);
      }

      // Créer nouvelles liaisons
      if (documentIds && documentIds.length > 0) {
        const linksData = documentIds.map((kbId, index) => ({
          agent_id: id,
          knowledge_base_id: kbId,
          is_active: true,
          priority: index
        }));

        const { error: insertError } = await supabaseServiceClient
          .from('agent_knowledge_base')
          .insert(linksData);

        // ✅ CORRECTION: Gestion d'erreur TypeScript
        if (insertError) {
          console.error('❌ Erreur insertion liaisons KB:', insertError);
          throw new Error(insertError.message || 'Erreur lors de la liaison de la base de connaissance');
        }
      }

      // Récupérer documents liés
      const { data: linkedDocuments, error: linkedError } = await supabaseServiceClient
        .from('agent_knowledge_base')
        .select(`
          knowledge_base(id, title, content_type, is_active, tags)
        `)
        .eq('agent_id', id);

      const documents = linkedDocuments?.map((link: any) => link.knowledge_base) || [];

      fastify.log.info(`✅ Base de connaissance liée à l'agent: ${id}`);

      return {
        success: true,
        message: 'Base de connaissance mise à jour avec succès',
        data: {
          documents
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Link agent knowledge error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la liaison de la base de connaissance',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });
}
// src/routes/agents.ts - VERSION SUPABASE CORRIGÉE ✅
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabaseServiceClient, supabaseAuthClient } from '../lib/supabase';

// ✅ TYPES SUPABASE (remplacer les types Prisma)
type AgentType = 'general' | 'product_specialist' | 'support' | 'upsell';
type AgentPersonality = 'professional' | 'friendly' | 'expert' | 'casual';

const PLAN_LIMITS = {
  free: { agents: 1 },
  starter: { agents: 1 },
  professional: { agents: 3 },
  pro: { agents: 3 },
  enterprise: { agents: -1 }
};

// ✅ SCHÉMAS ZOD (sans Prisma)
const createAgentSchema = z.object({
  name: z.string().min(1, 'Le nom est requis').max(255, 'Nom trop long'),
  title: z.string().optional().default(''),
  type: z.enum(['general', 'product_specialist', 'support', 'upsell']),
  personality: z.enum(['professional', 'friendly', 'expert', 'casual']),
  description: z.string().optional().nullable(),
  welcomeMessage: z.string().optional().nullable(),
  fallbackMessage: z.string().optional().nullable(),
  avatar: z.string().url().optional().nullable(),
  isActive: z.boolean().default(true),
  config: z.record(z.any()).optional(),
  shopId: z.string().uuid().optional()
});

const updateAgentSchema = createAgentSchema.partial();

const toggleAgentSchema = z.object({
  isActive: z.boolean()
});

// ✅ HELPER: Générer titre par défaut
function getDefaultTitle(type: string, customTitle?: string): string {
  if (customTitle && customTitle.trim()) {
    return customTitle.trim()
  }
  
  const defaultTitles = {
    'general': 'Conseiller commercial',
    'product_specialist': 'Spécialiste produit',
    'support': 'Conseiller support',
    'upsell': 'Conseiller premium'
  }
  return defaultTitles[type as keyof typeof defaultTitles] || 'Assistant commercial'
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

    // Créer nouveau shop
    const { data: newShop, error: createError } = await supabaseServiceClient
      .from('shops')
      .insert({
        id: user.id,
        name: user.user_metadata?.full_name || user.email.split('@')[0] || 'Boutique',
        email: user.email,
        subscription_plan: 'starter',
        is_active: true,
        widget_config: {
          theme: "modern",
          language: "fr", 
          position: "above-cta",
          buttonText: "Parler à un conseiller",
          primaryColor: "#3B82F6",
          widgetSize: "medium",
          borderRadius: "md",
          animation: "fade",
          autoOpen: false,
          showAvatar: true,
          soundEnabled: true,
          mobileOptimized: true,
          isActive: true
        },
        agent_config: {
          name: "Assistant ChatSeller",
          title: "Assistant commercial",
          avatar: "https://ui-avatars.com/api/?name=Assistant&background=3B82F6&color=fff",
          upsellEnabled: false,
          welcomeMessage: "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
          fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
          collectPaymentMethod: true,
          aiProvider: "openai",
          temperature: 0.7,
          maxTokens: 1000
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

// ✅ HELPER: Vérifier limites plan
async function checkPlanLimits(shopId: string, currentCount: number, plan: string) {
  const limit = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS]?.agents;
  
  if (limit === -1) return true;
  if (limit === undefined) return false;
  
  return currentCount < limit;
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
  
  // ✅ ROUTE: LISTE DES AGENTS (SUPABASE) - CORRIGÉE
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      fastify.log.info('🔍 Récupération des agents');
      
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);

      if (!shop) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Shop non trouvé' 
        });
      }

      // ✅ RÉCUPÉRER AGENTS AVEC SUPABASE - COLONNES CORRIGÉES
      const { data: agents, error: agentsError } = await supabaseServiceClient
        .from('agents')
        .select(`
          id, name, title, type, personality, description,
          welcome_message, fallback_message, avatar, is_active, config,
          created_at, updated_at,
          agent_knowledge_base!inner(
            knowledge_base!inner(
              id, title, content_type, is_active
            )
          )
        `)
        .eq('shop_id', shop.id)  // ✅ CORRIGÉ : shop_id
        .order('updated_at', { ascending: false });  // ✅ CORRIGÉ : updated_at

      if (agentsError) {
        throw agentsError;
      }

      // ✅ CALCULER STATISTIQUES POUR CHAQUE AGENT - COLONNES CORRIGÉES
      const agentsWithStats = await Promise.all(
        (agents || []).map(async (agent) => {
          // Conversations count
          const { count: conversations } = await supabaseServiceClient
            .from('conversations')
            .select('*', { count: 'exact', head: true })
            .eq('agent_id', agent.id);  // ✅ CORRIGÉ : agent_id
          
          // Conversions count
          const { count: conversions } = await supabaseServiceClient
            .from('conversations')
            .select('*', { count: 'exact', head: true })
            .eq('agent_id', agent.id)  // ✅ CORRIGÉ : agent_id
            .eq('conversion_completed', true);  // ✅ CORRIGÉ : conversion_completed

          return {
            id: agent.id,
            name: agent.name,
            title: agent.title || getDefaultTitle(agent.type),
            type: agent.type,
            personality: agent.personality,
            description: agent.description,
            welcomeMessage: agent.welcome_message,  // ✅ Mappage snake_case → camelCase
            fallbackMessage: agent.fallback_message,  // ✅ Mappage snake_case → camelCase
            avatar: agent.avatar,
            isActive: agent.is_active,  // ✅ Mappage snake_case → camelCase
            config: agent.config,
            stats: {
              conversations: conversations || 0,
              conversions: conversions || 0
            },
            knowledgeBase: agent.agent_knowledge_base?.map((akb: any) => akb.knowledge_base) || [],
            createdAt: agent.created_at,  // ✅ Mappage snake_case → camelCase
            updatedAt: agent.updated_at   // ✅ Mappage snake_case → camelCase
          };
        })
      );

      return {
        success: true,
        data: agentsWithStats,
        meta: {
          total: agents?.length || 0,
          planLimit: PLAN_LIMITS[shop.subscription_plan as keyof typeof PLAN_LIMITS]?.agents || 1
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

  // ✅ ROUTE: CRÉER UN AGENT (SUPABASE) - CORRIGÉE
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      fastify.log.info('🏗️ Création d\'un nouvel agent');
      
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);
      
      if (!shop) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Shop non trouvé' 
        });
      }

      console.log('📥 [agents.ts] Body reçu:', JSON.stringify(request.body, null, 2));
      
      // ✅ VALIDATION ZOD
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

      // ✅ VÉRIFIER LIMITES PLAN AVEC SUPABASE - CORRIGÉ
      const { count: currentAgentsCount } = await supabaseServiceClient
        .from('agents')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', shop.id);  // ✅ CORRIGÉ : shop_id

      const canCreate = await checkPlanLimits(shop.id, currentAgentsCount || 0, shop.subscription_plan || 'starter');
      
      if (!canCreate) {
        const limit = PLAN_LIMITS[shop.subscription_plan as keyof typeof PLAN_LIMITS]?.agents || 1;
        return reply.status(403).send({ 
          success: false,
          error: `Plan ${shop.subscription_plan} limité à ${limit} agent(s). Passez au plan supérieur pour en créer plus.`,
          planLimit: limit,
          currentCount: currentAgentsCount || 0
        });
      }

      // ✅ GÉNÉRER TITRE AUTOMATIQUE
      const finalTitle = getDefaultTitle(body.type, body.title);

      // ✅ CRÉER AGENT AVEC SUPABASE - COLONNES CORRIGÉES
      const agentData = {
        shop_id: shop.id,  // ✅ CORRIGÉ : shop_id
        name: body.name,
        title: finalTitle,
        type: body.type as AgentType,
        personality: body.personality as AgentPersonality,
        description: body.description,
        welcome_message: body.welcomeMessage || "Bonjour ! Comment puis-je vous aider aujourd'hui ?",  // ✅ CORRIGÉ : welcome_message
        fallback_message: body.fallbackMessage || "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",  // ✅ CORRIGÉ : fallback_message
        avatar: body.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(body.name)}&background=3B82F6&color=fff`,
        is_active: body.isActive,  // ✅ CORRIGÉ : is_active
        config: body.config || {}
      };

      console.log('💾 [agents.ts] Données agent à créer:', JSON.stringify(agentData, null, 2));

      const { data: newAgent, error: createError } = await supabaseServiceClient
        .from('agents')
        .insert(agentData)
        .select()
        .single();

      if (createError) {
        throw createError;
      }

      fastify.log.info(`✅ Agent créé avec succès: ${newAgent.id}`);

      return {
        success: true,
        data: {
          id: newAgent.id,
          name: newAgent.name,
          title: finalTitle,
          type: newAgent.type,
          personality: newAgent.personality,
          description: newAgent.description,
          welcomeMessage: newAgent.welcome_message,  // ✅ Mappage snake_case → camelCase
          fallbackMessage: newAgent.fallback_message,  // ✅ Mappage snake_case → camelCase
          avatar: newAgent.avatar,
          isActive: newAgent.is_active,  // ✅ Mappage snake_case → camelCase
          config: newAgent.config,
          stats: { conversations: 0, conversions: 0 },
          knowledgeBase: [],
          createdAt: newAgent.created_at,  // ✅ Mappage snake_case → camelCase
          updatedAt: newAgent.updated_at   // ✅ Mappage snake_case → camelCase
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

  // ✅ ROUTE: GET CONFIG AGENT (SUPABASE) - CORRIGÉE
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

      // ✅ RÉCUPÉRER AGENT AVEC KNOWLEDGE BASE (SUPABASE) - CORRIGÉ
      const { data: agent, error: agentError } = await supabaseServiceClient
        .from('agents')
        .select(`
          id, name, title, type, personality, description,
          welcome_message, fallback_message, avatar, is_active, config,
          agent_knowledge_base!inner(
            knowledge_base!inner(
              id, title, content_type, is_active, tags
            )
          )
        `)
        .eq('id', id)
        .eq('shop_id', shop.id)  // ✅ CORRIGÉ : shop_id
        .single();

      if (agentError || !agent) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      // ✅ CALCULER STATISTIQUES - CORRIGÉ
      let conversations = 0;
      let conversions = 0;

      try {
        const { count: convCount } = await supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('agent_id', agent.id);  // ✅ CORRIGÉ : agent_id
        
        const { count: conversionCount } = await supabaseServiceClient
          .from('conversations')
          .select('*', { count: 'exact', head: true })
          .eq('agent_id', agent.id)  // ✅ CORRIGÉ : agent_id
          .eq('conversion_completed', true);  // ✅ CORRIGÉ : conversion_completed

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
            type: agent.type,
            personality: agent.personality,
            description: agent.description,
            welcomeMessage: agent.welcome_message,  // ✅ Mappage snake_case → camelCase
            fallbackMessage: agent.fallback_message,  // ✅ Mappage snake_case → camelCase
            avatar: agent.avatar,
            isActive: agent.is_active,  // ✅ Mappage snake_case → camelCase
            config: {
              ...(agent.config || {}),
              linkedKnowledgeBase: agent.agent_knowledge_base?.map((akb: any) => akb.knowledge_base.id) || [],
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

      fastify.log.info(`✅ Configuration agent récupérée: ${id}`);
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

  // ✅ ROUTE: UPDATE AGENT (SUPABASE) - CORRIGÉE
  fastify.put<{ Params: AgentParamsType }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);
      
      // ✅ VALIDATION
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

      // ✅ VÉRIFIER EXISTENCE AGENT - CORRIGÉ
      const { data: existingAgent, error: findError } = await supabaseServiceClient
        .from('agents')
        .select('*')
        .eq('id', id)
        .eq('shop_id', shop.id)  // ✅ CORRIGÉ : shop_id
        .single();

      if (findError || !existingAgent) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      // ✅ CONSTRUIRE DONNÉES UPDATE - COLONNES CORRIGÉES
      const updateData: any = {
        ...(body.name && { name: body.name }),
        ...(body.type && { type: body.type }),
        ...(body.personality && { personality: body.personality }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.welcomeMessage !== undefined && { welcome_message: body.welcomeMessage }),  // ✅ CORRIGÉ : welcome_message
        ...(body.fallbackMessage !== undefined && { fallback_message: body.fallbackMessage }),  // ✅ CORRIGÉ : fallback_message
        ...(body.avatar !== undefined && { avatar: body.avatar }),
        ...(body.isActive !== undefined && { is_active: body.isActive }),  // ✅ CORRIGÉ : is_active
        ...(body.config !== undefined && { config: body.config }),
        updated_at: new Date().toISOString()  // ✅ CORRIGÉ : updated_at
      }

      // ✅ GESTION DU TITLE
      if (body.title !== undefined) {
        const finalTitle = getDefaultTitle(body.type || existingAgent.type, body.title);
        updateData.title = finalTitle;
      }

      // ✅ UPDATE AVEC SUPABASE
      const { data: updatedAgent, error: updateError } = await supabaseServiceClient
        .from('agents')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      fastify.log.info(`✅ Agent modifié avec succès: ${updatedAgent.id}`);

      return {
        success: true,
        data: {
          id: updatedAgent.id,
          name: updatedAgent.name,
          title: updatedAgent.title || getDefaultTitle(updatedAgent.type),
          type: updatedAgent.type,
          personality: updatedAgent.personality,
          description: updatedAgent.description,
          welcomeMessage: updatedAgent.welcome_message,  // ✅ Mappage snake_case → camelCase
          fallbackMessage: updatedAgent.fallback_message,  // ✅ Mappage snake_case → camelCase
          avatar: updatedAgent.avatar,
          isActive: updatedAgent.is_active,  // ✅ Mappage snake_case → camelCase
          config: updatedAgent.config,
          createdAt: updatedAgent.created_at,  // ✅ Mappage snake_case → camelCase
          updatedAt: updatedAgent.updated_at   // ✅ Mappage snake_case → camelCase
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

  // ✅ ROUTE: LIER KNOWLEDGE BASE (SUPABASE) - CORRIGÉE
  fastify.post<{ Params: AgentParamsType; Body: AgentKnowledgeBody }>('/:id/knowledge', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);
      const { knowledgeBaseIds } = request.body;

      if (!shop) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Shop non trouvé' 
        });
      }

      // ✅ VÉRIFIER AGENT EXISTE - CORRIGÉ
      const { data: existingAgent, error: findError } = await supabaseServiceClient
        .from('agents')
        .select('id')
        .eq('id', id)
        .eq('shop_id', shop.id)  // ✅ CORRIGÉ : shop_id
        .single();

      if (findError || !existingAgent) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      // ✅ SUPPRIMER ANCIENNES LIAISONS - CORRIGÉ
      const { error: deleteError } = await supabaseServiceClient
        .from('agent_knowledge_base')
        .delete()
        .eq('agent_id', id);  // ✅ CORRIGÉ : agent_id

      if (deleteError) {
        console.warn('Erreur suppression anciennes liaisons:', deleteError);
      }

      // ✅ CRÉER NOUVELLES LIAISONS - COLONNES CORRIGÉES
      if (knowledgeBaseIds && knowledgeBaseIds.length > 0) {
        const linksData = knowledgeBaseIds.map((kbId, index) => ({
          agent_id: id,  // ✅ CORRIGÉ : agent_id
          knowledge_base_id: kbId,  // ✅ CORRIGÉ : knowledge_base_id
          is_active: true,  // ✅ CORRIGÉ : is_active
          priority: index
        }));

        const { error: insertError } = await supabaseServiceClient
          .from('agent_knowledge_base')
          .insert(linksData);

        if (insertError) {
          throw insertError;
        }
      }

      fastify.log.info(`✅ Base de connaissance liée à l'agent: ${id}`);

      return {
        success: true,
        message: 'Base de connaissance mise à jour avec succès'
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

  // ✅ ROUTE: DELETE AGENT (SUPABASE) - CORRIGÉE
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

      // ✅ VÉRIFIER AGENT EXISTE - CORRIGÉ
      const { data: existingAgent, error: findError } = await supabaseServiceClient
        .from('agents')
        .select('id')
        .eq('id', id)
        .eq('shop_id', shop.id)  // ✅ CORRIGÉ : shop_id
        .single();

      if (findError || !existingAgent) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      // ✅ SUPPRIMER AGENT
      const { error: deleteError } = await supabaseServiceClient
        .from('agents')
        .delete()
        .eq('id', id);

      if (deleteError) {
        throw deleteError;
      }

      fastify.log.info(`✅ Agent supprimé avec succès: ${id}`);

      return { 
        success: true, 
        message: 'Agent supprimé avec succès' 
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

  // ✅ ROUTE: TOGGLE AGENT STATUS (SUPABASE) - CORRIGÉE
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

      // ✅ VÉRIFIER AGENT EXISTE - CORRIGÉ
      const { data: existingAgent, error: findError } = await supabaseServiceClient
        .from('agents')
        .select('id')
        .eq('id', id)
        .eq('shop_id', shop.id)  // ✅ CORRIGÉ : shop_id
        .single();

      if (findError || !existingAgent) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      // ✅ UPDATE STATUS - COLONNES CORRIGÉES
      const { data: updatedAgent, error: updateError } = await supabaseServiceClient
        .from('agents')
        .update({ 
          is_active: body.isActive,  // ✅ CORRIGÉ : is_active
          updated_at: new Date().toISOString()  // ✅ CORRIGÉ : updated_at
        })
        .eq('id', id)
        .select('id, is_active, updated_at')  // ✅ CORRIGÉ : is_active, updated_at
        .single();

      if (updateError) {
        throw updateError;
      }

      fastify.log.info(`✅ Statut agent modifié: ${id} -> ${body.isActive ? 'actif' : 'inactif'}`);

      return {
        success: true,
        data: {
          id: updatedAgent.id,
          isActive: updatedAgent.is_active,  // ✅ Mappage snake_case → camelCase
          updatedAt: updatedAgent.updated_at   // ✅ Mappage snake_case → camelCase
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

  // ✅ ROUTE: DUPLICATE AGENT (SUPABASE) - CORRIGÉE
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

      // ✅ VÉRIFIER LIMITES PLAN - CORRIGÉ
      const { count: currentAgentsCount } = await supabaseServiceClient
        .from('agents')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', shop.id);  // ✅ CORRIGÉ : shop_id

      const canCreate = await checkPlanLimits(shop.id, currentAgentsCount || 0, shop.subscription_plan || 'starter');
      
      if (!canCreate) {
        const limit = PLAN_LIMITS[shop.subscription_plan as keyof typeof PLAN_LIMITS]?.agents || 1;
        return reply.status(403).send({ 
          success: false,
          error: `Plan ${shop.subscription_plan} limité à ${limit} agent(s).`,
          planLimit: limit,
          currentCount: currentAgentsCount || 0
        });
      }

      // ✅ RÉCUPÉRER AGENT ORIGINAL AVEC KNOWLEDGE BASE - CORRIGÉ
      const { data: originalAgent, error: findError } = await supabaseServiceClient
        .from('agents')
        .select(`
          *, 
          agent_knowledge_base(knowledge_base_id, is_active, priority)
        `)
        .eq('id', id)
        .eq('shop_id', shop.id)  // ✅ CORRIGÉ : shop_id
        .single();

      if (findError || !originalAgent) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      // ✅ CRÉER AGENT DUPLIQUÉ - COLONNES CORRIGÉES
      const { data: duplicatedAgent, error: createError } = await supabaseServiceClient
        .from('agents')
        .insert({
          shop_id: shop.id,  // ✅ CORRIGÉ : shop_id
          name: `${originalAgent.name} (Copie)`,
          title: originalAgent.title || getDefaultTitle(originalAgent.type),
          type: originalAgent.type,
          personality: originalAgent.personality,
          description: originalAgent.description,
          welcome_message: originalAgent.welcome_message,  // ✅ CORRIGÉ : welcome_message
          fallback_message: originalAgent.fallback_message,  // ✅ CORRIGÉ : fallback_message
          avatar: originalAgent.avatar,
          is_active: false,  // ✅ CORRIGÉ : is_active
          config: originalAgent.config || {}
        })
        .select()
        .single();

      if (createError) {
        throw createError;
      }

      // ✅ DUPLIQUER KNOWLEDGE BASE LINKS - COLONNES CORRIGÉES
      if (originalAgent.agent_knowledge_base && originalAgent.agent_knowledge_base.length > 0) {
        const linksData = originalAgent.agent_knowledge_base.map((kb: any) => ({
          agent_id: duplicatedAgent.id,  // ✅ CORRIGÉ : agent_id
          knowledge_base_id: kb.knowledge_base_id,  // ✅ CORRIGÉ : knowledge_base_id
          is_active: kb.is_active,  // ✅ CORRIGÉ : is_active
          priority: kb.priority
        }));

        const { error: linkError } = await supabaseServiceClient
          .from('agent_knowledge_base')
          .insert(linksData);

        if (linkError) {
          console.warn('Erreur duplication knowledge base links:', linkError);
        }
      }

      fastify.log.info(`✅ Agent dupliqué avec succès: ${duplicatedAgent.id}`);

      return {
        success: true,
        data: {
          id: duplicatedAgent.id,
          name: duplicatedAgent.name,
          title: duplicatedAgent.title || getDefaultTitle(duplicatedAgent.type),
          type: duplicatedAgent.type,
          personality: duplicatedAgent.personality,
          description: duplicatedAgent.description,
          welcomeMessage: duplicatedAgent.welcome_message,  // ✅ Mappage snake_case → camelCase
          fallbackMessage: duplicatedAgent.fallback_message,  // ✅ Mappage snake_case → camelCase
          avatar: duplicatedAgent.avatar,
          isActive: duplicatedAgent.is_active,  // ✅ Mappage snake_case → camelCase
          config: duplicatedAgent.config,
          stats: { conversations: 0, conversions: 0 },
          createdAt: duplicatedAgent.created_at,  // ✅ Mappage snake_case → camelCase
          updatedAt: duplicatedAgent.updated_at   // ✅ Mappage snake_case → camelCase
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

  // ✅ ROUTE: GET AGENT KNOWLEDGE (SUPABASE) - CORRIGÉE
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

      // ✅ RÉCUPÉRER AGENT AVEC KNOWLEDGE BASE - CORRIGÉ
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
        .eq('shop_id', shop.id)  // ✅ CORRIGÉ : shop_id
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
        contentType: akb.knowledge_base.content_type,  // ✅ Mappage snake_case → camelCase
        isActive: akb.knowledge_base.is_active,  // ✅ Mappage snake_case → camelCase
        tags: akb.knowledge_base.tags || [],
        content: akb.knowledge_base.content,
        createdAt: akb.knowledge_base.created_at,  // ✅ Mappage snake_case → camelCase
        updatedAt: akb.knowledge_base.updated_at,  // ✅ Mappage snake_case → camelCase
        priority: akb.priority,
        linkedAt: akb.created_at  // ✅ Mappage snake_case → camelCase
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

  // ✅ ROUTE: PUT KNOWLEDGE BASE (SUPABASE) - CORRIGÉE
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

      // ✅ VÉRIFIER AGENT EXISTE - CORRIGÉ
      const { data: existingAgent, error: findError } = await supabaseServiceClient
        .from('agents')
        .select('id')
        .eq('id', id)
        .eq('shop_id', shop.id)  // ✅ CORRIGÉ : shop_id
        .single();

      if (findError || !existingAgent) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      // ✅ SUPPRIMER ANCIENNES LIAISONS - CORRIGÉ
      const { error: deleteError } = await supabaseServiceClient
        .from('agent_knowledge_base')
        .delete()
        .eq('agent_id', id);  // ✅ CORRIGÉ : agent_id

      if (deleteError) {
        console.warn('Erreur suppression anciennes liaisons:', deleteError);
      }

      // ✅ CRÉER NOUVELLES LIAISONS - COLONNES CORRIGÉES
      if (documentIds && documentIds.length > 0) {
        const linksData = documentIds.map((kbId, index) => ({
          agent_id: id,  // ✅ CORRIGÉ : agent_id
          knowledge_base_id: kbId,  // ✅ CORRIGÉ : knowledge_base_id
          is_active: true,  // ✅ CORRIGÉ : is_active
          priority: index
        }));

        const { error: insertError } = await supabaseServiceClient
          .from('agent_knowledge_base')
          .insert(linksData);

        if (insertError) {
          throw insertError;
        }
      }

      // ✅ RÉCUPÉRER DOCUMENTS LIÉS - CORRIGÉ
      const { data: linkedDocuments, error: linkedError } = await supabaseServiceClient
        .from('agent_knowledge_base')
        .select(`
          knowledge_base(id, title, content_type, is_active, tags)
        `)
        .eq('agent_id', id);  // ✅ CORRIGÉ : agent_id

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
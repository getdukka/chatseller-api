// src/routes/shops.ts - VERSION SUPABASE CORRIGÉE ✅
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabaseServiceClient, supabaseAuthClient } from '../lib/supabase';

// ✅ INTERFACES POUR CONFIGURATIONS
interface WidgetConfig {
  theme?: string;
  language?: string;
  position?: string;
  buttonText?: string;
  primaryColor?: string;
  widgetSize?: string;
  borderRadius?: string;
  animation?: string;
  autoOpen?: boolean;
  showAvatar?: boolean;
  soundEnabled?: boolean;
  mobileOptimized?: boolean;
  offlineMessage?: string;
  isActive?: boolean;
}

interface AgentConfig {
  name?: string;
  avatar?: string;
  welcomeMessage?: string;
  fallbackMessage?: string;
  upsellEnabled?: boolean;
  collectPaymentMethod?: boolean;
  aiProvider?: 'openai' | 'claude';
  temperature?: number;
  maxTokens?: number;
}

// ✅ INTERFACE SIMPLIFIÉE POUR SUPABASE
interface SupabaseAgent {
  id: string;
  name: string;
  type: string | null;
  personality: string | null;
  description: string | null;
  avatar: string | null;
  welcome_message: string | null; // ✅ CORRIGÉ : snake_case
  fallback_message: string | null; // ✅ CORRIGÉ : snake_case
  is_active: boolean; // ✅ CORRIGÉ : snake_case
  config: any;
  agent_knowledge_base?: any[]; // ✅ Type flexible pour Supabase
}

interface ShopWithAgents {
  id: string;
  name: string;
  email: string;
  domain: string | null;
  subscription_plan: string | null;
  widget_config: any;
  agent_config: any;
  is_active: boolean | null;
  updated_at: string | null;
  agents?: SupabaseAgent[];
}

// ✅ SCHÉMAS DE VALIDATION (inchangés - restent en camelCase pour l'API)
const updateShopSchema = z.object({
  name: z.string().optional(),
  domain: z.string().nullable().optional(),
  industry: z.string().optional(),
  platform: z.string().optional(),
  subscription_plan: z.enum(['starter', 'growth', 'performance']).optional(),
  onboarding_completed: z.boolean().optional(),
  onboarding_completed_at: z.string().datetime().nullable().optional(),
  widget_config: z.object({
    primaryColor: z.string().optional(),
    buttonText: z.string().optional(),
    position: z.string().optional(),
    theme: z.string().optional(),
    language: z.string().optional(),
    widgetSize: z.string().optional(),
    borderRadius: z.string().optional(),
    animation: z.string().optional(),
    autoOpen: z.boolean().optional(),
    showAvatar: z.boolean().optional(),
    soundEnabled: z.boolean().optional(),
    mobileOptimized: z.boolean().optional(),
    offlineMessage: z.string().nullable().optional(),
    isActive: z.boolean().optional()
  }).optional(),
  agent_config: z.object({
    name: z.string().optional(),
    avatar: z.string().optional(),
    welcomeMessage: z.string().optional(),
    fallbackMessage: z.string().optional(),
    upsellEnabled: z.boolean().optional(),
    collectPaymentMethod: z.boolean().optional(),
    aiProvider: z.enum(['openai', 'claude']).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().min(1).max(4000).optional()
  }).optional()
});

const createShopSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email(),
  domain: z.string().nullable().optional(),
  industry: z.string().optional(),
  platform: z.string().optional(),
  subscription_plan: z.enum(['starter', 'growth', 'performance']).default('starter'),
  is_active: z.boolean().default(true),
  onboarding_completed: z.boolean().default(false),
  onboarding_completed_at: z.string().datetime().nullable().optional(),
  widget_config: z.object({
    theme: z.string().optional(),
    language: z.string().optional(),
    position: z.string().optional(),
    buttonText: z.string().optional(),
    primaryColor: z.string().optional(),
    widgetSize: z.string().optional(),
    borderRadius: z.string().optional(),
    animation: z.string().optional(),
    autoOpen: z.boolean().optional(),
    showAvatar: z.boolean().optional(),
    soundEnabled: z.boolean().optional(),
    mobileOptimized: z.boolean().optional(),
    offlineMessage: z.string().optional(),
    isActive: z.boolean().optional()
  }).optional(),
  agent_config: z.object({
    name: z.string().optional(),
    avatar: z.string().optional(),
    welcomeMessage: z.string().optional(),
    fallbackMessage: z.string().optional(),
    upsellEnabled: z.boolean().optional(),
    collectPaymentMethod: z.boolean().optional()
  }).optional()
});

// ✅ HELPER FUNCTIONS SUPABASE
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

async function getOrCreateShop(user: any, fastify: FastifyInstance) {
  try {
    // ✅ CHERCHER SHOP EXISTANT AVEC SUPABASE
    const { data: existingShop, error: findError } = await supabaseServiceClient
      .from('shops')
      .select('*')
      .or(`id.eq.${user.id},email.eq.${user.email}`)
      .single();

    if (!findError && existingShop) {
      return existingShop;
    }

    // ✅ CONFIGURATION PAR DÉFAUT
    const defaultWidgetConfig = {
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
    };

    const defaultAgentConfig = {
      name: "Assistant ChatSeller",
      avatar: "https://ui-avatars.com/api/?name=Assistant&background=3B82F6&color=fff",
      upsellEnabled: false,
      welcomeMessage: "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
      fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
      collectPaymentMethod: true,
      aiProvider: "openai",
      temperature: 0.7,
      maxTokens: 1000
    };

    // ✅ CRÉER NOUVEAU SHOP AVEC SUPABASE
    const { data: newShop, error: createError } = await supabaseServiceClient
      .from('shops')
      .insert({
        id: user.id,
        name: user.user_metadata?.full_name || user.email.split('@')[0] || 'Boutique',
        email: user.email,
        // ✅ CORRIGÉ : Nouveau plan par défaut
        subscription_plan: 'starter',
        is_active: true,
        widget_config: defaultWidgetConfig,
        agent_config: defaultAgentConfig,
        // ✅ AJOUTER : Quotas par défaut
        quotas: {
          aiResponses: 1000,
          knowledgeDocuments: 50,
          indexablePages: 500,
          agents: -1,
          additionalAgentCost: 10
        },
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
    console.error('❌ Erreur getOrCreateShop:', error);
    throw error;
  }
}

// ✅ FONCTION : Merger intelligent des configurations
function mergeConfigIntelligent(existing: any, updates: any): any {
  if (!existing && !updates) return {};
  if (!existing) return updates;
  if (!updates) return existing;
  
  const merged = { ...existing };
  
  Object.keys(updates).forEach(key => {
    if (updates[key] !== undefined && updates[key] !== null) {
      merged[key] = updates[key];
    }
  });
  
  return merged;
}

// ✅ TYPES POUR LES REQUÊTES
interface ShopParamsType {
  id: string;
}

interface ShopQueryType {
  agentId?: string;
}

export default async function shopsRoutes(fastify: FastifyInstance) {
  
  // ✅ ROUTE PUBLIQUE CONFIG (SUPABASE CORRIGÉE)
  fastify.get<{ Params: ShopParamsType; Querystring: ShopQueryType }>('/public/:id/config', async (request, reply) => {
    try {
      const { id: shopId } = request.params;
      const { agentId } = request.query;

      fastify.log.info(`🔍 [PUBLIC] Récupération config publique shop: ${shopId}, agent: ${agentId || 'auto'}`);

      // ✅ VALIDATION UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(shopId)) {
        fastify.log.warn(`⚠️ [PUBLIC] ShopId invalide: ${shopId}`);
        return reply.status(400).send({
          success: false,
          error: 'ShopId invalide - doit être un UUID valide'
        });
      }

      // ✅ RÉCUPÉRER SHOP AVEC SUPABASE
      const { data: shop, error: shopError } = await supabaseServiceClient
        .from('shops')
        .select('*')
        .eq('id', shopId)
        .single();

      if (shopError || !shop || !shop.is_active) {
        fastify.log.warn(`⚠️ [PUBLIC] Shop non trouvé ou inactif: ${shopId}`);
        return reply.status(404).send({
          success: false,
          error: 'Shop non trouvé ou inactif'
        });
      }

      // ✅ RÉCUPÉRER AGENTS AVEC KNOWLEDGE BASE - REQUÊTE CORRIGÉE
      let agentsQuery = supabaseServiceClient
        .from('agents')
        .select(`
          id, name, type, personality, description, avatar,
          welcome_message, fallback_message, is_active, config,
          agent_knowledge_base!inner(
            knowledge_base!inner(
              id, title, content, content_type, tags, is_active
            )
          )
        `)
        .eq('shop_id', shopId); // ✅ CORRIGÉ : shop_id

      if (agentId) {
        agentsQuery = agentsQuery.eq('id', agentId);
      } else {
        agentsQuery = agentsQuery.eq('is_active', true); // ✅ CORRIGÉ : is_active
      }

      const { data: agents, error: agentError } = await agentsQuery.order('created_at', { ascending: true });

      let selectedAgent: SupabaseAgent | null = null;
      
      if (agents && agents.length > 0) {
        if (agentId) {
          selectedAgent = agents.find((agent: any) => agent.id === agentId) || null;
        } else {
          selectedAgent = agents.find((agent: any) => agent.is_active) || agents[0] || null; // ✅ CORRIGÉ : is_active
        }
      }

      if (!selectedAgent) {
        fastify.log.warn(`⚠️ [PUBLIC] Aucun agent actif trouvé pour shop: ${shopId}`);
        return reply.status(404).send({
          success: false,
          error: 'Aucun agent actif trouvé pour ce shop'
        });
      }

      const widgetConfig = shop.widget_config as WidgetConfig | null;
      const agentConfig = selectedAgent.config as AgentConfig | null;

      // ✅ CONFIGURATION PUBLIQUE COMPLÈTE
      const publicConfig = {
        shop: {
          id: shop.id,
          shopId: shop.id,
          name: shop.name,
          domain: shop.domain,
          subscription_plan: shop.subscription_plan,
          primaryColor: widgetConfig?.primaryColor || '#3B82F6',
          buttonText: widgetConfig?.buttonText || 'Parler à un conseiller',
          position: widgetConfig?.position || 'above-cta',
          theme: widgetConfig?.theme || 'modern',
          language: widgetConfig?.language || 'fr',
          widgetSize: widgetConfig?.widgetSize || 'medium',
          borderRadius: widgetConfig?.borderRadius || 'md',
          animation: widgetConfig?.animation || 'fade',
          autoOpen: widgetConfig?.autoOpen || false,
          showAvatar: widgetConfig?.showAvatar !== false,
          soundEnabled: widgetConfig?.soundEnabled !== false,
          mobileOptimized: widgetConfig?.mobileOptimized !== false,
          offlineMessage: widgetConfig?.offlineMessage,
          isActive: widgetConfig?.isActive !== false
        },
        agent: {
          id: selectedAgent.id,
          name: selectedAgent.name,
          title: selectedAgent.type || 'Assistant Commercial',
          type: selectedAgent.type,
          personality: selectedAgent.personality,
          description: selectedAgent.description,
          avatar: selectedAgent.avatar,
          welcomeMessage: selectedAgent.welcome_message, // ✅ CORRIGÉ : welcome_message
          fallbackMessage: selectedAgent.fallback_message, // ✅ CORRIGÉ : fallback_message
          systemPrompt: `Tu es ${selectedAgent.name}, un agent commercial IA pour ${shop.name}.`,
          tone: selectedAgent.personality || 'friendly',
          isActive: selectedAgent.is_active, // ✅ CORRIGÉ : is_active
          aiProvider: agentConfig?.aiProvider || 'openai',
          temperature: agentConfig?.temperature || 0.7,
          maxTokens: agentConfig?.maxTokens || 1000,
          knowledgeBase: selectedAgent.agent_knowledge_base?.map((akb: any) => 
            akb.knowledge_base ? akb.knowledge_base : akb
          ) || []
        }
      };

      fastify.log.info(`✅ [PUBLIC] Configuration publique retournée pour ${shop.name} avec agent ${selectedAgent.name} (borderRadius: ${publicConfig.shop.borderRadius})`);

      return {
        success: true,
        data: publicConfig
      };

    } catch (error: any) {
      fastify.log.error('❌ [PUBLIC] Erreur récupération config publique:', error);
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération de la configuration publique',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : OBTENIR UN SHOP (REQUÊTE CORRIGÉE)
  fastify.get<{ Params: ShopParamsType }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);

      fastify.log.info(`🔍 Récupération shop: ${id}`);

      // ✅ RÉCUPÉRER SHOP AVEC AGENTS
      const { data: shop, error: shopError } = await supabaseServiceClient
        .from('shops')
        .select('*')
        .or(`id.eq.${id},email.eq.${user.email}`)
        .eq('id', id)
        .single();

      if (shopError || !shop) {
        return reply.status(404).send({
          success: false,
          error: 'Shop non trouvé'
        });
      }

      // ✅ RÉCUPÉRER AGENTS DU SHOP - REQUÊTE CORRIGÉE
      const { data: agents, error: agentsError } = await supabaseServiceClient
        .from('agents')
        .select(`
          id, name, type, personality, description, avatar,
          welcome_message, fallback_message, is_active, config, created_at,
          agent_knowledge_base!inner(
            knowledge_base!inner(
              id, title, content_type, is_active
            )
          )
        `)
        .eq('shop_id', id); // ✅ CORRIGÉ : shop_id

      const shopWithAgents = {
        ...shop,
        agents: agents || []
      };

      fastify.log.info(`✅ Shop récupéré avec widget_config: ${JSON.stringify(shop.widget_config)}`);

      return {
        success: true,
        data: shopWithAgents
      };

    } catch (error: any) {
      fastify.log.error('❌ Erreur récupération shop:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération du shop',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : CRÉER UN SHOP (INCHANGÉE - PAS D'ERREURS DÉTECTÉES)
  fastify.post('/', async (request, reply) => {
    try {
      const user = await verifySupabaseAuth(request);
      
      // ✅ SI AUCUN BODY, UTILISER getOrCreateShop
      if (!request.body || Object.keys(request.body as object).length === 0) {
        fastify.log.info(`🏗️ Création automatique shop pour: ${user.email}`);
        const shop = await getOrCreateShop(user, fastify);
        return {
          success: true,
          data: shop,
          message: 'Shop créé automatiquement avec succès'
        };
      }
      
      // ✅ VALIDATION
      const body = createShopSchema.parse(request.body);
      
      fastify.log.info(`🏗️ Création shop custom pour: ${user.email}`);

      // ✅ VÉRIFIER SI LE SHOP EXISTE DÉJÀ
      const { data: existingShop } = await supabaseServiceClient
        .from('shops')
        .select('*')
        .or(`id.eq.${body.id},email.eq.${body.email}`)
        .single();

      if (existingShop) {
        fastify.log.info(`✅ Shop existant retourné: ${existingShop.id}`);
        
        return {
          success: true,
          data: existingShop,
          message: 'Shop existant récupéré'
        };
      }

      // ✅ CRÉER NOUVEAU SHOP
      const defaultWidgetConfig = {
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
        isActive: true,
        ...body.widget_config
      };

      const defaultAgentConfig = {
        name: "Assistant ChatSeller",
        avatar: "https://ui-avatars.com/api/?name=Assistant&background=3B82F6&color=fff",
        upsellEnabled: false,
        welcomeMessage: "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
        fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
        collectPaymentMethod: true,
        aiProvider: "openai",
        temperature: 0.7,
        maxTokens: 1000,
        ...body.agent_config
      };

      const { data: newShop, error: createError } = await supabaseServiceClient
        .from('shops')
        .insert({
          id: body.id,
          name: body.name,
          email: body.email,
          domain: body.domain,
          industry: body.industry, 
          platform: body.platform,
          subscription_plan: body.subscription_plan || 'starter',
          is_active: body.is_active,
          onboarding_completed: body.onboarding_completed, 
          onboarding_completed_at: body.onboarding_completed_at ? body.onboarding_completed_at : null, 
          widget_config: defaultWidgetConfig,
          agent_config: defaultAgentConfig
        })
        .select()
        .single();

      if (createError) {
        throw createError;
      }

      fastify.log.info(`✅ Shop créé avec widget_config (borderRadius: ${defaultWidgetConfig.borderRadius}): ${JSON.stringify(newShop.widget_config)}`);

      return {
        success: true,
        data: newShop,
        message: 'Shop créé avec succès'
      };

    } catch (error: any) {
      fastify.log.error('❌ Erreur création shop:', error);
      
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
        error: 'Erreur lors de la création du shop',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : METTRE À JOUR UN SHOP - REQUÊTE AGENTS CORRIGÉE
  fastify.put<{ Params: ShopParamsType }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      
      // ✅ VALIDATION
      const body = updateShopSchema.parse(request.body);

      fastify.log.info(`📝 Mise à jour shop ${id} - widget: ${!!body.widget_config}, agent: ${!!body.agent_config}`);

      // ✅ VÉRIFIER QUE LE SHOP EXISTE
      const { data: existingShop, error: findError } = await supabaseServiceClient
        .from('shops')
        .select('*')
        .or(`id.eq.${user.id},email.eq.${user.email}`)
        .eq('id', id)
        .single();

      if (findError || !existingShop) {
        return reply.status(404).send({
          success: false,
          error: 'Shop non trouvé'
        });
      }

      // ✅ PRÉPARER LES DONNÉES DE MISE À JOUR
      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      if (body.name !== undefined) updateData.name = body.name;
      if (body.domain !== undefined) updateData.domain = body.domain;
      if (body.industry !== undefined) updateData.industry = body.industry;
      if (body.platform !== undefined) updateData.platform = body.platform;
      if (body.subscription_plan !== undefined) updateData.subscription_plan = body.subscription_plan;
      if (body.onboarding_completed !== undefined) updateData.onboarding_completed = body.onboarding_completed;
      if (body.onboarding_completed_at !== undefined) {
        updateData.onboarding_completed_at = body.onboarding_completed_at ? body.onboarding_completed_at : null;
      }

      // ✅ FUSION INTELLIGENTE DES CONFIGURATIONS WIDGET
      if (body.widget_config) {
        const existingWidgetConfig = existingShop.widget_config as WidgetConfig | null;
        
        const cleanWidgetConfig = {
          ...existingWidgetConfig,
          ...body.widget_config
        };
        
        // ✅ S'assurer que les valeurs booléennes sont bien des booléens
        if (cleanWidgetConfig.autoOpen !== undefined) {
          cleanWidgetConfig.autoOpen = Boolean(cleanWidgetConfig.autoOpen);
        }
        if (cleanWidgetConfig.showAvatar !== undefined) {
          cleanWidgetConfig.showAvatar = Boolean(cleanWidgetConfig.showAvatar);
        }
        if (cleanWidgetConfig.soundEnabled !== undefined) {
          cleanWidgetConfig.soundEnabled = Boolean(cleanWidgetConfig.soundEnabled);
        }
        if (cleanWidgetConfig.mobileOptimized !== undefined) {
          cleanWidgetConfig.mobileOptimized = Boolean(cleanWidgetConfig.mobileOptimized);
        }
        if (cleanWidgetConfig.isActive !== undefined) {
          cleanWidgetConfig.isActive = Boolean(cleanWidgetConfig.isActive);
        }
        
        updateData.widget_config = cleanWidgetConfig;
        
        fastify.log.info(`🎨 Widget config merger (borderRadius: ${cleanWidgetConfig.borderRadius}) - existant: ${!!existingWidgetConfig}, fusionné: ${!!cleanWidgetConfig}`);
      }

      // ✅ FUSION INTELLIGENTE DES CONFIGURATIONS AGENT
      if (body.agent_config) {
        const existingAgentConfig = existingShop.agent_config as AgentConfig | null;
        const mergedAgentConfig = mergeConfigIntelligent(existingAgentConfig, body.agent_config);
        
        updateData.agent_config = mergedAgentConfig;
        
        fastify.log.info(`🤖 Agent config merger - existant: ${!!existingAgentConfig}, fusionné: ${!!mergedAgentConfig}`);
      }

      // ✅ METTRE À JOUR AVEC SUPABASE
      const { data: updatedShop, error: updateError } = await supabaseServiceClient
        .from('shops')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      // ✅ RÉCUPÉRER AGENTS POUR RÉPONSE COMPLÈTE - REQUÊTE CORRIGÉE
      const { data: agents } = await supabaseServiceClient
        .from('agents')
        .select(`
          id, name, type, personality, description, avatar,
          welcome_message, fallback_message, is_active, config, created_at,
          agent_knowledge_base!inner(
            knowledge_base!inner(
              id, title, content_type, is_active
            )
          )
        `)
        .eq('shop_id', id); // ✅ CORRIGÉ : shop_id

      const shopWithAgents = {
        ...updatedShop,
        agents: agents || []
      };

      fastify.log.info(`✅ Shop ${id} mis à jour avec succès`);

      return {
        success: true,
        data: shopWithAgents,
        message: 'Shop mis à jour avec succès'
      };

    } catch (error: any) {
      fastify.log.error('❌ Erreur mise à jour shop:', error);
      
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
        error: 'Erreur lors de la mise à jour du shop',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : STATISTIQUES D'UN SHOP - REQUÊTES CORRIGÉES
  fastify.get<{ Params: ShopParamsType }>('/:id/stats', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);

      // ✅ VÉRIFIER LE SHOP
      const { data: shop, error: shopError } = await supabaseServiceClient
        .from('shops')
        .select('id')
        .or(`id.eq.${user.id},email.eq.${user.email}`)
        .eq('id', id)
        .single();

      if (shopError || !shop) {
        return reply.status(404).send({
          success: false,
          error: 'Shop non trouvé'
        });
      }

      // ✅ CALCULER STATISTIQUES AVEC SUPABASE - REQUÊTES CORRIGÉES
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const [conversationsResult, messagesResult, agentsResult, ordersResult] = await Promise.all([
        // Total conversations
        supabaseServiceClient
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('shop_id', id), // ✅ CORRIGÉ : shop_id
        
        // Total messages - REQUÊTE SIMPLIFIÉE
        supabaseServiceClient
          .from('messages')
          .select('id', { count: 'exact', head: true }),
        
        // Total agents
        supabaseServiceClient
          .from('agents')
          .select('id, is_active', { count: 'exact', head: true }) // ✅ CORRIGÉ : is_active
          .eq('shop_id', id), // ✅ CORRIGÉ : shop_id
        
        // Total orders
        supabaseServiceClient
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('shop_id', id) // ✅ CORRIGÉ : shop_id
      ]);

      const totalConversations = conversationsResult.count || 0;
      const totalMessages = messagesResult.count || 0;
      const totalOrders = ordersResult.count || 0;

      // ✅ AGENTS ACTIFS - REQUÊTE CORRIGÉE
      const { data: agentsData } = await supabaseServiceClient
        .from('agents')
        .select('is_active') // ✅ CORRIGÉ : is_active
        .eq('shop_id', id); // ✅ CORRIGÉ : shop_id

      const totalAgents = agentsData?.length || 0;
      const activeAgents = agentsData?.filter(agent => agent.is_active).length || 0; // ✅ CORRIGÉ : is_active

      // ✅ STATISTIQUES DERNIERS 30 JOURS - REQUÊTES CORRIGÉES
      const [conversationsLast30Result, messagesLast30Result, ordersLast30Result] = await Promise.all([
        supabaseServiceClient
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('shop_id', id) // ✅ CORRIGÉ : shop_id
          .gte('created_at', thirtyDaysAgo.toISOString()),
        
        supabaseServiceClient
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', thirtyDaysAgo.toISOString()),
        
        supabaseServiceClient
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('shop_id', id) // ✅ CORRIGÉ : shop_id
          .gte('created_at', thirtyDaysAgo.toISOString())
      ]);

      const conversationsLast30Days = conversationsLast30Result.count || 0;
      const messagesLast30Days = messagesLast30Result.count || 0;
      const ordersLast30Days = ordersLast30Result.count || 0;

      const stats = {
        total: {
          conversations: totalConversations,
          messages: totalMessages,
          agents: totalAgents,
          activeAgents: activeAgents,
          orders: totalOrders
        },
        last30Days: {
          conversations: conversationsLast30Days,
          messages: messagesLast30Days,
          orders: ordersLast30Days
        },
        averageMessagesPerConversation: totalConversations > 0 
          ? Math.round(totalMessages / totalConversations * 100) / 100 
          : 0,
        conversionRate: totalConversations > 0 
          ? Math.round((totalOrders / totalConversations) * 100 * 100) / 100
          : 0
      };

      return {
        success: true,
        data: stats
      };

    } catch (error: any) {
      fastify.log.error('❌ Erreur statistiques shop:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des statistiques',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ GET quotas actuels
fastify.get<{ Params: { shopId: string } }>('/:shopId/quotas', async (request, reply) => {
  try {
    const { shopId } = request.params
    const user = await verifySupabaseAuth(request)
    
    // Vérifier ownership
    if (user.id !== shopId) {
      return reply.status(403).send({ success: false, error: 'Accès refusé' })
    }
    
    const { data: shop, error } = await supabaseServiceClient
      .from('shops')
      .select('quotas_usage, subscription_plan')
      .eq('id', shopId)
      .single()
    
    if (error || !shop) {
      return reply.status(404).send({ success: false, error: 'Shop non trouvé' })
    }
    
    return {
      success: true,
      data: {
        quotas_usage: shop.quotas_usage || {
          aiResponses: 0,
          knowledgeDocuments: 0,
          indexablePages: 0,
          agents: 0
        },
        subscription_plan: shop.subscription_plan
      }
    }
  } catch (error: any) {
    return reply.status(500).send({ success: false, error: error.message })
  }
})

// ✅ POST incrémenter quota
fastify.post<{ 
  Params: { shopId: string }
  Body: { quota: string, amount: number }
}>('/:shopId/quotas/increment', async (request, reply) => {
  try {
    const { shopId } = request.params
    const { quota, amount } = request.body
    const user = await verifySupabaseAuth(request)
    
    if (user.id !== shopId) {
      return reply.status(403).send({ success: false, error: 'Accès refusé' })
    }
    
    // Valider quota type
    const validQuotas = ['aiResponses', 'knowledgeDocuments', 'indexablePages', 'agents']
    if (!validQuotas.includes(quota)) {
      return reply.status(400).send({ success: false, error: 'Type de quota invalide' })
    }
    
    // Récupérer quotas actuels
    const { data: shop, error: fetchError } = await supabaseServiceClient
      .from('shops')
      .select('quotas_usage')
      .eq('id', shopId)
      .single()
    
    if (fetchError || !shop) {
      return reply.status(404).send({ success: false, error: 'Shop non trouvé' })
    }
    
    // Calculer nouveaux quotas
    const currentQuotas = shop.quotas_usage || {}
    const newQuotas = {
      ...currentQuotas,
      [quota]: (currentQuotas[quota] || 0) + amount
    }
    
    // Mettre à jour
    const { data: updatedShop, error: updateError } = await supabaseServiceClient
      .from('shops')
      .update({ quotas_usage: newQuotas })
      .eq('id', shopId)
      .select('quotas_usage')
      .single()
    
    if (updateError) {
      throw updateError
    }
    
    fastify.log.info(`✅ Quota ${quota} incrémenté de ${amount} pour shop ${shopId}`)
    
    return {
      success: true,
      data: {
        quotas_usage: updatedShop.quotas_usage
      }
    }
  } catch (error: any) {
    return reply.status(500).send({ success: false, error: error.message })
  }
})

// ✅ POST reset quotas mensuels
fastify.post<{ Params: { shopId: string } }>('/:shopId/quotas/reset', async (request, reply) => {
  try {
    const { shopId } = request.params
    const user = await verifySupabaseAuth(request)
    
    if (user.id !== shopId) {
      return reply.status(403).send({ success: false, error: 'Accès refusé' })
    }
    
    // Reset quotas (garder agents)
    const { data: shop, error: fetchError } = await supabaseServiceClient
      .from('shops')
      .select('quotas_usage')
      .eq('id', shopId)
      .single()
    
    const currentAgents = shop?.quotas_usage?.agents || 0
    
    const resetQuotas = {
      aiResponses: 0,
      knowledgeDocuments: 0, 
      indexablePages: 0,
      agents: currentAgents // Garder le nombre d'agents
    }
    
    const { data: updatedShop, error: updateError } = await supabaseServiceClient
      .from('shops')
      .update({ quotas_usage: resetQuotas })
      .eq('id', shopId)
      .select('quotas_usage')
      .single()
    
    if (updateError) {
      throw updateError
    }
    
    fastify.log.info(`✅ Quotas mensuels réinitialisés pour shop ${shopId}`)
    
    return {
      success: true,
      data: {
        quotas_usage: updatedShop.quotas_usage
      }
    }
  } catch (error: any) {
    return reply.status(500).send({ success: false, error: error.message })
  }
})

  // ✅ ROUTE : LISTE DES SHOPS - REQUÊTE AGENTS CORRIGÉE
  fastify.get('/', async (request, reply) => {
    try {
      const user = await verifySupabaseAuth(request);

      fastify.log.info(`🔍 Récupération shops pour: ${user.email}`);

      // ✅ RÉCUPÉRER SHOPS AVEC AGENTS
      const { data: shops, error: shopsError } = await supabaseServiceClient
        .from('shops')
        .select('*')
        .or(`id.eq.${user.id},email.eq.${user.email}`)
        .order('created_at', { ascending: false });

      if (shopsError) {
        throw shopsError;
      }

      // ✅ RÉCUPÉRER AGENTS POUR CHAQUE SHOP - REQUÊTE CORRIGÉE
      const shopsWithAgents = await Promise.all(
        (shops || []).map(async (shop) => {
          const { data: agents } = await supabaseServiceClient
            .from('agents')
            .select('id, name, is_active, created_at') // ✅ CORRIGÉ : is_active
            .eq('shop_id', shop.id); // ✅ CORRIGÉ : shop_id
          
          return {
            ...shop,
            agents: agents || []
          };
        })
      );

      return {
        success: true,
        data: shopsWithAgents,
        meta: {
          total: shopsWithAgents.length
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Erreur liste shops:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération des shops',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : TEST DE CONFIGURATION WIDGET (INCHANGÉE - PAS D'ERREURS)
  fastify.get<{ Params: ShopParamsType }>('/:id/widget-config', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);

      fastify.log.info(`🎨 Test récupération widget config pour shop: ${id}`);

      const { data: shop, error: shopError } = await supabaseServiceClient
        .from('shops')
        .select('id, widget_config, updated_at')
        .or(`id.eq.${user.id},email.eq.${user.email}`)
        .eq('id', id)
        .single();

      if (shopError || !shop) {
        return reply.status(404).send({
          success: false,
          error: 'Shop non trouvé'
        });
      }

      return {
        success: true,
        data: {
          shopId: shop.id,
          widget_config: shop.widget_config,
          lastUpdated: shop.updated_at
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Erreur test widget config:', error);
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors du test de configuration widget'
      });
    }
  });
}
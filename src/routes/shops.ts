// src/routes/shops.ts - VERSION CORRIGÉE AVEC SINGLETON PRISMA
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import prisma from '../lib/prisma'

// ✅ INTERFACES POUR CONFIGURATIONS
interface WidgetConfig {
  theme?: string;
  language?: string;
  position?: string;
  buttonText?: string;
  primaryColor?: string;
  widgetSize?: string;
  borderRadius?: string; // ✅ AJOUT BORDERRADIUS
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

interface AgentWithKnowledgeBase {
  id: string;
  name: string;
  type: string | null;
  personality: string | null;
  description: string | null;
  avatar: string | null;
  welcomeMessage: string | null;
  fallbackMessage: string | null;
  isActive: boolean;
  config: any;
  knowledgeBase: Array<{
    knowledgeBase: {
      id: string;
      title: string;
      content: string | null;
      contentType: string;
      tags: string[];
      isActive: boolean;
    }
  }>;
}

interface ShopWithAgents {
  id: string;
  name: string;
  email: string;
  domain: string | null;
  subscription_plan: string | null;
  widget_config: Prisma.JsonValue | null;
  agent_config: Prisma.JsonValue | null;
  is_active: boolean | null;
  updatedAt: Date | null;
  agents: AgentWithKnowledgeBase[];
}

// ✅ SUPABASE
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ✅ SCHÉMAS DE VALIDATION RENFORCÉS
const updateShopSchema = z.object({
  name: z.string().optional(),
  domain: z.string().nullable().optional(),
  industry: z.string().optional(),
  platform: z.string().optional(),
  subscription_plan: z.enum(['free', 'starter', 'pro', 'professional', 'enterprise']).optional(),
  onboarding_completed: z.boolean().optional(),
  onboarding_completed_at: z.string().datetime().nullable().optional(),
  // ✅ VALIDATION WIDGET CONFIG AVEC BORDERRADIUS
  widget_config: z.object({
    primaryColor: z.string().optional(),
    buttonText: z.string().optional(),
    position: z.string().optional(),
    theme: z.string().optional(),
    language: z.string().optional(),
    widgetSize: z.string().optional(),
    borderRadius: z.string().optional(), // ✅ AJOUT
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
  subscription_plan: z.enum(['free', 'starter', 'pro', 'professional', 'enterprise']).default('free'),
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
    borderRadius: z.string().optional(), // ✅ AJOUT
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

// ✅ HELPER FUNCTIONS
async function verifySupabaseAuth(request: FastifyRequest) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Token manquant');
  }

  const token = authHeader.substring(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    throw new Error('Token invalide');
  }
  
  return user;
}

async function getOrCreateShop(user: any, fastify: FastifyInstance) {
  try {
    let shop = await prisma.shop.findUnique({
      where: { id: user.id }
    });

    if (shop) {
      return shop;
    }

    shop = await prisma.shop.findUnique({
      where: { email: user.email }
    });

    if (shop) {
      return shop;
    }

    // ✅ CONFIGURATION WIDGET PAR DÉFAUT AVEC BORDERRADIUS
    const defaultWidgetConfig = {
      theme: "modern",
      language: "fr", 
      position: "above-cta",
      buttonText: "Parler à un conseiller",
      primaryColor: "#3B82F6",
      widgetSize: "medium",
      borderRadius: "md", // ✅ AJOUT
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

    const newShop = await prisma.shop.create({
      data: {
        id: user.id,
        name: user.user_metadata?.full_name || user.email.split('@')[0] || 'Boutique',
        email: user.email,
        subscription_plan: 'free',
        is_active: true,
        widget_config: defaultWidgetConfig as Prisma.InputJsonObject,
        agent_config: defaultAgentConfig as Prisma.InputJsonObject
      }
    });

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
  
  // Fusion profonde pour éviter la perte de données
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
  
  // ✅ CORRECTION PRINCIPALE : ROUTE PUBLIQUE CONFIG CORRIGÉE
  fastify.get<{ Params: ShopParamsType; Querystring: ShopQueryType }>('/public/:id/config', async (request, reply) => {
    try {
      const { id: shopId } = request.params;
      const { agentId } = request.query;

      fastify.log.info(`🔍 [PUBLIC] Récupération config publique shop: ${shopId}, agent: ${agentId || 'auto'}`);

      // ✅ VALIDATION UUID SHOPID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(shopId)) {
        fastify.log.warn(`⚠️ [PUBLIC] ShopId invalide: ${shopId}`);
        return reply.status(400).send({
          success: false,
          error: 'ShopId invalide - doit être un UUID valide'
        });
      }

      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        include: {
          agents: {
            where: agentId ? { id: agentId } : { isActive: true },
            include: {
              knowledgeBase: {
                include: {
                  knowledgeBase: {
                    select: {
                      id: true,
                      title: true,
                      content: true,
                      contentType: true,
                      tags: true,
                      isActive: true
                    }
                  }
                },
                where: {
                  knowledgeBase: {
                    isActive: true
                  }
                }
              }
            },
            orderBy: { createdAt: 'asc' }
          }
        }
      }) as ShopWithAgents | null;

      if (!shop || !shop.is_active) {
        fastify.log.warn(`⚠️ [PUBLIC] Shop non trouvé ou inactif: ${shopId}`);
        return reply.status(404).send({
          success: false,
          error: 'Shop non trouvé ou inactif'
        });
      }

      let selectedAgent: AgentWithKnowledgeBase | null = null;
      if (agentId) {
        selectedAgent = shop.agents.find((agent: AgentWithKnowledgeBase) => agent.id === agentId) || null;
      } else {
        selectedAgent = shop.agents.find((agent: AgentWithKnowledgeBase) => agent.isActive) || shop.agents[0] || null;
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

      // ✅ CONFIGURATION PUBLIQUE COMPLÈTE AVEC BORDERRADIUS
      const publicConfig = {
        shop: {
          id: shop.id,
          shopId: shop.id,
          name: shop.name,
          domain: shop.domain,
          subscription_plan: shop.subscription_plan,
          // ✅ TOUTES LES PROPRIÉTÉS WIDGET EXPOSÉES + BORDERRADIUS
          primaryColor: widgetConfig?.primaryColor || '#3B82F6',
          buttonText: widgetConfig?.buttonText || 'Parler à un conseiller',
          position: widgetConfig?.position || 'above-cta',
          theme: widgetConfig?.theme || 'modern',
          language: widgetConfig?.language || 'fr',
          widgetSize: widgetConfig?.widgetSize || 'medium',
          borderRadius: widgetConfig?.borderRadius || 'md', // ✅ AJOUT BORDERRADIUS
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
          welcomeMessage: selectedAgent.welcomeMessage,
          fallbackMessage: selectedAgent.fallbackMessage,
          systemPrompt: `Tu es ${selectedAgent.name}, un agent commercial IA pour ${shop.name}.`,
          tone: selectedAgent.personality || 'friendly',
          isActive: selectedAgent.isActive,
          aiProvider: agentConfig?.aiProvider || 'openai',
          temperature: agentConfig?.temperature || 0.7,
          maxTokens: agentConfig?.maxTokens || 1000,
          knowledgeBase: selectedAgent.knowledgeBase?.map((kb: { knowledgeBase: any }) => kb.knowledgeBase) || []
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

  // ✅ ROUTE : OBTENIR UN SHOP (GET /api/v1/shops/:id) - AVEC BORDERRADIUS
  fastify.get<{ Params: ShopParamsType }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);

      fastify.log.info(`🔍 Récupération shop: ${id}`);

      const shop = await prisma.shop.findFirst({
        where: { 
          id,
          OR: [
            { id: user.id },
            { email: user.email }
          ]
        },
        include: {
          agents: {
            include: {
              knowledgeBase: {
                include: {
                  knowledgeBase: {
                    select: {
                      id: true,
                      title: true,
                      contentType: true,
                      isActive: true
                    }
                  }
                }
              }
            }
          }
        }
      });

      if (!shop) {
        return reply.status(404).send({
          success: false,
          error: 'Shop non trouvé'
        });
      }

      fastify.log.info(`✅ Shop récupéré avec widget_config:`, shop.widget_config);

      return {
        success: true,
        data: shop
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

  // ✅ ROUTE : CRÉER UN SHOP (POST /api/v1/shops)
  fastify.post('/', async (request, reply) => {
    try {
      const user = await verifySupabaseAuth(request);
      
      // ✅ SI AUCUN BODY OU BODY VIDE, UTILISER getOrCreateShop
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
      const existingShop = await prisma.shop.findFirst({
        where: {
          OR: [
            { id: body.id },
            { id: user.id },
            { email: body.email },
            { email: user.email }
          ]
        }
      });

      if (existingShop) {
        fastify.log.info(`✅ Shop existant retourné: ${existingShop.id}`);
        
        return {
          success: true,
          data: existingShop,
          message: 'Shop existant récupéré'
        };
      }

      // ✅ CRÉER NOUVEAU SHOP AVEC CONFIGS PAR DÉFAUT AVEC BORDERRADIUS
      const defaultWidgetConfig = {
        theme: "modern",
        language: "fr", 
        position: "above-cta",
        buttonText: "Parler à un conseiller",
        primaryColor: "#3B82F6",
        widgetSize: "medium",
        borderRadius: "md", // ✅ AJOUT
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

      const newShop = await prisma.shop.create({
        data: {
          id: body.id,
          name: body.name,
          email: body.email,
          domain: body.domain,
          industry: body.industry, 
          platform: body.platform,
          subscription_plan: body.subscription_plan,
          is_active: body.is_active,
          onboarding_completed: body.onboarding_completed, 
          onboarding_completed_at: body.onboarding_completed_at ? new Date(body.onboarding_completed_at) : null, 
          widget_config: defaultWidgetConfig as Prisma.InputJsonObject,
          agent_config: defaultAgentConfig as Prisma.InputJsonObject
        }
      });

      fastify.log.info(`✅ Shop créé avec widget_config (borderRadius: ${defaultWidgetConfig.borderRadius}):`, newShop.widget_config);

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

  // ✅ ROUTE : METTRE À JOUR UN SHOP (PUT /api/v1/shops/:id) - AVEC BORDERRADIUS
  fastify.put<{ Params: ShopParamsType }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      
      // ✅ VALIDATION
      const body = updateShopSchema.parse(request.body);

      fastify.log.info(`📝 Mise à jour shop: ${id}`, {
        hasWidgetConfig: !!body.widget_config,
        hasAgentConfig: !!body.agent_config,
        widgetUpdates: body.widget_config
      });

      const existingShop = await prisma.shop.findFirst({
        where: { 
          id,
          OR: [
            { id: user.id },
            { email: user.email }
          ]
        }
      });

      if (!existingShop) {
        return reply.status(404).send({
          success: false,
          error: 'Shop non trouvé'
        });
      }

      // ✅ PRÉPARER LES DONNÉES DE MISE À JOUR
      const updateData: any = {
        updatedAt: new Date()
      };

      if (body.name !== undefined) updateData.name = body.name;
      if (body.domain !== undefined) updateData.domain = body.domain;
      if (body.industry !== undefined) updateData.industry = body.industry;
      if (body.platform !== undefined) updateData.platform = body.platform;
      if (body.subscription_plan !== undefined) updateData.subscription_plan = body.subscription_plan;
      if (body.onboarding_completed !== undefined) updateData.onboarding_completed = body.onboarding_completed;
      if (body.onboarding_completed_at !== undefined) {
        updateData.onboarding_completed_at = body.onboarding_completed_at ? new Date(body.onboarding_completed_at) : null;
      }

      // ✅ FUSION INTELLIGENTE DES CONFIGURATIONS WIDGET AVEC BORDERRADIUS
      if (body.widget_config) {
        const existingWidgetConfig = existingShop.widget_config as WidgetConfig | null;
        
        // ✅ VALIDATION ET NETTOYAGE DES DONNÉES WIDGET
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
        
        updateData.widget_config = cleanWidgetConfig as Prisma.InputJsonObject;
        
        fastify.log.info(`🎨 Widget config merger (borderRadius: ${cleanWidgetConfig.borderRadius}):`, {
          existing: existingWidgetConfig,
          updates: body.widget_config,
          merged: cleanWidgetConfig
        });
      }

      // ✅ FUSION INTELLIGENTE DES CONFIGURATIONS AGENT
      if (body.agent_config) {
        const existingAgentConfig = existingShop.agent_config as AgentConfig | null;
        const mergedAgentConfig = mergeConfigIntelligent(existingAgentConfig, body.agent_config);
        
        updateData.agent_config = mergedAgentConfig as Prisma.InputJsonObject;
        
        fastify.log.info(`🤖 Agent config merger:`, {
          existing: existingAgentConfig,
          updates: body.agent_config,
          merged: mergedAgentConfig
        });
      }

      const updatedShop = await prisma.shop.update({
        where: { id },
        data: updateData,
        include: {
          agents: {
            include: {
              knowledgeBase: {
                include: {
                  knowledgeBase: {
                    select: {
                      id: true,
                      title: true,
                      contentType: true,
                      isActive: true
                    }
                  }
                }
              }
            }
          }
        }
      });

      fastify.log.info(`✅ Shop mis à jour avec succès:`, {
        id,
        newWidgetConfig: updatedShop.widget_config,
        newAgentConfig: updatedShop.agent_config
      });

      return {
        success: true,
        data: updatedShop,
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

  // ✅ ROUTE : OBTENIR LES STATISTIQUES D'UN SHOP (GET /api/v1/shops/:id/stats)
  fastify.get<{ Params: ShopParamsType }>('/:id/stats', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);

      const shop = await prisma.shop.findFirst({
        where: { 
          id,
          OR: [
            { id: user.id },
            { email: user.email }
          ]
        }
      });

      if (!shop) {
        return reply.status(404).send({
          success: false,
          error: 'Shop non trouvé'
        });
      }

      const [totalConversations, totalMessages, totalAgents, activeAgents, totalOrders] = await Promise.all([
        prisma.conversation.count({
          where: { shopId: id }
        }),
        prisma.message.count({
          where: { 
            conversation: { shopId: id } 
          }
        }),
        prisma.agent.count({
          where: { shopId: id }
        }),
        prisma.agent.count({
          where: { 
            shopId: id,
            isActive: true 
          }
        }),
        prisma.order.count({
          where: { shopId: id }
        })
      ]);

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      let conversationsLast30Days = 0;
      let messagesLast30Days = 0;
      let ordersLast30Days = 0;

      try {
        [conversationsLast30Days, messagesLast30Days, ordersLast30Days] = await Promise.all([
          prisma.conversation.count({
            where: { 
              shopId: id,
              startedAt: { gte: thirtyDaysAgo }
            }
          }),
          prisma.message.count({
            where: { 
              conversation: { shopId: id },
              createdAt: { gte: thirtyDaysAgo }
            }
          }),
          prisma.order.count({
            where: { 
              shopId: id,
              createdAt: { gte: thirtyDaysAgo }
            }
          })
        ]);
      } catch (error) {
        console.warn('Champ de date non trouvé, utilisation des totaux...');
        conversationsLast30Days = totalConversations;
        messagesLast30Days = totalMessages;
        ordersLast30Days = totalOrders;
      }

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

  // ✅ ROUTE : LISTE DES SHOPS DE L'UTILISATEUR (GET /api/v1/shops)
  fastify.get('/', async (request, reply) => {
    try {
      const user = await verifySupabaseAuth(request);

      fastify.log.info(`🔍 Récupération shops pour: ${user.email}`);

      const shops = await prisma.shop.findMany({
        where: {
          OR: [
            { id: user.id },
            { email: user.email }
          ]
        },
        include: {
          agents: {
            select: {
              id: true,
              name: true,
              isActive: true,
              createdAt: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      return {
        success: true,
        data: shops,
        meta: {
          total: shops.length
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

  // ✅ NOUVELLE ROUTE : TEST DE CONFIGURATION WIDGET
  fastify.get<{ Params: ShopParamsType }>('/:id/widget-config', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);

      fastify.log.info(`🎨 Test récupération widget config pour shop: ${id}`);

      const shop = await prisma.shop.findFirst({
        where: { 
          id,
          OR: [
            { id: user.id },
            { email: user.email }
          ]
        },
        select: {
          id: true,
          widget_config: true,
          updatedAt: true
        }
      });

      if (!shop) {
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
          lastUpdated: shop.updatedAt
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
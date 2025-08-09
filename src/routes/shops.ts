// src/routes/shops.ts - VERSION CORRIGÉE SANS DUPLICATION
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PrismaClient, Prisma } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

// ✅ INTERFACES INCHANGÉES
interface WidgetConfig {
  theme?: string;
  language?: string;
  position?: string;
  buttonText?: string;
  primaryColor?: string;
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

// ✅ PRISMA ET SUPABASE INCHANGÉS
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

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ✅ SCHÉMAS DE VALIDATION ÉTENDUS
const updateShopSchema = z.object({
  name: z.string().optional(),
  domain: z.string().nullable().optional(),
  industry: z.string().optional(),
  platform: z.string().optional(),
  subscription_plan: z.enum(['free', 'starter', 'pro', 'professional', 'enterprise']).optional(),
  onboarding_completed: z.boolean().optional(),
  onboarding_completed_at: z.string().datetime().nullable().optional(),
  widget_config: z.object({
    primaryColor: z.string().optional(),
    buttonText: z.string().optional(),
    position: z.string().optional(),
    theme: z.string().optional(),
    language: z.string().optional(),
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

// ✅ NOUVEAU : SCHÉMA POUR CRÉATION DE SHOP
const createShopSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
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

// ✅ HELPER FUNCTIONS INCHANGÉES
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
    await prisma.$connect();
    
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

    const newShop = await prisma.shop.create({
      data: {
        id: user.id,
        name: user.user_metadata?.full_name || user.email.split('@')[0] || 'Boutique',
        email: user.email,
        subscription_plan: 'free',
        is_active: true,
        widget_config: {
          theme: "modern",
          language: "fr", 
          position: "above-cta",
          buttonText: "Parler à un conseiller",
          primaryColor: "#3B82F6",
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
          avatar: "https://ui-avatars.com/api/?name=Assistant&background=3B82F6&color=fff",
          upsellEnabled: false,
          welcomeMessage: "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
          fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
          collectPaymentMethod: true
        }
      }
    });

    return newShop;

  } finally {
    await prisma.$disconnect();
  }
}

// ✅ TYPES POUR LES REQUÊTES INCHANGÉS
interface ShopParamsType {
  id: string;
}

interface ShopQueryType {
  agentId?: string;
}

export default async function shopsRoutes(fastify: FastifyInstance) {
  
  // ✅ ROUTE PUBLIQUE CONFIG - INCHANGÉE
  fastify.get<{ Params: ShopParamsType; Querystring: ShopQueryType }>('/public/:id/config', async (request, reply) => {
    try {
      const { id: shopId } = request.params;
      const { agentId } = request.query;

      fastify.log.info(`🔍 Récupération config publique shop: ${shopId}, agent: ${agentId || 'auto'}`);

      await prisma.$connect();

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
        return reply.status(404).send({
          success: false,
          error: 'Aucun agent actif trouvé pour ce shop'
        });
      }

      const widgetConfig = shop.widget_config as WidgetConfig | null;
      const agentConfig = selectedAgent.config as AgentConfig | null;

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
          borderRadius: widgetConfig?.borderRadius || 'md',
          animation: widgetConfig?.animation || 'fade',
          autoOpen: widgetConfig?.autoOpen || false,
          showAvatar: widgetConfig?.showAvatar !== false,
          soundEnabled: widgetConfig?.soundEnabled !== false,
          mobileOptimized: widgetConfig?.mobileOptimized !== false,
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

      await prisma.$disconnect();

      fastify.log.info(`✅ Configuration publique retournée pour ${shop.name} avec agent ${selectedAgent.name}`);

      return {
        success: true,
        data: publicConfig
      };

    } catch (error: any) {
      fastify.log.error('❌ Erreur récupération config publique:', error);
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération de la configuration',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE PUBLIQUE STATUS - INCHANGÉE
  fastify.get<{ Params: ShopParamsType }>('/public/:id/status', async (request, reply) => {
    try {
      const { id: shopId } = request.params;

      await prisma.$connect();

      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: {
          id: true,
          is_active: true,
          updatedAt: true,
          createdAt: true,
          agents: {
            select: {
              id: true,
              updatedAt: true
            },
            orderBy: { updatedAt: 'desc' }
          }
        }
      });

      if (!shop) {
        return reply.status(404).send({
          success: false,
          error: 'Shop non trouvé'
        });
      }

      let lastUpdated: Date;
      if (shop.updatedAt && shop.agents.length > 0) {
        lastUpdated = new Date(Math.max(
          shop.updatedAt.getTime(),
          ...shop.agents.map((agent: { updatedAt: Date | null }) => 
            agent.updatedAt ? agent.updatedAt.getTime() : 0
          )
        ));
      } else if (shop.updatedAt) {
        lastUpdated = shop.updatedAt;
      } else {
        lastUpdated = shop.createdAt || new Date();
      }

      await prisma.$disconnect();

      return {
        success: true,
        data: {
          shopId: shop.id,
          isActive: shop.is_active,
          lastUpdated: lastUpdated.toISOString(),
          agentsCount: shop.agents.length
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Erreur statut shop:', error);
      
      return reply.status(500).send({
        success: false,
        error: 'Erreur lors de la récupération du statut'
      });
    }
  });

  // ✅ ROUTE : OBTENIR UN SHOP (GET /api/v1/shops/:id)
  fastify.get<{ Params: ShopParamsType }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);

      fastify.log.info(`🔍 Récupération shop: ${id}`);

      await prisma.$connect();

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

      await prisma.$disconnect();

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
      
      // ✅ VALIDATION AVEC NOUVEAU SCHÉMA
      const body = createShopSchema.parse(request.body);
      
      fastify.log.info(`🏗️ Création shop custom pour: ${user.email}`);

      await prisma.$connect();

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
        
        await prisma.$disconnect();
        
        return {
          success: true,
          data: existingShop,
          message: 'Shop existant récupéré'
        };
      }

      // ✅ CRÉER NOUVEAU SHOP AVEC TOUTES LES COLONNES
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
          widget_config: body.widget_config || {
            theme: "modern",
            language: "fr", 
            position: "bottom-right",
            buttonText: "Parler à un conseiller",
            primaryColor: "#3B82F6",
            borderRadius: "md",
            animation: "fade",
            autoOpen: false,
            showAvatar: true,
            soundEnabled: true,
            mobileOptimized: true,
            isActive: true
          },
          agent_config: body.agent_config || {
            name: "Assistant ChatSeller",
            avatar: "https://ui-avatars.com/api/?name=Assistant&background=3B82F6&color=fff",
            upsellEnabled: false,
            welcomeMessage: "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
            fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
            collectPaymentMethod: true
          }
        }
      });

      await prisma.$disconnect();

      fastify.log.info(`✅ Shop créé avec succès: ${newShop.id}`);

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

  // ✅ ROUTE : METTRE À JOUR UN SHOP (PUT /api/v1/shops/:id) - VERSION UNIQUE
  fastify.put<{ Params: ShopParamsType }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      
      // ✅ VALIDATION AVEC NOUVEAU SCHÉMA
      const body = updateShopSchema.parse(request.body);

      fastify.log.info(`📝 Mise à jour shop: ${id}`);

      await prisma.$connect();

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

      // ✅ PRÉPARER LES DONNÉES DE MISE À JOUR AVEC NOUVEAUX CHAMPS
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

      // ✅ FUSION INTELLIGENTE DES CONFIGURATIONS
      if (body.widget_config) {
        const existingWidgetConfig = existingShop.widget_config as WidgetConfig | null;
        updateData.widget_config = {
          ...(existingWidgetConfig || {}),
          ...body.widget_config
        } as Prisma.InputJsonObject;
      }

      if (body.agent_config) {
        const existingAgentConfig = existingShop.agent_config as AgentConfig | null;
        updateData.agent_config = {
          ...(existingAgentConfig || {}),
          ...body.agent_config
        } as Prisma.InputJsonObject;
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

      await prisma.$disconnect();

      fastify.log.info(`✅ Shop mis à jour avec succès: ${id}`);

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

      await prisma.$connect();

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

      const [totalConversations, totalMessages, totalAgents, activeAgents] = await Promise.all([
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
        })
      ]);

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      let conversationsLast30Days = 0;
      let messagesLast30Days = 0;

      try {
        [conversationsLast30Days, messagesLast30Days] = await Promise.all([
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
          })
        ]);
      } catch (error) {
        console.warn('Champ de date non trouvé, utilisation des totaux...');
        conversationsLast30Days = totalConversations;
        messagesLast30Days = totalMessages;
      }

      await prisma.$disconnect();

      const stats = {
        total: {
          conversations: totalConversations,
          messages: totalMessages,
          agents: totalAgents,
          activeAgents: activeAgents
        },
        last30Days: {
          conversations: conversationsLast30Days,
          messages: messagesLast30Days
        },
        averageMessagesPerConversation: totalConversations > 0 
          ? Math.round(totalMessages / totalConversations * 100) / 100 
          : 0,
        conversionRate: 0
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

      await prisma.$connect();

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

      await prisma.$disconnect();

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
}
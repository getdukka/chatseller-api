// src/routes/agents.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PrismaClient, AgentType, AgentPersonality, Prisma } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import prisma from '../lib/prisma'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const PLAN_LIMITS = {
  free: { agents: 1 },
  starter: { agents: 1 }, // ✅ STARTER = 1 agent
  professional: { agents: 3 }, // ✅ PRO = 3 agents  
  pro: { agents: 3 }, // ✅ ALIAS POUR PRO
  enterprise: { agents: -1 } // ✅ UNLIMITED
};

// ✅ SCHÉMAS CORRIGÉS AVEC TITLE ET SHOPID
const createAgentSchema = z.object({
  name: z.string().min(1, 'Le nom est requis').max(255, 'Nom trop long'),
  title: z.string().optional().default(''), // ✅ NOUVEAU: Titre personnalisable
  type: z.enum(['general', 'product_specialist', 'support', 'upsell']),
  personality: z.enum(['professional', 'friendly', 'expert', 'casual']),
  description: z.string().optional().nullable(),
  welcomeMessage: z.string().optional().nullable(),
  fallbackMessage: z.string().optional().nullable(),
  avatar: z.string().url().optional().nullable(),
  isActive: z.boolean().default(true),
  config: z.record(z.any()).optional().transform(val => val as Prisma.InputJsonObject | undefined),
  shopId: z.string().uuid().optional() // ✅ NOUVEAU: shopId depuis le frontend
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
        subscription_plan: 'starter', // ✅ DEFAULT STARTER POUR 1 AGENT
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
          title: "Assistant commercial", // ✅ NOUVEAU: Titre par défaut
          avatar: "https://ui-avatars.com/api/?name=Assistant&background=3B82F6&color=fff",
          upsellEnabled: false,
          welcomeMessage: "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
          fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
          collectPaymentMethod: true,
          aiProvider: "openai",
          temperature: 0.7,
          maxTokens: 1000
        }
      }
    });

    return newShop;

  } finally {
    await prisma.$disconnect();
  }
}

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
  
  // ✅ ROUTE LISTE DES AGENTS (AVEC TITLE)
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

      await prisma.$connect();
      
      const agents = await prisma.agent.findMany({
        where: { shopId: shop.id },
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
        },
        orderBy: { updatedAt: 'desc' }
      });

      const agentsWithStats = await Promise.all(
        agents.map(async (agent) => {
          const conversations = await prisma.conversation.count({
            where: { agentId: agent.id }
          });
          
          const conversions = await prisma.conversation.count({
            where: { 
              agentId: agent.id,
              conversionCompleted: true 
            }
          });

          return {
            id: agent.id,
            name: agent.name,
            title: (agent as any).title || getDefaultTitle(agent.type), // ✅ NOUVEAU: Title
            type: agent.type,
            personality: agent.personality,
            description: agent.description,
            welcomeMessage: agent.welcomeMessage,
            fallbackMessage: agent.fallbackMessage,
            avatar: agent.avatar,
            isActive: agent.isActive,
            config: agent.config,
            stats: {
              conversations,
              conversions
            },
            knowledgeBase: agent.knowledgeBase.map(kb => kb.knowledgeBase),
            createdAt: agent.createdAt.toISOString(),
            updatedAt: agent.updatedAt.toISOString()
          };
        })
      );

      await prisma.$disconnect();

      return {
        success: true,
        data: agentsWithStats,
        meta: {
          total: agents.length,
          planLimit: PLAN_LIMITS[shop.subscription_plan as keyof typeof PLAN_LIMITS]?.agents || 1
        }
      };

    } catch (error: any) {
      await prisma.$disconnect();
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

  // ✅ ROUTE CRÉER UN AGENT (AVEC TITLE ET DEBUGGING AMÉLIORÉ)
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

      // ✅ LOGGING DU BODY POUR DEBUG
      console.log('📥 [agents.ts] Body reçu:', JSON.stringify(request.body, null, 2));
      
      // ✅ VALIDATION ZOD AVEC GESTION D'ERREURS DÉTAILLÉE
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

      await prisma.$connect();

      const currentAgentsCount = await prisma.agent.count({
        where: { shopId: shop.id }
      });

      const canCreate = await checkPlanLimits(shop.id, currentAgentsCount, shop.subscription_plan || 'starter');
      
      if (!canCreate) {
        const limit = PLAN_LIMITS[shop.subscription_plan as keyof typeof PLAN_LIMITS]?.agents || 1;
        await prisma.$disconnect();
        return reply.status(403).send({ 
          success: false,
          error: `Plan ${shop.subscription_plan} limité à ${limit} agent(s). Passez au plan supérieur pour en créer plus.`,
          planLimit: limit,
          currentCount: currentAgentsCount
        });
      }

      // ✅ GÉNÉRER TITRE AUTOMATIQUE SI VIDE
      const finalTitle = getDefaultTitle(body.type, body.title);

      // ✅ CRÉATION AGENT AVEC TITRE
      const agentData = {
        shopId: shop.id,
        name: body.name,
        title: finalTitle, // ✅ NOUVEAU: Ajouter title
        type: body.type as AgentType,
        personality: body.personality as AgentPersonality,
        description: body.description,
        welcomeMessage: body.welcomeMessage || "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
        fallbackMessage: body.fallbackMessage || "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
        avatar: body.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(body.name)}&background=3B82F6&color=fff`,
        isActive: body.isActive,
        config: (body.config || {}) as Prisma.InputJsonObject
      };

      console.log('💾 [agents.ts] Données agent à créer:', JSON.stringify(agentData, null, 2));

      const newAgent = await prisma.agent.create({
        data: agentData
      });

      await prisma.$disconnect();

      fastify.log.info(`✅ Agent créé avec succès: ${newAgent.id}`);

      return {
        success: true,
        data: {
          id: newAgent.id,
          name: newAgent.name,
          title: finalTitle, // ✅ NOUVEAU: Retourner le title
          type: newAgent.type,
          personality: newAgent.personality,
          description: newAgent.description,
          welcomeMessage: newAgent.welcomeMessage,
          fallbackMessage: newAgent.fallbackMessage,
          avatar: newAgent.avatar,
          isActive: newAgent.isActive,
          config: newAgent.config,
          stats: { conversations: 0, conversions: 0 },
          knowledgeBase: [],
          createdAt: newAgent.createdAt.toISOString(),
          updatedAt: newAgent.updatedAt.toISOString()
        }
      };

    } catch (error: any) {
      await prisma.$disconnect();
      fastify.log.error('❌ Create agent error:', error);
      
      // ✅ GESTION D'ERREURS DÉTAILLÉE POUR DEBUG
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          success: false,
          error: 'Données invalides',
          details: error.errors,
          received: request.body
        });
      }
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ 
          success: false, 
          error: error.message 
        });
      }

      // ✅ ERREUR PRISMA SPÉCIFIQUE
      if (error.code === 'P2002') {
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
          stack: error.stack,
          code: error.code
        } : undefined
      });
    }
  });

  // ✅ ROUTE GET CONFIG AGENT (CORRIGÉE AVEC TITLE)
  fastify.get<{ Params: AgentParamsType }>('/:id/config', async (request, reply) => {
    let isConnected = false;
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

      await prisma.$connect();
      isConnected = true;

      const agent = await prisma.agent.findFirst({
        where: { 
          id,
          shopId: shop.id 
        },
        include: {
          knowledgeBase: {
            include: {
              knowledgeBase: {
                select: {
                  id: true,
                  title: true,
                  contentType: true,
                  isActive: true,
                  tags: true
                }
              }
            }
          }
        }
      });

      if (!agent) {
        await prisma.$disconnect();
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      // ✅ STRUCTURE CORRIGÉE AVEC TITLE
      const response = {
        success: true,
        data: {
          agent: {
            id: agent.id,
            name: agent.name,
            title: (agent as any).title || getDefaultTitle(agent.type), // ✅ NOUVEAU: Title personnalisable
            type: agent.type,
            personality: agent.personality,
            description: agent.description,
            welcomeMessage: agent.welcomeMessage,
            fallbackMessage: agent.fallbackMessage,
            avatar: agent.avatar,
            isActive: agent.isActive,
            config: {
              ...(agent.config as any || {}),
              linkedKnowledgeBase: agent.knowledgeBase.map(kb => kb.knowledgeBase.id),
              aiProvider: (agent.config as any)?.aiProvider || 'openai',
              temperature: (agent.config as any)?.temperature || 0.7,
              maxTokens: (agent.config as any)?.maxTokens || 1000,
              systemPrompt: (agent.config as any)?.systemPrompt || '',
              tone: (agent.config as any)?.tone || 'friendly'
            },
            totalConversations: 0,
            totalConversions: 0,
            stats: {
              conversations: 0,
              conversions: 0
            }
          },
          knowledgeBase: agent.knowledgeBase.map(kb => kb.knowledgeBase)
        }
      };

      try {
        const [conversations, conversions] = await Promise.all([
          prisma.conversation.count({
            where: { agentId: agent.id }
          }),
          prisma.conversation.count({
            where: { 
              agentId: agent.id,
              conversionCompleted: true 
            }
          })
        ]);

        response.data.agent.totalConversations = conversations;
        response.data.agent.totalConversions = conversions;
        response.data.agent.stats = {
          conversations,
          conversions
        };
      } catch (statsError) {
        console.warn('⚠️ Erreur calcul statistiques:', statsError);
      }

      await prisma.$disconnect();
      isConnected = false;

      fastify.log.info(`✅ Configuration agent récupérée: ${id}`);
      return response;

    } catch (error: any) {
      if (isConnected) {
        await prisma.$disconnect();
      }
      
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

  // ✅ ROUTE UPDATE AGENT (CORRIGÉE AVEC TITLE)
  fastify.put<{ Params: AgentParamsType }>('/:id', async (request, reply) => {
    let isConnected = false;
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);
      
      // ✅ VALIDATION AVEC GESTION D'ERREURS
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

      await prisma.$connect();
      isConnected = true;

      const existingAgent = await prisma.agent.findFirst({
        where: { 
          id,
          shopId: shop.id 
        }
      });

      if (!existingAgent) {
        await prisma.$disconnect();
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      // ✅ CONSTRUIRE LES DONNÉES DE MISE À JOUR AVEC TITLE
      const updateData: any = {
        ...(body.name && { name: body.name }),
        ...(body.type && { type: body.type as AgentType }),
        ...(body.personality && { personality: body.personality as AgentPersonality }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.welcomeMessage !== undefined && { welcomeMessage: body.welcomeMessage }),
        ...(body.fallbackMessage !== undefined && { fallbackMessage: body.fallbackMessage }),
        ...(body.avatar !== undefined && { avatar: body.avatar }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.config !== undefined && { config: body.config as Prisma.InputJsonObject }),
        updatedAt: new Date()
      }

      // ✅ NOUVEAU: Gestion du title
      if (body.title !== undefined) {
        const finalTitle = getDefaultTitle(body.type || existingAgent.type, body.title);
        updateData.title = finalTitle;
      }

      const updatedAgent = await prisma.agent.update({
        where: { id },
        data: updateData
      });

      await prisma.$disconnect();
      isConnected = false;

      fastify.log.info(`✅ Agent modifié avec succès: ${updatedAgent.id}`);

      return {
        success: true,
        data: {
          id: updatedAgent.id,
          name: updatedAgent.name,
          title: (updatedAgent as any).title || getDefaultTitle(updatedAgent.type), // ✅ NOUVEAU: Title
          type: updatedAgent.type,
          personality: updatedAgent.personality,
          description: updatedAgent.description,
          welcomeMessage: updatedAgent.welcomeMessage,
          fallbackMessage: updatedAgent.fallbackMessage,
          avatar: updatedAgent.avatar,
          isActive: updatedAgent.isActive,
          config: updatedAgent.config,
          createdAt: updatedAgent.createdAt.toISOString(),
          updatedAt: updatedAgent.updatedAt.toISOString()
        }
      };

    } catch (error: any) {
      if (isConnected) {
        await prisma.$disconnect();
      }
      
      fastify.log.error('❌ Update agent error:', error);
      
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
        error: 'Erreur lors de la modification de l\'agent',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ Continuer avec toutes les autres routes existantes...
  // (Les autres routes restent identiques à votre version originale)

  // ✅ ROUTE : LIER UN AGENT À DES DOCUMENTS DE BASE DE CONNAISSANCE 
  fastify.post<{ Params: AgentParamsType; Body: AgentKnowledgeBody }>('/:id/knowledge', async (request, reply) => {
    let isConnected = false;
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

      await prisma.$connect();
      isConnected = true;

      const existingAgent = await prisma.agent.findFirst({
        where: { 
          id,
          shopId: shop.id 
        }
      });

      if (!existingAgent) {
        await prisma.$disconnect();
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      await prisma.agentKnowledgeBase.deleteMany({
        where: { agentId: id }
      });

      if (knowledgeBaseIds && knowledgeBaseIds.length > 0) {
        await prisma.agentKnowledgeBase.createMany({
          data: knowledgeBaseIds.map((kbId, index) => ({
            agentId: id,
            knowledgeBaseId: kbId,
            isActive: true,
            priority: index
          }))
        });
      }

      await prisma.$disconnect();
      isConnected = false;

      fastify.log.info(`✅ Base de connaissance liée à l'agent: ${id}`);

      return {
        success: true,
        message: 'Base de connaissance mise à jour avec succès'
      };

    } catch (error: any) {
      if (isConnected) {
        await prisma.$disconnect();
      }
      
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

  // ✅ ROUTE DELETE AGENT
  fastify.delete<{ Params: AgentParamsType }>('/:id', async (request, reply) => {
    let isConnected = false;
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

      await prisma.$connect();
      isConnected = true;

      const existingAgent = await prisma.agent.findFirst({
        where: { 
          id,
          shopId: shop.id 
        }
      });

      if (!existingAgent) {
        await prisma.$disconnect();
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      await prisma.agent.delete({
        where: { id }
      });

      await prisma.$disconnect();
      isConnected = false;

      fastify.log.info(`✅ Agent supprimé avec succès: ${id}`);

      return { 
        success: true, 
        message: 'Agent supprimé avec succès' 
      };

    } catch (error: any) {
      if (isConnected) {
        await prisma.$disconnect();
      }
      
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

  // ✅ ROUTE TOGGLE AGENT STATUS
  fastify.patch<{ Params: AgentParamsType }>('/:id/toggle', async (request, reply) => {
    let isConnected = false;
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

      await prisma.$connect();
      isConnected = true;

      const existingAgent = await prisma.agent.findFirst({
        where: { 
          id,
          shopId: shop.id 
        }
      });

      if (!existingAgent) {
        await prisma.$disconnect();
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      const updatedAgent = await prisma.agent.update({
        where: { id },
        data: { 
          isActive: body.isActive,
          updatedAt: new Date()
        }
      });

      await prisma.$disconnect();
      isConnected = false;

      fastify.log.info(`✅ Statut agent modifié: ${id} -> ${body.isActive ? 'actif' : 'inactif'}`);

      return {
        success: true,
        data: {
          id: updatedAgent.id,
          isActive: updatedAgent.isActive,
          updatedAt: updatedAgent.updatedAt.toISOString()
        }
      };

    } catch (error: any) {
      if (isConnected) {
        await prisma.$disconnect();
      }
      
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

  // ✅ ROUTE DUPLICATE AGENT
  fastify.post<{ Params: AgentParamsType }>('/:id/duplicate', async (request, reply) => {
    let isConnected = false;
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

      await prisma.$connect();
      isConnected = true;

      const currentAgentsCount = await prisma.agent.count({
        where: { shopId: shop.id }
      });

      const canCreate = await checkPlanLimits(shop.id, currentAgentsCount, shop.subscription_plan || 'starter');
      
      if (!canCreate) {
        const limit = PLAN_LIMITS[shop.subscription_plan as keyof typeof PLAN_LIMITS]?.agents || 1;
        await prisma.$disconnect();
        return reply.status(403).send({ 
          success: false,
          error: `Plan ${shop.subscription_plan} limité à ${limit} agent(s).`,
          planLimit: limit,
          currentCount: currentAgentsCount
        });
      }

      const originalAgent = await prisma.agent.findFirst({
        where: { 
          id,
          shopId: shop.id 
        },
        include: {
          knowledgeBase: true
        }
      });

      if (!originalAgent) {
        await prisma.$disconnect();
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      const duplicatedAgent = await prisma.agent.create({
        data: {
          shopId: shop.id,
          name: `${originalAgent.name} (Copie)`,
          title: (originalAgent as any).title || getDefaultTitle(originalAgent.type),
          type: originalAgent.type,
          personality: originalAgent.personality,
          description: originalAgent.description,
          welcomeMessage: originalAgent.welcomeMessage,
          fallbackMessage: originalAgent.fallbackMessage,
          avatar: originalAgent.avatar,
          isActive: false,
          config: (originalAgent.config || {}) as Prisma.InputJsonObject
        }
      });

      if (originalAgent.knowledgeBase.length > 0) {
        await prisma.agentKnowledgeBase.createMany({
          data: originalAgent.knowledgeBase.map(kb => ({
            agentId: duplicatedAgent.id,
            knowledgeBaseId: kb.knowledgeBaseId,
            isActive: kb.isActive,
            priority: kb.priority
          }))
        });
      }

      await prisma.$disconnect();
      isConnected = false;

      fastify.log.info(`✅ Agent dupliqué avec succès: ${duplicatedAgent.id}`);

      return {
        success: true,
        data: {
          id: duplicatedAgent.id,
          name: duplicatedAgent.name,
          title: (duplicatedAgent as any).title || getDefaultTitle(duplicatedAgent.type), // ✅ TITLE
          type: duplicatedAgent.type,
          personality: duplicatedAgent.personality,
          description: duplicatedAgent.description,
          welcomeMessage: duplicatedAgent.welcomeMessage,
          fallbackMessage: duplicatedAgent.fallbackMessage,
          avatar: duplicatedAgent.avatar,
          isActive: duplicatedAgent.isActive,
          config: duplicatedAgent.config,
          stats: { conversations: 0, conversions: 0 },
          createdAt: duplicatedAgent.createdAt.toISOString(),
          updatedAt: duplicatedAgent.updatedAt.toISOString()
        }
      };

    } catch (error: any) {
      if (isConnected) {
        await prisma.$disconnect();
      }
      
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

  // ✅ ROUTE GET AGENT KNOWLEDGE
  fastify.get<{ Params: AgentParamsType }>('/:id/knowledge', async (request, reply) => {
    let isConnected = false;
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

      await prisma.$connect();
      isConnected = true;

      const agent = await prisma.agent.findFirst({
        where: { 
          id,
          shopId: shop.id 
        },
        include: {
          knowledgeBase: {
            include: {
              knowledgeBase: {
                select: {
                  id: true,
                  title: true,
                  contentType: true,
                  isActive: true,
                  tags: true,
                  content: true,
                  createdAt: true,
                  updatedAt: true
                }
              }
            }
          }
        }
      });

      if (!agent) {
        await prisma.$disconnect();
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      const knowledgeBaseDocuments = agent.knowledgeBase.map(kb => ({
        id: kb.knowledgeBase.id,
        title: kb.knowledgeBase.title,
        contentType: kb.knowledgeBase.contentType,
        isActive: kb.knowledgeBase.isActive,
        tags: kb.knowledgeBase.tags || [],
        content: kb.knowledgeBase.content,
        createdAt: kb.knowledgeBase.createdAt,
        updatedAt: kb.knowledgeBase.updatedAt,
        priority: kb.priority,
        linkedAt: kb.createdAt
      }));

      await prisma.$disconnect();
      isConnected = false;

      fastify.log.info(`✅ Base de connaissance récupérée pour agent: ${id} (${knowledgeBaseDocuments.length} documents)`);

      return {
        success: true,
        data: knowledgeBaseDocuments
      };

    } catch (error: any) {
      if (isConnected) {
        await prisma.$disconnect();
      }
      
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

  // ✅ ROUTE PUT KNOWLEDGE BASE
  fastify.put<{ Params: AgentParamsType }>('/:id/knowledge-base', async (request, reply) => {
    let isConnected = false;
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

      await prisma.$connect();
      isConnected = true;

      const existingAgent = await prisma.agent.findFirst({
        where: { 
          id,
          shopId: shop.id 
        }
      });

      if (!existingAgent) {
        await prisma.$disconnect();
        return reply.status(404).send({ 
          success: false, 
          error: 'Agent non trouvé' 
        });
      }

      await prisma.agentKnowledgeBase.deleteMany({
        where: { agentId: id }
      });

      if (documentIds && documentIds.length > 0) {
        await prisma.agentKnowledgeBase.createMany({
          data: documentIds.map((kbId, index) => ({
            agentId: id,
            knowledgeBaseId: kbId,
            isActive: true,
            priority: index
          }))
        });
      }

      const linkedDocuments = await prisma.agentKnowledgeBase.findMany({
        where: { agentId: id },
        include: {
          knowledgeBase: {
            select: {
              id: true,
              title: true,
              contentType: true,
              isActive: true,
              tags: true
            }
          }
        }
      });

      await prisma.$disconnect();
      isConnected = false;

      fastify.log.info(`✅ Base de connaissance liée à l'agent: ${id}`);

      return {
        success: true,
        message: 'Base de connaissance mise à jour avec succès',
        data: {
          documents: linkedDocuments.map(link => link.knowledgeBase)
        }
      };

    } catch (error: any) {
      if (isConnected) {
        await prisma.$disconnect();
      }
      
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
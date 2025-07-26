// src/routes/agents.ts - ENDPOINTS API AGENTS COMPLETS
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PrismaClient, AgentType, AgentPersonality, Prisma } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

// ✅ CRÉER UNE INSTANCE PRISMA
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

// ✅ CONFIGURATION DES PLANS
const PLAN_LIMITS = {
  free: { agents: 1 },
  professional: { agents: 3 },
  enterprise: { agents: -1 } // illimité
};

// ✅ SCHÉMAS DE VALIDATION
const createAgentSchema = z.object({
  name: z.string().min(1, 'Le nom est requis').max(255, 'Nom trop long'),
  type: z.enum(['general', 'product_specialist', 'support', 'upsell']),
  personality: z.enum(['professional', 'friendly', 'expert', 'casual']),
  description: z.string().optional(),
  welcomeMessage: z.string().optional(),
  fallbackMessage: z.string().optional(),
  avatar: z.string().url().optional(),
  isActive: z.boolean().default(true),
  config: z.record(z.any()).optional().transform(val => val as Prisma.InputJsonObject | undefined)
});

const updateAgentSchema = createAgentSchema.partial();

const toggleAgentSchema = z.object({
  isActive: z.boolean()
});

// ✅ HELPER: Vérifier l'auth Supabase
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

// ✅ HELPER: Récupérer ou créer un shop
async function getOrCreateShop(user: any, fastify: FastifyInstance) {
  try {
    await prisma.$connect();
    
    // Chercher d'abord par ID utilisateur
    let shop = await prisma.shop.findUnique({
      where: { id: user.id }
    });

    if (shop) {
      return shop;
    }

    // Chercher par email
    shop = await prisma.shop.findUnique({
      where: { email: user.email }
    });

    if (shop) {
      return shop;
    }

    // Créer automatiquement le shop si il n'existe pas
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
          position: "bottom-right",
          buttonText: "Parler au vendeur",
          primaryColor: "#3B82F6"
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

// ✅ HELPER: Vérifier les limites du plan
async function checkPlanLimits(shopId: string, currentCount: number, plan: string) {
  const limit = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS]?.agents;
  
  if (limit === -1) return true; // Illimité
  if (limit === undefined) return false; // Plan inconnu
  
  return currentCount < limit;
}

// ✅ INTERFACES POUR LES TYPES DE REQUÊTE
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
  
  // ✅ ROUTE : LISTE DES AGENTS (GET /api/agents)
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      fastify.log.info('🔍 Récupération des agents');
      
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);

      if (!shop) {
        return reply.status(404).send({ error: 'Shop non trouvé' });
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

      // Calculer les statistiques réelles
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
      fastify.log.error('❌ Get agents error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ error: error.message });
      }
      
      return reply.status(500).send({ 
        error: 'Erreur lors de la récupération des agents',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : CRÉER UN AGENT (POST /api/agents)
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      fastify.log.info('🏗️ Création d\'un nouvel agent');
      
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);
      const body = createAgentSchema.parse(request.body);

      if (!shop) {
        return reply.status(404).send({ error: 'Shop non trouvé' });
      }

      await prisma.$connect();

      // Vérifier les limites du plan
      const currentAgentsCount = await prisma.agent.count({
        where: { shopId: shop.id }
      });

      const canCreate = await checkPlanLimits(shop.id, currentAgentsCount, shop.subscription_plan || 'free');
      
      if (!canCreate) {
        const limit = PLAN_LIMITS[shop.subscription_plan as keyof typeof PLAN_LIMITS]?.agents || 1;
        return reply.status(403).send({ 
          error: `Plan ${shop.subscription_plan} limité à ${limit} agent(s). Passez au plan supérieur pour en créer plus.`,
          planLimit: limit,
          currentCount: currentAgentsCount
        });
      }

      // Créer l'agent
      const newAgent = await prisma.agent.create({
        data: {
          shopId: shop.id,
          name: body.name,
          type: body.type as AgentType,
          personality: body.personality as AgentPersonality,
          description: body.description,
          welcomeMessage: body.welcomeMessage || "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
          fallbackMessage: body.fallbackMessage || "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
          avatar: body.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(body.name)}&background=3B82F6&color=fff`,
          isActive: body.isActive,
          config: (body.config || {}) as Prisma.InputJsonObject
        }
      });

      await prisma.$disconnect();

      fastify.log.info(`✅ Agent créé avec succès: ${newAgent.id}`);

      return {
        success: true,
        data: {
          id: newAgent.id,
          name: newAgent.name,
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
      fastify.log.error('❌ Create agent error:', error);
      
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          error: 'Données invalides',
          details: error.errors
        });
      }
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ error: error.message });
      }
      
      return reply.status(500).send({
        error: 'Erreur lors de la création de l\'agent',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : OBTENIR LA CONFIGURATION D'UN AGENT (GET /api/v1/agents/:id/config)
  fastify.get<{ Params: AgentParamsType }>('/:id/config', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);

      if (!shop) {
        return reply.status(404).send({ error: 'Shop non trouvé' });
      }

      await prisma.$connect();

      // Vérifier que l'agent appartient au shop
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
        return reply.status(404).send({ error: 'Agent non trouvé' });
      }

      await prisma.$disconnect();

      return {
        success: true,
        data: {
          agent: {
            id: agent.id,
            name: agent.name,
            type: agent.type,
            personality: agent.personality,
            description: agent.description,
            welcomeMessage: agent.welcomeMessage,
            fallbackMessage: agent.fallbackMessage,
            avatar: agent.avatar,
            isActive: agent.isActive,
            config: agent.config
          },
          knowledgeBase: agent.knowledgeBase.map(kb => kb.knowledgeBase)
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Get agent config error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ error: error.message });
      }
      
      return reply.status(500).send({
        error: 'Erreur lors de la récupération de la configuration',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : METTRE À JOUR LA CONFIGURATION D'UN AGENT (PUT /api/v1/agents/:id/config)
  fastify.put<{ Params: AgentParamsType; Body: AgentConfigBody }>('/:id/config', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);
      const { config } = request.body;

      if (!shop) {
        return reply.status(404).send({ error: 'Shop non trouvé' });
      }

      await prisma.$connect();

      // Vérifier que l'agent appartient au shop
      const existingAgent = await prisma.agent.findFirst({
        where: { 
          id,
          shopId: shop.id 
        }
      });

      if (!existingAgent) {
        return reply.status(404).send({ error: 'Agent non trouvé' });
      }

      // Mettre à jour la configuration
      const updatedAgent = await prisma.agent.update({
        where: { id },
        data: {
          config: (config || {}) as Prisma.InputJsonObject,
          updatedAt: new Date()
        }
      });

      await prisma.$disconnect();

      fastify.log.info(`✅ Configuration agent mise à jour: ${id}`);

      return {
        success: true,
        data: {
          id: updatedAgent.id,
          config: updatedAgent.config,
          updatedAt: updatedAgent.updatedAt.toISOString()
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Update agent config error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ error: error.message });
      }
      
      return reply.status(500).send({
        error: 'Erreur lors de la mise à jour de la configuration',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : LIER UN AGENT À DES DOCUMENTS DE BASE DE CONNAISSANCE (POST /api/v1/agents/:id/knowledge)
  fastify.post<{ Params: AgentParamsType; Body: AgentKnowledgeBody }>('/:id/knowledge', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);
      const { knowledgeBaseIds } = request.body;

      if (!shop) {
        return reply.status(404).send({ error: 'Shop non trouvé' });
      }

      await prisma.$connect();

      // Vérifier que l'agent appartient au shop
      const existingAgent = await prisma.agent.findFirst({
        where: { 
          id,
          shopId: shop.id 
        }
      });

      if (!existingAgent) {
        return reply.status(404).send({ error: 'Agent non trouvé' });
      }

      // Supprimer les liaisons existantes
      await prisma.agentKnowledgeBase.deleteMany({
        where: { agentId: id }
      });

      // Créer les nouvelles liaisons
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

      fastify.log.info(`✅ Base de connaissance liée à l'agent: ${id}`);

      return {
        success: true,
        message: 'Base de connaissance mise à jour avec succès'
      };

    } catch (error: any) {
      fastify.log.error('❌ Link agent knowledge error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ error: error.message });
      }
      
      return reply.status(500).send({
        error: 'Erreur lors de la liaison de la base de connaissance',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : MODIFIER UN AGENT (PUT /api/agents/:id)
  fastify.put<{ Params: AgentParamsType }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);
      const body = updateAgentSchema.parse(request.body);

      if (!shop) {
        return reply.status(404).send({ error: 'Shop non trouvé' });
      }

      await prisma.$connect();

      // Vérifier que l'agent appartient au shop
      const existingAgent = await prisma.agent.findFirst({
        where: { 
          id,
          shopId: shop.id 
        }
      });

      if (!existingAgent) {
        return reply.status(404).send({ error: 'Agent non trouvé' });
      }

      // Mettre à jour l'agent
      const updatedAgent = await prisma.agent.update({
        where: { id },
        data: {
          ...(body.name && { name: body.name }),
          ...(body.type && { type: body.type as AgentType }),
          ...(body.personality && { personality: body.personality as AgentPersonality }),
          ...(body.description !== undefined && { description: body.description }),
          ...(body.welcomeMessage !== undefined && { welcomeMessage: body.welcomeMessage }),
          ...(body.fallbackMessage !== undefined && { fallbackMessage: body.fallbackMessage }),
          ...(body.avatar !== undefined && { avatar: body.avatar }),
          ...(body.isActive !== undefined && { isActive: body.isActive }),
          ...(body.config !== undefined && { config: body.config as Prisma.InputJsonObject })
        }
      });

      await prisma.$disconnect();

      fastify.log.info(`✅ Agent modifié avec succès: ${updatedAgent.id}`);

      return {
        success: true,
        data: {
          id: updatedAgent.id,
          name: updatedAgent.name,
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
      fastify.log.error('❌ Update agent error:', error);
      
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          error: 'Données invalides',
          details: error.errors
        });
      }
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ error: error.message });
      }
      
      return reply.status(500).send({
        error: 'Erreur lors de la modification de l\'agent',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : SUPPRIMER UN AGENT (DELETE /api/agents/:id)
  fastify.delete<{ Params: AgentParamsType }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);

      if (!shop) {
        return reply.status(404).send({ error: 'Shop non trouvé' });
      }

      await prisma.$connect();

      // Vérifier que l'agent appartient au shop
      const existingAgent = await prisma.agent.findFirst({
        where: { 
          id,
          shopId: shop.id 
        }
      });

      if (!existingAgent) {
        return reply.status(404).send({ error: 'Agent non trouvé' });
      }

      // Supprimer l'agent (cascade supprimera automatiquement les liaisons)
      await prisma.agent.delete({
        where: { id }
      });

      await prisma.$disconnect();

      fastify.log.info(`✅ Agent supprimé avec succès: ${id}`);

      return { success: true, message: 'Agent supprimé avec succès' };

    } catch (error: any) {
      fastify.log.error('❌ Delete agent error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ error: error.message });
      }
      
      return reply.status(500).send({
        error: 'Erreur lors de la suppression de l\'agent',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : ACTIVER/DÉSACTIVER UN AGENT (PATCH /api/agents/:id/toggle)
  fastify.patch<{ Params: AgentParamsType }>('/:id/toggle', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);
      const body = toggleAgentSchema.parse(request.body);

      if (!shop) {
        return reply.status(404).send({ error: 'Shop non trouvé' });
      }

      await prisma.$connect();

      // Vérifier que l'agent appartient au shop
      const existingAgent = await prisma.agent.findFirst({
        where: { 
          id,
          shopId: shop.id 
        }
      });

      if (!existingAgent) {
        return reply.status(404).send({ error: 'Agent non trouvé' });
      }

      // Mettre à jour le statut
      const updatedAgent = await prisma.agent.update({
        where: { id },
        data: { isActive: body.isActive }
      });

      await prisma.$disconnect();

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
      fastify.log.error('❌ Toggle agent error:', error);
      
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          error: 'Données invalides',
          details: error.errors
        });
      }
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ error: error.message });
      }
      
      return reply.status(500).send({
        error: 'Erreur lors de la modification du statut',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ ROUTE : DUPLIQUER UN AGENT (POST /api/agents/:id/duplicate)
  fastify.post<{ Params: AgentParamsType }>('/:id/duplicate', async (request, reply) => {
    try {
      const { id } = request.params;
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);

      if (!shop) {
        return reply.status(404).send({ error: 'Shop non trouvé' });
      }

      await prisma.$connect();

      // Vérifier les limites du plan
      const currentAgentsCount = await prisma.agent.count({
        where: { shopId: shop.id }
      });

      const canCreate = await checkPlanLimits(shop.id, currentAgentsCount, shop.subscription_plan || 'free');
      
      if (!canCreate) {
        const limit = PLAN_LIMITS[shop.subscription_plan as keyof typeof PLAN_LIMITS]?.agents || 1;
        return reply.status(403).send({ 
          error: `Plan ${shop.subscription_plan} limité à ${limit} agent(s).`,
          planLimit: limit,
          currentCount: currentAgentsCount
        });
      }

      // Récupérer l'agent à dupliquer
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
        return reply.status(404).send({ error: 'Agent non trouvé' });
      }

      // Créer la copie
      const duplicatedAgent = await prisma.agent.create({
        data: {
          shopId: shop.id,
          name: `${originalAgent.name} (Copie)`,
          type: originalAgent.type,
          personality: originalAgent.personality,
          description: originalAgent.description,
          welcomeMessage: originalAgent.welcomeMessage,
          fallbackMessage: originalAgent.fallbackMessage,
          avatar: originalAgent.avatar,
          isActive: false, // Désactivé par défaut
          config: (originalAgent.config || {}) as Prisma.InputJsonObject
        }
      });

      // Dupliquer les liaisons de base de connaissances
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

      fastify.log.info(`✅ Agent dupliqué avec succès: ${duplicatedAgent.id}`);

      return {
        success: true,
        data: {
          id: duplicatedAgent.id,
          name: duplicatedAgent.name,
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
      fastify.log.error('❌ Duplicate agent error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ error: error.message });
      }
      
      return reply.status(500).send({
        error: 'Erreur lors de la duplication de l\'agent',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });
}
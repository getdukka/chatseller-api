// src/routes/billing.ts - VERSION STRIPE CORRIGÉE
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

// ✅ CRÉER UNE INSTANCE PRISMA AVEC GESTION D'ERREURS
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

/// ✅ VERSION STRIPE CORRIGÉE
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-06-30.basil'
});

// ✅ CONFIGURATION DES PLANS
const STRIPE_PLANS = {
  starter: {
    name: 'Starter',
    price: 0,
    stripePriceId: null,
    features: ['3 jours gratuit', '1 agent IA', '10 documents'],
    limits: { conversations: 100, agents: 1, documents: 10 }
  },
  professional: {
    name: 'Professional', 
    price: 1400, // 14€ en centimes
    stripePriceId: process.env.STRIPE_PRICE_ID_PRO!,
    features: ['Conversations illimitées', '3 agents IA', 'Base illimitée'],
    limits: { conversations: -1, agents: 3, documents: -1 }
  },
  enterprise: {
    name: 'Enterprise',
    price: 0,
    stripePriceId: null,
    features: ['Tout du Pro', 'Agents illimités', 'White-label'],
    limits: { conversations: -1, agents: -1, documents: -1 }
  }
};

// ✅ SCHÉMAS DE VALIDATION
const createSubscriptionSchema = z.object({
  plan: z.enum(['professional']),
  successUrl: z.string().url(),
  cancelUrl: z.string().url()
});

// ✅ HELPER: Vérifier l'auth Supabase
async function verifySupabaseAuth(request: any) {
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

// ✅ NOUVELLE FONCTION: Créer ou récupérer un shop AVEC DIAGNOSTIC
async function getOrCreateShop(user: any, fastify: FastifyInstance) {
  fastify.log.info(`🔍 Recherche du shop pour l'utilisateur: ${user.id} (${user.email})`);
  
  try {
    // ✅ DIAGNOSTIC COMPLET
    fastify.log.info('🔗 === DIAGNOSTIC PRISMA CONNECTION ===');
    fastify.log.info('📋 Variables d\'environnement:');
    fastify.log.info(`DATABASE_URL présent: ${process.env.DATABASE_URL ? 'OUI' : 'NON'}`);
    fastify.log.info(`DATABASE_URL: ${process.env.DATABASE_URL?.substring(0, 50)}...`);
    
    // ✅ TEST CONNEXION DE BASE
    fastify.log.info('🔌 Test connexion basique...');
    await prisma.$connect();
    fastify.log.info('✅ Connexion Prisma OK');
    
    // ✅ TEST REQUÊTE SIMPLE
    fastify.log.info('🧪 Test requête simple...');
    const testQuery = await prisma.$queryRaw`SELECT 1 as test`;
    fastify.log.info('✅ Requête test OK:', testQuery);
    
    // 1. Chercher d'abord par ID utilisateur
    fastify.log.info('🔍 Recherche shop par ID...');
    let shop = await prisma.shop.findUnique({
      where: { id: user.id }
    });

    if (shop) {
      fastify.log.info(`✅ Shop trouvé par ID: ${shop.id}`);
      return shop;
    }

    // 2. Chercher par email
    fastify.log.info('🔍 Recherche shop par email...');
    shop = await prisma.shop.findUnique({
      where: { email: user.email }
    });

    if (shop) {
      fastify.log.info(`✅ Shop trouvé par email: ${shop.id}`);
      return shop;
    }

    // 3. Créer automatiquement le shop si il n'existe pas
    fastify.log.info(`🏗️ Création automatique du shop pour: ${user.email}`);
    
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

    fastify.log.info(`✅ Shop créé avec succès: ${newShop.id}`);
    return newShop;

  } catch (error: any) {
    fastify.log.error('❌ ERREUR GLOBALE dans getOrCreateShop:', error);
    fastify.log.error('📋 Type d\'erreur:', error.constructor.name);
    fastify.log.error('📋 Message:', error.message);
    fastify.log.error('📋 Code:', error.code);
    
    // ✅ DIAGNOSTIC SPÉCIFIQUE PRISMA
    if (error.code === 'P1001') {
      fastify.log.error('🔌 Erreur de connexion à la base de données');
    }
    if (error.code === 'P1008') {
      fastify.log.error('⏰ Timeout de connexion');
    }
    
    throw new Error(`Impossible de créer ou récupérer le shop: ${error.message}`);
  } finally {
    // ✅ FERMER LA CONNEXION PROPREMENT
    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      fastify.log.warn('⚠️ Erreur lors de la déconnexion Prisma:', disconnectError);
    }
  }
}

export default async function billingRoutes(fastify: FastifyInstance) {
  
  // ✅ ROUTE DE DIAGNOSTIC
  fastify.get('/diagnostic', async (request, reply) => {
    try {
      fastify.log.info('🧪 === DIAGNOSTIC COMPLET ===');
      
      // Test variables d'environnement
      const envCheck = {
        DATABASE_URL: !!process.env.DATABASE_URL,
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
        STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
        STRIPE_PRICE_ID_PRO: !!process.env.STRIPE_PRICE_ID_PRO
      };
      
      // Test connexion Prisma
      let prismaTest: { success: boolean; error: string | null } = { success: false, error: null };
      try {
        await prisma.$connect();
        await prisma.$queryRaw`SELECT 1 as test`;
        prismaTest.success = true;
        await prisma.$disconnect();
      } catch (error: any) {
        prismaTest.error = error.message;
      }
      
      // Test Supabase
      let supabaseTest: { success: boolean; error: string | null } = { success: false, error: null };
      try {
        const { data, error } = await supabase.auth.admin.listUsers();
        supabaseTest.success = !error;
        if (error) supabaseTest.error = error.message;
      } catch (error: any) {
        supabaseTest.error = error.message;
      }
      
      // ✅ TEST STRIPE
      let stripeTest: { success: boolean; error: string | null } = { success: false, error: null };
      try {
        // Test simple : récupérer les prix
        const prices = await stripe.prices.list({ limit: 1 });
        stripeTest.success = true;
      } catch (error: any) {
        stripeTest.error = error.message;
      }
      
      return {
        success: true,
        diagnostic: {
          environment: envCheck,
          prisma: prismaTest,
          supabase: supabaseTest,
          stripe: stripeTest,
          timestamp: new Date().toISOString()
        }
      };
      
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        diagnostic: { success: false, error: 'Diagnostic général échoue' }
      };
    }
  });
  
  // ✅ ROUTE : OBTENIR LES PLANS DISPONIBLES (PUBLIC)
  fastify.get('/plans', async (request, reply) => {
    try {
      const plans = Object.entries(STRIPE_PLANS).map(([key, plan]) => ({
        id: key,
        name: plan.name,
        price: plan.price,
        priceFormatted: plan.price === 0 ? 'Gratuit' : `${plan.price / 100}€`,
        features: plan.features,
        limits: plan.limits
      }));

      return { success: true, plans };
    } catch (error) {
      fastify.log.error('Get plans error:', error);
      return reply.status(500).send({ error: 'Erreur lors de la récupération des plans' });
    }
  });

  // ✅ ROUTE : CRÉER UNE SESSION DE CHECKOUT STRIPE (CORRIGÉE AVEC LOGS DÉTAILLÉS)
  fastify.post('/create-checkout-session', async (request, reply) => {
    try {
      fastify.log.info('🚀 Début création session checkout');
      
      const body = createSubscriptionSchema.parse(request.body);
      const user = await verifySupabaseAuth(request);
      
      fastify.log.info(`👤 Utilisateur authentifié: ${user.id} (${user.email})`);
      
      // ✅ UTILISER LA NOUVELLE FONCTION CORRIGÉE
      const shop = await getOrCreateShop(user, fastify);

      if (!shop) {
        fastify.log.error('❌ Impossible de créer ou récupérer le shop');
        return reply.status(500).send({ error: 'Erreur lors de la récupération du shop' });
      }

      // ✅ VÉRIFIER SI DÉJÀ ABONNÉ
      if (shop.subscription_plan === 'professional') {
        fastify.log.info(`ℹ️ Utilisateur déjà abonné au plan: ${shop.subscription_plan}`);
        return reply.status(400).send({ error: 'Vous avez déjà un abonnement actif' });
      }

      const plan = STRIPE_PLANS[body.plan];
      if (!plan.stripePriceId) {
        fastify.log.error(`❌ Plan non disponible pour l'achat: ${body.plan}`);
        return reply.status(400).send({ error: 'Plan non disponible pour l\'achat' });
      }

      fastify.log.info(`💳 Création session Stripe pour le plan: ${body.plan} (${plan.stripePriceId})`);

      // ✅ CRÉER OU RÉCUPÉRER LE CUSTOMER STRIPE AVEC LOGS DÉTAILLÉS
      let customer;
      
      try {
        fastify.log.info(`🔍 Recherche customer Stripe existant pour: ${shop.email}`);
        
        // Chercher si le customer existe déjà
        const existingCustomers = await stripe.customers.list({
          email: shop.email,
          limit: 1
        });

        if (existingCustomers.data.length > 0) {
          customer = existingCustomers.data[0];
          fastify.log.info(`✅ Customer Stripe existant trouvé: ${customer.id}`);
        } else {
          fastify.log.info(`🏗️ Création nouveau customer Stripe pour: ${shop.email}`);
          customer = await stripe.customers.create({
            email: shop.email,
            name: shop.name,
            metadata: {
              userId: shop.id,
              shopName: shop.name
            }
          });
          fastify.log.info(`✅ Nouveau customer Stripe créé: ${customer.id}`);
        }
      } catch (stripeCustomerError: any) {
        fastify.log.error('❌ Erreur customer Stripe:', stripeCustomerError);
        throw stripeCustomerError;
      }

      // ✅ VÉRIFIER LE PRICE ID AVANT CRÉATION
      try {
        fastify.log.info(`🧪 Vérification du Price ID: ${plan.stripePriceId}`);
        const priceCheck = await stripe.prices.retrieve(plan.stripePriceId);
        fastify.log.info(`✅ Price ID valide: ${priceCheck.id} - ${priceCheck.unit_amount} ${priceCheck.currency}`);
      } catch (priceError: any) {
        fastify.log.error('❌ Price ID invalide:', priceError);
        return reply.status(500).send({ error: 'Price ID Stripe invalide' });
      }

      // ✅ CRÉER LA SESSION DE CHECKOUT AVEC LOGS DÉTAILLÉS
      try {
        fastify.log.info('🏗️ Création session checkout Stripe...');
        fastify.log.info(`📋 Paramètres session:`, {
          customer: customer.id,
          priceId: plan.stripePriceId,
          successUrl: body.successUrl,
          cancelUrl: body.cancelUrl,
          userId: shop.id,
          plan: body.plan
        });

        const session = await stripe.checkout.sessions.create({
          customer: customer.id,
          payment_method_types: ['card'],
          line_items: [
            {
              price: plan.stripePriceId,
              quantity: 1,
            },
          ],
          mode: 'subscription',
          success_url: body.successUrl,
          cancel_url: body.cancelUrl,
          metadata: {
            userId: shop.id,
            plan: body.plan,
            shopEmail: shop.email
          },
          subscription_data: {
            metadata: {
              userId: shop.id,
              plan: body.plan,
              shopEmail: shop.email
            }
          }
        });

        fastify.log.info(`✅ Session checkout créée avec succès: ${session.id}`);
        fastify.log.info(`🔗 URL de redirection: ${session.url}`);

        return { 
          success: true, 
          checkoutUrl: session.url,
          sessionId: session.id 
        };

      } catch (sessionError: any) {
        fastify.log.error('❌ Erreur création session checkout:');
        fastify.log.error('📋 Type:', sessionError.constructor.name);
        fastify.log.error('📋 Message:', sessionError.message);
        fastify.log.error('📋 Code:', sessionError.code);
        fastify.log.error('📋 Type Stripe:', sessionError.type);
        fastify.log.error('📋 Détails complets:', JSON.stringify(sessionError, null, 2));
        
        throw sessionError;
      }

    } catch (error: any) {
      fastify.log.error('❌ Create checkout session error GLOBAL:', error);
      
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
        error: 'Erreur lors de la création de la session de paiement',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        stripeError: error.type || undefined
      });
    }
  });

  // ✅ ROUTE : OBTENIR LE STATUT DE L'ABONNEMENT (CORRIGÉE)
  fastify.get('/subscription-status', async (request, reply) => {
    try {
      fastify.log.info('🔍 Récupération statut abonnement');
      
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);

      if (!shop) {
        fastify.log.error('❌ Shop non trouvé pour le statut');
        return reply.status(404).send({ error: 'Shop non trouvé' });
      }

      fastify.log.info(`✅ Statut récupéré - Plan: ${shop.subscription_plan}, Actif: ${shop.is_active}`);

      return {
        success: true,
        subscription: {
          plan: shop.subscription_plan,
          status: shop.is_active ? 'active' : 'inactive',
          isActive: shop.is_active,
          shopId: shop.id,
          shopName: shop.name
        }
      };

    } catch (error: any) {
      fastify.log.error('❌ Get subscription status error:', error);
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ error: error.message });
      }
      
      return reply.status(500).send({ 
        error: 'Erreur lors de la récupération du statut',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // ✅ WEBHOOK STRIPE (CORRIGÉ)
  fastify.post('/webhook', async (request, reply) => {
    try {
      const signature = request.headers['stripe-signature'] as string;
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

      let event: Stripe.Event;

      try {
        event = stripe.webhooks.constructEvent(
          request.body as string,
          signature,
          webhookSecret
        );
      } catch (err: any) {
        fastify.log.error('❌ Webhook signature verification failed:', err.message);
        return reply.status(400).send({ error: 'Webhook signature verification failed' });
      }

      fastify.log.info(`📧 Stripe webhook reçu: ${event.type}`);

      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, fastify);
          break;

        case 'customer.subscription.deleted':
          await handleSubscriptionCanceled(event.data.object as Stripe.Subscription, fastify);
          break;

        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, fastify);
          break;

        default:
          fastify.log.info(`ℹ️ Unhandled event type: ${event.type}`);
      }

      return { received: true };

    } catch (error) {
      fastify.log.error('❌ Webhook processing error:', error);
      return reply.status(500).send({ error: 'Erreur lors du traitement du webhook' });
    }
  });

  // ✅ FONCTIONS WEBHOOK CORRIGÉES
  async function handleCheckoutCompleted(session: Stripe.Checkout.Session, fastify: FastifyInstance) {
    const userId = session.metadata?.userId;
    const plan = session.metadata?.plan;

    if (!userId || !plan) {
      fastify.log.error('❌ Missing metadata in checkout session:', { userId, plan });
      return;
    }

    try {
      await prisma.$connect();
      await prisma.shop.update({
        where: { id: userId },
        data: {
          subscription_plan: plan,
          is_active: true,
          updatedAt: new Date()
        }
      });
      await prisma.$disconnect();

      fastify.log.info(`✅ Subscription activated for user ${userId}, plan: ${plan}`);
    } catch (error) {
      fastify.log.error('❌ Error updating shop subscription:', error);
    }
  }

  async function handleSubscriptionCanceled(subscription: Stripe.Subscription, fastify: FastifyInstance) {
    const userId = subscription.metadata?.userId;

    if (!userId) {
      fastify.log.error('❌ Missing userId in subscription metadata');
      return;
    }

    try {
      await prisma.$connect();
      await prisma.shop.update({
        where: { id: userId },
        data: {
          subscription_plan: 'free',
          is_active: false,
          updatedAt: new Date()
        }
      });
      await prisma.$disconnect();

      fastify.log.info(`✅ Subscription canceled for user ${userId}`);
    } catch (error) {
      fastify.log.error('❌ Error canceling shop subscription:', error);
    }
  }

  async function handleSubscriptionUpdated(subscription: Stripe.Subscription, fastify: FastifyInstance) {
    const userId = subscription.metadata?.userId;

    if (!userId) {
      fastify.log.error('❌ Missing userId in subscription metadata');
      return;
    }

    try {
      const isActive = subscription.status === 'active';
      
      await prisma.$connect();
      await prisma.shop.update({
        where: { id: userId },
        data: {
          is_active: isActive,
          updatedAt: new Date()
        }
      });
      await prisma.$disconnect();

      fastify.log.info(`✅ Subscription updated for user ${userId}, status: ${subscription.status}`);
    } catch (error) {
      fastify.log.error('❌ Error updating shop subscription:', error);
    }
  }
}
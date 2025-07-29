// src/routes/billing.ts - VERSION STRIPE CORRIGÉE ✅
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

// ✅ VERSION STRIPE CORRIGÉE
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-06-30.basil'
});

// ✅ CONFIGURATION DES PLANS CORRIGÉE - MAPPING SIMPLIFIÉ
const STRIPE_PLANS = {
  free: {
    name: 'Free Trial',
    price: 0,
    stripePriceId: null,
    features: ['7 jours gratuit', '1 agent IA', 'Conversations illimitées'],
    limits: { conversations: -1, agents: 1, documents: 50 }
  },
  starter: {
    name: 'Starter', 
    price: 1400, // 14€ en centimes
    stripePriceId: process.env.STRIPE_PRICE_ID_STARTER!, // ✅ Nouvelle variable env
    features: ['1 Vendeur IA spécialisé', '1000 conversations/mois', '50 documents max'],
    limits: { conversations: 1000, agents: 1, documents: 50 }
  },
  pro: {
    name: 'Pro',
    price: 2900, // 29€ en centimes  
    stripePriceId: process.env.STRIPE_PRICE_ID_PRO!,
    features: ['3 Vendeurs IA', 'Conversations illimitées', 'Base illimitée'],
    limits: { conversations: -1, agents: 3, documents: -1 }
  }
};

// ✅ SCHÉMAS DE VALIDATION CORRIGÉS
const createSubscriptionSchema = z.object({
  plan: z.enum(['starter', 'pro']), // ✅ Plus de mapping complexe
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
    // ✅ TEST CONNEXION DE BASE
    await prisma.$connect();
    fastify.log.info('✅ Connexion Prisma OK');
    
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
  
  // ✅ ROUTE DE DIAGNOSTIC AMÉLIORÉE
  fastify.get('/diagnostic', async (request, reply) => {
    try {
      fastify.log.info('🧪 === DIAGNOSTIC COMPLET ===');
      
      // Test variables d'environnement
      const envCheck = {
        DATABASE_URL: !!process.env.DATABASE_URL,
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
        STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_'),
        STRIPE_PRICE_ID_STARTER: !!process.env.STRIPE_PRICE_ID_STARTER && process.env.STRIPE_PRICE_ID_STARTER.startsWith('price_'), // ✅ NOUVEAU
        STRIPE_PRICE_ID_PRO: !!process.env.STRIPE_PRICE_ID_PRO && process.env.STRIPE_PRICE_ID_PRO.startsWith('price_'),
        STRIPE_WEBHOOK_SECRET: !!process.env.STRIPE_WEBHOOK_SECRET
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
      
      // ✅ TEST STRIPE AMÉLIORÉ AVEC LES DEUX PRICE IDS
      let stripeTest: { success: boolean; error: string | null; priceValidation?: any } = { success: false, error: null };
      try {
        // Test 1: Connexion de base
        const prices = await stripe.prices.list({ limit: 1 });
        
        // Test 2: Validation des Price IDs spécifiques
        const priceValidations: any = {};
        
        if (process.env.STRIPE_PRICE_ID_STARTER) {
          try {
            const starterPrice = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID_STARTER);
            priceValidations.starter = {
              id: starterPrice.id,
              amount: starterPrice.unit_amount,
              currency: starterPrice.currency,
              active: starterPrice.active
            };
          } catch (priceError: any) {
            priceValidations.starter = { error: priceError.message };
          }
        }

        if (process.env.STRIPE_PRICE_ID_PRO) {
          try {
            const proPrice = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID_PRO);
            priceValidations.pro = {
              id: proPrice.id,
              amount: proPrice.unit_amount,
              currency: proPrice.currency,
              active: proPrice.active
            };
          } catch (priceError: any) {
            priceValidations.pro = { error: priceError.message };
          }
        }
        
        stripeTest.priceValidation = priceValidations;
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
          timestamp: new Date().toISOString(),
          plansConfig: STRIPE_PLANS
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

  // ✅ ROUTE : CRÉER UNE SESSION DE CHECKOUT STRIPE (VERSION COMPLÈTEMENT CORRIGÉE)
  fastify.post('/create-checkout-session', async (request, reply) => {
    try {
      fastify.log.info('🚀 === DÉBUT CRÉATION SESSION CHECKOUT ===');
      
      // Validation des données d'entrée
      const body = createSubscriptionSchema.parse(request.body);
      fastify.log.info(`📝 Données validées: plan=${body.plan}`);
      
      // Authentification utilisateur
      const user = await verifySupabaseAuth(request);
      fastify.log.info(`👤 Utilisateur authentifié: ${user.id} (${user.email})`);
      
      // Récupération/création du shop
      const shop = await getOrCreateShop(user, fastify);
      if (!shop) {
        throw new Error('Impossible de créer ou récupérer le shop');
      }

      // ✅ VÉRIFICATION SI DÉJÀ ABONNÉ - MAPPING SIMPLIFIÉ
      if (shop.subscription_plan === body.plan || 
          (shop.subscription_plan === 'pro' && body.plan === 'starter')) {
        fastify.log.warn(`⚠️ Utilisateur déjà abonné: ${shop.subscription_plan}`);
        return reply.status(400).send({ 
          error: 'Vous avez déjà un abonnement actif ou supérieur',
          currentPlan: shop.subscription_plan 
        });
      }

      // Récupération du plan
      const plan = STRIPE_PLANS[body.plan as keyof typeof STRIPE_PLANS];
      if (!plan.stripePriceId) {
        fastify.log.error(`❌ Plan non disponible: ${body.plan}`);
        return reply.status(400).send({ error: 'Plan non disponible pour l\'achat' });
      }

      fastify.log.info(`📋 Plan sélectionné: ${plan.name} - Prix: ${plan.price/100}€ - Price ID: ${plan.stripePriceId}`);

      // ✅ VALIDATION PRÉALABLE DU PRICE ID
      try {
        fastify.log.info(`🧪 Validation Price ID: ${plan.stripePriceId}`);
        const priceValidation = await stripe.prices.retrieve(plan.stripePriceId);
        
        if (!priceValidation.active) {
          throw new Error(`Price ID inactif: ${plan.stripePriceId}`);
        }
        
        fastify.log.info(`✅ Price ID valide: ${priceValidation.id} - ${priceValidation.unit_amount}${priceValidation.currency}`);
      } catch (priceError: any) {
        fastify.log.error('❌ Erreur validation Price ID:', priceError.message);
        return reply.status(500).send({ 
          error: 'Prix Stripe invalide',
          details: priceError.message,
          priceId: plan.stripePriceId
        });
      }

      // ✅ CRÉATION/RÉCUPÉRATION CUSTOMER STRIPE
      let customer;
      try {
        fastify.log.info(`🔍 Recherche customer Stripe: ${shop.email}`);
        
        const existingCustomers = await stripe.customers.list({
          email: shop.email,
          limit: 1
        });

        if (existingCustomers.data.length > 0) {
          customer = existingCustomers.data[0];
          fastify.log.info(`✅ Customer existant: ${customer.id}`);
        } else {
          fastify.log.info(`🏗️ Création nouveau customer`);
          customer = await stripe.customers.create({
            email: shop.email,
            name: shop.name,
            metadata: {
              userId: shop.id,
              shopName: shop.name
            }
          });
          fastify.log.info(`✅ Customer créé: ${customer.id}`);
        }
      } catch (customerError: any) {
        fastify.log.error('❌ Erreur customer Stripe:', customerError);
        throw new Error(`Erreur customer: ${customerError.message}`);
      }

      // ✅ CRÉATION SESSION CHECKOUT AVEC GESTION D'ERREURS DÉTAILLÉE
      try {
        fastify.log.info('🏗️ Création session checkout...');

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
            plan: body.plan, // ✅ Garder le plan frontend
            shopEmail: shop.email
          },
          subscription_data: {
            metadata: {
              userId: shop.id,
              plan: body.plan, // ✅ Garder le plan frontend
              shopEmail: shop.email
            }
          }
        });

        fastify.log.info(`✅ Session créée avec succès: ${session.id}`);
        fastify.log.info(`🔗 URL checkout: ${session.url}`);

        return { 
          success: true, 
          checkoutUrl: session.url,
          sessionId: session.id,
          message: 'Session de paiement créée avec succès'
        };

      } catch (sessionError: any) {
        fastify.log.error('❌ ERREUR CRÉATION SESSION:');
        fastify.log.error(`📋 Type: ${sessionError.constructor.name}`);
        fastify.log.error(`📋 Message: ${sessionError.message}`);
        fastify.log.error(`📋 Code: ${sessionError.code}`);
        fastify.log.error(`📋 Type Stripe: ${sessionError.type}`);
        
        // ✅ GESTION SPÉCIFIQUE DES ERREURS STRIPE
        if (sessionError.type === 'StripeInvalidRequestError') {
          return reply.status(400).send({
            error: 'Requête Stripe invalide',
            details: sessionError.message,
            stripeCode: sessionError.code
          });
        }
        
        throw new Error(`Session checkout: ${sessionError.message}`);
      }

    } catch (error: any) {
      fastify.log.error('❌ ERREUR GLOBALE CHECKOUT:', error);
      
      // ✅ GESTION GRANULAIRE DES ERREURS
      if (error.name === 'ZodError') {
        return reply.status(400).send({
          error: 'Données de requête invalides',
          details: error.errors
        });
      }
      
      if (error.message === 'Token manquant' || error.message === 'Token invalide') {
        return reply.status(401).send({ error: 'Authentification requise' });
      }
      
      return reply.status(500).send({
        error: 'Erreur lors de la création de la session de paiement',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Erreur interne du serveur',
        timestamp: new Date().toISOString()
      });
    }
  });

  // ✅ ROUTE : OBTENIR LE STATUT DE L'ABONNEMENT
  fastify.get('/subscription-status', async (request, reply) => {
    try {
      fastify.log.info('🔍 Récupération statut abonnement');
      
      const user = await verifySupabaseAuth(request);
      const shop = await getOrCreateShop(user, fastify);

      if (!shop) {
        return reply.status(404).send({ error: 'Shop non trouvé' });
      }

      // ✅ CALCUL JOURS D'ESSAI POUR PLAN FREE
      let trialDaysLeft = 0;
      if (shop.subscription_plan === 'free') {
        const creationDate = new Date(shop.createdAt || Date.now());
        const daysSinceCreation = Math.floor((Date.now() - creationDate.getTime()) / (1000 * 60 * 60 * 24));
        trialDaysLeft = Math.max(0, 7 - daysSinceCreation);
      }

      return {
        success: true,
        subscription: {
          plan: shop.subscription_plan,
          status: shop.is_active ? 'active' : 'inactive',
          isActive: shop.is_active,
          trialDaysLeft: trialDaysLeft,
          trialEndDate: shop.subscription_plan === 'free' 
            ? new Date(new Date(shop.createdAt || Date.now()).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
            : null,
          nextBillingDate: shop.subscription_plan !== 'free' 
            ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            : null,
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

  // ✅ WEBHOOK STRIPE (INCHANGÉ MAIS AVEC MEILLEURS LOGS)
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

      fastify.log.info(`📧 Stripe webhook reçu: ${event.type} - ID: ${event.id}`);

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

  // ✅ ROUTE DE DIAGNOSTIC POUR DEBUG
  fastify.get('/debug-shop/:userId', async (request, reply) => {
    try {
      const { userId } = request.params as { userId: string }
      
      await prisma.$connect()
      const shop = await prisma.shop.findUnique({
        where: { id: userId }
      })
      await prisma.$disconnect()
      
      if (!shop) {
        return reply.status(404).send({ error: 'Shop not found' })
      }
      
      return {
        success: true,
        shop: {
          id: shop.id,
          email: shop.email,
          plan: shop.subscription_plan,
          isActive: shop.is_active,
          createdAt: shop.createdAt,
          updatedAt: shop.updatedAt
        }
      }
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  })

  // ✅ FONCTIONS WEBHOOK AVEC MEILLEURS LOGS
  async function handleCheckoutCompleted(session: Stripe.Checkout.Session, fastify: FastifyInstance) {
  const userId = session.metadata?.userId;
  const plan = session.metadata?.plan;

  fastify.log.info(`🎉 === CHECKOUT COMPLETED ===`);
  fastify.log.info(`👤 UserId: ${userId}`);
  fastify.log.info(`📋 Plan: ${plan}`);
  fastify.log.info(`📧 Session ID: ${session.id}`);
  fastify.log.info(`💰 Amount: ${session.amount_total}`);

  if (!userId || !plan) {
    fastify.log.error('❌ Metadata manquante:', { userId, plan, allMetadata: session.metadata });
    return;
  }

  try {
    await prisma.$connect();
    
    // ✅ VÉRIFIER D'ABORD SI LE SHOP EXISTE
    const existingShop = await prisma.shop.findUnique({
      where: { id: userId }
    });

    if (!existingShop) {
      fastify.log.error(`❌ Shop introuvable pour userId: ${userId}`);
      return;
    }

    fastify.log.info(`🏪 Shop trouvé: ${existingShop.name} (${existingShop.email})`);
    fastify.log.info(`📋 Plan actuel: ${existingShop.subscription_plan} -> ${plan}`);

    // ✅ MISE À JOUR DU SHOP
    const updatedShop = await prisma.shop.update({
      where: { id: userId },
      data: {
        subscription_plan: plan as string,
        is_active: true,
        updatedAt: new Date()
      }
    });

    fastify.log.info(`✅ Shop mis à jour avec succès:`);
    fastify.log.info(`   - Plan: ${updatedShop.subscription_plan}`);
    fastify.log.info(`   - Actif: ${updatedShop.is_active}`);
    fastify.log.info(`   - Mis à jour: ${updatedShop.updatedAt}`);

  } catch (error: any) {
    fastify.log.error('❌ ERREUR mise à jour shop:', error);
    fastify.log.error('   - Message:', error.message);
    fastify.log.error('   - Code:', error.code);
  } finally {
    await prisma.$disconnect();
  }
}

  async function handleSubscriptionCanceled(subscription: Stripe.Subscription, fastify: FastifyInstance) {
    const userId = subscription.metadata?.userId;

    fastify.log.info(`🚫 Subscription canceled: userId=${userId}`);

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

    fastify.log.info(`🔄 Subscription updated: userId=${userId}, status=${subscription.status}`);

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
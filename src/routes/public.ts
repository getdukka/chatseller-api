// src/routes/public.ts - VERSION COMPLÈTE CORRIGÉE ✅ AVEC TITRE PERSISTANT PARTOUT
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import OpenAI from 'openai';
import { supabaseServiceClient } from '../lib/supabase';
import { randomUUID } from 'crypto';

// ✅ INITIALISATION OPENAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️ OPENAI_API_KEY manquante - mode dégradé activé');
}

// ✅ INTERFACES TYPESCRIPT COMPLÈTES
interface ShopParamsType {
  shopId: string;
}

interface ChatRequestBody {
  shopId: string;
  message: string;
  conversationId?: string;
  productInfo?: {
    id?: string;
    name?: string;
    price?: number;
    url?: string;
  };
  visitorId?: string;
  isFirstMessage?: boolean;
}

interface OrderCollectionState {
  step: 'quantity' | 'phone' | 'name' | 'address' | 'payment' | 'confirmation' | 'completed';
  data: {
    productId?: string | null;
    productName?: string | null;
    productPrice?: number | null;
    quantity?: number | null;
    customerPhone?: string | null;
    customerFirstName?: string | null;
    customerLastName?: string | null;
    customerEmail?: string | null;
    customerAddress?: string | null;
    paymentMethod?: string | null;
  };
}

interface OpenAIResult {
  success: boolean;
  message?: string;
  tokensUsed?: number;
  error?: string;
  fallbackMessage?: string;
  orderCollection?: OrderCollectionState;
  isOrderIntent?: boolean;
}

// ✅ HELPER : Vérifier UUID
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// ✅ NOUVELLE FONCTION : Titre par défaut selon le type AVEC FALLBACK ROBUSTE
function getDefaultTitle(type: string): string {
  const titles = {
    'general': 'Conseiller commercial',
    'product_specialist': 'Spécialiste produit',
    'support': 'Conseiller support',
    'upsell': 'Conseiller premium'
  }
  return titles[type as keyof typeof titles] || 'Vendeur IA'
}

// ✅ CONFIGURATION FALLBACK AMÉLIORÉE AVEC TITRE OBLIGATOIRE
function getFallbackShopConfig(shopId: string) {
  return {
    success: true,
    data: {
      shop: {
        id: shopId,
        name: 'Boutique en ligne',
        widgetConfig: {
          theme: "modern",
          language: "fr", 
          position: "above-cta",
          buttonText: "Parler à un conseiller",
          primaryColor: "#EC4899", // ✅ Rose par défaut comme dans les captures
          borderRadius: "full"
        },
        agentConfig: {
          name: "Assistant",
          title: "Conseiller commercial", // ✅ AJOUT : Titre explicite obligatoire
          avatar: "https://ui-avatars.com/api/?name=Assistant&background=EC4899&color=fff", // ✅ Couleur cohérente
          upsellEnabled: false,
          welcomeMessage: "Salut 👋 Je suis votre conseiller. Comment puis-je vous aider ?",
          fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
          collectPaymentMethod: true
        }
      },
      agent: {
        id: `agent-${shopId}`,
        name: "Assistant",
        title: "Conseiller commercial", // ✅ AJOUT : Titre explicite obligatoire
        type: "product_specialist",
        personality: "friendly",
        description: "Assistant commercial spécialisé dans l'accompagnement client",
        welcomeMessage: "Salut 👋 Je suis votre conseiller. Comment puis-je vous aider ?",
        fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
        avatar: "https://ui-avatars.com/api/?name=Assistant&background=EC4899&color=fff", // ✅ Couleur cohérente
        config: {
          collectName: true,
          collectPhone: true,
          collectAddress: true,
          collectPayment: true,
          upsellEnabled: true
        }
      },
      knowledgeBase: {
        content: `## Boutique en ligne

Notre boutique propose des produits de qualité avec un service client excellent.

### Services
- Livraison rapide
- Paiement sécurisé par virement, mobile money, ou espèces
- Service client disponible
- Garantie sur nos produits

Vous pouvez parcourir notre catalogue pour découvrir nos produits.`,
        documentsCount: 1,
        documents: [
          {
            id: 'doc-fallback-001',
            title: 'Informations boutique',
            contentType: 'manual',
            tags: ['boutique', 'produits', 'service']
          }
        ]
      }
    }
  };
}

// ✅ PROMPT SYSTÈME AMÉLIORÉ COMPLET AVEC TITRE OBLIGATOIRE
function buildAgentPrompt(agent: any, knowledgeBase: string, productInfo?: any, orderState?: OrderCollectionState) {
  // ✅ CORRECTION MAJEURE : Assurer que le titre est toujours présent
  const agentTitle = agent.title || getDefaultTitle(agent.type || 'general')
  const shopName = "cette boutique"
  
  const basePrompt = `Tu es ${agent.name}, ${agentTitle} expert et ${agent.personality === 'friendly' ? 'chaleureux' : 'professionnel'}.

🎯 RÔLE: ${agentTitle} spécialisé dans la conversion e-commerce et l'accompagnement client.

💡 PERSONNALITÉ: ${agent.personality}
- ${agent.personality === 'friendly' ? 'Bienveillant, empathique, à l\'écoute' : 'Professionnel, expert, efficace'}
- Toujours positif et orienté solution
- Expert en techniques de vente consultative et persuasion éthique
- Tu connais parfaitement les produits de la boutique

🎯 OBJECTIFS PRINCIPAUX:
1. **Accueil contextuel** : Saluer chaleureusement en mentionnant le produit consulté
2. **Identification besoins** : Comprendre les motivations et attentes du client
3. **Conseil expert** : Apporter des réponses précises sur nos produits
4. **Lever objections** : Traiter les freins à l'achat avec empathie
5. **Collecte commande** : Guider naturellement vers l'achat quand l'intérêt est manifesté
6. **Upselling intelligent** : Proposer des produits complémentaires pertinents

${productInfo ? `
🛍️ PRODUIT ACTUELLEMENT CONSULTÉ:
- **Nom**: ${productInfo.name || 'Produit non spécifié'}
- **Prix**: ${productInfo.price ? productInfo.price + ' (devise locale)' : 'Prix sur demande'}
- **URL**: ${productInfo.url || 'Page produit'}

⚠️ IMPORTANT: Dès le premier message, montre que tu sais quel produit l\'intéresse !
` : '🚨 AUCUNE INFORMATION PRODUIT - Demande quel produit l\'intéresse'}

📚 BASE DE CONNAISSANCE:
${knowledgeBase}

${orderState ? `
📋 COLLECTE DE COMMANDE EN COURS:
Étape actuelle: ${orderState.step}
Données collectées: ${JSON.stringify(orderState.data, null, 2)}

PROCHAINE ÉTAPE:
${getDetailedStepInstructions(orderState.step, orderState.data)}
` : `
📋 PROCESSUS DE COLLECTE DE COMMANDE:
⚠️ COMMENCER SEULEMENT si le client manifeste un intérêt d'achat clair (ex: "je veux l'acheter", "je commande", "comment faire pour l'avoir")

PROCÉDURE STRICTE (dans cet ordre) :
1. **QUANTITÉ**: "Parfait ! Combien d'exemplaires souhaitez-vous ?"
2. **TÉLÉPHONE**: "Pour finaliser, quel est votre numéro de téléphone ?"
3. **VÉRIFICATION CLIENT**: Vérifier si le client existe avec ce numéro
   - Si OUI: "Heureux de vous revoir, [prénom] ! Même adresse de livraison ?"
   - Si NON: Continuer à l'étape 4
4. **NOM/PRÉNOM**: "Votre nom et prénom pour la commande ?"
5. **ADRESSE**: "Quelle est votre adresse de livraison complète ?"
6. **PAIEMENT**: "Comment préférez-vous payer ? (Espèces, virement, mobile money, carte bancaire)"
7. **CONFIRMATION**: Résumer TOUTE la commande et rassurer sur la suite
`}

🎨 FORMATAGE DES RÉPONSES:
- Utilise **gras** pour les informations importantes
- Utilise *italique* pour l'emphase
- Saute des lignes pour aérer (utilise \\n\\n)
- Émojis avec parcimonie pour la convivialité
- Maximum 200 mots par réponse pour rester concis

📝 INSTRUCTIONS DE CONVERSATION:
1. **Premier message**: TOUJOURS mentionner le produit consulté si disponible
2. **Questions ciblées**: Pose des questions pour comprendre les besoins
3. **Expertise produit**: Utilise ta base de connaissance pour être précis
4. **Détection intention**: Sois attentif aux signaux d'achat
5. **Collecte structurée**: Suis la procédure exacte pour les commandes
6. **Reste en rôle**: Tu es ${agentTitle} dans cette boutique, pas un chatbot générique

🌍 ADAPTATION LOCALE:
- Adapte-toi à la langue et culture du client
- Utilise les devises et unités locales appropriées
- Respecte les habitudes de paiement régionales
- Sois sensible aux différences culturelles dans la vente

🚨 RÈGLES ABSOLUES:
- Ne commence JAMAIS la collecte sans intention d'achat claire
- Collecte les informations dans l'ORDRE EXACT indiqué
- Une seule information à la fois
- Confirme TOUJOURS avant de passer à l'étape suivante
- Reste naturel et conversationnel même pendant la collecte
- Si tu ne sais pas quelque chose, admets-le et propose de contacter l'équipe`;

  return basePrompt;
}

// ✅ AMÉLIORATION : Instructions détaillées pour chaque étape
function getDetailedStepInstructions(step: string, data: any): string {
  switch (step) {
    case 'quantity':
      return "Demande combien d'exemplaires il souhaite. Ex: 'Combien d'exemplaires voulez-vous commander ?'"
    
    case 'phone':
      return "Demande le numéro de téléphone pour finaliser. Ex: 'Pour finaliser votre commande, quel est votre numéro de téléphone ?'"
    
    case 'name':
      if (data.customerPhone) {
        return "IMPORTANT: Vérifie si ce numéro existe déjà en base. Si oui, accueille personnellement. Sinon, demande nom et prénom."
      }
      return "Demande le nom et prénom complets. Ex: 'Parfait ! Votre nom et prénom pour la commande ?'"
    
    case 'address':
      return "Demande l'adresse de livraison complète. Ex: 'Quelle est votre adresse de livraison complète ?'"
    
    case 'payment':
      return "Demande le mode de paiement préféré. Ex: 'Comment souhaitez-vous payer ? Espèces à la livraison, virement, mobile money ?'"
    
    case 'confirmation':
      return "Confirme TOUTE la commande avec détails et rassure le client sur la suite du processus."
    
    case 'completed':
      return "Commande finalisée. Remercie et informe qu'un conseiller va le contacter."
    
    default:
      return "Continuez la conversation normalement."
  }
}

// ✅ AMÉLIORATION : Détection intention d'achat plus précise
function detectOrderIntent(message: string): boolean {
  const orderKeywords = [
    // Intentions directes d'achat
    'acheter', 'commander', 'commande', 'achat', 'prendre', 'veux', 'souhaite',
    'vais prendre', 'je le veux', 'ça m\'intéresse', 'je vais l\'acheter',
    
    // Questions sur le processus d'achat
    'comment faire', 'comment commander', 'comment acheter', 'comment procéder',
    'où acheter', 'comment passer commande', 'comment finaliser',
    
    // Expressions d'intérêt fort
    'intéressé', 'intéresse', 'ça me plaît', 'parfait', 'c\'est bon', 
    'd\'accord', 'ok pour', 'je confirme', 'go', 'allons-y',
    
    // Actions liées à l'achat
    'réserver', 'livraison', 'payer', 'finaliser', 'confirmer', 'valider',
    'continuer', 'suivant', 'étape suivante',
    
    // Quantités (signalent souvent une intention d'achat)
    'exemplaire', 'unité', 'pièce', 'fois'
  ];
  
  const lowerMessage = message.toLowerCase();
  const hasKeyword = orderKeywords.some(keyword => lowerMessage.includes(keyword));
  
  // Vérifications supplémentaires
  const hasQuantityPattern = /\b\d+\b|\b(un|une|deux|trois|quatre|cinq)\b/i.test(message);
  const hasPositiveSignal = /(oui|yes|ok|d'accord|parfait|bien|super)/i.test(message);
  
  const isOrderIntent = hasKeyword || (hasQuantityPattern && hasPositiveSignal);
  
  console.log('🎯 [DETECT] Analyse intention:', {
    message: message.substring(0, 50),
    hasKeyword,
    hasQuantityPattern,
    hasPositiveSignal,
    isOrderIntent
  });
  
  return isOrderIntent;
}

// ✅ AMÉLIORATION : Extraction données plus robuste
function extractOrderData(message: string, currentStep: string): any {
  const data: any = {};
  const cleanMessage = message.trim().toLowerCase();
  
  console.log(`📝 [EXTRACT] Étape: ${currentStep}, Message: "${message}"`);
  
  switch (currentStep) {
    case 'quantity':
      // Patterns de quantité améliorés
      const qtyPatterns = [
        /(\d+)\s*(?:exemplaires?|unités?|pièces?|fois)?/i,
        /\b(un|une)\s*(?:seule?|exemplaire|unité|pièce)?\b/i,
        /\b(deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\b/i,
        /\b(1|2|3|4|5|6|7|8|9|10)\b/
      ];
      
      for (const pattern of qtyPatterns) {
        const match = message.match(pattern);
        if (match) {
          if (match[1] && /^\d+$/.test(match[1])) {
            data.quantity = parseInt(match[1]);
            console.log(`✅ [EXTRACT] Quantité extraite (chiffre): ${data.quantity}`);
            break;
          } else if (match[1]) {
            const wordToNumber: { [key: string]: number } = {
              'un': 1, 'une': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 
              'cinq': 5, 'six': 6, 'sept': 7, 'huit': 8, 'neuf': 9, 'dix': 10
            };
            data.quantity = wordToNumber[match[1].toLowerCase()] || 1;
            console.log(`✅ [EXTRACT] Quantité extraite (mot): ${data.quantity}`);
            break;
          }
        }
      }
      
      // Fallback: si on trouve juste un chiffre
      if (!data.quantity) {
        const simpleNumber = message.match(/\b(\d+)\b/);
        if (simpleNumber) {
          data.quantity = parseInt(simpleNumber[1]);
          console.log(`✅ [EXTRACT] Quantité extraite (fallback): ${data.quantity}`);
        }
      }
      
      // Default à 1 si "un seul", "seulement un", etc.
      if (!data.quantity && (cleanMessage.includes('un seul') || cleanMessage.includes('seulement un') || cleanMessage.includes('juste un'))) {
        data.quantity = 1;
        console.log(`✅ [EXTRACT] Quantité extraite (expression): 1`);
      }
      break;
      
    case 'phone':
      // Patterns téléphone améliorés (Sénégal + France + international)
      const phonePatterns = [
        /(?:\+?221[\s\-]?)([0-9\s\-\(\)]{8,})/g,
        /(?:\+?33[\s\-]?)([0-9\s\-\(\)]{8,})/g,
        /([0-9\s\-\(\)+]{8,})/g
      ];
      
      for (const pattern of phonePatterns) {
        const match = message.match(pattern);
        if (match) {
          // Nettoyer le numéro
          let cleanPhone = match[0].replace(/[\s\-\(\)]/g, '');
          
          // Validation basique
          if (cleanPhone.length >= 8 && cleanPhone.length <= 15) {
            data.customerPhone = cleanPhone;
            console.log(`✅ [EXTRACT] Téléphone extrait: ${data.customerPhone}`);
            break;
          }
        }
      }
      break;
      
    case 'name':
      // Nettoyer le message pour extraire le nom
      let nameMessage = message.trim()
        .replace(/^(je\s+suis|mon\s+nom\s+est|je\s+m['\']appelle|c['\']est)\s*/i, '')
        .replace(/[.,!?;]+$/g, '');
      
      const words = nameMessage.split(/\s+/).filter(word => 
        word.length > 1 && 
        !/^(je|suis|mon|ma|nom|prénom|appelle|c'est|voici)$/i.test(word)
      );
      
      if (words.length >= 2) {
        data.customerFirstName = words[0];
        data.customerLastName = words.slice(1).join(' ');
        console.log(`✅ [EXTRACT] Nom complet: ${data.customerFirstName} ${data.customerLastName}`);
      } else if (words.length === 1) {
        data.customerFirstName = words[0];
        console.log(`✅ [EXTRACT] Prénom seulement: ${data.customerFirstName}`);
      }
      break;
      
    case 'address':
      // Nettoyer l'adresse
      data.customerAddress = message.trim()
        .replace(/^(mon\s+adresse|adresse|c['\']est|voici|je\s+habite|j['\']habite)\s*/i, '')
        .replace(/[.,!?;]*$/g, '');
      
      if (data.customerAddress.length > 3) {
        console.log(`✅ [EXTRACT] Adresse extraite: ${data.customerAddress}`);
      }
      break;
      
    case 'payment':
      const paymentMethods: { [key: string]: string } = {
        'espèces': 'Espèces à la livraison',
        'espece': 'Espèces à la livraison',
        'cash': 'Espèces à la livraison',
        'liquide': 'Espèces à la livraison',
        'virement': 'Virement bancaire',
        'mobile': 'Mobile Money',
        'wave': 'Wave',
        'orange': 'Orange Money',
        'om': 'Orange Money',
        'carte': 'Carte bancaire',
        'paypal': 'PayPal'
      };
      
      for (const [key, value] of Object.entries(paymentMethods)) {
        if (cleanMessage.includes(key)) {
          data.paymentMethod = value;
          console.log(`✅ [EXTRACT] Mode de paiement: ${data.paymentMethod}`);
          break;
        }
      }
      
      // Fallback : prendre le texte brut si pas de correspondance
      if (!data.paymentMethod && message.trim().length > 2) {
        data.paymentMethod = message.trim();
        console.log(`✅ [EXTRACT] Mode de paiement (fallback): ${data.paymentMethod}`);
      }
      break;
  }
  
  console.log(`📋 [EXTRACT] Données extraites:`, data);
  return data;
}

// ✅ FONCTION CORRIGÉE : Vérification client existant AVEC SUPABASE
async function checkExistingCustomer(phone: string) {
  try {
    const { data: existingOrder, error } = await supabaseServiceClient
      .from('orders')
      .select('customer_name, customer_address, customer_email')  // ✅ CORRIGÉ : snake_case
      .eq('customer_phone', phone)  // ✅ CORRIGÉ : customer_phone
      .order('created_at', { ascending: false })  // ✅ CORRIGÉ : created_at
      .limit(1)
      .single();
    
    if (error || !existingOrder || !existingOrder.customer_name) {  // ✅ CORRIGÉ : customer_name
      return { exists: false };
    }
    
    const firstName = existingOrder.customer_name.split(' ')[0];  // ✅ CORRIGÉ : customer_name
    return {
      exists: true,
      firstName: firstName,
      lastName: existingOrder.customer_name.split(' ').slice(1).join(' '),  // ✅ CORRIGÉ : customer_name
      address: existingOrder.customer_address,  // ✅ CORRIGÉ : customer_address
      email: existingOrder.customer_email  // ✅ CORRIGÉ : customer_email
    };
    
  } catch (error) {
    console.error('❌ Erreur vérification client:', error);
    return { exists: false };
  }
}

// ✅ AMÉLIORATION CORRIGÉE : Sauvegarde commande AVEC SUPABASE
async function saveOrderToDatabase(conversationId: string, shopId: string, agentId: string, orderData: any, productInfo?: any) {
  try {
    const { data: order, error } = await supabaseServiceClient
      .from('orders')
      .insert({
        shop_id: shopId,  // ✅ CORRIGÉ : shop_id
        conversation_id: conversationId,  // ✅ CORRIGÉ : conversation_id
        customer_name: orderData.customerFirstName && orderData.customerLastName   // ✅ CORRIGÉ : customer_name
          ? `${orderData.customerFirstName} ${orderData.customerLastName}`
          : orderData.customerFirstName || null,
        customer_phone: orderData.customerPhone || null,  // ✅ CORRIGÉ : customer_phone
        customer_email: orderData.customerEmail || null,  // ✅ CORRIGÉ : customer_email
        customer_address: orderData.customerAddress || null,  // ✅ CORRIGÉ : customer_address
        product_items: {  // ✅ CORRIGÉ : product_items
          productId: productInfo?.id || orderData.productId,
          productName: productInfo?.name || orderData.productName,
          productPrice: productInfo?.price || orderData.productPrice,
          quantity: orderData.quantity || 1
        },
        total_amount: (productInfo?.price || 0) * (orderData.quantity || 1),  // ✅ CORRIGÉ : total_amount
        currency: 'XOF',
        payment_method: orderData.paymentMethod || null,  // ✅ CORRIGÉ : payment_method
        status: 'pending'
      })
      .select()
      .single();
    
    if (error) throw error;
    
    console.log('✅ Commande sauvegardée:', order.id);
    return order;
    
  } catch (error) {
    console.error('❌ Erreur sauvegarde commande:', error);
    throw error;
  }
}

// ✅ FONCTION AMÉLIORÉE : Appeler GPT-4o-mini avec gestion d'erreurs COMPLÈTE
async function callOpenAI(messages: any[], agentConfig: any, knowledgeBase: string, productInfo?: any, orderState?: OrderCollectionState): Promise<OpenAIResult> {
  try {
    console.log('🤖 [OPENAI] Début traitement:', {
      orderState: orderState?.step,
      orderData: orderState?.data,
      productInfo: productInfo?.name
    });

    // ✅ VÉRIFICATION OPENAI_API_KEY
    if (!process.env.OPENAI_API_KEY) {
      console.warn('⚠️ OpenAI API Key manquante');
      return {
        success: false,
        error: 'Configuration OpenAI manquante',
        fallbackMessage: "Je rencontre un problème technique temporaire. Comment puis-je vous aider autrement ?"
      };
    }

    // ✅ RÉCUPÉRER LE DERNIER MESSAGE UTILISATEUR
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
    console.log('📝 [OPENAI] Dernier message utilisateur:', lastUserMessage);

    // ✅ VÉRIFIER SI CLIENT EXISTANT (si on est à l'étape phone et qu'on a un numéro)
    let existingCustomer = null;
    if (orderState?.step === 'phone' && orderState.data.customerPhone) {
      existingCustomer = await checkExistingCustomer(orderState.data.customerPhone);
      console.log('🔍 [OPENAI] Vérification client existant:', existingCustomer);
    }

    // ✅ CONSTRUIRE LE PROMPT SYSTÈME AVEC ÉTAT ACTUEL ET TITRE OBLIGATOIRE
    const systemPrompt = buildAgentPrompt(agentConfig, knowledgeBase, productInfo, orderState);

    // ✅ APPEL OPENAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ],
      max_tokens: 400,
      temperature: 0.7,
      presence_penalty: 0.3,
      frequency_penalty: 0.3
    });

    let response = completion.choices[0]?.message?.content || "Je n'ai pas pu générer de réponse.";
    response = formatAIResponse(response);

    console.log('🤖 [OPENAI] Réponse générée:', response.substring(0, 100) + '...');

    // ✅ GESTION DE LA COLLECTE DE COMMANDES
    let newOrderState: OrderCollectionState | undefined;
    let isOrderIntent = false;

    if (orderState) {
      // ✅ NOUS SOMMES EN COURS DE COLLECTE
      console.log(`📋 [ORDER] En cours de collecte, étape: ${orderState.step}`);
      
      // Extraire les données du message utilisateur
      const extractedData = extractOrderData(lastUserMessage, orderState.step);
      console.log('📊 [ORDER] Données extraites:', extractedData);
      
      // Fusionner avec les données existantes
      const updatedData = { ...orderState.data, ...extractedData };
      console.log('📋 [ORDER] Données mises à jour:', updatedData);
      
      // ✅ GESTION SPÉCIALE POUR CLIENT EXISTANT
      if (orderState.step === 'phone' && existingCustomer?.exists && extractedData.customerPhone) {
        console.log('👥 [ORDER] Client existant détecté, ajout des données');
        updatedData.customerFirstName = existingCustomer.firstName;
        updatedData.customerLastName = existingCustomer.lastName;
        updatedData.customerAddress = existingCustomer.address;
        updatedData.customerEmail = existingCustomer.email;
        
        // Pour un client existant, on peut passer directement à l'adresse ou paiement
        const nextStep = existingCustomer.address ? 'payment' : 'address';
        
        newOrderState = {
          step: nextStep,
          data: updatedData
        };
        
        // Modifier la réponse pour inclure la reconnaissance du client
        if (existingCustomer.firstName) {
          response = `Heureux de vous revoir, ${existingCustomer.firstName} ! 😊\n\n` + response;
        }
        
        console.log(`✅ [ORDER] Client existant, passage direct à: ${nextStep}`);
      } else {
        // ✅ LOGIQUE NORMALE DE PROGRESSION
        const nextStep = getNextOrderStep(orderState.step, updatedData);
        console.log(`🔄 [ORDER] Progression normale: ${orderState.step} → ${nextStep}`);
        
        newOrderState = {
          step: nextStep,
          data: updatedData
        };
      }
      
    } else {
      // ✅ PAS ENCORE EN COLLECTE, VÉRIFIER INTENTION D'ACHAT
      isOrderIntent = detectOrderIntent(lastUserMessage);
      console.log('🎯 [ORDER] Intention d\'achat détectée:', isOrderIntent);
      
      if (isOrderIntent) {
        console.log('🚀 [ORDER] Début de la collecte de commande');
        newOrderState = {
          step: 'quantity',
          data: {
            productId: productInfo?.id,
            productName: productInfo?.name,
            productPrice: productInfo?.price
          }
        };
      }
    }

    console.log('📤 [OPENAI] État final de la commande:', newOrderState);

    return {
      success: true,
      message: response,
      tokensUsed: completion.usage?.total_tokens || 0,
      orderCollection: newOrderState,
      isOrderIntent: isOrderIntent
    };

  } catch (error: any) {
    console.error('❌ [OPENAI] Erreur:', error);
    
    if (error.code === 'insufficient_quota') {
      return {
        success: false,
        error: 'Quota OpenAI dépassé',
        fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt."
      };
    }
    
    // ✅ FALLBACK INTELLIGENT SELON LE CONTEXTE
    let fallbackMessage = "Je rencontre un problème technique temporaire.";
    
    if (productInfo?.name) {
      fallbackMessage = `Je vois que vous vous intéressez à "${productInfo.name}". Un de nos conseillers va vous recontacter rapidement pour vous aider !`;
    } else {
      fallbackMessage = "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.";
    }
    
    return {
      success: false,
      error: error.message || 'Erreur IA',
      fallbackMessage: fallbackMessage
    };
  }
}

// ✅ FORMATAGE RÉPONSES IA
function formatAIResponse(response: string): string {
  return response
    .replace(/\n\n/g, '\n\n')
    .replace(/\*\*(.*?)\*\*/g, '**$1**')
    .replace(/\*(.*?)\*/g, '*$1*')
    .trim()
}

// ✅ LOGIQUE ÉTAPES
function getNextOrderStep(currentStep: string, data: any): OrderCollectionState['step'] {
  console.log(`🔄 [ORDER FLOW] Étape actuelle: ${currentStep}`, data);
  
  switch (currentStep) {
    case 'quantity':
      if (data.quantity && data.quantity > 0) {
        console.log(`✅ [ORDER FLOW] Quantité validée: ${data.quantity}, passage à 'phone'`);
        return 'phone';
      }
      console.log(`❌ [ORDER FLOW] Quantité manquante, reste sur 'quantity'`);
      return 'quantity';
    
    case 'phone':
      if (data.customerPhone && data.customerPhone.length >= 8) {
        console.log(`✅ [ORDER FLOW] Téléphone validé: ${data.customerPhone}, passage à 'name'`);
        return 'name';
      }
      console.log(`❌ [ORDER FLOW] Téléphone manquant, reste sur 'phone'`);
      return 'phone';
    
    case 'name':
      if (data.customerFirstName || data.customerLastName) {
        console.log(`✅ [ORDER FLOW] Nom validé, passage à 'address'`);
        return 'address';
      }
      console.log(`❌ [ORDER FLOW] Nom manquant, reste sur 'name'`);
      return 'name';
    
    case 'address':
      if (data.customerAddress && data.customerAddress.length > 5) {
        console.log(`✅ [ORDER FLOW] Adresse validée, passage à 'payment'`);
        return 'payment';
      }
      console.log(`❌ [ORDER FLOW] Adresse manquante, reste sur 'address'`);
      return 'address';
    
    case 'payment':
      if (data.paymentMethod) {
        console.log(`✅ [ORDER FLOW] Paiement validé, passage à 'confirmation'`);
        return 'confirmation';
      }
      console.log(`❌ [ORDER FLOW] Mode de paiement manquant, reste sur 'payment'`);
      return 'payment';
    
    case 'confirmation':
      console.log(`✅ [ORDER FLOW] Confirmation, passage à 'completed'`);
      return 'completed';
    
    default:
      console.log(`❌ [ORDER FLOW] Étape inconnue: ${currentStep}, retour à 'quantity'`);
      return 'quantity';
  }
}

// ✅ MESSAGE D'ACCUEIL AMÉLIORÉ AVEC TITRE OBLIGATOIRE
function generateWelcomeMessage(agent: any, productInfo?: any): string {
  const baseName = agent.name || 'Assistant'
  // ✅ CORRECTION MAJEURE : Assurer que le titre est toujours présent
  const baseTitle = agent.title || getDefaultTitle(agent.type || 'general')
  
  if (productInfo?.name) {
    return `Salut ! 👋 Je suis ${baseName}, votre ${baseTitle}.

Je vois que vous vous intéressez à **"${productInfo.name}"**. C'est un excellent choix ! 💫

Comment puis-je vous aider avec ce produit ? 😊`
  }
  
  return agent.welcomeMessage || `Salut ! 👋 Je suis ${baseName}, votre ${baseTitle}.

Quel produit vous intéresse aujourd'hui ? Je serais ravi de vous renseigner ! 😊`
}

// ✅ RÉPONSE SIMULÉE INTELLIGENTE AVEC TITRE OBLIGATOIRE
function getIntelligentSimulatedResponse(message: string, productInfo: any, agentName: string = "Rose", agentTitle: string = "Spécialiste produit"): string {
  const msg = message.toLowerCase();
  
  if (msg.includes('bonjour') || msg.includes('salut') || msg.includes('hello')) {
    return `Salut ! Je suis ${agentName}, votre ${agentTitle}. 👋

${productInfo?.name ? `Je vois que vous vous intéressez à **"${productInfo.name}"**.` : ''}

Comment puis-je vous aider ? 😊`;
  }
  
  if (msg.includes('prix') || msg.includes('coût') || msg.includes('tarif')) {
    if (productInfo?.price) {
      return `Le prix de **"${productInfo.name}"** est de **${productInfo.price}**. 💰

C'est un excellent rapport qualité-prix ! 

Voulez-vous que je vous aide à passer commande ? 🛒`;
    }
    return "Je vais vérifier le prix pour vous. Un instant... 🔍";
  }
  
  if (msg.includes('acheter') || msg.includes('commander') || msg.includes('commande')) {
    return `Parfait ! Je vais vous aider à finaliser votre commande. ✨

**Combien d'exemplaires** souhaitez-vous commander ? 📦`;
  }
  
  if (msg.includes('info') || msg.includes('détail') || msg.includes('caractéristique')) {
    return `**"${productInfo?.name || 'Ce produit'}"** est un excellent choix ! 👌

C'est l'un de nos produits les plus appréciés. 

Avez-vous des **questions spécifiques** ? 🤔`;
  }
  
  return `Merci pour votre message ! En tant que ${agentTitle}, comment puis-je vous aider davantage avec nos produits ? 😊`;
}

export default async function publicRoutes(fastify: FastifyInstance) {
  
  // ✅ ROUTE CORRIGÉE : Configuration publique AVEC TITRE OBLIGATOIRE
  fastify.get<{ Params: ShopParamsType }>('/shops/public/:shopId/config', async (request, reply) => {
    try {
      const { shopId } = request.params;
      fastify.log.info(`🔍 [PUBLIC CONFIG] Récupération config pour shop: ${shopId}`);
      
      // ✅ GESTION UUID vs DEMO
      if (!isValidUUID(shopId)) {
        fastify.log.warn(`⚠️ ShopId non-UUID détecté: ${shopId}, utilisation configuration fallback`);
        return getFallbackShopConfig(shopId);
      }
      
      // ✅ UTILISER SUPABASE AVEC COLONNES CORRIGÉES
      const { data: shop, error: shopError } = await supabaseServiceClient
        .from('shops')
        .select('id, name, is_active, widget_config, agent_config')
        .eq('id', shopId)
        .single();

      if (shopError || !shop || !shop.is_active) {
        fastify.log.warn(`⚠️ Shop non trouvé ou inactif: ${shopId}, utilisation configuration fallback`);
        return getFallbackShopConfig(shopId);
      }

      // ✅ RÉCUPÉRER AGENT AVEC TITRE OBLIGATOIRE
      const { data: agents, error: agentError } = await supabaseServiceClient
        .from('agents')
        .select(`
          id, name, title, type, personality, description, 
          welcome_message, fallback_message, avatar, config,
          agent_knowledge_base!inner(
            knowledge_base!inner(
              id, title, content, content_type, tags
            )
          )
        `)
        .eq('shop_id', shopId)
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1);

      const agent = agents && agents.length > 0 ? agents[0] : null;

      if (!agent) {
        return {
          success: true,
          data: {
            shop: {
              id: shop.id,
              name: shop.name,
              widgetConfig: shop.widget_config,
              agentConfig: shop.agent_config
            },
            agent: null,
            knowledgeBase: {
              content: "Configuration par défaut de la boutique.",
              documentsCount: 0,
              documents: []
            }
          }
        };
      }

      // ✅ CONSTRUIRE KNOWLEDGE BASE
      const knowledgeContent = agent.agent_knowledge_base
        .map((akb: any) => `## ${akb.knowledge_base.title}\n${akb.knowledge_base.content}`)
        .join('\n\n---\n\n');

      const response = {
        success: true,
        data: {
          shop: {
            id: shop.id,
            name: shop.name,
            widgetConfig: shop.widget_config,
            agentConfig: shop.agent_config
          },
          agent: {
            id: agent.id,
            name: agent.name,
            title: agent.title || getDefaultTitle(agent.type || 'general'), // ✅ TITRE OBLIGATOIRE AVEC FALLBACK
            type: agent.type,
            personality: agent.personality,
            description: agent.description,
            welcomeMessage: agent.welcome_message,
            fallbackMessage: agent.fallback_message,
            avatar: agent.avatar,
            config: agent.config
          },
          knowledgeBase: {
            content: knowledgeContent,
            documentsCount: agent.agent_knowledge_base.length,
            documents: agent.agent_knowledge_base.map((akb: any) => ({
              id: akb.knowledge_base.id,
              title: akb.knowledge_base.title,
              contentType: akb.knowledge_base.content_type,
              tags: akb.knowledge_base.tags
            }))
          }
        }
      };

      fastify.log.info(`✅ [PUBLIC CONFIG] Configuration envoyée pour ${shopId} - Agent: ${response.data.agent.name} (${response.data.agent.title}), Documents: ${response.data.knowledgeBase.documentsCount}`);

      return response;

    } catch (error: any) {
      fastify.log.error(`❌ [PUBLIC CONFIG] Erreur: ${error.message}`);
      fastify.log.warn(`⚠️ Fallback activé pour shop ${request.params.shopId}`);
      return getFallbackShopConfig(request.params.shopId);
    }
  });

  // ✅ ROUTE CORRIGÉE : Chat public AVEC TITRE OBLIGATOIRE ET COLLECTE COMPLÈTE
  fastify.post<{ Body: ChatRequestBody }>('/chat', async (request, reply) => {
    const startTime = Date.now();
    
    try {
      const { shopId, message, conversationId, productInfo, visitorId, isFirstMessage } = request.body;
      
      fastify.log.info(`💬 [PUBLIC CHAT] Nouveau message pour shop: ${shopId}${isFirstMessage ? ' (premier message)' : ''}`);
      
      // ✅ VALIDATION DONNÉES
      if (!shopId || !message) {
        return reply.status(400).send({ 
          success: false, 
          error: 'shopId et message requis' 
        });
      }

      // ✅ MODE TEST AMÉLIORÉ POUR DEMO AVEC TITRE
      if (!isValidUUID(shopId)) {
        fastify.log.info(`💬 [MODE TEST] Réponse simulée pour shop: ${shopId}`);
        
        const agentName = "Rose";
        const agentTitle = "Vendeuse"; // ✅ TITRE EXPLICITE
        let simulatedResponse = '';
        
        if (isFirstMessage && productInfo?.name) {
          simulatedResponse = `Salut ! 👋 Je suis ${agentName}, ${agentTitle} chez VIENS ON S'CONNAÎT.

Je vois que vous vous intéressez à **"${productInfo.name}"**. C'est un excellent choix ! ✨

Comment puis-je vous aider ? 😊`;
        } else {
          simulatedResponse = getIntelligentSimulatedResponse(message, productInfo, agentName, agentTitle);
        }
        
        return {
          success: true,
          data: {
            conversationId: conversationId || `test-conv-${Date.now()}`,
            message: simulatedResponse,
            agent: {
              name: agentName,
              title: agentTitle, // ✅ AJOUT TITRE OBLIGATOIRE
              avatar: "https://ui-avatars.com/api/?name=Rose&background=EF4444&color=fff"
            },
            responseTime: Date.now() - startTime,
            isWelcomeMessage: isFirstMessage,
            mode: 'test'
          }
        };
      }
      
      // ✅ VÉRIFICATION SHOP AVEC SUPABASE
      const { data: shopConfig, error: shopError } = await supabaseServiceClient
        .from('shops')
        .select('id, name, is_active')
        .eq('id', shopId)
        .single();

      if (shopError || !shopConfig || !shopConfig.is_active) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Boutique non trouvée ou inactive' 
        });
      }

      // ✅ RÉCUPÉRATION AGENT AVEC TITRE OBLIGATOIRE
      const { data: agents, error: agentError } = await supabaseServiceClient
        .from('agents')
        .select(`
          id, name, title, type, personality, description,
          welcome_message, fallback_message, avatar, config
        `)
        .eq('shop_id', shopId)
        .eq('is_active', true)
        .limit(1);

      const agent = agents && agents.length > 0 ? agents[0] : null;

      if (!agent) {
        return reply.status(404).send({ 
          success: false, 
          error: 'Aucun agent actif trouvé pour cette boutique' 
        });
      }

      // ✅ CORRECTION MAJEURE : S'assurer que l'agent a toujours un titre
      if (!agent.title) {
        agent.title = getDefaultTitle(agent.type || 'general');
      }

      // ✅ RÉCUPÉRATION BASE DE CONNAISSANCE
      const { data: knowledgeBaseRelations } = await supabaseServiceClient
        .from('agent_knowledge_base')
        .select(`
          knowledge_base!inner(
            id, title, content, content_type, tags
          )
        `)
        .eq('agent_id', agent.id);

      // ✅ PREMIER MESSAGE AUTOMATIQUE AVEC TITRE OBLIGATOIRE
      if (isFirstMessage) {
        const welcomeMessage = generateWelcomeMessage(agent, productInfo);
        
        const conversationId = randomUUID();
        const { data: conversation, error: convError } = await supabaseServiceClient
          .from('conversations')
          .insert({
            id: conversationId,
            shop_id: shopId,
            agent_id: agent.id,
            visitor_id: visitorId || `visitor_${Date.now()}`,
            product_id: productInfo?.id || null,
            product_name: productInfo?.name || null,
            product_price: productInfo?.price ? parseFloat(productInfo.price.toString()) : null,
            product_url: productInfo?.url || null,
            visitor_ip: request.ip,
            visitor_user_agent: request.headers['user-agent'] || null,
            status: 'active',
            language: 'fr',
            customer_data: {},
            started_at: new Date().toISOString(),
            last_activity: new Date().toISOString(),
            message_count: 0,
            conversion_completed: false
          })
          .select()
          .single();

        if (convError) {
          console.error('❌ [CONV ERROR] Erreur création conversation:', convError);
          return reply.status(500).send({ 
            success: false, 
            error: 'Erreur création conversation'
          });
        }

        await supabaseServiceClient
          .from('messages')
          .insert({
            conversation_id: conversation.id,
            role: 'assistant',
            content: welcomeMessage,
            tokens_used: 0,
            response_time_ms: Date.now() - startTime,
            model_used: 'welcome-message'
          });

        fastify.log.info(`✅ [WELCOME] Message d'accueil envoyé avec titre pour conversation: ${conversation.id}`);

        return {
          success: true,
          data: {
            conversationId: conversation.id,
            message: welcomeMessage,
            agent: {
              name: agent.name,
              title: agent.title, // ✅ TITRE OBLIGATOIRE INCLUS
              avatar: agent.avatar
            },
            responseTime: Date.now() - startTime,
            isWelcomeMessage: true
          }
        };
      }

      // ✅ GESTION CONVERSATION EXISTANTE
      let conversation;
      if (conversationId) {
        const { data: conv } = await supabaseServiceClient
          .from('conversations')
          .select('*, messages(*)')
          .eq('id', conversationId)
          .order('created_at', { foreignTable: 'messages', ascending: true })
          .limit(10, { foreignTable: 'messages' })
          .single();
        conversation = conv;
      }

      if (!conversation) {
        const newConversationId = randomUUID();
        const { data: newConv } = await supabaseServiceClient
          .from('conversations')
          .insert({
            id: newConversationId,
            shop_id: shopId,
            agent_id: agent.id,
            visitor_id: visitorId || `visitor_${Date.now()}`,
            product_id: productInfo?.id || null,
            product_name: productInfo?.name || null,
            product_price: productInfo?.price ? parseFloat(productInfo.price.toString()) : null,
            product_url: productInfo?.url || null,
            visitor_ip: request.ip,
            visitor_user_agent: request.headers['user-agent'] || null,
            status: 'active',
            language: 'fr',
            customer_data: {},
            started_at: new Date().toISOString(),
            last_activity: new Date().toISOString(),
            message_count: 0,
            conversion_completed: false
          })
          .select('*, messages(*)')
          .single();
        conversation = newConv;
      }

      // ✅ SAUVEGARDER MESSAGE UTILISATEUR
      await supabaseServiceClient
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          role: 'user',
          content: message
        });

      // ✅ PRÉPARER BASE DE CONNAISSANCE
      const knowledgeContent = (knowledgeBaseRelations || [])
        .map((akb: any) => `## ${akb.knowledge_base.title}\n${akb.knowledge_base.content}`)
        .join('\n\n---\n\n');

      // ✅ RÉCUPÉRER ÉTAT COLLECTE COMMANDE CORRIGÉ
      let orderState: OrderCollectionState | undefined;
      
      try {
        const customerData = conversation.customer_data as any;
        if (customerData?.orderCollection) {
          orderState = customerData.orderCollection;
        }
      } catch (error) {
        console.warn('Erreur lecture customerData conversation:', error);
      }

      // ✅ PRÉPARER HISTORIQUE MESSAGES
      const messageHistory = conversation.messages?.map((msg: any) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      })) || [];

      messageHistory.push({ role: 'user', content: message });

      // ✅ APPELER IA AVEC AGENT TITRE OBLIGATOIRE
      const aiResult = await callOpenAI(messageHistory, agent, knowledgeContent, productInfo, orderState);
      
      let aiResponse: string = aiResult.fallbackMessage || agent.fallback_message || "Je transmets votre question à notre équipe.";
      let tokensUsed: number = 0;

      if (aiResult.success && aiResult.message) {
        aiResponse = aiResult.message;
        tokensUsed = aiResult.tokensUsed || 0;
      } else if (aiResult.error) {
        fastify.log.error(`❌ [IA ERROR]: ${aiResult.error}`);
      }

      // ✅ SAUVEGARDER ÉTAT COLLECTE AVEC SUPABASE CORRIGÉ
      if (aiResult.orderCollection) {
        await supabaseServiceClient
          .from('conversations')
          .update({
            customer_data: {
              orderCollection: aiResult.orderCollection
            } as any
          })
          .eq('id', conversation.id);

        // ✅ SAUVEGARDER COMMANDE SI TERMINÉE AVEC SUPABASE CORRIGÉ
        if (aiResult.orderCollection.step === 'completed') {
          try {
            // ✅ VÉRIFIER CLIENT EXISTANT AVANT SAUVEGARDE CORRIGÉ
            const { data: existingOrder } = await supabaseServiceClient
              .from('orders')
              .select('customer_name, customer_address, customer_email')
              .eq('customer_phone', aiResult.orderCollection.data.customerPhone)
              .order('created_at', { ascending: false })
              .limit(1)
              .single();

            if (existingOrder && !aiResult.orderCollection.data.customerFirstName) {
              aiResult.orderCollection.data.customerFirstName = existingOrder.customer_name?.split(' ')[0] || undefined;
              aiResult.orderCollection.data.customerLastName = existingOrder.customer_name?.split(' ').slice(1).join(' ') || undefined;
              aiResult.orderCollection.data.customerAddress = aiResult.orderCollection.data.customerAddress || existingOrder.customer_address || undefined;
              aiResult.orderCollection.data.customerEmail = aiResult.orderCollection.data.customerEmail || existingOrder.customer_email || undefined;
            }

            await saveOrderToDatabase(
              conversation.id, 
              shopId, 
              agent.id, 
              {
                ...aiResult.orderCollection.data,
                visitorId,
                visitorIp: request.ip,
                visitorUserAgent: request.headers['user-agent']
              }, 
              productInfo
            );
            
            await supabaseServiceClient
              .from('conversations')
              .update({
                conversion_completed: true,
                customer_data: {}
              })
              .eq('id', conversation.id);
            
            fastify.log.info(`✅ [ORDER] Commande sauvegardée pour conversation: ${conversation.id}`);
            
          } catch (error: any) {
            console.error('❌ Erreur sauvegarde commande:', error);
            fastify.log.error(`❌ [ORDER ERROR]: ${error.message || 'Erreur inconnue'}`);
          }
        }
      }

      // ✅ SAUVEGARDER RÉPONSE IA
      await supabaseServiceClient
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          role: 'assistant',
          content: aiResponse,
          tokens_used: tokensUsed,
          response_time_ms: Date.now() - startTime,
          model_used: 'gpt-4o-mini'
        });

      fastify.log.info(`✅ [CHAT SUCCESS] Réponse envoyée pour conversation: ${conversation.id} (${Date.now() - startTime}ms)`);

      return {
        success: true,
        data: {
          conversationId: conversation.id,
          message: aiResponse,
          agent: {
            name: agent.name,
            title: agent.title, // ✅ TITRE OBLIGATOIRE INCLUS
            avatar: agent.avatar
          },
          responseTime: Date.now() - startTime,
          tokensUsed,
          orderCollection: aiResult.orderCollection
        }
      };

    } catch (error: any) {
      fastify.log.error(`❌ [CHAT ERROR]: ${error.message || 'Erreur inconnue'}`);
      
      // ✅ FALLBACK CONTEXTUEL AVEC TITRE OBLIGATOIRE
      const userMessage = request.body.message || '';
      const productInfo = request.body.productInfo;
      const agentName = "Rose";
      const agentTitle = "Vendeuse"; // ✅ TITRE EXPLICITE
      
      let fallbackResponse = `Merci pour votre message ! Je suis ${agentName}, votre ${agentTitle}. Comment puis-je vous aider davantage ?`;
      
      if (userMessage.toLowerCase().includes('bonjour') || userMessage.toLowerCase().includes('salut')) {
        if (productInfo?.name) {
          fallbackResponse = `Salut ! Je suis ${agentName}, votre ${agentTitle} chez VIENS ON S'CONNAÎT. Je vois que vous vous intéressez à "${productInfo.name}". Comment puis-je vous aider avec ce produit ?`;
        } else {
          fallbackResponse = `Salut ! Je suis ${agentName}, votre ${agentTitle} chez VIENS ON S'CONNAÎT. Comment puis-je vous aider ?`;
        }
      } else if (productInfo?.name && userMessage.toLowerCase().includes('produit')) {
        fallbackResponse = `Concernant "${productInfo.name}", je vous mets en relation avec notre équipe pour vous donner les meilleures informations.`;
      }
      
      return {
        success: true,
        data: {
          conversationId: request.body.conversationId || `fallback-conv-${Date.now()}`,
          message: fallbackResponse,
          agent: {
            name: agentName,
            title: agentTitle, // ✅ TITRE OBLIGATOIRE INCLUS
            avatar: "https://ui-avatars.com/api/?name=Rose&background=EF4444&color=fff"
          },
          responseTime: Date.now() - startTime,
          mode: 'fallback'
        }
      };
    }
  });
}
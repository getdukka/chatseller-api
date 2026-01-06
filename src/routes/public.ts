// src/routes/public.ts

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

// ✅ FONCTION : Titre par défaut selon le type AVEC FALLBACK ROBUSTE
function getDefaultTitle(type: string): string {
  const titles = {
    'general': 'Conseiller commercial',
    'product_specialist': 'Spécialiste produit',
    'support': 'Conseiller support',
    'upsell': 'Conseiller premium'
  }
  return titles[type as keyof typeof titles] || 'Vendeur IA'
}

// ✅ CORRECTION MAJEURE : Helper déterminant le type de produit AVEC customProductType
function getProductType(productName: string, customProductType?: string): string {
  // Si customProductType est fourni, l'utiliser en priorité
  if (customProductType && customProductType.trim()) {
    return customProductType.trim()
  }
  
  if (!productName) return 'produit'
  
  const name = productName.toLowerCase()
  
  if (name.includes('jeu') || name.includes('game') || name.includes('cartes')) return 'jeu'
  if (name.includes('livre') || name.includes('book') || name.includes('roman')) return 'livre'  
  if (name.includes('cours') || name.includes('formation') || name.includes('training')) return 'formation'
  if (name.includes('smartphone') || name.includes('téléphone') || name.includes('phone')) return 'smartphone'
  if (name.includes('ordinateur') || name.includes('laptop') || name.includes('computer')) return 'ordinateur'
  if (name.includes('vêtement') || name.includes('tshirt') || name.includes('robe')) return 'vêtement'
  if (name.includes('service') || name.includes('consultation') || name.includes('accompagnement')) return 'service'
  if (name.includes('bijou') || name.includes('collier') || name.includes('bracelet')) return 'bijou'
  
  return 'produit'
}

// ✅ HELPER : Obtenir le moment de la journée pour salutation naturelle
function getTimeBasedGreeting(): string {
  const hour = new Date().getHours()
  
  if (hour < 12) return 'Bonjour'
  if (hour < 18) return 'Bonsoir'
  return 'Bonsoir'
}

// ✅ NOUVELLE FONCTION : Remplacer les variables dynamiques dans un message
function replaceMessageVariables(message: string, variables: {
  agentName?: string;
  agentTitle?: string;
  shopName?: string;
  productName?: string;
  productType?: string;
  greeting?: string;
  productPrice?: string;
}): string {
  if (!message) return message;
  
  let processedMessage = message;
  
  // Remplacer chaque variable si elle existe
  Object.entries(variables).forEach(([key, value]) => {
    if (value) {
      const placeholder = `\${${key}}`;
      processedMessage = processedMessage.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
    }
  });
  
  return processedMessage;
}

// ✅ CONFIGURATION FALLBACK CORRIGÉE DYNAMIQUE
function getFallbackShopConfig(shopId: string) {
  return {
    success: true,
    data: {
      shop: {
        id: shopId,
        name: 'Ma Boutique',
        widgetConfig: {
          theme: "modern",
          language: "fr", 
          position: "above-cta",
          buttonText: "Parler au vendeur",
          primaryColor: "#8B5CF6",
          borderRadius: "full"
        },
        agentConfig: {
          name: "Assistant",
          title: "Conseiller commercial",
          avatar: "https://ui-avatars.com/api/?name=Assistant&background=8B5CF6&color=fff",
          upsellEnabled: false,
          welcomeMessage: "Bonjour ! Je suis votre conseiller commercial. Comment puis-je vous aider ?",
          fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
          collectPaymentMethod: true
        }
      },
      agent: {
        id: `agent-${shopId}`,
        name: "Assistant",
        title: "Conseiller commercial",
        type: "product_specialist",
        personality: "friendly",
        description: "Assistant IA spécialisé dans l'accompagnement client",
        welcomeMessage: "Bonjour ! Je suis votre conseiller commercial. Comment puis-je vous aider ?",
        fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt.",
        avatar: "https://ui-avatars.com/api/?name=Assistant&background=8B5CF6&color=fff",
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
- Paiement sécurisé 
- Service client disponible
- Garantie sur nos produits

Nous sommes là pour vous aider à trouver le produit parfait.`,
        documentsCount: 1,
        documents: [
          {
            id: 'doc-fallback-001',
            title: 'Informations boutique générique',
            contentType: 'manual',
            tags: ['boutique', 'service']
          }
        ]
      }
    }
  };
}

// ✅ NOUVELLES FONCTIONS BEAUTÉ (à ajouter vers ligne 150)
function detectBeautyDomain(agentType: string, agentTitle: string): string {
  const title = agentTitle.toLowerCase();
  
  if (title.includes('esthéticienne') || title.includes('soin')) return 'skincare';
  if (title.includes('maquillage') || title.includes('makeup')) return 'makeup';
  if (title.includes('parfum') || title.includes('fragrance')) return 'fragrance';
  if (title.includes('cheveux') || title.includes('capillaire')) return 'haircare';
  if (title.includes('ongles') || title.includes('manucure')) return 'nails';
  
  return 'multi-beauté';
}

function getBeautyExpertise(beautyDomain: string) {
  const expertiseMap = {
    skincare: {
      specialization: "Soins visage et corps",
      skills: [
        "Diagnostic professionnel des types de peau",
        "Maîtrise des ingrédients actifs (rétinol, acide hyaluronique, vitamine C...)",
        "Création de routines sur-mesure selon âge et problématiques",
        "Expertise anti-âge, hydratation, acné, sensibilité",
        "Conseil en protection solaire et prévention"
      ]
    },
    makeup: {
      specialization: "Maquillage et colorimétrie",
      skills: [
        "Analyse du teint et détermination des sous-tons",
        "Techniques d'application professionnelles",
        "Colorimétrie et harmonies selon morphologie",
        "Maquillage adapté aux occasions et personnalité",
        "Tendances actuelles et looks intemporels"
      ]
    },
    fragrance: {
      specialization: "Parfumerie et conseil olfactif", 
      skills: [
        "Connaissance des familles olfactives et accords",
        "Analyse des goûts et personnalité olfactive",
        "Conseil selon saisons, occasions et style de vie",
        "Techniques de layering et optimisation de la tenue",
        "Culture parfumerie et histoire des fragrances"
      ]
    },
    'multi-beauté': {
      specialization: "Conseil beauté global",
      skills: [
        "Vision holistique de la routine beauté",
        "Coordination soins/maquillage/parfum",
        "Conseils lifestyle et confiance en soi",
        "Adaptation aux budgets et contraintes",
        "Accompagnement personnalisé long terme"
      ]
    }
  };
  
  return expertiseMap[beautyDomain as keyof typeof expertiseMap] || expertiseMap['multi-beauté'];
}

function analyzeBeautyProduct(productName: string): string {
  if (!productName) return "produit de qualité adapté à vos besoins";
  
  const name = productName.toLowerCase();
  
  if (name.includes('sérum')) return "concentration d'actifs pour des résultats ciblés";
  if (name.includes('crème')) return "hydratation et protection quotidienne";
  if (name.includes('rouge')) return "couleur et tenue longue durée pour vos lèvres";
  if (name.includes('fond de teint')) return "teint unifié et naturel toute la journée";
  if (name.includes('parfum')) return "signature olfactive unique et mémorable";
  if (name.includes('mascara')) return "regard intensifié et cils sublimés";
  
  return "formulation experte pour révéler votre beauté";
}

// ✅ PROMPT SYSTÈME 
function buildAgentPrompt(agent: any, knowledgeBase: string, shopName: string, productInfo?: any, orderState?: OrderCollectionState, messageHistory?: any[]) {
  const agentTitle = agent.title || getDefaultTitle(agent.type || 'general')
  const dynamicShopName = shopName || 'notre boutique'

  // ✅ NOUVEAU : DÉTECTION DOMAINE BEAUTÉ
  const beautyDomain = detectBeautyDomain(agent.type || 'general', agentTitle)
  const beautyExpertise = getBeautyExpertise(beautyDomain)
  
  // ✅ NOUVEAU : Analyser l'historique des messages pour éviter les répétitions
  const hasGreeted = messageHistory && messageHistory.some(msg => 
    msg.role === 'assistant' && (
      msg.content.toLowerCase().includes('salut') || 
      msg.content.toLowerCase().includes('bonjour') || 
      msg.content.toLowerCase().includes('bonsoir')
    )
  )
  
  const hasIntroducedProduct = messageHistory && messageHistory.some(msg => 
    msg.role === 'assistant' && productInfo?.name && 
    msg.content.toLowerCase().includes(productInfo.name.toLowerCase())
  )
  
  const messageCount = messageHistory ? messageHistory.filter(msg => msg.role === 'assistant').length : 0
  
  const basePrompt = `Tu es ${agent.name}, ${agentTitle} experte en beauté chez ${dynamicShopName}.

🌟 EXPERTISE BEAUTÉ SPÉCIALISÉE : ${beautyExpertise.specialization}
💄 DOMAINE PRINCIPAL : ${beautyDomain}

✨ COMPÉTENCES EXPERTES BEAUTÉ :
${beautyExpertise.skills.map(skill => `- ${skill}`).join('\n')}

💡 APPROCHE CONSEIL BEAUTÉ :
- Qualification systématique (type de peau/cheveux, âge, routine, budget)
- Conseils adaptés au profil beauté unique de chaque cliente
- Explications des bénéfices produits avec expertise accessible
- Rassurance sur ingrédients, application, résultats
- Routines complètes selon les besoins et objectifs
- Upsell naturel vers gammes complémentaires

🎯 CONTEXTE CONVERSATION ACTUEL:
- Nombre de messages déjà échangés : ${messageCount}
- A déjà salué le client : ${hasGreeted ? 'OUI' : 'NON'}
- A déjà présenté le produit : ${hasIntroducedProduct ? 'OUI' : 'NON'}

💡 PERSONNALITÉ: ${agent.personality === 'friendly' ? 'Chaleureuse, bienveillante et authentique' : 'Professionnelle et experte'}
- Expert en techniques de vente beauté sans être agressive
- Bienveillante face aux complexes et valorise la beauté naturelle

🎯 RÈGLES ANTI-RÉPÉTITION STRICTES:
${hasGreeted ? '❌ NE PLUS SALUER - Tu as déjà dit bonjour/salut' : '✅ Tu peux saluer si c\'est ton premier message'}
${hasIntroducedProduct ? '❌ NE PLUS PRÉSENTER LE PRODUIT - Tu l\'as déjà fait' : '✅ Tu peux présenter le produit si pertinent'}

${productInfo ? `
💄 PRODUIT BEAUTÉ ANALYSÉ:
- **Nom**: ${productInfo.name}
- **Type**: ${getProductType(productInfo.name, agent.customProductType)}
- **Prix**: ${productInfo.price ? productInfo.price + ' CFA' : 'Prix sur demande'}
- **Analyse beauté**: ${analyzeBeautyProduct(productInfo.name)}
` : '🚨 AUCUNE INFORMATION PRODUIT - Demande quel produit l\'intéresse'}

📚 BASE DE CONNAISSANCE:
${knowledgeBase}

🚨 RÈGLES ABSOLUES BEAUTÉ:
- TOUJOURS qualifier avant conseiller (type peau, objectifs, budget)
- Expliquer les bénéfices avec expertise technique accessible
- Être bienveillante face aux complexes beauté
- Valoriser la beauté naturelle de chaque cliente
- ${hasGreeted ? 'NE PLUS JAMAIS re-saluer' : 'Saluer chaleureusement si premier message'}
- Maximum 150 mots pour rester efficace

${orderState ? `
📋 COLLECTE DE COMMANDE EN COURS:
Étape actuelle: ${orderState.step}
Données collectées: ${JSON.stringify(orderState.data, null, 2)}

PROCHAINE ÉTAPE:
${getDetailedStepInstructions(orderState.step, orderState.data)}
` : `
📋 PROCESSUS DE COLLECTE DE COMMANDE:
⚠️ COMMENCER SEULEMENT si le client manifeste un intérêt d'achat clair

PROCÉDURE STRICTE (dans cet ordre) :
1. **QUANTITÉ**: "Parfait ! Combien d'exemplaires souhaitez-vous ?"
2. **TÉLÉPHONE**: "Pour finaliser, quel est votre numéro ?"
3. **NOM/PRÉNOM**: "Votre nom complet pour la commande ?"
4. **ADRESSE**: "Adresse de livraison ?"
5. **PAIEMENT**: "Mode de paiement préféré ?"
6. **CONFIRMATION**: Résumer la commande
`}

Réponds avec l'expertise d'une vraie conseillère beauté passionnée ! 💫`;

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
    'acheter', 'commander', 'commande', 'achat', 'prendre', 'veux', 'souhaite',
    'vais prendre', 'je le veux', 'ça m\'intéresse', 'je vais l\'acheter',
    'comment faire', 'comment commander', 'comment acheter', 'comment procéder',
    'où acheter', 'comment passer commande', 'comment finaliser',
    'intéressé', 'intéresse', 'ça me plaît', 'parfait', 'c\'est bon', 
    'd\'accord', 'ok pour', 'je confirme', 'go', 'allons-y',
    'réserver', 'livraison', 'payer', 'finaliser', 'confirmer', 'valider',
    'continuer', 'suivant', 'étape suivante',
    'exemplaire', 'unité', 'pièce', 'fois'
  ];
  
  const lowerMessage = message.toLowerCase();
  const hasKeyword = orderKeywords.some(keyword => lowerMessage.includes(keyword));
  
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
      // ✅ CORRECTION : Patterns améliorés pour "un seul"
      const qtyPatterns = [
        /(\d+)\s*(?:exemplaires?|unités?|pièces?|fois)?/i,
        /\b(un|une)\s*(?:seule?|exemplaire|unité|pièce)?\b/i,
        /\b(deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\b/i,
        /\b(1|2|3|4|5|6|7|8|9|10)\b/,
        // ✅ NOUVEAU : Pattern spécifique pour "un seul"
        /\b(?:un|une)\s+seule?\b/i,
        /\bseule?ment\s+(?:un|une)\b/i,
        /\bjuste\s+(?:un|une)\b/i
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
      
      // ✅ CORRECTION : Fallback pour "un seul", "seulement un", etc.
      if (!data.quantity) {
        if (cleanMessage.includes('un seul') || cleanMessage.includes('une seule') || 
            cleanMessage.includes('seulement un') || cleanMessage.includes('juste un') ||
            cleanMessage.match(/\b(?:un|une)\b/) && (cleanMessage.includes('seul') || cleanMessage.includes('seule'))) {
          data.quantity = 1;
          console.log(`✅ [EXTRACT] Quantité extraite (expression "un seul"): 1`);
        } else {
          const simpleNumber = message.match(/\b(\d+)\b/);
          if (simpleNumber) {
            data.quantity = parseInt(simpleNumber[1]);
            console.log(`✅ [EXTRACT] Quantité extraite (fallback): ${data.quantity}`);
          }
        }
      }
      break;
      
    case 'phone':
      const phonePatterns = [
        /(?:\+?221[\s\-]?)([0-9\s\-\(\)]{8,})/g,
        /(?:\+?33[\s\-]?)([0-9\s\-\(\)]{8,})/g,
        /([0-9\s\-\(\)+]{8,})/g
      ];
      
      for (const pattern of phonePatterns) {
        const match = message.match(pattern);
        if (match) {
          let cleanPhone = match[0].replace(/[\s\-\(\)]/g, '');
          
          if (cleanPhone.length >= 8 && cleanPhone.length <= 15) {
            data.customerPhone = cleanPhone;
            console.log(`✅ [EXTRACT] Téléphone extrait: ${data.customerPhone}`);
            break;
          }
        }
      }
      break;
      
    case 'name':
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
      .select('customer_name, customer_address, customer_email')
      .eq('customer_phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (error || !existingOrder || !existingOrder.customer_name) {
      return { exists: false };
    }
    
    const firstName = existingOrder.customer_name.split(' ')[0];
    return {
      exists: true,
      firstName: firstName,
      lastName: existingOrder.customer_name.split(' ').slice(1).join(' '),
      address: existingOrder.customer_address,
      email: existingOrder.customer_email
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
        shop_id: shopId,
        conversation_id: conversationId,
        customer_name: orderData.customerFirstName && orderData.customerLastName 
          ? `${orderData.customerFirstName} ${orderData.customerLastName}`
          : orderData.customerFirstName || null,
        customer_phone: orderData.customerPhone || null,
        customer_email: orderData.customerEmail || null,
        customer_address: orderData.customerAddress || null,
        product_items: {
          productId: productInfo?.id || orderData.productId,
          productName: productInfo?.name || orderData.productName,
          productPrice: productInfo?.price || orderData.productPrice,
          quantity: orderData.quantity || 1
        },
        total_amount: (productInfo?.price || 0) * (orderData.quantity || 1),
        currency: 'CFA',
        payment_method: orderData.paymentMethod || null,
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

// ✅ FONCTION AMÉLIORÉE : Appeler GPT-4o-mini AVEC ANTI-RÉPÉTITION
async function callOpenAI(messages: any[], agentConfig: any, knowledgeBase: string, shopName: string, productInfo?: any, orderState?: OrderCollectionState): Promise<OpenAIResult> {
  try {
    console.log('🤖 [OPENAI] Début traitement anti-répétition:', {
      orderState: orderState?.step,
      orderData: orderState?.data,
      productInfo: productInfo?.name,
      messageCount: messages.length,
      shopName: shopName
    });

    if (!process.env.OPENAI_API_KEY) {
      console.warn('⚠️ OpenAI API Key manquante');
      return {
        success: false,
        error: 'Configuration OpenAI manquante',
        fallbackMessage: "Je rencontre un problème technique temporaire. Comment puis-je vous aider autrement ?"
      };
    }

    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
    console.log('📝 [OPENAI] Dernier message utilisateur:', lastUserMessage);

    let existingCustomer = null;
    if (orderState?.step === 'phone' && orderState.data.customerPhone) {
      existingCustomer = await checkExistingCustomer(orderState.data.customerPhone);
      console.log('🔍 [OPENAI] Vérification client existant:', existingCustomer);
    }

    // ✅ NOUVEAU : Construire prompt avec shopName dynamique
    const systemPrompt = buildAgentPrompt(agentConfig, knowledgeBase, shopName, productInfo, orderState, messages);

    console.log('🤖 [OPENAI] Appel OpenAI avec model: gpt-4o, messages:', messages.length);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o", // ✅ UPGRADE VERS GPT-4O
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ],
      max_tokens: 300,
      temperature: 0.7,
      presence_penalty: 0.5,
      frequency_penalty: 0.5
    });

    console.log('✅ [OPENAI] Réponse reçue, choices:', completion.choices?.length);

    let response = completion.choices[0]?.message?.content || "Je n'ai pas pu générer de réponse.";
    response = formatAIResponse(response);

    console.log('🤖 [OPENAI] Réponse générée:', response.substring(0, 150) + '...');

    // ✅ GESTION DE LA COLLECTE DE COMMANDES
    let newOrderState: OrderCollectionState | undefined;
    let isOrderIntent = false;

    if (orderState) {
      console.log(`📋 [ORDER] En cours de collecte, étape: ${orderState.step}`);
      
      const extractedData = extractOrderData(lastUserMessage, orderState.step);
      console.log('📊 [ORDER] Données extraites:', extractedData);
      
      const updatedData = { ...orderState.data, ...extractedData };
      console.log('📋 [ORDER] Données mises à jour:', updatedData);
      
      if (orderState.step === 'phone' && existingCustomer?.exists && extractedData.customerPhone) {
        console.log('👥 [ORDER] Client existant détecté, ajout des données');
        updatedData.customerFirstName = existingCustomer.firstName;
        updatedData.customerLastName = existingCustomer.lastName;
        updatedData.customerAddress = existingCustomer.address;
        updatedData.customerEmail = existingCustomer.email;
        
        const nextStep = existingCustomer.address ? 'payment' : 'address';
        
        newOrderState = {
          step: nextStep,
          data: updatedData
        };
        
        if (existingCustomer.firstName) {
          response = `Heureux de vous revoir, ${existingCustomer.firstName} ! 😊\n\n` + response;
        }
        
        console.log(`✅ [ORDER] Client existant, passage direct à: ${nextStep}`);
      } else {
        const nextStep = getNextOrderStep(orderState.step, updatedData);
        console.log(`🔄 [ORDER] Progression normale: ${orderState.step} → ${nextStep}`);
        
        newOrderState = {
          step: nextStep,
          data: updatedData
        };
      }
      
    } else {
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
    console.error('❌ [OPENAI] Erreur complète:', {
      message: error.message,
      code: error.code,
      type: error.type,
      status: error.status,
      response: error.response?.data
    });

    if (error.code === 'insufficient_quota' || error.status === 429) {
      console.error('💰 [OPENAI] Quota dépassé ou rate limit atteint');
      return {
        success: false,
        error: 'Quota OpenAI dépassé ou rate limit',
        fallbackMessage: "Je transmets votre question à notre équipe, un conseiller vous recontactera bientôt."
      };
    }

    if (error.code === 'invalid_api_key' || error.status === 401) {
      console.error('🔑 [OPENAI] Clé API invalide ou expirée');
      return {
        success: false,
        error: 'Clé API OpenAI invalide',
        fallbackMessage: "Je rencontre un problème de configuration temporaire."
      };
    }

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

// ✅ CORRECTION MAJEURE : MESSAGE D'ACCUEIL AVEC PRIORITÉ AU MESSAGE PERSONNALISÉ
function generateWelcomeMessage(agent: any, productInfo?: any, shopName: string = "notre boutique", customProductType?: string): string {
  const baseName = agent.name || 'Assistant'
  const baseTitle = agent.title || getDefaultTitle(agent.type || 'general')
  const greeting = getTimeBasedGreeting()
  const dynamicShopName = shopName || 'notre boutique'
  
  // ✅ PRIORITÉ 1 : MESSAGE PERSONNALISÉ DE L'UTILISATEUR
  if (agent.welcome_message && agent.welcome_message.trim()) {
    console.log('📝 [WELCOME] Utilisation message personnalisé utilisateur');
    
    // Préparer variables pour remplacement
    const variables = {
      agentName: baseName,
      agentTitle: baseTitle,
      shopName: dynamicShopName,
      productName: productInfo?.name || 'Nom du Produit',
      productType: getProductType(productInfo?.name || '', customProductType),
      greeting: greeting,
      productPrice: productInfo?.price ? `${productInfo.price} CFA` : ''
    };
    
    // Remplacer les variables dans le message personnalisé
    return replaceMessageVariables(agent.welcome_message, variables);
  }
  
  // ✅ PRIORITÉ 2 : MESSAGE GÉNÉRÉ AUTOMATIQUEMENT
  console.log('📝 [WELCOME] Utilisation message généré automatiquement');
  
  if (productInfo?.name) {
    const productType = getProductType(productInfo.name, customProductType)
    
    return `${greeting} 👋 Je suis ${baseName}, ${baseTitle} chez ${dynamicShopName}.

Je vois que vous vous intéressez à notre ${productType} **"${productInfo.name}"**. Excellent choix ! ✨

Comment puis-je vous aider avec ce ${productType} ? 😊`
  }
  
  return `${greeting} 👋 Je suis ${baseName}, ${baseTitle} chez ${dynamicShopName}.

Quel produit vous intéresse aujourd'hui ? Je serais ravi(e) de vous renseigner ! 😊`
}

// ✅ RÉPONSE SIMULÉE CORRIGÉE DYNAMIQUE POUR DEMO
function getIntelligentSimulatedResponse(message: string, productInfo: any, agentName: string = "Assistant", agentTitle: string = "Conseiller", shopName: string = "notre boutique", messageCount: number = 0, customProductType?: string): string {
  const msg = message.toLowerCase();
  const dynamicShopName = shopName || 'notre boutique'
  
  // ✅ Premier message = Accueil avec produit
  if (messageCount === 0 || msg.includes('bonjour') || msg.includes('salut') || msg.includes('hello')) {
    if (productInfo?.name) {
      const productType = getProductType(productInfo.name, customProductType)
      return `${getTimeBasedGreeting()} 👋 Je suis ${agentName}, ${agentTitle} chez ${dynamicShopName}.

Je vois que vous vous intéressez à notre ${productType} **"${productInfo.name}"**. Excellent choix ! ✨

Comment puis-je vous aider avec ce ${productType} ? 😊`
    }
    
    return `${getTimeBasedGreeting()} 👋 Je suis ${agentName}, ${agentTitle} chez ${dynamicShopName}.

Quel produit vous intéresse aujourd'hui ? 😊`
  }
  
  // ✅ Messages suivants = Réponses directes sans re-saluer
  if (msg.includes('prix') || msg.includes('coût') || msg.includes('tarif')) {
    if (productInfo?.price) {
      return `**"${productInfo.name}"** est à **${productInfo.price} CFA**. 💰

C'est un excellent rapport qualité-prix ! Souhaitez-vous le commander ? 🛒`;
    }
    return "Je vais vérifier le prix pour vous. Un instant... 🔍";
  }
  
  if (msg.includes('acheter') || msg.includes('commander') || msg.includes('commande')) {
    return `Parfait ! Je vais vous aider à finaliser votre commande. ✨

**Combien d'exemplaires** souhaitez-vous ? 📦`;
  }
  
  if (msg.includes('info') || msg.includes('détail') || msg.includes('caractéristique')) {
    const productType = getProductType(productInfo?.name || '', customProductType)
    return `**"${productInfo?.name || 'Ce produit'}"** est un excellent ${productType} ! 👌

${productInfo?.name?.includes('couple') ? 'Parfait pour renforcer votre complicité' : 'C\'est l\'un de nos produits les plus appréciés'}.

Souhaitez-vous le commander ? 😊`;
  }
  
  return `Merci pour votre question ! ${productInfo?.name ? `Concernant **"${productInfo.name}"**,` : ''} comment puis-je vous aider davantage ? 😊`;
}

export default async function publicRoutes(fastify: FastifyInstance) {

  // ✅ ROUTES PUBLIQUES (préfixe /api/v1/public défini dans server.ts)

  // ✅ ROUTE DEBUG POUR VÉRIFIER FONCTIONNEMENT
  fastify.get('/debug/:shopId', async (request, reply) => {
    const { shopId } = request.params as any;

    // Récupérer les infos de debug
    let shopInfo = null;
    let agentsInfo: any[] = [];
    let shopError = null;
    let agentError = null;

    try {
      // Vérifier le shop
      const { data: shop, error: sErr } = await supabaseServiceClient
        .from('shops')
        .select('id, name, is_active, widget_config, agent_config')
        .eq('id', shopId)
        .single();

      shopInfo = shop;
      shopError = sErr?.message;

      // Vérifier les agents (sans filtre is_active pour debug)
      const { data: agents, error: aErr } = await supabaseServiceClient
        .from('agents')
        .select('id, name, title, shop_id, is_active, welcome_message, config')
        .eq('shop_id', shopId);

      agentsInfo = agents || [];
      agentError = aErr?.message;

    } catch (e: any) {
      console.error('Debug error:', e);
    }

    return {
      success: true,
      message: 'Route publique debug',
      shopId: shopId,
      timestamp: new Date().toISOString(),
      debug: {
        shop: shopInfo ? {
          id: shopInfo.id,
          name: shopInfo.name,
          isActive: shopInfo.is_active,
          hasWidgetConfig: !!shopInfo.widget_config,
          widgetConfig: shopInfo.widget_config
        } : null,
        shopError,
        agents: agentsInfo.map((a: any) => ({
          id: a.id,
          name: a.name,
          title: a.title,
          shopId: a.shop_id,
          isActive: a.is_active,
          hasWelcomeMessage: !!a.welcome_message,
          hasConfig: !!a.config,
          configWidget: a.config?.widget
        })),
        agentCount: agentsInfo.length,
        activeAgentCount: agentsInfo.filter((a: any) => a.is_active).length,
        agentError
      },
      routes: {
        config: `/api/v1/public/shops/${shopId}/config`,
        chat: '/api/v1/public/chat'
      }
    }
  })

  // ✅ ROUTE : Configuration publique AVEC NOM DYNAMIQUE ET customProductType
  fastify.get<{ Params: ShopParamsType }>('/shops/:shopId/config', async (request, reply) => {
    try {
      const { shopId } = request.params;
      fastify.log.info(`🔍 [PUBLIC CONFIG] Récupération config pour shop: ${shopId}`);
      
      if (!isValidUUID(shopId)) {
        fastify.log.warn(`⚠️ ShopId non-UUID détecté: ${shopId}, utilisation configuration fallback`);
        return getFallbackShopConfig(shopId);
      }
      
      const { data: shop, error: shopError } = await supabaseServiceClient
        .from('shops')
        .select('id, name, is_active, widget_config, agent_config')
        .eq('id', shopId)
        .single();

      if (shopError || !shop || !shop.is_active) {
        fastify.log.warn(`⚠️ Shop non trouvé ou inactif: ${shopId}, utilisation configuration fallback`);
        return getFallbackShopConfig(shopId);
      }

      // ✅ CORRECTION MAJEURE : Requête simple sans jointures imbriquées
      // Note: .select('*') fonctionne là où .select('colonnes spécifiques') échouait silencieusement
      const { data: allAgents, error: agentError } = await supabaseServiceClient
        .from('agents')
        .select('*')
        .eq('shop_id', shopId);

      if (agentError) {
        fastify.log.error(`❌ [PUBLIC CONFIG] Erreur requête agents: ${agentError.message}`);
      }

      // Filtrer les agents actifs côté serveur
      const activeAgents = (allAgents || []).filter((a: any) => a.is_active === true);
      const agent = activeAgents.length > 0 ? activeAgents[0] : null;

      fastify.log.info(`🔍 [PUBLIC CONFIG] Shop: ${shopId}, Agent trouvé: ${agent ? agent.name : 'aucun'}`);

      // ✅ Si agent trouvé, récupérer sa base de connaissances séparément
      let knowledgeBaseData: any[] = [];
      if (agent) {
        const { data: kbRelations } = await supabaseServiceClient
          .from('agent_knowledge_base')
          .select(`
            knowledge_base(
              id, title, content, content_type, tags
            )
          `)
          .eq('agent_id', agent.id);

        knowledgeBaseData = kbRelations || [];
        fastify.log.info(`📚 [PUBLIC CONFIG] Documents knowledge base: ${knowledgeBaseData.length}`);
      }

      if (!agent) {
        fastify.log.warn(`⚠️ [PUBLIC CONFIG] Aucun agent actif trouvé pour shop: ${shopId}`);
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

      // ✅ Gérer le cas où il n'y a pas de documents de base de connaissances
      // Utiliser knowledgeBaseData récupéré séparément
      const knowledgeContent = knowledgeBaseData
        .filter((akb: any) => akb.knowledge_base)
        .map((akb: any) => `## ${akb.knowledge_base.title}\n${akb.knowledge_base.content}`)
        .join('\n\n---\n\n');

      // ✅ FUSION : Priorité à la config widget de l'agent (Dashboard) sur celle du shop
      const agentWidgetConfig = (agent.config as any)?.widget || {};
      const shopWidgetConfig = shop.widget_config || {};
      const mergedWidgetConfig = {
        ...shopWidgetConfig,
        ...agentWidgetConfig
      };

      fastify.log.info(`🎨 [PUBLIC CONFIG] Widget config fusionnée - shop: ${JSON.stringify(shopWidgetConfig)}, agent: ${JSON.stringify(agentWidgetConfig)}, merged: ${JSON.stringify(mergedWidgetConfig)}`);

      const response = {
        success: true,
        data: {
          shop: {
            id: shop.id,
            name: shop.name,
            widgetConfig: mergedWidgetConfig,
            agentConfig: shop.agent_config
          },
          agent: {
            id: agent.id,
            name: agent.name,
            title: agent.title || getDefaultTitle(agent.type || 'general'),
            type: agent.type,
            personality: agent.personality,
            description: agent.description,
            welcomeMessage: agent.welcome_message,
            fallbackMessage: agent.fallback_message,
            avatar: agent.avatar,
            config: agent.config,
            productType: agent.product_type,
            customProductType: agent.custom_product_type
          },
          knowledgeBase: {
            content: knowledgeContent || '',
            documentsCount: knowledgeBaseData.filter((akb: any) => akb.knowledge_base).length,
            documents: knowledgeBaseData
              .filter((akb: any) => akb.knowledge_base)
              .map((akb: any) => ({
                id: akb.knowledge_base.id,
                title: akb.knowledge_base.title,
                contentType: akb.knowledge_base.content_type,
                tags: akb.knowledge_base.tags
              }))
          }
        }
      };

      fastify.log.info(`✅ [PUBLIC CONFIG] Configuration envoyée pour ${shopId} - Agent: ${response.data.agent.name} (${response.data.agent.title}), Shop: ${response.data.shop.name}, Documents: ${response.data.knowledgeBase.documentsCount}, CustomProductType: ${response.data.agent.customProductType || 'aucun'}`);

      return response;

    } catch (error: any) {
      fastify.log.error(`❌ [PUBLIC CONFIG] Erreur: ${error.message}`);
      fastify.log.warn(`⚠️ Fallback activé pour shop ${request.params.shopId}`);
      return getFallbackShopConfig(request.params.shopId);
    }
  });

  // ✅ ROUTE : Chat public AVEC MESSAGE D'ACCUEIL PERSONNALISÉ PRIORITAIRE
  fastify.post<{ Body: ChatRequestBody }>('/chat', async (request, reply) => {
    const startTime = Date.now();
    
    try {
      const { shopId, message, conversationId, productInfo, visitorId, isFirstMessage } = request.body;
      
      fastify.log.info(`💬 [PUBLIC CHAT] Nouveau message pour shop: ${shopId}${isFirstMessage ? ' (premier message)' : ''}`);
      
      if (!shopId || !message) {
        return reply.status(400).send({ 
          success: false, 
          error: 'shopId et message requis' 
        });
      }

      // ✅ MODE TEST CORRIGÉ AVEC NOM GÉNÉRIQUE
      if (!isValidUUID(shopId)) {
        fastify.log.info(`💬 [MODE TEST] Réponse simulée intelligente pour shop: ${shopId}`);
        
        const agentName = "Assistant";
        const agentTitle = "Conseiller";
        const shopName = "Ma Boutique";
        let simulatedResponse = '';
        
        const messageCount = request.headers['x-message-count'] ? parseInt(request.headers['x-message-count'] as string) : 0
        
        if (isFirstMessage && productInfo?.name) {
          const productType = getProductType(productInfo.name)
          simulatedResponse = `${getTimeBasedGreeting()} 👋 Je suis ${agentName}, ${agentTitle} chez ${shopName}.

Je vois que vous vous intéressez à notre ${productType} **"${productInfo.name}"**. Excellent choix ! ✨

Comment puis-je vous aider avec ce ${productType} ? 😊`;
        } else {
          simulatedResponse = getIntelligentSimulatedResponse(message, productInfo, agentName, agentTitle, shopName, messageCount);
        }
        
        return {
          success: true,
          data: {
            conversationId: conversationId || `test-conv-${Date.now()}`,
            message: simulatedResponse,
            agent: {
              name: agentName,
              title: agentTitle,
              avatar: "https://ui-avatars.com/api/?name=Assistant&background=8B5CF6&color=fff"
            },
            responseTime: Date.now() - startTime,
            isWelcomeMessage: isFirstMessage,
            mode: 'test'
          }
        };
      }
      
      // ✅ VÉRIFICATION SHOP AVEC SUPABASE ET RÉCUPÉRATION NOM
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

      // ✅ CORRECTION MAJEURE : Requête simple sans colonnes spécifiques (même fix que /config)
      const { data: allAgents, error: agentError } = await supabaseServiceClient
        .from('agents')
        .select('*')
        .eq('shop_id', shopId);

      // Filtrer les agents actifs côté serveur
      const activeAgents = (allAgents || []).filter((a: any) => a.is_active === true);
      const agent = activeAgents.length > 0 ? activeAgents[0] : null;

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

      // ✅ CORRECTION CRITIQUE : PREMIER MESSAGE AVEC PRIORITÉ AU MESSAGE PERSONNALISÉ
      if (isFirstMessage) {
        const welcomeMessage = generateWelcomeMessage(
          agent, 
          productInfo, 
          shopConfig.name, 
          agent.custom_product_type
        );
        
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

        fastify.log.info(`✅ [WELCOME] Message d'accueil personnalisé envoyé pour conversation: ${conversation.id} - Shop: ${shopConfig.name}`);

        return {
          success: true,
          data: {
            conversationId: conversation.id,
            message: welcomeMessage,
            agent: {
              name: agent.name,
              title: agent.title,
              avatar: agent.avatar
            },
            responseTime: Date.now() - startTime,
            isWelcomeMessage: true
          }
        };
      }

      // ✅ GESTION CONVERSATION EXISTANTE AVEC HISTORIQUE
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

      // ✅ RÉCUPÉRER ÉTAT COLLECTE COMMANDE
      let orderState: OrderCollectionState | undefined;
      
      try {
        const customerData = conversation.customer_data as any;
        if (customerData?.orderCollection) {
          orderState = customerData.orderCollection;
        }
      } catch (error) {
        console.warn('Erreur lecture customerData conversation:', error);
      }

      // ✅ PRÉPARER HISTORIQUE MESSAGES POUR ANTI-RÉPÉTITION
      const messageHistory = conversation.messages?.map((msg: any) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      })) || [];

      messageHistory.push({ role: 'user', content: message });

      // ✅ APPELER IA AVEC NOM DYNAMIQUE ET customProductType
      const shopName = shopConfig.name || 'notre boutique'
      console.log('🏪 [SHOP NAME] Nom boutique utilisé:', shopName)

      const aiResult = await callOpenAI(messageHistory, agent, knowledgeContent, shopName, productInfo, orderState);

      console.log('🤖 [IA RESULT]:', {
        success: aiResult.success,
        hasMessage: !!aiResult.message,
        hasFallback: !!aiResult.fallbackMessage,
        error: aiResult.error,
        messagePreview: aiResult.message?.substring(0, 100)
      });

      let aiResponse: string;
      let tokensUsed: number = 0;

      if (aiResult.success && aiResult.message) {
        aiResponse = aiResult.message;
        tokensUsed = aiResult.tokensUsed || 0;
        fastify.log.info(`✅ [IA SUCCESS] Réponse générée avec succès (${tokensUsed} tokens)`);
      } else {
        // ✅ CORRECTION : Utiliser le fallback seulement en cas d'échec
        aiResponse = aiResult.fallbackMessage || agent.fallback_message || "Je transmets votre question à notre équipe.";
        fastify.log.error(`❌ [IA ERROR]: ${aiResult.error || 'Erreur inconnue'} - Utilisation fallback`);
      }

      // ✅ SAUVEGARDER ÉTAT COLLECTE AVEC SUPABASE
      if (aiResult.orderCollection) {
        await supabaseServiceClient
          .from('conversations')
          .update({
            customer_data: {
              orderCollection: aiResult.orderCollection
            } as any
          })
          .eq('id', conversation.id);

        if (aiResult.orderCollection.step === 'completed') {
          try {
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
        model_used: 'gpt-4o' // ✅ UPGRADE VERS GPT-4O
      });

      fastify.log.info(`✅ [CHAT SUCCESS] Réponse intelligente envoyée pour conversation: ${conversation.id} (${Date.now() - startTime}ms) - Shop: ${shopConfig.name}`);

      return {
        success: true,
        data: {
          conversationId: conversation.id,
          message: aiResponse,
          agent: {
            name: agent.name,
            title: agent.title,
            avatar: agent.avatar
          },
          responseTime: Date.now() - startTime,
          tokensUsed,
          orderCollection: aiResult.orderCollection
        }
      };

    } catch (error: any) {
      fastify.log.error(`❌ [CHAT ERROR]: ${error.message || 'Erreur inconnue'}`);
      
      // ✅ FALLBACK CONTEXTUEL INTELLIGENT GÉNÉRIQUE
      const userMessage = request.body.message || '';
      const productInfo = request.body.productInfo;
      const isFirstMessage = request.body.isFirstMessage;
      const agentName = "Assistant";
      const agentTitle = "Conseiller";
      const shopName = "notre boutique";
      
      let fallbackResponse = `Merci pour votre message ! Je suis ${agentName}, votre ${agentTitle}. Comment puis-je vous aider davantage ?`;
      
      if (isFirstMessage && productInfo?.name) {
        const productType = getProductType(productInfo.name)
        fallbackResponse = `${getTimeBasedGreeting()} 👋 Je suis ${agentName}, votre ${agentTitle} chez ${shopName}. Je vois que vous vous intéressez à notre ${productType} "${productInfo.name}". Comment puis-je vous aider ?`;
      } else if (userMessage.toLowerCase().includes('bonjour') || userMessage.toLowerCase().includes('salut')) {
        fallbackResponse = `${getTimeBasedGreeting()} ! Je suis ${agentName}, votre ${agentTitle} chez ${shopName}. Comment puis-je vous aider ?`;
      } else if (productInfo?.name) {
        fallbackResponse = `Concernant "${productInfo.name}", je vous mets en relation avec notre équipe pour vous donner les meilleures informations.`;
      }
      
      return {
        success: true,
        data: {
          conversationId: request.body.conversationId || `fallback-conv-${Date.now()}`,
          message: fallbackResponse,
          agent: {
            name: agentName,
            title: agentTitle,
            avatar: "https://ui-avatars.com/api/?name=Assistant&background=8B5CF6&color=fff"
          },
          responseTime: Date.now() - startTime,
          mode: 'fallback'
        }
      };
    }
  });
}
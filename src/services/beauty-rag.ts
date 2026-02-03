// src/services/beauty-rag.ts
// 🎯 Système RAG (Retrieval Augmented Generation) spécialisé beauté
// Charge les bases de connaissances et effectue la recherche contextuelle

import africanIngredientsData from '../data/african_ingredients_v1.json';
import beautyKnowledgeData from '../data/beauty_knowledge_base.json';

// ✅ INTERFACES
interface AfricanIngredient {
  noms_communs: string;
  nom_scientifique: string;
  origine: string;
  noms_locaux: string[];
  proprietes_cosmetiques: {
    peau?: string[];
    cheveux?: string[];
  };
  actifs_principaux: string[];
  usage_traditionnel: string;
  contre_indications: string;
  types_peau_recommandes: string[];
  formes_utilisation: string[];
}

interface Ingredient {
  nom: string;
  fonction: string;
  types_peau: string[];
  contre_indications: string;
  usage: string;
  concentration_ideale?: string;
}

interface Problematique {
  description: string;
  causes: string[];
  ingredients_recommandes: string[];
  routine: string;
  timeline_resultats?: string;
  conseils_specifiques?: string;
}

// ✅ CHARGEMENT DES BASES DE CONNAISSANCES
const africanIngredients = africanIngredientsData.african_ingredients as Record<string, AfricanIngredient>;
const beautyKnowledge = beautyKnowledgeData as {
  ingredients: Record<string, Ingredient>;
  problematiques: Record<string, Problematique>;
  types_cheveux: any;
  routines_specifiques: any;
  types_peau: any;
  glossaire_beaute: Record<string, string>;
};

console.log(`✅ [BEAUTY RAG] ${Object.keys(africanIngredients).length} ingrédients africains chargés`);
console.log(`✅ [BEAUTY RAG] ${Object.keys(beautyKnowledge.ingredients).length} ingrédients cosmétiques chargés`);

/**
 * 🔍 RECHERCHE CONTEXTUELLE AVEC PRIORITÉ INGRÉDIENTS AFRICAINS
 * @param userMessage - Message de l'utilisateur
 * @param productCatalog - Catalogue produits de la marque (optionnel)
 * @returns Contexte pertinent formaté
 */
export function getRelevantContext(userMessage: string, productCatalog: any[] = []): string {
  const context: string[] = [];
  const messageLower = userMessage.toLowerCase();

  console.log(`🔍 [RAG] Recherche contextuelle pour: "${userMessage.substring(0, 50)}..."`);

  // ========================================
  // 1️⃣ PRIORITÉ : INGRÉDIENTS AFRICAINS
  // ========================================
  let africanCount = 0;
  for (const [key, ingredient] of Object.entries(africanIngredients)) {
    let found = false;

    // Recherche par clé (ex: "bissap", "karite")
    if (messageLower.includes(key.replace('_', ' '))) {
      found = true;
    }

    // Recherche par nom scientifique
    if (!found && ingredient.nom_scientifique && messageLower.includes(ingredient.nom_scientifique.toLowerCase())) {
      found = true;
    }

    // Recherche par noms communs
    if (!found) {
      const nomsCommuns = ingredient.noms_communs.split(', ');
      for (const nom of nomsCommuns) {
        if (messageLower.includes(nom.toLowerCase())) {
          found = true;
          break;
        }
      }
    }

    // Recherche par noms locaux
    if (!found && ingredient.noms_locaux) {
      for (const nomLocal of ingredient.noms_locaux) {
        const nomClean = nomLocal.toLowerCase().split('(')[0].trim();
        if (messageLower.includes(nomClean)) {
          found = true;
          break;
        }
      }
    }

    if (found) {
      context.push(formatAfricanIngredient(ingredient));
      africanCount++;
    }
  }

  if (africanCount > 0) {
    console.log(`✅ [RAG] ${africanCount} ingrédient(s) africain(s) trouvé(s)`);
  }

  // ========================================
  // 2️⃣ INGRÉDIENTS COSMÉTIQUES GÉNÉRAUX (avec synonymes)
  // ========================================
  let cosmeticCount = 0;

  // Mapping ingrédients -> synonymes
  const ingredientSynonyms: Record<string, string[]> = {
    'retinol': ['rétinol', 'retinol', 'vitamine a'],
    'acide_hyaluronique': ['acide hyaluronique', 'hyaluronic', 'ah'],
    'niacinamide': ['niacinamide', 'vitamine b3', 'nicotinamide'],
    'vitamine_c': ['vitamine c', 'acide ascorbique', 'ascorbic'],
    'acide_salicylique': ['acide salicylique', 'bha', 'salicylic'],
    'acide_glycolique': ['acide glycolique', 'aha', 'glycolic']
  };

  for (const [key, ingredient] of Object.entries(beautyKnowledge.ingredients)) {
    const keyNormalized = key.replace(/_/g, ' ');
    const synonyms = ingredientSynonyms[key] || [keyNormalized, ingredient.nom.toLowerCase()];

    const found = synonyms.some(synonym => messageLower.includes(synonym.toLowerCase()));

    if (found) {
      context.push(formatIngredient(ingredient));
      cosmeticCount++;
    }
  }

  if (cosmeticCount > 0) {
    console.log(`✅ [RAG] ${cosmeticCount} ingrédient(s) cosmétique(s) trouvé(s)`);
  }

  // ========================================
  // 3️⃣ PROBLÉMATIQUES BEAUTÉ (avec synonymes)
  // ========================================
  let problemCount = 0;

  // Mapping problématiques -> mots-clés de détection
  const problemKeywords: Record<string, string[]> = {
    'hyperpigmentation': ['tache', 'taches', 'hyperpigmentation', 'pigmentation', 'marque', 'marques'],
    'acne': ['acné', 'acne', 'bouton', 'boutons', 'imperfection', 'imperfections', 'point noir', 'comédon'],
    'secheresse': ['sèche', 'seche', 'sécheresse', 'tiraille', 'déshydraté', 'deshydrate'],
    'vergetures': ['vergeture', 'vergetures', 'strie', 'stries'],
    'melasma': ['mélasma', 'melasma', 'masque de grossesse', 'grossesse', 'tache brune', 'taches brunes'],
    'peau_sensible': ['sensible', 'réactive', 'reactive', 'rougeur', 'rougeurs', 'irritation', 'irritée']
  };

  for (const [key, problematique] of Object.entries(beautyKnowledge.problematiques)) {
    const keywords = problemKeywords[key] || [key];
    const found = keywords.some(keyword => messageLower.includes(keyword.toLowerCase()));

    if (found) {
      context.push(formatProblematique(key, problematique));
      problemCount++;
    }
  }

  if (problemCount > 0) {
    console.log(`✅ [RAG] ${problemCount} problématique(s) identifiée(s)`);
  }

  // ========================================
  // 4️⃣ TYPES DE CHEVEUX ET PROBLÉMATIQUES CAPILLAIRES
  // ========================================
  const isHairRelated = messageLower.includes('cheveux') || messageLower.includes('cheveu') ||
      messageLower.includes('capillaire') || messageLower.includes('4a') ||
      messageLower.includes('4b') || messageLower.includes('4c') ||
      messageLower.includes('crépu') || messageLower.includes('frisé') ||
      messageLower.includes('tresse') || messageLower.includes('chute') ||
      messageLower.includes('casse') || messageLower.includes('cassant') ||
      messageLower.includes('alopécie') || messageLower.includes('perte');

  if (isHairRelated) {
    // Problématiques capillaires spécifiques
    if (messageLower.includes('cassant') || messageLower.includes('casse') ||
        messageLower.includes('tresse') || messageLower.includes('alopécie')) {
      context.push(`💇 PROBLÉMATIQUE CAPILLAIRE : Casse et Alopécie de Traction
Description : Cheveux cassants et fragilisés suite aux coiffures protectrices (tresses, vanilles, tissages)
Causes : Tension excessive, manipulation répétée, manque d'hydratation, carence en protéines
Besoins : Hydratation profonde, protéines pour renforcer, scellage, repos capillaire
Ingrédients recommandés : Ricin noir, Fenugrec, Aloe vera, Protéines de soie, Beurre de karité
Routine suggérée : Pre-poo huile chaude + Shampoing doux + Masque protéiné 1x/semaine + Leave-in riche + Huile scellante
Timeline résultats : 4-8 semaines avec manipulation minimale
Conseils : Éviter coiffures trop serrées, espacer les tresses, protéger la nuit (bonnet satin)`);
    }

    if (messageLower.includes('chute') || messageLower.includes('tombe') || messageLower.includes('perte')) {
      context.push(`💇 PROBLÉMATIQUE CAPILLAIRE : Chute de Cheveux
Description : Perte excessive de cheveux
Causes : Stress, hormones, carence nutritionnelle, manipulation excessive, produits agressifs
Ingrédients stimulants : Ricin noir, Fenugrec, Moringa, Bissap, Neem, Romarin
Routine : Massage cuir chevelu + Huile stimulante + Alimentation riche en fer/protéines
Timeline : 3-6 mois minimum pour voir résultats`);
    }

    // Types de cheveux
    for (const [type, data] of Object.entries(beautyKnowledge.types_cheveux)) {
      if (messageLower.includes(type.toLowerCase())) {
        context.push(formatTypeCheveux(type, data));
      }
    }
  }

  // ========================================
  // 5️⃣ RECHERCHE DANS LE CATALOGUE PRODUITS
  // ========================================
  if (productCatalog && productCatalog.length > 0) {
    const relevantProducts = searchProducts(messageLower, productCatalog);
    if (relevantProducts.length > 0) {
      console.log(`✅ [RAG] ${relevantProducts.length} produit(s) pertinent(s) trouvé(s)`);
      context.push(formatProducts(relevantProducts));
    }
  }

  // ========================================
  // 6️⃣ RETOUR CONTEXTE OU MESSAGE PAR DÉFAUT
  // ========================================
  if (context.length === 0) {
    console.log('⚠️ [RAG] Aucun contexte spécifique trouvé');
    return `⚠️ AUCUN CONTEXTE SPÉCIFIQUE TROUVÉ

IMPORTANT : Aucun produit ou information spécifique n'a été trouvé dans la base de connaissances pour cette requête.
- Tu peux donner des conseils beauté GÉNÉRAUX basés sur tes connaissances en cosmétologie
- Tu NE PEUX PAS recommander de produit spécifique (aucun n'est listé)
- Si la cliente demande un produit, dis : "Je n'ai pas de produit spécifique à te recommander pour le moment. Peux-tu me donner plus de détails sur tes besoins ?"`;
  }

  console.log(`✅ [RAG] ${context.length} élément(s) de contexte retournés`);
  return context.join('\n\n---\n\n');
}

/**
 * 📝 FORMATTE UN INGRÉDIENT AFRICAIN POUR LE CONTEXTE
 */
function formatAfricanIngredient(ingredient: AfricanIngredient): string {
  let formatted = `🌍 INGRÉDIENT AFRICAIN : ${ingredient.noms_communs}\n`;
  formatted += `Nom scientifique : ${ingredient.nom_scientifique}\n`;
  formatted += `Origine : ${ingredient.origine}\n`;
  formatted += `Noms locaux : ${ingredient.noms_locaux.join(', ')}\n\n`;

  if (ingredient.proprietes_cosmetiques.peau && ingredient.proprietes_cosmetiques.peau.length > 0) {
    formatted += `Bienfaits peau :\n`;
    ingredient.proprietes_cosmetiques.peau.slice(0, 5).forEach(bienfait => {
      formatted += `  • ${bienfait}\n`;
    });
  }

  if (ingredient.proprietes_cosmetiques.cheveux && ingredient.proprietes_cosmetiques.cheveux.length > 0) {
    formatted += `\nBienfaits cheveux :\n`;
    ingredient.proprietes_cosmetiques.cheveux.slice(0, 5).forEach(bienfait => {
      formatted += `  • ${bienfait}\n`;
    });
  }

  formatted += `\nActifs principaux : ${ingredient.actifs_principaux.slice(0, 4).join(', ')}\n`;
  formatted += `Usage traditionnel : ${ingredient.usage_traditionnel}\n`;
  formatted += `Contre-indications : ${ingredient.contre_indications}\n`;
  formatted += `Types de peau recommandés : ${ingredient.types_peau_recommandes.join(', ')}`;

  return formatted;
}

/**
 * 📝 FORMATTE UN INGRÉDIENT COSMÉTIQUE
 */
function formatIngredient(ingredient: Ingredient): string {
  let formatted = `💄 INGRÉDIENT COSMÉTIQUE : ${ingredient.nom}\n`;
  formatted += `Fonction : ${ingredient.fonction}\n`;
  formatted += `Usage : ${ingredient.usage}\n`;
  if (ingredient.concentration_ideale) {
    formatted += `Concentration idéale : ${ingredient.concentration_ideale}\n`;
  }
  formatted += `Types de peau : ${ingredient.types_peau.join(', ')}\n`;
  formatted += `Contre-indications : ${ingredient.contre_indications}`;

  return formatted;
}

/**
 * 📝 FORMATTE UNE PROBLÉMATIQUE BEAUTÉ
 */
function formatProblematique(key: string, problematique: Problematique): string {
  let formatted = `🎯 PROBLÉMATIQUE : ${problematique.description}\n`;
  formatted += `Causes possibles : ${problematique.causes.join(', ')}\n`;
  formatted += `Ingrédients recommandés : ${problematique.ingredients_recommandes.join(', ')}\n`;
  formatted += `Routine suggérée : ${problematique.routine}\n`;
  if (problematique.timeline_resultats) {
    formatted += `Timeline résultats : ${problematique.timeline_resultats}\n`;
  }
  if (problematique.conseils_specifiques) {
    formatted += `Conseils spécifiques : ${problematique.conseils_specifiques}`;
  }

  return formatted;
}

/**
 * 📝 FORMATTE UN TYPE DE CHEVEUX
 */
function formatTypeCheveux(type: string, data: any): string {
  let formatted = `💇 TYPE DE CHEVEUX : ${type}\n`;
  formatted += `Description : ${data.description}\n`;
  formatted += `Besoins : ${data.besoins.join(', ')}\n`;
  formatted += `Produits clés : ${data.produits_cles.join(', ')}\n`;
  formatted += `Fréquence lavage : ${data.frequence_lavage}\n`;
  if (data.techniques) {
    formatted += `Techniques recommandées : ${data.techniques.join(', ')}`;
  }

  return formatted;
}

/**
 * 🔍 RECHERCHE DE PRODUITS PERTINENTS
 */
function searchProducts(messageLower: string, productCatalog: any[]): any[] {
  const keywords = messageLower.split(' ').filter(word => word.length > 3);
  const relevantProducts: { product: any; score: number }[] = [];

  for (const product of productCatalog) {
    const productText = `${product.title || ''} ${product.description || ''}`.toLowerCase();
    let score = 0;

    for (const keyword of keywords) {
      if (productText.includes(keyword)) {
        score++;
      }
    }

    if (score > 0) {
      relevantProducts.push({ product, score });
    }
  }

  // Trier par pertinence et prendre les 3 meilleurs
  relevantProducts.sort((a, b) => b.score - a.score);
  return relevantProducts.slice(0, 3).map(item => item.product);
}

/**
 * 📝 FORMATTE LES PRODUITS
 */
function formatProducts(products: any[]): string {
  let formatted = `🛍️ PRODUITS DISPONIBLES DANS LE CATALOGUE (SEULS CES PRODUITS PEUVENT ÊTRE RECOMMANDÉS) :
⚠️ ATTENTION : Tu ne peux recommander QUE les produits ci-dessous. N'invente AUCUN autre produit.\n`;

  products.forEach((product, index) => {
    formatted += `\n📦 PRODUIT #${index + 1}: "${product.title || product.name}"\n`;
    if (product.price) {
      formatted += `   💰 Prix : ${product.price} FCFA\n`;
    }
    if (product.description) {
      const shortDesc = product.description.substring(0, 200);
      formatted += `   📝 Description : ${shortDesc}${product.description.length > 200 ? '...' : ''}\n`;
    }
    if (product.url) {
      formatted += `   🔗 Lien : ${product.url}\n`;
    }
  });

  formatted += `\n⚠️ FIN DE LA LISTE DES PRODUITS. Tout produit non listé ci-dessus N'EXISTE PAS dans le catalogue.`;

  return formatted;
}

/**
 * 🎯 CONSTRUIT LE SYSTEM PROMPT EXPERT BEAUTÉ
 * @param agent - Configuration de l'agent
 * @param relevantContext - Contexte pertinent extrait du RAG
 * @param shopName - Nom de la boutique
 * @param isFirstMessage - True si c'est le premier message de la conversation
 */
export function buildBeautyExpertPrompt(agent: any, relevantContext: string, shopName?: string, isFirstMessage: boolean = true): string {
  const agentName = agent.name || 'Conseillère Beauté';
  const agentTitle = agent.title || 'Experte Beauté';
  const brandName = shopName || 'notre marque';
  const welcomeMessage = agent.welcome_message || agent.welcomeMessage || "Bonjour ! Comment puis-je vous aider aujourd'hui ?";
  const personality = agent.personality || 'professionnelle, chaleureuse et empathique';

  const systemPrompt = `Tu es ${agentName}, ${agentTitle} diplômée en cosmétologie pour ${brandName}.

🎯 TON IDENTITÉ PROFESSIONNELLE
- Tu es experte diplômée en cosmétologie et dermatologie
- Tu es spécialisée dans les soins pour peaux africaines et métissées
- Tu maîtrises la chimie cosmétique et les actifs de beauté
- Tu connais parfaitement le catalogue de ${brandName}
- Tu valorises les ingrédients africains traditionnels avec fierté

🌟 TON EXPERTISE DE BASE

### INGRÉDIENTS AFRICAINS PRIORITAIRES
Tu maîtrises particulièrement :
- **Bissap/Hibiscus** : Stimule croissance cheveux, antioxydant puissant
- **Karité** : Hydratation intense, réparation, protection UV légère
- **Baobab** : Vitamine C 6x orange, anti-âge exceptionnel
- **Moringa** : 46 antioxydants, purifiant, anti-âge
- **Ricin noir** : Stimule croissance capillaire, épaissit cheveux
- **Neem** : Antibactérien, anti-acné, purifiant
- **Argan** : Hydratation, anti-âge, brillance cheveux
- **Pomme de terre** : Éclaircit taches (catécholase), anti-inflammatoire
- **Riz (eau de riz)** : Renforce cheveux (inositol), éclaircit peau

### INGRÉDIENTS COSMÉTIQUES OCCIDENTAUX
- Actifs hydratants : Acide hyaluronique, Glycérine, Aloe Vera
- Actifs anti-âge : Rétinol, Vitamine C, Niacinamide, Peptides
- Actifs éclaircissants : Vitamine C, Niacinamide, Acide kojique, Alpha arbutine
- Exfoliants : AHA (acide glycolique), BHA (acide salicylique)
- Actifs apaisants : Centella asiatica, Allantoïne, Bisabolol

### PROBLÉMATIQUES BEAUTÉ AFRICAINES
- Hyperpigmentation et taches brunes
- Mélasma et masque de grossesse
- Vergetures
- Sécheresse cutanée intense
- Cheveux crépus/frisés (4A, 4B, 4C)
- Casse capillaire, alopécie de traction

💡 TON PROTOCOLE DE RÉPONSE

${isFirstMessage ? `**PHASE 1 : ACCUEIL CHALEUREUX**
Message d'accueil : "${welcomeMessage}"
Note : C'est le PREMIER message de cette conversation. Accueille chaleureusement la cliente.` : `**PHASE 1 : CONTINUATION NATURELLE**
🚨🚨🚨 RÈGLE ABSOLUE - INTERDICTION DE SALUTATIONS 🚨🚨🚨
Tu as DÉJÀ accueilli la cliente. Cette conversation est EN COURS.

INTERDIT de commencer ta réponse par :
❌ "Bonjour" / "Bonsoir" / "Salut"
❌ "Bienvenue" / "Bienvenue chez..."
❌ "Ravi(e) de vous aider" (en début de message)
❌ Toute formule d'accueil

COMMENCE DIRECTEMENT par répondre à ce que la cliente vient de dire.
Exemple : Si elle dit "J'ai des cheveux secs", réponds "Je comprends..." ou "Pour les cheveux secs..." PAS "Bonjour ! Je suis ravie..."`}

**🧠 RÈGLE DE MÉMOIRE CONTEXTUELLE**
AVANT de répondre, RELIS l'historique de conversation.
- Si la cliente a déjà dit qu'elle a des cheveux secs → NE redemande PAS son type de cheveux
- Si elle a déjà mentionné un problème (taches, chute) → NE redemande PAS sa problématique
- UTILISE les informations déjà données pour personnaliser ta réponse

**PHASE 2 : DIAGNOSTIC BEAUTÉ (2-3 questions MAX)**
AVANT de poser une question, vérifie que l'info n'a pas déjà été donnée !
Questions SEULEMENT si info manquante :
- Type de peau/cheveux (si pas déjà mentionné)
- Problématique spécifique (si pas déjà mentionnée)
- Routine actuelle (seulement si pertinent)
- Budget (seulement si cliente hésite ou demande conseil global)

**PHASE 3 : RECOMMANDATION EXPERTE**
🎯 PRIORITÉ ABSOLUE : Recommande UNIQUEMENT les produits de ${brandName} listés dans le contexte ci-dessous

⚠️ RÈGLE CRITIQUE - RECOMMANDATIONS PRODUITS :
1. VÉRIFIE d'abord que le produit existe dans la section "PRODUITS DISPONIBLES" du contexte
2. Si le produit existe → utilise le tool "recommend_product" avec le nom EXACT
3. Si AUCUN produit ne correspond → sois honnête et propose des alternatives ou de transmettre la demande

⚠️ UTILISATION DU TOOL recommend_product :
- UTILISE le tool UNIQUEMENT pour des produits présents dans le contexte
- Utilise le nom EXACT du produit tel qu'il apparaît dans le catalogue
- N'utilise ce tool QUE pour 1 produit à la fois
- Le message accompagnant la carte sera ton explication (reason)

Pour chaque recommandation :
1. **VÉRIFIE** que le produit existe dans le contexte fourni
2. **EXPLIQUE POURQUOI** ce produit convient (ingrédients actifs et leurs bénéfices)
3. **EXPLIQUE COMMENT** l'utiliser (fréquence, application, ordre)
4. **MENTIONNE LES INGRÉDIENTS CLÉS** et leurs actions spécifiques

Si aucun produit du catalogue ne correspond au besoin :
✅ "Je n'ai pas de produit spécifiquement conçu pour [besoin] dans notre catalogue actuel."
✅ "Cependant, [produit existant] contient [ingrédient] qui peut aider."
✅ "Souhaites-tu que je transmette ta demande à notre équipe produit ?"
❌ JAMAIS inventer un produit qui n'existe pas

**PHASE 4 : RÉASSURANCE ET SUIVI**
- Mentionne les résultats attendus avec timeline RÉALISTE
- Propose un suivi si besoin
- Encourage à poser d'autres questions
- Crée de la confiance par ton expertise

🎨 TON STYLE DE COMMUNICATION
- Professionnelle mais accessible et chaleureuse
- Utilise des termes simples (évite jargon excessif)
- Ton ${personality}
- Phrases courtes et claires
- Émojis utilisés avec parcimonie (1-2 max par message)
- Tu tutoyés la cliente (sauf si elle vouvoie)

🚨 TES LIMITES ÉTHIQUES ABSOLUES
- Ne JAMAIS inventer des informations médicales
- Ne JAMAIS diagnostiquer des conditions médicales graves
- Pour cas médicaux sérieux : "Je recommande de consulter un dermatologue"
- Ne JAMAIS garantir des résultats absolus (dire "peut aider" plutôt que "va éliminer")
- Toujours mentionner le patch test pour nouveaux produits actifs
- SPF obligatoire avec actifs photosensibilisants (rétinol, AHA, vitamine C)

🚫🚫🚫 RÈGLES ANTI-HALLUCINATION STRICTES 🚫🚫🚫

**RÈGLE #1 - PRODUITS : CATALOGUE UNIQUEMENT**
Tu ne peux recommander QUE les produits listés dans la section "PRODUITS DISPONIBLES" ci-dessous.
❌ INTERDIT d'inventer un nom de produit
❌ INTERDIT de dire "nous avons un produit qui..." si ce produit n'est pas dans le contexte
❌ INTERDIT de supposer qu'un produit existe
✅ Si aucun produit ne correspond au besoin, dis-le HONNÊTEMENT :
   "Dans notre catalogue actuel, je n'ai pas de produit spécifiquement formulé pour [besoin].
   Cependant, [produit existant] pourrait aider grâce à [ingrédient].
   Je peux aussi transmettre ta demande à notre équipe."

**RÈGLE #2 - INFORMATIONS PRODUITS : CONTEXTE FOURNI UNIQUEMENT**
Pour les informations sur les produits de ${brandName} (prix, ingrédients, utilisation) :
- Base-toi UNIQUEMENT sur les informations fournies dans le contexte ci-dessous
- Si une info n'est pas dans le contexte, dis "Je n'ai pas cette information précise, je me renseigne"
- N'invente JAMAIS un prix, une composition ou une propriété d'un produit

**RÈGLE #3 - CONNAISSANCES BEAUTÉ GÉNÉRALES : AUTORISÉES**
Pour les conseils beauté généraux (routine, techniques, ingrédients cosmétiques connus) :
- Tu PEUX utiliser tes connaissances générales en cosmétologie
- Les informations sur les ingrédients africains et cosmétiques listés plus haut sont fiables
- Pour les ingrédients NON listés, précise "D'après mes connaissances générales..."

**RÈGLE #4 - AVEU D'IGNORANCE OBLIGATOIRE**
Si tu ne connais pas la réponse ou si l'information n'est pas dans ton contexte :
✅ "Je n'ai pas cette information précise. Veux-tu que je me renseigne auprès de l'équipe ?"
✅ "C'est une excellente question ! Je préfère vérifier auprès de notre équipe pour te donner une réponse fiable."
❌ JAMAIS inventer une réponse pour "faire plaisir" à la cliente

**RÈGLE #5 - QUESTIONS HORS-SUJET BEAUTÉ**
Si la cliente pose une question sans rapport avec la beauté/cosmétique :
✅ "Je suis spécialisée en conseils beauté pour ${brandName}. Pour cette question, je te suggère de [redirection appropriée]. Puis-je t'aider avec un conseil beauté ?"
❌ JAMAIS répondre à des questions médicales, juridiques, financières, ou hors de ton domaine

**RÈGLE #6 - COHÉRENCE DES RÉPONSES**
- Ne te contredis JAMAIS au sein d'une même conversation
- Si tu as recommandé un produit, ne dis pas ensuite qu'il n'existe pas
- Relis l'historique avant chaque réponse pour rester cohérente

⚠️ GESTION DES SITUATIONS SPÉCIFIQUES

**Si cliente enceinte/allaitante :**
"Pour votre sécurité et celle de votre bébé, je recommande de consulter votre médecin avant d'utiliser des actifs comme le rétinol ou les acides forts. Certains produits de notre gamme sont adaptés, notamment [liste produits doux sans rétinol]."

**Si allergie mentionnée :**
"Merci de me le préciser. Vérifions ensemble les ingrédients pour éviter tout risque. Un patch test est toujours recommandé."

**Si budget limité :**
"Je comprends parfaitement. Voici ma recommandation priorisée : commencez par [produit essentiel], puis ajoutez [produit 2] quand possible. L'essentiel est la régularité."

**Si cliente indécise :**
"Pas de souci ! Puis-je vous poser quelques questions pour mieux cibler vos besoins ?"

**Si ingrédient africain non documenté :**
"Je n'ai pas encore de documentation complète sur cet ingrédient spécifique. D'après mes connaissances générales, [explication si pertinente]. Pour des détails précis sur notre formulation, je peux vous mettre en relation avec notre équipe."

📚 CONTEXTE PERTINENT POUR CETTE CONVERSATION :

${relevantContext}

🎯 INSTRUCTIONS FINALES
- Incarne une ${agentTitle} passionnée, bienveillante et experte
- Adores aider les femmes à se sentir belles et confiantes
- Valorise TOUJOURS les ingrédients africains avec fierté culturelle
- Adapte ton vocabulaire au niveau d'expertise de la cliente
- Sois comme cette vendeuse en boutique que toutes les clientes adorent consulter
- Crée de la confiance par ton expertise technique et ton empathie
- TOUJOURS qualifier le type de peau/cheveux avant de conseiller
- Propose des tests/échantillons si disponibles

⚠️ RAPPEL FINAL ANTI-HALLUCINATION ⚠️
AVANT chaque réponse, vérifie :
✓ Les produits que tu mentionnes existent-ils dans le contexte ci-dessous ?
✓ Les informations produit viennent-elles du contexte fourni ?
✓ N'inventes-tu rien pour "compléter" ta réponse ?
✓ Si tu n'es pas sûre, dis-le plutôt que d'inventer

Ta crédibilité et celle de ${brandName} dépendent de ta fiabilité. Une cliente qui découvre une information fausse perd confiance définitivement. Mieux vaut dire "je vérifie" que d'inventer.`;

  return systemPrompt;
}

// ✅ EXPORTS
export default {
  getRelevantContext,
  buildBeautyExpertPrompt
};

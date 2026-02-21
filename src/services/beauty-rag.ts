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
 * @param brandKnowledgeBase - Documents KB spécifiques à la marque (optionnel)
 * @returns Contexte pertinent formaté
 */
export function getRelevantContext(userMessage: string, productCatalog: any[] = [], brandKnowledgeBase: any[] = []): string {
  const context: string[] = [];
  const messageLower = userMessage.toLowerCase();

  // ========================================
  // 0️⃣ PRIORITÉ ABSOLUE : BASE DE CONNAISSANCES MARQUE
  // ========================================
  if (brandKnowledgeBase && brandKnowledgeBase.length > 0) {
    // Mots-clés du message (longueur > 2 pour attraper plus de termes)
    const messageParts = messageLower.split(/\s+/).filter(w => w.length > 2);

    // ✅ SCORING : chaque document reçoit un score de pertinence
    const scoredDocs: Array<{ content: string; score: number; title: string }> = [];

    for (const doc of brandKnowledgeBase) {
      if (!doc || !doc.content || doc.content.length < 30) continue;
      if (doc.is_active === false) continue;

      const docTitle = (doc.title || '').toLowerCase();
      const docContent = doc.content.toLowerCase();

      // Calculer le score de pertinence
      let score = 0;
      for (const word of messageParts) {
        // Titre : 3 points par occurrence (le titre est très indicatif)
        let idx = docTitle.indexOf(word);
        while (idx !== -1) {
          score += 3;
          idx = docTitle.indexOf(word, idx + word.length);
        }
        // Contenu complet : 1 point par occurrence (plafonné à 5)
        let count = 0;
        idx = docContent.indexOf(word);
        while (idx !== -1 && count < 5) {
          score += 1;
          count++;
          idx = docContent.indexOf(word, idx + word.length);
        }
      }

      // Toujours inclure si peu de docs (≤5) avec score minimum de 1
      if (score > 0 || brandKnowledgeBase.length <= 5) {
        const truncatedContent = doc.content.length > 2000
          ? doc.content.substring(0, 2000) + '...'
          : doc.content;
        scoredDocs.push({
          content: `📖 CONNAISSANCE MARQUE — ${doc.title || 'Document'}\n${truncatedContent}`,
          score: score > 0 ? score : 1,
          title: doc.title || 'Document'
        });
      }
    }

    if (scoredDocs.length > 0) {
      // Trier par score décroissant, garder les 7 plus pertinents
      scoredDocs.sort((a, b) => b.score - a.score);
      const topDocs = scoredDocs.slice(0, 7);

      context.push(...topDocs.map(d => d.content));
      console.log(`✅ [RAG] ${topDocs.length}/${brandKnowledgeBase.length} doc(s) KB marque sélectionnés par score:`);
      topDocs.forEach(d => console.log(`   📄 "${d.title}" (score: ${d.score})`));
    }
  }

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
    // Produits pertinents pour la requête (détaillés)
    const relevantProducts = searchProducts(messageLower, productCatalog);
    if (relevantProducts.length > 0) {
      console.log(`✅ [RAG] ${relevantProducts.length} produit(s) pertinent(s) trouvé(s)`);
      context.push(formatProducts(relevantProducts));

      // Autres produits disponibles (résumé)
      const shownIds = new Set(relevantProducts.map((p: any) => p.id));
      const otherProducts = productCatalog.filter((p: any) => !shownIds.has(p.id));
      if (otherProducts.length > 0) {
        context.push(formatFullCatalog(otherProducts));
      }
    } else {
      // Aucun match spécifique → montrer tout le catalogue
      context.push(formatFullCatalog(productCatalog));
    }
  }

  // ========================================
  // 6️⃣ RETOUR CONTEXTE
  // ========================================
  if (context.length === 0) {
    console.log('⚠️ [RAG] Aucun contexte spécifique trouvé');
    return `Aucun produit ni information spécifique trouvé pour cette requête. Donne des conseils beauté généraux basés sur tes connaissances en cosmétologie, sans inventer de produit.`;
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
 * 📝 FORMATTE LES PRODUITS DÉTAILLÉS (produits pertinents pour la requête)
 */
function formatProducts(products: any[]): string {
  let formatted = `🎯 PRODUITS LES PLUS PERTINENTS POUR CETTE DEMANDE :\n`;

  products.forEach((product, index) => {
    const name = product.title || product.name;
    formatted += `\n**${name}**\n`;
    if (product.price) {
      formatted += `  Prix : ${product.price} FCFA\n`;
    }
    if (product.description) {
      const shortDesc = product.description.substring(0, 250);
      formatted += `  Description : ${shortDesc}${product.description.length > 250 ? '...' : ''}\n`;
    }
    if (product.url) {
      formatted += `  Lien : ${product.url}\n`;
    }
  });

  return formatted;
}

/**
 * 📋 FORMATTE TOUT LE CATALOGUE (résumé concis de tous les produits)
 */
function formatFullCatalog(products: any[]): string {
  let formatted = `📋 CATALOGUE COMPLET (${products.length} produit${products.length > 1 ? 's' : ''}) :\n`;

  products.forEach((product) => {
    const name = product.title || product.name;
    const price = product.price ? ` — ${product.price} FCFA` : '';
    const category = product.category ? ` (${product.category})` : '';
    formatted += `• ${name}${price}${category}\n`;
  });

  formatted += `\nNote : Utilise recommend_product avec le nom exact pour recommander un produit visuellement (carte produit).`;
  formatted += `\nNote : Utilise add_to_cart quand le client demande explicitement d'ajouter un produit à son panier/commande (ex: "ajoutez aussi...", "je veux aussi...", "mettez dans mon panier").`;
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
  const agentName = agent.name || 'Conseillère';
  const agentTitle = agent.title || 'Vendeuse IA';
  const brandName = shopName || 'notre marque';
  const welcomeMessage = agent.welcome_message || agent.welcomeMessage || `Bonjour ! Je suis ${agentName}, comment puis-je t'aider aujourd'hui ?`;
  const personality = agent.personality || 'chaleureuse et professionnelle';

  return `Tu es ${agentName}, ${agentTitle} pour ${brandName}. Tu es une vraie vendeuse experte, pas un assistant IA. Ton objectif : comprendre le besoin du client, recommander les bons produits et le guider vers l'achat.

## CATALOGUE ET CONNAISSANCES ${brandName.toUpperCase()}

${relevantContext}

## EXPERTISE BEAUTÉ

**Ingrédients africains :** karité (hydratation intense), bissap/hibiscus (stimulant capillaire, antioxydant), baobab (vitamine C × 6 vs orange, anti-âge), moringa (46 antioxydants), ricin noir (croissance capillaire), neem (antibactérien, anti-acné), argan (brillance, hydratation), eau de riz (renforce cheveux, illumine le teint).

**Actifs cosmétiques :** rétinol (anti-âge, soir + SPF), niacinamide (anti-taches, pores), vitamine C (éclat, matin), acide hyaluronique (hydratation), AHA/glycolique (exfoliation + SPF), BHA/salicylique (acné, points noirs).

**Problématiques africaines :** hyperpigmentation, mélasma, sécheresse cutanée intense, cheveux crépus 4A/4B/4C, casse capillaire, alopécie de traction.

## RÈGLES ABSOLUES

1. **Produits** : Recommande UNIQUEMENT des produits du catalogue ci-dessus. Si aucun ne correspond → dis-le franchement.
2. **Vérité** : N'invente jamais un produit, un prix ou un résultat. Si tu ne sais pas → "Je me renseigne auprès de l'équipe."
3. **Patch test** : Mentionne-le pour les actifs forts (rétinol, AHA, BHA, vitamine C concentrée).
4. **SPF** : Rappelle la protection solaire avec les actifs photosensibilisants.
5. **Médical** : Condition sérieuse → recommander un dermatologue.
6. **Cohérence** : Ne redemande jamais une info déjà donnée.

## RÈGLE CRITIQUE — SALUTATIONS

${isFirstMessage
  ? `Cette conversation COMMENCE. Commence ta réponse par : "${welcomeMessage}"`
  : `**INTERDIT DE SALUER.** La conversation est DÉJÀ en cours. Tu as DÉJÀ dit bonjour. Le client te connaît déjà.
NE COMMENCE JAMAIS ta réponse par "Bonjour", "Bonsoir", "Hello", "Salut", "Coucou", "Bienvenue", "Ravie", "Enchantée" ou toute forme de salutation.
Commence DIRECTEMENT par ta réponse au message du client. Exemple : "Pour tes cheveux crépus, je te recommande..."
Si tu salues alors que la conversation est déjà en cours, tu échoues dans ton rôle.`}

## GUIDE DE VENTE (ton objectif = convertir)

**1. Écouter** — Identifier le besoin (type de peau/cheveux, problématique).
**2. Recommander VISUELLEMENT** — Dès que tu identifies un produit adapté, utilise OBLIGATOIREMENT le tool \`recommend_product\` pour l'afficher sous forme de carte visuelle avec image et prix. NE TE CONTENTE PAS de mentionner le produit en texte. Le client doit VOIR le produit, son image et son prix pour décider.
**3. Pousser vers l'achat** — Après avoir montré un produit, invite le client à l'ajouter au panier : "Tu peux cliquer sur 'Commander' pour l'ajouter à ton panier." Propose aussi un produit complémentaire (cross-sell).
**4. Ajouter au panier** — Quand le client dit "ajoutez aussi...", "je prends aussi...", "mettez dans mon panier" → utilise le tool \`add_to_cart\`.
**5. Rassurer** — Timeline réaliste ("résultats visibles en 4-6 semaines"), lever les doutes.

**IMPORTANT SUR LES OUTILS :**
- \`recommend_product\` : Utilise-le CHAQUE FOIS que tu mentionnes un produit du catalogue. Le client doit voir la carte produit (image + prix + bouton Commander). Ne parle JAMAIS d'un produit sans l'afficher visuellement. Si tu recommandes 2 produits, appelle le tool 2 fois.
- \`add_to_cart\` : Utilise-le quand le client demande explicitement d'ajouter au panier/à sa commande.

**Si aucun produit ne correspond :** "Je n'ai pas de produit spécifiquement formulé pour [besoin], mais [produit proche] pourrait aider grâce à [ingrédient]."

**Situations spécifiques :**
- Grossesse/allaitement : déconseiller rétinol et acides forts, orienter vers les produits doux
- Allergie : vérifier les ingrédients, rappeler le patch test
- Budget limité : prioriser l'essentiel, construire la routine progressivement

## STYLE

Ton : ${personality}. Adapte-toi au registre du client (tutoiement si le client tutoie, vouvoiement si le client vouvoie). Phrases courtes et naturelles, comme une vraie conversation. Maximum 1 émoji par message. Valorise les ingrédients africains. Sois la vendeuse que tout le monde adore consulter en boutique — chaleureuse, directe, experte.`;
}

// ✅ EXPORTS
export default {
  getRelevantContext,
  buildBeautyExpertPrompt
};

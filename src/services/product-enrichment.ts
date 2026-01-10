// src/services/product-enrichment.ts
// 🤖 Service d'enrichissement automatique des produits via IA

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || ''
});

/**
 * 🔍 Détecte automatiquement le domaine du produit
 * @param product - Produit à analyser (nom + description)
 * @returns Domaine détecté (skincare, haircare, makeup, nails, body, fragrance)
 */
export async function detectProductDomain(product: {
  name: string;
  description?: string;
  category?: string;
}): Promise<{
  domain: 'skincare' | 'haircare' | 'makeup' | 'nails' | 'body' | 'fragrance' | 'wellness' | 'other';
  confidence: number;
  subcategory?: string;
}> {
  const prompt = `Analyse ce produit cosmétique et détermine son domaine principal.

Produit:
- Nom: ${product.name}
- Description: ${product.description || 'Aucune'}
- Catégorie: ${product.category || 'Aucune'}

Réponds UNIQUEMENT en JSON avec ce format exact:
{
  "domain": "skincare|haircare|makeup|nails|body|fragrance|wellness|other",
  "confidence": 0.0-1.0,
  "subcategory": "sous-catégorie spécifique"
}

Exemples:
- Crème visage → skincare, subcategory: "face_cream"
- Shampoing → haircare, subcategory: "shampoo"
- Rouge à lèvres → makeup, subcategory: "lipstick"
- Vernis → nails, subcategory: "nail_polish"`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 150,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    return {
      domain: result.domain || 'other',
      confidence: result.confidence || 0.5,
      subcategory: result.subcategory
    };
  } catch (error) {
    console.error('❌ [ENRICHMENT] Erreur détection domaine:', error);
    // Fallback : détection basique par mots-clés
    return detectDomainFallback(product);
  }
}

/**
 * 🔄 Fallback : Détection domaine par mots-clés
 */
function detectDomainFallback(product: {
  name: string;
  description?: string;
  category?: string;
}): {
  domain: 'skincare' | 'haircare' | 'makeup' | 'nails' | 'body' | 'fragrance' | 'wellness' | 'other';
  confidence: number;
  subcategory?: string;
} {
  const text = `${product.name} ${product.description} ${product.category}`.toLowerCase();

  const keywords = {
    haircare: ['cheveux', 'capillaire', 'shampoing', 'après-shampoing', 'masque capillaire', 'huile cheveux', 'sérum cheveux'],
    skincare: ['visage', 'peau', 'crème', 'sérum', 'lotion', 'tonique', 'masque visage', 'soin visage'],
    makeup: ['maquillage', 'fond de teint', 'rouge', 'mascara', 'fard', 'poudre', 'gloss'],
    nails: ['ongles', 'vernis', 'manucure', 'nail'],
    body: ['corps', 'body', 'lait corporel', 'beurre corporel', 'gommage corps'],
    fragrance: ['parfum', 'eau de toilette', 'fragrance', 'cologne']
  };

  for (const [domain, words] of Object.entries(keywords)) {
    if (words.some(word => text.includes(word))) {
      return {
        domain: domain as any,
        confidence: 0.7,
        subcategory: undefined
      };
    }
  }

  return { domain: 'other', confidence: 0.3, subcategory: undefined };
}

/**
 * 🎨 Enrichit automatiquement un produit avec l'IA
 * @param product - Produit à enrichir
 * @param domain - Domaine du produit
 * @returns Données d'enrichissement
 */
export async function enrichProduct(
  product: {
    name: string;
    description?: string;
    category?: string;
    tags?: string[];
  },
  domain: string
): Promise<any> {
  const domainPrompts = {
    haircare: `Analyse ce produit capillaire et extrais les informations suivantes en JSON:
{
  "hair_types": ["4A", "4B", "4C", "Bouclés", "Crépus", "Lisses", "Ondulés"],
  "concerns": ["Sécheresse", "Casse", "Chute", "Pellicules", "Manque de brillance"],
  "key_ingredients": ["Beurre de karité", "Huile de coco", etc.],
  "benefits": ["Hydratation", "Fortification", "Brillance", etc.],
  "usage": "Comment utiliser le produit",
  "frequency": "Fréquence d'utilisation recommandée"
}`,

    skincare: `Analyse ce produit de soin visage et extrais les informations suivantes en JSON:
{
  "skin_types": ["Grasse", "Sèche", "Mixte", "Sensible", "Normale", "Mature"],
  "concerns": ["Acné", "Taches", "Rides", "Déshydratation", "Rougeurs"],
  "key_ingredients": ["Acide hyaluronique", "Vitamine C", etc.],
  "benefits": ["Hydratation", "Anti-âge", "Éclat", etc.],
  "usage": "Comment utiliser le produit",
  "texture": "Gel/Crème/Lotion/Sérum"
}`,

    makeup: `Analyse ce produit de maquillage et extrais les informations suivantes en JSON:
{
  "category": "Fond de teint/Rouge à lèvres/Mascara/etc.",
  "finish": "Mat/Brillant/Satiné",
  "coverage": "Légère/Moyenne/Forte",
  "shades": ["Liste des teintes disponibles"],
  "key_features": ["Longue tenue", "Waterproof", etc.],
  "usage": "Comment appliquer"
}`,

    body: `Analyse ce produit de soin corporel et extrais les informations suivantes en JSON:
{
  "body_area": "Corps entier/Mains/Pieds/etc.",
  "concerns": ["Sécheresse", "Vergetures", "Fermeté", etc.],
  "key_ingredients": ["Beurre de karité", "Huile d'argan", etc.],
  "benefits": ["Hydratation", "Raffermissement", etc.],
  "texture": "Crème/Beurre/Huile/Lotion",
  "usage": "Mode d'emploi"
}`
  };

  const promptTemplate = domainPrompts[domain as keyof typeof domainPrompts] || domainPrompts.skincare;

  const prompt = `${promptTemplate}

Produit:
- Nom: ${product.name}
- Description: ${product.description || 'Aucune'}
- Catégorie: ${product.category || 'Aucune'}
- Tags: ${product.tags?.join(', ') || 'Aucun'}

Réponds UNIQUEMENT en JSON valide.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 800,
      response_format: { type: 'json_object' }
    });

    const enrichmentData = JSON.parse(response.choices[0].message.content || '{}');

    console.log(`✅ [ENRICHMENT] Produit enrichi: ${product.name}`);
    return enrichmentData;
  } catch (error) {
    console.error(`❌ [ENRICHMENT] Erreur enrichissement ${product.name}:`, error);
    return {};
  }
}

/**
 * 🚀 Enrichit automatiquement un lot de produits
 * @param products - Liste de produits à enrichir
 * @returns Produits enrichis
 */
export async function batchEnrichProducts(products: any[]): Promise<any[]> {
  const enrichedProducts = [];

  console.log(`🎨 [ENRICHMENT] Début enrichissement de ${products.length} produits...`);

  for (const product of products) {
    try {
      // 1. Détecter le domaine
      const { domain, confidence } = await detectProductDomain(product);

      console.log(`🔍 [ENRICHMENT] ${product.name} → ${domain} (${Math.round(confidence * 100)}%)`);

      // 2. Enrichir selon le domaine
      const enrichmentData = await enrichProduct(product, domain);

      enrichedProducts.push({
        ...product,
        beauty_data: {
          beauty_category: domain,
          ...enrichmentData
        },
        is_enriched: true,
        enrichment_score: Math.round(confidence * 100),
        needs_enrichment: false
      });

      // Rate limiting: 1 produit / seconde pour éviter les limites OpenAI
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`❌ [ENRICHMENT] Erreur sur ${product.name}:`, error);
      enrichedProducts.push(product);
    }
  }

  console.log(`✅ [ENRICHMENT] ${enrichedProducts.length} produits enrichis`);
  return enrichedProducts;
}

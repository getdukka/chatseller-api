// scripts/test-beauty-rag.ts
// 🧪 Script de test du système RAG Beauté Expert

import { getRelevantContext, buildBeautyExpertPrompt } from '../src/services/beauty-rag';

// ✅ CONFIGURATION TEST AGENT
const testAgent = {
  name: 'Amina',
  title: 'Experte Beauté',
  personality: 'chaleureuse, professionnelle et empathique',
  welcome_message: 'Bonjour ! Je suis Amina, votre experte beauté. Comment puis-je vous aider aujourd\'hui ?',
  type: 'beauty_expert'
};

const shopName = 'Ahovi Cosmetics';

// ✅ CATALOGUE PRODUITS TEST
const testProductCatalog = [
  {
    id: '1',
    title: 'Sérum Éclaircissant au Bissap et Vitamine C',
    price: 15000,
    description: 'Sérum anti-taches à base d\'hibiscus (bissap) et vitamine C. Éclaircit le teint naturellement.',
    url: 'https://ahovi.com/serum-bissap'
  },
  {
    id: '2',
    title: 'Beurre de Karité Pur Bio',
    price: 8000,
    description: 'Beurre de karité 100% pur du Burkina Faso. Hydrate intensément peau et cheveux.',
    url: 'https://ahovi.com/karite-pur'
  },
  {
    id: '3',
    title: 'Huile Capillaire Croissance Ricin Noir',
    price: 12000,
    description: 'Huile de ricin noir jamaïcain enrichie au moringa. Stimule la pousse des cheveux.',
    url: 'https://ahovi.com/huile-ricin'
  },
  {
    id: '4',
    title: 'Masque Visage Purifiant Argile & Neem',
    price: 6500,
    description: 'Masque à l\'argile africaine et neem. Purifie les peaux grasses et acnéiques.',
    url: 'https://ahovi.com/masque-argile'
  },
  {
    id: '5',
    title: 'Crème Anti-Vergetures Cacao & Baobab',
    price: 18000,
    description: 'Crème riche au beurre de cacao et huile de baobab. Prévient et atténue les vergetures.',
    url: 'https://ahovi.com/creme-vergetures'
  }
];

// 🧪 SCÉNARIOS DE TEST
const testScenarios = [
  {
    id: 1,
    name: 'Test Hydratation',
    userMessage: "J'ai la peau sèche, que me conseillez-vous ?",
    expectedElements: ['acide hyaluronique', 'glycérine', 'beurre de karité', 'hydratation'],
    expectedProducts: ['Beurre de Karité']
  },
  {
    id: 2,
    name: 'Test Taches (Mélasma)',
    userMessage: "J'ai des taches depuis ma grossesse",
    expectedElements: ['mélasma', 'hyperpigmentation', 'vitamine C', 'niacinamide', 'SPF'],
    expectedProducts: ['Sérum Éclaircissant']
  },
  {
    id: 3,
    name: 'Test Cheveux (Casse)',
    userMessage: "Mes cheveux sont cassants après les tresses",
    expectedElements: ['alopécie de traction', 'casse capillaire', 'hydratation', 'protéines'],
    expectedProducts: ['Huile Capillaire']
  },
  {
    id: 4,
    name: 'Test Produit Inexistant',
    userMessage: "Avez-vous du rétinol ?",
    expectedElements: ['rétinol', 'alternative', 'vitamine C'],
    expectedProducts: []
  },
  {
    id: 5,
    name: 'Test Grossesse',
    userMessage: "Je suis enceinte, puis-je utiliser ce sérum au rétinol ?",
    expectedElements: ['grossesse', 'rétinol', 'déconseiller', 'médecin', 'alternative'],
    expectedProducts: []
  },
  {
    id: 6,
    name: 'Test Ingrédient Africain - Bissap',
    userMessage: "Comment le bissap agit-il sur mes cheveux ?",
    expectedElements: ['bissap', 'hibiscus', 'croissance', 'vitamine C', 'renforce'],
    expectedProducts: ['Sérum Éclaircissant']
  },
  {
    id: 7,
    name: 'Test Ingrédient Africain - Pomme de terre',
    userMessage: "Est-ce que la pomme de terre peut vraiment éclaircir mes taches ?",
    expectedElements: ['pomme de terre', 'catécholase', 'éclaircit', 'taches', 'enzyme'],
    expectedProducts: []
  }
];

// 🎯 FONCTION DE TEST
async function runTests() {
  console.log('\n🧪 ========================================');
  console.log('🧪 TESTS SYSTÈME RAG BEAUTÉ EXPERT');
  console.log('🧪 ========================================\n');

  let passedTests = 0;
  let totalTests = testScenarios.length;

  for (const scenario of testScenarios) {
    console.log(`\n📋 TEST ${scenario.id}/${totalTests}: ${scenario.name}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`💬 Question: "${scenario.userMessage}"\n`);

    // Recherche contextuelle
    const relevantContext = getRelevantContext(scenario.userMessage, testProductCatalog);

    console.log(`📚 CONTEXTE TROUVÉ:\n${relevantContext.substring(0, 500)}...\n`);

    // Vérifier éléments attendus
    const contextLower = relevantContext.toLowerCase();
    const foundElements: string[] = [];
    const missingElements: string[] = [];

    scenario.expectedElements.forEach(element => {
      if (contextLower.includes(element.toLowerCase())) {
        foundElements.push(element);
      } else {
        missingElements.push(element);
      }
    });

    // Vérifier produits
    const foundProducts: string[] = [];
    scenario.expectedProducts.forEach(productName => {
      if (relevantContext.includes(productName)) {
        foundProducts.push(productName);
      }
    });

    // Résultat
    const testPassed = missingElements.length === 0;

    if (testPassed) {
      passedTests++;
      console.log('✅ TEST RÉUSSI\n');
    } else {
      console.log('❌ TEST ÉCHOUÉ\n');
    }

    console.log(`✅ Éléments trouvés: ${foundElements.join(', ')}`);
    if (missingElements.length > 0) {
      console.log(`❌ Éléments manquants: ${missingElements.join(', ')}`);
    }
    if (foundProducts.length > 0) {
      console.log(`🛍️  Produits suggérés: ${foundProducts.join(', ')}`);
    }
  }

  // Résumé
  console.log('\n\n🎯 ========================================');
  console.log('🎯 RÉSUMÉ DES TESTS');
  console.log('🎯 ========================================\n');
  console.log(`✅ Tests réussis: ${passedTests}/${totalTests}`);
  console.log(`❌ Tests échoués: ${totalTests - passedTests}/${totalTests}`);
  console.log(`📊 Taux de réussite: ${((passedTests / totalTests) * 100).toFixed(1)}%\n`);

  if (passedTests === totalTests) {
    console.log('🎉 TOUS LES TESTS SONT PASSÉS ! Système RAG opérationnel.\n');
  } else {
    console.log('⚠️ Certains tests ont échoué. Révision nécessaire.\n');
  }
}

// 🧪 TEST SYSTEM PROMPT
async function testSystemPrompt() {
  console.log('\n\n🎯 ========================================');
  console.log('🎯 TEST SYSTEM PROMPT COMPLET');
  console.log('🎯 ========================================\n');

  const userMessage = "J'ai des taches brunes depuis ma grossesse et mes cheveux tombent beaucoup";
  console.log(`💬 Question: "${userMessage}"\n`);

  const relevantContext = getRelevantContext(userMessage, testProductCatalog);
  const systemPrompt = buildBeautyExpertPrompt(testAgent, relevantContext, shopName);

  console.log(`📏 Longueur System Prompt: ${systemPrompt.length} caractères`);
  console.log(`📄 Aperçu (500 premiers caractères):\n`);
  console.log(systemPrompt.substring(0, 500));
  console.log(`\n...\n`);
  console.log(`📄 Fin (500 derniers caractères):\n`);
  console.log(systemPrompt.substring(systemPrompt.length - 500));
  console.log('\n');
}

// 🚀 EXÉCUTION
(async () => {
  try {
    await runTests();
    await testSystemPrompt();

    console.log('✅ Tous les tests terminés avec succès.\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur lors des tests:', error);
    process.exit(1);
  }
})();

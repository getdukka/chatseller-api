// scripts/test-conversation-coherence.ts
// 🧪 Test de cohérence conversationnelle - Vérification anti-répétition "Bonjour"

import { buildBeautyExpertPrompt } from '../src/services/beauty-rag';

const testAgent = {
  name: 'Amina',
  title: 'Experte Beauté',
  personality: 'chaleureuse et professionnelle',
  welcome_message: 'Bonjour ! Je suis Amina, votre experte beauté. Comment puis-je vous aider ?'
};

const shopName = 'Ahovi Cosmetics';
const sampleContext = 'Aucun contexte spécifique';

console.log('🧪 ====================================');
console.log('🧪 TEST COHÉRENCE CONVERSATIONNELLE');
console.log('🧪 ====================================\n');

// ✅ TEST 1 : Premier message (doit contenir instruction d'accueil)
console.log('📋 TEST 1 : PREMIER MESSAGE\n');
console.log('Paramètre isFirstMessage : TRUE\n');

const firstMessagePrompt = buildBeautyExpertPrompt(testAgent, sampleContext, shopName, true);

if (firstMessagePrompt.includes('ACCUEIL CHALEUREUX')) {
  console.log('✅ PHASE 1 détectée : ACCUEIL CHALEUREUX');
  console.log('✅ L\'IA sait qu\'elle doit accueillir la cliente\n');
} else {
  console.log('❌ ERREUR : Instruction d\'accueil manquante\n');
}

// Vérifier présence du message d'accueil
if (firstMessagePrompt.includes(testAgent.welcome_message)) {
  console.log('✅ Message d\'accueil présent dans le prompt');
  console.log(`   "${testAgent.welcome_message}"\n`);
} else {
  console.log('❌ ERREUR : Message d\'accueil absent\n');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ✅ TEST 2 : Message suivant (ne doit PAS contenir instruction d'accueil)
console.log('📋 TEST 2 : MESSAGE SUIVANT (conversation en cours)\n');
console.log('Paramètre isFirstMessage : FALSE\n');

const followUpPrompt = buildBeautyExpertPrompt(testAgent, sampleContext, shopName, false);

if (followUpPrompt.includes('CONTINUATION NATURELLE')) {
  console.log('✅ PHASE 1 détectée : CONTINUATION NATURELLE');
  console.log('✅ L\'IA sait qu\'elle NE doit PAS répéter de salutations\n');
} else {
  console.log('❌ ERREUR : Instruction de continuation manquante\n');
}

// Vérifier présence de l'avertissement anti-répétition
if (followUpPrompt.includes('NE RÉPÈTE PAS de salutations')) {
  console.log('✅ Avertissement anti-répétition présent');
  console.log('   "NE RÉPÈTE PAS de salutations type \'Bonjour\', \'Salut\', etc."\n');
} else {
  console.log('❌ ERREUR : Avertissement anti-répétition absent\n');
}

// Vérifier ABSENCE du message d'accueil dans conversation en cours
if (!followUpPrompt.includes(testAgent.welcome_message)) {
  console.log('✅ Message d\'accueil ABSENT dans conversation en cours (correct)\n');
} else {
  console.log('❌ ERREUR : Message d\'accueil présent alors qu\'il devrait être absent\n');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ✅ TEST 3 : Vérification des différences
console.log('📋 TEST 3 : COMPARAISON DES DEUX PROMPTS\n');

const prompt1Length = firstMessagePrompt.length;
const prompt2Length = followUpPrompt.length;

console.log(`📏 Longueur prompt premier message : ${prompt1Length} caractères`);
console.log(`📏 Longueur prompt message suivant : ${prompt2Length} caractères`);
console.log(`📊 Différence : ${Math.abs(prompt1Length - prompt2Length)} caractères\n`);

if (prompt1Length !== prompt2Length) {
  console.log('✅ Les prompts sont différents (correct)\n');
} else {
  console.log('❌ ERREUR : Les prompts sont identiques (ne devrait pas arriver)\n');
}

// ✅ RÉSUMÉ
console.log('\n🎯 ====================================');
console.log('🎯 RÉSUMÉ DES TESTS');
console.log('🎯 ====================================\n');

const test1Pass = firstMessagePrompt.includes('ACCUEIL CHALEUREUX') &&
                  firstMessagePrompt.includes(testAgent.welcome_message);

const test2Pass = followUpPrompt.includes('CONTINUATION NATURELLE') &&
                  followUpPrompt.includes('NE RÉPÈTE PAS') &&
                  !followUpPrompt.includes(testAgent.welcome_message);

const test3Pass = prompt1Length !== prompt2Length;

console.log(`Test 1 (Premier message) : ${test1Pass ? '✅ RÉUSSI' : '❌ ÉCHOUÉ'}`);
console.log(`Test 2 (Message suivant) : ${test2Pass ? '✅ RÉUSSI' : '❌ ÉCHOUÉ'}`);
console.log(`Test 3 (Différenciation) : ${test3Pass ? '✅ RÉUSSI' : '❌ ÉCHOUÉ'}`);

const allTestsPass = test1Pass && test2Pass && test3Pass;

if (allTestsPass) {
  console.log('\n🎉 TOUS LES TESTS SONT PASSÉS !');
  console.log('✅ La cohérence conversationnelle est assurée.');
  console.log('✅ Le problème de répétition "Bonjour" est corrigé.\n');
  process.exit(0);
} else {
  console.log('\n❌ CERTAINS TESTS ONT ÉCHOUÉ !');
  console.log('⚠️ La correction nécessite une révision.\n');
  process.exit(1);
}
